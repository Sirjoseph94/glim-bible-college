import type { ClassMeeting, ClassMeetingSeries, ScheduleWarning } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { SeriesService } from "@glim/modules/class-meeting";
import { NotificationsService } from "@glim/modules/notifications";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type PersonaName, type Personas } from "./personas";

/**
 * Weekly series, reschedule and cancel (TRD §11.9). The persona offering O1 is taught by
 * l1Primary and taken by sEnrolled, whose timezone is London. The test clock starts on Wednesday
 * 7 October 2026; the tests run in order.
 */

let t: TestApp;
let p: Personas;
let room: string;
let series: ClassMeetingSeries;
let meetings: ClassMeeting[];
const MEET = "https://meet.google.com/abc-defg-hij";

interface ErrorBody {
  error: { code: string; message: string; conflicts?: { title: string }[] };
}

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);
const count = async (text: string, values: unknown[] = []) =>
  Number((await q<{ n: string }>(text, values)).rows[0]?.n ?? 0);

function post(as: PersonaName, url: string, payload: unknown, idempotent = false) {
  return t.request({
    method: "POST",
    url,
    headers: { ...p[as].headers, ...(idempotent ? { "idempotency-key": idempotencyKey() } : {}) },
    payload,
  });
}

async function meeting(id: string): Promise<ClassMeeting> {
  const res = await t.request({
    url: `/api/v1/class-meetings/${id}`,
    headers: p.l1Primary.headers,
  });
  return res.json<ClassMeeting>();
}

function patch(id: string, version: number, payload: unknown, as: PersonaName = "l1Primary") {
  return t.request({
    method: "PATCH",
    url: `/api/v1/class-meetings/${id}`,
    headers: { ...p[as].headers, "if-match": `"${String(version)}"` },
    payload,
  });
}

/** The notifications sEnrolled has of a kind, newest first. */
async function noticesFor(kind: string) {
  return (
    await q<{ id: string; title: string; email_status: string }>(
      `SELECT n.id, n.title, n.email_status FROM notifications n
        WHERE n.user_id = $1 AND n.kind = $2 ORDER BY n.created_at DESC`,
      [p.sEnrolled.userId, kind],
    )
  ).rows;
}

/** Moves the clock, with fresh sessions for the personas (sessions last 12 hours). */
async function advance(to: string): Promise<void> {
  t.clock.set(to);
  for (const name of ["l1Primary", "l4Other", "acadAdmin", "sEnrolled"] as const)
    p[name].headers = await sessionFor(t, p[name].userId);
}

beforeAll(async () => {
  t = await createTestApp();
  t.clock.set("2026-10-07T09:00:00Z");
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q("UPDATE users SET timezone = 'Europe/London' WHERE id = $1", [p.sEnrolled.userId]);
  const res = await post("acadAdmin", "/api/v1/rooms", { code: "HALL", name: "Main Hall" });
  room = res.json<{ id: string }>().id;
});

afterAll(async () => {
  await t.close();
});

