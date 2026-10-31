import type { DomainEvent } from "@glim/contracts";
import { createBoss, createPool, Db, schema } from "@glim/db";
import { createTestDatabase, drainQueues, type TestDatabase } from "@glim/db/testing";
import { TestClock } from "@glim/shared";
import { createLogger } from "@glim/telemetry";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { createHandlers } from "../src/handlers";
import { createSubscribers } from "../src/subscribers";
import { startWorker, type RunningWorker } from "../src/worker";
import { createWorkerContext } from "../src/worker.module";

const logger = createLogger({ service: "worker-test", level: "silent" });
const clock = new TestClock("2026-11-02T09:00:00Z");

let database: TestDatabase;
let db: Db;
let sendBoss: ReturnType<typeof createBoss>;
let context: Awaited<ReturnType<typeof createWorkerContext>>;
const running: RunningWorker[] = [];

beforeAll(async () => {
  database = await createTestDatabase(inject("glim").postgresAdminUrl);
  sendBoss = createBoss(database.appUrl, { max: 2 });
  await sendBoss.start();
  db = new Db(createPool(database.appUrl, 2), sendBoss);
  context = await createWorkerContext({ db, clock, logger });
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((w) => w.stop({ graceful: false, timeoutMs: 1000 })));
});

afterAll(async () => {
  await context.close();
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
        context,
        subscribers: {
          "academic.offering.completed": [(e) => Promise.resolve(void received.push(e))],
        },
      }),
      logger,
      pollingIntervalSeconds: 0.5,
    });
    running.push(worker);

    await db.withTx(({ boss }) =>
      boss.publish(
        "academic.offering.completed",
        { offeringId: "00000000-0000-7000-8000-000000000003" },
        { occurredAt: new Date() },
      ),
    );

    await vi.waitFor(
      () => {
        expect(received).toHaveLength(1);
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(received[0]?.payload).toEqual({ offeringId: "00000000-0000-7000-8000-000000000003" });
  });

  it("completes offerings past their last day on the daily academic.offering-lifecycle job", async () => {
    const one = async (text: string, values: unknown[] = []) =>
      (await db.pool.query<{ id: string }>(text, values)).rows[0]?.id;
    const programme = await one(
      "INSERT INTO programmes (code, name) VALUES ('WDIP', 'W') RETURNING id",
    );
    const course = await one(
      "INSERT INTO courses (code, title, credits) VALUES ('W101', 'W', 3) RETURNING id",
    );
    const intake = await one(
      `INSERT INTO intakes (code, opens_on, closes_on, starts_on, status)
       VALUES ('2026-W', '2025-01-01', '2025-02-01', '2026-01-01', 'CLOSED') RETURNING id`,
    );
    const cohort = await one(
      "INSERT INTO cohorts (programme_id, intake_id, code, name) VALUES ($1, $2, 'WDIP-2026', 'W') RETURNING id",
      [programme, intake],
    );
    const offering = await one(
      `INSERT INTO course_offerings (course_id, cohort_id, starts_on, ends_on, exam_on, status)
       VALUES ($1, $2, '2026-10-01', '2026-10-31', '2026-10-31', 'ACTIVE') RETURNING id`,
      [course, cohort],
    );
    await db.withTx(({ boss }) => boss.send("academic.offering-lifecycle", {}));
    const handlers = createHandlers({ context, subscribers: createSubscribers(context) });
    await drainQueues(sendBoss, handlers);
    const { rows } = await db.pool.query<{ status: string }>(
      "SELECT status FROM course_offerings WHERE id = $1",
      [offering],
    );
    // The clock reads 2 November 2026 in Lagos.
    expect(rows[0]?.status).toBe("COMPLETED");
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

  it("registers cron only in scheduler processes, and only for queues it has a handler for", async () => {
    const general = createBoss(database.appUrl, { max: 2 });
    running.push(await startWorker({ boss: general, role: "general", handlers: {}, logger }));
    expect(await general.getSchedules()).toEqual([]);

    const scheduler = createBoss(database.appUrl, { max: 2 });
    running.push(
      await startWorker({
        boss: scheduler,
        role: "all",
        handlers: { "auth.session-cleanup": () => Promise.resolve() },
        logger,
      }),
    );
    expect((await scheduler.getSchedules()).map((s) => s.key)).toEqual(["auth.session-cleanup"]);
  });
});

describe("auth.session-cleanup", () => {
  it("deletes sessions that ended more than a week ago and keeps the rest", async () => {
    const handlers = createHandlers({ subscribers: {}, context });
    const [user] = await db.read
      .insert(schema.users)
      .values({ email: "s@glim.test", displayName: "S", status: "ACTIVE" })
      .returning();
    const userId = user?.id ?? "";
    const day = 86_400_000;
    const now = clock.now().getTime();
    const session = (n: number, ends: number, revoked: number | null) => ({
      userId,
      tokenHash: Buffer.from(`token-${String(n)}`),
      csrfSecret: Buffer.from("x"),
      createdAt: new Date(ends - day),
      lastSeenAt: new Date(ends - day),
      expiresAt: new Date(ends),
      idleExpiresAt: new Date(ends),
      revokedAt: revoked === null ? null : new Date(revoked),
    });
    await db.read.insert(schema.authSessions).values([
      session(1, now - 8 * day, null), // expired 8 days ago: deleted
      session(2, now + day, now - 9 * day), // revoked 9 days ago: deleted
      session(3, now - 2 * day, null), // expired 2 days ago: kept
      session(4, now + day, null), // live: kept
    ]);

    await db.withTx(({ boss }) => boss.send("auth.session-cleanup", {}));
    await drainQueues(sendBoss, handlers);

    const left = await db.read
      .select({ hash: schema.authSessions.tokenHash })
      .from(schema.authSessions);
    expect(left.map((r) => r.hash.toString()).sort()).toEqual(["token-3", "token-4"]);
  });
});
