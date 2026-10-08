import { sql } from "drizzle-orm";
import {
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
import { courseOfferings } from "./academic";
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
