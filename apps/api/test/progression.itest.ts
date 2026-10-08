import {
  CalendarService,
  CoursesService,
  CurriculaService,
  ProgrammesService,
} from "@glim/modules/academic";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { AuthorizationService } from "@glim/modules/authorization";
import { ProgressionService } from "@glim/modules/enrollment";
import { AssignmentsService } from "@glim/modules/lecturing";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, createUser, type Personas } from "./personas";

/**
 * Semester close and Year 1 → Year 2 progression (TRD §9.1, D-03). The tests run in order: the
 * semester in the earlier Academic Session closes first, so that session can close and the later
 * one can be activated.
 */

let t: TestApp;
let p: Personas;
let diploma: { programmeId: string; curriculumId: string };
let certificate: { programmeId: string; curriculumId: string };
let earlier: string;
let later: string;
let semesterId: string;
const offerings: Record<"published" | "active" | "draft" | "cancelled", string> = {
  published: "",
  active: "",
  draft: "",
  cancelled: "",
};

const q = <R extends object = { id: string }>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);
const one = async (text: string, values: unknown[] = []) => {
  const row = (await q(text, values)).rows[0];
  if (row === undefined) throw new Error(`no row: ${text}`);
  return row.id;
};

let matric = 0;
/** A student with one programme enrollment, written directly (no admissions needed). */
async function student(input: {
  programme: { programmeId: string; curriculumId: string };
  entrySessionId: string;
  level: number;
  status?: "ACTIVE" | "WITHDRAWN";
}) {
  matric++;
  const user = await createUser(t, { email: `progression${String(matric)}@glim.test` });
  const studentId = await one(
    "INSERT INTO students (user_id, given_name, family_name) VALUES ($1, 'Pat', 'Progress') RETURNING id",
    [user.id],
  );
  const enrollmentId = await one(
    `INSERT INTO programme_enrollments (student_id, programme_id, curriculum_id, entry_session_id, matric_number, study_mode, current_level, started_on, status)
     VALUES ($1, $2, $3, $4, $5, 'ONLINE', $6, '2060-09-01', $7) RETURNING id`,
    [
      studentId,
      input.programme.programmeId,
      input.programme.curriculumId,
      input.entrySessionId,
      `GLIM/PRG/2060/${String(matric).padStart(4, "0")}`,
      input.level,
      input.status ?? "ACTIVE",
    ],
  );
  return { userId: user.id, studentId, enrollmentId };
}

async function enroll(
  s: { studentId: string; enrollmentId: string },
  offeringId: string,
  status: "ENROLLED" | "DROPPED",
) {
  await q(
    `INSERT INTO semester_enrollments (programme_enrollment_id, semester_id, level_no) VALUES ($1, $2, 1)
     ON CONFLICT DO NOTHING`,
    [s.enrollmentId, semesterId],
  );
  const semesterEnrollmentId = await one(
    "SELECT id FROM semester_enrollments WHERE programme_enrollment_id = $1 AND semester_id = $2",
    [s.enrollmentId, semesterId],
  );
  return one(
    `INSERT INTO course_enrollments (semester_enrollment_id, programme_enrollment_id, course_offering_id, student_id, selection, status)
     VALUES ($1, $2, $3, $4, 'COMPULSORY', $5) RETURNING id`,
    [semesterEnrollmentId, s.enrollmentId, offeringId, s.studentId, status],
  );
}

