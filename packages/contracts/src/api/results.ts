import { z } from "zod";
import { ENUMS, STANDINGS } from "../enums";
import { endpoint } from "../http";

/**
 * Grading schemes (TRD §14.4, C-11, C-31): letter bands, repeat policy, standing and award
 * classes. All figures are integers in hundredths (`X100`): 7000 is 70.00 %, 450 is a CGPA of
 * 4.50.
 */

const idParams = z.object({ id: z.uuid() });
const hundredths = (max: number) => z.number().int().min(0).max(max);

export const gradeBandSchema = z
  .object({
    minX100: hundredths(10_000),
    maxX100: hundredths(10_000),
    letter: z.string().trim().min(1).max(4),
    pointsX100: hundredths(1000),
    pass: z.boolean(),
  })
  .strict();

export const classBandSchema = z
  .object({
    minCgpaX100: hundredths(1000),
    maxCgpaX100: hundredths(1000),
    label: z.string().trim().min(1).max(60),
  })
  .strict();

const schemeRules = {
  name: z.string().trim().min(1).max(100),
  kind: z.enum(ENUMS["grading_schemes.kind"]),
  bands: z.array(gradeBandSchema).min(1).max(20),
  classBands: z.array(classBandSchema).max(10),
  minAwardCgpaX100: hundredths(1000),
  maxPointsX100: z.number().int().min(1).max(1000),
  passMarkX100: hundredths(10_000),
  repeatPolicy: z.enum(ENUMS["grading_schemes.repeat_policy"]),
  goodStandingCgpaX100: hundredths(1000),
  probationCgpaX100: hundredths(1000).nullable(),
};

export const gradingSchemeSchema = z.object({
  id: z.uuid(),
  ...schemeRules,
  supersedesId: z.uuid().nullable(),
  /** Set once a result has used it: then it can't change, only be replaced by a new version. */
  lockedAt: z.iso.datetime().nullable(),
  /** The programmes graded with it. */
  programmes: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() })),
  version: z.number().int(),
});

export type GradingScheme = z.infer<typeof gradingSchemeSchema>;

export const listGradingSchemes = endpoint({
  method: "GET",
  path: "/grading-schemes",
  summary: "Every grading scheme, newest versions first, with the programmes using each",
  tag: "Results",
  auth: "session",
  permission: "results:scheme:manage",
  response: z.object({ items: z.array(gradingSchemeSchema) }),
});

export const createGradingScheme = endpoint({
  method: "POST",
  path: "/grading-schemes",
  summary:
    "Create a scheme; with `supersedesId` it's a new version and the old one's programmes move to it",
  tag: "Results",
  auth: "session",
  permission: "results:scheme:manage",
  idempotent: true,
  body: z.object({ ...schemeRules, supersedesId: z.uuid().optional() }).strict(),
  response: gradingSchemeSchema,
  successStatus: 201,
});

export const updateGradingScheme = endpoint({
  method: "PATCH",
  path: "/grading-schemes/:id",
  summary: "Change a scheme no result has used yet (SCHEME_LOCKED once used)",
  tag: "Results",
  auth: "session",
  permission: "results:scheme:manage",
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      name: schemeRules.name.optional(),
      kind: schemeRules.kind.optional(),
      bands: schemeRules.bands.optional(),
      classBands: schemeRules.classBands.optional(),
      minAwardCgpaX100: schemeRules.minAwardCgpaX100.optional(),
      maxPointsX100: schemeRules.maxPointsX100.optional(),
      passMarkX100: schemeRules.passMarkX100.optional(),
      repeatPolicy: schemeRules.repeatPolicy.optional(),
      goodStandingCgpaX100: schemeRules.goodStandingCgpaX100.optional(),
      probationCgpaX100: schemeRules.probationCgpaX100.optional(),
    })
    .strict(),
  response: gradingSchemeSchema,
});

export const setProgrammeScheme = endpoint({
  method: "PUT",
  path: "/programmes/:id/grading-scheme",
  summary: "Choose the scheme a programme's future results are graded with",
  tag: "Results",
  auth: "session",
  permission: "results:scheme:manage",
  params: idParams,
  body: z.object({ gradingSchemeId: z.uuid() }).strict(),
  response: gradingSchemeSchema,
});

// ---- course results (§14.3) ----

export const courseResultRowSchema = z.object({
  /** Null for a preview: what finalizing would record. */
  id: z.uuid().nullable(),
  courseEnrollmentId: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string().nullable(),
  /** Null for a preview. */
  status: z.enum(ENUMS["course_results.status"]).nullable(),
  creditsX10: z.number().int(),
  finalPctX100: z.number().int().nullable(),
  letter: z.string().nullable(),
  pointsX100: z.number().int().nullable(),
  qualityPointsX1000: z.number().int().nullable(),
  resultKind: z.enum(ENUMS["course_results.result_kind"]),
  countsInGpa: z.boolean(),
  passed: z.boolean().nullable(),
  attemptNo: z.number().int(),
  finalizedAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  /**
   * The student's makeup exam date, if the Lecturer set one. While they have no exam grade,
   * finalizing leaves them out (ADR-0005).
   */
  makeupOn: z.iso.date().nullable(),
  reopenedCount: z.number().int(),
  version: z.number().int(),
});

