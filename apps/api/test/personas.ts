import type { StaffRole } from "@glim/contracts";
import { schema } from "@glim/db";
import {
  CalendarService,
  CoursesService,
  CurriculaService,
  ProgrammesService,
} from "@glim/modules/academic";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { SessionService } from "@glim/modules/identity";
import { AssignmentsService, LecturersService, type LecturerRole } from "@glim/modules/lecturing";
import { unwrap } from "@glim/shared";
import type { TestApp } from "./harness";

/** The offerings personas are attached to (TRD §7.5: O1 and O2). */
export type OfferingKey = "O1" | "O2";

/** A persona student's course enrollment status on a persona-world offering. */
export type StudyStatus = "ENROLLED" | "COMPLETED";

interface PersonaSpec {
  roles: readonly StaffRole[];
  /** Lecturer assignments on the persona world's offerings. */
  teaches?: Partial<Record<OfferingKey, LecturerRole>>;
  /** Course enrollments on the persona world's offerings (makes the persona a student). */
  studies?: Partial<Record<OfferingKey, StudyStatus>>;
  /** The student record's status; ACTIVE unless set (e.g. GRADUATED). */
  studentStatus?: "ACTIVE" | "GRADUATED";
}

/**
 * Test personas (TRD §7.5): staff, Lecturers with each assignment role, students in each
 * enrollment state (enrolled, completed, on the other offering, graduated) and an applicant.
 * `noRole` is an active user with no role and no profile. `applicant` starts the same way; tests
 * that need their application create it (an intake would disturb other tests).
 */
export const PERSONA_SPECS = {
  sysAdmin: { roles: ["SYSTEM_ADMIN"] },
  admOfficer: { roles: ["ADMISSIONS_OFFICER"] },
  registrar: { roles: ["REGISTRAR"] },
  acadAdmin: { roles: ["ACADEMIC_ADMIN"] },
  l1Primary: { roles: [], teaches: { O1: "PRIMARY" } },
  l2Co: { roles: [], teaches: { O1: "CO_LECTURER" } },
  l3Assistant: { roles: [], teaches: { O1: "ASSISTANT" } },
  l4Other: { roles: [], teaches: { O2: "PRIMARY" } },
  noRole: { roles: [] },
  sEnrolled: { roles: [], studies: { O1: "ENROLLED" } },
  sCompleted: { roles: [], studies: { O1: "COMPLETED" } },
  sOther: { roles: [], studies: { O2: "ENROLLED" } },
  sGraduated: { roles: [], studies: { O1: "COMPLETED" }, studentStatus: "GRADUATED" },
  applicant: { roles: [] },
} as const satisfies Record<string, PersonaSpec>;

export type PersonaName = keyof typeof PERSONA_SPECS;

export interface Persona {
  name: PersonaName;
  userId: string;
  email: string;
  roles: readonly StaffRole[];
  teaches: Partial<Record<OfferingKey, LecturerRole>>;
  studies: Partial<Record<OfferingKey, StudyStatus>>;
  /** An ACTIVE student record (the derived Student role, §7.1). */
  activeStudent: boolean;
  /** Headers that make a request as this persona (session cookie + CSRF token). */
  headers: Record<string, string>;
}

export interface PersonaWorld {
  programmeId: string;
  curriculumId: string;
  courseId: string;
  sessionId: string;
  semesterId: string;
  offerings: Record<OfferingKey, string>;
}

export type Personas = Record<PersonaName, Persona> & { world: PersonaWorld };

/** Signs a user in directly, without going through the password flow. */
export async function sessionFor(t: TestApp, userId: string): Promise<Record<string, string>> {
  const sessions = t.app.get(SessionService);
  const { token, session } = await t.db.withTx(({ db }) => sessions.create(db, userId));
  return { cookie: `__Host-glim_sid=${token}`, "x-csrf-token": session.csrfToken };
}

export async function createUser(
  t: TestApp,
  input: { email: string; displayName?: string; roles?: readonly StaffRole[] },
) {
  const roles = t.app.get(RoleService);
  return t.db.withTx(async ({ db }) => {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: input.email,
        displayName: input.displayName ?? input.email.split("@")[0] ?? "User",
        status: "ACTIVE",
      })
      .returning();
    if (user === undefined) throw new Error("user insert failed");
    for (const role of input.roles ?? []) {
      await roles.grant(db, SYSTEM_ACTOR, { userId: user.id, role, reason: "test persona" });
    }
    return user;
  });
}

