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
      /** Why a recorded score is changing (kept in the grade history); required once released. */
      reason: z.string().trim().min(1).max(500).optional(),
      /** Excuse the student from this assessment (no score; left out of the final result). */
      excused: z.boolean().optional(),
    })
    .strict(),
  response: gradeSchema,
});

// ---- question bank and quizzes (§14.2) ----

const qtype = z.enum(ENUMS["questions.qtype"]);
const points = decimalText(10_000, 1);

export const questionOptionSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(1000),
  correct: z.boolean(),
});

export const questionSchema = z.object({
  id: z.uuid(),
  qtype,
  promptMd: z.string(),
  promptHtml: z.string(),
  /** With the right answers marked: for the course's staff only. */
  options: z.array(questionOptionSchema),
  defaultPoints: z.string(),
  explanationMd: z.string().nullable(),
  status: z.enum(ENUMS["questions.status"]),
});

export type Question = z.infer<typeof questionSchema>;

export const listQuestions = endpoint({
  method: "GET",
  path: "/course-offerings/:id/questions",
  summary: "The question bank of the offering's course (shared by its offerings)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(questionSchema) }),
});

export const createQuestion = endpoint({
  method: "POST",
  path: "/course-offerings/:id/questions",
  summary: "Add a question to the course's bank",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      qtype,
      promptMd: z.string().trim().min(1).max(10_000),
      /** Choices (MCQ, true/false) or accepted answers (short text); none for an essay. */
      options: z.array(questionOptionSchema).max(20).optional(),
      defaultPoints: points.optional(),
      explanationMd: z.string().trim().max(10_000).nullable().optional(),
    })
    .strict(),
  response: questionSchema,
  successStatus: 201,
});

const quizQuestionInput = z.object({ questionId: z.uuid(), points: points.optional() }).strict();

export const quizSchema = z.object({
  id: z.uuid(),
  assessmentId: z.uuid(),
  courseOfferingId: z.uuid(),
  kind: z.enum(["QUIZ", "EXAM"]),
  title: z.string(),
  instructionsMd: z.string().nullable(),
  instructionsHtml: z.string().nullable(),
  timeLimitMinutes: z.number().int().nullable(),
  maxAttempts: z.number().int(),
  attemptScoring: z.enum(ENUMS["quizzes.attempt_scoring"]),
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
  shuffleQuestions: z.boolean(),
  showAnswers: z.enum(ENUMS["quizzes.show_answers"]),
  eligibleStudyMode: z.enum(ENUMS["quizzes.eligible_study_mode"]),
  status: z.enum(ENUMS["quizzes.status"]),
  /** The gradebook column's maximum: the questions' total, or an online exam's exam maximum. */
  maxScore: z.string(),
  /** The total of the questions' points; an online exam's score is scaled from it to `maxScore`. */
  pointsTotal: z.string(),
  weight: z.string(),
  questionCount: z.number().int(),
  /** The questions and points, for the course's staff (empty for students). */
  questions: z.array(
    z.object({ questionId: z.uuid(), points: z.string(), qtype, promptMd: z.string() }),
  ),
  version: z.number().int(),
});

export type Quiz = z.infer<typeof quizSchema>;

export const listQuizzes = endpoint({
  method: "GET",
  path: "/course-offerings/:id/quizzes",
  summary: "A course's quizzes and online exams: published ones for students; all for its staff",
  tag: "Assessment",
  auth: "session",
  permission: "content:material:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(quizSchema) }),
});

const quizSettings = {
  title: z.string().trim().min(1).max(200),
  instructionsMd: z.string().trim().max(10_000).nullable(),
  timeLimitMinutes: z.number().int().min(1).max(600).nullable(),
  maxAttempts: z.number().int().min(1).max(10),
  attemptScoring: z.enum(ENUMS["quizzes.attempt_scoring"]),
  opensAt: z.iso.datetime({ offset: true }).nullable(),
  closesAt: z.iso.datetime({ offset: true }).nullable(),
  shuffleQuestions: z.boolean(),
  showAnswers: z.enum(ENUMS["quizzes.show_answers"]),
  weight: decimalText(10_000),
  questions: z.array(quizQuestionInput).min(1).max(200),
};

