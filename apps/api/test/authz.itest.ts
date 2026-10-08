import { ENDPOINTS, type EndpointSpec } from "@glim/contracts";
import {
  CalendarService,
  CoursesService,
  CurriculaService,
  ProgrammesService,
  RoomsService,
} from "@glim/modules/academic";
import { IntakesService } from "@glim/modules/admissions";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { ClassMeetingsService } from "@glim/modules/class-meeting";
import { assignmentHasCapability, AuthorizationService, MATRIX } from "@glim/modules/authorization";
import { AssignmentsService, LecturersService } from "@glim/modules/lecturing";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import {
  createPersonas,
  createUser,
  PERSONA_SPECS,
  type OfferingKey,
  type Persona,
  type PersonaName,
  type Personas,
} from "./personas";

/**
 * Deny-path tests generated from matrix.json (TRD §0.3, §7.5): every endpoint that declares a
 * permission, called by every persona and by nobody.
 */

interface SampleRequest {
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
  /** The persona-world offering the request is about, so the lecturer path can be predicted. */
  offering?: OfferingKey;
  /** The persona who owns the resource (an applicant's application), for the applicant path. */
  owner?: PersonaName;
}

type Sample = (t: TestApp) => Promise<SampleRequest>;

let n = 0;
/** A fresh user to act on, so allowed calls never interfere with each other. */
async function freshUser(t: TestApp, status: "ACTIVE" | "INVITED" = "ACTIVE") {
  n++;
  const user = await createUser(t, { email: `target${String(n)}@authz.glim.test` });
  if (status === "INVITED") {
    await t.db.pool.query("UPDATE users SET status = 'INVITED' WHERE id = $1", [user.id]);
  }
  return user;
}

