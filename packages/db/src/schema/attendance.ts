import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