export const createQuiz = endpoint({
  method: "POST",
  path: "/course-offerings/:id/quizzes",
  summary: "Create a quiz (a draft) from bank questions, with its gradebook column",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      title: quizSettings.title,
      weight: quizSettings.weight,
      questions: quizSettings.questions,
      instructionsMd: quizSettings.instructionsMd.optional(),
      timeLimitMinutes: quizSettings.timeLimitMinutes.optional(),
      maxAttempts: quizSettings.maxAttempts.optional(),
      attemptScoring: quizSettings.attemptScoring.optional(),
      opensAt: quizSettings.opensAt.optional(),
      closesAt: quizSettings.closesAt.optional(),
      shuffleQuestions: quizSettings.shuffleQuestions.optional(),
      showAnswers: quizSettings.showAnswers.optional(),
    })
    .strict(),
  response: quizSchema,
  successStatus: 201,
});

export const getQuiz = endpoint({
  method: "GET",
  path: "/quizzes/:id",
  summary: "A quiz",
  tag: "Assessment",
  auth: "session",
  permission: "content:material:read",
  resource: { type: "quiz", param: "id" },
  params: idParams,
  response: quizSchema,
});

export const updateQuiz = endpoint({
  method: "PATCH",
  path: "/quizzes/:id",
  summary: "Change a quiz's settings (its questions only while it's a draft)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "quiz", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z.object(quizSettings).partial().strict(),
  response: quizSchema,
});

export const publishQuiz = endpoint({
  method: "POST",
  path: "/quizzes/:id/publish",
  summary: "Publish a quiz to the course's students",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "quiz", param: "id" },
  idempotent: true,
  params: idParams,
  response: quizSchema,
  successStatus: 200,
});

/** A response as sent and stored: chosen option ids, or written text. */
export const quizResponseValue = z.union([
  z.object({ optionIds: z.array(z.string().min(1).max(40)).max(20) }).strict(),
  z.object({ text: z.string().max(50_000) }).strict(),
]);

export const attemptQuestionSchema = z.object({
  questionId: z.uuid(),
  qtype,
  promptHtml: z.string(),
  /** Choices for MCQ and true/false (without the answers while attempting); empty otherwise. */
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  points: z.string(),
  response: quizResponseValue.nullable(),
  /** Shown once answers may be seen (the quiz's `showAnswers`), and always to staff. */
  correctOptionIds: z.array(z.string()).nullable(),
  acceptedAnswers: z.array(z.string()).nullable(),
  explanationHtml: z.string().nullable(),
  isCorrect: z.boolean().nullable(),
  pointsAwarded: z.string().nullable(),
  graderComment: z.string().nullable(),
});

export const quizAttemptSchema = z.object({
  id: z.uuid(),
  quizId: z.uuid(),
  attemptNo: z.number().int(),
  status: z.enum(ENUMS["quiz_attempts.status"]),
  startedAt: z.iso.datetime(),
  /** When the attempt ends, enforced by the server; null if untimed. */
  deadlineAt: z.iso.datetime().nullable(),
  /** The server's clock, so the page can count down correctly on a phone with the wrong time. */
  serverNow: z.iso.datetime(),
  submittedAt: z.iso.datetime().nullable(),
  /** The highest `seq` stored; a page resumes numbering after it. */
  lastSeq: z.number().int(),
  /** Shown once marked (essays by hand). */
  score: z.string().nullable(),
  maxScore: z.string(),
  questions: z.array(attemptQuestionSchema),
});

export type QuizAttempt = z.infer<typeof quizAttemptSchema>;