/** One valid request per endpoint. A new protected endpoint must add its sample here. */
const SAMPLES: Record<string, Sample> = {
  "GET /users": () => Promise.resolve({ url: "/api/v1/users" }),
  "POST /users": () => {
    n++;
    return Promise.resolve({
      url: "/api/v1/users",
      payload: { email: `invitee${String(n)}@authz.glim.test`, displayName: "Invitee", roles: [] },
    });
  },
  "GET /users/:id": async (t) => ({ url: `/api/v1/users/${(await freshUser(t)).id}` }),
  "PATCH /users/:id": async (t) => ({
    url: `/api/v1/users/${(await freshUser(t)).id}`,
    payload: { displayName: "Renamed" },
    headers: { "if-match": '"1"' },
  }),
  "POST /users/:id/deactivate": async (t) => ({
    url: `/api/v1/users/${(await freshUser(t)).id}/deactivate`,
    payload: { reason: "Left the college" },
  }),
  "POST /users/:id/invite": async (t) => ({
    url: `/api/v1/users/${(await freshUser(t, "INVITED")).id}/invite`,
  }),
  "POST /users/:id/roles": async (t) => ({
    url: `/api/v1/users/${(await freshUser(t)).id}/roles`,
    payload: { role: "REGISTRAR", reason: "New registrar" },
  }),
  "DELETE /users/:id/roles/:assignmentId": async (t) => {
    const user = await freshUser(t);
    const { rows } = await t.db.pool.query<{ id: string }>(
      "INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, 'REGISTRAR', 'test') RETURNING id",
      [user.id],
    );
    return {
      url: `/api/v1/users/${user.id}/roles/${rows[0]?.id ?? ""}`,
      payload: { reason: "No longer needed" },
    };
  },
  "GET /audit-logs": () => Promise.resolve({ url: "/api/v1/audit-logs" }),
  "GET /settings": () => Promise.resolve({ url: "/api/v1/settings" }),
  // A stale If-Match keeps allowed callers from changing shared state; they get 412, not 403/404.
  "PATCH /settings": () =>
    Promise.resolve({
      url: "/api/v1/settings",
      payload: { name: "x" },
      headers: { "if-match": '"999"' },
    }),
  "GET /policies": () => Promise.resolve({ url: "/api/v1/policies" }),
  "GET /policies/:type": () => Promise.resolve({ url: "/api/v1/policies/NOTIFICATION" }),
  "PUT /policies/:type": () =>
    Promise.resolve({
      url: "/api/v1/policies/NOTIFICATION",
      payload: { config: {} },
      headers: { "if-match": '"999"' },
    }),
  "GET /programmes": () => Promise.resolve({ url: "/api/v1/programmes" }),
  "POST /programmes": () => {
    n++;
    return Promise.resolve({
      url: "/api/v1/programmes",
      payload: {
        code: `P${String(n)}`,
        name: "Programme",
        awardType: "CERTIFICATE",
        durationSemesters: 2,
        levels: 1,
      },
    });
  },
  "PATCH /programmes/:id": async (t) => ({
    url: `/api/v1/programmes/${(await fixtures(t)).programmeId}`,
    payload: { name: "Renamed" },
    headers: { "if-match": '"999"' },
  }),
  "GET /courses": () => Promise.resolve({ url: "/api/v1/courses" }),
  "POST /courses": () => {
    n++;
    return Promise.resolve({
      url: "/api/v1/courses",
      payload: { code: `C${String(n)}`, title: "Course", credits: "2" },
    });
  },
  "PATCH /courses/:id": async (t) => ({
    url: `/api/v1/courses/${(await fixtures(t)).courseId}`,
    payload: { title: "Renamed" },
    headers: { "if-match": '"999"' },
  }),
  "GET /curricula": () => Promise.resolve({ url: "/api/v1/curricula" }),
  "GET /curricula/:id": async (t) => ({
    url: `/api/v1/curricula/${(await fixtures(t)).curriculumId}`,
  }),
  "POST /curricula": async (t) => ({
    url: "/api/v1/curricula",
    payload: { programmeId: (await fixtures(t)).programmeId, effectiveFrom: "2026-09-01" },
  }),
  "PATCH /curricula/:id": async (t) => ({
    url: `/api/v1/curricula/${(await fixtures(t)).curriculumId}`,
    payload: { minElectiveCredits: "1" },
    headers: { "if-match": '"999"' },
  }),
  "PUT /curricula/:id/courses": async (t) => ({
    url: `/api/v1/curricula/${(await fixtures(t)).curriculumId}/courses`,
    payload: { placements: [] },
    headers: { "if-match": '"999"' },
  }),
  // An empty draft can't be activated (409), so allowed callers never change shared state.
  "POST /curricula/:id/activate": async (t) => ({
    url: `/api/v1/curricula/${(await fixtures(t)).curriculumId}/activate`,
  }),
  "GET /academic-sessions": () => Promise.resolve({ url: "/api/v1/academic-sessions" }),
  "POST /academic-sessions": () => {
    n++;
    const year = 2100 + n;
    return Promise.resolve({
      url: "/api/v1/academic-sessions",
      payload: {
        code: `${String(year)}/${String(year + 1)}`,
        name: "Session",
        startsOn: `${String(year)}-09-01`,
        endsOn: `${String(year + 1)}-06-30`,
      },
    });
  },
  "PATCH /academic-sessions/:id": async (t) => ({
    url: `/api/v1/academic-sessions/${(await calendarFixtures(t)).sessionId}`,
    payload: { name: "Renamed" },
    headers: { "if-match": '"999"' },
  }),
  "POST /academic-sessions/:id/activate": async (t) => ({
    url: `/api/v1/academic-sessions/${(await calendarFixtures(t)).sessionId}/activate`,
  }),
  "POST /academic-sessions/:id/close": async (t) => ({
    url: `/api/v1/academic-sessions/${(await calendarFixtures(t)).sessionId}/close`,
  }),
  "GET /semesters": () => Promise.resolve({ url: "/api/v1/semesters" }),
  "POST /semesters": async (t) => ({
    url: "/api/v1/semesters",
    // Overlaps the fixture semester, so allowed callers get a 409 and change nothing.
    payload: {
      academicSessionId: (await calendarFixtures(t)).sessionId,
      code: "SX",
      name: "X",
      sequence: 2,
      startsOn: "2090-09-10",
      endsOn: "2090-12-01",
    },
  }),
  "PATCH /semesters/:id": async (t) => ({
    url: `/api/v1/semesters/${(await calendarFixtures(t)).semesterId}`,
    payload: { name: "Renamed" },
    headers: { "if-match": '"999"' },
  }),
  "POST /semesters/:id/open-registration": async (t) => ({
    url: `/api/v1/semesters/${(await calendarFixtures(t)).semesterId}/open-registration`,
  }),
  "POST /semesters/:id/activate": async (t) => ({
    url: `/api/v1/semesters/${(await calendarFixtures(t)).semesterId}/activate`,
  }),
  "POST /semesters/:id/close": async (t) => ({
    url: `/api/v1/semesters/${(await calendarFixtures(t)).semesterId}/close`,
  }),
  "GET /rooms": () => Promise.resolve({ url: "/api/v1/rooms" }),
  "POST /rooms": () => {
    n++;
    return Promise.resolve({
      url: "/api/v1/rooms",
      payload: { code: `R${String(n)}`, name: "Room" },
    });
  },
  "PATCH /rooms/:id": async (t) => ({
    url: `/api/v1/rooms/${(await calendarFixtures(t)).roomId}`,
    payload: { name: "Renamed" },
    headers: { "if-match": '"999"' },
  }),
  "GET /lecturers": () => Promise.resolve({ url: "/api/v1/lecturers" }),
  "POST /lecturers": () => {
    n++;
    return Promise.resolve({
      url: "/api/v1/lecturers",
      payload: {
        email: `newlecturer${String(n)}@authz.glim.test`,
        givenName: "New",
        familyName: "Lecturer",
      },
    });
  },
  "PATCH /lecturers/:id": async (t) => ({
    url: `/api/v1/lecturers/${(await lecturerFixture(t)).lecturerId}`,
    payload: { title: "Rev" },
    headers: { "if-match": '"999"' },
  }),
  "POST /course-offerings": async (t) => {
    n++;
    return {
      url: "/api/v1/course-offerings",
      payload: {
        courseId: (await fixtures(t)).courseId,
        semesterId: personas.world.semesterId,
        sectionCode: `A${String(n)}`,
      },
    };
  },
  "GET /course-offerings/:id": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}`,
      offering: "O1",
    }),
  "GET /course-offerings/:id/lecturers": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/lecturers`,
      offering: "O1",
    }),
  // Writes act on a fresh offering, so allowed callers never change O1 and O2.
  "PATCH /course-offerings/:id": async (t) => ({
    url: `/api/v1/course-offerings/${await freshOffering(t)}`,
    payload: { capacity: 30 },
    headers: { "if-match": '"999"' },
  }),
  "POST /course-offerings/:id/publish": async (t) => ({
    url: `/api/v1/course-offerings/${await freshOffering(t)}/publish`,
  }),
  "POST /course-offerings/:id/cancel": async (t) => ({
    url: `/api/v1/course-offerings/${await freshOffering(t)}/cancel`,
    payload: { reason: "Not running this year" },
  }),
  "POST /course-offerings/:id/lecturers": async (t) => ({
    url: `/api/v1/course-offerings/${await freshOffering(t)}/lecturers`,
    payload: { lecturerId: (await lecturerFixture(t)).lecturerId, role: "CO_LECTURER" },
  }),
  "DELETE /course-offerings/:id/lecturers/:assignmentId": async (t) => {
    const offeringId = await freshOffering(t);
    const { lecturerId } = await lecturerFixture(t);
    unwrap(
      await t.app.get(AssignmentsService).assign(offeringId, lecturerId, "ASSISTANT", SYSTEM_ACTOR),
    );
    const { rows } = await t.db.pool.query<{ id: string }>(
      "SELECT id FROM lecturer_assignments WHERE course_offering_id = $1 AND status = 'ACTIVE'",
      [offeringId],
    );
    return { url: `/api/v1/course-offerings/${offeringId}/lecturers/${rows[0]?.id ?? ""}` };
  },
  "GET /intakes": () => Promise.resolve({ url: "/api/v1/intakes" }),
  "POST /intakes": async (t) => ({
    url: "/api/v1/intakes",
    // The fixture session already has an intake, so allowed callers get a 409.
    payload: {
      code: "2090",
      academicSessionId: (await intakeFixture(t)).sessionId,
      opensOn: "2089-11-01",
      closesOn: "2090-06-30",
    },
  }),
  "PATCH /intakes/:id": async (t) => ({
    url: `/api/v1/intakes/${(await intakeFixture(t)).intakeId}`,
    payload: { offerAcceptanceDays: 14 },
    headers: { "if-match": '"999"' },
  }),
  "POST /intakes/:id/open": async (t) => ({
    url: `/api/v1/intakes/${(await intakeFixture(t)).intakeId}/open`,
  }),
  "POST /intakes/:id/close": async (t) => ({
    url: `/api/v1/intakes/${(await intakeFixture(t)).intakeId}/close`,
  }),
  "GET /applications/:id": async (t) => ({
    url: `/api/v1/applications/${await applicationFixture(t)}`,
    owner: "applicant",
  }),
  "PATCH /applications/:id": async (t) => ({
    url: `/api/v1/applications/${await applicationFixture(t)}`,
    payload: { personal: { firstName: "Changed" } },
    headers: { "if-match": '"999"' },
    owner: "applicant",
  }),
  // The fixture draft is incomplete, so the owner gets a 422 and nothing changes.
  "POST /applications/:id/submit": async (t) => {
    n++;
    return {
      url: `/api/v1/applications/${await applicationFixture(t)}/submit`,
      headers: { "idempotency-key": `authz-submit-${String(n).padStart(8, "0")}` },
      owner: "applicant",
    };
  },
  // The fixture is a draft, so the owner gets a 409 (no offer to accept) and nothing changes.
  "POST /applications/:id/accept": async (t) => {
    n++;
    return {
      url: `/api/v1/applications/${await applicationFixture(t)}/accept`,
      headers: { "idempotency-key": `authz-accept-${String(n).padStart(8, "0")}` },
      owner: "applicant",
    };
  },
  "POST /applications/:id/withdraw": async (t) => ({
    url: `/api/v1/applications/${await applicationFixture(t)}/withdraw`,
    owner: "applicant",
  }),
  "GET /reports/admissions": () => Promise.resolve({ url: "/api/v1/reports/admissions" }),
  "GET /reports/referrals": () => Promise.resolve({ url: "/api/v1/reports/referrals" }),
  "GET /admissions/applications/export": () =>
    Promise.resolve({ url: "/api/v1/admissions/applications/export" }),
  "GET /semester-enrollments/:id/registration": async (t) => ({
    url: `/api/v1/semester-enrollments/${await semesterEnrollmentOf(t, "sEnrolled")}/registration`,
    owner: "sEnrolled",
  }),
  // The persona semester is PLANNED, so the owner's window is closed (422) and nothing changes.
  "POST /semester-enrollments/:id/electives": async (t) => ({
    url: `/api/v1/semester-enrollments/${await semesterEnrollmentOf(t, "sEnrolled")}/electives`,
    payload: { offeringId: personas.world.offerings.O2 },
    owner: "sEnrolled",
  }),
  // O1 is compulsory for the owner, so dropping it is refused (422).
  "DELETE /semester-enrollments/:id/electives/:courseEnrollmentId": async (t) => ({
    url: `/api/v1/semester-enrollments/${await semesterEnrollmentOf(t, "sEnrolled")}/electives/${await courseEnrollmentOf(t, "sEnrolled")}`,
    owner: "sEnrolled",
  }),
  "GET /course-offerings/:id/enrollments": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/enrollments`,
      offering: "O1",
    }),
  "POST /course-offerings/:id/enrollments": async (t) => ({
    url: `/api/v1/course-offerings/${await freshOffering(t)}/enrollments`,
    payload: { matricNumber: await matricOf(t, "sOther"), reason: "Retake" },
  }),
  // A COMPLETED enrollment can't be withdrawn (409), so allowed callers change nothing.
  "POST /course-enrollments/:id/withdraw": async (t) => ({
    url: `/api/v1/course-enrollments/${await courseEnrollmentOf(t, "sCompleted")}/withdraw`,
    payload: { reason: "Left the college" },
    offering: "O1",
  }),
  "GET /imports/templates/:kind": () =>
    Promise.resolve({ url: "/api/v1/imports/templates/STUDENTS" }),
  "GET /imports": () => Promise.resolve({ url: "/api/v1/imports" }),
  "GET /imports/:id": async (t) => ({ url: `/api/v1/imports/${await importFixture(t)}` }),
  // Not an uploaded import file, so allowed callers get a 400 and nothing is queued.
  "POST /imports": () => {
    n++;
    return Promise.resolve({
      url: "/api/v1/imports",
      payload: { kind: "STUDENTS", fileId: "00000000-0000-7000-8000-000000000000" },
      headers: { "idempotency-key": `authz-import-${String(n).padStart(8, "0")}` },
    });
  },
  // Each allowed create books a fresh two-hour slot, so allowed callers never clash.
  "POST /course-offerings/:id/class-meetings": () => {
    n++;
    const start = new Date(Date.UTC(2080, 10, 1) + n * 2 * 3_600_000);
    return Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/class-meetings`,
      payload: {
        title: "Authz class",
        scheduledStart: start.toISOString(),
        scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString(),
      },
      headers: { "idempotency-key": `authz-meeting-${String(n).padStart(8, "0")}` },
      offering: "O1",
    });
  },
  "GET /course-offerings/:id/class-meetings": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/class-meetings`,
      offering: "O1",
    }),
  "GET /class-meetings/:id": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}`,
    offering: "O1",
  }),
  // A stale version: allowed callers get 412 and nothing changes.
  "PATCH /class-meetings/:id": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}`,
    payload: { title: "Renamed" },
    headers: { "if-match": '"999"' },
    offering: "O1",
  }),
  // A fresh meeting each time, so every allowed caller really cancels one.
  "POST /class-meetings/:id/cancel": async (t) => {
    n++;
    const start = new Date(Date.UTC(2080, 11, 1) + n * 2 * 3_600_000);
    const created = unwrap(
      await t.app.get(ClassMeetingsService).create(
        personas.world.offerings.O1,
        {
          title: "To cancel",
          scheduledStart: start.toISOString(),
          scheduledEnd: new Date(start.getTime() + 3_600_000).toISOString(),
        },
        { ...SYSTEM_ACTOR, userId: personas.acadAdmin.userId },
      ),
    );
    return {
      url: `/api/v1/class-meetings/${created.meeting.id}/cancel`,
      payload: { reason: "Authz test" },
      offering: "O1",
    };
  },
  // Beyond the eight-week horizon, so the series generates no meetings yet.
  "POST /course-offerings/:id/class-meeting-series": () => {
    n++;
    const startsOn = new Date(Date.UTC(2081, 0, 1) + n * 7 * 86_400_000).toISOString().slice(0, 10);
    return Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/class-meeting-series`,
      payload: {
        titleTemplate: "Authz {n}",
        weekdays: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
        startsOn,
        untilOn: startsOn,
        startTime: "09:00",
        durationMinutes: 60,
      },
      headers: { "idempotency-key": `authz-series-${String(n).padStart(8, "0")}` },
      offering: "O1",
    });
  },
  // The fixture is in 2080: allowed callers are outside the window (422) and nothing changes.
  "POST /class-meetings/:id/join": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/join`,
    offering: "O1",
  }),
  "POST /class-meetings/:id/start": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/start`,
    offering: "O1",
  }),
  // Not started, so allowed callers get 409.
  "POST /class-meetings/:id/end": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/end`,
    offering: "O1",
  }),
  "GET /class-meetings/:id/roll-call": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/roll-call`,
    offering: "O1",
  }),
  // The fixture is in 2080, so roll call isn't open: allowed callers get 409, nothing changes.
  "PUT /class-meetings/:id/roll-call": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/roll-call`,
    payload: {
      marks: [
        {
          studentId: "00000000-0000-7000-8000-000000000000",
          present: true,
          late: false,
          mode: "IN_PERSON",
        },
      ],
    },
    headers: { "if-match": '"0"' },
    offering: "O1",
  }),
  "GET /class-meetings/:id/attendance": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/attendance`,
    offering: "O1",
  }),
  "GET /admissions/applications": () => Promise.resolve({ url: "/api/v1/admissions/applications" }),
  "GET /admissions/applications/:id": async (t) => ({
    url: `/api/v1/admissions/applications/${await submittedApplicationFixture(t)}`,
  }),
  "POST /admissions/applications/:id/review": async (t) => ({
    url: `/api/v1/admissions/applications/${await submittedApplicationFixture(t)}/review`,
  }),
  "POST /admissions/applications/:id/notes": async (t) => ({
    url: `/api/v1/admissions/applications/${await submittedApplicationFixture(t)}/notes`,
    payload: { note: "Spoke to the pastor" },
  }),
  // The fixture never lapsed, so allowed callers get a 409 and nothing changes.
  "POST /admissions/applications/:id/reopen-offer": async (t) => ({
    url: `/api/v1/admissions/applications/${await submittedApplicationFixture(t)}/reopen-offer`,
    payload: { reason: "Late but genuine" },
  }),
  "POST /admissions/applications/:id/decide": async (t) => {
    n++;
    return {
      url: `/api/v1/admissions/applications/${await submittedApplicationFixture(t)}/decide`,
      payload: { decision: "REJECT" },
      headers: { "idempotency-key": `authz-decide-${String(n).padStart(8, "0")}` },
    };
  },
  "POST /curricula/:id/clone": async (t) => ({
    url: `/api/v1/curricula/${(await fixtures(t)).curriculumId}/clone`,
    payload: { effectiveFrom: "2027-09-01" },
  }),
};

