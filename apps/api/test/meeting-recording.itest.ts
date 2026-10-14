import type { ClassMeeting } from "@glim/contracts";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService } from "@glim/modules/class-meeting";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * A Class Meeting's recording as each viewer may see it (ui-overhaul #01). Students get PUBLISHED
 * only when they could play the video now, PROCESSING, or nothing; people who manage the
 * offering's videos (l1Primary, not l3Assistant) see the rest. Videos are written directly.
 */

let t: TestApp;
let p: Personas;
let day = 0;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

/** A meeting of O1 on its own day, so none clash. */
async function meeting(): Promise<string> {
  day += 1;
  const date = `2026-12-${String(day).padStart(2, "0")}`;
  const created = unwrap(
    await t.app.get(ClassMeetingsService).create(
      p.world.offerings.O1,
      {
        title: `Lecture ${date}`,
        scheduledStart: `${date}T09:00:00Z`,
        scheduledEnd: `${date}T10:00:00Z`,
      },
      { ...SYSTEM_ACTOR, userId: p.acadAdmin.userId },
    ),
  );
  return created.meeting.id;
}

let youtubeIds = 0;
async function video(
  meetingId: string,
  over: {
    status?: string;
    visibility?: "ENROLLED" | "STAFF_ONLY";
    publishAfter?: string;
    createdAt?: string;
  } = {},
): Promise<string> {
  youtubeIds += 1;
  const status = over.status ?? "PUBLISHED";
  const { rows } = await q<{ id: string }>(
    `INSERT INTO videos (course_offering_id, class_meeting_id, origin, title, status, visibility,
                         youtube_video_id, publish_after, created_at)
     VALUES ($1, $2, 'LINK', 'Recording', $3, $4, $5, $6, coalesce($7::timestamptz, now()))
     RETURNING id`,
    [
      p.world.offerings.O1,
      meetingId,
      status,
      over.visibility ?? "ENROLLED",
      status === "PROCESSING" ? null : `vid${String(youtubeIds).padStart(8, "0")}`,
      over.publishAfter ?? null,
      over.createdAt ?? null,
    ],
  );
  return rows[0]?.id ?? "";
}

/** The meeting as `as` sees it, from the offering's list and from their schedule. */
async function seenBy(as: PersonaName, meetingId: string) {
  const list = await t.request({
    url: `/api/v1/course-offerings/${p.world.offerings.O1}/class-meetings`,
    headers: p[as].headers,
  });
  expect(list.statusCode, list.body).toBe(200);
  const fromList = list.json<{ items: ClassMeeting[] }>().items.find((m) => m.id === meetingId);
  const schedule = await t.request({
    url: "/api/v1/me/schedule?from=2026-12-01T00:00:00Z&to=2027-01-01T00:00:00Z",
    headers: p[as].headers,
  });
  expect(schedule.statusCode, schedule.body).toBe(200);
  const fromSchedule = schedule
    .json<{ items: ClassMeeting[] }>()
    .items.find((m) => m.id === meetingId);
  expect(fromSchedule?.recording).toEqual(fromList?.recording);
  return fromList?.recording;
}

