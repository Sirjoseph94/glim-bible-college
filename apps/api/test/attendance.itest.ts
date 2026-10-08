import type { ClassMeeting, DomainEvent, MeetingAttendance, MyAttendance } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { AttendanceService } from "@glim/modules/attendance";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService, MeetingLifecycleService } from "@glim/modules/class-meeting";
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
    unwrap(await t.app.get(MeetingLifecycleService).start(m.id, SYSTEM_ACTOR));
    unwrap(await t.app.get(MeetingLifecycleService).end(m.id, SYSTEM_ACTOR));
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
    for (const who of ["sEnrolled", "sOther", "l4Other"] as const) {
      const denied = await t.request({
        url: `/api/v1/class-meetings/${m.id}/attendance`,
        headers: p[who].headers,
      });
      expect([403, 404], who).toContain(denied.statusCode);
    }
  });
});
