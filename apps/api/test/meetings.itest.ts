import type { ClassMeeting, ScheduleWarning } from "@glim/contracts";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { AssignmentsService } from "@glim/modules/lecturing";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createCohort, createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * Scheduling a Class Meeting with a Room and a pasted online link (TRD §9.5, §11; v1 spec).
 * Uses the persona world: O1 is taught by l1Primary (PRIMARY), l2Co and l3Assistant, and taken by
 * sEnrolled; O2 is taught by l4Other and taken by sOther. Both are published here.
 */

let t: TestApp;
let p: Personas;
let roomA: string;
let roomB: string;
const MEET = "https://meet.google.com/abc-defg-hij";

interface ErrorBody {
  error: {
    code: string;
    conflicts?: { meetingId: string; title: string }[];
    fieldErrors?: unknown[];
  };
}

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

async function lecturerOf(name: PersonaName): Promise<string> {
  const { rows } = await q<{ id: string }>("SELECT id FROM lecturers WHERE user_id = $1", [
    p[name].userId,
  ]);
  return rows[0]?.id ?? "";
}

function schedule(
  as: PersonaName,
  offeringId: string,
  body: Record<string, unknown>,
  key = idempotencyKey(),
) {
  return t.request({
    method: "POST",
    url: `/api/v1/course-offerings/${offeringId}/class-meetings`,
    headers: { ...p[as].headers, "idempotency-key": key },
    payload: { title: "Class", ...body },
  });
}

let cohorts = 0;
/**
 * A cohort of its own for each extra offering: a cohort takes a course once, one course at a time
 * (ADR-0005). Each intake gets its own application window in 2023.
 */
async function cohortFor(section: string): Promise<string> {
  cohorts++;
  const month = String(cohorts).padStart(2, "0");
  const programme = { id: p.world.programmeId, code: "PDIP", name: "Persona Diploma" };
  const { cohortId } = await createCohort(t, programme, {
    code: `2025-${section}`,
    opensOn: `2023-${month}-01`,
    closesOn: `2023-${month}-20`,
    startsOn: "2025-01-01",
  });
  return cohortId;
}

/** A new published offering of the persona course in a cohort of its own, taught by the given personas. */
async function offering(section: string, teachers: [PersonaName, "PRIMARY" | "CO_LECTURER"][]) {
  const assignments = t.app.get(AssignmentsService);
  const id = unwrap(
    await assignments.createOfferingWithLecturers(
      {
        courseId: p.world.courseId,
        cohortId: await cohortFor(section),
        startsOn: "2025-01-01",
        endsOn: "2099-12-31",
        examOn: "2099-12-31",
        titleOverride: null,
        capacity: null,
        lecturers: await Promise.all(
          teachers.map(async ([name, role]) => ({ lecturerId: await lecturerOf(name), role })),
        ),
      },
      SYSTEM_ACTOR,
    ),
  );
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = $1", [id]);
  return id;
}

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  const room = async (code: string) => {
    const res = await t.request({
      method: "POST",
      url: "/api/v1/rooms",
      headers: p.acadAdmin.headers,
      payload: { code, name: `Room ${code}`, capacity: 40 },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string }>().id;
  };
  roomA = await room("CHAPEL");
  roomB = await room("LIB-2");
});

afterAll(async () => {
  await t.close();
});

