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

/** Owner: academic. GLIM: CERT (1 year, Year 1) and DIP (2 years, Years 1–2) (TRD §6.3). */
export const programmes = pgTable(
  "programmes",
  {
    ...std(),
    code: citext().notNull().unique(),
    name: text().notNull(),
    awardType: text("award_type").notNull(),
    durationSemesters: smallint("duration_semesters").notNull(),
    levels: smallint().notNull(),
    /** FK to grading_schemes is added with M07 (ticket 37). */
    gradingSchemeId: uuid("grading_scheme_id"),
    status: text().notNull().default("ACTIVE"),
  },
  (t) => [
    enumCheck("programmes.award_type", t.awardType),
    enumCheck("programmes.status", t.status),
    check("programmes_duration_semesters_check", sql`${t.durationSemesters} > 0`),
    check("programmes_levels_check", sql`${t.levels} BETWEEN 1 AND 4`),
  ],
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
    /** Award requirement (§14.6). */
    minElectiveCredits: numeric("min_elective_credits", { precision: 4, scale: 1 })
      .notNull()
      .default("0"),
    status: text().notNull().default("DRAFT"),
  },
  (t) => [
    enumCheck("curricula.status", t.status),
    uniqueIndex("curricula_programme_version").on(t.programmeId, t.curriculumVersion),
    uniqueIndex("one_active_curriculum")
      .on(t.programmeId)
      .where(sql`status = 'ACTIVE'`),
    check("curricula_min_elective_credits_check", sql`${t.minElectiveCredits} >= 0`),
  ],
);

/** Owner: academic. A course placed as compulsory or elective at a Level and semester. */
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
    levelNo: smallint("level_no").notNull(),
    semesterNo: smallint("semester_no").notNull(),
    courseType: text("course_type").notNull(),
    creditOverride: numeric("credit_override", { precision: 4, scale: 1 }),
  },
  (t) => [
    enumCheck("curriculum_courses.course_type", t.courseType),
    check("curriculum_courses_semester_no_check", sql`${t.semesterNo} IN (1, 2)`),
    check("curriculum_courses_level_no_check", sql`${t.levelNo} BETWEEN 1 AND 4`),
    uniqueIndex("curriculum_courses_curriculum_course").on(t.curriculumId, t.courseId),
  ],
);
