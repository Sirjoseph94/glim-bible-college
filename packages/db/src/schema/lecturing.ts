import { sql } from "drizzle-orm";
import { date, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { courseOfferings } from "./academic";
import { enumCheck, std } from "./columns";
import { users } from "./identity";

/** Owner: lecturing. A Lecturer is a user with this profile (TRD §6.3, §7.1). */
export const lecturers = pgTable(
  "lecturers",
  {
    ...std(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "restrict" }),
    staffCode: text("staff_code").unique(),
    kind: text().notNull().default("INTERNAL"),
    status: text().notNull().default("ACTIVE"),
    title: text(),
    givenName: text("given_name").notNull(),
    familyName: text("family_name").notNull(),
    bio: text(),
  },
  (t) => [enumCheck("lecturers.kind", t.kind), enumCheck("lecturers.status", t.status)],
);

/** Owner: lecturing. Who teaches an offering, in which role (§9.4); exactly one active PRIMARY. */
export const lecturerAssignments = pgTable(
  "lecturer_assignments",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    lecturerId: uuid("lecturer_id")
      .notNull()
      .references(() => lecturers.id, { onDelete: "restrict" }),
    role: text().notNull(),
    status: text().notNull().default("ACTIVE"),
    capabilityOverrides: jsonb("capability_overrides")
      .notNull()
      .default(sql`'{}'::jsonb`),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
  },
  (t) => [
    enumCheck("lecturer_assignments.role", t.role),
    enumCheck("lecturer_assignments.status", t.status),
    uniqueIndex("one_active_assignment")
      .on(t.courseOfferingId, t.lecturerId)
      .where(sql`status = 'ACTIVE'`),
    uniqueIndex("one_active_primary")
      .on(t.courseOfferingId)
      .where(sql`status = 'ACTIVE' AND role = 'PRIMARY'`),
  ],
);
