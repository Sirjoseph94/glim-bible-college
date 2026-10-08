import type { ClassMeeting, RollCall } from "@glim/contracts";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService, MeetingLifecycleService } from "@glim/modules/class-meeting";
import { FilesService } from "@glim/modules/content";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import {
  createPersonas,
  createUser,
  sessionFor,
  type PersonaName,
  type Personas,
} from "./personas";

/**
 * Roll call (TRD §12.3; v1 spec: marks carry a mode). O1 is taught by l1Primary, l2Co and
 * l3Assistant and taken by sEnrolled (online); two more students are added here, one on campus.
 */

let t: TestApp;
let p: Personas;
let m: ClassMeeting;
const extra: Record<"campus" | "online", string> = { campus: "", online: "" };

interface ErrorBody {
  error: { code: string };
}

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

async function at(iso: string): Promise<void> {
  t.clock.set(iso);
  for (const name of Object.keys(p).filter((k) => k !== "world") as PersonaName[])
    p[name].headers = await sessionFor(t, p[name].userId);
}

const getRollCall = (as: PersonaName, id = m.id) =>
  t.request({ url: `/api/v1/class-meetings/${id}/roll-call`, headers: p[as].headers });

const putRollCall = (as: PersonaName, version: number, marks: unknown[], id = m.id) =>
  t.request({
    method: "PUT",
    url: `/api/v1/class-meetings/${id}/roll-call`,
    headers: { ...p[as].headers, "if-match": `"${String(version)}"` },
    payload: { marks },
  });

const studentIdOf = async (name: PersonaName) =>
  (await q<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [p[name].userId])).rows[0]
    ?.id ?? "";

/** Another student on O1, written directly like the personas. */
async function addStudent(given: string, family: string, mode: "ON_CAMPUS" | "ONLINE") {
  const user = await createUser(t, { email: `${given.toLowerCase()}@rollcall.glim.test` });
  const studentId = (
    await q<{ id: string }>(
      "INSERT INTO students (user_id, given_name, family_name) VALUES ($1, $2, $3) RETURNING id",
      [user.id, given, family],
    )
  ).rows[0]?.id;
  const pe = (
    await q<{ id: string }>(
      `INSERT INTO programme_enrollments (student_id, programme_id, curriculum_id, entry_session_id, matric_number, study_mode, started_on)
       VALUES ($1, $2, $3, $4, $5, $6, '2080-09-01') RETURNING id`,
      [
        studentId,
        p.world.programmeId,
        p.world.curriculumId,
        p.world.sessionId,
        `GLIM/RC/2080/${family}`,
        mode,
      ],
    )
  ).rows[0]?.id;
  const se = (
    await q<{ id: string }>(
      "INSERT INTO semester_enrollments (programme_enrollment_id, semester_id, level_no) VALUES ($1, $2, 1) RETURNING id",
      [pe, p.world.semesterId],
    )
  ).rows[0]?.id;
  await q(
    `INSERT INTO course_enrollments (semester_enrollment_id, programme_enrollment_id, course_offering_id, student_id, selection, status)
     VALUES ($1, $2, $3, $4, 'COMPULSORY', 'ENROLLED')`,
    [se, pe, p.world.offerings.O1, studentId],
  );
  return studentId ?? "";
}

