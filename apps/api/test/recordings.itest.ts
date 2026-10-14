import type { AdminVideo, ClassMeeting, QueueName } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { FakeLiveProvider } from "@glim/integrations/live-provider/fake";
import { MeetWorld } from "@glim/integrations/live-provider/world";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService, MeetEventsService } from "@glim/modules/class-meeting";
import { InboxService, IntegrationsService } from "@glim/modules/ops";
import { RecordingsService, VideoAdminService, VideosService } from "@glim/modules/video";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandlers } from "../../worker/src/handlers";
import { createSubscribers } from "../../worker/src/subscribers";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type Personas } from "./personas";

/**
 * Meet recordings to YouTube (TRD §13.2–13.3, INV-9; integration slice), through the worker's
 * handlers, over the in-memory Meet and the fake channel. The channel is connected unless a test
 * says otherwise; the fake reports a 60-minute upload unless told otherwise.
 */

let t: TestApp;
let p: Personas;
let world: MeetWorld;
let provider: FakeLiveProvider;
let handlers: ReturnType<typeof createHandlers>;
const HOST = "lms-host-01@glim.test";
const HOUR = 3_600_000;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);
const channel = () => t.videoHost.channelApi;

async function settle(): Promise<void> {
  const pulled = await provider.pullEvents(100);
  await t.app.get(InboxService).receive(
    "google_meet",
    pulled.map((x) => t.app.get(MeetEventsService).toInbox(x.envelope)),
  );
  await provider.ackEvents(pulled.map((x) => x.ackId));
  const run = Object.fromEntries(
    (Object.keys(handlers) as QueueName[])
      .filter((queue) => !queue.startsWith("db.") && queue !== "ops.queue-health")
      .map((queue) => [queue, handlers[queue]]),
  );
  await drainQueues(t.boss, run, { ignoreStartAfter: true, maxRounds: 300 });
}

/** A class whose call ran 09:00–10:00, then a recording of it lands in Drive. */
async function recordedClass(
  day: string,
  recording: { bytes?: Buffer; durationMs?: number | null } = {},
  options: { recordingMode?: "AUTO" | "OFF"; dropEvents?: boolean } = {},
) {
  t.clock.set(`${day}T06:00:00Z`);
  const meeting: ClassMeeting = unwrap(
    await t.app.get(ClassMeetingsService).create(
      p.world.offerings.O1,
      {
        title: `Lecture ${day}`,
        scheduledStart: `${day}T09:00:00Z`,
        scheduledEnd: `${day}T10:00:00Z`,
        recordingMode: options.recordingMode ?? "AUTO",
      },
      { ...SYSTEM_ACTOR, userId: p.acadAdmin.userId },
    ),
  ).meeting;
  await settle();
  const spaceId =
    (
      await q<{ s: string }>("SELECT provider_space_id AS s FROM class_meetings WHERE id = $1", [
        meeting.id,
      ])
    ).rows[0]?.s ?? "";
  world.dropPending();
  const conferenceId = world.startConference(spaceId, new Date(`${day}T09:00:00Z`));
  t.clock.set(`${day}T10:05:00Z`);
  world.endConference(conferenceId, new Date(`${day}T10:00:00Z`));
  const file = world.addRecording(conferenceId, {
    bytes: recording.bytes ?? Buffer.from(`recording of ${day}`),
    durationMs: recording.durationMs === undefined ? HOUR : recording.durationMs,
    startedAt: new Date(`${day}T09:00:00Z`),
  });
  if (options.dropEvents === true) {
    // The conference events still matter; only the recording's is lost.
    const pulled = await provider.pullEvents(100);
    const keep = pulled.filter((x) => provider.parseEvent(x.envelope)?.type !== "RECORDING_READY");
    await t.app.get(InboxService).receive(
      "google_meet",
      keep.map((x) => t.app.get(MeetEventsService).toInbox(x.envelope)),
    );
    await provider.ackEvents(pulled.map((x) => x.ackId));
  }
  return { meeting, conferenceId, file };
}

const videoOf = async (meetingId: string) =>
  (
    await q<{
      id: string;
      status: string;
      origin: string;
      title: string;
      youtube_video_id: string | null;
      duration_ms: string | null;
      recording_status: string;
      error_code: string | null;
    }>(
      `SELECT v.id, v.status, v.origin, v.title, v.youtube_video_id, v.duration_ms,
              r.status AS recording_status, r.last_error_code AS error_code
         FROM videos v JOIN recordings r ON r.id = v.recording_id
        WHERE v.class_meeting_id = $1`,
      [meetingId],
    )
  ).rows[0];

/**
 * The meeting's `recording` in the student's list of O1's Class Meetings. Signs sEnrolled in
 * afresh first (and keeps the new headers): the clock has moved past their last sign-in.
 */
