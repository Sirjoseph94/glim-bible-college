import type { OpsFailure, QueueStat, Video, YouTubeStatus } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { FAKE_CHANNEL_URL } from "@glim/integrations/video-host/fake";
import { OpsService } from "@glim/modules/ops";
import { AvailabilityService } from "@glim/modules/video";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/** The ops page and job dashboard (TRD §15.3, §20.1): System Admin only. */

let t: TestApp;
let p: Personas;
let video: Video;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

const send = (as: PersonaName, method: "GET" | "POST", url: string, payload?: unknown) =>
  t.request({
    method,
    url: `/api/v1${url}`,
    headers: {
      ...p[as].headers,
      ...(method === "POST" ? { "idempotency-key": idempotencyKey() } : {}),
    },
    ...(payload === undefined ? {} : { payload }),
  });

const failures = async () =>
  (await send("sysAdmin", "GET", "/admin/ops/failures")).json<{ items: OpsFailure[] }>().items;

let failedJobId = "";

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("UPDATE settings SET youtube_channel_urls = $1", [[FAKE_CHANNEL_URL]]);
  const added = await send(
    "l1Primary",
    "POST",
    `/course-offerings/${p.world.offerings.O1}/videos`,
    {
      youtubeUrl: "https://youtu.be/opsvideo001",
    },
  );
  video = added.json<Video>();
  await q(
    "UPDATE videos SET status = 'UNAVAILABLE', unavailable_reason = 'PRIVATE' WHERE id = $1",
    [video.id],
  );
  await q(
    `INSERT INTO provider_events (provider, event_id, event_type, payload, status, last_error)
     VALUES ('sendgrid', 'ops-1', 'bounce', '{}', 'FAILED', 'boom')`,
  );
  await q("UPDATE users SET email_status = 'BOUNCED' WHERE id = $1", [p.sOther.userId]);
  // A job that ran out of retries.
  await t.boss.send("identity.invite", { userId: p.sOther.userId }, { retryLimit: 0 });
  const [job] = await t.boss.fetch<object>("identity.invite");
  if (job === undefined) throw new Error("no job");
  failedJobId = job.id;
  await t.boss.fail("identity.invite", job.id, { message: "SMTP said no" });
});

afterAll(async () => {
  await t.close();
});

describe("failures", () => {
  it("lists every kind in one place, for the System Admin only", async () => {
    const items = await failures();
    expect(items.map((f) => f.kind).sort()).toEqual(["email", "job", "provider-event", "video"]);
    expect(items.find((f) => f.kind === "job")).toMatchObject({
      id: failedJobId,
      label: "identity.invite",
      detail: "SMTP said no",
      replayable: true,
    });
    expect(items.find((f) => f.kind === "video")).toMatchObject({
      status: "UNAVAILABLE",
      detail: "PRIVATE",
    });
    for (const as of ["acadAdmin", "registrar", "l1Primary", "sEnrolled"] as const)
      expect((await send(as, "GET", "/admin/ops/failures")).statusCode).toBe(403);
  });

  it("replays each kind, audited", async () => {
    const event = (await failures()).find((f) => f.kind === "provider-event");
    expect(
      (await send("sysAdmin", "POST", `/admin/ops/replay/provider-event/${event?.id ?? ""}`))
        .statusCode,
    ).toBe(202);
    const pe = await q<{ status: string }>(
      "SELECT status FROM provider_events WHERE event_id = 'ops-1'",
    );
    expect(pe.rows[0]?.status).toBe("RECEIVED");

    expect((await send("sysAdmin", "POST", `/admin/ops/replay/video/${video.id}`)).statusCode).toBe(
      202,
    );
    const videoJobs = await q<{ data: { videoId: string } }>(
      "SELECT data FROM pgboss.job WHERE name = 'video.availability-check'",
    );
    expect(videoJobs.rows.map((r) => r.data.videoId)).toContain(video.id);

    expect(
      (await send("sysAdmin", "POST", `/admin/ops/replay/job/${failedJobId}`)).statusCode,
    ).toBe(202);
    const resent = await q<{ state: string }>(
      "SELECT state FROM pgboss.job WHERE name = 'identity.invite' AND id <> $1",
      [failedJobId],
    );
    expect(resent.rows.map((r) => r.state)).toEqual(["created"]);

    expect(
      (await send("sysAdmin", "POST", `/admin/ops/replay/email/${p.sOther.userId}`)).statusCode,
    ).toBe(202);
    const user = await q<{ email_status: string }>("SELECT email_status FROM users WHERE id = $1", [
      p.sOther.userId,
    ]);
    expect(user.rows[0]?.email_status).toBe("OK");

    expect(
      (await send("sysAdmin", "POST", "/admin/ops/replay/meeting-provision/x")).statusCode,
    ).toBe(404);
    expect(
      (await send("sysAdmin", "POST", "/admin/ops/replay/job/01900000-0000-7000-8000-000000000000"))
        .statusCode,
    ).toBe(404);
    const audit = await q<{ resource_type: string }>(
      "SELECT resource_type FROM audit_logs WHERE action = 'ops.replayed' ORDER BY created_at",
    );
    expect(audit.rows.map((r) => r.resource_type)).toEqual([
      "provider-event",
      "video",
      "job",
      "email",
    ]);
    expect(
      (await send("acadAdmin", "POST", `/admin/ops/replay/email/${p.sOther.userId}`)).statusCode,
    ).toBe(403);
  });

  it("rechecks a replayed video through the job", async () => {
    await drainQueues(t.boss, {
      "video.availability-check": async (job) => {
        const { videoId, actorUserId } = job.data as { videoId: string; actorUserId: string };
        await t.app
          .get(AvailabilityService)
          .recheck(videoId, { type: "USER", userId: actorUserId });
      },
    });
    const row = await q<{ status: string }>("SELECT status FROM videos WHERE id = $1", [video.id]);
    // Back to how it was before YouTube stopped serving it (it was never published).
    expect(row.rows[0]?.status).toBe("UNPUBLISHED");
  });
});

