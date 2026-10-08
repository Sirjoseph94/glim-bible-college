import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

/**
 * Course videos (TRD §13, ADR-0003): unlisted videos on GLIM's YouTube channel, added by link in
 * v1 and shown in the app to entitled viewers.
 */

const idParams = z.object({ id: z.uuid() });

export const videoSchema = z.object({
  id: z.uuid(),
  courseOfferingId: z.uuid(),
  classMeetingId: z.uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  position: z.number().int(),
  status: z.enum(ENUMS["videos.status"]),
  visibility: z.enum(ENUMS["videos.visibility"]),
  youtubeVideoId: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  /** Hidden from students until then. */
  publishAfter: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  addedAt: z.iso.datetime(),
  version: z.number().int(),
});

export type Video = z.infer<typeof videoSchema>;

export const listVideos = endpoint({
  method: "GET",
  path: "/course-offerings/:id/videos",
  summary: "An offering's recordings: published ones for students; all for people who manage them",
  tag: "Video",
  auth: "session",
  permission: "video:asset:read",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  response: z.object({ items: z.array(videoSchema) }),
});

export const getVideo = endpoint({
  method: "GET",
  path: "/videos/:id",
  summary: "A recording",
  tag: "Video",
  auth: "session",
  permission: "video:asset:read",
  resource: { type: "video", param: "id" },
  params: idParams,
  response: videoSchema,
});

export const addVideo = endpoint({
  method: "POST",
  path: "/course-offerings/:id/videos",
  summary:
    "Add a recording by its YouTube link (checked: it must be available and on GLIM's channel)",
  tag: "Video",
  auth: "session",
  permission: "video:asset:manage",
  resource: { type: "course-offering", param: "id" },
  idempotent: true,
  params: idParams,
  body: z
    .object({
      youtubeUrl: z.string().trim().min(1).max(500),
      /** Prefilled from YouTube when omitted. */
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(5000).nullable().optional(),
      classMeetingId: z.uuid().nullable().optional(),
      publishAfter: z.iso.datetime({ offset: true }).nullable().optional(),
    })
    .strict(),
  response: videoSchema,
  successStatus: 201,
});

export const updateVideo = endpoint({
  method: "PATCH",
  path: "/videos/:id",
  summary: "Change a recording's title, description, Class Meeting, visibility or release time",
  tag: "Video",
  auth: "session",
  permission: "video:asset:manage",
  resource: { type: "video", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(5000).nullable().optional(),
      classMeetingId: z.uuid().nullable().optional(),
      publishAfter: z.iso.datetime({ offset: true }).nullable().optional(),
      visibility: z.enum(ENUMS["videos.visibility"]).optional(),
    })
    .strict(),
  response: videoSchema,
});

export const publishVideo = endpoint({
  method: "POST",
  path: "/videos/:id/publish",
  summary: "Publish a recording to the course's students",
  tag: "Video",
  auth: "session",
  permission: "video:asset:manage",
  resource: { type: "video", param: "id" },
  idempotent: true,
  params: idParams,
  response: videoSchema,
  successStatus: 200,
});

export const unpublishVideo = endpoint({
  method: "POST",
  path: "/videos/:id/unpublish",
  summary: "Hide a recording from students",
  tag: "Video",
  auth: "session",
  permission: "video:asset:manage",
  resource: { type: "video", param: "id" },
  params: idParams,
  response: videoSchema,
  successStatus: 200,
});

export const reorderVideos = endpoint({
  method: "PUT",
  path: "/course-offerings/:id/videos/order",
  summary: "Set the order of an offering's recordings",
  tag: "Video",
  auth: "session",
  permission: "video:asset:manage",
  resource: { type: "course-offering", param: "id" },
  params: idParams,
  body: z.object({ videoIds: z.array(z.uuid()).min(1).max(500) }).strict(),
  response: z.object({ items: z.array(videoSchema) }),
});