/** A new draft offering of the fixture course in the persona world's semester. */
let meetingShared: string | undefined;
/** One Class Meeting on O1, for the read and change samples. */
async function meetingFixture(t: TestApp): Promise<string> {
  if (meetingShared !== undefined) return meetingShared;
  const created = unwrap(
    await t.app.get(ClassMeetingsService).create(
      personas.world.offerings.O1,
      {
        title: "Fixture class",
        scheduledStart: "2080-10-01T09:00:00Z",
        scheduledEnd: "2080-10-01T10:00:00Z",
      },
      { ...SYSTEM_ACTOR, userId: personas.acadAdmin.userId },
    ),
  );
  meetingShared = created.meeting.id;
  return meetingShared;
}

async function freshOffering(t: TestApp): Promise<string> {
  n++;
  return unwrap(
    await t.app.get(AssignmentsService).createOfferingWithLecturers(
      {
        courseId: (await fixtures(t)).courseId,
        semesterId: personas.world.semesterId,
        sectionCode: `F${String(n)}`,
        titleOverride: null,
        capacity: null,
        lecturers: [],
      },
      SYSTEM_ACTOR,
    ),
  );
}

let lecturerShared: { lecturerId: string } | undefined;
async function lecturerFixture(t: TestApp) {
  if (lecturerShared !== undefined) return lecturerShared;
  const user = await createUser(t, { email: "fixture-lecturer@authz.glim.test" });
  const { lecturer } = unwrap(
    await t.app.get(LecturersService).create(
      {
        email: user.email,
        title: null,
        givenName: "Fixture",
        familyName: "Lecturer",
        kind: "GUEST",
        staffCode: null,
      },
      SYSTEM_ACTOR,
    ),
  );
  lecturerShared = { lecturerId: lecturer.id };
  return lecturerShared;
}

