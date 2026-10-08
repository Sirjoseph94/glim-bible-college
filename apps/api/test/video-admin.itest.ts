import type { AdminVideo, PlaybackProgress, Video, VideoPlayback } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { FAKE_CHANNEL_URL } from "@glim/integrations/video-host/fake";
import { NotificationsService } from "@glim/modules/notifications";
import { AVAILABILITY_BATCH, AvailabilityService, VideoAdminService } from "@glim/modules/video";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type PersonaName, type Personas } from "./personas";

/**
 * Video administration and availability (TRD §13.3, §13.6; AC-19). The System Admin manages
 * every video; YouTube is the fake, scripted per video id.
 */

let t: TestApp;
let p: Personas;
const yt = (n: number) => `adm${String(n).padStart(8, "0")}`;

interface ErrorBody {
  error: { code: string };
}

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

async function add(n: number, as: PersonaName = "l1Primary"): Promise<Video> {
  const res = await t.request({
    method: "POST",
    url: `/api/v1/course-offerings/${p.world.offerings.O1}/videos`,
    headers: { ...p[as].headers, "idempotency-key": idempotencyKey() },
    payload: { youtubeUrl: `https://youtu.be/${yt(n)}`, title: `Lecture ${String(n)}` },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<Video>();
}

const call = (
  as: PersonaName,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) =>
  t.request({
    method,
    url: `/api/v1${url}`,
    headers: p[as].headers,
    ...(payload === undefined ? {} : { payload }),
  });

const studentTitles = async () =>
  (await call("sEnrolled", "GET", `/course-offerings/${p.world.offerings.O1}/videos`))
    .json<{ items: Video[] }>()
    .items.map((v) => v.title);

async function refreshSessions() {
  for (const name of Object.keys(p).filter((k) => k !== "world") as PersonaName[])
    p[name].headers = await sessionFor(t, p[name].userId);
}

async function deliverEmails() {
  await drainQueues(t.boss, {
    "notify.send": (job) =>
      t.app
        .get(NotificationsService)
        .deliver((job.data as { notificationId: string }).notificationId),
  });
}

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("UPDATE settings SET youtube_channel_urls = $1", [[FAKE_CHANNEL_URL]]);
});

afterAll(async () => {
  await t.close();
});

describe("the System Admin's video list", () => {
  it("lists every video with its course, Studio link, unavailable first, with filters", async () => {
    const a = await add(1);
    const b = await add(2);
    await q(
      "UPDATE videos SET status = 'UNAVAILABLE', status_before_unavailable = 'PUBLISHED' WHERE id = $1",
      [a.id],
    );
    const res = await call("sysAdmin", "GET", "/admin/videos");
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json<{ items: AdminVideo[] }>().items;
    expect(items.map((v) => v.id)).toEqual([a.id, b.id]);
    expect(items[1]).toMatchObject({
      origin: "LINK",
      courseCode: expect.any(String) as string,
      studioUrl: `https://studio.youtube.com/video/${yt(2)}/edit`,
    });
    const filtered = await call("sysAdmin", "GET", "/admin/videos?status=PUBLISHED&limit=1");
    expect(filtered.json<{ items: AdminVideo[] }>().items.map((v) => v.id)).toEqual([b.id]);
    const other = await call("sysAdmin", "GET", `/admin/videos?offeringId=${p.world.offerings.O2}`);
    expect(other.json<{ items: AdminVideo[] }>().items).toEqual([]);
    await q(
      "UPDATE videos SET status = 'PUBLISHED', status_before_unavailable = NULL WHERE id = $1",
      [a.id],
    );
  });

  it("pages through with a cursor", async () => {
    const first = await call("sysAdmin", "GET", "/admin/videos?limit=1");
    const { items, nextCursor } = first.json<{ items: AdminVideo[]; nextCursor: string | null }>();
    expect(nextCursor).not.toBeNull();
    const second = await call(
      "sysAdmin",
      "GET",
      `/admin/videos?limit=1&cursor=${encodeURIComponent(nextCursor ?? "")}`,
    );
    const next = second.json<{ items: AdminVideo[] }>().items;
    expect(next).toHaveLength(1);
    expect(next[0]?.id).not.toBe(items[0]?.id);
  });

  it("is for the System Admin only", async () => {
    for (const who of ["acadAdmin", "l1Primary", "registrar", "sEnrolled"] as const)
      expect((await call(who, "GET", "/admin/videos")).statusCode, who).toBe(403);
  });
});

