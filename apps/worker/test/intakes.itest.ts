import { createBoss, createPool, Db } from "@glim/db";
import { createTestDatabase, drainQueues, type TestDatabase } from "@glim/db/testing";
import { IntakesService } from "@glim/modules/admissions";
import { TestClock } from "@glim/shared";
import { createLogger } from "@glim/telemetry";
import type { INestApplicationContext } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createHandlers } from "../src/handlers";
import { createWorkerContext } from "../src/worker.module";

let database: TestDatabase;
let db: Db;
let boss: ReturnType<typeof createBoss>;
let context: INestApplicationContext;
const clock = new TestClock("2026-10-31T12:00:00Z");

beforeAll(async () => {
  database = await createTestDatabase(inject("glim").postgresAdminUrl);
  boss = createBoss(database.appUrl, { max: 2 });
  await boss.start();
  db = new Db(createPool(database.appUrl, 4), boss);
  context = await createWorkerContext({
    db,
    clock,
    logger: createLogger({ service: "intake-test", level: "silent" }),
  });
  await db.pool.query(
    "INSERT INTO intakes (code, opens_on, closes_on, starts_on) VALUES ('2027', '2026-11-01', '2027-06-30', '2027-09-01')",
  );
});

afterAll(async () => {
  await context.close();
  await boss.stop({ graceful: false });
  await db.pool.end();
  await database.drop();
});

async function runDailyJob(code = "2027"): Promise<string> {
  await db.withTx(({ boss: queue }) => queue.send("admissions.intake-status", {}));
  await drainQueues(boss, createHandlers({ context, subscribers: {} }));
  const { rows } = await db.pool.query<{ status: string }>(
    "SELECT status FROM intakes WHERE code = $1",
    [code],
  );
  return rows[0]?.status ?? "missing";
}

describe("admissions.intake-status (daily, Lagos time)", () => {
  it("opens the intake when its first day starts in Lagos, and closes it after its last day", async () => {
    expect(await runDailyJob()).toBe("PLANNED");

    // 23:30 UTC on 31 October is already 00:30 on 1 November in Lagos.
    clock.set("2026-10-31T23:30:00Z");
    expect(await runDailyJob()).toBe("OPEN");

    clock.set("2027-06-30T22:30:00Z"); // 23:30 on 30 June in Lagos: still the last day
    expect(await runDailyJob()).toBe("OPEN");

    clock.set("2027-06-30T23:30:00Z"); // 00:30 on 1 July in Lagos
    expect(await runDailyJob()).toBe("CLOSED");

    clock.set("2027-11-01T09:00:00Z");
    expect(await runDailyJob()).toBe("CLOSED");
  });

  it("leaves an intake closed early by hand closed, inside its dates", async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      `INSERT INTO intakes (code, opens_on, closes_on, starts_on, status)
       VALUES ('2028', '2027-11-01', '2028-06-30', '2028-09-01', 'OPEN') RETURNING id`,
    );
    clock.set("2028-01-15T09:00:00Z");
    const closed = await context
      .get(IntakesService)
      .transition(rows[0]?.id ?? "", "CLOSED", { userId: null, type: "SYSTEM" });
    expect(closed.ok).toBe(true);
    expect(await runDailyJob("2028")).toBe("CLOSED");
  });
});