/** A persona student's semester enrollment, course enrollment and Matric Number. */
async function semesterEnrollmentOf(t: TestApp, name: PersonaName): Promise<string> {
  const { rows } = await t.db.pool.query<{ id: string }>(
    `SELECT se.id FROM semester_enrollments se
       JOIN programme_enrollments pe ON pe.id = se.programme_enrollment_id
       JOIN students s ON s.id = pe.student_id WHERE s.user_id = $1`,
    [personas[name].userId],
  );
  return rows[0]?.id ?? "";
}
async function courseEnrollmentOf(t: TestApp, name: PersonaName): Promise<string> {
  const { rows } = await t.db.pool.query<{ id: string }>(
    `SELECT ce.id FROM course_enrollments ce JOIN students s ON s.id = ce.student_id
      WHERE s.user_id = $1 AND ce.course_offering_id = $2`,
    [personas[name].userId, personas.world.offerings.O1],
  );
  return rows[0]?.id ?? "";
}
async function matricOf(t: TestApp, name: PersonaName): Promise<string> {
  const { rows } = await t.db.pool.query<{ matric_number: string }>(
    `SELECT pe.matric_number FROM programme_enrollments pe JOIN students s ON s.id = pe.student_id
      WHERE s.user_id = $1`,
    [personas[name].userId],
  );
  return rows[0]?.matric_number ?? "";
}

