import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { courses } from "./academic";
import { cohorts } from "./cohorts";
import { enumCheck, std } from "./columns";

/**
 * Owner: academic. One run of a course for one cohort, between its own dates, with its exam date
 * (ADR-0005). A cohort's live offerings never overlap (exclusion constraint, migration 0052).
 */
export const courseOfferings = pgTable(
  "course_offerings",
  {
    ...std(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => cohorts.id, { onDelete: "restrict" }),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    examOn: date("exam_on").notNull(),
    titleOverride: text("title_override"),
    capacity: integer(),
    status: text().notNull().default("DRAFT"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    policyOverrides: jsonb("policy_overrides")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    enumCheck("course_offerings.status", t.status),
    uniqueIndex("course_offerings_one_live_per_cohort")
      .on(t.courseId, t.cohortId)
      .where(sql`status <> 'CANCELLED'`),
    index("course_offerings_cohort_starts").on(t.cohortId, t.startsOn),
    check("course_offerings_capacity_check", sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),
    check(
      "course_offerings_dates_check",
      sql`${t.startsOn} <= ${t.examOn} AND ${t.examOn} <= ${t.endsOn}`,
    ),
  ],
);