export type CourseResultRow = z.infer<typeof courseResultRowSchema>;

export const courseResultsSchema = z.object({
  /** Why finalizing can't run now (weights, a missing scheme, missing grades), or null. */
  blocker: z.string().nullable(),
  finalized: z.number().int(),
  /** Students waiting on a makeup exam, whom finalizing leaves out for now. */
  awaitingMakeup: z.number().int(),
  items: z.array(courseResultRowSchema),
});

export type CourseResults = z.infer<typeof courseResultsSchema>;

export const listCourseResults = endpoint({
  method: "GET",
  path: "/course-offerings/:id/results",
  summary: "Each student's course result, or a preview of what finalizing would record",
  tag: "Results",
  auth: "session",
  permission: "results:record:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: courseResultsSchema,
});

export const finalizeCourseResults = endpoint({
  method: "POST",
  path: "/course-offerings/:id/results/finalize",
  summary:
    "Finalize the course: freeze each student's result (weights must total 100) and lock their grades; students awaiting a makeup exam are left out",
  tag: "Results",
  auth: "session",
  permission: "results:course-result:finalize",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  response: courseResultsSchema,
  successStatus: 200,
});

export const reopenCourseResult = endpoint({
  method: "POST",
  path: "/course-results/:id/reopen",
  summary:
    "Reopen a finalized result with a reason: back to DRAFT, the student's grades unlocked, the change kept",
  tag: "Results",
  auth: "session",
  permission: "results:course-result:reopen",
  params: idParams,
  body: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
  response: courseResultRowSchema,
  successStatus: 200,
});

export const myCourseResultSchema = z.object({
  id: z.uuid(),
  courseCode: z.string(),
  courseTitle: z.string(),
  /** When the course was completed: results are listed in this order. */
  completedOn: z.iso.date(),
  creditsX10: z.number().int(),
  finalPctX100: z.number().int().nullable(),
  letter: z.string().nullable(),
  pointsX100: z.number().int().nullable(),
  resultKind: z.enum(ENUMS["course_results.result_kind"]),
  countsInGpa: z.boolean(),
  passed: z.boolean().nullable(),
  attemptNo: z.number().int(),
  status: z.enum(ENUMS["course_results.status"]),
});

/** Credits, CGPA and standing over a programme enrollment's results so far (§14.4). */
export const resultSummarySchema = z.object({
  creditsAttemptedX10: z.number().int(),
  creditsEarnedX10: z.number().int(),
  cgpaX100: z.number().int().nullable(),
  standing: z.enum(STANDINGS),
  /** True while any result it counts isn't approved by the Registrar yet. */
  provisional: z.boolean(),
});

export type ResultSummary = z.infer<typeof resultSummarySchema>;

export const myResultsSchema = z.object({
  programmes: z.array(
    z.object({
      programmeEnrollmentId: z.uuid(),
      programmeName: z.string(),
      matricNumber: z.string(),
      results: z.array(myCourseResultSchema),
      summary: resultSummarySchema,
    }),
  ),
});

export type MyResults = z.infer<typeof myResultsSchema>;

export const getMyResults = endpoint({
  method: "GET",
  path: "/me/results",
  summary:
    "The caller's finalized course results in the order completed, with CGPA (Provisional until approved)",
  tag: "Results",
  auth: "session",
  response: myResultsSchema,
});

// ---- cohort results and approval (§14.5, ADR-0005) ----

export const cohortResultRowSchema = z.object({
  programmeEnrollmentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string(),
  /** The student's latest result in each of the cohort's offerings, by offering id. */
  results: z.record(
    z.uuid(),
    z.object({
      id: z.uuid(),
      letter: z.string().nullable(),
      resultKind: z.enum(ENUMS["course_results.result_kind"]),
      status: z.enum(ENUMS["course_results.status"]),
    }),
  ),
  summary: resultSummarySchema,
});

export type CohortResultRow = z.infer<typeof cohortResultRowSchema>;

export const cohortOfferingResultsSchema = z.object({
  offeringId: z.uuid(),
  courseCode: z.string(),
  title: z.string(),
  endsOn: z.iso.date(),
  status: z.enum(ENUMS["course_offerings.status"]),
  enrolled: z.number().int(),
  finalized: z.number().int(),
  approved: z.number().int(),
});

export const cohortResultsSchema = z.object({
  cohort: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  /** The cohort's live offerings in date order. */
  offerings: z.array(cohortOfferingResultsSchema),
  items: z.array(cohortResultRowSchema),
});

export type CohortResults = z.infer<typeof cohortResultsSchema>;

