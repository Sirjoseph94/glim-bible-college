import type {
  AttendanceReport,
  ClassMeeting,
  DomainEvent,
  MeetingAttendance,
  MyAttendance,
} from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { AttendanceService } from "@glim/modules/attendance";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService, MeetingLifecycleService } from "@glim/modules/class-meeting";
import { AssignmentsService, LecturersService } from "@glim/modules/lecturing";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDispatcher, createSubscribers } from "../../worker/src/subscribers";
import { createTestApp, type TestApp } from "./harness";
import {
  createPersonas,
  createUser,
  sessionFor,
  type PersonaName,
  type Personas,
} from "./personas";

/**
 * Attendance records (TRD §12.5–12.6; v1: computed from roll call alone). O1 is taught by
 * l1Primary and taken by sEnrolled; Ada (on campus), Bola, a student who dropped before the class
 * and one who joined the course during it are added here. The class is 09:00–11:00 on 3 Nov.
 */

let t: TestApp;
let p: Personas;
let m: ClassMeeting;
const people: Record<"ada" | "bola" | "dropped" | "joined" | "enrolled", string> = {
  ada: "",
  bola: "",
  dropped: "",
  joined: "",
  enrolled: "",
};

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

async function at(iso: string): Promise<void> {
  t.clock.set(iso);
  for (const name of Object.keys(p).filter((k) => k !== "world") as PersonaName[])
    p[name].headers = await sessionFor(t, p[name].userId);
}

async function addStudent(
  given: string,
  mode: "ON_CAMPUS" | "ONLINE",
  course: { status: string; enrolledAt: string; droppedAt?: string },
) {
  const user = await createUser(t, { email: `${given.toLowerCase()}@attendance.glim.test` });
  const one = async (text: string, values: unknown[]) =>
    (await q<{ id: string }>(text, values)).rows[0]?.id ?? "";
  const studentId = await one(
    "INSERT INTO students (user_id, given_name, family_name) VALUES ($1, $2, 'Student') RETURNING id",
    [user.id, given],
  );
  const pe = await one(
    `INSERT INTO programme_enrollments (student_id, programme_id, curriculum_id, entry_session_id, matric_number, study_mode, started_on)
     VALUES ($1, $2, $3, $4, $5, $6, '2080-09-01') RETURNING id`,
    [
      studentId,
      p.world.programmeId,
      p.world.curriculumId,
      p.world.sessionId,
      `GLIM/AT/${given}`,
      mode,
    ],
  );
  const se = await one(
    "INSERT INTO semester_enrollments (programme_enrollment_id, semester_id, level_no) VALUES ($1, $2, 1) RETURNING id",
    [pe, p.world.semesterId],
  );
  await q(
    `INSERT INTO course_enrollments (semester_enrollment_id, programme_enrollment_id, course_offering_id, student_id, selection, status, enrolled_at, dropped_at)
     VALUES ($1, $2, $3, $4, 'ELECTIVE', $5, $6, $7)`,
    [
      se,
      pe,
      p.world.offerings.O1,
      studentId,
      course.status,
      course.enrolledAt,
      course.droppedAt ?? null,
    ],
  );
  return studentId;
}

function mark(studentId: string, present: boolean, late = false, mode = "IN_PERSON") {
  return { studentId, present, late, mode };
}

async function putMarks(version: number, marks: unknown[]) {
  const res = await t.request({
    method: "PUT",
    url: `/api/v1/class-meetings/${m.id}/roll-call`,
    headers: { ...p.l1Primary.headers, "if-match": `"${String(version)}"` },
    payload: { marks },
  });
  expect(res.statusCode, res.body).toBe(200);
}

const record = async (studentId: string) =>
  (
    await q<{
      status: string;
      computed_status: string;
      attendance_mode: string;
      ratio_bp: number;
      late: boolean;
      calc_version: number;
    }>(
      "SELECT status, computed_status, attendance_mode, ratio_bp, late, calc_version FROM attendance_records WHERE class_meeting_id = $1 AND student_id = $2",
      [m.id, studentId],
    )
  ).rows[0];

