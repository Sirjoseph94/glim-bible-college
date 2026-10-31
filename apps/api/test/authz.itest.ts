import { ENDPOINTS, type EndpointSpec } from "@glim/contracts";
import {
  CoursesService,
  CurriculaService,
  ProgrammesService,
  RoomsService,
} from "@glim/modules/academic";
import { IntakesService } from "@glim/modules/admissions";
import { SYSTEM_ACTOR } from "@glim/modules/audit";
import { TranscriptsService } from "@glim/modules/transcripts";
import { ClassMeetingsService } from "@glim/modules/class-meeting";
import { VideosService } from "@glim/modules/video";
import {
  AssignmentsService as CourseworkAssignments,
  ExamsService,
  QuizAttemptsService,
  QuizzesService,
  SubmissionsService,
} from "@glim/modules/assessment";
import { FilesService, MaterialsService } from "@glim/modules/content";
import { FAKE_CHANNEL_URL } from "@glim/integrations/video-host/fake";
import { assignmentHasCapability, AuthorizationService, MATRIX } from "@glim/modules/authorization";
import { AssignmentsService, LecturersService } from "@glim/modules/lecturing";
import { unwrap } from "@glim/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import {
  createCohort,
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
  /** The request only touches the caller's own part of the resource (their video progress). */
  ownPart?: boolean;
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
      payload: { code: `P${String(n)}`, name: "Programme" },
    });
  },
  "PATCH /programmes/:id": async (t) => ({
    url: `/api/v1/programmes/${(await fixtures(t)).programmeId}`,
    payload: { name: "Renamed" },
    headers: { "if-match": '"999"' },
  }),
  "GET /grading-schemes": () => Promise.resolve({ url: "/api/v1/grading-schemes" }),
  "POST /grading-schemes": () => {
    n++;
    return Promise.resolve({
      url: "/api/v1/grading-schemes",
      payload: { ...SCHEME_SAMPLE, name: `Authz scheme ${String(n)}` },
      headers: { "idempotency-key": `authz-scheme-${String(n).padStart(8, "0")}` },
    });
  },
  // A stale version, so allowed callers get 412 and nothing changes.
  "PATCH /grading-schemes/:id": async (t) => ({
    url: `/api/v1/grading-schemes/${await seededScheme(t)}`,
    payload: { repeatPolicy: "KEEP_ALL" },
    headers: { "if-match": '"999"' },
  }),
  // The programme's scheme already: allowed callers change nothing.
  "PUT /programmes/:id/grading-scheme": async (t) => {
    const programmeId = (await fixtures(t)).programmeId;
    const scheme = await seededScheme(t);
    await t.db.pool.query("UPDATE programmes SET grading_scheme_id = $2 WHERE id = $1", [
      programmeId,
      scheme,
    ]);
    return {
      url: `/api/v1/programmes/${programmeId}/grading-scheme`,
      payload: { gradingSchemeId: scheme },
    };
  },
  "GET /course-offerings/:id/results": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/results`,
      offering: "O1",
    }),
  // The fixture gradebook's weights don't add up to 100, so allowed callers get 422.
  "POST /course-offerings/:id/results/finalize": () => {
    n++;
    return Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/results/finalize`,
      headers: { "idempotency-key": `authz-finalize-${String(n).padStart(8, "0")}` },
      offering: "O1",
    });
  },
  // A finalized result each time, so allowed callers have something to reopen.
  "POST /course-results/:id/reopen": async (t) => ({
    url: `/api/v1/course-results/${await finalizedResult(t)}/reopen`,
    payload: { reason: "Marking error" },
  }),
  "GET /results/cohorts/:id": () =>
    Promise.resolve({ url: `/api/v1/results/cohorts/${personas.world.cohortId}` }),
  // A fresh offering with nothing finalized: allowed callers approve nothing.
  "POST /results/approve": async (t) => {
    n++;
    return {
      url: "/api/v1/results/approve",
      payload: { offeringId: await freshOffering(t) },
      headers: { "idempotency-key": `authz-approve-${String(n).padStart(8, "0")}` },
    };
  },
  "GET /reports/results": () =>
    Promise.resolve({ url: `/api/v1/reports/results?cohortId=${personas.world.cohortId}` }),
  "GET /cohorts": () => Promise.resolve({ url: "/api/v1/cohorts" }),
  "GET /cohorts/:id/schedule": () =>
    Promise.resolve({ url: `/api/v1/cohorts/${personas.world.cohortId}/schedule` }),
  // The persona programme has no active curriculum, so allowed callers plan nothing.
  "POST /cohorts/:id/schedule": () =>
    Promise.resolve({
      url: `/api/v1/cohorts/${personas.world.cohortId}/schedule`,
      payload: { startsOn: "2099-01-01", weeksPerCourse: 1 },
    }),
  "GET /course-offerings/:id/makeup-exams": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/makeup-exams`,
      offering: "O1",
    }),
  "PUT /course-offerings/:id/makeup-exams/:studentId": async (t) => ({
    url: `/api/v1/course-offerings/${personas.world.offerings.O1}/makeup-exams/${await studentOf(t, "sEnrolled")}`,
    payload: { makeupOn: "2099-12-31", reason: "Was in hospital" },
    offering: "O1",
  }),
  // A makeup to remove each time, so allowed callers get 204.
  "DELETE /course-offerings/:id/makeup-exams/:studentId": async (t) => {
    const studentId = await studentOf(t, "sEnrolled");
    await t.db.pool.query(
      `INSERT INTO exam_makeups (course_offering_id, student_id, makeup_on, reason, set_by)
       VALUES ($1, $2, '2099-12-31', 'Fixture', $3) ON CONFLICT DO NOTHING`,
      [personas.world.offerings.O1, studentId, personas.acadAdmin.userId],
    );
    return {
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/makeup-exams/${studentId}`,
      offering: "O1",
    };
  },
  "GET /awards/candidates": () => Promise.resolve({ url: "/api/v1/awards/candidates" }),
  "GET /awards": () => Promise.resolve({ url: "/api/v1/awards" }),
  "POST /programme-enrollments/:id/award/propose": async (t) => ({
    url: `/api/v1/programme-enrollments/${await diplomaEnrollment(t)}/award/propose`,
    payload: { awardType: "CERTIFICATE" },
  }),
  // Nothing is published, so allowed callers get REQUIREMENTS_NOT_MET and nobody graduates.
  "POST /awards/:id/confirm": async (t) => {
    n++;
    return {
      url: `/api/v1/awards/${await proposedAward(t)}/confirm`,
      headers: { "idempotency-key": `authz-confirm-${String(n).padStart(8, "0")}` },
    };
  },
  "POST /programme-enrollments/:id/transcript-requests": async (t) => ({
    url: `/api/v1/programme-enrollments/${await diplomaEnrollment(t)}/transcript-requests`,
    payload: { kind: "UNOFFICIAL" },
    owner: "sEnrolled",
  }),
  "GET /transcript-requests": () => Promise.resolve({ url: "/api/v1/transcript-requests" }),
  "POST /transcript-requests/:id/approve": async (t) => ({
    url: `/api/v1/transcript-requests/${await transcriptRequest(t, "approve")}/approve`,
  }),
  "POST /transcript-requests/:id/reject": async (t) => ({
    url: `/api/v1/transcript-requests/${await transcriptRequest(t, "reject")}/reject`,
    payload: { reason: "Incomplete" },
  }),
  // Approved but with nothing approved to put on it: allowed callers get TRANSCRIPT_NOT_ISSUABLE.
  "POST /transcript-requests/:id/issue": async (t) => {
    n++;
    return {
      url: `/api/v1/transcript-requests/${await transcriptRequest(t, "issue")}/issue`,
      headers: { "idempotency-key": `authz-issue-${String(n).padStart(8, "0")}` },
    };
  },
  "GET /transcripts/:id": async (t) => ({
    url: `/api/v1/transcripts/${await transcriptFixture(t)}`,
    owner: "sEnrolled",
  }),
  // 302 once the PDF exists, 409 before: either way the caller got through.
  "GET /transcripts/:id/download": async (t) => ({
    url: `/api/v1/transcripts/${await transcriptFixture(t)}/download`,
    owner: "sEnrolled",
  }),
  // No PDF yet: allowed callers get 409.
  "POST /transcripts/:id/send": async (t) => ({
    url: `/api/v1/transcripts/${await transcriptFixture(t)}/send`,
    payload: { to: "someone@seminary.test" },
  }),
  "POST /transcripts/:id/revoke": async (t) => ({
    url: `/api/v1/transcripts/${await transcriptFixture(t)}/revoke`,
    payload: { reason: "Issued in error" },
  }),
  "GET /admin/ops/failures": () => Promise.resolve({ url: "/api/v1/admin/ops/failures" }),
  // Provisioning can't be replayed in v1: allowed callers get 400.
  // Allowed callers queue a subscription sweep (202), which does nothing with Google Meet off.
  "POST /admin/ops/replay/:kind/:id": () =>
    Promise.resolve({ url: "/api/v1/admin/ops/replay/subscription/any" }),
  "GET /admin/jobs": () => Promise.resolve({ url: "/api/v1/admin/jobs" }),
  "GET /admin/integrations/youtube/status": () =>
    Promise.resolve({ url: "/api/v1/admin/integrations/youtube/status" }),
  "POST /admin/integrations/youtube/test": () =>
    Promise.resolve({ url: "/api/v1/admin/integrations/youtube/test" }),
  // Redirects: to Google's consent (or back, when uploads are off) for allowed callers.
  "GET /admin/integrations/youtube/connect": () =>
    Promise.resolve({ url: "/api/v1/admin/integrations/youtube/connect" }),
  // No state cookie: allowed callers are sent back with youtube=failed; nothing is stored.
  "GET /admin/integrations/youtube/callback": () =>
    Promise.resolve({ url: "/api/v1/admin/integrations/youtube/callback?code=x&state=y" }),
  "POST /admin/integrations/youtube/disconnect": () =>
    Promise.resolve({ url: "/api/v1/admin/integrations/youtube/disconnect" }),
  "GET /admin/integrations/google": () =>
    Promise.resolve({ url: "/api/v1/admin/integrations/google" }),
  "POST /admin/integrations/google": () =>
    Promise.resolve({ url: "/api/v1/admin/integrations/google", payload: { primaryDomain: null } }),
  // Google Meet is off here: allowed callers get 409; nothing is queued.
  "POST /admin/integrations/google/test": () =>
    Promise.resolve({ url: "/api/v1/admin/integrations/google/test" }),
  // A malformed Google id: allowed callers get 400; nothing is added.
  "POST /admin/integrations/google/host-accounts": () =>
    Promise.resolve({
      url: "/api/v1/admin/integrations/google/host-accounts",
      payload: { email: "authz-host@glim.test", providerUserId: "not-a-number" },
    }),
  // An out-of-range weight: allowed callers get 400; nothing changes.
  "PATCH /admin/integrations/google/host-accounts/:id": () =>
    Promise.resolve({
      url: "/api/v1/admin/integrations/google/host-accounts/00000000-0000-4000-8000-000000000000",
      payload: { weight: 99 },
    }),
  // The Registrar holds a staff role, so allowed callers get 409 and nobody is erased.
  "POST /users/:id/erase": () =>
    Promise.resolve({
      url: `/api/v1/users/${personas.registrar.userId}/erase`,
      payload: { reason: "Asked to be forgotten" },
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
    payload: { effectiveFrom: "2026-09-01" },
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
  "GET /rooms": () => Promise.resolve({ url: "/api/v1/rooms" }),
  "POST /rooms": () => {
    n++;
    return Promise.resolve({
      url: "/api/v1/rooms",
      payload: { code: `R${String(n)}`, name: "Room" },
    });
  },
  "PATCH /rooms/:id": async (t) => ({
    url: `/api/v1/rooms/${await roomFixture(t)}`,
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
        courseId: await freshCourse(t),
        cohortId: await authzCohort(t),
        ...freshDates(),
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
    // The fixture intake already has this code, so allowed callers get a 409.
    payload: {
      code: (await intakeFixture(t)).code,
      opensOn: "2087-01-01",
      closesOn: "2087-02-01",
      startsOn: "2087-03-01",
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
  // Without Google Meet on, allowed callers get 409 ("isn't switched on"); nothing changes.
  "POST /class-meetings/:id/reprovision": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/reprovision`,
    offering: "O1",
  }),
  // No Meet call happened: allowed callers get an empty list.
  "GET /class-meetings/:id/participants": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/participants`,
    offering: "O1",
  }),
  // Someone not on the course: allowed callers get 400; nothing changes.
  "POST /class-meetings/:id/participants/:pid/match": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/participants/nobody/match`,
    offering: "O1",
    payload: { userId: "00000000-0000-4000-8000-000000000000" },
  }),
  // A link video can't be re-ingested: allowed callers get 409; nothing changes.
  "POST /videos/:id/retry-ingest": async (t) => ({
    url: `/api/v1/videos/${await videoFixture(t)}/retry-ingest`,
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
  // sEnrolled has a record on the fixture; overriding it again and clearing it are harmless.
  "POST /class-meetings/:id/attendance/:studentId/override": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/attendance/${await attendanceRecordFixture(t)}/override`,
    payload: { status: "EXCUSED", reason: "Authz test" },
    offering: "O1",
  }),
  "DELETE /class-meetings/:id/attendance/:studentId/override": async (t) => ({
    url: `/api/v1/class-meetings/${await meetingFixture(t)}/attendance/${await attendanceRecordFixture(t)}/override`,
    offering: "O1",
  }),
  "GET /reports/attendance": () =>
    Promise.resolve({
      url: `/api/v1/reports/attendance?offeringId=${personas.world.offerings.O1}`,
      offering: "O1",
    }),
  "GET /course-offerings/:id/videos": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/videos`,
      offering: "O1",
    }),
  "GET /videos/:id": async (t) => ({
    url: `/api/v1/videos/${await videoFixture(t)}`,
    offering: "O1",
  }),
  // A new video id each time, so every allowed caller really adds one.
  "POST /course-offerings/:id/videos": async (t) => {
    await videoFixture(t);
    n++;
    return {
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/videos`,
      payload: { youtubeUrl: `https://youtu.be/az${String(n).padStart(9, "0")}` },
      headers: { "idempotency-key": `authz-video-${String(n).padStart(8, "0")}` },
      offering: "O1",
    };
  },
  "PATCH /videos/:id": async (t) => ({
    url: `/api/v1/videos/${await videoFixture(t)}`,
    payload: { title: "Renamed" },
    headers: { "if-match": '"999"' },
    offering: "O1",
  }),
  "POST /videos/:id/publish": async (t) => {
    n++;
    return {
      url: `/api/v1/videos/${await videoFixture(t)}/publish`,
      headers: { "idempotency-key": `authz-publish-${String(n).padStart(8, "0")}` },
      offering: "O1",
    };
  },
  // Already published, so it's unpublished once; later calls get 409.
  "POST /videos/:id/unpublish": async (t) => ({
    url: `/api/v1/videos/${await videoFixture(t)}/unpublish`,
    offering: "O1",
  }),
  // Not the full list, so allowed callers get 400 and nothing changes.
  "PUT /course-offerings/:id/videos/order": async (t) => ({
    url: `/api/v1/course-offerings/${personas.world.offerings.O1}/videos/order`,
    payload: { videoIds: [await videoFixture(t), "00000000-0000-7000-8000-000000000000"] },
    offering: "O1",
  }),
  "GET /videos/:id/play": async (t) => ({
    url: `/api/v1/videos/${await playableVideoFixture(t)}/play`,
    offering: "O1",
  }),
  "PATCH /videos/:id/progress": async (t) => ({
    url: `/api/v1/videos/${await playableVideoFixture(t)}/progress`,
    payload: { positionMs: 1000, durationMs: 60_000, seq: ++n },
    offering: "O1",
    ownPart: true,
  }),
  "GET /admin/videos": () => Promise.resolve({ url: "/api/v1/admin/videos" }),
  // A link YouTube refuses, so allowed callers get 422 and nothing changes.
  "PUT /videos/:id/youtube-link": async (t) => ({
    url: `/api/v1/videos/${await playableVideoFixture(t)}/youtube-link`,
    payload: { youtubeUrl: "https://vimeo.com/1" },
    offering: "O1",
  }),
  // Its own video: deleted once, then deleting again changes nothing.
  "DELETE /videos/:id": async (t) => ({
    url: `/api/v1/videos/${await deletableVideoFixture(t)}`,
    offering: "O1",
  }),
  "POST /videos/:id/restore": async (t) => ({
    url: `/api/v1/videos/${await deletableVideoFixture(t)}/restore`,
    offering: "O1",
  }),
  "POST /videos/:id/recheck": async (t) => ({
    url: `/api/v1/videos/${await playableVideoFixture(t)}/recheck`,
    offering: "O1",
  }),
  "GET /course-offerings/:id/assignments": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/assignments`,
      offering: "O1",
    }),
  "POST /course-offerings/:id/assignments": () => {
    n++;
    return Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/assignments`,
      payload: {
        title: "Essay",
        instructionsMd: "Write.",
        dueAt: "2080-12-01T12:00:00Z",
        maxScore: "10",
        weight: "5",
      },
      headers: { "idempotency-key": `authz-assignment-${String(n).padStart(8, "0")}` },
      offering: "O1",
    });
  },
  "GET /assignments/:id": async (t) => ({
    url: `/api/v1/assignments/${(await assignmentFixture(t)).assignmentId}`,
    offering: "O1",
  }),
  // A stale version, so allowed callers get 412 and nothing changes.
  "PATCH /assignments/:id": async (t) => ({
    url: `/api/v1/assignments/${(await assignmentFixture(t)).assignmentId}`,
    payload: { title: "Renamed" },
    headers: { "if-match": '"999"' },
    offering: "O1",
  }),
  // Already published: allowed callers change nothing.
  "POST /assignments/:id/publish": async (t) => {
    n++;
    return {
      url: `/api/v1/assignments/${(await assignmentFixture(t)).assignmentId}/publish`,
      headers: { "idempotency-key": `authz-publish-a-${String(n).padStart(8, "0")}` },
      offering: "O1",
    };
  },
  "GET /assignments/:id/my-submissions": async (t) => ({
    url: `/api/v1/assignments/${(await assignmentFixture(t)).assignmentId}/my-submissions`,
    offering: "O1",
    ownPart: true,
  }),
  "PUT /assignments/:id/my-submissions/draft": async (t) => ({
    url: `/api/v1/assignments/${(await assignmentFixture(t)).assignmentId}/my-submissions/draft`,
    payload: { textBody: "My answer" },
    offering: "O1",
    ownPart: true,
  }),
  "POST /assignments/:id/my-submissions/submit": async (t) => {
    n++;
    return {
      url: `/api/v1/assignments/${(await assignmentFixture(t)).assignmentId}/my-submissions/submit`,
      headers: { "idempotency-key": `authz-submit-${String(n).padStart(8, "0")}` },
      offering: "O1",
      ownPart: true,
    };
  },
  "GET /assignments/:id/submissions": async (t) => ({
    url: `/api/v1/assignments/${(await assignmentFixture(t)).assignmentId}/submissions`,
    offering: "O1",
  }),
  "GET /assignment-submissions/:id/files/:fileId/download": async (t) => {
    const f = await assignmentFixture(t);
    return {
      url: `/api/v1/assignment-submissions/${f.submissionId}/files/${f.fileId}/download`,
      offering: "O1",
      owner: "sEnrolled",
    };
  },
  // A stale version, so allowed callers get 412 and nothing changes.
  "PUT /assessments/:id/grades/:studentId": async (t) => {
    const f = await assignmentFixture(t);
    return {
      url: `/api/v1/assessments/${f.assessmentId}/grades/${f.studentId}`,
      payload: { score: "5" },
      headers: { "if-match": '"999"' },
      offering: "O1",
    };
  },
  "GET /course-offerings/:id/gradebook": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/gradebook`,
      offering: "O1",
    }),
  "POST /course-offerings/:id/assessments": () => {
    n++;
    return Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/assessments`,
      payload: { title: "Participation", maxScore: "10", weight: "0" },
      headers: { "idempotency-key": `authz-column-${String(n).padStart(8, "0")}` },
      offering: "O1",
    });
  },
  // A stale version, so allowed callers get 412 and nothing changes.
  "PATCH /assessments/:id": async (t) => ({
    url: `/api/v1/assessments/${(await assignmentFixture(t)).assessmentId}`,
    payload: { title: "Renamed" },
    headers: { "if-match": '"999"' },
    offering: "O1",
  }),
  "POST /assessments/:id/release": async (t) => {
    n++;
    return {
      url: `/api/v1/assessments/${(await assignmentFixture(t)).assessmentId}/release`,
      headers: { "idempotency-key": `authz-release-${String(n).padStart(8, "0")}` },
      offering: "O1",
    };
  },
  // A dry run, so allowed callers change nothing.
  "POST /course-offerings/:id/grades/import": async (t) => ({
    url: `/api/v1/course-offerings/${personas.world.offerings.O1}/grades/import`,
    payload: {
      assessmentId: (await assignmentFixture(t)).assessmentId,
      csv: "matric_number,score\nNOBODY,1\n",
      dryRun: true,
    },
    offering: "O1",
  }),
  "GET /course-offerings/:id/my-grades": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/my-grades`,
      offering: "O1",
      ownPart: true,
    }),
  "POST /course-offerings/:id/exams": () => {
    n++;
    return Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/exams`,
      payload: { title: "Exam", maxScore: "100", weight: "0" },
      headers: { "idempotency-key": `authz-exam-${String(n).padStart(8, "0")}` },
      offering: "O1",
    });
  },
  // The fixture exam has its online part already, so allowed callers get 409.
  "POST /assessments/:id/online-exam": async (t) => {
    n++;
    const f = await examFixture(t);
    return {
      url: `/api/v1/assessments/${f.assessmentId}/online-exam`,
      payload: { questions: [{ questionId: f.essayId }], timeLimitMinutes: 30 },
      headers: { "idempotency-key": `authz-online-${String(n).padStart(8, "0")}` },
      offering: "O1",
    };
  },
  "GET /quizzes/:id/online-grants": async (t) => ({
    url: `/api/v1/quizzes/${(await examFixture(t)).quizId}/online-grants`,
    offering: "O1",
  }),
  "PUT /quizzes/:id/online-grants/:studentId": async (t) => {
    const f = await examFixture(t);
    return {
      url: `/api/v1/quizzes/${f.quizId}/online-grants/${f.studentId}`,
      payload: { reason: "Travelling" },
      offering: "O1",
    };
  },
  // A fresh grant each time, so allowed callers have something to withdraw.
  "DELETE /quizzes/:id/online-grants/:studentId": async (t) => {
    const f = await examFixture(t);
    await t.app.get(ExamsService).grant(f.quizId, f.studentId, "Travelling", {
      ...SYSTEM_ACTOR,
      type: "USER",
      userId: personas.l1Primary.userId,
    });
    return { url: `/api/v1/quizzes/${f.quizId}/online-grants/${f.studentId}`, offering: "O1" };
  },
  // A stale version, so allowed callers get 412 and nothing changes.
  "POST /assessments/:id/grades/:studentId/online-score": async (t) => {
    const f = await examFixture(t);
    return {
      url: `/api/v1/assessments/${f.assessmentId}/grades/${f.studentId}/online-score`,
      payload: { reason: "Sat online" },
      headers: { "if-match": '"999"' },
      offering: "O1",
    };
  },
  "GET /course-offerings/:id/questions": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/questions`,
      offering: "O1",
    }),
  "POST /course-offerings/:id/questions": () => {
    n++;
    return Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/questions`,
      payload: { qtype: "ESSAY", promptMd: "Discuss." },
      headers: { "idempotency-key": `authz-question-${String(n).padStart(8, "0")}` },
      offering: "O1",
    });
  },
  "GET /course-offerings/:id/quizzes": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/quizzes`,
      offering: "O1",
    }),
  "POST /course-offerings/:id/quizzes": async (t) => {
    n++;
    const f = await quizFixture(t);
    return {
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/quizzes`,
      payload: { title: "Quiz", weight: "5", questions: [{ questionId: f.essayId }] },
      headers: { "idempotency-key": `authz-quiz-${String(n).padStart(8, "0")}` },
      offering: "O1",
    };
  },
  "GET /quizzes/:id": async (t) => ({
    url: `/api/v1/quizzes/${(await quizFixture(t)).quizId}`,
    offering: "O1",
  }),
  // A stale version, so allowed callers get 412 and nothing changes.
  "PATCH /quizzes/:id": async (t) => ({
    url: `/api/v1/quizzes/${(await quizFixture(t)).quizId}`,
    payload: { title: "Renamed" },
    headers: { "if-match": '"999"' },
    offering: "O1",
  }),
  // Already published: allowed callers change nothing.
  "POST /quizzes/:id/publish": async (t) => {
    n++;
    return {
      url: `/api/v1/quizzes/${(await quizFixture(t)).quizId}/publish`,
      headers: { "idempotency-key": `authz-publish-q-${String(n).padStart(8, "0")}` },
      offering: "O1",
    };
  },
  // sEnrolled already has an attempt in progress, so this carries on with it.
  "POST /quizzes/:id/attempts": async (t) => ({
    url: `/api/v1/quizzes/${(await quizFixture(t)).quizId}/attempts`,
    offering: "O1",
    ownPart: true,
  }),
  "GET /quizzes/:id/my-attempts": async (t) => ({
    url: `/api/v1/quizzes/${(await quizFixture(t)).quizId}/my-attempts`,
    offering: "O1",
    ownPart: true,
  }),
  "GET /quiz-attempts/:id": async (t) => ({
    url: `/api/v1/quiz-attempts/${(await quizFixture(t)).attemptId}`,
    offering: "O1",
    owner: "sEnrolled",
  }),
  // Saved, or (after the submit sample) refused as ended; either way the caller got through.
  "PATCH /quiz-attempts/:id": async (t) => ({
    url: `/api/v1/quiz-attempts/${(await quizFixture(t)).attemptId}`,
    payload: { seq: ++n, responses: [] },
    offering: "O1",
    owner: "sEnrolled",
  }),
  "POST /quiz-attempts/:id/submit": async (t) => {
    n++;
    return {
      url: `/api/v1/quiz-attempts/${(await quizFixture(t)).attemptId}/submit`,
      headers: { "idempotency-key": `authz-quiz-submit-${String(n).padStart(8, "0")}` },
      offering: "O1",
      owner: "sEnrolled",
    };
  },
  "GET /quizzes/:id/attempts": async (t) => ({
    url: `/api/v1/quizzes/${(await quizFixture(t)).quizId}/attempts`,
    offering: "O1",
  }),
  // Before the submit sample this is a 409 (not submitted yet); after, the essay is marked.
  "PUT /quiz-attempts/:id/responses/:questionId": async (t) => {
    const f = await quizFixture(t);
    return {
      url: `/api/v1/quiz-attempts/${f.attemptId}/responses/${f.essayId}`,
      payload: { points: "1" },
      offering: "O1",
    };
  },
  "GET /course-offerings/:id/materials": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/materials`,
      offering: "O1",
    }),
  "POST /course-offerings/:id/materials": () => {
    n++;
    return Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/materials`,
      payload: { kind: "TEXT", title: "Notes", bodyMd: "Read John 1." },
      headers: { "idempotency-key": `authz-material-${String(n).padStart(8, "0")}` },
      offering: "O1",
    });
  },
  // A stale version, so allowed callers get 412 and nothing changes.
  "PATCH /course-materials/:id": async (t) => ({
    url: `/api/v1/course-materials/${await materialFixture(t)}`,
    payload: { title: "Renamed" },
    headers: { "if-match": '"999"' },
    offering: "O1",
  }),
  // A fresh material each call, so every allowed caller really archives one.
  "DELETE /course-materials/:id": async (t) => ({
    url: `/api/v1/course-materials/${await materialFixture(t, `delete-${String(++n)}`)}`,
    offering: "O1",
  }),
  "GET /course-materials/:id/download": async (t) => ({
    url: `/api/v1/course-materials/${await fileMaterialFixture(t)}/download`,
    offering: "O1",
  }),
  "GET /course-offerings/:id/announcements": () =>
    Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/announcements`,
      offering: "O1",
    }),
  "POST /course-offerings/:id/announcements": () => {
    n++;
    return Promise.resolve({
      url: `/api/v1/course-offerings/${personas.world.offerings.O1}/announcements`,
      payload: { title: "Hello", bodyMd: "Welcome." },
      headers: { "idempotency-key": `authz-announce-${String(n).padStart(8, "0")}` },
      offering: "O1",
    });
  },
  "PATCH /announcements/:id": async (t) => ({
    url: `/api/v1/announcements/${await announcementFixture(t)}`,
    payload: { pinned: true },
    headers: { "if-match": '"999"' },
    offering: "O1",
  }),
  "DELETE /announcements/:id": async (t) => ({
    url: `/api/v1/announcements/${await announcementFixture(t, `delete-${String(++n)}`)}`,
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

let recordShared: string | undefined;
/** An attendance record for sEnrolled on the fixture meeting; returns the student id. */
async function attendanceRecordFixture(t: TestApp): Promise<string> {
  if (recordShared !== undefined) return recordShared;
  const meetingId = await meetingFixture(t);
  const { rows } = await t.db.pool.query<{ id: string }>(
    "SELECT id FROM students WHERE user_id = $1",
    [personas.sEnrolled.userId],
  );
  const studentId = rows[0]?.id ?? "";
  await t.db.pool.query(
    `INSERT INTO attendance_records (class_meeting_id, student_id, computed_status, attendance_mode, attended_seconds, effective_seconds, ratio_bp, policy_version, computed_at)
     VALUES ($1, $2, 'ABSENT', 'NONE', 0, 0, 0, 0, now()) ON CONFLICT DO NOTHING`,
    [meetingId, studentId],
  );
  recordShared = studentId;
  return studentId;
}

let videoShared: string | undefined;
/** GLIM's (fake) channel allowed, and one published video on O1. */
async function videoFixture(t: TestApp): Promise<string> {
  if (videoShared !== undefined) return videoShared;
  await t.db.pool.query("UPDATE settings SET youtube_channel_urls = $1", [[FAKE_CHANNEL_URL]]);
  const created = unwrap(
    await t.app
      .get(VideosService)
      .add(
        personas.world.offerings.O1,
        { youtubeUrl: "https://youtu.be/fixture0001" },
        { ...SYSTEM_ACTOR, userId: personas.acadAdmin.userId },
      ),
  );
  videoShared = created.id;
  return videoShared;
}

let playableShared: string | undefined;
/** A published video on O1 that no other sample unpublishes. */
async function playableVideoFixture(t: TestApp): Promise<string> {
  if (playableShared !== undefined) return playableShared;
  await videoFixture(t);
  const created = unwrap(
    await t.app
      .get(VideosService)
      .add(
        personas.world.offerings.O1,
        { youtubeUrl: "https://youtu.be/fixture0002" },
        { ...SYSTEM_ACTOR, userId: personas.acadAdmin.userId },
      ),
  );
  playableShared = created.id;
  return playableShared;
}

let deletableShared: string | undefined;
/** A video on O1 for the delete and restore samples only. */
async function deletableVideoFixture(t: TestApp): Promise<string> {
  if (deletableShared !== undefined) return deletableShared;
  await videoFixture(t);
  const created = unwrap(
    await t.app
      .get(VideosService)
      .add(
        personas.world.offerings.O1,
        { youtubeUrl: "https://youtu.be/fixture0003" },
        { ...SYSTEM_ACTOR, userId: personas.acadAdmin.userId },
      ),
  );
  deletableShared = created.id;
  return deletableShared;
}

const materialShared = new Map<string, string>();
/** A published TEXT material on O1 (one per key, so deletes don't disturb other samples). */
async function materialFixture(t: TestApp, key = "shared"): Promise<string> {
  const known = materialShared.get(key);
  if (known !== undefined) return known;
  const created = unwrap(
    await t.app
      .get(MaterialsService)
      .create(
        personas.world.offerings.O1,
        { kind: "TEXT", title: `Fixture ${key}`, bodyMd: "Text." },
        personas.l1Primary.userId,
      ),
  );
  materialShared.set(key, created.id);
  return created.id;
}

let assignmentShared:
  | {
      assignmentId: string;
      assessmentId: string;
      submissionId: string;
      fileId: string;
      studentId: string;
    }
  | undefined;
/** A published assignment on O1 with sEnrolled's submitted attempt (with a file). */
async function assignmentFixture(t: TestApp) {
  if (assignmentShared !== undefined) return assignmentShared;
  const created = unwrap(
    await t.app.get(CourseworkAssignments).create(personas.world.offerings.O1, {
      title: "Fixture assignment",
      instructionsMd: "Write.",
      dueAt: "2080-12-01T12:00:00Z",
      maxScore: "10",
      weight: "5",
      maxAttempts: 10,
    }),
  );
  unwrap(await t.app.get(CourseworkAssignments).publish(created.id));
  const file = await t.app.get(FilesService).store({
    ownerUserId: personas.sEnrolled.userId,
    purpose: "SUBMISSION",
    name: "essay.pdf",
    mime: "application/pdf",
    bytes: Buffer.from("%PDF-1.4 essay"),
  });
  const submissions = t.app.get(SubmissionsService);
  unwrap(
    await submissions.saveDraft(created.id, personas.sEnrolled.userId, {
      textBody: "Answer",
      fileIds: [file.id],
    }),
  );
  const submitted = unwrap(await submissions.submit(created.id, personas.sEnrolled.userId));
  const student = await t.db.pool.query<{ id: string }>(
    "SELECT id FROM students WHERE user_id = $1",
    [personas.sEnrolled.userId],
  );
  assignmentShared = {
    assignmentId: created.id,
    assessmentId: created.assessmentId,
    submissionId: submitted.id,
    fileId: file.id,
    studentId: student.rows[0]?.id ?? "",
  };
  return assignmentShared;
}

let quizShared: { quizId: string; attemptId: string; essayId: string } | undefined;
/** A published, untimed quiz on O1 with one essay question, and sEnrolled's attempt at it. */
async function quizFixture(t: TestApp) {
  if (quizShared !== undefined) return quizShared;
  const quizzes = t.app.get(QuizzesService);
  const essay = unwrap(
    await quizzes.createQuestion(
      personas.world.offerings.O1,
      { qtype: "ESSAY", promptMd: "Discuss.", defaultPoints: "5" },
      personas.l1Primary.userId,
    ),
  );
  const created = unwrap(
    await quizzes.create(personas.world.offerings.O1, {
      title: "Fixture quiz",
      weight: "5",
      maxAttempts: 10,
      questions: [{ questionId: essay.id }],
    }),
  );
  unwrap(await quizzes.publish(created.id));
  const attempt = unwrap(
    await t.app
      .get(QuizAttemptsService)
      .start(created.id, { ...SYSTEM_ACTOR, type: "USER", userId: personas.sEnrolled.userId }),
  );
  quizShared = { quizId: created.id, attemptId: attempt.id, essayId: essay.id };
  return quizShared;
}

let examShared:
  { assessmentId: string; quizId: string; essayId: string; studentId: string } | undefined;
/** An exam on O1 with its online part, and sEnrolled's student id. */
async function examFixture(t: TestApp) {
  if (examShared !== undefined) return examShared;
  const { essayId } = await quizFixture(t);
  const column = unwrap(
    await t.app
      .get(ExamsService)
      .create(
        personas.world.offerings.O1,
        { title: "Fixture exam", maxScore: "100", weight: "0" },
        SYSTEM_ACTOR,
      ),
  );
  const online = unwrap(
    await t.app.get(QuizzesService).createOnlineExam(column.assessmentId, {
      questions: [{ questionId: essayId }],
      timeLimitMinutes: 30,
    }),
  );
  const { rows } = await t.db.pool.query<{ id: string }>(
    "SELECT id FROM students WHERE user_id = $1",
    [personas.sEnrolled.userId],
  );
  examShared = {
    assessmentId: column.assessmentId,
    quizId: online.id,
    essayId,
    studentId: rows[0]?.id ?? "",
  };
  return examShared;
}

/** A valid NUC 5-point scheme body. */
const SCHEME_SAMPLE = {
  kind: "NUC_5",
  bands: [
    { minX100: 7000, maxX100: 10000, letter: "A", pointsX100: 500, pass: true },
    { minX100: 6000, maxX100: 6999, letter: "B", pointsX100: 400, pass: true },
    { minX100: 5000, maxX100: 5999, letter: "C", pointsX100: 300, pass: true },
    { minX100: 4500, maxX100: 4999, letter: "D", pointsX100: 200, pass: true },
    { minX100: 4000, maxX100: 4499, letter: "E", pointsX100: 100, pass: true },
    { minX100: 0, maxX100: 3999, letter: "F", pointsX100: 0, pass: false },
  ],
  classBands: [
    { minCgpaX100: 450, maxCgpaX100: 500, label: "Distinction" },
    { minCgpaX100: 300, maxCgpaX100: 449, label: "Credit" },
    { minCgpaX100: 100, maxCgpaX100: 299, label: "Pass" },
  ],
  minAwardCgpaX100: 100,
  maxPointsX100: 500,
  passMarkX100: 4000,
  repeatPolicy: "BEST",
  goodStandingCgpaX100: 100,
  probationCgpaX100: null,
};

/** sEnrolled's result on O1, (re)set to FINALIZED; its grades stay unlocked. */
async function finalizedResult(t: TestApp): Promise<string> {
  const scheme = await seededScheme(t);
  const { rows } = await t.db.pool.query<{ id: string }>(
    `INSERT INTO course_results (course_enrollment_id, programme_enrollment_id, completed_on, course_offering_id,
       course_id, student_id, grading_scheme_id, credits_x10, final_pct_x100, letter, points_x100,
       quality_points_x1000, passed, status, finalized_at)
     SELECT ce.id, ce.programme_enrollment_id, o.ends_on, o.id, o.course_id, ce.student_id, $3,
       30, 7200, 'A', 500, 15000, true, 'FINALIZED', now()
       FROM course_enrollments ce JOIN course_offerings o ON o.id = ce.course_offering_id
       JOIN students s ON s.id = ce.student_id
      WHERE ce.course_offering_id = $1 AND s.user_id = $2
     ON CONFLICT (course_enrollment_id) DO UPDATE SET status = 'FINALIZED', finalized_at = now()
     RETURNING id`,
    [personas.world.offerings.O1, personas.sEnrolled.userId, scheme],
  );
  return rows[0]?.id ?? "";
}

/** sEnrolled's programme enrollment. */
async function diplomaEnrollment(t: TestApp): Promise<string> {
  const { rows } = await t.db.pool.query<{ id: string }>(
    `SELECT pe.id FROM programme_enrollments pe JOIN students s ON s.id = pe.student_id
      WHERE s.user_id = $1`,
    [personas.sEnrolled.userId],
  );
  return rows[0]?.id ?? "";
}

const transcriptRequests = new Map<string, string>();
/** An OFFICIAL request by sEnrolled, one per use: REQUESTED, or APPROVED to issue. */
async function transcriptRequest(t: TestApp, use: "approve" | "reject" | "issue"): Promise<string> {
  const known = transcriptRequests.get(use);
  if (known !== undefined) return known;
  const pe = await diplomaEnrollment(t);
  const { rows } = await t.db.pool.query<{ id: string }>(
    `INSERT INTO transcript_requests (student_id, programme_enrollment_id, kind, purpose, recipient_name, recipient_email, status)
     SELECT student_id, id, 'OFFICIAL', 'Further study', 'Admissions', 'admissions@seminary.test', $2
       FROM programme_enrollments WHERE id = $1 RETURNING id`,
    [pe, use === "issue" ? "APPROVED" : "REQUESTED"],
  );
  const id = rows[0]?.id ?? "";
  transcriptRequests.set(use, id);
  return id;
}

let transcriptShared: string | undefined;
/** An issued (unofficial) transcript of sEnrolled's, issued the way a student asks for one. */
async function transcriptFixture(t: TestApp): Promise<string> {
  if (transcriptShared !== undefined) return transcriptShared;
  // A transcript needs the programme's grading scheme.
  await t.db.pool.query(
    `UPDATE programmes SET grading_scheme_id = $2
      WHERE id = (SELECT programme_id FROM programme_enrollments WHERE id = $1)`,
    [await diplomaEnrollment(t), await seededScheme(t)],
  );
  const request = unwrap(
    await t.app
      .get(TranscriptsService)
      .request(
        await diplomaEnrollment(t),
        { kind: "UNOFFICIAL" },
        { ...SYSTEM_ACTOR, type: "USER", userId: personas.sEnrolled.userId },
      ),
  );
  transcriptShared = request.transcript?.id ?? "";
  return transcriptShared;
}

/** A DRAFT award for sEnrolled. */
async function proposedAward(t: TestApp): Promise<string> {
  const pe = await diplomaEnrollment(t);
  const { rows } = await t.db.pool.query<{ id: string }>(
    `INSERT INTO awards (programme_enrollment_id, award_type, cgpa_x100, credits_earned_x10)
     VALUES ($1, 'CERTIFICATE', 0, 0)
     ON CONFLICT (programme_enrollment_id, award_type) DO UPDATE SET status = 'DRAFT'
     RETURNING id`,
    [pe],
  );
  return rows[0]?.id ?? "";
}

/** The seeded GLIM Diploma scheme. */
async function seededScheme(t: TestApp): Promise<string> {
  const { rows } = await t.db.pool.query<{ id: string }>(
    "SELECT id FROM grading_schemes WHERE name = 'GLIM Diploma'",
  );
  return rows[0]?.id ?? "";
}

let fileMaterialShared: string | undefined;
/** A published FILE material on O1. */
async function fileMaterialFixture(t: TestApp): Promise<string> {
  if (fileMaterialShared !== undefined) return fileMaterialShared;
  const file = await t.app.get(FilesService).store({
    ownerUserId: personas.l1Primary.userId,
    purpose: "MATERIAL",
    name: "notes.pdf",
    mime: "application/pdf",
    bytes: Buffer.from("%PDF-1.4 notes"),
  });
  const created = unwrap(
    await t.app
      .get(MaterialsService)
      .create(
        personas.world.offerings.O1,
        { kind: "FILE", title: "Fixture file", fileId: file.id },
        personas.l1Primary.userId,
      ),
  );
  fileMaterialShared = created.id;
  return fileMaterialShared;
}

const announcementShared = new Map<string, string>();
async function announcementFixture(t: TestApp, key = "shared"): Promise<string> {
  const known = announcementShared.get(key);
  if (known !== undefined) return known;
  const created = unwrap(
    await t.app
      .get(MaterialsService)
      .announce(
        personas.world.offerings.O1,
        { title: `Fixture ${key}`, bodyMd: "Text." },
        personas.l1Primary.userId,
      ),
  );
  announcementShared.set(key, created.id);
  return created.id;
}

let cohortShared: string | undefined;
/** A cohort of its own for the offerings the samples create, from 2091. */
async function authzCohort(t: TestApp): Promise<string> {
  if (cohortShared !== undefined) return cohortShared;
  ({ cohortId: cohortShared } = await createCohort(t, await fixtureProgramme(t), {
    code: "2091-AUTHZ",
    opensOn: "2088-01-01",
    closesOn: "2088-02-01",
    startsOn: "2091-01-01",
  }));
  return cohortShared;
}

/** A course of its own: a cohort takes each course once (ADR-0005). */
async function freshCourse(t: TestApp): Promise<string> {
  n++;
  return unwrap(
    await t.app
      .get(CoursesService)
      .create(
        { code: `AUTHZF${String(n)}`, title: "Fresh", description: null, credits: "2.0" },
        SYSTEM_ACTOR,
      ),
  ).id;
}

let days = 0;
/** Two days of the authz cohort's schedule that no other offering of it has. */
function freshDates() {
  const day = (d: number) =>
    new Date(Date.parse("2091-01-01T00:00:00Z") + d * 86_400_000).toISOString().slice(0, 10);
  days += 2;
  return { startsOn: day(days), endsOn: day(days + 1), examOn: day(days + 1) };
}

/** A new draft offering in the authz cohort. */
async function freshOffering(t: TestApp): Promise<string> {
  return unwrap(
    await t.app.get(AssignmentsService).createOfferingWithLecturers(
      {
        courseId: await freshCourse(t),
        cohortId: await authzCohort(t),
        ...freshDates(),
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

/** A persona student's student record, course enrollment and Matric Number. */
async function studentOf(t: TestApp, name: PersonaName): Promise<string> {
  const { rows } = await t.db.pool.query<{ id: string }>(
    "SELECT id FROM students WHERE user_id = $1",
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

let intakeShared: { code: string; intakeId: string } | undefined;
async function intakeFixture(t: TestApp) {
  if (intakeShared !== undefined) return intakeShared;
  const intake = unwrap(
    await t.app.get(IntakesService).create(
      {
        code: "2091",
        opensOn: "2089-11-01",
        closesOn: "2090-06-30",
        startsOn: "2090-09-01",
        offerAcceptanceDays: 21,
      },
      SYSTEM_ACTOR,
    ),
  );
  intakeShared = { code: intake.code, intakeId: intake.id };
  return intakeShared;
}

let roomShared: string | undefined;
/** A Room for the Room samples. */
async function roomFixture(t: TestApp): Promise<string> {
  if (roomShared !== undefined) return roomShared;
  roomShared = unwrap(
    await t.app
      .get(RoomsService)
      .create({ code: "AUTHZ-R", name: "Authz Room", capacity: null }, SYSTEM_ACTOR),
  ).id;
  return roomShared;
}

let shared: { programmeId: string; courseId: string; curriculumId: string } | undefined;
/** One programme, course and (empty, draft) curriculum for the academic samples. */
async function fixtures(t: TestApp) {
  if (shared !== undefined) return shared;
  const programme = unwrap(
    await t.app.get(ProgrammesService).create({ code: "AUTHZ", name: "Authz" }, SYSTEM_ACTOR),
  );
  const course = unwrap(
    await t.app
      .get(CoursesService)
      .create({ code: "AUTHZ1", title: "Authz", description: null, credits: "2.0" }, SYSTEM_ACTOR),
  );
  const curriculum = unwrap(
    await t.app
      .get(CurriculaService)
      .create({ programmeId: programme.id, effectiveFrom: "2026-09-01" }, SYSTEM_ACTOR),
  );
  shared = { programmeId: programme.id, courseId: course.id, curriculumId: curriculum.id };
  return shared;
}

/** The fixture programme as a cohort needs it. */
async function fixtureProgramme(t: TestApp) {
  const { programmeId } = await fixtures(t);
  return { id: programmeId, code: "AUTHZ", name: "Authz" };
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
  const { offering } = sample;
  const owner = sample.ownPart === true ? persona.name : sample.owner;
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
  // A graduate keeps rules about their own records only (no enrollment status).
  if (
    studentRule !== undefined &&
    persona.name === "sGraduated" &&
    studentRule.own === true &&
    studentRule.status === undefined &&
    studentRule.any !== true &&
    owner === persona.name
  )
    return true;
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