export const startAttempt = endpoint({
  method: "POST",
  path: "/quizzes/:id/attempts",
  summary: "Start an attempt (or carry on with the one in progress); its questions are frozen",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:attempt",
  resource: { type: "quiz", param: "id", ownPart: true },
  params: idParams,
  response: quizAttemptSchema,
  successStatus: 200,
});

export const myQuizAttemptsSchema = z.object({
  attempts: z.array(
    z.object({
      id: z.uuid(),
      attemptNo: z.number().int(),
      status: z.enum(ENUMS["quiz_attempts.status"]),
      submittedAt: z.iso.datetime().nullable(),
      score: z.string().nullable(),
    }),
  ),
  attemptsLeft: z.number().int(),
  /** Whether an attempt can be started (or resumed) now. */
  open: z.boolean(),
  /**
   * False for an online exam the student sits on paper instead (an On-campus student without an
   * exception from the Lecturer).
   */
  eligible: z.boolean(),
});

export type MyQuizAttempts = z.infer<typeof myQuizAttemptsSchema>;

export const getMyQuizAttempts = endpoint({
  method: "GET",
  path: "/quizzes/:id/my-attempts",
  summary: "The caller's attempts at a quiz",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:submission:read",
  resource: { type: "quiz", param: "id", ownPart: true },
  params: idParams,
  response: myQuizAttemptsSchema,
});

export const getQuizAttempt = endpoint({
  method: "GET",
  path: "/quiz-attempts/:id",
  summary: "An attempt: the student's own, or any on the course for its graders",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:submission:read",
  resource: { type: "quiz-attempt", param: "id" },
  params: idParams,
  response: quizAttemptSchema,
});

export const saveQuizResponses = endpoint({
  method: "PATCH",
  path: "/quiz-attempts/:id",
  summary: "Autosave responses; a `seq` not above the last one stored is ignored",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:attempt",
  resource: { type: "quiz-attempt", param: "id" },
  params: idParams,
  body: z
    .object({
      seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      responses: z
        .array(z.object({ questionId: z.uuid(), response: quizResponseValue.nullable() }).strict())
        .max(200),
    })
    .strict(),
  response: z.object({ lastSeq: z.number().int(), saved: z.boolean() }),
});

export const submitQuizAttempt = endpoint({
  method: "POST",
  path: "/quiz-attempts/:id/submit",
  summary: "Submit the attempt (submitting again changes nothing); objective questions are marked",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:attempt",
  resource: { type: "quiz-attempt", param: "id" },
  idempotent: true,
  params: idParams,
  response: quizAttemptSchema,
  successStatus: 200,
});

export const quizAttemptForGradingSchema = z.object({
  attemptId: z.uuid(),
  studentId: z.uuid(),
  studentName: z.string(),
  attemptNo: z.number().int(),
  status: z.enum(ENUMS["quiz_attempts.status"]),
  submittedAt: z.iso.datetime().nullable(),
  score: z.string().nullable(),
  /** Essay answers not marked yet. */
  essaysToMark: z.number().int(),
});

export const listQuizAttempts = endpoint({
  method: "GET",
  path: "/quizzes/:id/attempts",
  summary: "Every finished attempt, those with essays to mark first",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:grade:update",
  resource: { type: "quiz", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(quizAttemptForGradingSchema) }),
});

export const markQuizResponse = endpoint({
  method: "PUT",
  path: "/quiz-attempts/:id/responses/:questionId",
  summary: "Mark an essay answer; once all are marked the attempt's score goes to the gradebook",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:grade:update",
  resource: { type: "quiz-attempt", param: "id" },
  params: z.object({ id: z.uuid(), questionId: z.uuid() }),
  body: z
    .object({
      points: decimalText(10_000),
      comment: z.string().trim().max(5000).nullable().optional(),
    })
    .strict(),
  response: quizAttemptSchema,
});

// ---- gradebook and release (§14.2) ----