export const getCohortResults = endpoint({
  method: "GET",
  path: "/results/cohorts/:id",
  summary: "A cohort's results: each offering's progress, and each student's results and CGPA",
  tag: "Results",
  auth: "session",
  permission: "results:record:read",
  resource: { type: "cohort", param: "id" },
  params: idParams,
  response: cohortResultsSchema,
});

export const approveResults = endpoint({
  method: "POST",
  path: "/results/approve",
  summary:
    "Approve the FINALIZED course results of one offering or of a whole cohort; draft (reopened) ones are skipped",
  tag: "Results",
  auth: "session",
  permission: "results:course-result:approve",
  idempotent: true,
  body: z.union([
    z.object({ offeringId: z.uuid() }).strict(),
    z.object({ cohortId: z.uuid() }).strict(),
  ]),
  response: z.object({ approved: z.number().int(), skipped: z.number().int() }),
  successStatus: 200,
});

export const broadsheetSchema = z.object({
  cohort: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  offerings: z.array(cohortOfferingResultsSchema),
  items: z.array(cohortResultRowSchema),
});

export const getResultsBroadsheet = endpoint({
  method: "GET",
  path: "/reports/results",
  summary:
    "A cohort's results broadsheet (each course's letter, credits, CGPA, standing), as JSON or (`format=csv`) CSV",
  tag: "Results",
  auth: "session",
  permission: "results:record:read",
  query: z.object({
    cohortId: z.uuid(),
    format: z.enum(["json", "csv"]).default("json"),
  }),
  response: broadsheetSchema,
});

// ---- awards (§14.6) ----

export const awardRequirementSchema = z.object({
  key: z.string(),
  label: z.string(),
  met: z.boolean(),
  detail: z.string().nullable(),
});

export const awardSchema = z.object({
  id: z.uuid(),
  awardType: z.enum(ENUMS["awards.award_type"]),
  programmeEnrollmentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string(),
  programmeCode: z.string(),
  programmeName: z.string(),
  cgpaX100: z.number().int(),
  /** Distinction, Credit or Pass; null is no award (CGPA below the minimum). */
  awardClass: z.string().nullable(),
  creditsEarnedX10: z.number().int(),
  requirements: z.array(awardRequirementSchema),
  status: z.enum(ENUMS["awards.status"]),
  awardedOn: z.iso.date().nullable(),
  certificateNo: z.string().nullable(),
  version: z.number().int(),
});

export type Award = z.infer<typeof awardSchema>;

export const awardCandidateSchema = z.object({
  programmeEnrollmentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string(),
  programmeCode: z.string(),
  cohortCode: z.string(),
  cgpaX100: z.number().int().nullable(),
  creditsEarnedX10: z.number().int(),
  /** The curriculum's total credits: the Certificate needs half of them passed. */
  totalCreditsX10: z.number().int(),
  /** Half the credits passed (ADR-0005). */
  certificateEligible: z.boolean(),
  /** Every curriculum course passed. */
  diplomaEligible: z.boolean(),
  awards: z.array(
    z.object({
      id: z.uuid(),
      awardType: z.enum(ENUMS["awards.award_type"]),
      status: z.enum(ENUMS["awards.status"]),
    }),
  ),
});

export type AwardCandidate = z.infer<typeof awardCandidateSchema>;

export const listAwardCandidates = endpoint({
  method: "GET",
  path: "/awards/candidates",
  summary: "Students on a programme (ACTIVE enrollments), with their CGPA and any award",
  tag: "Results",
  auth: "session",
  permission: "results:award:confirm",
  query: z.object({ cohortId: z.uuid().optional() }),
  response: z.object({ items: z.array(awardCandidateSchema) }),
});

export const listAwards = endpoint({
  method: "GET",
  path: "/awards",
  summary: "Proposed and conferred awards",
  tag: "Results",
  auth: "session",
  permission: "results:award:confirm",
  query: z.object({ status: z.enum(ENUMS["awards.status"]).optional() }),
  response: z.object({ items: z.array(awardSchema) }),
});

export const proposeAward = endpoint({
  method: "POST",
  path: "/programme-enrollments/:id/award/propose",
  summary:
    "Work out the Certificate or Diploma: CGPA, credits, award class and a checklist of requirements (unmet ones don't block the proposal)",
  tag: "Results",
  auth: "session",
  permission: "results:award:confirm",
  params: idParams,
  body: z.object({ awardType: z.enum(ENUMS["awards.award_type"]) }).strict(),
  response: awardSchema,
  successStatus: 200,
});

export const confirmAward = endpoint({
  method: "POST",
  path: "/awards/:id/confirm",
  summary:
    "Confer the award with a certificate number; conferring the Diploma also completes the programme enrollment and graduates the student (REQUIREMENTS_NOT_MET, NO_AWARD)",
  tag: "Results",
  auth: "session",
  permission: "results:award:confirm",
  idempotent: true,
  params: idParams,
  response: awardSchema,
  successStatus: 200,
});
