import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { files } from "./files";
import { enumCheck, std, tstz } from "./columns";
import { users } from "./identity";
import { classMeetings } from "./meetings";
import { courseOfferings } from "./offerings";

/**
 * Owner: content. A course's materials (TRD §6.6, §14.1): a file, a link or a text in Markdown,
 * grouped by section label and ordered by position. Students see published ones once `publish_at`
 * has passed; STAFF_ONLY materials are for the course's staff.
 */
export const courseMaterials = pgTable(
  "course_materials",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    sectionLabel: text("section_label"),
    title: text().notNull(),
    kind: text().notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "restrict" }),
    url: text(),
    bodyMd: text("body_md"),
    visibility: text().notNull().default("ENROLLED"),
    publishAt: tstz("publish_at"),
    position: integer().notNull().default(0),
    status: text().notNull().default("DRAFT"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    enumCheck("course_materials.kind", t.kind),
    enumCheck("course_materials.visibility", t.visibility),
    enumCheck("course_materials.status", t.status),
    check(
      "course_materials_kind_fields",
      sql`(${t.kind} = 'FILE' AND ${t.fileId} IS NOT NULL)
        OR (${t.kind} = 'LINK' AND ${t.url} IS NOT NULL)
        OR (${t.kind} = 'TEXT' AND ${t.bodyMd} IS NOT NULL)`,
    ),
    index("course_materials_offering").on(t.courseOfferingId, t.status, t.position),
  ],
);

/** Owner: content. A course announcement (TRD §6.6), shown to the course and optionally pinned. */
export const announcements = pgTable(
  "announcements",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    classMeetingId: uuid("class_meeting_id").references(() => classMeetings.id, {
      onDelete: "set null",
    }),
    title: text().notNull(),
    bodyMd: text("body_md").notNull(),
    pinned: boolean().notNull().default(false),
    publishedAt: tstz("published_at"),
  },
  (t) => [index("announcements_offering").on(t.courseOfferingId, t.publishedAt)],
);