export const gradebookColumnSchema = z.object({
  assessmentId: z.uuid(),
  kind: z.enum(ENUMS["assessments.kind"]),
  title: z.string(),
  maxScore: z.string(),
  weight: z.string(),
  status: z.enum(ENUMS["assessments.status"]),
  dueAt: z.iso.datetime().nullable(),
  /** Scored grades still DRAFT: what releasing would show to students. */
  unreleased: z.number().int(),
  released: z.number().int(),
  /** An EXAM's online part (a quiz for Online students), if it has one. */
  onlineQuizId: z.uuid().nullable(),
  version: z.number().int(),
});

export type GradebookColumn = z.infer<typeof gradebookColumnSchema>;

export const gradebookCellSchema = gradeSchema.extend({ assessmentId: z.uuid() });

export const gradebookRowSchema = z.object({
  studentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string().nullable(),
  studyMode: z.enum(ENUMS["programme_enrollments.study_mode"]),
  /** One per column that has a grade. */
  grades: z.array(gradebookCellSchema),
  /**
   * Online exam scores (scaled to the exam's maximum) per EXAM column the student sat online, so
   * the Lecturer can choose it when there is a paper score too.
   */
  onlineScores: z.array(z.object({ assessmentId: z.uuid(), score: z.string() })),
});

export type GradebookRow = z.infer<typeof gradebookRowSchema>;

export const gradebookSchema = z.object({
  columns: z.array(gradebookColumnSchema),
  rows: z.array(gradebookRowSchema),
  /** Weights of the published and closed columns; finalization needs exactly "100.00". */
  weightTotal: z.string(),
  weightsValid: z.boolean(),
});

export type Gradebook = z.infer<typeof gradebookSchema>;

export const getGradebook = endpoint({
  method: "GET",
  path: "/course-offerings/:id/gradebook",
  summary: "Every column and every enrolled student's grades, with the weight total",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:grade:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: gradebookSchema,
});

export const createGradebookColumn = endpoint({
  method: "POST",
  path: "/course-offerings/:id/assessments",
  summary: "Add a hand-entered gradebook column (e.g. participation)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:assignment:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200),
      maxScore: decimalText(100_000, 1),
      weight: decimalText(10_000),
    })
    .strict(),
  response: gradebookColumnSchema,
  successStatus: 201,
});

export const updateGradebookColumn = endpoint({
  method: "PATCH",
  path: "/assessments/:id",
  summary: "Rename a gradebook column or change its weight (If-Match: the column's version)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:assignment:manage",
  resource: { type: "assessment", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      weight: decimalText(10_000).optional(),
    })
    .strict(),
  response: gradebookColumnSchema,
});

export const releaseGrades = endpoint({
  method: "POST",
  path: "/assessments/:id/release",
  summary:
    "Release the column's scored DRAFT grades to students (grades entered later wait for the next release)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:grade:release",
  resource: { type: "assessment", param: "id" },
  idempotent: true,
  params: idParams,
  response: z.object({ released: z.number().int(), column: gradebookColumnSchema }),
  successStatus: 200,
});

export const gradeImportRowSchema = z.object({
  line: z.number().int(),
  matricNumber: z.string(),
  studentName: z.string().nullable(),
  oldScore: z.string().nullable(),
  newScore: z.string().nullable(),
  outcome: z.enum(["created", "updated", "unchanged", "error"]),
  message: z.string().nullable(),
});

export const importGrades = endpoint({
  method: "POST",
  path: "/course-offerings/:id/grades/import",
  summary:
    "Import one column's scores from CSV (matric_number, score, feedback); a dry run changes nothing, and nothing is saved if any row has an error",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:grade:update",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  body: z
    .object({
      assessmentId: z.uuid(),
      csv: z.string().min(1).max(1_000_000),
      dryRun: z.boolean(),
    })
    .strict(),
  response: z.object({
    applied: z.boolean(),
    rows: z.array(gradeImportRowSchema),
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    errors: z.number().int(),
  }),
  successStatus: 200,
});