const level = async (enrollmentId: string) =>
  (
    await q<{ current_level: number }>(
      "SELECT current_level FROM programme_enrollments WHERE id = $1",
      [enrollmentId],
    )
  ).rows[0]?.current_level;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  const programmes = t.app.get(ProgrammesService);
  const curricula = t.app.get(CurriculaService);
  const programme = async (code: string, levels: number) => {
    const created = unwrap(
      await programmes.create(
        {
          code,
          name: `${code} programme`,
          awardType: levels === 2 ? "DIPLOMA" : "CERTIFICATE",
          durationSemesters: 2 * levels,
          levels,
        },
        SYSTEM_ACTOR,
      ),
    );
    const curriculum = unwrap(
      await curricula.create(
        { programmeId: created.id, effectiveFrom: "2060-09-01", minElectiveCredits: "0.0" },
        SYSTEM_ACTOR,
      ),
    );
    return { programmeId: created.id, curriculumId: curriculum.id };
  };
  diploma = await programme("PRGDIP", 2);
  certificate = await programme("PRGCERT", 1);

  const calendar = t.app.get(CalendarService);
  earlier = unwrap(
    await calendar.createSession(
      { code: "2060/2061", name: "2060/2061", startsOn: "2060-09-01", endsOn: "2061-06-30" },
      SYSTEM_ACTOR,
    ),
  ).id;
  later = unwrap(
    await calendar.createSession(
      { code: "2061/2062", name: "2061/2062", startsOn: "2061-09-01", endsOn: "2062-06-30" },
      SYSTEM_ACTOR,
    ),
  ).id;
  unwrap(await calendar.activateSession(earlier, SYSTEM_ACTOR));
  semesterId = unwrap(
    await calendar.createSemester(
      {
        academicSessionId: earlier,
        code: "S1",
        name: "First Semester",
        sequence: 1,
        startsOn: "2060-09-04",
        endsOn: "2061-01-26",
      },
      SYSTEM_ACTOR,
    ),
  ).id;

  const course = unwrap(
    await t.app
      .get(CoursesService)
      .create(
        { code: "PRG101", title: "Progression", description: null, credits: "2.0" },
        SYSTEM_ACTOR,
      ),
  );
  const assignments = t.app.get(AssignmentsService);
  for (const [i, key] of (["published", "active", "draft", "cancelled"] as const).entries()) {
    const offering = unwrap(
      await assignments.createOfferingWithLecturers(
        {
          courseId: course.id,
          semesterId,
          sectionCode: `0${String(i + 1)}`,
          titleOverride: null,
          capacity: null,
          lecturers: [],
        },
        SYSTEM_ACTOR,
      ),
    );
    offerings[key] = offering;
    await q("UPDATE course_offerings SET status = $2 WHERE id = $1", [
      offering,
      key.toUpperCase(),
    ]);
  }
  unwrap(await calendar.openRegistration(semesterId, SYSTEM_ACTOR));
  unwrap(await calendar.activateSemester(semesterId, SYSTEM_ACTOR));
});

afterAll(async () => {
  await t.close();
});

