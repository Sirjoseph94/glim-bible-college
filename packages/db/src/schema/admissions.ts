import { ENUMS } from "@glim/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { academicSessions, programmes } from "./academic";
import { citext, enumCheck, std, stdRo, tstz } from "./columns";
import { users } from "./identity";

/**
 * Owner: admissions. One per year: applications open in November and close in June, and the
 * students start in `academic_session` (TRD §6.3, §10.1).
 */
export const intakes = pgTable(
  "intakes",
  {
    ...std(),
    code: citext().notNull().unique(),
    academicSessionId: uuid("academic_session_id")
      .notNull()
      .unique()
      .references(() => academicSessions.id, { onDelete: "restrict" }),
    opensOn: date("opens_on").notNull(),
    closesOn: date("closes_on").notNull(),
    offerAcceptanceDays: integer("offer_acceptance_days").notNull().default(21),
    status: text().notNull().default("PLANNED"),
  },
  (t) => [
    enumCheck("intakes.status", t.status),
    check("intakes_dates_check", sql`${t.closesOn} > ${t.opensOn}`),
    check("intakes_offer_acceptance_days_check", sql`${t.offerAcceptanceDays} > 0`),
  ],
);

/** Owner: admissions. Allocates `GLIM-APP-{intake}-{NNNNN}` reference numbers at submit (§10.2). */
export const applicationSequences = pgTable("application_sequences", {
  intakeId: uuid("intake_id")
    .primaryKey()
    .references(() => intakes.id, { onDelete: "restrict" }),
  nextValue: integer("next_value").notNull().default(1),
});

/** Section 5 of the form. SENSITIVE (INV-15): never in lists, logs, audit metadata or events. */
export interface SpiritualBackground {
  bornAgain?: boolean | null;
  bornAgainWhen?: string | null;
  waterBaptism?: string | null;
  holySpiritBaptism?: boolean | null;
  holySpiritSince?: string | null;
}

const HEARD_VIA = ENUMS["applications.heard_via"].map((v) => `'${v}'`).join(", ");

/**
 * Owner: admissions. Mirrors the paper application form section by section (TRD §6.9, §10.2).
 * A draft may leave any field empty; submitting checks completeness.
 */
export const applications = pgTable(
  "applications",
  {
    ...std(),
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => intakes.id, { onDelete: "restrict" }),
    programmeId: uuid("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "restrict" }),
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    referenceNo: text("reference_no").unique(),
    studyMode: text("study_mode"),
    status: text().notNull().default("DRAFT"),
    // 1. Personal information
    firstName: text("first_name"),
    middleName: text("middle_name"),
    lastName: text("last_name"),
    title: text(),
    titleOther: text("title_other"),
    gender: text(),
    dateOfBirth: date("date_of_birth"),
    maritalStatus: text("marital_status"),
    nationality: text(),
    occupation: text(),
    // 2. Contact information (email defaults to the Google account email)
    email: citext(),
    phoneWhatsapp: text("phone_whatsapp"),
    altPhoneWhatsapp: text("alt_phone_whatsapp"),
    // 3. Address information
    country: text(),
    stateProvince: text("state_province"),
    city: text(),
    postcode: text(),
    address: text(),
    // 4. Church information
    churchName: text("church_name"),
    churchAddress: text("church_address"),
    pastorName: text("pastor_name"),
    pastorPhone: text("pastor_phone"),
    // 5. Spiritual background (SENSITIVE, INV-15)
    spiritualBackground: jsonb("spiritual_background").$type<SpiritualBackground>(),
    // 6. Feedback information
    heardVia: text("heard_via")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    heardViaOther: text("heard_via_other"),
    referralCodeEntered: text("referral_code_entered"),
    referrerUserId: uuid("referrer_user_id").references(() => users.id, { onDelete: "set null" }),
    // 7. Declaration and affirmation (typed-name signature)
    declarationFullName: text("declaration_full_name"),
    statementOfFaithRead: boolean("statement_of_faith_read").notNull().default(false),
    declaredAt: tstz("declared_at"),
    // 8. Data processing consent
    dataConsentAt: tstz("data_consent_at"),
    /** The ADMISSIONS policy version whose declaration and consent texts were shown (§10.2). */
    admissionsPolicyVersion: integer("admissions_policy_version"),
    /** The passport photo; its foreign key to `files` arrives with photo uploads (ticket 13). */
    photoFileId: uuid("photo_file_id"),
    // Workflow
    submittedAt: tstz("submitted_at"),
    reviewStartedAt: tstz("review_started_at"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: tstz("decided_at"),
    /** Internal; never shown to the applicant. */
    decisionNote: text("decision_note"),
    offerExpiresAt: tstz("offer_expires_at"),
    acceptedAt: tstz("accepted_at"),
    withdrawnAt: tstz("withdrawn_at"),
    purgeAfter: tstz("purge_after"),
  },
  (t) => [
    enumCheck("applications.study_mode", t.studyMode),
    enumCheck("applications.status", t.status),
    enumCheck("applications.title", t.title),
    enumCheck("applications.gender", t.gender),
    enumCheck("applications.marital_status", t.maritalStatus),
    check("applications_heard_via_check", sql`${t.heardVia} <@ ARRAY[${sql.raw(HEARD_VIA)}]`),
    check(
      "applications_submitted_check",
      sql`${t.status} = 'DRAFT' OR (${t.referenceNo} IS NOT NULL AND ${t.submittedAt} IS NOT NULL AND ${t.declaredAt} IS NOT NULL AND ${t.dataConsentAt} IS NOT NULL AND ${t.statementOfFaithRead} AND ${t.photoFileId} IS NOT NULL AND ${t.studyMode} IS NOT NULL)`,
    ),
    check(
      "applications_offer_check",
      sql`${t.status} <> 'ADMITTED' OR ${t.offerExpiresAt} IS NOT NULL`,
    ),
    uniqueIndex("one_open_application")
      .on(t.applicantUserId, t.intakeId)
      .where(sql`${t.status} NOT IN ('REJECTED', 'LAPSED', 'WITHDRAWN')`),
    index("applications_intake_status_idx").on(t.intakeId, t.status, t.submittedAt),
    index("applications_purge_after_idx")
      .on(t.purgeAfter)
      .where(sql`${t.purgeAfter} IS NOT NULL`),
  ],
);

/** Owner: admissions. Status history; never contains sensitive answers. */
export const applicationEvents = pgTable(
  "application_events",
  {
    ...stdRo(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    note: text(),
  },
  (t) => [index("application_events_application_idx").on(t.applicationId, t.createdAt)],
);