beforeAll(async () => {
  t = await createTestApp();
  t.clock.set("2026-11-03T06:00:00Z");
  p = await createPersonas(t);
  people.enrolled =
    (await q<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [p.sEnrolled.userId]))
      .rows[0]?.id ?? "";
  people.ada = await addStudent("Ada", "ON_CAMPUS", {
    status: "ENROLLED",
    enrolledAt: "2026-09-01T00:00:00Z",
  });
  people.bola = await addStudent("Bola", "ONLINE", {
    status: "ENROLLED",
    enrolledAt: "2026-09-01T00:00:00Z",
  });
  people.dropped = await addStudent("Dayo", "ONLINE", {
    status: "DROPPED",
    enrolledAt: "2026-09-01T00:00:00Z",
    droppedAt: "2026-11-02T12:00:00Z",
  });
  people.joined = await addStudent("Jide", "ONLINE", {
    status: "ENROLLED",
    enrolledAt: "2026-11-03T10:00:00Z",
  });
  m = unwrap(
    await t.app.get(ClassMeetingsService).create(
      p.world.offerings.O1,
      {
        title: "Attendance class",
        scheduledStart: "2026-11-03T09:00:00Z",
        scheduledEnd: "2026-11-03T11:00:00Z",
      },
      { ...SYSTEM_ACTOR, userId: p.acadAdmin.userId },
    ),
  ).meeting;
});

afterAll(async () => {
  await t.close();
});

describe("recomputing from roll call", () => {
  it("writes a record per student enrolled at any time during the class", async () => {
    await at("2026-11-03T08:50:00Z");
    await putMarks(0, [
      mark(people.ada, true),
      mark(people.enrolled, true, true, "ONLINE"),
      mark(people.bola, false),
    ]);
    const service = t.app.get(AttendanceService);
    expect(await service.recompute(m.id)).toBeGreaterThan(0);

    expect(await record(people.ada)).toMatchObject({
      status: "PRESENT",
      attendance_mode: "IN_PERSON",
      ratio_bp: 10000,
      late: false,
    });
    expect(await record(people.enrolled)).toMatchObject({
      status: "PRESENT",
      attendance_mode: "ONLINE",
      ratio_bp: 10000,
      late: true,
    });
    expect(await record(people.bola)).toMatchObject({ status: "ABSENT", attendance_mode: "NONE" });
    // Joined the course during the class: evaluated. Dropped before it: no record.
    expect(await record(people.joined)).toMatchObject({ status: "ABSENT" });
    expect(await record(people.dropped)).toBeUndefined();
    const state = await q<{ attendance_state: string }>(
      "SELECT attendance_state FROM class_meetings WHERE id = $1",
      [m.id],
    );
    expect(state.rows[0]?.attendance_state).toBe("PROVISIONAL");
  });

  it("is idempotent, and bumps calc_version only for records that change", async () => {
    const service = t.app.get(AttendanceService);
    expect(await service.recompute(m.id)).toBe(0);
    await putMarks(1, [mark(people.bola, true)]);
    expect(await service.recompute(m.id)).toBe(1);
    expect(await record(people.bola)).toMatchObject({ status: "PRESENT", calc_version: 2 });
    expect(await record(people.ada)).toMatchObject({ calc_version: 1 });
  });

  it("never writes the virtual status, and keeps an override through recompute", async () => {
    await expect(
      q("UPDATE attendance_records SET status = 'ABSENT' WHERE student_id = $1", [people.ada]),
    ).rejects.toThrow(/can only be updated to DEFAULT/);
    await q(
      "UPDATE attendance_records SET override_status = 'EXCUSED', override_reason = 'Hospital' WHERE class_meeting_id = $1 AND student_id = $2",
      [m.id, people.ada],
    );
    await putMarks(2, [mark(people.ada, false)]);
    expect(await t.app.get(AttendanceService).recompute(m.id)).toBe(1);
    expect(await record(people.ada)).toMatchObject({
      computed_status: "ABSENT",
      status: "EXCUSED",
    });
  });
});

