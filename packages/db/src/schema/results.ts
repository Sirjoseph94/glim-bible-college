import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { courses } from "./academic";
import { courseOfferings } from "./offerings";
import { enumCheck, std, stdRo, tstz } from "./columns";
import { courseEnrollments, programmeEnrollments, students } from "./enrollment";
import { gradingSchemes } from "./grading-schemes";
import { users } from "./identity";

/**
 * Owner: results (TRD §6.8, §14.3). A student's result in a course: one per course enrollment
 * (or per imported legacy result, ticket 39). Everything that decides it is frozen when it is
 * FINALIZED: the scheme, credits, letter, points, quality points, pass and whether it counts.
 */
export const courseResults = pgTable(
  "course_results",
  {
    ...std(),
    courseEnrollmentId: uuid("course_enrollment_id")
      .unique()
      .references(() => courseEnrollments.id, { onDelete: "restrict" }),
    programmeEnrollmentId: uuid("programme_enrollment_id")
      .notNull()
      .references(() => programmeEnrollments.id, { onDelete: "restrict" }),
    /** When the course was completed: its offering's end date, or the imported date. */
    completedOn: date("completed_on").notNull(),
    courseOfferingId: uuid("course_offering_id").references(() => courseOfferings.id, {
      onDelete: "restrict",
    }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    gradingSchemeId: uuid("grading_scheme_id")
      .notNull()
      .references(() => gradingSchemes.id, { onDelete: "restrict" }),
    source: text().notNull().default("GRADEBOOK"),
    attemptNo: integer("attempt_no").notNull().default(1),
    creditsX10: integer("credits_x10").notNull(),
    finalPctX100: integer("final_pct_x100"),
    letter: text(),
    pointsX100: integer("points_x100"),
    qualityPointsX1000: bigint("quality_points_x1000", { mode: "number" }),
    resultKind: text("result_kind").notNull().default("GRADED"),
    countsInGpa: boolean("counts_in_gpa").notNull().default(true),
    passed: boolean(),
    status: text().notNull().default("DRAFT"),
    finalizedBy: uuid("finalized_by").references(() => users.id, { onDelete: "set null" }),
    finalizedAt: tstz("finalized_at"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: tstz("approved_at"),
    reopenedCount: integer("reopened_count").notNull().default(0),
  },
  (t) => [
    enumCheck("course_results.source", t.source),
    enumCheck("course_results.result_kind", t.resultKind),
    enumCheck("course_results.status", t.status),
    check(
      "course_results_gradebook_link",
      sql`${t.source} = 'IMPORT' OR (${t.courseEnrollmentId} IS NOT NULL AND ${t.courseOfferingId} IS NOT NULL)`,
    ),
    check("course_results_credits_check", sql`${t.creditsX10} >= 0`),
    check(
      "course_results_pct_check",
      sql`${t.finalPctX100} IS NULL OR ${t.finalPctX100} BETWEEN 0 AND 10000`,
    ),
    check(
      "course_results_finalized_check",
      sql`${t.status} = 'DRAFT' OR (${t.finalizedAt} IS NOT NULL)`,
    ),
    index("course_results_enrollment_completed").on(t.programmeEnrollmentId, t.completedOn),
    index("course_results_student_course").on(t.studentId, t.courseId),
    index("course_results_offering").on(t.courseOfferingId),
    // A legacy result is identified by who, when and what: importing it again updates it.
    uniqueIndex("course_results_import_once")
      .on(t.programmeEnrollmentId, t.courseId, t.completedOn)
      .where(sql`source = 'IMPORT'`),
  ],
);

/** Owner: results. Append-only history of a result's changes after finalization (reopen etc.). */
export const courseResultRevisions = pgTable("course_result_revisions", {
  ...stdRo(),
  courseResultId: uuid("course_result_id")
    .notNull()
    .references(() => courseResults.id, { onDelete: "restrict" }),
  changeKind: text("change_kind").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  changedBy: uuid("changed_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  reason: text().notNull(),
});

/** One line of an award's requirements checklist (§14.6). */
export interface AwardRequirement {
  key: string;
  label: string;
  met: boolean;
  detail: string | null;
}

/** Owner: results. Gap-free certificate numbers per award type and year. */
export const awardSequences = pgTable(
  "award_sequences",
  {
    awardType: text("award_type").notNull(),
    year: integer().notNull(),
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.awardType, t.year] })],
);

/**
 * Owner: results (TRD §6.8, §14.6). The Certificate (half the curriculum's credits passed) or the
 * Diploma (every course passed) of one programme enrollment (ADR-0005): proposed (DRAFT, with its
 * checklist), then CONFERRED by the Registrar with a certificate number.
 */
export const awards = pgTable(
  "awards",
  {
    ...std(),
    programmeEnrollmentId: uuid("programme_enrollment_id")
      .notNull()
      .references(() => programmeEnrollments.id, { onDelete: "restrict" }),
    awardType: text("award_type").notNull(),
    cgpaX100: integer("cgpa_x100").notNull(),
    awardClass: text("award_class"),
    creditsEarnedX10: integer("credits_earned_x10").notNull(),
    requirements: jsonb().$type<AwardRequirement[]>().notNull().default([]),
    awardedOn: date("awarded_on"),
    certificateNo: text("certificate_no").unique(),
    status: text().notNull().default("DRAFT"),
    proposedBy: uuid("proposed_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: tstz("approved_at"),
  },
  (t) => [
    enumCheck("awards.award_type", t.awardType),
    enumCheck("awards.status", t.status),
    unique("awards_once_per_type").on(t.programmeEnrollmentId, t.awardType),
    check(
      "awards_conferred_check",
      sql`${t.status} <> 'CONFERRED' OR (${t.certificateNo} IS NOT NULL AND ${t.awardedOn} IS NOT NULL AND ${t.awardClass} IS NOT NULL)`,
    ),
  ],
);
