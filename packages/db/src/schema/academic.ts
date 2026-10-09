import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, enumCheck, std } from "./columns";
import { gradingSchemes } from "./results";

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
    /** The scheme its results are graded with (§14.4); set by the Registrar. */
    gradingSchemeId: uuid("grading_scheme_id").references(() => gradingSchemes.id, {
      onDelete: "restrict",
    }),
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

/** Owner: academic. One academic year, September to June, e.g. code "2027/2028" (TRD §9.1). */
export const academicSessions = pgTable(
  "academic_sessions",
  {
    ...std(),
    code: citext().notNull().unique(),
    name: text().notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    status: text().notNull().default("PLANNED"),
  },
  (t) => [
    enumCheck("academic_sessions.status", t.status),
    check("academic_sessions_dates_check", sql`${t.endsOn} > ${t.startsOn}`),
  ],
);

/** Owner: academic. Sequence 1 = Sept–Jan, 2 = Feb–June, each ending with exams (§9.1). */
export const semesters = pgTable(
  "semesters",
  {
    ...std(),
    academicSessionId: uuid("academic_session_id")
      .notNull()
      .references(() => academicSessions.id, { onDelete: "restrict" }),
    code: citext().notNull(),
    name: text().notNull(),
    sequence: smallint().notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    registrationOpensOn: date("registration_opens_on"),
    registrationClosesOn: date("registration_closes_on"),
    addDropDeadlineOn: date("add_drop_deadline_on"),
    examsStartOn: date("exams_start_on"),
    examsEndOn: date("exams_end_on"),
    status: text().notNull().default("PLANNED"),
  },
  (t) => [
    enumCheck("semesters.status", t.status),
    uniqueIndex("semesters_session_sequence").on(t.academicSessionId, t.sequence),
    uniqueIndex("semesters_session_code").on(t.academicSessionId, t.code),
    check("semesters_dates_check", sql`${t.endsOn} > ${t.startsOn}`),
    check(
      "semesters_registration_check",
      sql`${t.registrationOpensOn} IS NULL OR ${t.registrationClosesOn} IS NULL OR ${t.registrationClosesOn} >= ${t.registrationOpensOn}`,
    ),
    check(
      "semesters_exams_check",
      sql`(${t.examsStartOn} IS NULL) = (${t.examsEndOn} IS NULL) AND (${t.examsStartOn} IS NULL OR (${t.examsEndOn} >= ${t.examsStartOn} AND ${t.examsStartOn} >= ${t.startsOn} AND ${t.examsEndOn} <= ${t.endsOn}))`,
    ),
    check(
      "semesters_add_drop_check",
      sql`${t.addDropDeadlineOn} IS NULL OR ${t.addDropDeadlineOn} BETWEEN ${t.startsOn} AND ${t.endsOn}`,
    ),
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

/** Owner: academic. A course taught in a semester (TRD §6.3). */
export const courseOfferings = pgTable(
  "course_offerings",
  {
    ...std(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semesters.id, { onDelete: "restrict" }),
    sectionCode: text("section_code").notNull().default("01"),
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
    uniqueIndex("course_offerings_course_semester_section").on(
      t.courseId,
      t.semesterId,
      t.sectionCode,
    ),
    check("course_offerings_capacity_check", sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),
  ],
);