describe("finalization", () => {
  it("finalizes an ended class, once, with an event", async () => {
    const service = t.app.get(AttendanceService);
    expect(await service.finalize(m.id)).toBe("SKIPPED"); // not ended yet
    await at("2026-11-03T09:05:00Z");
    unwrap(
      await t.app
        .get(MeetingLifecycleService)
        .start(m.id, { ...SYSTEM_ACTOR, userId: p.l1Primary.userId }),
    );
    unwrap(
      await t.app
        .get(MeetingLifecycleService)
        .end(m.id, { ...SYSTEM_ACTOR, userId: p.l1Primary.userId }),
    );
    // The worker's subscriber queues finalization after the 10-minute finalize delay.
    const dispatch = createDispatcher(createSubscribers(t.app));
    await drainQueues(t.boss, { "domain-event": (job) => dispatch(job.data as DomainEvent) });
    const finalizeJobs = await q<{ start_after: Date; created_on: Date }>(
      "SELECT start_after, created_on FROM pgboss.job WHERE name = 'class-meeting.finalize' AND data->>'meetingId' = $1",
      [m.id],
    );
    expect(finalizeJobs.rows).toHaveLength(1);
    const delay =
      (finalizeJobs.rows[0]?.start_after.getTime() ?? 0) -
      (finalizeJobs.rows[0]?.created_on.getTime() ?? 0);
    expect(Math.round(delay / 60_000)).toBe(10);

    await at("2026-11-03T09:20:00Z");
    expect(await service.finalize(m.id)).toBe("FINAL");
    expect(await service.finalize(m.id)).toBe("SKIPPED");
    const row = await q<{ attendance_state: string; finalized_at: Date }>(
      "SELECT attendance_state, finalized_at FROM class_meetings WHERE id = $1",
      [m.id],
    );
    expect(row.rows[0]).toMatchObject({ attendance_state: "FINAL" });
    expect(row.rows[0]?.finalized_at.toISOString()).toBe("2026-11-03T09:20:00.000Z");
    const events = await q<{ n: string }>(
      "SELECT count(*) AS n FROM pgboss.job WHERE name = 'domain-event' AND data->>'name' = 'attendance.finalized' AND data->'payload'->>'meetingId' = $1",
      [m.id],
    );
    expect(Number(events.rows[0]?.n)).toBe(1);
  });

  it("still recomputes within the week, and not after", async () => {
    const service = t.app.get(AttendanceService);
    await at("2026-11-09T09:00:00Z");
    await putMarks(3, [mark(people.joined, true, false, "ONLINE")]);
    expect(await service.recompute(m.id)).toBe(1);
    await at("2026-11-10T09:21:00Z");
    expect(await service.recompute(m.id)).toBe("LOCKED");
  });
});

