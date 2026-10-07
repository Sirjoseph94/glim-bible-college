import type { DomainEvent, DomainEventName, QueueName } from "@glim/contracts";
import { newId, type Result } from "@glim/shared";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgBoss, SendOptions } from "pg-boss";
import pg from "pg";
import * as schema from "./schema/index";

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

type QueryClient = Pick<pg.PoolClient, "query">;

/** Enqueues pg-boss jobs on the caller's transaction, so jobs commit or roll back with it (INV-5). */
export interface TxQueue {
  send(queue: QueueName, data: object, options?: Omit<SendOptions, "db">): Promise<string | null>;
  /** `occurredAt` comes from the caller's Clock (§5.1). */
  publish(
    name: DomainEventName,
    payload: Record<string, unknown>,
    meta: { occurredAt: Date; actorUserId?: string | null },
  ): Promise<string | null>;
}

export interface Tx {
  db: Database;
  boss: TxQueue;
}

/** Adapts a pg client to pg-boss's database interface so `send` runs on that client. */
export function bossAdapter(client: QueryClient) {
  return {
    executeSql: async (text: string, values?: unknown[]) => {
      const result = await client.query(text, values);
      return { rows: result.rows as unknown[] };
    },
  };
}

function txQueue(boss: PgBoss, client: QueryClient): TxQueue {
  const db = bossAdapter(client);
  return {
    send: (queue, data, options) => boss.send(queue, data, { ...options, db }),
    publish: (name, payload, meta) => {
      const event: DomainEvent = {
        id: newId(),
        name,
        occurredAt: meta.occurredAt.toISOString(),
        actorUserId: meta.actorUserId ?? null,
        payload,
      };
      return boss.send("domain-event", event, { db, id: event.id });
    },
  };
}

/** Carries an expected failure out of `withTx` so the transaction rolls back. */
class RollbackWith extends Error {
  constructor(readonly result: unknown) {
    super("rolled back: expected failure");
  }
}

/**
 * Database access (TRD §5.2). Reads use the pool directly; every write path goes through
 * `withTx`, which shares one transaction between Drizzle and pg-boss.
 */
export class Db {
  readonly read: Database;

  constructor(
    readonly pool: pg.Pool,
    private readonly boss: PgBoss,
  ) {
    this.read = drizzle({ client: pool, schema, casing: "snake_case" });
  }

  async withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const db = drizzle({ client, schema, casing: "snake_case" });
      const result = await fn({ db, boss: txQueue(this.boss, client) });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Like `withTx` for use cases that return a Result: an expected failure rolls the transaction
   * back (nothing it wrote, or enqueued, survives) and is returned to the caller (§5.8).
   */
  async withTxResult<T, E>(fn: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>> {
    try {
      return await this.withTx(async (tx) => {
        const result = await fn(tx);
        if (!result.ok) throw new RollbackWith(result);
        return result;
      });
    } catch (error) {
      if (error instanceof RollbackWith) return error.result as Result<T, E>;
      throw error;
    }
  }

  /** True when the database answers a trivial query. */
  async ping(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}

export function createPool(connectionString: string, max: number): pg.Pool {
  return new pg.Pool({ connectionString, max, application_name: "glim" });
}
