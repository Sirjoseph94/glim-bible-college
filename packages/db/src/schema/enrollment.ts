import { sql } from "drizzle-orm";
import {
  date,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { academicSessions, curricula, programmes } from "./academic";
import { applications, intakes } from "./admissions";
import { cohorts } from "./cohorts";
import { enumCheck, std } from "./columns";
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