describe("the job dashboard", () => {
  it("shows each queue's depth and the age of its oldest waiting job", async () => {
    await t.boss.send("notify.send", { notificationId: "01900000-0000-7000-8000-000000000001" });
    await q(
      "UPDATE pgboss.job SET created_on = now() - interval '5 minutes' WHERE name = 'notify.send'",
    );
    const items = (await send("sysAdmin", "GET", "/admin/jobs")).json<{ items: QueueStat[] }>()
      .items;
    const queue = items.find((x) => x.name === "notify.send");
    expect(queue).toMatchObject({ queued: 1, behind: true });
    expect(queue?.oldestQueuedSeconds).toBeGreaterThanOrEqual(299);
    expect(items.find((x) => x.name === "identity.invite")).toMatchObject({ failedLastDay: 1 });
  });

  it("emails the System Admin when a queue falls behind, once an hour", async () => {
    const service = t.app.get(OpsService);
    expect(await service.checkQueues()).toContain("notify.send");
    await service.checkQueues();
    const alerts = await q<{ email_status: string }>(
      "SELECT email_status FROM notifications WHERE kind = 'ops.queue-backlog' AND user_id = $1",
      [p.sysAdmin.userId],
    );
    expect(alerts.rows).toEqual([{ email_status: "PENDING" }]);
  });
});

describe("YouTube status", () => {
  it("checks in the background: oEmbed reachable and each channel URL resolving", async () => {
    expect((await send("sysAdmin", "GET", "/admin/integrations/youtube/status")).json()).toEqual({
      status: null,
      // The fake host can act as a channel; none is connected (integration slice).
      channel: {
        uploadsEnabled: true,
        connected: false,
        status: null,
        channel: null,
        lastError: null,
      },
    });
    await q("UPDATE settings SET youtube_channel_urls = $1", [
      [FAKE_CHANNEL_URL, "https://www.youtube.com/@not-glim"],
    ]);
    expect((await send("sysAdmin", "POST", "/admin/integrations/youtube/test")).statusCode).toBe(
      202,
    );
    const service = t.app.get(OpsService);
    await drainQueues(t.boss, { "ops.youtube-check": () => service.runYoutubeCheck() });
    const status = (await send("sysAdmin", "GET", "/admin/integrations/youtube/status")).json<{
      status: YouTubeStatus;
    }>().status;
    expect(status).toMatchObject({ ok: false, reachable: true });
    expect(status.channels.map((c) => [c.url, c.resolves])).toEqual([
      [FAKE_CHANNEL_URL, true],
      ["https://www.youtube.com/@not-glim", false],
    ]);
    expect((await send("acadAdmin", "GET", "/admin/integrations/youtube/status")).statusCode).toBe(
      403,
    );
  });
});