describe("creating a weekly series", () => {
  it("generates eight weeks of occurrences at the same Lagos time, numbered, with the link and Room", async () => {
    const res = await post(
      "l1Primary",
      `/api/v1/course-offerings/${p.world.offerings.O1}/class-meeting-series`,
      {
        titleTemplate: "Week {n}",
        weekdays: ["MO", "WE"],
        startsOn: "2026-10-12",
        startTime: "09:00",
        durationMinutes: 120,
        roomId: room,
        onlineLink: MEET,
      },
      true,
    );
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json<{
      series: ClassMeetingSeries;
      meetings: ClassMeeting[];
      warnings: ScheduleWarning[];
    }>();
    series = body.series;
    meetings = body.meetings;
    expect(series).toMatchObject({
      rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE",
      timezone: "Africa/Lagos",
      startTime: "09:00",
      durationMinutes: 120,
      generatedThrough: "2026-12-02",
      status: "ACTIVE",
    });
    // 12 Oct to 2 Dec: eight Mondays and eight Wednesdays.
    expect(meetings).toHaveLength(16);
    expect(meetings[0]).toMatchObject({
      title: "Week 1",
      scheduledStart: "2026-10-12T08:00:00.000Z",
      scheduledEnd: "2026-10-12T10:00:00.000Z",
      room: { id: room },
      onlineLink: MEET,
      seriesId: series.id,
    });
    expect(meetings.at(-1)).toMatchObject({
      title: "Week 16",
      scheduledStart: "2026-12-02T08:00:00.000Z",
    });
    // Every occurrence books the offering's Lecturers.
    expect(
      await count(
        "SELECT count(*) AS n FROM meeting_lecturer_slots s JOIN class_meetings m ON m.id = s.class_meeting_id WHERE m.series_id = $1",
        [series.id],
      ),
    ).toBe(16 * 3);
  });

  it("refuses a whole series when any date clashes, listing the dates, and creates nothing", async () => {
    const before = await count("SELECT count(*) AS n FROM class_meeting_series");
    const res = await post(
      "l4Other",
      `/api/v1/course-offerings/${p.world.offerings.O2}/class-meeting-series`,
      {
        titleTemplate: "Hermeneutics {n}",
        weekdays: ["WE"],
        startsOn: "2026-10-12",
        untilOn: "2026-10-31",
        startTime: "10:30",
        durationMinutes: 60,
        roomId: room,
      },
      true,
    );
    expect(res.statusCode).toBe(409);
    const error = res.json<ErrorBody>().error;
    expect(error.code).toBe("ROOM_CONFLICT");
    expect(error.message).toContain("Wed, 14 Oct 2026; Wed, 21 Oct 2026; Wed, 28 Oct 2026");
    expect(error.conflicts?.map((c) => c.title)).toEqual(["Week 2", "Week 4", "Week 6"]);
    expect(await count("SELECT count(*) AS n FROM class_meeting_series")).toBe(before);
  });

  it("refuses weekdays that never fall in the dates, and a start in the past", async () => {
    const url = `/api/v1/course-offerings/${p.world.offerings.O2}/class-meeting-series`;
    const base = { titleTemplate: "X", startTime: "09:00", durationMinutes: 60 };
    const never = await post(
      "l4Other",
      url,
      { ...base, weekdays: ["SU"], startsOn: "2026-10-12", untilOn: "2026-10-16" },
      true,
    );
    expect(never.statusCode).toBe(400);
    const past = await post(
      "l4Other",
      url,
      { ...base, weekdays: ["MO"], startsOn: "2026-10-01" },
      true,
    );
    expect(past.statusCode).toBe(400);
  });
});

describe("extending series daily", () => {
  it("adds the occurrences that come into the eight-week horizon, idempotently", async () => {
    await advance("2026-10-14T06:00:00Z");
    const extend = () => t.app.get(SeriesService).extend();
    expect(await extend()).toEqual({ created: 2, skipped: 0 });
    const titles = (
      await q<{ title: string; occurrence_date: string }>(
        "SELECT title, occurrence_date::text FROM class_meetings WHERE series_id = $1 ORDER BY scheduled_start DESC LIMIT 2",
        [series.id],
      )
    ).rows;
    expect(titles).toEqual([
      { title: "Week 18", occurrence_date: "2026-12-09" },
      { title: "Week 17", occurrence_date: "2026-12-07" },
    ]);
    expect(await extend()).toEqual({ created: 0, skipped: 0 });
  });

  it("skips and audits an occurrence that would clash", async () => {
    const blocker = await post(
      "acadAdmin",
      `/api/v1/course-offerings/${p.world.offerings.O2}/class-meetings`,
      {
        title: "Visiting speaker",
        scheduledStart: "2026-12-14T08:30:00Z",
        scheduledEnd: "2026-12-14T09:30:00Z",
        roomId: room,
      },
      true,
    );
    expect(blocker.statusCode, blocker.body).toBe(201);
    await advance("2026-10-21T06:00:00Z");
    expect(await t.app.get(SeriesService).extend()).toEqual({ created: 1, skipped: 1 });
    expect(
      await count(
        "SELECT count(*) AS n FROM audit_logs WHERE action = 'meeting.series.occurrence-skipped' AND metadata->>'date' = '2026-12-14'",
      ),
    ).toBe(1);
  });
});