describe("reading attendance", () => {
  it("shows a student their own attendance per course", async () => {
    const res = await t.request({ url: "/api/v1/me/attendance", headers: p.sEnrolled.headers });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<MyAttendance>().courses).toEqual([
      {
        offeringId: p.world.offerings.O1,
        courseCode: "PBIB101",
        courseTitle: "Persona Course",
        summary: { present: 1, partial: 0, absent: 0, excused: 0, late: 1 },
        meetings: [
          {
            meetingId: m.id,
            title: "Attendance class",
            scheduledStart: "2026-11-03T09:00:00.000Z",
            status: "PRESENT",
            mode: "ONLINE",
            late: true,
            final: true,
          },
        ],
      },
    ]);
    const nobody = await t.request({ url: "/api/v1/me/attendance", headers: p.sOther.headers });
    expect(nobody.json<MyAttendance>().courses).toEqual([]);
  });

  it("shows the class's Lecturers the meeting's records, and nobody else", async () => {
    const res = await t.request({
      url: `/api/v1/class-meetings/${m.id}/attendance`,
      headers: p.l1Primary.headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<MeetingAttendance>();
    expect(body).toMatchObject({
      attendanceState: "FINAL",
      finalizedAt: "2026-11-03T09:20:00.000Z",
      lockedAt: "2026-11-10T09:20:00.000Z",
    });
    expect(body.records.find((r) => r.studentId === people.ada)).toMatchObject({
      name: "Ada Student",
      status: "EXCUSED",
      computedStatus: "ABSENT",
      overrideStatus: "EXCUSED",
    });
    // The rule the page explains comes from the meeting's policy snapshot, not hard-coded words.
    expect(body.rule).toEqual({
      basis: "ACTUAL_CAPPED",
      presentThresholdBp: 7500,
      partialThresholdBp: 2500,
      lateGraceMinutes: 15,
    });
    // Roll call only, never online: there's no class length to tell.
    expect(body.ranSeconds).toBeNull();
    const original = await t.db.pool.query<{ s: unknown }>(
      "SELECT policy_snapshot AS s FROM class_meetings WHERE id = $1",
      [m.id],
    );
    await t.db.pool.query(
      `UPDATE class_meetings
          SET policy_snapshot = jsonb_set(coalesce(policy_snapshot, '{}'), '{attendance}',
                '{"version": 9, "config": {"basis": "SCHEDULED", "presentThresholdBp": 8000}}')
        WHERE id = $1`,
      [m.id],
    );
    const changed = await t.request({
      url: `/api/v1/class-meetings/${m.id}/attendance`,
      headers: p.l1Primary.headers,
    });
    expect(changed.json<MeetingAttendance>().rule).toMatchObject({
      basis: "SCHEDULED",
      presentThresholdBp: 8000,
    });
    await t.db.pool.query("UPDATE class_meetings SET policy_snapshot = $2 WHERE id = $1", [
      m.id,
      original.rows[0]?.s ?? null,
    ]);
    for (const who of ["sEnrolled", "sOther", "l4Other"] as const) {
      const denied = await t.request({
        url: `/api/v1/class-meetings/${m.id}/attendance`,
        headers: p[who].headers,
      });
      expect([403, 404], who).toContain(denied.statusCode);
    }
  });
});

describe("overrides and reports", () => {
  let fresh: ClassMeeting;
  const override = (as: PersonaName, meetingId: string, studentId: string, payload: unknown) =>
    t.request({
      method: "POST",
      url: `/api/v1/class-meetings/${meetingId}/attendance/${studentId}/override`,
      headers: p[as].headers,
      payload,
    });

  beforeAll(async () => {
    await at("2026-11-10T10:00:00Z");
    fresh = unwrap(
      await t.app.get(ClassMeetingsService).create(
        p.world.offerings.O1,
        {
          title: "Override class",
          scheduledStart: "2026-11-10T12:00:00Z",
          scheduledEnd: "2026-11-10T13:00:00Z",
        },
        { ...SYSTEM_ACTOR, userId: p.acadAdmin.userId },
      ),
    ).meeting;
    await at("2026-11-10T11:50:00Z");
    const res = await t.request({
      method: "PUT",
      url: `/api/v1/class-meetings/${fresh.id}/roll-call`,
      headers: { ...p.l1Primary.headers, "if-match": '"0"' },
      payload: { marks: [mark(people.bola, true)] },
    });
    expect(res.statusCode, res.body).toBe(200);
    await t.app.get(AttendanceService).recompute(fresh.id);
  });

  it("overrides with a reason, audited, and the override survives recompute", async () => {
    expect(
      (await override("l1Primary", fresh.id, people.bola, { status: "EXCUSED", reason: "Ill" }))
        .statusCode,
    ).toBe(400);
    const res = await override("l2Co", fresh.id, people.bola, {
      status: "EXCUSED",
      reason: "Family emergency",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      status: "EXCUSED",
      computedStatus: "PRESENT",
      overrideStatus: "EXCUSED",
    });
    const audit = await q<{ metadata: { reason: string; from: string; to: string } }>(
      "SELECT metadata FROM audit_logs WHERE action = 'attendance.record.overridden' AND resource_id = $1",
      [fresh.id],
    );
    expect(audit.rows[0]?.metadata).toMatchObject({
      reason: "Family emergency",
      from: "PRESENT",
      to: "EXCUSED",
    });

    const put = await t.request({
      method: "PUT",
      url: `/api/v1/class-meetings/${fresh.id}/roll-call`,
      headers: { ...p.l1Primary.headers, "if-match": '"1"' },
      payload: { marks: [mark(people.bola, false)] },
    });
    expect(put.statusCode).toBe(200);
    expect(await t.app.get(AttendanceService).recompute(fresh.id)).toBe(1);
    const row = (
      await q<{ status: string; computed_status: string }>(
        "SELECT status, computed_status FROM attendance_records WHERE class_meeting_id = $1 AND student_id = $2",
        [fresh.id, people.bola],
      )
    ).rows[0];
    expect(row).toEqual({ status: "EXCUSED", computed_status: "ABSENT" });
  });

  it("clears an override back to the computed status", async () => {
    const res = await t.request({
      method: "DELETE",
      url: `/api/v1/class-meetings/${fresh.id}/attendance/${people.bola}/override`,
      headers: p.l1Primary.headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: "ABSENT", overrideStatus: null });
    const audit = await q<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'attendance.record.override-cleared' AND resource_id = $1",
      [fresh.id],
    );
    expect(Number(audit.rows[0]?.n)).toBe(1);
  });

  it("refuses a student with no record, and Assistants and Guest Lecturers", async () => {
    const none = await override("l1Primary", fresh.id, people.dropped, {
      status: "EXCUSED",
      reason: "Not here",
    });
    expect(none.statusCode).toBe(404);
    const payload = { status: "EXCUSED", reason: "Should not work" };
    expect([403, 404]).toContain(
      (await override("l3Assistant", fresh.id, people.bola, payload)).statusCode,
    );
    // A Guest Lecturer on the course.
    const guest = await createUser(t, { email: "guest@attendance.glim.test" });
    const { lecturer } = unwrap(
      await t.app.get(LecturersService).create(
        {
          email: guest.email,
          title: null,
          givenName: "Guest",
          familyName: "Speaker",
          kind: "GUEST",
          staffCode: null,
        },
        SYSTEM_ACTOR,
      ),
    );
    unwrap(
      await t.app
        .get(AssignmentsService)
        .assign(p.world.offerings.O1, lecturer.id, "GUEST_LECTURER", SYSTEM_ACTOR),
    );
    const res = await t.request({
      method: "POST",
      url: `/api/v1/class-meetings/${fresh.id}/attendance/${people.bola}/override`,
      headers: await sessionFor(t, guest.id),
      payload,
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("reports student × meeting with the mode per cell and the policy version", async () => {
    const json = await t.request({
      url: `/api/v1/reports/attendance?offeringId=${p.world.offerings.O1}`,
      headers: p.l3Assistant.headers,
    });
    expect(json.statusCode, json.body).toBe(200);
    const report = json.json<AttendanceReport>();
    expect(report.meetings.map((x) => [x.title, x.policyVersion])).toEqual([
      ["Attendance class", 0],
      ["Override class", 0],
    ]);
    const ada = report.students.find((x) => x.studentId === people.ada);
    expect(ada?.cells[0]).toEqual({
      status: "EXCUSED",
      mode: "NONE",
      late: false,
      overridden: true,
    });

    const csv = await t.request({
      url: `/api/v1/reports/attendance?offeringId=${p.world.offerings.O1}&format=csv`,
      headers: p.registrar.headers,
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const [header, ...rows] = csv.body.trim().split("\r\n");
    expect(header).toBe(
      "Matric Number,Student,2026-11-03 Attendance class (policy v0),2026-11-10 Override class (policy v0)",
    );
    expect(rows.find((r) => r.includes("Ada Student"))).toContain("EXCUSED *");
    expect(rows.find((r) => r.includes("sEnrolled"))).toContain("PRESENT ONLINE LATE");

    for (const who of ["sOther", "l4Other", "sEnrolled"] as const) {
      const denied = await t.request({
        url: `/api/v1/reports/attendance?offeringId=${p.world.offerings.O1}`,
        headers: p[who].headers,
      });
      expect([403, 404], who).toContain(denied.statusCode);
    }
  });
});