let importShared: string | undefined;
/** A finished import job, written directly. */
async function importFixture(t: TestApp): Promise<string> {
  if (importShared !== undefined) return importShared;
  const { rows: files } = await t.db.pool.query<{ id: string }>(
    `INSERT INTO files (owner_user_id, purpose, storage_key, original_name, mime, size_bytes, status)
     VALUES ($1, 'IMPORT', 'imports/authz', 'students.csv', 'text/csv', 10, 'AVAILABLE') RETURNING id`,
    [personas.acadAdmin.userId],
  );
  const { rows } = await t.db.pool.query<{ id: string }>(
    `INSERT INTO import_jobs (kind, file_id, file_sha256, status, created_by)
     VALUES ('STUDENTS', $1, 'x', 'COMPLETED', $2) RETURNING id`,
    [files[0]?.id, personas.acadAdmin.userId],
  );
  importShared = rows[0]?.id ?? "";
  return importShared;
}

let applicationShared: string | undefined;
/** The applicant persona's draft application, in the fixture intake. */
async function applicationFixture(t: TestApp): Promise<string> {
  if (applicationShared !== undefined) return applicationShared;
  const { rows } = await t.db.pool.query<{ id: string }>(
    `INSERT INTO applications (intake_id, programme_id, applicant_user_id, study_mode)
     VALUES ($1, $2, $3, 'ONLINE') RETURNING id`,
    [(await intakeFixture(t)).intakeId, (await fixtures(t)).programmeId, personas.applicant.userId],
  );
  applicationShared = rows[0]?.id ?? "";
  return applicationShared;
}