export const myGradeSchema = z.object({
  assessmentId: z.uuid(),
  kind: z.enum(ENUMS["assessments.kind"]),
  title: z.string(),
  maxScore: z.string(),
  weight: z.string(),
  score: z.string().nullable(),
  excused: z.boolean(),
  /** Rendered and sanitized on the server. */
  feedbackHtml: z.string().nullable(),
  releasedAt: z.iso.datetime().nullable(),
});

export type MyGrade = z.infer<typeof myGradeSchema>;

export const getMyGrades = endpoint({
  method: "GET",
  path: "/course-offerings/:id/my-grades",
  summary: "The caller's released grades on a course (nothing still in draft)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:grade:read",
  resource: { type: "course-offering", param: "id", ownPart: true },
  params: idParams,
  response: z.object({ items: z.array(myGradeSchema) }),
});

// ---- hybrid exams (§14.2, C-34) ----

export const createExam = endpoint({
  method: "POST",
  path: "/course-offerings/:id/exams",
  summary:
    "Add an exam column: On-campus students sit it on paper (scores entered or imported); an online part can be added for Online students",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200),
      maxScore: decimalText(100_000, 1),
      weight: decimalText(10_000),
      /** When the paper exam is held. */
      heldAt: z.iso.datetime({ offset: true }).nullable().optional(),
    })
    .strict(),
  response: gradebookColumnSchema,
  successStatus: 201,
});

export const createOnlineExam = endpoint({
  method: "POST",
  path: "/assessments/:id/online-exam",
  summary:
    "Add the timed online part of an exam (a draft quiz for Online students); its score is scaled to the exam's maximum",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "assessment", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      questions: quizSettings.questions,
      timeLimitMinutes: quizSettings.timeLimitMinutes,
      instructionsMd: quizSettings.instructionsMd.optional(),
      maxAttempts: quizSettings.maxAttempts.optional(),
      attemptScoring: quizSettings.attemptScoring.optional(),
      opensAt: quizSettings.opensAt.optional(),
      closesAt: quizSettings.closesAt.optional(),
      shuffleQuestions: quizSettings.shuffleQuestions.optional(),
      showAnswers: quizSettings.showAnswers.optional(),
    })
    .strict(),
  response: quizSchema,
  successStatus: 201,
});

export const onlineGrantSchema = z.object({
  studentId: z.uuid(),
  studentName: z.string(),
  matricNumber: z.string().nullable(),
  reason: z.string(),
  grantedAt: z.iso.datetime(),
});

export type OnlineGrant = z.infer<typeof onlineGrantSchema>;

export const listOnlineGrants = endpoint({
  method: "GET",
  path: "/quizzes/:id/online-grants",
  summary: "On-campus students allowed to sit this online exam",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "quiz", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(onlineGrantSchema) }),
});

export const grantOnline = endpoint({
  method: "PUT",
  path: "/quizzes/:id/online-grants/:studentId",
  summary: "Let an On-campus student sit this online exam (granting again changes nothing)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "quiz", param: "id" },
  params: z.object({ id: z.uuid(), studentId: z.uuid() }),
  body: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
  response: onlineGrantSchema,
});

export const revokeOnline = endpoint({
  method: "DELETE",
  path: "/quizzes/:id/online-grants/:studentId",
  summary: "Withdraw an exception (attempts already started are kept)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:quiz:manage",
  resource: { type: "quiz", param: "id" },
  params: z.object({ id: z.uuid(), studentId: z.uuid() }),
  response: z.object({}),
  successStatus: 204,
});

export const useOnlineScore = endpoint({
  method: "POST",
  path: "/assessments/:id/grades/:studentId/online-score",
  summary:
    "Use the student's online exam score instead of the paper one (If-Match: the grade's version; a reason is required)",
  tag: "Assessment",
  auth: "session",
  permission: "assessment:grade:update",
  resource: { type: "assessment", param: "id" },
  ifMatch: true,
  params: z.object({ id: z.uuid(), studentId: z.uuid() }),
  body: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
  response: gradeSchema,
  successStatus: 200,
});
