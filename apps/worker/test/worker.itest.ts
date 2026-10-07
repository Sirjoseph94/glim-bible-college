import type { DomainEvent } from "@glim/contracts";
import { createBoss, createPool, Db } from "@glim/db";
import { createTestDatabase, type TestDatabase } from "@glim/db/testing";
import { createLogger } from "@glim/telemetry";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createHandlers } from "../src/handlers";
import { startWorker, type RunningWorker } from "../src/worker";

const logger = createLogger({ service: "worker-test", level: "silent" });

let database: TestDatabase;
let db: Db;
let sendBoss: ReturnType<typeof createBoss>;
const running: RunningWorker[] = [];

beforeAll(async () => {
  database = await createTestDatabase(inject("glim").postgresAdminUrl);
  sendBoss = createBoss(database.appUrl, { max: 2 });
  await sendBoss.start();
  db = new Db(createPool(database.appUrl, 2), sendBoss);
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((w) => w.stop({ graceful: false, timeoutMs: 1000 })));
});

afterAll(async () => {
  await sendBoss.stop({ graceful: false });
  await db.pool.end();
  await database.drop();
});

describe("worker", () => {
  it("runs a domain event enqueued in a committed transaction", async () => {
    const received: DomainEvent[] = [];
    const worker = await startWorker({
      boss: createBoss(database.appUrl, { max: 2 }),
      role: "general",
      handlers: createHandlers({
        subscribers: {
          "academic.session.activated": [(e) => Promise.resolve(void received.push(e))],
        },
      }),
      logger,
      pollingIntervalSeconds: 0.5,
    });
    running.push(worker);

    await db.withTx(({ boss }) =>
      boss.publish("academic.session.activated", { sessionId: "2027/2028" }),
    );

    await vi.waitFor(
      () => {
        expect(received).toHaveLength(1);
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(received[0]?.payload).toEqual({ sessionId: "2027/2028" });
  });

  it("redelivers a job to another worker when the first dies mid-job", async () => {
    let firstAttemptStarted = false;
    const redelivered = vi.fn();
    const dying = await startWorker({
      boss: createBoss(database.appUrl, { max: 2 }),
      role: "general",
      handlers: {
        "provider-event.process": () => {
          firstAttemptStarted = true;
          return new Promise(() => undefined); // never finishes: the process is about to be killed
        },
      },
      logger,
      pollingIntervalSeconds: 0.5,
    });

    await db.withTx(({ boss }) =>
      boss.send(
        "provider-event.process",
        { inboxId: "e1" },
        { expireInSeconds: 1, retryDelay: 0, retryBackoff: false },
      ),
    );
    await vi.waitFor(
      () => {
        expect(firstAttemptStarted).toBe(true);
      },
      { timeout: 10_000, interval: 100 },
    );
    await dying.stop({ graceful: false, timeoutMs: 1000 });

    const survivor = await startWorker({
      boss: createBoss(database.appUrl, { max: 2, supervise: true, superviseIntervalSeconds: 1 }),
      role: "general",
      handlers: { "provider-event.process": (job) => Promise.resolve(redelivered(job.data)) },
      logger,
      pollingIntervalSeconds: 0.5,
    });
    running.push(survivor);

    await vi.waitFor(
      () => {
        expect(redelivered).toHaveBeenCalledWith({ inboxId: "e1" });
      },
      {
        timeout: 20_000,
        interval: 200,
      },
    );
  });

  it("registers cron schedules only in processes with the scheduler role", async () => {
    const general = createBoss(database.appUrl, { max: 2 });
    running.push(await startWorker({ boss: general, role: "general", handlers: {}, logger }));
    expect(await general.getSchedules()).toEqual([]);

    const scheduler = createBoss(database.appUrl, { max: 2 });
    running.push(await startWorker({ boss: scheduler, role: "all", handlers: {}, logger }));
    const names = (await scheduler.getSchedules()).map((s) => s.key);
    expect(names).toEqual(
      expect.arrayContaining([
        "meeting-tick",
        "admissions.offer-sweep",
        "video.availability-check",
      ]),
    );
  });
});