describe("replacing a link", () => {
  it("checks the new link and keeps the video's place; progress on another length resets", async () => {
    const v = await add(3);
    // The student watched 40 of 60 minutes of the old video.
    await call("sEnrolled", "PATCH", `/videos/${v.id}/progress`, {
      positionMs: 2_400_000,
      durationMs: 3_600_000,
      seq: 1,
    });

    t.videoHost.script(yt(90), { status: "PRIVATE_OR_RESTRICTED" });
    const refused = await call("sysAdmin", "PUT", `/videos/${v.id}/youtube-link`, {
      youtubeUrl: `https://youtu.be/${yt(90)}`,
    });
    expect(refused.json<ErrorBody>().error.code).toBe("YOUTUBE_VIDEO_PRIVATE");
    const taken = await call("sysAdmin", "PUT", `/videos/${v.id}/youtube-link`, {
      youtubeUrl: `https://youtu.be/${yt(1)}`,
    });
    expect(taken.statusCode).toBe(409);

    const res = await call("sysAdmin", "PUT", `/videos/${v.id}/youtube-link`, {
      youtubeUrl: `https://www.youtube.com/watch?v=${yt(4)}`,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<AdminVideo>()).toMatchObject({
      id: v.id,
      title: "Lecture 3",
      position: v.position,
      youtubeVideoId: yt(4),
      durationMs: null,
      status: "PUBLISHED",
    });
    const audit = await q<{ metadata: { from: string; to: string } }>(
      "SELECT metadata FROM audit_logs WHERE action = 'video.asset.link-replaced'",
    );
    expect(audit.rows[0]?.metadata).toEqual({ from: yt(3), to: yt(4) });

    // Still resumes until the new length is known; a 30-minute video then starts over.
    const before = await call("sEnrolled", "GET", `/videos/${v.id}/play`);
    expect(before.json<VideoPlayback>().resumeMs).toBe(2_400_000);
    t.clock.advance({ seconds: 10 });
    const report = await call("sEnrolled", "PATCH", `/videos/${v.id}/progress`, {
      positionMs: 5000,
      durationMs: 1_800_000,
      seq: 2,
    });
    expect(report.json<PlaybackProgress>()).toEqual({
      positionMs: 5000,
      maxPositionMs: 5000,
      durationMs: 1_800_000,
      completed: false,
    });
  });

  it("keeps progress when the new video is within 5 % of the old length", async () => {
    const v = await add(5);
    await call("sEnrolled", "PATCH", `/videos/${v.id}/progress`, {
      positionMs: 1_000_000,
      durationMs: 3_600_000,
      seq: 1,
    });
    await call("sysAdmin", "PUT", `/videos/${v.id}/youtube-link`, {
      youtubeUrl: `https://youtu.be/${yt(6)}`,
    });
    t.clock.advance({ seconds: 10 });
    const report = await call("sEnrolled", "PATCH", `/videos/${v.id}/progress`, {
      positionMs: 1_100_000,
      durationMs: 3_500_000,
      seq: 2,
    });
    expect(report.json<PlaybackProgress>()).toMatchObject({
      maxPositionMs: 1_100_000,
      durationMs: 3_500_000,
    });
  });

  it("is for the System Admin only", async () => {
    const v = await add(7);
    for (const who of ["acadAdmin", "l1Primary"] as const)
      expect(
        (
          await call(who, "PUT", `/videos/${v.id}/youtube-link`, {
            youtubeUrl: "https://youtu.be/x",
          })
        ).statusCode,
        who,
      ).toBe(404);
  });
});

describe("deleting and restoring", () => {
  it("hides at once and restores within 7 days, as it was (AC-19)", async () => {
    const v = await add(8);
    await call("l1Primary", "POST", `/videos/${v.id}/unpublish`);
    const res = await call("sysAdmin", "DELETE", `/videos/${v.id}`);
    expect(res.statusCode, res.body).toBe(200);
    const deleted = res.json<AdminVideo>();
    expect(deleted.status).toBe("DELETED");
    expect(new Date(deleted.deleteAfter ?? "").getTime()).toBe(
      t.clock.now().getTime() + 7 * 86_400_000,
    );
    expect((await call("l1Primary", "GET", `/videos/${v.id}`)).statusCode).toBe(404);
    expect((await call("sysAdmin", "DELETE", `/videos/${v.id}`)).statusCode).toBe(200);
    const events = await q<{ n: string }>(
      "SELECT count(*) AS n FROM pgboss.job WHERE name = 'domain-event' AND data->>'name' = 'video.deleted'",
    );
    expect(Number(events.rows[0]?.n)).toBe(1);

    const restored = await call("sysAdmin", "POST", `/videos/${v.id}/restore`);
    expect(restored.json<AdminVideo>()).toMatchObject({ status: "UNPUBLISHED", deleteAfter: null });
    const actions = await q<{ action: string }>(
      "SELECT action FROM audit_logs WHERE resource_id = $1 ORDER BY created_at, id",
      [v.id],
    );
    expect(actions.rows.map((r) => r.action)).toEqual([
      "video.asset.added",
      "video.asset.unpublished",
      "video.asset.deleted",
      "video.asset.restored",
    ]);
  });

  it("frees the link for adding again, and then refuses the restore", async () => {
    const v = await add(9);
    await call("sysAdmin", "DELETE", `/videos/${v.id}`);
    await add(9);
    const res = await call("sysAdmin", "POST", `/videos/${v.id}/restore`);
    expect(res.statusCode).toBe(409);
  });

  it("finishes the delete after 7 days and reminds the System Admin about YouTube Studio", async () => {
    const v = await add(10);
    await call("sEnrolled", "PATCH", `/videos/${v.id}/progress`, {
      positionMs: 1000,
      durationMs: 60_000,
      seq: 1,
    });
    await call("sysAdmin", "DELETE", `/videos/${v.id}`);
    const purge = () => t.app.get(VideoAdminService).purgeDeleted();
    expect(await purge()).toBe(0);
    t.clock.advance({ days: 7, seconds: 1 });
    await refreshSessions();
    expect((await call("sysAdmin", "POST", `/videos/${v.id}/restore`)).statusCode).toBe(409);
    expect(await purge()).toBeGreaterThanOrEqual(1);
    expect(await purge()).toBe(0);
    const progress = await q<{ n: string }>(
      "SELECT count(*) AS n FROM playback_progress WHERE video_id = $1",
      [v.id],
    );
    expect(Number(progress.rows[0]?.n)).toBe(0);
    await deliverEmails();
    const mail = t.mailer.sent.find(
      (m) => m.to === p.sysAdmin.email && m.subject === 'Delete "Lecture 10" in YouTube Studio',
    );
    expect(mail?.text).toContain(`https://studio.youtube.com/video/${yt(10)}/edit`);
  });

  it("is for the System Admin only", async () => {
    const v = await add(11);
    for (const who of ["acadAdmin", "l1Primary", "sEnrolled"] as const)
      expect((await call(who, "DELETE", `/videos/${v.id}`)).statusCode, who).toBe(404);
  });
});

describe("availability", () => {
  it("hides a video YouTube stops serving and tells whoever added it and the System Admin", async () => {
    const v = await add(20, "l2Co");
    expect(await studentTitles()).toContain("Lecture 20");
    t.videoHost.script(yt(20), { status: "NOT_FOUND" });
    const result = await t.app.get(AvailabilityService).checkAll();
    expect(result.unavailable).toBe(1);
    expect(result.checked).toBeGreaterThan(1);
    expect(await studentTitles()).not.toContain("Lecture 20");
    expect((await call("sEnrolled", "GET", `/videos/${v.id}/play`)).statusCode).toBe(404);
    const row = await q<{ status: string; unavailable_reason: string }>(
      "SELECT status, unavailable_reason FROM videos WHERE id = $1",
      [v.id],
    );
    expect(row.rows[0]).toEqual({ status: "UNAVAILABLE", unavailable_reason: "NOT_FOUND" });
    await deliverEmails();
    for (const who of [p.l2Co.email, p.sysAdmin.email])
      expect(t.mailer.lastTo(who)?.subject).toMatch(/recording unavailable: Lecture 20$/);
    // The next daily run leaves it alone: it's already unavailable.
    expect((await t.app.get(AvailabilityService).checkAll()).unavailable).toBe(0);
  });

  it("restores it as it was when a recheck succeeds", async () => {
    const [v] = (
      await q<{ id: string }>("SELECT id FROM videos WHERE youtube_video_id = $1", [yt(20)])
    ).rows;
    if (v === undefined) throw new Error("no video");
    const still = await call("l2Co", "POST", `/videos/${v.id}/recheck`);
    expect(still.json<Video>().status).toBe("UNAVAILABLE");
    const publish = await t.request({
      method: "POST",
      url: `/api/v1/videos/${v.id}/publish`,
      headers: { ...p.l2Co.headers, "idempotency-key": idempotencyKey() },
    });
    expect(publish.json<ErrorBody>().error.code).toBe("VIDEO_NOT_AVAILABLE");

    t.videoHost.script(yt(20), { status: "AVAILABLE", title: "x", channelUrl: FAKE_CHANNEL_URL });
    const back = await call("l2Co", "POST", `/videos/${v.id}/recheck`);
    expect(back.json<Video>().status).toBe("PUBLISHED");
    expect(await studentTitles()).toContain("Lecture 20");
  });

  it("says when YouTube can't be checked; the daily job throws so it's retried", async () => {
    const v = await add(21);
    t.videoHost.down = true;
    const res = await call("l1Primary", "POST", `/videos/${v.id}/recheck`);
    await expect(t.app.get(AvailabilityService).checkAll()).rejects.toThrow();
    t.videoHost.down = false;
    expect(res.statusCode).toBe(503);
  });

  it("checks every video, beyond one batch", async () => {
    const before = await q<{ n: string }>(
      "SELECT count(*) AS n FROM videos WHERE status IN ('PUBLISHED', 'UNPUBLISHED')",
    );
    await q(
      `INSERT INTO videos (course_offering_id, origin, title, status, youtube_video_id)
       SELECT $1, 'LINK', 'Bulk ' || g, 'PUBLISHED', 'blk' || lpad(g::text, 8, '0')
         FROM generate_series(1, $2) g`,
      [p.world.offerings.O2, AVAILABILITY_BATCH + 5],
    );
    const result = await t.app.get(AvailabilityService).checkAll();
    expect(result.checked).toBe(Number(before.rows[0]?.n) + AVAILABILITY_BATCH + 5);
  });

  it("lets the course's Primary and Co-lecturers and admins recheck, nobody else", async () => {
    const v = await add(22);
    for (const who of ["l3Assistant", "l4Other", "sEnrolled", "registrar"] as const)
      expect((await call(who, "POST", `/videos/${v.id}/recheck`)).statusCode, who).toBe(404);
    expect((await call("acadAdmin", "POST", `/videos/${v.id}/recheck`)).statusCode).toBe(200);
  });
});
