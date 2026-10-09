import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { courseOfferings, courses } from "./academic";
import { enumCheck, std, stdRo, tstz } from "./columns";
import { files } from "./content";
import { students } from "./enrollment";
import { users } from "./identity";

/**
 * Owner: assessment. A gradebook column (TRD §6.6, §14.2): every assignment, quiz and exam is
 * backed by one, created in the same transaction. Scores and weights are exact decimals.
 */
export const assessments = pgTable(
  "assessments",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    kind: text().notNull(),
    title: text().notNull(),
    maxScore: numeric("max_score", { precision: 7, scale: 2 }).notNull(),
    weight: numeric({ precision: 5, scale: 2 }).notNull(),
    position: integer().notNull().default(0),
    status: text().notNull().default("DRAFT"),
    dueAt: tstz("due_at"),
  },
  (t) => [
    enumCheck("assessments.kind", t.kind),
    enumCheck("assessments.status", t.status),
    check("assessments_max_score_check", sql`${t.maxScore} > 0`),
    check("assessments_weight_check", sql`${t.weight} >= 0 AND ${t.weight} <= 100`),
    index("assessments_offering").on(t.courseOfferingId, t.position),
  ],
);

/** What happens after the due date (§14.2): penalties are only suggested to the grader. */
export interface LatePolicy {
  allowLate: boolean;
  /** Suggested deduction per started day late, in percent of the score. */
  penaltyPercentPerDay?: number | undefined;
}

/** Owner: assessment. Backs exactly one ASSIGNMENT assessment. */
export const assignments = pgTable(
  "assignments",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .unique()
      .references(() => assessments.id, { onDelete: "restrict" }),
    instructionsMd: text("instructions_md").notNull(),
    dueAt: tstz("due_at").notNull(),
    cutoffAt: tstz("cutoff_at"),
    maxAttempts: integer("max_attempts").notNull().default(1),
    latePolicy: jsonb("late_policy").$type<LatePolicy>().notNull().default({ allowLate: false }),
    submissionTypes: text("submission_types")
      .array()
      .notNull()
      .default(sql`'{FILE,TEXT}'`),
    maxFileMb: integer("max_file_mb").notNull().default(20),
    status: text().notNull().default("DRAFT"),
  },
  (t) => [
    enumCheck("assignments.status", t.status),
    check("assignments_max_attempts_check", sql`${t.maxAttempts} BETWEEN 1 AND 10`),
    check(
      "assignments_cutoff_after_due",
      sql`${t.cutoffAt} IS NULL OR ${t.cutoffAt} >= ${t.dueAt}`,
    ),
    check("assignments_max_file_mb_check", sql`${t.maxFileMb} BETWEEN 1 AND 20`),
    check(
      "assignments_submission_types_check",
      sql`cardinality(${t.submissionTypes}) > 0 AND ${t.submissionTypes} <@ ARRAY['FILE','TEXT']`,
    ),
    index("assignments_offering").on(t.courseOfferingId),
  ],
);

/**
 * Owner: assessment. One attempt by a student. At most one DRAFT per student and assignment
 * (the attempt being written); SUBMITTED attempts are fixed.
 */
export const assignmentSubmissions = pgTable(
  "assignment_submissions",
  {
    ...std(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    attemptNo: integer("attempt_no").notNull(),
    textBody: text("text_body"),
    status: text().notNull().default("DRAFT"),
    submittedAt: tstz("submitted_at"),
    isLate: boolean("is_late").notNull().default(false),
  },
  (t) => [
    enumCheck("assignment_submissions.status", t.status),
    unique("assignment_submissions_attempt").on(t.assignmentId, t.studentId, t.attemptNo),
    uniqueIndex("assignment_submissions_one_draft")
      .on(t.assignmentId, t.studentId)
      .where(sql`status = 'DRAFT'`),
    check(
      "assignment_submissions_submitted_at",
      sql`(${t.status} = 'DRAFT') = (${t.submittedAt} IS NULL)`,
    ),
  ],
);

/** Owner: assessment. The files in a submission. */
export const submissionFiles = pgTable(
  "submission_files",
  {
    ...stdRo(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => assignmentSubmissions.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "restrict" }),
  },
  (t) => [unique("submission_files_once").on(t.submissionId, t.fileId)],
);