describe("closing a semester", () => {
  let finisher: Awaited<ReturnType<typeof student>>;
  let classmate: Awaited<ReturnType<typeof student>>;
  const courseEnrollments: Record<string, string> = {};

  beforeAll(async () => {
    finisher = await student({ programme: diploma, entrySessionId: earlier, level: 1 });
    classmate = await student({ programme: diploma, entrySessionId: earlier, level: 1 });
    courseEnrollments.finished = await enroll(finisher, offerings.published, "ENROLLED");
    courseEnrollments.dropped = await enroll(finisher, offerings.active, "DROPPED");
    courseEnrollments.classmate = await enroll(classmate, offerings.active, "ENROLLED");
  });

  it("completes the running offerings and the ENROLLED course enrollments, and emits academic.semester.closed", async () => {
    const res = await t.request({
      method: "POST",
      url: `/api/v1/semesters/${semesterId}/close`,
      headers: p.acadAdmin.headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("CLOSED");

    const offeringRows = await q<{ id: string; status: string; completed_at: Date | null }>(
      "SELECT id, status, completed_at FROM course_offerings WHERE semester_id = $1",
      [semesterId],
    );
    const byId = new Map(offeringRows.rows.map((r) => [r.id, r]));
    for (const key of ["published", "active"] as const) {
      expect(byId.get(offerings[key])?.status).toBe("COMPLETED");
      expect(byId.get(offerings[key])?.completed_at).toBeInstanceOf(Date);
    }
    expect(byId.get(offerings.draft)).toMatchObject({ status: "DRAFT", completed_at: null });
    expect(byId.get(offerings.cancelled)).toMatchObject({
      status: "CANCELLED",
      completed_at: null,
    });

    const statuses = await q<{ id: string; status: string }>(
      "SELECT id, status FROM course_enrollments WHERE id = ANY($1)",
      [Object.values(courseEnrollments)],
    );
    expect(Object.fromEntries(statuses.rows.map((r) => [r.id, r.status]))).toEqual({
      [courseEnrollments.finished ?? ""]: "COMPLETED",
      [courseEnrollments.dropped ?? ""]: "DROPPED",
      [courseEnrollments.classmate ?? ""]: "COMPLETED",
    });
    const events = await q<{ from_status: string; to_status: string; reason: string }>(
      "SELECT from_status, to_status, reason FROM course_enrollment_events WHERE course_enrollment_id = ANY($1)",
      [Object.values(courseEnrollments)],
    );
    expect(events.rows).toEqual([
      { from_status: "ENROLLED", to_status: "COMPLETED", reason: "Semester closed" },
      { from_status: "ENROLLED", to_status: "COMPLETED", reason: "Semester closed" },
    ]);
    const emitted = await q<{ n: string }>(
      "SELECT count(*) AS n FROM pgboss.job WHERE name = 'domain-event' AND data->>'name' = 'academic.semester.closed' AND data->'payload'->>'semesterId' = $1",
      [semesterId],
    );
    expect(Number(emitted.rows[0]?.n)).toBe(1);
  });

  it("can't close a semester twice", async () => {
    const res = await t.request({
      method: "POST",
      url: `/api/v1/semesters/${semesterId}/close`,
      headers: p.acadAdmin.headers,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe("SEMESTER_STATE_INVALID");
  });

  it("leaves completed students read-only access to materials and recordings while their programme enrollment is active", async () => {
    const authz = t.app.get(AuthorizationService);
    const decide = (userId: string, permission: Parameters<typeof authz.authorize>[1]) =>
      authz.authorize(authz.principal(userId), permission, {
        type: "course-offering",
        id: offerings.published,
      });
    expect(await decide(finisher.userId, "content:material:read")).toBe("ALLOW");
    expect(await decide(finisher.userId, "video:asset:read")).toBe("ALLOW");
    expect(await decide(finisher.userId, "video:asset:play")).toBe("ALLOW");
    expect(await decide(finisher.userId, "academic:course-offering:read")).toBe("ALLOW");
    // Taking part needs ENROLLED.
    expect(await decide(finisher.userId, "meeting:class-meeting:join")).not.toBe("ALLOW");
    expect(await decide(finisher.userId, "assessment:quiz:attempt")).not.toBe("ALLOW");

    // Once the programme enrollment ends, so does the access.
    await q("UPDATE programme_enrollments SET status = 'WITHDRAWN' WHERE id = $1", [
      finisher.enrollmentId,
    ]);
    expect(await decide(finisher.userId, "content:material:read")).not.toBe("ALLOW");
    expect(await decide(finisher.userId, "video:asset:play")).not.toBe("ALLOW");
  });
});

describe("progression when an Academic Session is activated", () => {
  const people: Record<string, Awaited<ReturnType<typeof student>>> = {};

  beforeAll(async () => {
    people.dueDiploma = await student({ programme: diploma, entrySessionId: earlier, level: 1 });
    people.newDiploma = await student({ programme: diploma, entrySessionId: later, level: 1 });
    people.yearTwo = await student({ programme: diploma, entrySessionId: earlier, level: 2 });
    people.certificate = await student({
      programme: certificate,
      entrySessionId: earlier,
      level: 1,
    });
    people.withdrawn = await student({
      programme: diploma,
      entrySessionId: earlier,
      level: 1,
      status: "WITHDRAWN",
    });
  });

  it("does nothing for a session that isn't active", async () => {
    expect(await t.app.get(ProgressionService).run(later)).toBe(0);
    expect(await level(people.dueDiploma?.enrollmentId ?? "")).toBe(1);
  });

  it("moves active Year 1 Diploma students from earlier sessions to Year 2, audited one by one", async () => {
    const close = await t.request({
      method: "POST",
      url: `/api/v1/academic-sessions/${earlier}/close`,
      headers: p.acadAdmin.headers,
    });
    expect(close.statusCode, close.body).toBe(200);
    const activate = await t.request({
      method: "POST",
      url: `/api/v1/academic-sessions/${later}/activate`,
      headers: p.acadAdmin.headers,
    });
    expect(activate.statusCode, activate.body).toBe(200);
    const emitted = await q<{ n: string }>(
      "SELECT count(*) AS n FROM pgboss.job WHERE name = 'domain-event' AND data->>'name' = 'academic.session.activated' AND data->'payload'->>'sessionId' = $1",
      [later],
    );
    expect(Number(emitted.rows[0]?.n)).toBe(1);

    // The activation's job, as the worker runs it. The closing-semester students (Year 1
    // Diploma, entered in the earlier session) move too; the withdrawn one doesn't.
    const moved = await t.app.get(ProgressionService).run(later);
    expect(await level(people.dueDiploma?.enrollmentId ?? "")).toBe(2);
    expect(await level(people.newDiploma?.enrollmentId ?? "")).toBe(1);
    expect(await level(people.yearTwo?.enrollmentId ?? "")).toBe(2);
    expect(await level(people.certificate?.enrollmentId ?? "")).toBe(1);
    expect(await level(people.withdrawn?.enrollmentId ?? "")).toBe(1);

    const audited = await q<{ resource_id: string; metadata: unknown }>(
      "SELECT resource_id, metadata FROM audit_logs WHERE action = 'enrollment.programme-enrollment.progressed'",
    );
    expect(audited.rows).toHaveLength(moved);
    expect(audited.rows.map((r) => r.resource_id)).toContain(people.dueDiploma?.enrollmentId);
    expect(audited.rows[0]?.metadata).toEqual({
      fromLevel: 1,
      toLevel: 2,
      academicSessionId: later,
    });
  });

  it("is idempotent: running it again moves no one", async () => {
    const before = await q<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'enrollment.programme-enrollment.progressed'",
    );
    expect(await t.app.get(ProgressionService).run(later)).toBe(0);
    const after = await q<{ n: string }>(
      "SELECT count(*) AS n FROM audit_logs WHERE action = 'enrollment.programme-enrollment.progressed'",
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });
});
