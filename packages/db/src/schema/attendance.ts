import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { enumCheck, std, tstz } from "./columns";
import { students } from "./enrollment";
import { users } from "./identity";
import { classMeetings } from "./meetings";

/**
 * Owner: attendance. In-room (and, in v1, online) roll-call evidence for a Class Meeting
 * (TRD §6.4, C-26; v1 spec adds `mode`). Editable until the lock; every change is audited.
 */
export const rollCallMarks = pgTable(
  "roll_call_marks",
  {
    ...std(),
    classMeetingId: uuid("class_meeting_id")
      .notNull()
      .references(() => classMeetings.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    present: boolean().notNull(),
    late: boolean().notNull().default(false),
    mode: text().notNull().default("IN_PERSON"),
    markedBy: uuid("marked_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    markedAt: tstz("marked_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roll_call_marks_meeting_student").on(t.classMeetingId, t.studentId),
    enumCheck("roll_call_marks.mode", t.mode),
    check("roll_call_marks_late_check", sql`${t.present} OR NOT ${t.late}`),
  ],
);

/**
 * Owner: attendance. One row per Class Meeting with a roll call: the version that `If-Match`
 * checks on a batch of marks (§12.3), so two phones can't silently overwrite each other.
 */
export const rollCalls = pgTable("roll_calls", {
  classMeetingId: uuid("class_meeting_id")
    .primaryKey()
    .references(() => classMeetings.id, { onDelete: "cascade" }),
  version: integer().notNull().default(0),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

/**
 * Owner: attendance. The derived projection of a Class Meeting's attendance, one row per student
 * (TRD §6.4, §12.5), with an audited override. The `status` column is a PG18 VIRTUAL generated
 * column, `COALESCE(override_status, computed_status)`, added by hand-written SQL: it is not in
 * this definition, so nothing ever writes it. Read it with `attendanceStatus`.
 */
export const attendanceRecords = pgTable(
  "attendance_records",
  {
    ...std(),
    classMeetingId: uuid("class_meeting_id")
      .notNull()
      .references(() => classMeetings.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    computedStatus: text("computed_status").notNull(),
    attendanceMode: text("attendance_mode").notNull(),
    overrideStatus: text("override_status"),
    attendedSeconds: integer("attended_seconds").notNull(),
    effectiveSeconds: integer("effective_seconds").notNull(),
    ratioBp: integer("ratio_bp").notNull(),
    firstJoinAt: tstz("first_join_at"),
    lastLeaveAt: tstz("last_leave_at"),
    late: boolean().notNull().default(false),
    joinCount: integer("join_count").notNull().default(0),
    calcVersion: integer("calc_version").notNull().default(1),
    policyVersion: integer("policy_version").notNull(),
    computedAt: tstz("computed_at").notNull(),
    overrideBy: uuid("override_by").references(() => users.id, { onDelete: "set null" }),
    overrideReason: text("override_reason"),
    overriddenAt: tstz("overridden_at"),
  },
  (t) => [
    uniqueIndex("attendance_records_meeting_student").on(t.classMeetingId, t.studentId),
    index("attendance_records_student").on(t.studentId),
    enumCheck("attendance_records.computed_status", t.computedStatus),
    enumCheck("attendance_records.attendance_mode", t.attendanceMode),
    check(
      "attendance_records_override_status_check",
      sql`${t.overrideStatus} IS NULL OR ${t.overrideStatus} IN ('PRESENT', 'PARTIAL', 'ABSENT', 'EXCUSED')`,
    ),
    check("attendance_records_ratio_check", sql`${t.ratioBp} BETWEEN 0 AND 10000`),
    check(
      "attendance_records_override_reason_check",
      sql`(${t.overrideStatus} IS NULL) = (${t.overrideReason} IS NULL)`,
    ),
  ],
);

/** The virtual `status` column (override, else computed): select it with this. */
export const attendanceStatus = sql<string>`attendance_records.status`;