beforeAll(async () => {
  t = await createTestApp();
  t.clock.set("2026-11-03T06:00:00Z");
  p = await createPersonas(t);
  extra.campus = await addStudent("Ada", "Campus", "ON_CAMPUS");
  extra.online = await addStudent("Bola", "Zonline", "ONLINE");
  m = unwrap(
    await t.app.get(ClassMeetingsService).create(
      p.world.offerings.O1,
      {
        title: "Roll call class",
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

describe("the roll call window", () => {
  it("is closed until 15 minutes before the start", async () => {
    await at("2026-11-03T08:44:00Z");
    const view = await getRollCall("l1Primary");
    expect(view.statusCode, view.body).toBe(200);
    expect(view.json<RollCall>()).toMatchObject({
      open: false,
      opensAt: "2026-11-03T08:45:00.000Z",
      closesAt: null,
    });
    const res = await putRollCall("l1Primary", 0, [
      { studentId: extra.campus, present: true, late: false, mode: "IN_PERSON" },
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json<ErrorBody>().error.code).toBe("ROLL_CALL_CLOSED");
  });
});

describe("taking roll call", () => {
  it("lists the enrolled students, on-campus first, with no marks yet", async () => {
    await at("2026-11-03T08:50:00Z");
    const view = (await getRollCall("l3Assistant")).json<RollCall>();
    expect(view).toMatchObject({ version: 0, open: true });
    expect(view.students.map((s) => [s.name, s.studyMode, s.mark])).toEqual([
      ["Ada Campus", "ON_CAMPUS", null],
      ["sEnrolled Persona", "ONLINE", null],
      ["Bola Zonline", "ONLINE", null],
    ]);
  });

  it("saves a batch of marks with If-Match, audits it and queues a recompute", async () => {
    const enrolled = await studentIdOf("sEnrolled");
    const res = await putRollCall("l1Primary", 0, [
      { studentId: extra.campus, present: true, late: false, mode: "IN_PERSON" },
      { studentId: enrolled, present: true, late: true, mode: "ONLINE" },
      { studentId: extra.online, present: false, late: false, mode: "ONLINE" },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json<RollCall>();
    expect(view.version).toBe(1);
    expect(view.students.map((s) => s.mark)).toEqual([
      { present: true, late: false, mode: "IN_PERSON" },
      { present: true, late: true, mode: "ONLINE" },
      { present: false, late: false, mode: "ONLINE" },
    ]);
    const audit = await q<{ metadata: { changed: unknown[] } }>(
      "SELECT metadata FROM audit_logs WHERE action = 'attendance.roll-call.updated' AND resource_id = $1",
      [m.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.metadata.changed).toHaveLength(3);
    const jobs = await q<{ n: string }>(
      "SELECT count(*) AS n FROM pgboss.job WHERE name = 'attendance.recompute' AND data->>'meetingId' = $1",
      [m.id],
    );
    expect(Number(jobs.rows[0]?.n)).toBe(1);
  });

  it("refuses a stale version, students not on the course, and late without present", async () => {
    const mark = { studentId: extra.campus, present: false, late: false, mode: "IN_PERSON" };
    expect((await putRollCall("l2Co", 0, [mark])).statusCode).toBe(412);
    const stranger = await putRollCall("l2Co", 1, [
      { ...mark, studentId: await studentIdOf("sOther") },
    ]);
    expect(stranger.statusCode).toBe(400);
    const completed = await putRollCall("l2Co", 1, [
      { ...mark, studentId: await studentIdOf("sCompleted") },
    ]);
    expect(completed.statusCode).toBe(400);
    const late = await putRollCall("l2Co", 1, [{ ...mark, late: true }]);
    expect(late.statusCode).toBe(400);
  });

  it("treats a resend of the same marks as no change", async () => {
    const res = await putRollCall("l2Co", 1, [
      { studentId: extra.campus, present: true, late: false, mode: "IN_PERSON" },
    ]);
    expect(res.json<RollCall>().version).toBe(1);
    const audit = await q<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'attendance.roll-call.updated' AND resource_id = $1",
      [m.id],
    );
    expect(Number(audit.rows[0]?.n)).toBe(1);
  });

  it("is only for the class's Lecturers and admins", async () => {
    for (const who of ["l4Other", "sEnrolled", "registrar", "noRole"] as const)
      expect([403, 404], who).toContain((await getRollCall(who)).statusCode);
    expect((await getRollCall("acadAdmin")).statusCode).toBe(200);
  });

  it("shows passport photos through short-lived links", async () => {
    const file = await t.app.get(FilesService).store({
      ownerUserId: p.acadAdmin.userId,
      purpose: "PASSPORT_PHOTO",
      name: "ada.jpg",
      mime: "image/jpeg",
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });
    await q("UPDATE students SET photo_file_id = $1 WHERE id = $2", [file.id, extra.campus]);
    const view = (await getRollCall("l1Primary")).json<RollCall>();
    expect(view.students[0]?.photoUrl).toMatch(/^https?:\/\/.+X-Amz-Signature=/);
    expect(view.students[1]?.photoUrl).toBeNull();
  });
});

describe("roll call and the meeting's state", () => {
  it("makes a class that never went online ENDED rather than NO_SHOW", async () => {
    await at("2026-11-03T12:01:00Z");
    expect(await t.app.get(MeetingLifecycleService).tick()).toEqual({ ENDED: 1 });
    const state = await q<{ state: string }>("SELECT state FROM class_meetings WHERE id = $1", [
      m.id,
    ]);
    expect(state.rows[0]?.state).toBe("ENDED");
  });

  it("stays open until a week after finalization", async () => {
    const mark = [{ studentId: extra.online, present: true, late: false, mode: "ONLINE" }];
    await q("UPDATE class_meetings SET finalized_at = $2 WHERE id = $1", [
      m.id,
      "2026-10-28T12:00:00Z",
    ]);
    const open = await putRollCall("l1Primary", 1, mark);
    expect(open.statusCode, open.body).toBe(200);
    await q("UPDATE class_meetings SET finalized_at = $2 WHERE id = $1", [
      m.id,
      "2026-10-27T12:00:00Z",
    ]);
    const locked = await putRollCall("l1Primary", 2, mark);
    expect(locked.json<ErrorBody>().error.code).toBe("ROLL_CALL_CLOSED");
  });
});