/** A programme, course, active session and semester, and two draft offerings O1 and O2. */
async function createWorld(t: TestApp): Promise<PersonaWorld> {
  const programme = unwrap(
    await t.app.get(ProgrammesService).create(
      {
        code: "PDIP",
        name: "Persona Diploma",
        awardType: "DIPLOMA",
        durationSemesters: 4,
        levels: 2,
      },
      SYSTEM_ACTOR,
    ),
  );
  const course = unwrap(
    await t.app
      .get(CoursesService)
      .create(
        { code: "PBIB101", title: "Persona Course", description: null, credits: "3.0" },
        SYSTEM_ACTOR,
      ),
  );
  const calendar = t.app.get(CalendarService);
  // Far in the future and left PLANNED, so tests that run the real calendar aren't disturbed.
  const session = unwrap(
    await calendar.createSession(
      { code: "2080/2081", name: "Persona Session", startsOn: "2080-09-01", endsOn: "2081-06-30" },
      SYSTEM_ACTOR,
    ),
  );
  const semester = unwrap(
    await calendar.createSemester(
      {
        academicSessionId: session.id,
        code: "S1",
        name: "First Semester",
        sequence: 1,
        startsOn: "2080-09-04",
        endsOn: "2081-01-26",
      },
      SYSTEM_ACTOR,
    ),
  );
  const assignments = t.app.get(AssignmentsService);
  const offering = async (sectionCode: string) =>
    unwrap(
      await assignments.createOfferingWithLecturers(
        {
          courseId: course.id,
          semesterId: semester.id,
          sectionCode,
          titleOverride: null,
          capacity: null,
          lecturers: [],
        },
        SYSTEM_ACTOR,
      ),
    );
  // A draft curriculum is enough for the persona students' programme enrollments.
  const curriculum = unwrap(
    await t.app
      .get(CurriculaService)
      .create(
        { programmeId: programme.id, effectiveFrom: "2080-09-01", minElectiveCredits: "0.0" },
        SYSTEM_ACTOR,
      ),
  );
  return {
    programmeId: programme.id,
    curriculumId: curriculum.id,
    courseId: course.id,
    sessionId: session.id,
    semesterId: semester.id,
    offerings: { O1: await offering("O1"), O2: await offering("O2") },
  };
}

export async function createPersonas(t: TestApp): Promise<Personas> {
  const world = await createWorld(t);
  const lecturers = t.app.get(LecturersService);
  const assignments = t.app.get(AssignmentsService);
  const out: Partial<Record<PersonaName, Persona>> = {};
  for (const [name, spec] of Object.entries(PERSONA_SPECS) as [PersonaName, PersonaSpec][]) {
    const email = `${name.toLowerCase()}@personas.glim.test`;
    const user = await createUser(t, { email, roles: spec.roles });
    const teaches = spec.teaches ?? {};
    if (Object.keys(teaches).length > 0) {
      const { lecturer } = unwrap(
        await lecturers.create(
          {
            email,
            title: null,
            givenName: name,
            familyName: "Persona",
            kind: "INTERNAL",
            staffCode: null,
          },
          SYSTEM_ACTOR,
        ),
      );
      for (const [key, role] of Object.entries(teaches) as [OfferingKey, LecturerRole][]) {
        unwrap(await assignments.assign(world.offerings[key], lecturer.id, role, SYSTEM_ACTOR));
      }
    }
    const studies = spec.studies ?? {};
    if (Object.keys(studies).length > 0) await enrollStudent(t, world, user.id, name, spec);
    out[name] = {
      name,
      userId: user.id,
      email,
      roles: spec.roles,
      teaches,
      studies,
      activeStudent: Object.keys(studies).length > 0 && spec.studentStatus !== "GRADUATED",
      headers: await sessionFor(t, user.id),
    };
  }
  return { ...(out as Record<PersonaName, Persona>), world };
}

let matric = 0;
/**
 * Makes a persona a student of the persona programme, with a semester enrollment in the persona
 * semester and course enrollments on its offerings, written directly (no admissions needed).
 */
async function enrollStudent(
  t: TestApp,
  world: PersonaWorld,
  userId: string,
  name: string,
  spec: PersonaSpec,
): Promise<void> {
  matric++;
  const q = (text: string, values: unknown[]) => t.db.pool.query<{ id: string }>(text, values);
  const student = await q(
    "INSERT INTO students (user_id, given_name, family_name, status) VALUES ($1, $2, 'Persona', $3) RETURNING id",
    [userId, name, spec.studentStatus ?? "ACTIVE"],
  );
  const studentId = student.rows[0]?.id;
  const enrollment = await q(
    `INSERT INTO programme_enrollments (student_id, programme_id, curriculum_id, entry_session_id, matric_number, study_mode, started_on, status)
     VALUES ($1, $2, $3, $4, $5, 'ONLINE', '2080-09-01', $6) RETURNING id`,
    [
      studentId,
      world.programmeId,
      world.curriculumId,
      world.sessionId,
      `GLIM/PDIP/2080/${String(matric).padStart(4, "0")}`,
      spec.studentStatus === "GRADUATED" ? "COMPLETED" : "ACTIVE",
    ],
  );
  const programmeEnrollmentId = enrollment.rows[0]?.id;
  const semester = await q(
    "INSERT INTO semester_enrollments (programme_enrollment_id, semester_id, level_no) VALUES ($1, $2, 1) RETURNING id",
    [programmeEnrollmentId, world.semesterId],
  );
  for (const [key, status] of Object.entries(spec.studies ?? {}) as [OfferingKey, StudyStatus][]) {
    await q(
      `INSERT INTO course_enrollments (semester_enrollment_id, programme_enrollment_id, course_offering_id, student_id, selection, status)
       VALUES ($1, $2, $3, $4, 'COMPULSORY', $5) RETURNING id`,
      [semester.rows[0]?.id, programmeEnrollmentId, world.offerings[key], studentId, status],
    );
  }
}