let submittedShared: string | undefined;
/** A submitted application (staff never see drafts), from a user of its own. */
async function submittedApplicationFixture(t: TestApp): Promise<string> {
  if (submittedShared !== undefined) return submittedShared;
  const owner = await freshUser(t);
  const { rows: files } = await t.db.pool.query<{ id: string }>(
    `INSERT INTO files (owner_user_id, purpose, storage_key, original_name, mime, size_bytes, status)
     VALUES ($1, 'PASSPORT_PHOTO', 'passport-photos/authz', 'me.jpg', 'image/jpeg', 100, 'AVAILABLE') RETURNING id`,
    [owner.id],
  );
  const { rows } = await t.db.pool.query<{ id: string }>(
    `INSERT INTO applications (intake_id, programme_id, applicant_user_id, study_mode, status, reference_no,
       submitted_at, declared_at, data_consent_at, statement_of_faith_read, photo_file_id)
     VALUES ($1, $2, $3, 'ONLINE', 'SUBMITTED', 'GLIM-APP-2091-00001', now(), now(), now(), true, $4)
     RETURNING id`,
    [(await intakeFixture(t)).intakeId, (await fixtures(t)).programmeId, owner.id, files[0]?.id],
  );
  submittedShared = rows[0]?.id ?? "";
  return submittedShared;
}