/** Owner: assessment. One row per (assessment, student): the gradebook cell. */
export const grades = pgTable(
  "grades",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    score: numeric({ precision: 7, scale: 2 }),
    source: text().notNull().default("MANUAL"),
    status: text().notNull().default("DRAFT"),
    feedbackMd: text("feedback_md"),
    gradedBy: uuid("graded_by").references(() => users.id, { onDelete: "set null" }),
    gradedAt: tstz("graded_at"),
    releasedAt: tstz("released_at"),
  },
  (t) => [
    enumCheck("grades.source", t.source),
    enumCheck("grades.status", t.status),
    unique("grades_assessment_student").on(t.assessmentId, t.studentId),
    check("grades_score_check", sql`${t.score} IS NULL OR ${t.score} >= 0`),
    index("grades_offering_student").on(t.courseOfferingId, t.studentId),
  ],
);

/** Owner: assessment. Append-only history of every grade change, beside the audit log. */
export const gradeChanges = pgTable("grade_changes", {
  ...stdRo(),
  gradeId: uuid("grade_id")
    .notNull()
    .references(() => grades.id, { onDelete: "restrict" }),
  oldScore: numeric("old_score", { precision: 7, scale: 2 }),
  newScore: numeric("new_score", { precision: 7, scale: 2 }),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  oldSource: text("old_source"),
  newSource: text("new_source"),
  changedBy: uuid("changed_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  reason: text(),
});

/** An option of a choice question, or an accepted answer of a short-text one. */
export interface QuestionOption {
  id: string;
  text: string;
  correct: boolean;
}

/**
 * Owner: assessment. The question bank of a course (TRD §6.6), shared by its offerings. MCQ and
 * true/false questions keep their options with the correct ones marked; short-text questions keep
 * their accepted answers (all `correct`); essays are marked by hand.
 */
export const questions = pgTable(
  "questions",
  {
    ...std(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    qtype: text().notNull(),
    promptMd: text("prompt_md").notNull(),
    options: jsonb().$type<QuestionOption[]>().notNull().default([]),
    defaultPoints: numeric("default_points", { precision: 6, scale: 2 }).notNull().default("1"),
    explanationMd: text("explanation_md"),
    status: text().notNull().default("ACTIVE"),
  },
  (t) => [
    enumCheck("questions.qtype", t.qtype),
    enumCheck("questions.status", t.status),
    check("questions_default_points_check", sql`${t.defaultPoints} > 0`),
    index("questions_course").on(t.courseId, t.status),
  ],
);

/** Owner: assessment. Backs one QUIZ or EXAM assessment (online exams, C-34). */
export const quizzes = pgTable(
  "quizzes",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .unique()
      .references(() => assessments.id, { onDelete: "restrict" }),
    title: text().notNull(),
    instructionsMd: text("instructions_md"),
    timeLimitMinutes: integer("time_limit_minutes"),
    maxAttempts: integer("max_attempts").notNull().default(1),
    attemptScoring: text("attempt_scoring").notNull().default("HIGHEST"),
    opensAt: tstz("opens_at"),
    closesAt: tstz("closes_at"),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(false),
    showAnswers: text("show_answers").notNull().default("AFTER_CLOSE"),
    eligibleStudyMode: text("eligible_study_mode").notNull().default("ALL"),
    status: text().notNull().default("DRAFT"),
  },
  (t) => [
    enumCheck("quizzes.attempt_scoring", t.attemptScoring),
    enumCheck("quizzes.show_answers", t.showAnswers),
    enumCheck("quizzes.eligible_study_mode", t.eligibleStudyMode),
    enumCheck("quizzes.status", t.status),
    check("quizzes_max_attempts_check", sql`${t.maxAttempts} BETWEEN 1 AND 10`),
    check(
      "quizzes_time_limit_check",
      sql`${t.timeLimitMinutes} IS NULL OR ${t.timeLimitMinutes} BETWEEN 1 AND 600`,
    ),
    check(
      "quizzes_window_check",
      sql`${t.opensAt} IS NULL OR ${t.closesAt} IS NULL OR ${t.closesAt} > ${t.opensAt}`,
    ),
    index("quizzes_offering").on(t.courseOfferingId),
  ],
);

/**
 * Owner: assessment. An On-campus student allowed to sit an online exam (C-34): eligibility
 * otherwise follows the student's Study Mode.
 */
export const examOnlineGrants = pgTable(
  "exam_online_grants",
  {
    ...stdRo(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text().notNull(),
  },
  (t) => [unique("exam_online_grants_once").on(t.quizId, t.studentId)],
);

/** Owner: assessment. The questions of a quiz, in order, with their points. */
export const quizQuestions = pgTable(
  "quiz_questions",
  {
    ...stdRo(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    position: integer().notNull(),
    points: numeric({ precision: 6, scale: 2 }).notNull(),
  },
  (t) => [
    unique("quiz_questions_once").on(t.quizId, t.questionId),
    check("quiz_questions_points_check", sql`${t.points} > 0`),
  ],
);

/** A question as it was when an attempt started: later edits to the bank never change it. */
export interface SnapshotQuestion {
  questionId: string;
  qtype: string;
  promptMd: string;
  options: QuestionOption[];
  /** In hundredths. */
  pointsX100: number;
  explanationMd: string | null;
}

/** Owner: assessment. One attempt; `question_snapshot` FREEZES the content at start. */
export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    ...std(),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    attemptNo: integer("attempt_no").notNull(),
    startedAt: tstz("started_at").notNull(),
    deadlineAt: tstz("deadline_at"),
    submittedAt: tstz("submitted_at"),
    status: text().notNull().default("IN_PROGRESS"),
    questionSnapshot: jsonb("question_snapshot").$type<SnapshotQuestion[]>().notNull(),
    autoScore: numeric("auto_score", { precision: 7, scale: 2 }),
    manualScore: numeric("manual_score", { precision: 7, scale: 2 }),
    score: numeric({ precision: 7, scale: 2 }),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    enumCheck("quiz_attempts.status", t.status),
    unique("quiz_attempts_attempt").on(t.quizId, t.studentId, t.attemptNo),
    uniqueIndex("quiz_attempts_one_in_progress")
      .on(t.quizId, t.studentId)
      .where(sql`status = 'IN_PROGRESS'`),
  ],
);

/** Owner: assessment. A response to one question of an attempt, and how it was marked. */
export const quizResponses = pgTable(
  "quiz_responses",
  {
    ...std(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: uuid("question_id").notNull(),
    response: jsonb().$type<QuizResponseValue>(),
    isCorrect: boolean("is_correct"),
    pointsAwarded: numeric("points_awarded", { precision: 6, scale: 2 }),
    graderComment: text("grader_comment"),
  },
  (t) => [unique("quiz_responses_once").on(t.attemptId, t.questionId)],
);

/** Chosen option ids (MCQ, true/false) or written text (short text, essay). */
export type QuizResponseValue = { optionIds: string[] } | { text: string };

/**
 * Owner: assessment. A student's grades on a course frozen by finalization (§14.3,
 * `GRADEBOOK_LOCKED`); reopening the result removes the row.
 */
export const gradebookLocks = pgTable(
  "gradebook_locks",
  {
    ...stdRo(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
  },
  (t) => [unique("gradebook_locks_once").on(t.courseOfferingId, t.studentId)],
);