async function recordingSeenBySEnrolled(meetingId: string) {
  p.sEnrolled.headers = await sessionFor(t, p.sEnrolled.userId);
  const list = await t.request({
    url: `/api/v1/course-offerings/${p.world.offerings.O1}/class-meetings`,
    headers: p.sEnrolled.headers,
  });
  expect(list.statusCode, list.body).toBe(200);
  return list.json<{ items: ClassMeeting[] }>().items.find((m) => m.id === meetingId)?.recording;
}

beforeAll(async () => {
  world = new MeetWorld(() => t.clock.now());
  provider = new FakeLiveProvider(world);
  t = await createTestApp({
    liveProvider: provider,
    tokenEncryptionKey: Buffer.alloc(32, 3),
    driveCleanupMode: "TRASH_AFTER_INGEST",
  });
  t.clock.set("2026-11-02T06:00:00Z");
  p = await createPersonas(t);
  handlers = createHandlers({ context: t.app, subscribers: createSubscribers(t.app) });
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("INSERT INTO provider_host_accounts (email, provider_user_id) VALUES ($1, $2)", [
    HOST,
    world.host(HOST).userId,
  ]);
  await t.app
    .get(IntegrationsService)
    .connectYoutube(channel().grant, channel().info, { userId: p.sysAdmin.userId, type: "USER" });
});

afterAll(async () => {
  await t.close();
});

describe("a recording goes to YouTube by itself (§13.3)", () => {
  it("is found, streamed from Drive, checked against the original and published", async () => {
    const bytes = Buffer.alloc(256 * 1024, 7);
    const c = await recordedClass("2026-11-03", { bytes });
    await settle();
    const video = await videoOf(c.meeting.id);
    expect(video).toMatchObject({
      origin: "RECORDING",
      status: "PUBLISHED",
      recording_status: "READY",
      title: "Lecture 2026-11-03",
    });
    const upload = channel().uploads.get(video?.youtube_video_id ?? "");
    expect(upload?.bytes.equals(bytes)).toBe(true);
    expect(upload?.title).toMatch(/Lecture 2026-11-03$/);
    expect(upload?.description).not.toContain("@");
    expect(Number(video?.duration_ms)).toBe(HOUR);
    // The secret is sealed at rest, never stored in the clear.
    const sealed = await q<{ s: string }>(
      "SELECT secret_ciphertext AS s FROM integration_configs WHERE provider = 'video_host'",
    );
    expect(sealed.rows[0]?.s).not.toContain(channel().grant);
  });

  it("moves the Drive original to the bin only when told to (D-07)", async () => {
    const c = await recordedClass("2026-11-04");
    await settle();
    expect(world.files.get(c.file.fileId ?? "")?.trashed).toBe(true);
    const cleanup = await q<{ s: string }>(
      "SELECT drive_cleanup_status AS s FROM recordings WHERE class_meeting_id = $1",
      [c.meeting.id],
    );
    expect(cleanup.rows[0]?.s).toBe("TRASHED");
  });

  it("finds recordings whose event was lost", async () => {
    const c = await recordedClass("2026-11-05", {}, { dropEvents: true });
    await settle();
    expect(await videoOf(c.meeting.id)).toBeUndefined();
    expect(await t.app.get(RecordingsService).reconcile()).toMatchObject({ discovered: 1 });
    await settle();
    expect((await videoOf(c.meeting.id))?.status).toBe("PUBLISHED");
  });

  it("ignores recordings of classes with recording off", async () => {
    const c = await recordedClass("2026-11-06", {}, { recordingMode: "OFF" });
    await settle();
    expect(await videoOf(c.meeting.id)).toBeUndefined();
  });
});

describe("never publishing a video that isn't the recording (INV-9)", () => {
  it("fails a length mismatch, tells the System Admin, and publishes after a good retry", async () => {
    channel().durationMs = 50 * 60_000;
    const c = await recordedClass("2026-11-09");
    await settle();
    const failed = await videoOf(c.meeting.id);
    expect(failed).toMatchObject({
      status: "FAILED",
      recording_status: "FAILED",
      error_code: "DURATION_MISMATCH",
    });
    const told = await q<{ user_id: string }>(
      "SELECT user_id FROM notifications WHERE kind = 'recording.failed'",
    );
    expect(told.rows.map((r) => r.user_id)).toContain(p.sysAdmin.userId);

    channel().durationMs = HOUR - 30_000; // within 2 %
    p.sysAdmin.headers = await sessionFor(t, p.sysAdmin.userId);
    const retried = await t.request({
      method: "POST",
      url: `/api/v1/videos/${failed?.id ?? ""}/retry-ingest`,
      headers: p.sysAdmin.headers,
    });
    expect(retried.statusCode, retried.body).toBe(202);
    expect(retried.json<AdminVideo>().ingest).toMatchObject({ status: "DISCOVERED" });
    await settle();
    expect(await videoOf(c.meeting.id)).toMatchObject({
      status: "PUBLISHED",
      recording_status: "READY",
    });
    const lecturer = await t.request({
      method: "POST",
      url: `/api/v1/videos/${failed?.id ?? ""}/retry-ingest`,
      headers: (p.l1Primary.headers = await sessionFor(t, p.l1Primary.userId)),
    });
    // Lecturers can't (D-05: retry is the System Admin's); the authz suite owns the exact code.
    expect([403, 404]).toContain(lecturer.statusCode);
  });

  it("checks against Meet's times when Drive gives no duration", async () => {
    channel().durationMs = HOUR;
    const c = await recordedClass("2026-11-10", { durationMs: null });
    await settle();
    expect((await videoOf(c.meeting.id))?.status).toBe("PUBLISHED");
  });
});

