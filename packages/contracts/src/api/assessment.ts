import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * Assessments (TRD §14.2): every assignment is a gradebook column. Scores and weights are exact
 * decimals sent as strings ("72.50"), never floats (INV-14).
 */

const idParams = z.object({ id: z.uuid() });

const DECIMAL_2 = /^\d{1,5}(\.\d{1,2})?$/;

/** "72.5" → 7250, in whole hundredths (integer arithmetic only). */
const hundredths = (v: string) => {
  const [whole = "0", fraction = ""] = v.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};

/** A score or weight with at most two decimal places, as text, from `min` to `max` hundredths. */
export const decimalText = (maxHundredths: number, minHundredths = 0) =>
  z
    .string()
    .trim()
    .regex(DECIMAL_2, "Use a number with at most two decimal places")
    .refine(
      (v) => hundredths(v) >= minHundredths && hundredths(v) <= maxHundredths,
      "That number is out of range",
    );

export const latePolicySchema = z
  .object({
    /** Whether work may still be submitted after the due date (until the cutoff, if any). */
    allowLate: z.boolean(),
    /** Suggested to the grader per started day late; never applied automatically. */
    penaltyPercentPerDay: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const assignmentSchema = z.object({
  id: z.uuid(),
  assessmentId: z.uuid(),
  courseOfferingId: z.uuid(),
  title: z.string(),
  instructionsMd: z.string(),
  /** Rendered and sanitized on the server. */
  instructionsHtml: z.string(),
  dueAt: z.iso.datetime(),
  cutoffAt: z.iso.datetime().nullable(),
  /** When submissions stop being accepted: the cutoff, or the due date if late work isn't allowed. */
  closesAt: z.iso.datetime().nullable(),
  maxAttempts: z.number().int(),
  latePolicy: latePolicySchema,
  submissionTypes: z.array(z.enum(["FILE", "TEXT"])),
  maxFileMb: z.number().int(),
  maxScore: z.string(),
  weight: z.string(),
  status: z.enum(ENUMS["assignments.status"]),
  version: z.number().int(),
});

export type Assignment = z.infer<typeof assignmentSchema>;

export const listAssignments = endpoint({
  method: "GET",
  path: "/course-offerings/:id/assignments",
  summary: "A course's assignments: published ones for students; all for its staff",
  tag: "Assessment",
  auth: "session",
  permission: "content:material:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(assignmentSchema) }),
});

const assignmentFields = {
  title: z.string().trim().min(1).max(200),
  instructionsMd: z.string().trim().min(1).max(20_000),
  dueAt: z.iso.datetime({ offset: true }),
  cutoffAt: z.iso.datetime({ offset: true }).nullable(),
  maxAttempts: z.number().int().min(1).max(10),
  latePolicy: latePolicySchema,
  submissionTypes: z
    .array(z.enum(["FILE", "TEXT"]))
    .min(1)
    .max(2),
  maxFileMb: z.number().int().min(1).max(20),
  maxScore: decimalText(1_000_000, 1),
  weight: decimalText(10_000),
};

export const createAssignment = endpoint({
  method: "POST",
  path: "/course-offerings/:id/assignments",
  summary: "Create an assignment (a draft) and its gradebook column together",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:assignment:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      ...assignmentFields,
      cutoffAt: assignmentFields.cutoffAt.optional(),
      maxAttempts: assignmentFields.maxAttempts.optional(),
      latePolicy: assignmentFields.latePolicy.optional(),
      submissionTypes: assignmentFields.submissionTypes.optional(),
      maxFileMb: assignmentFields.maxFileMb.optional(),
    })
    .strict(),
  response: assignmentSchema,
  successStatus: 201,
});

export const getAssignment = endpoint({
  method: "GET",
  path: "/assignments/:id",
  summary: "An assignment",
  tag: "Assessment",
  auth: "session",
  permission: "content:material:read",
  resource: { type: "assignment", param: "id" },
  params: idParams,
  response: assignmentSchema,
});

export const updateAssignment = endpoint({
  method: "PATCH",
  path: "/assignments/:id",
  summary: "Change an assignment and its gradebook column",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:assignment:manage",
  resource: { type: "assignment", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z.object(assignmentFields).partial().strict(),
  response: assignmentSchema,
});

export const publishAssignment = endpoint({
  method: "POST",
  path: "/assignments/:id/publish",
  summary: "Publish an assignment to the course's students",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:assignment:manage",
  resource: { type: "assignment", param: "id" },
  idempotent: true,
  params: idParams,
  response: assignmentSchema,
  successStatus: 200,
});

export const submissionFileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  downloadPath: z.string(),
});