let intakeShared: { sessionId: string; intakeId: string } | undefined;
async function intakeFixture(t: TestApp) {
  if (intakeShared !== undefined) return intakeShared;
  const { sessionId } = await calendarFixtures(t);
  const intake = unwrap(
    await t.app.get(IntakesService).create(
      {
        code: "2091",
        academicSessionId: sessionId,
        opensOn: "2089-11-01",
        closesOn: "2090-06-30",
        offerAcceptanceDays: 21,
      },
      SYSTEM_ACTOR,
    ),
  );
  intakeShared = { sessionId, intakeId: intake.id };
  return intakeShared;
}

let calendarShared: { sessionId: string; semesterId: string; roomId: string } | undefined;
/** A planned session (2090/2091) with one semester, and a Room, for the calendar samples. */
async function calendarFixtures(t: TestApp) {
  if (calendarShared !== undefined) return calendarShared;
  const calendar = t.app.get(CalendarService);
  const session = unwrap(
    await calendar.createSession(
      { code: "2090/2091", name: "Authz", startsOn: "2090-09-01", endsOn: "2091-06-30" },
      SYSTEM_ACTOR,
    ),
  );
  const semester = unwrap(
    await calendar.createSemester(
      {
        academicSessionId: session.id,
        code: "S1",
        name: "First",
        sequence: 1,
        startsOn: "2090-09-04",
        endsOn: "2091-01-26",
      },
      SYSTEM_ACTOR,
    ),
  );
  const room = unwrap(
    await t.app
      .get(RoomsService)
      .create({ code: "AUTHZ-R", name: "Authz Room", capacity: null }, SYSTEM_ACTOR),
  );
  calendarShared = { sessionId: session.id, semesterId: semester.id, roomId: room.id };
  return calendarShared;
}

let shared: { programmeId: string; courseId: string; curriculumId: string } | undefined;
/** One programme, course and (empty, draft) curriculum for the academic samples. */
async function fixtures(t: TestApp) {
  if (shared !== undefined) return shared;
  const programme = unwrap(
    await t.app
      .get(ProgrammesService)
      .create(
        { code: "AUTHZ", name: "Authz", awardType: "DIPLOMA", durationSemesters: 4, levels: 2 },
        SYSTEM_ACTOR,
      ),
  );
  const course = unwrap(
    await t.app
      .get(CoursesService)
      .create({ code: "AUTHZ1", title: "Authz", description: null, credits: "2.0" }, SYSTEM_ACTOR),
  );
  const curriculum = unwrap(
    await t.app
      .get(CurriculaService)
      .create(
        { programmeId: programme.id, effectiveFrom: "2026-09-01", minElectiveCredits: "0.0" },
        SYSTEM_ACTOR,
      ),
  );
  shared = { programmeId: programme.id, courseId: course.id, curriculumId: curriculum.id };
  return shared;
}

const key = (e: EndpointSpec) => `${e.method} ${e.path}`;
const protectedEndpoints = (ENDPOINTS as readonly EndpointSpec[]).filter(
  (e): e is EndpointSpec & { permission: NonNullable<EndpointSpec["permission"]> } =>
    e.permission !== undefined,
);