beforeAll(async () => {
  t = await createTestApp();
  t.clock.set("2026-11-20T06:00:00Z");
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("a Class Meeting's recording, for a student", () => {
  it("is null before any video, and the card falls back to the recording mode", async () => {
    const id = await meeting();
    expect(await seenBy("sEnrolled", id)).toBeNull();
  });

  it("is PROCESSING while the video processes", async () => {
    const id = await meeting();
    const v = await video(id, { status: "PROCESSING" });
    expect(await seenBy("sEnrolled", id)).toEqual({ videoId: v, status: "PROCESSING" });
  });

  it("is PUBLISHED when the student can play it", async () => {
    const id = await meeting();
    const v = await video(id);
    expect(await seenBy("sEnrolled", id)).toEqual({ videoId: v, status: "PUBLISHED" });
  });

  it.each([
    ["unpublished", { status: "UNPUBLISHED" }],
    ["failed", { status: "FAILED" }],
    ["unavailable", { status: "UNAVAILABLE" }],
    ["deleted", { status: "DELETED" }],
    ["staff-only", { visibility: "STAFF_ONLY" as const }],
    ["not released yet", { publishAfter: "2099-01-01T00:00:00Z" }],
  ])("is never PUBLISHED for a %s video: nothing is shown", async (_, over) => {
    const id = await meeting();
    await video(id, over);
    expect(await seenBy("sEnrolled", id)).toBeNull();
  });

  it("shows a playable pasted link over a newer upload still processing", async () => {
    const id = await meeting();
    const link = await video(id, { createdAt: "2026-11-01T00:00:00Z" });
    await video(id, { status: "PROCESSING", createdAt: "2026-11-02T00:00:00Z" });
    expect(await seenBy("sEnrolled", id)).toEqual({ videoId: link, status: "PUBLISHED" });
  });

  it("gives nothing to students of other offerings", async () => {
    const id = await meeting();
    await video(id);
    const list = await t.request({
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/class-meetings`,
      headers: p.sOther.headers,
    });
    expect(list.statusCode).toBe(404);
    const schedule = await t.request({
      url: "/api/v1/me/schedule?from=2026-12-01T00:00:00Z&to=2027-01-01T00:00:00Z",
      headers: p.sOther.headers,
    });
    expect(schedule.json<{ items: ClassMeeting[] }>().items.map((m) => m.id)).not.toContain(id);
  });
});

describe("a Class Meeting's recording, for staff", () => {
  it("shows a Lecturer who manages videos NOT_PUBLISHED and FAILED", async () => {
    const unpublished = await meeting();
    const u = await video(unpublished, { status: "UNPUBLISHED" });
    expect(await seenBy("l1Primary", unpublished)).toEqual({ videoId: u, status: "NOT_PUBLISHED" });

    const failed = await meeting();
    const f = await video(failed, { status: "FAILED" });
    expect(await seenBy("l1Primary", failed)).toEqual({ videoId: f, status: "FAILED" });

    const takenDown = await meeting();
    const d = await video(takenDown, { status: "UNAVAILABLE" });
    expect(await seenBy("l1Primary", takenDown)).toEqual({ videoId: d, status: "FAILED" });
  });

  it("shows them a published staff-only video as PUBLISHED", async () => {
    const id = await meeting();
    const v = await video(id, { visibility: "STAFF_ONLY" });
    expect(await seenBy("l1Primary", id)).toEqual({ videoId: v, status: "PUBLISHED" });
  });

  it("shows an Assistant, who can't manage videos, what a student sees", async () => {
    const id = await meeting();
    await video(id, { status: "FAILED" });
    expect(await seenBy("l3Assistant", id)).toBeNull();
  });

  it("returns the recording on a single meeting and after an edit", async () => {
    const id = await meeting();
    const v = await video(id, { status: "UNPUBLISHED" });
    const one = await t.request({
      url: `/api/v1/class-meetings/${id}`,
      headers: p.l1Primary.headers,
    });
    expect(one.json<ClassMeeting>().recording).toEqual({ videoId: v, status: "NOT_PUBLISHED" });
    const student = await t.request({
      url: `/api/v1/class-meetings/${id}`,
      headers: p.sEnrolled.headers,
    });
    expect(student.json<ClassMeeting>().recording).toBeNull();
  });

  it("keeps each list item small (≤ 2 KB)", async () => {
    const id = await meeting();
    await video(id);
    const list = await t.request({
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/class-meetings`,
      headers: p.l1Primary.headers,
    });
    for (const item of list.json<{ items: ClassMeeting[] }>().items)
      expect(Buffer.byteLength(JSON.stringify(item))).toBeLessThanOrEqual(2048);
  });
});
