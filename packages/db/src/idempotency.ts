import { and, eq, lt, or } from "drizzle-orm";
import type { Db } from "./db";
import { idempotencyKeys } from "./schema/platform";

/** What to do with a request carrying an Idempotency-Key (TRD §5.4). */
export type IdempotencyClaim =
  /** First time: run the operation, then `complete` (or `release` if it failed). */
  | { kind: "claimed" }
  /** Done before with the same request: send the stored response again. */
  | { kind: "replay"; status: number; body: unknown }
  /** The first request is still running (409 IDEMPOTENCY_IN_PROGRESS). */
  | { kind: "in-progress" }
  /** The key was used for a different request (422 IDEMPOTENCY_KEY_REUSED). */
  | { kind: "reused" };

export interface IdempotencyRef {
  userId: string;
  operation: string;
  key: string;
}

const KEY_LIFETIME_MS = 48 * 60 * 60 * 1000;
/**
 * A claim still IN_PROGRESS after this long belongs to a request that died before finishing; it may
 * be claimed again. The operations it guards also check their own state (e.g. only a DRAFT submits).
 */
const ABANDONED_AFTER_MS = 2 * 60 * 1000;

/** The `idempotency_keys` repository (owner: shared platform). */
export class IdempotencyStore {
  constructor(private readonly db: Db) {}

  async claim(ref: IdempotencyRef & { requestHash: string; now: Date }): Promise<IdempotencyClaim> {
    const t = idempotencyKeys;
    const same = and(eq(t.userId, ref.userId), eq(t.operation, ref.operation), eq(t.key, ref.key));
    return this.db.withTx(async ({ db }) => {
      await db
        .delete(t)
        .where(
          and(
            same,
            or(
              lt(t.expiresAt, ref.now),
              and(
                eq(t.status, "IN_PROGRESS"),
                lt(t.createdAt, new Date(ref.now.getTime() - ABANDONED_AFTER_MS)),
              ),
            ),
          ),
        );
      const [inserted] = await db
        .insert(t)
        .values({
          userId: ref.userId,
          operation: ref.operation,
          key: ref.key,
          requestHash: ref.requestHash,
          status: "IN_PROGRESS",
          createdAt: ref.now,
          expiresAt: new Date(ref.now.getTime() + KEY_LIFETIME_MS),
        })
        .onConflictDoNothing()
        .returning({ id: t.id });
      if (inserted !== undefined) return { kind: "claimed" };
      const [existing] = await db.select().from(t).where(same);
      if (existing === undefined) return { kind: "in-progress" };
      if (existing.requestHash !== ref.requestHash) return { kind: "reused" };
      if (existing.status === "COMPLETED")
        return {
          kind: "replay",
          status: existing.responseStatus ?? 200,
          body: existing.responseBody,
        };
      return { kind: "in-progress" };
    });
  }

  async complete(ref: IdempotencyRef, response: { status: number; body: unknown }): Promise<void> {
    const t = idempotencyKeys;
    await this.db.withTx(({ db }) =>
      db
        .update(t)
        .set({ status: "COMPLETED", responseStatus: response.status, responseBody: response.body })
        .where(and(eq(t.userId, ref.userId), eq(t.operation, ref.operation), eq(t.key, ref.key))),
    );
  }

  /** Forgets a claim whose operation failed, so the client may retry with the same key. */
  async release(ref: IdempotencyRef): Promise<void> {
    const t = idempotencyKeys;
    await this.db.withTx(({ db }) =>
      db
        .delete(t)
        .where(
          and(
            eq(t.userId, ref.userId),
            eq(t.operation, ref.operation),
            eq(t.key, ref.key),
            eq(t.status, "IN_PROGRESS"),
          ),
        ),
    );
  }
}