let t: TestApp;
let personas: Personas;

/**
 * What matrix.json says should happen (the oracle): staff path by role, lecturer path by the
 * persona's assignment on the request's offering (§7.4), student path by enrollment status on
 * that offering (E or E/C) or any active student, applicant path by ownership.
 */
function expectedAllowed(
  persona: Persona,
  permission: NonNullable<EndpointSpec["permission"]>,
  sample: SampleRequest,
): boolean {
  const { offering, owner } = sample;
  if (AuthorizationService.staffGrants(persona.roles, permission)) return true;
  if (MATRIX.permissions[permission].applicant === true && owner === persona.name) return true;
  const studentRule = MATRIX.permissions[permission].student;
  if (studentRule !== undefined && persona.activeStudent) {
    if (studentRule.any === true) return true;
    const owns = studentRule.own !== true || owner === persona.name;
    if (studentRule.status !== undefined && offering !== undefined && owns) {
      const status = persona.studies[offering];
      const allowed = studentRule.status === "E" ? ["ENROLLED"] : ["ENROLLED", "COMPLETED"];
      if (status !== undefined && allowed.includes(status)) return true;
    }
    if (studentRule.status === undefined && studentRule.own === true && owner === persona.name)
      return true;
  }
  const capability = MATRIX.permissions[permission].lecturer;
  if (capability === undefined) return false;
  if (capability === "*") return Object.keys(persona.teaches).length > 0;
  const role = offering === undefined ? undefined : persona.teaches[offering];
  return (
    role !== undefined && assignmentHasCapability({ role, capabilityOverrides: {} }, capability)
  );
}

beforeAll(async () => {
  t = await createTestApp();
  personas = await createPersonas(t);
});

afterAll(async () => {
  await t.close();
});

it("has a sample request for every endpoint that declares a permission", () => {
  expect(protectedEndpoints.map(key).filter((k) => SAMPLES[k] === undefined)).toEqual([]);
});

describe.each(protectedEndpoints.map((e) => [key(e), e] as const))("%s", (_name, endpoint) => {
  it("refuses an unauthenticated caller with 401", async () => {
    const sample = await SAMPLES[key(endpoint)]?.(t);
    if (sample === undefined) return;
    const res = await t.request({
      method: endpoint.method,
      url: sample.url,
      payload: sample.payload,
      headers: sample.headers ?? {},
    });
    expect(res.statusCode).toBe(401);
  });

  it.each(Object.keys(PERSONA_SPECS) as PersonaName[])(
    "as %s: allowed exactly when matrix.json grants it",
    async (name) => {
      const sample = await SAMPLES[key(endpoint)]?.(t);
      if (sample === undefined) return;
      const persona = personas[name];
      const res = await t.request({
        method: endpoint.method,
        url: sample.url,
        payload: sample.payload,
        headers: { ...persona.headers, ...sample.headers },
      });
      const granted = expectedAllowed(persona, endpoint.permission, sample);
      if (granted) {
        expect([401, 403, 404], `${name} should be allowed: ${res.body}`).not.toContain(
          res.statusCode,
        );
      } else {
        // A resource the caller can't see is a 404, never a 403 (§7.2).
        expect(res.statusCode, res.body).toBe(endpoint.resource === undefined ? 403 : 404);
      }
    },
  );
});

describe("denied writes", () => {
  it("are audited, at most once a minute per user and permission (§7.2)", async () => {
    const attempt = () =>
      t.request({
        method: "POST",
        url: "/api/v1/users",
        headers: personas.registrar.headers,
        payload: { email: "nope@authz.glim.test", displayName: "Nope", roles: [] },
      });
    expect((await attempt()).statusCode).toBe(403);
    expect((await attempt()).statusCode).toBe(403);
    const log = await t.request({
      url: `/api/v1/audit-logs?actorUserId=${personas.registrar.userId}`,
      headers: personas.sysAdmin.headers,
    });
    const denied = log
      .json<{ items: { action: string; outcome: string; metadata: Record<string, unknown> }[] }>()
      .items.filter(
        (i) =>
          i.action === "authorization.denied" && i.metadata.permission === "identity:user:manage",
      );
    expect(denied).toEqual([
      expect.objectContaining({
        outcome: "DENIED",
        metadata: { permission: "identity:user:manage" },
      }),
    ]);
  });
});