describe("rescheduling", () => {
  it("moves one occurrence (THIS_ONLY), re-checking conflicts, and tells enrolled students", async () => {
    const target = meetings[3]; // Week 4, Wed 21 Oct, still ahead of the clock
    if (target === undefined) throw new Error("no meeting");
    const current = await meeting(target.id);
    const res = await patch(target.id, current.version, {
      scheduledStart: "2026-10-27T13:00:00Z",
      scheduledEnd: "2026-10-27T15:00:00Z",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ meeting: ClassMeeting; changed: number }>()).toMatchObject({
      changed: 1,
      meeting: { scheduledStart: "2026-10-27T13:00:00.000Z", title: "Week 4" },
    });
    const { rows } = await q<{ series_exception: boolean; moved: boolean }>(
      `SELECT m.series_exception,
              lower(s.during) = '2026-10-27T13:00:00Z'::timestamptz AS moved FROM class_meetings m
         JOIN meeting_lecturer_slots s ON s.class_meeting_id = m.id WHERE m.id = $1 LIMIT 1`,
      [target.id],
    );
    expect(rows[0]?.series_exception).toBe(true);
    expect(rows[0]?.moved).toBe(true);

    const notices = await noticesFor("meeting.rescheduled");
    expect(notices[0]).toMatchObject({ title: "PBIB101 moved: Week 4", email_status: "PENDING" });
    await drainQueues(t.boss, {
      "notify.send": (job) =>
        t.app
          .get(NotificationsService)
          .deliver((job.data as { notificationId: string }).notificationId),
    });
    const mail = t.mailer.lastTo(p.sEnrolled.email);
    expect(mail?.subject).toBe("PBIB101 class moved: Week 4");
    // After 25 October London is an hour behind Lagos.
    expect(mail?.text).toContain("13:00 London (14:00 Lagos)");
    expect(mail?.text).toContain("It is in Main Hall, and online.");
  });

  it("refuses a move into a booked Room, and a stale version", async () => {
    const target = meetings[5];
    if (target === undefined) throw new Error("no meeting");
    const current = await meeting(target.id);
    // Week 6 onto the Hall while the visiting speaker has it.
    const clash = await patch(target.id, current.version, {
      scheduledStart: "2026-12-14T09:00:00Z",
      scheduledEnd: "2026-12-14T10:00:00Z",
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json<ErrorBody>().error).toMatchObject({
      code: "ROOM_CONFLICT",
      conflicts: [{ title: "Visiting speaker" }],
    });
    const stale = await patch(target.id, current.version - 1, { title: "Old" });
    expect(stale.statusCode).toBe(412);
  });

  it("moves this and later occurrences to a new time of day (ALL_FUTURE), keeping their dates and the one moved on its own", async () => {
    const from = meetings[6]; // Week 7, Mon 2 Nov
    if (from === undefined) throw new Error("no meeting");
    const current = await meeting(from.id);
    const res = await patch(from.id, current.version, {
      scope: "ALL_FUTURE",
      scheduledStart: "2026-11-02T10:00:00Z",
      scheduledEnd: "2026-11-02T11:30:00Z",
      onlineLink: "https://meet.google.com/new-link-abc",
    });
    expect(res.statusCode, res.body).toBe(200);
    const later = await count(
      "SELECT count(*) AS n FROM class_meetings WHERE series_id = $1 AND scheduled_start >= '2026-11-02' AND state = 'SCHEDULED'",
      [series.id],
    );
    expect(res.json<{ changed: number }>().changed).toBe(later);
    const rows = (
      await q<{ occurrence_date: string; start: string; link: string }>(
        `SELECT occurrence_date::text, to_char(scheduled_start AT TIME ZONE 'Africa/Lagos', 'HH24:MI') AS start, online_link AS link
           FROM class_meetings WHERE series_id = $1 ORDER BY scheduled_start`,
        [series.id],
      )
    ).rows;
    for (const row of rows.filter((r) => r.occurrence_date >= "2026-11-02"))
      expect(row, row.occurrence_date).toMatchObject({
        start: "11:00",
        link: "https://meet.google.com/new-link-abc",
      });
    for (const row of rows.filter(
      (r) => r.occurrence_date < "2026-11-02" && r.occurrence_date !== "2026-10-21",
    ))
      expect(row.start).toBe("09:00");
    const saved = await q<{ start_time: string; duration_minutes: number }>(
      "SELECT start_time::text, duration_minutes FROM class_meeting_series WHERE id = $1",
      [series.id],
    );
    expect(saved.rows[0]).toEqual({ start_time: "11:00:00", duration_minutes: 90 });
    // One notice covers the lot.
    expect((await noticesFor("meeting.rescheduled"))[0]?.title).toMatch(/Week 7 and \d+ later/);
  });

  it("won't move this and later occurrences to another day", async () => {
    const from = meetings[8];
    if (from === undefined) throw new Error("no meeting");
    const current = await meeting(from.id);
    const res = await patch(from.id, current.version, {
      scope: "ALL_FUTURE",
      scheduledStart: new Date(
        new Date(current.scheduledStart).getTime() + 86_400_000,
      ).toISOString(),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("cancelling", () => {
  it("cancels one meeting with a reason, frees the Room and the Lecturers, and tells students", async () => {
    const target = meetings[9];
    if (target === undefined) throw new Error("no meeting");
    const noReason = await post("l1Primary", `/api/v1/class-meetings/${target.id}/cancel`, {});
    expect(noReason.statusCode).toBe(400);
    const res = await post("l1Primary", `/api/v1/class-meetings/${target.id}/cancel`, {
      reason: "Lecturer at a conference",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ meeting: ClassMeeting; cancelled: number }>()).toMatchObject({
      cancelled: 1,
      meeting: { state: "CANCELLED", cancelReason: "Lecturer at a conference" },
    });
    // Students see the reason too, as the cancel form promises; other meetings have none.
    const asStudent = await t.request({
      url: `/api/v1/class-meetings/${target.id}`,
      headers: p.sEnrolled.headers,
    });
    expect(asStudent.statusCode, asStudent.body).toBe(200);
    expect(asStudent.json<ClassMeeting>().cancelReason).toBe("Lecturer at a conference");
    const listed = await t.request({
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/class-meetings`,
      headers: p.sEnrolled.headers,
    });
    expect(
      listed.json<{ items: ClassMeeting[] }>().items.find((x) => x.id === target.id)?.cancelReason,
    ).toBe("Lecturer at a conference");
    const day = target.scheduledStart.slice(0, 10);
    const schedule = await t.request({
      url: `/api/v1/me/schedule?from=${day}T00:00:00Z&to=${day}T23:59:59Z`,
      headers: p.l1Primary.headers,
    });
    expect(
      schedule.json<{ items: ClassMeeting[] }>().items.find((x) => x.id === target.id)
        ?.cancelReason,
    ).toBe("Lecturer at a conference");
    expect((await meeting(meetings[8]?.id ?? "")).cancelReason).toBeNull();
    expect(
      await count("SELECT count(*) AS n FROM meeting_lecturer_slots WHERE class_meeting_id = $1", [
        target.id,
      ]),
    ).toBe(0);
    // The Room and the Lecturer are free at that time again.
    const cancelled = await meeting(target.id);
    const rebook = await post(
      "l1Primary",
      `/api/v1/course-offerings/${p.world.offerings.O1}/class-meetings`,
      {
        title: "Make-up class",
        scheduledStart: cancelled.scheduledStart,
        scheduledEnd: cancelled.scheduledEnd,
        roomId: room,
      },
      true,
    );
    expect(rebook.statusCode, rebook.body).toBe(201);
    expect((await noticesFor("meeting.cancelled"))[0]?.title).toBe(
      `PBIB101 cancelled: ${cancelled.title}`,
    );

    const again = await post("l1Primary", `/api/v1/class-meetings/${target.id}/cancel`, {
      reason: "Twice",
    });
    expect(again.json<ErrorBody>().error.code).toBe("MEETING_STATE_INVALID");
    const change = await patch(target.id, cancelled.version, { title: "Back" });
    expect(change.json<ErrorBody>().error.code).toBe("MEETING_STATE_INVALID");
  });

  it("won't cancel a live meeting", async () => {
    const target = meetings[10];
    if (target === undefined) throw new Error("no meeting");
    await q("UPDATE class_meetings SET state = 'LIVE' WHERE id = $1", [target.id]);
    const res = await post("l1Primary", `/api/v1/class-meetings/${target.id}/cancel`, {
      reason: "Too late",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("MEETING_IN_PROGRESS");
    await q("UPDATE class_meetings SET state = 'SCHEDULED' WHERE id = $1", [target.id]);
  });

  it("cancels the rest of a series (ALL_FUTURE) and ends it, so nothing more is generated", async () => {
    const from = meetings[12];
    if (from === undefined) throw new Error("no meeting");
    const upcoming = await count(
      "SELECT count(*) AS n FROM class_meetings WHERE series_id = $1 AND scheduled_start >= $2 AND state IN ('SCHEDULED', 'OPEN')",
      [series.id, from.scheduledStart],
    );
    const res = await post("l1Primary", `/api/v1/class-meetings/${from.id}/cancel`, {
      reason: "Course moved online-only",
      scope: "ALL_FUTURE",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ cancelled: number }>().cancelled).toBe(upcoming);
    const saved = await q<{ status: string; until_on: string }>(
      "SELECT status, until_on::text FROM class_meeting_series WHERE id = $1",
      [series.id],
    );
    expect(saved.rows[0]?.status).toBe("ENDED");
    await advance("2026-11-04T06:00:00Z");
    expect(await t.app.get(SeriesService).extend()).toEqual({ created: 0, skipped: 0 });
  });
});
