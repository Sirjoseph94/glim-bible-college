import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, enumCheck, std } from "./columns";
import { gradingSchemes } from "./grading-schemes";

/**
 * Owner: academic. GLIM has one: the Diploma, whose students earn the Certificate halfway
 * (ADR-0005).
 */
export const programmes = pgTable(
  "programmes",
  {
    ...std(),
    code: citext().notNull().unique(),
    name: text().notNull(),
    /** The scheme its results are graded with (§14.4); set by the Registrar. */
    gradingSchemeId: uuid("grading_scheme_id").references(() => gradingSchemes.id, {
      onDelete: "restrict",
    }),
    status: text().notNull().default("ACTIVE"),
  },
  (t) => [enumCheck("programmes.status", t.status)],
);

/** Owner: academic. A reusable subject definition; credits are exact (numeric(4,1), INV-14). */
export const courses = pgTable(
  "courses",
  {
    ...std(),
    code: citext().notNull().unique(),
    title: text().notNull(),
    description: text(),
    credits: numeric({ precision: 4, scale: 1 }).notNull().default("0"),
    status: text().notNull().default("ACTIVE"),
  },
  (t) => [
    enumCheck("courses.status", t.status),
    check("courses_credits_check", sql`${t.credits} >= 0`),
  ],
);

/** Owner: academic. Versioned; programme enrollments keep the version they started on. */
export const curricula = pgTable(
  "curricula",
  {
    ...std(),
    programmeId: uuid("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "restrict" }),
    curriculumVersion: integer("curriculum_version").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    status: text().notNull().default("DRAFT"),
  },
  (t) => [
    enumCheck("curricula.status", t.status),
    uniqueIndex("curricula_programme_version").on(t.programmeId, t.curriculumVersion),
    uniqueIndex("one_active_curriculum")
      .on(t.programmeId)
      .where(sql`status = 'ACTIVE'`),
  ],
);

/**
 * Owner: academic. A course in the curriculum at its place in the default order. Positions are
 * unique per curriculum through a deferrable constraint (migration 0052), so a reorder can swap
 * them in one transaction.
 */
export const curriculumCourses = pgTable(
  "curriculum_courses",
  {
    ...std(),
    curriculumId: uuid("curriculum_id")
      .notNull()
      .references(() => curricula.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    position: smallint().notNull(),
    creditOverride: numeric("credit_override", { precision: 4, scale: 1 }),
  },
  (t) => [
    check("curriculum_courses_position_check", sql`${t.position} > 0`),
    uniqueIndex("curriculum_courses_curriculum_course").on(t.curriculumId, t.courseId),
  ],
);

/** Owner: academic. Capacity is informational (C-35). */
export const rooms = pgTable(
  "rooms",
  {
    ...std(),
    code: citext().notNull().unique(),
    name: text().notNull(),
    capacity: integer(),
    status: text().notNull().default("ACTIVE"),
  },
  (t) => [
    enumCheck("rooms.status", t.status),
    check("rooms_capacity_check", sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),
  ],
);
