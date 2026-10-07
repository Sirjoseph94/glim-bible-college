import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createBoss, createPool, Db, schema } from "../src/index";
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
      await queue.publish("academic.session.activated", { sessionId: "s1" });
    });

    expect(await institutionName()).toBe("GLIM Bible College");
    const jobs = await boss.fetch<{ name: string; payload: { sessionId: string } }>("domain-event");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({
      name: "academic.session.activated",
      payload: { sessionId: "s1" },
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
  it("keeps exactly one settings row", async () => {
    const rows = await db.read.select().from(schema.settings);
    expect(rows).toHaveLength(1);
    await expect(db.pool.query("INSERT INTO settings (id) VALUES (2)")).rejects.toThrow(
      /settings_single_row/,
    );
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