describe("scheduling a Class Meeting", () => {
  it("books the Room and every Lecturer of the offering, and shows the link to its Lecturers", async () => {
    const res = await schedule("l1Primary", p.world.offerings.O1, {
      title: "Week 1: Introduction",
      scheduledStart: "2080-09-07T09:00:00+01:00",
      scheduledEnd: "2080-09-07T11:00:00+01:00",
      roomId: roomA,
      onlineLink: MEET,
    });
    expect(res.statusCode, res.body).toBe(201);
    const { meeting, warnings } = res.json<{
      meeting: ClassMeeting;
      warnings: ScheduleWarning[];
    }>();
    expect(meeting).toMatchObject({
      title: "Week 1: Introduction",
      scheduledStart: "2080-09-07T08:00:00.000Z",
      scheduledEnd: "2080-09-07T10:00:00.000Z",
      timezone: "Africa/Lagos",
      room: { id: roomA, code: "CHAPEL" },
      hasOnlineLink: true,
      onlineLink: MEET,
      state: "SCHEDULED",
      recordingMode: "AUTO",
    });
    expect(warnings).toEqual([]);

    const slots = await q<{ lecturer_id: string; override: boolean }>(
      "SELECT lecturer_id, override FROM meeting_lecturer_slots WHERE class_meeting_id = $1",
      [meeting.id],
    );
    expect(slots.rows.map((s) => s.lecturer_id).sort()).toEqual(
      [
        await lecturerOf("l1Primary"),
        await lecturerOf("l2Co"),
        await lecturerOf("l3Assistant"),
      ].sort(),
    );
    expect(slots.rows.every((s) => !s.override)).toBe(true);
    const events = await q<{ n: string }>(
      "SELECT count(*) AS n FROM pgboss.job WHERE name = 'domain-event' AND data->>'name' = 'meeting.scheduled' AND data->'payload'->>'meetingId' = $1",
      [meeting.id],
    );
    expect(Number(events.rows[0]?.n)).toBe(1);
    const audit = await q<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'meeting.class-meeting.created' AND resource_id = $1",
      [meeting.id],
    );
    expect(Number(audit.rows[0]?.n)).toBe(1);
  });

  it("accepts a meeting with no Room (online only) and no link yet", async () => {
    const res = await schedule("l2Co", p.world.offerings.O1, {
      scheduledStart: "2080-09-08T09:00:00Z",
      scheduledEnd: "2080-09-08T10:00:00Z",
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<{ meeting: ClassMeeting }>().meeting).toMatchObject({
      room: null,
      hasOnlineLink: false,
      onlineLink: null,
    });
  });

  it("refuses a link that isn't Google Meet", async () => {
    for (const link of [
      "https://zoom.us/j/123",
      "http://meet.google.com/abc-defg-hij",
      "https://meet.google.com.evil.example/abc",
    ]) {
      const res = await schedule("l1Primary", p.world.offerings.O1, {
        scheduledStart: "2080-09-09T09:00:00Z",
        scheduledEnd: "2080-09-09T10:00:00Z",
        onlineLink: link,
      });
      expect(res.statusCode, link).toBe(400);
      expect(res.json<ErrorBody>().error.code).toBe("ONLINE_LINK_INVALID");
    }
  });

  it("refuses times in the past, back to front, too short or too long", async () => {
    for (const [scheduledStart, scheduledEnd] of [
      ["2026-10-01T09:00:00Z", "2026-10-01T10:00:00Z"],
      ["2080-09-09T10:00:00Z", "2080-09-09T09:00:00Z"],
      ["2080-09-09T10:00:00Z", "2080-09-09T10:04:00Z"],
      ["2080-09-09T08:00:00Z", "2080-09-09T18:01:00Z"],
    ]) {
      const res = await schedule("l1Primary", p.world.offerings.O1, {
        scheduledStart,
        scheduledEnd,
      });
      expect(res.statusCode, `${String(scheduledStart)}–${String(scheduledEnd)}`).toBe(400);
      expect(res.json<ErrorBody>().error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("doesn't let an Assistant, another course's Lecturer or a student schedule", async () => {
    const body = { scheduledStart: "2080-09-09T09:00:00Z", scheduledEnd: "2080-09-09T10:00:00Z" };
    for (const who of ["l3Assistant", "l4Other", "sEnrolled"] as const)
      expect([403, 404], who).toContain(
        (await schedule(who, p.world.offerings.O1, body)).statusCode,
      );
  });
});

describe("double-booking", () => {
  it("refuses a Room that is taken, listing the meeting in the way; back-to-back is fine", async () => {
    const first = await schedule("l4Other", p.world.offerings.O2, {
      title: "Hermeneutics",
      scheduledStart: "2080-09-14T09:00:00Z",
      scheduledEnd: "2080-09-14T11:00:00Z",
      roomId: roomB,
    });
    expect(first.statusCode, first.body).toBe(201);
    const firstId = first.json<{ meeting: ClassMeeting }>().meeting.id;

    const clash = await schedule("l1Primary", p.world.offerings.O1, {
      scheduledStart: "2080-09-14T10:30:00Z",
      scheduledEnd: "2080-09-14T12:00:00Z",
      roomId: roomB,
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json<ErrorBody>().error).toMatchObject({
      code: "ROOM_CONFLICT",
      conflicts: [{ meetingId: firstId, title: "Hermeneutics" }],
    });

    const after = await schedule("l1Primary", p.world.offerings.O1, {
      scheduledStart: "2080-09-14T11:00:00Z",
      scheduledEnd: "2080-09-14T12:00:00Z",
      roomId: roomB,
    });
    expect(after.statusCode, after.body).toBe(201);
  });

  it("refuses a Lecturer who is already teaching then; only an Academic Admin may override, with a reason", async () => {
    const o3 = await offering("O3", [["l1Primary", "PRIMARY"]]);
    const body = {
      title: "Clashing class",
      scheduledStart: "2080-09-07T09:30:00Z",
      scheduledEnd: "2080-09-07T10:30:00Z",
    };
    const clash = await schedule("l1Primary", o3, body);
    expect(clash.statusCode).toBe(409);
    const error = clash.json<ErrorBody>().error;
    expect(error.code).toBe("LECTURER_SCHEDULE_CONFLICT");
    expect(error.conflicts?.map((c) => c.title)).toEqual(["Week 1: Introduction"]);

    const lecturerOverride = await schedule("l1Primary", o3, {
      ...body,
      overrideConflicts: true,
      reason: "Joint session",
    });
    expect(lecturerOverride.statusCode).toBe(403);
    const noReason = await schedule("acadAdmin", o3, { ...body, overrideConflicts: true });
    expect(noReason.statusCode).toBe(400);

    const overridden = await schedule("acadAdmin", o3, {
      ...body,
      overrideConflicts: true,
      reason: "Joint session with the Diploma class",
    });
    expect(overridden.statusCode, overridden.body).toBe(201);
    const id = overridden.json<{ meeting: ClassMeeting }>().meeting.id;
    const slots = await q<{ override: boolean; override_reason: string }>(
      "SELECT override, override_reason FROM meeting_lecturer_slots WHERE class_meeting_id = $1",
      [id],
    );
    expect(slots.rows).toEqual([
      { override: true, override_reason: "Joint session with the Diploma class" },
    ]);
    const audit = await q<{ metadata: { reason?: string } }>(
      "SELECT metadata FROM audit_logs WHERE action = 'meeting.class-meeting.created' AND resource_id = $1",
      [id],
    );
    expect(audit.rows[0]?.metadata.reason).toBe("Joint session with the Diploma class");
  });

  it("lets only one of two simultaneous bookings of a Room through", async () => {
    const o4 = await offering("O4", []);
    const o5 = await offering("O5", []);
    const body = {
      scheduledStart: "2080-09-21T09:00:00Z",
      scheduledEnd: "2080-09-21T10:00:00Z",
      roomId: roomA,
    };
    const results = await Promise.all([
      schedule("acadAdmin", o4, body),
      schedule("acadAdmin", o5, body),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)?.json<ErrorBody>().error.code).toBe(
      "ROOM_CONFLICT",
    );
  });

  it("lets only one of two simultaneous bookings of a Lecturer through", async () => {
    const o6 = await offering("O6", [["l4Other", "PRIMARY"]]);
    const body = { scheduledStart: "2080-09-22T09:00:00Z", scheduledEnd: "2080-09-22T10:00:00Z" };
    const results = await Promise.all([
      schedule("l4Other", p.world.offerings.O2, body),
      schedule("l4Other", o6, body),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)?.json<ErrorBody>().error.code).toBe(
      "LECTURER_SCHEDULE_CONFLICT",
    );
  });
});

describe("student clashes", () => {
  it("warns, without blocking, when enrolled students have another meeting then", async () => {
    // sEnrolled also takes O2; O2 has a meeting on the 14th, 09:00–11:00.
    const { rows } = await q<{ id: string; student_id: string }>(
      `SELECT pe.id, pe.student_id FROM programme_enrollments pe
         JOIN students s ON s.id = pe.student_id WHERE s.user_id = $1`,
      [p.sEnrolled.userId],
    );
    const pe = rows[0];
    await q(
      `INSERT INTO course_enrollments (programme_enrollment_id, course_offering_id, student_id, selection, status)
       VALUES ($1, $2, $3, 'MANUAL', 'ENROLLED')`,
      [pe?.id, p.world.offerings.O2, pe?.student_id],
    );
    const o2Meeting = (
      await q<{ id: string }>(
        "SELECT id FROM class_meetings WHERE course_offering_id = $1 AND title = 'Hermeneutics'",
        [p.world.offerings.O2],
      )
    ).rows[0]?.id;

    const res = await schedule("l1Primary", p.world.offerings.O1, {
      scheduledStart: "2080-09-14T08:00:00Z",
      scheduledEnd: "2080-09-14T09:30:00Z",
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<{ warnings: ScheduleWarning[] }>().warnings).toEqual([
      { code: "STUDENT_SCHEDULE_CLASH", count: 1, sampleMeetingIds: [o2Meeting] },
    ]);
  });
});

describe("reading Class Meetings", () => {
  it("shows students their meetings with the Room, but not the link itself", async () => {
    const res = await t.request({
      url: "/api/v1/me/schedule?from=2080-09-01T00:00:00Z&to=2080-09-10T00:00:00Z",
      headers: p.sEnrolled.headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json<{ items: (ClassMeeting & { as: string })[] }>().items;
    expect(items.map((i) => i.title)).toEqual(["Week 1: Introduction", "Class"]);
    expect(items[0]).toMatchObject({
      as: "STUDENT",
      courseCode: "PBIB101",
      room: { code: "CHAPEL", name: "Room CHAPEL" },
      hasOnlineLink: true,
      onlineLink: null,
    });
  });

  it("shows Lecturers their teaching, with the link", async () => {
    const res = await t.request({
      url: "/api/v1/me/schedule?from=2080-09-01T00:00:00Z&to=2080-09-10T00:00:00Z",
      headers: p.l1Primary.headers,
    });
    const items = res.json<{ items: (ClassMeeting & { as: string })[] }>().items;
    expect(items[0]).toMatchObject({ as: "LECTURER", onlineLink: MEET });
    // The overridden meeting on O3 is theirs too.
    expect(items.map((i) => i.title)).toContain("Clashing class");
  });

  it("shows nothing of other offerings", async () => {
    const res = await t.request({
      url: "/api/v1/me/schedule?from=2080-09-01T00:00:00Z&to=2080-09-10T00:00:00Z",
      headers: p.sOther.headers,
    });
    expect(res.json<{ items: unknown[] }>().items).toEqual([]);
    const list = await t.request({
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/class-meetings`,
      headers: p.sOther.headers,
    });
    expect(list.statusCode).toBe(404);
  });

  it("lists an offering's meetings in order for its students, without links", async () => {
    const res = await t.request({
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/class-meetings`,
      headers: p.sEnrolled.headers,
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: ClassMeeting[] }>().items;
    const starts = items.map((i) => i.scheduledStart);
    expect(starts).toEqual([...starts].sort());
    expect(items.every((i) => i.onlineLink === null)).toBe(true);
  });
});

describe("changing a Class Meeting", () => {
  it("updates the link with If-Match, and refuses a stale version or a non-Meet link", async () => {
    const created = await schedule("l1Primary", p.world.offerings.O1, {
      scheduledStart: "2080-10-05T09:00:00Z",
      scheduledEnd: "2080-10-05T10:00:00Z",
    });
    const meeting = created.json<{ meeting: ClassMeeting }>().meeting;
    const patch = (payload: unknown, version: number) =>
      t.request({
        method: "PATCH",
        url: `/api/v1/class-meetings/${meeting.id}`,
        headers: { ...p.l2Co.headers, "if-match": `"${String(version)}"` },
        payload,
      });
    const ok = await patch({ onlineLink: "https://meet.google.com/xyz-abcd-efg" }, meeting.version);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<{ meeting: ClassMeeting }>().meeting).toMatchObject({
      onlineLink: "https://meet.google.com/xyz-abcd-efg",
      version: meeting.version + 1,
    });
    expect((await patch({ title: "Stale" }, meeting.version)).statusCode).toBe(412);
    const bad = await patch({ onlineLink: "https://example.com" }, meeting.version + 1);
    expect(bad.json<ErrorBody>().error.code).toBe("ONLINE_LINK_INVALID");
    const cleared = await patch({ onlineLink: "" }, meeting.version + 1);
    expect(cleared.json<{ meeting: ClassMeeting }>().meeting).toMatchObject({
      hasOnlineLink: false,
    });
  });
});

describe("Lecturer assignments and their slots (§9.4)", () => {
  it("books a newly assigned Lecturer into future meetings, and frees them when the assignment ends", async () => {
    const lecturer = await lecturerOf("l4Other");
    const slotCount = async () =>
      Number(
        (
          await q<{ n: string }>(
            `SELECT count(*) AS n FROM meeting_lecturer_slots s JOIN class_meetings m ON m.id = s.class_meeting_id
              WHERE s.lecturer_id = $1 AND m.course_offering_id = $2`,
            [lecturer, p.world.offerings.O1],
          )
        ).rows[0]?.n,
      );
    // l4Other teaches O2 on the 14th 09:00–11:00, as does O1's meeting at 08:00–09:30.
    const busy = await t.request({
      method: "POST",
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/lecturers`,
      headers: p.acadAdmin.headers,
      payload: { lecturerId: lecturer, role: "CO_LECTURER" },
    });
    expect(busy.statusCode).toBe(409);
    expect(busy.json<ErrorBody>().error.code).toBe("LECTURER_SCHEDULE_CONFLICT");
    expect(await slotCount()).toBe(0);

    // Without the clash the assignment goes through and books every future O1 meeting.
    // Cancel the clashing O2 meeting the way cancelling will (ticket 24): it frees the Lecturers.
    await q("UPDATE class_meetings SET state = 'CANCELLED' WHERE title = 'Hermeneutics'");
    await q(
      "DELETE FROM meeting_lecturer_slots WHERE class_meeting_id IN (SELECT id FROM class_meetings WHERE title = 'Hermeneutics')",
    );
    const assigned = await t.request({
      method: "POST",
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/lecturers`,
      headers: p.acadAdmin.headers,
      payload: { lecturerId: lecturer, role: "CO_LECTURER" },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    const meetings = await q<{ n: string }>(
      "SELECT count(*) AS n FROM class_meetings WHERE course_offering_id = $1 AND state <> 'CANCELLED'",
      [p.world.offerings.O1],
    );
    expect(await slotCount()).toBe(Number(meetings.rows[0]?.n));

    const { rows } = await q<{ id: string }>(
      "SELECT id FROM lecturer_assignments WHERE lecturer_id = $1 AND course_offering_id = $2 AND status = 'ACTIVE'",
      [lecturer, p.world.offerings.O1],
    );
    const ended = await t.request({
      method: "DELETE",
      url: `/api/v1/course-offerings/${p.world.offerings.O1}/lecturers/${rows[0]?.id ?? ""}`,
      headers: p.acadAdmin.headers,
    });
    expect(ended.statusCode, ended.body).toBe(204);
    expect(await slotCount()).toBe(0);
  });
});
