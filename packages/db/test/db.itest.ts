import { ENUMS, type EnumKey } from "@glim/contracts";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createBoss, createPool, Db, schema, withSavepoint } from "../src/index";
import { createTestDatabase, drainQueues, type TestDatabase } from "../src/testing/index";

let database: TestDatabase;
let db: Db;
let boss: ReturnType<typeof createBoss>;

beforeAll(async () => {
  database = await createTestDatabase(inject("glim").postgresAdminUrl);
  boss = createBoss(database.appUrl, { max: 2 });
  await boss.start();
  db = new Db(createPool(database.appUrl, 4), boss);
});

afterAll(async () => {
  await boss.stop({ graceful: false });
  await db.pool.end();
  await database.drop();
});

async function institutionName(): Promise<string | undefined> {
  const [row] = await db.read.select().from(schema.settings);
  return row?.name;
}

describe("Db.withTx (INV-5: jobs commit or roll back with the change)", () => {
  it("delivers a job enqueued in a committed transaction", async () => {
    await db.withTx(async ({ db: tx, boss: queue }) => {
      await tx
        .update(schema.settings)
        .set({ name: "GLIM Bible College" })
        .where(eq(schema.settings.id, 1));
      await queue.publish(
        "academic.offering.completed",
        { offeringId: "o1" },
        { occurredAt: new Date() },
      );
    });

    expect(await institutionName()).toBe("GLIM Bible College");
    const jobs = await boss.fetch<{ name: string; payload: { offeringId: string } }>("domain-event");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({
      name: "academic.offering.completed",
      payload: { offeringId: "o1" },
    });
  });

  it("leaves neither the change nor the job behind when the transaction rolls back", async () => {
    await expect(
      db.withTx(async ({ db: tx, boss: queue }) => {
        await tx
          .update(schema.settings)
          .set({ name: "Rolled back" })
          .where(eq(schema.settings.id, 1));
        await queue.send("admissions.purge", { reason: "test" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await institutionName()).toBe("GLIM Bible College");
    expect(await boss.fetch("admissions.purge")).toHaveLength(0);
  });
});

describe("schema", () => {
  it("mirrors every enumeration in contracts/enums.ts with a CHECK constraint (TRD §6.1)", async () => {
    const { rows } = await db.pool.query<{ table: string; name: string; def: string }>(`
      SELECT c.conrelid::regclass::text AS table, c.conname AS name, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'c' AND n.nspname = 'public'`);
    const tables = new Set(rows.map((r) => r.table));
    const checked: string[] = [];
    for (const key of Object.keys(ENUMS) as EnumKey[]) {
      const [table, column] = key.split(".") as [string, string];
      if (!tables.has(table)) continue; // created by a later migration group
      const constraint = rows.find((r) => r.name === `${table}_${column}_check`);
      expect(constraint, key).toBeDefined();
      const values = [...(constraint?.def ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1]);
      expect(values, key).toEqual([...ENUMS[key]]);
      checked.push(key);
    }
    expect(checked).toContain("users.status");
  });

  it("keeps exactly one settings row", async () => {
    const rows = await db.read.select().from(schema.settings);
    expect(rows).toHaveLength(1);
    await expect(db.pool.query("INSERT INTO settings (id) VALUES (2)")).rejects.toThrow(
      /settings_single_row/,
    );
  });

  it("keeps audit_logs append-only: the app role can't change rows, and the trigger stops even the owner (INV-11)", async () => {
    await db.pool.query(
      "INSERT INTO audit_logs (actor_type, action, resource_type, outcome) VALUES ('SYSTEM', 'test.event', 'test', 'SUCCESS')",
    );
    await expect(db.pool.query("UPDATE audit_logs SET action = 'tampered'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.pool.query("DELETE FROM audit_logs")).rejects.toThrow(/permission denied/);
    const owner = new pg.Client({ connectionString: database.migratorUrl });
    await owner.connect();
    try {
      await expect(owner.query("UPDATE audit_logs SET action = 'tampered'")).rejects.toThrow(
        /append-only/,
      );
      await expect(owner.query("DELETE FROM audit_logs")).rejects.toThrow(/append-only/);
      await expect(owner.query("TRUNCATE audit_logs")).rejects.toThrow(/append-only/);
    } finally {
      await owner.end();
    }
  });

  it("gives the app role DML but no DDL (TRD §5.2)", async () => {
    const client = new pg.Client({ connectionString: database.appUrl });
    await client.connect();
    try {
      await expect(client.query("CREATE TABLE intruder (id int)")).rejects.toThrow(
        /permission denied/,
      );
      await expect(client.query("DROP TABLE settings")).rejects.toThrow(/must be owner/);
    } finally {
      await client.end();
    }
  });
});

describe("drainQueues", () => {
  it("runs queued jobs to completion, including jobs enqueued by other jobs", async () => {
    const seen: string[] = [];
    await db.withTx(({ boss: queue }) => queue.send("admissions.offer-sweep", { step: "first" }));

    const result = await drainQueues(boss, {
      "admissions.offer-sweep": async (job) => {
        seen.push(`sweep:${(job.data as { step: string }).step}`);
        await db.withTx(({ boss: queue }) => queue.send("notify.send", { to: "applicant" }));
      },
      "notify.send": (job) =>
        Promise.resolve(void seen.push(`notify:${(job.data as { to: string }).to}`)),
    });

    expect(seen).toEqual(["sweep:first", "notify:applicant"]);
    expect(result).toEqual({ completed: 2, failed: 0 });
  });
});

describe("Db.withTxResult", () => {
  it("rolls back the change and its jobs when the use case returns an expected failure", async () => {
    const result = await db.withTxResult(async ({ db: tx, boss: queue }) => {
      await tx
        .update(schema.settings)
        .set({ name: "Should not stick" })
        .where(eq(schema.settings.id, 1));
      await queue.send("admissions.purge", { reason: "test" });
      return { ok: false as const, error: "INTAKE_CLOSED" };
    });
    expect(result).toEqual({ ok: false, error: "INTAKE_CLOSED" });
    expect(await institutionName()).toBe("GLIM Bible College");
    expect(await boss.fetch("admissions.purge")).toHaveLength(0);
  });

  it("commits when the use case succeeds", async () => {
    const result = await db.withTxResult(async ({ db: tx }) => {
      await tx
        .update(schema.settings)
        .set({ name: "GLIM Bible College" })
        .where(eq(schema.settings.id, 1));
      return { ok: true as const, value: "saved" };
    });
    expect(result).toEqual({ ok: true, value: "saved" });
  });
});

describe("withSavepoint", () => {
  it("undoes only the failed step's writes; the transaction carries on and commits", async () => {
    const r = schema.rooms;
    await db.withTx(async ({ db: tx }) => {
      await withSavepoint(tx, () => tx.insert(r).values({ code: "SP-1", name: "Kept" }));
      await expect(
        withSavepoint(tx, async () => {
          await tx.insert(r).values({ code: "SP-2", name: "Undone" });
          throw new Error("this step fails");
        }),
      ).rejects.toThrow("this step fails");
      await tx.insert(r).values({ code: "SP-3", name: "Also kept" });
    });
    const codes = (await db.read.select({ code: r.code }).from(r)).map((x) => x.code).sort();
    expect(codes).toEqual(["SP-1", "SP-3"]);
  });
});

describe("rl_acquire (Google quota buckets, TRD §11.7)", () => {
  const acquire = async (key: string, capacity: number, refill: number, cost = 1) => {
    const { rows } = await db.pool.query<{ wait: number }>(
      "SELECT rl_acquire($1, $2, $3, $4) AS wait",
      [key, capacity, refill, cost],
    );
    return rows[0]?.wait;
  };

  it("starts full, hands out tokens, then says how long to wait", async () => {
    expect(await acquire("test:a", 2, 1)).toBe(0);
    expect(await acquire("test:a", 2, 1)).toBe(0);
    const wait = await acquire("test:a", 2, 1);
    expect(wait).toBeGreaterThan(900);
    expect(wait).toBeLessThanOrEqual(1000);
  });

  it("refills over time and keeps buckets apart", async () => {
    expect(await acquire("test:b", 1, 1000)).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await acquire("test:b", 1, 1000)).toBe(0);
    expect(await acquire("test:c", 5, 1, 5)).toBe(0);
    expect(await acquire("test:c", 5, 1, 5)).toBeGreaterThan(4000);
  });
});
