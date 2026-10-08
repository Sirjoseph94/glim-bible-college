import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { academicSessions, courseOfferings, curricula, programmes, semesters } from "./academic";
import { applications, intakes } from "./admissions";
import { cohorts } from "./cohorts";
import { enumCheck, std, stdRo, tstz } from "./columns";
import { files } from "./content";
import { users } from "./identity";

/**
 * Owner: enrollment. One row per person who has been a student; the profile is copied from the
 * application on acceptance (TRD §6.3, §10.4). Never spiritual background, marital status or
 * occupation (INV-15).
 */
export const students = pgTable(
  "students",
  {
    ...std(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text().notNull().default("ACTIVE"),
    title: text(),
    givenName: text("given_name").notNull(),
    middleName: text("middle_name"),
    familyName: text("family_name").notNull(),
    gender: text(),
    dateOfBirth: date("date_of_birth"),
    nationality: text(),
    phoneWhatsapp: text("phone_whatsapp"),
    altPhoneWhatsapp: text("alt_phone_whatsapp"),
    country: text(),
    stateProvince: text("state_province"),
    city: text(),
    postcode: text(),
    address: text(),
    churchName: text("church_name"),
    churchAddress: text("church_address"),
    pastorName: text("pastor_name"),
    pastorPhone: text("pastor_phone"),
    photoFileId: uuid("photo_file_id").references(() => files.id, { onDelete: "restrict" }),
  },
  (t) => [enumCheck("students.status", t.status), enumCheck("students.gender", t.gender)],
);

/** Owner: enrollment. Gap-free Matric Numbers per programme and intake year (D-01), row-locked. */
export const matricSequences = pgTable(
  "matric_sequences",
  {
    programmeId: uuid("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "restrict" }),
    year: integer().notNull(),
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.programmeId, t.year] })],
);

/** Owner: enrollment. One per admission to a programme, carrying the Matric Number. */
export const programmeEnrollments = pgTable(
  "programme_enrollments",
  {
    ...std(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    programmeId: uuid("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "restrict" }),
    curriculumId: uuid("curriculum_id")
      .notNull()
      .references(() => curricula.id, { onDelete: "restrict" }),
    intakeId: uuid("intake_id").references(() => intakes.id, { onDelete: "restrict" }),
    cohortId: uuid("cohort_id").references(() => cohorts.id, { onDelete: "restrict" }),
    entrySessionId: uuid("entry_session_id")
      .notNull()
      .references(() => academicSessions.id, { onDelete: "restrict" }),
    /** NULL only for imported legacy students (D-04). */
    applicationId: uuid("application_id")
      .unique()
      .references(() => applications.id, { onDelete: "restrict" }),
    /** 'GLIM/DIP/2027/0001' (D-01). */
    matricNumber: text("matric_number").notNull().unique(),
    studyMode: text("study_mode").notNull(),
    currentLevel: smallint("current_level").notNull().default(1),
    status: text().notNull().default("ACTIVE"),
    startedOn: date("started_on").notNull(),
    endedOn: date("ended_on"),
  },
  (t) => [
    enumCheck("programme_enrollments.study_mode", t.studyMode),
    enumCheck("programme_enrollments.status", t.status),
    uniqueIndex("one_active_programme_enrollment")
      .on(t.studentId, t.programmeId)
      .where(sql`${t.status} = 'ACTIVE'`),
  ],
);

/** Owner: enrollment. A programme enrollment's registration for one semester (§9.3). */
export const semesterEnrollments = pgTable(
  "semester_enrollments",
  {
    ...std(),
    programmeEnrollmentId: uuid("programme_enrollment_id")
      .notNull()
      .references(() => programmeEnrollments.id, { onDelete: "restrict" }),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semesters.id, { onDelete: "restrict" }),
    levelNo: smallint("level_no").notNull(),
    status: text().notNull().default("REGISTERED"),
  },
  (t) => [
    unique("semester_enrollments_once").on(t.programmeEnrollmentId, t.semesterId),
    enumCheck("semester_enrollments.status", t.status),
  ],
);

/**
 * Owner: enrollment. THE entitlement source for students (§6.3, INV-1). `student_id` and
 * `programme_enrollment_id` are denormalised; a trigger keeps them consistent with the
 * semester enrollment.
 */
export const courseEnrollments = pgTable(
  "course_enrollments",
  {
    ...std(),
    semesterEnrollmentId: uuid("semester_enrollment_id")
      .notNull()
      .references(() => semesterEnrollments.id, { onDelete: "restrict" }),
    programmeEnrollmentId: uuid("programme_enrollment_id")
      .notNull()
      .references(() => programmeEnrollments.id, { onDelete: "restrict" }),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    selection: text().notNull(),
    enrollmentType: text("enrollment_type").notNull().default("CREDIT"),
    status: text().notNull().default("ENROLLED"),
    enrolledAt: tstz("enrolled_at").notNull().defaultNow(),
    droppedAt: tstz("dropped_at"),
  },
  (t) => [
    enumCheck("course_enrollments.selection", t.selection),
    enumCheck("course_enrollments.enrollment_type", t.enrollmentType),
    enumCheck("course_enrollments.status", t.status),
    uniqueIndex("one_live_course_enrollment")
      .on(t.studentId, t.courseOfferingId)
      .where(sql`${t.status} IN ('ENROLLED', 'COMPLETED')`),
    index("course_enrollments_offering_status_idx").on(t.courseOfferingId, t.status),
    index("course_enrollments_student_status_idx").on(t.studentId, t.status),
  ],
);

/** Owner: enrollment. Course enrollment status history. */
export const courseEnrollmentEvents = pgTable(
  "course_enrollment_events",
  {
    ...stdRo(),
    courseEnrollmentId: uuid("course_enrollment_id")
      .notNull()
      .references(() => courseEnrollments.id, { onDelete: "restrict" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text(),
  },
  (t) => [index("course_enrollment_events_enrollment_idx").on(t.courseEnrollmentId, t.createdAt)],
);