describe("failures (§13.8)", () => {
  it("marks a recording deleted from Drive SOURCE_MISSING", async () => {
    const c = await recordedClass("2026-11-11");
    world.deleteFile(c.file.fileId ?? "");
    await settle();
    expect(await videoOf(c.meeting.id)).toMatchObject({
      status: "FAILED",
      recording_status: "SOURCE_MISSING",
    });
  });

  it("waits for tomorrow's quota instead of failing", async () => {
    channel().failure = "quota";
    const c = await recordedClass("2026-11-12");
    const pulled = await provider.pullEvents(100);
    await t.app.get(InboxService).receive(
      "google_meet",
      pulled.map((x) => t.app.get(MeetEventsService).toInbox(x.envelope)),
    );
    await provider.ackEvents(pulled.map((x) => x.ackId));
    // Run everything once, without the delayed retry.
    const run = Object.fromEntries(
      (Object.keys(handlers) as QueueName[])
        .filter((queue) => !queue.startsWith("db.") && queue !== "ops.queue-health")
        .map((queue) => [queue, handlers[queue]]),
    );
    await drainQueues(t.boss, run, { maxRounds: 300 });
    expect(await videoOf(c.meeting.id)).toMatchObject({
      status: "PROCESSING",
      recording_status: "DISCOVERED",
      error_code: "QUOTA",
    });
    // Found but not uploaded yet: the card already says it's processing (ui-overhaul #01).
    expect(await recordingSeenBySEnrolled(c.meeting.id)).toMatchObject({ status: "PROCESSING" });
    const later = await q<{ start_after: Date }>(
      "SELECT start_after FROM pgboss.job WHERE name = 'recording.ingest' AND state = 'created'",
    );
    expect(later.rows[0]?.start_after.getTime()).toBeGreaterThan(
      t.clock.now().getTime() + 5 * HOUR,
    );
    channel().failure = null;
    await settle();
    const published = await videoOf(c.meeting.id);
    expect(published?.status).toBe("PUBLISHED");
    expect(await recordingSeenBySEnrolled(c.meeting.id)).toEqual({
      videoId: published?.id,
      status: "PUBLISHED",
    });
  });

  it("degrades the integration when the channel grant is revoked", async () => {
    channel().failure = "auth";
    const c = await recordedClass("2026-11-13");
    await settle();
    expect(await videoOf(c.meeting.id)).toMatchObject({
      status: "FAILED",
      error_code: "CHANNEL_NOT_CONNECTED",
    });
    const state = await t.app.get(IntegrationsService).state("video_host");
    expect(state?.status).toBe("DEGRADED");
    channel().failure = null;
  });
});

describe("the channel follows the app", () => {
  it("copies a new title to YouTube, and deletes on YouTube after the undo window", async () => {
    const c = await recordedClass("2026-11-16");
    await t.app
      .get(IntegrationsService)
      .connectYoutube(channel().grant, channel().info, { userId: p.sysAdmin.userId, type: "USER" });
    await settle();
    const video = await videoOf(c.meeting.id);
    const view = await t.app.get(VideosService).get(video?.id ?? "", p.sysAdmin.userId);
    unwrap(
      await t.app.get(VideosService).update(
        video?.id ?? "",
        view?.version ?? 0,
        { title: "Hermeneutics: week 3" },
        {
          ...SYSTEM_ACTOR,
          userId: p.sysAdmin.userId,
        },
      ),
    );
    await settle();
    expect(channel().uploads.get(video?.youtube_video_id ?? "")?.title).toBe(
      "Hermeneutics: week 3",
    );

    unwrap(
      await t.app
        .get(VideoAdminService)
        .delete(video?.id ?? "", { ...SYSTEM_ACTOR, userId: p.sysAdmin.userId }),
    );
    t.clock.set("2026-11-25T06:00:00Z");
    expect(await t.app.get(VideoAdminService).purgeDeleted()).toBeGreaterThanOrEqual(1);
    expect(channel().uploads.get(video?.youtube_video_id ?? "")?.deleted).toBe(true);
    const reminders = await q<{ c: number }>(
      "SELECT count(*)::int AS c FROM notifications WHERE kind = 'video.youtube-delete-reminder' AND data->>'videoId' = $1",
      [video?.id],
    );
    expect(reminders.rows[0]?.c).toBe(0);
  });
});
