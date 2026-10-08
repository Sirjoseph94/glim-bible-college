import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { courseOfferings, rooms } from "./academic";
import { enumCheck, std, stdRo, tstz } from "./columns";
import { users } from "./identity";
import { lecturers } from "./lecturing";

/** A Postgres `tstzrange`, read and written as its text form (e.g. `["…","…")`). */
export const tstzrange = customType<{ data: string }>({ dataType: () => "tstzrange" });

/**
 * Owner: scheduling. A weekly series of Class Meetings (TRD §6.4, §11.9). `online_link` is the
 * default copied to each occurrence (v1 interim behaviour, spec).
 */
export const classMeetingSeries = pgTable(
  "class_meeting_series",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    titleTemplate: text("title_template").notNull(),
    rrule: text().notNull(),
    timezone: text().notNull(),
    startsOn: date("starts_on").notNull(),
    untilOn: date("until_on"),
    startTime: time("start_time").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "restrict" }),
    onlineLink: text("online_link"),
    generatedThrough: date("generated_through"),
    status: text().notNull().default("ACTIVE"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    enumCheck("class_meeting_series.status", t.status),
    check("class_meeting_series_duration_check", sql`${t.durationMinutes} BETWEEN 5 AND 600`),
  ],
);

/**
 * Owner: class-meeting. A hybrid Class Meeting: an optional Room and an online link (TRD §6.4,
 * §11). In v1 the Lecturer pastes the link (`online_link`); the provider columns stay nullable and
 * unused until the Google integration. Rooms can't be double-booked: `no_room_double_booking`
 * (custom SQL).
 */
export const classMeetings = pgTable(
  "class_meetings",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    seriesId: uuid("series_id").references(() => classMeetingSeries.id, {
      onDelete: "restrict",
    }),
    title: text().notNull(),
    description: text(),
    scheduledStart: tstz("scheduled_start").notNull(),
    scheduledEnd: tstz("scheduled_end").notNull(),
    timezone: text().notNull(),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "restrict" }),
    onlineLink: text("online_link"),
    state: text().notNull().default("SCHEDULED"),
    provider: text(),
    providerStatus: text("provider_status"),
    providerSpaceId: text("provider_space_id"),
    providerMeetingCode: text("provider_meeting_code"),
    joinUrl: text("join_url"),
    dialIn: jsonb("dial_in"),
    // References provider_host_accounts once the Google integration creates it.
    hostAccountId: uuid("host_account_id"),
    provisionedAt: tstz("provisioned_at"),
    provisionError: text("provision_error"),
    recordingMode: text("recording_mode").notNull().default("AUTO"),
    attendanceState: text("attendance_state").notNull().default("PENDING"),
    policySnapshot: jsonb("policy_snapshot").notNull(),
    firstConferenceStartedAt: tstz("first_conference_started_at"),
    lastConferenceEndedAt: tstz("last_conference_ended_at"),
    finalizedAt: tstz("finalized_at"),
    cancelledAt: tstz("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    occurrenceDate: date("occurrence_date"),
    seriesException: boolean("series_exception").notNull().default(false),
    accessSyncedAt: timestamp("access_synced_at", { withTimezone: true }),
  },
  (t) => [
    enumCheck("class_meetings.state", t.state),
    check(
      "class_meetings_provider_status_check",
      sql`${t.providerStatus} IS NULL OR ${t.providerStatus} IN ('PENDING', 'PROVISIONING', 'READY', 'ERROR')`,
    ),
    enumCheck("class_meetings.recording_mode", t.recordingMode),
    enumCheck("class_meetings.attendance_state", t.attendanceState),
    check("class_meetings_times_check", sql`${t.scheduledEnd} > ${t.scheduledStart}`),
    uniqueIndex("class_meetings_series_occurrence")
      .on(t.seriesId, t.occurrenceDate)
      .where(sql`series_id IS NOT NULL`),
    uniqueIndex("class_meetings_provider_space")
      .on(t.provider, t.providerSpaceId)
      .where(sql`provider_space_id IS NOT NULL`),
    index("class_meetings_offering_start").on(t.courseOfferingId, t.scheduledStart),
    index("class_meetings_open_by_start")
      .on(t.state, t.scheduledStart)
      .where(sql`state IN ('SCHEDULED', 'OPEN', 'LIVE')`),
  ],
);

/**
 * Owner: scheduling. One row per assigned Lecturer per Class Meeting: the database-level guard
 * against double-booking a Lecturer (INV-4), via `no_lecturer_overlap` (custom SQL). An Academic
 * Admin's override writes `override = true`, which the constraint ignores.
 */
export const meetingLecturerSlots = pgTable(
  "meeting_lecturer_slots",
  {
    ...stdRo(),
    classMeetingId: uuid("class_meeting_id")
      .notNull()
      .references(() => classMeetings.id, { onDelete: "cascade" }),
    lecturerId: uuid("lecturer_id")
      .notNull()
      .references(() => lecturers.id, { onDelete: "restrict" }),
    during: tstzrange().notNull(),
    override: boolean().notNull().default(false),
    overrideReason: text("override_reason"),
  },
  (t) => [
    uniqueIndex("meeting_lecturer_slots_meeting_lecturer").on(t.classMeetingId, t.lecturerId),
    check(
      "meeting_lecturer_slots_override_reason_check",
      sql`NOT ${t.override} OR ${t.overrideReason} IS NOT NULL`,
    ),
  ],
);

/** Owner: class-meeting. Every join attempt, allowed or not (TRD §11.6, INV-8). */
export const meetingJoinLog = pgTable(
  "meeting_join_log",
  {
    ...stdRo(),
    classMeetingId: uuid("class_meeting_id")
      .notNull()
      .references(() => classMeetings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    outcome: text().notNull(),
    denyReason: text("deny_reason"),
    device: text(),
    authorizedAt: tstz("authorized_at").notNull().defaultNow(),
  },
  (t) => [
    enumCheck("meeting_join_log.outcome", t.outcome),
    index("meeting_join_log_meeting").on(t.classMeetingId, t.authorizedAt),
  ],
);
