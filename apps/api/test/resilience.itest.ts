import type { Video } from "@glim/contracts";
import { Db } from "@glim/db";
import { FAKE_CHANNEL_URL } from "@glim/integrations/video-host/fake";
import { AvailabilityService } from "@glim/modules/video";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Personas } from "./personas";

/**
 * Failure injection (TRD §21.4, ticket 46): YouTube unreachable, a worker dying mid-job, and
 * Postgres dropping every connection. Nothing may be lost and the API must carry on.
 */

let t: TestApp;
let p: Personas;
let video: Video;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("UPDATE settings SET youtube_channel_urls = $1", [[FAKE_CHANNEL_URL]]);
  const added = await t.request({
    method: "POST",
    url: `/api/v1/course-offerings/${p.world.offerings.O1}/videos`,
    headers: { ...p.l1Primary.headers, "idempotency-key": idempotencyKey() },
    payload: { youtubeUrl: "https://youtu.be/resilient01" },
  });
  expect(added.statusCode, added.body).toBe(201);
  video = added.json<Video>();
  await t.request({
    method: "POST",
    url: `/api/v1/videos/${video.id}/publish`,
    headers: { ...p.l1Primary.headers, "idempotency-key": idempotencyKey() },
  });
});

afterAll(async () => {
  t.videoHost.down = false;
  await t.close();
});

describe("YouTube unreachable", () => {
  it("doesn't stop students watching, and the availability sweep fails to be retried later", async () => {
    t.videoHost.down = true;
    try {
      // Playing never calls YouTube: it works while YouTube is down.
      const play = await t.request({
        url: `/api/v1/videos/${video.id}/play`,
        headers: p.sEnrolled.headers,
      });
      expect(play.statusCode, play.body).toBe(200);
      // The sweep throws (so pg-boss retries it) and marks nothing unavailable.
      await expect(t.app.get(AvailabilityService).checkAll()).rejects.toThrow();
      const row = await q<{ status: string }>("SELECT status FROM videos WHERE id = $1", [
        video.id,
      ]);
      expect(row.rows[0]?.status).toBe("PUBLISHED");
    } finally {
      t.videoHost.down = false;
    }
  });
});

describe("a worker dying mid-job", () => {
  it("leaves the job to be retried: a handler that crashes doesn't lose it", async () => {
    const id = await t.boss.send(
      "notify.send",
      { notificationId: "resilience-1" },
      { retryLimit: 2 },
    );
    const [first] = await t.boss.fetch<{ notificationId: string }>("notify.send");
    expect(first?.id).toBe(id);
    // The handler crashed: pg-boss records the failure and schedules a retry, keeping the payload.
    await t.boss.fail("notify.send", id ?? "", { message: "worker killed" });
    const after = await q<{ state: string; data: object }>(
      "SELECT state, data FROM pgboss.job WHERE id = $1",
      [id],
    );
    expect(after.rows[0]).toEqual({ state: "retry", data: { notificationId: "resilience-1" } });
  });

  it("never has a job for work that was rolled back, and always has one for work that committed", async () => {
    await expect(
      t.app.get(Db).withTx(async ({ boss }) => {
        await boss.send("notify.send", { notificationId: "rolled-back" });
        throw new Error("the request failed after enqueuing");
      }),
    ).rejects.toThrow();
    await t.app.get(Db).withTx(({ boss }) => boss.send("notify.send", { notificationId: "kept" }));
    const jobs = await q<{ id: string }>(
      "SELECT data->>'notificationId' AS id FROM pgboss.job WHERE name = 'notify.send'",
    );
    const ids = jobs.rows.map((r) => r.id);
    expect(ids).toContain("kept");
    expect(ids).not.toContain("rolled-back");
  });
});

describe("Postgres dropping every connection (a restart)", () => {
  it("reconnects: the next requests and jobs work, and no error escapes", async () => {
    const killed = await q<{ n: number }>(
      `SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()`,
    );
    expect(killed.rows[0]?.n).toBeGreaterThan(0);
    // The first attempt on a dead pooled connection may fail; the pool replaces it.
    let status = 0;
    for (let attempt = 0; attempt < 3 && status !== 200; attempt++)
      status = (await t.request({ url: "/api/v1/me", headers: p.sEnrolled.headers })).statusCode;
    expect(status).toBe(200);
    const id = await t.boss.send("notify.send", { notificationId: "after-restart" });
    expect(id).not.toBeNull();
    const ready = await t.request({ url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    // pg-boss's dropped connections were reported to its listener rather than thrown.
    expect(t.bossErrors.length).toBeGreaterThan(0);
  });
});
