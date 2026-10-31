import type { StaffRole } from "@glim/contracts";
import { schema } from "@glim/db";
import {
  CohortsService,
  CoursesService,
  CurriculaService,
  ProgrammesService,
} from "@glim/modules/academic";
import { IntakesService } from "@glim/modules/admissions";
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
  /** The course both O1 and O2 teach. */
  courseId: string;
  /** The persona cohort's intake and cohort, which persona students belong to (O1's). */
  intakeId: string;
  cohortId: string;
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

/**
 * An archived programme (so applicants only ever see the admissions world's), its course, and two
 * cohorts from closed intakes, each with a draft offering of the course: O1 for the persona cohort
 * and O2 for a second one. Both span 2025–2099, so tests can schedule Class Meetings on whatever
 * day their clock shows (ADR-0005: meetings fall within their offering).
 */
async function createWorld(t: TestApp): Promise<PersonaWorld> {
  const programmes = t.app.get(ProgrammesService);
  const programme = unwrap(
    await programmes.create({ code: "PDIP", name: "Persona Diploma" }, SYSTEM_ACTOR),
  );
  unwrap(
    await programmes.update(programme.id, programme.version, { status: "ARCHIVED" }, SYSTEM_ACTOR),
  );
  const course = unwrap(
    await t.app
      .get(CoursesService)
      .create(
        { code: "PBIB101", title: "Persona Course", description: null, credits: "3.0" },
        SYSTEM_ACTOR,
      ),
  );
  // Closed and long past, so the intakes tests plan and see their own.
  const cohort = (code: string, opensOn: string, closesOn: string) =>
    createCohort(t, programme, { code, opensOn, closesOn, startsOn: "2025-01-01" });
  const first = await cohort("2025", "2024-11-01", "2024-12-31");
  const second = await cohort("2025-B", "2024-10-01", "2024-10-31");
  const assignments = t.app.get(AssignmentsService);
  const offering = async (cohortId: string) =>
    unwrap(
      await assignments.createOfferingWithLecturers(
        {
          courseId: course.id,
          cohortId,
          startsOn: "2025-01-01",
          endsOn: "2099-12-31",
          examOn: "2099-12-31",
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
      .create({ programmeId: programme.id, effectiveFrom: "2025-01-01" }, SYSTEM_ACTOR),
  );
  return {
    programmeId: programme.id,
    curriculumId: curriculum.id,
    courseId: course.id,
    intakeId: first.intakeId,
    cohortId: first.cohortId,
    offerings: { O1: await offering(first.cohortId), O2: await offering(second.cohortId) },
  };
}

/**
 * A closed intake and its cohort of the programme, made through the services (a cohort is
 * otherwise only created by an acceptance). The intake's application window must not overlap
 * another intake's.
 */
export async function createCohort(
  t: TestApp,
  programme: { id: string; code: string; name: string },
  intake: { code: string; opensOn: string; closesOn: string; startsOn: string },
): Promise<{ intakeId: string; cohortId: string }> {
  const intakes = t.app.get(IntakesService);
  const created = unwrap(
    await intakes.create({ ...intake, offerAcceptanceDays: 21 }, SYSTEM_ACTOR),
  );
  unwrap(await intakes.transition(created.id, "CLOSED", SYSTEM_ACTOR));
  const cohortId = await t.db.withTx(({ db }) =>
    t.app.get(CohortsService).getOrCreate(db, {
      programme,
      intake: { id: created.id, code: created.code },
    }),
  );
  return { intakeId: created.id, cohortId };
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
 * Makes a persona a student of the persona programme in the persona cohort, with course
 * enrollments on its offerings, written directly (no admissions needed).
 */
export async function enrollStudent(
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
    `INSERT INTO programme_enrollments (student_id, programme_id, curriculum_id, intake_id, cohort_id, matric_number, study_mode, started_on, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'ONLINE', '2080-09-01', $7) RETURNING id`,
    [
      studentId,
      world.programmeId,
      world.curriculumId,
      world.intakeId,
      world.cohortId,
      `GLIM/PDIP/2080/${String(matric).padStart(4, "0")}`,
      spec.studentStatus === "GRADUATED" ? "COMPLETED" : "ACTIVE",
    ],
  );
  const programmeEnrollmentId = enrollment.rows[0]?.id;
  for (const [key, status] of Object.entries(spec.studies ?? {}) as [OfferingKey, StudyStatus][]) {
    await q(
      `INSERT INTO course_enrollments (programme_enrollment_id, course_offering_id, student_id, selection, status)
       VALUES ($1, $2, $3, 'COHORT', $4) RETURNING id`,
      [programmeEnrollmentId, world.offerings[key], studentId, status],
    );
  }
}