export const submissionSchema = z.object({
  id: z.uuid(),
  attemptNo: z.number().int(),
  status: z.enum(ENUMS["assignment_submissions.status"]),
  textBody: z.string().nullable(),
  files: z.array(submissionFileSchema),
  submittedAt: z.iso.datetime().nullable(),
  /** Decided by the server from the submission time and the due date. */
  isLate: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export type Submission = z.infer<typeof submissionSchema>;

export const mySubmissionsSchema = z.object({
  /** Submitted attempts, oldest first, then the draft being written (if any). */
  attempts: z.array(submissionSchema),
  attemptsLeft: z.number().int(),
  /** Whether a draft can be saved or submitted now. */
  open: z.boolean(),
});

export type MySubmissions = z.infer<typeof mySubmissionsSchema>;

export const getMySubmissions = endpoint({
  method: "GET",
  path: "/assignments/:id/my-submissions",
  summary: "The caller's attempts at an assignment",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:submission:read",
  resource: { type: "assignment", param: "id", ownPart: true },
  params: idParams,
  response: mySubmissionsSchema,
});

export const saveDraft = endpoint({
  method: "PUT",
  path: "/assignments/:id/my-submissions/draft",
  summary: "Save the attempt being written (autosaved as the student types)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:submission:create",
  resource: { type: "assignment", param: "id", ownPart: true },
  params: idParams,
  body: z
    .object({
      textBody: z.string().max(100_000).nullable().optional(),
      /** The draft's files: uploads with purpose SUBMISSION, replacing the previous list. */
      fileIds: z.array(z.uuid()).max(10).optional(),
    })
    .strict(),
  response: submissionSchema,
});

export const submitDraft = endpoint({
  method: "POST",
  path: "/assignments/:id/my-submissions/submit",
  summary: "Submit the draft as an attempt (refused after the cutoff or past the attempt limit)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:submission:create",
  resource: { type: "assignment", param: "id", ownPart: true },
  idempotent: true,
  params: idParams,
  response: submissionSchema,
  successStatus: 200,
});

export const gradeSchema = z.object({
  id: z.uuid(),
  score: z.string().nullable(),
  feedbackMd: z.string().nullable(),
  source: z.enum(ENUMS["grades.source"]),
  status: z.enum(ENUMS["grades.status"]),
  gradedAt: z.iso.datetime().nullable(),
  version: z.number().int(),
});

export type Grade = z.infer<typeof gradeSchema>;

export const submissionForGradingSchema = z.object({
  studentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string().nullable(),
  /** The latest submitted attempt, or null if the student hasn't submitted. */
  latest: submissionSchema.nullable(),
  submittedAttempts: z.number().int(),
  /** Started days late at the latest attempt, and the deduction the late policy suggests. */
  daysLate: z.number().int(),
  suggestedPenaltyPercent: z.number().int(),
  grade: gradeSchema.nullable(),
});

export type SubmissionForGrading = z.infer<typeof submissionForGradingSchema>;

export const listSubmissions = endpoint({
  method: "GET",
  path: "/assignments/:id/submissions",
  summary: "Every enrolled student's latest submission and grade, for grading",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:grade:update",
  resource: { type: "assignment", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(submissionForGradingSchema) }),
});

export const downloadSubmissionFile = endpoint({
  method: "GET",
  path: "/assignment-submissions/:id/files/:fileId/download",
  summary: "Redirect to a 5-minute download URL for a file in a submission",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:submission:read",
  resource: { type: "assignment-submission", param: "id" },
  params: z.object({ id: z.uuid(), fileId: z.uuid() }),
  response: z.object({}),
  successStatus: 302,
});

export const putGrade = endpoint({
  method: "PUT",
  path: "/assessments/:id/grades/:studentId",
  summary:
    "Set a student's score and feedback (If-Match: the grade's version, or \"0\" for a new one)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:grade:update",
  resource: { type: "assessment", param: "id" },
  ifMatch: true,
  params: z.object({ id: z.uuid(), studentId: z.uuid() }),
  body: z
    .object({
      score: z.string().trim().nullable(),
      feedbackMd: z.string().trim().max(20_000).nullable().optional(),
      /** Why a recorded score is changing (kept in the grade history). */
      reason: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
  response: gradeSchema,
});
