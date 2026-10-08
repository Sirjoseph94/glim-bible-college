import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * A course's materials and announcements (TRD §14.1). Markdown is rendered and sanitized on the
 * server, so the browser shows `bodyHtml` as it is.
 */

const idParams = z.object({ id: z.uuid() });
const markdown = z.string().trim().min(1).max(20_000);
const sectionLabel = z.string().trim().min(1).max(100).nullable();
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), "Use a web link starting with https:// or http://");

export const materialSchema = z.object({
  id: z.uuid(),
  courseOfferingId: z.uuid(),
  sectionLabel: z.string().nullable(),
  title: z.string(),
  kind: z.enum(ENUMS["course_materials.kind"]),
  url: z.string().nullable(),
  /** The Markdown as written (TEXT), for editing. */
  bodyMd: z.string().nullable(),
  /** The Markdown rendered and sanitized with an allow-list. */
  bodyHtml: z.string().nullable(),
  file: z
    .object({
      id: z.uuid(),
      name: z.string(),
      mime: z.string(),
      sizeBytes: z.number().int(),
      /** Redirects to a 5-minute download URL, for those who may see the material. */
      downloadPath: z.string(),
    })
    .nullable(),
  visibility: z.enum(ENUMS["course_materials.visibility"]),
  /** Hidden from students until then. */
  publishAt: z.iso.datetime().nullable(),
  position: z.number().int(),
  status: z.enum(ENUMS["course_materials.status"]),
  updatedAt: z.iso.datetime(),
  version: z.number().int(),
});

export type Material = z.infer<typeof materialSchema>;

export const listMaterials = endpoint({
  method: "GET",
  path: "/course-offerings/:id/materials",
  summary: "A course's materials: published and released for students; all for its staff",
  tag: "Content",
  auth: "session",
  permission: "content:material:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(materialSchema) }),
});

const materialFields = {
  title: z.string().trim().min(1).max(200),
  sectionLabel: sectionLabel.optional(),
  visibility: z.enum(ENUMS["course_materials.visibility"]).optional(),
  publishAt: z.iso.datetime({ offset: true }).nullable().optional(),
  /** DRAFT keeps it from students; PUBLISHED (the default) shows it once `publishAt` passes. */
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
};

export const createMaterial = endpoint({
  method: "POST",
  path: "/course-offerings/:id/materials",
  summary: "Add a file (uploaded first through /files/uploads), a link or a text",
  tag: "Content",
  auth: "session",
  permission: "content:material:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("FILE"), fileId: z.uuid(), ...materialFields }).strict(),
    z.object({ kind: z.literal("LINK"), url: httpUrl, ...materialFields }).strict(),
    z.object({ kind: z.literal("TEXT"), bodyMd: markdown, ...materialFields }).strict(),
  ]),
  response: materialSchema,
  successStatus: 201,
});

export const updateMaterial = endpoint({
  method: "PATCH",
  path: "/course-materials/:id",
  summary: "Change a material's text, link, section, position, release time or status",
  tag: "Content",
  auth: "session",
  permission: "content:material:manage",
  resource: { type: "course-material", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      title: materialFields.title.optional(),
      sectionLabel: sectionLabel.optional(),
      url: httpUrl.optional(),
      bodyMd: markdown.optional(),
      visibility: materialFields.visibility,
      publishAt: materialFields.publishAt,
      position: z.number().int().min(0).max(10_000).optional(),
      status: z.enum(ENUMS["course_materials.status"]).optional(),
    })
    .strict(),
  response: materialSchema,
});

export const deleteMaterial = endpoint({
  method: "DELETE",
  path: "/course-materials/:id",
  summary: "Remove a material from the course (archived, so its file stays on record)",
  tag: "Content",
  auth: "session",
  permission: "content:material:manage",
  resource: { type: "course-material", param: "id" },
  params: idParams,
  response: z.object({}),
  successStatus: 204,
});

export const downloadMaterial = endpoint({
  method: "GET",
  path: "/course-materials/:id/download",
  summary: "Redirect to a 5-minute download URL for a FILE material the caller may see",
  tag: "Content",
  auth: "session",
  permission: "content:material:read",
  resource: { type: "course-material", param: "id" },
  params: idParams,
  response: z.object({}),
  successStatus: 302,
});

export const announcementSchema = z.object({
  id: z.uuid(),
  courseOfferingId: z.uuid(),
  title: z.string(),
  bodyMd: z.string(),
  bodyHtml: z.string(),
  pinned: z.boolean(),
  authorName: z.string(),
  classMeetingId: z.uuid().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  version: z.number().int(),
});

export type Announcement = z.infer<typeof announcementSchema>;

export const listAnnouncements = endpoint({
  method: "GET",
  path: "/course-offerings/:id/announcements",
  summary: "A course's announcements, pinned first, newest first",
  tag: "Content",
  auth: "session",
  permission: "content:material:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(announcementSchema) }),
});

export const createAnnouncement = endpoint({
  method: "POST",
  path: "/course-offerings/:id/announcements",
  summary: "Post an announcement; the course's students are notified in the app",
  tag: "Content",
  auth: "session",
  permission: "content:announcement:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200),
      bodyMd: markdown,
      pinned: z.boolean().optional(),
      classMeetingId: z.uuid().nullable().optional(),
    })
    .strict(),
  response: announcementSchema,
  successStatus: 201,
});

export const updateAnnouncement = endpoint({
  method: "PATCH",
  path: "/announcements/:id",
  summary: "Edit, pin or unpin an announcement",
  tag: "Content",
  auth: "session",
  permission: "content:announcement:manage",
  resource: { type: "announcement", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      bodyMd: markdown.optional(),
      pinned: z.boolean().optional(),
    })
    .strict(),
  response: announcementSchema,
});

export const deleteAnnouncement = endpoint({
  method: "DELETE",
  path: "/announcements/:id",
  summary: "Delete an announcement",
  tag: "Content",
  auth: "session",
  permission: "content:announcement:manage",
  resource: { type: "announcement", param: "id" },
  params: idParams,
  response: z.object({}),
  successStatus: 204,
});
