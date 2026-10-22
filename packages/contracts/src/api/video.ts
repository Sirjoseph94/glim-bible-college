import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";
import { page, pageQuery } from "../pagination";

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

export const videoPlaybackSchema = z.object({
  videoId: z.uuid(),
  /** The course it belongs to, for the page's way back. */
  courseOfferingId: z.uuid(),
  courseCode: z.string(),
  title: z.string(),
  youtubeVideoId: z.string(),
  /** youtube-nocookie.com, starting at the resume point. */
  embedUrl: z.string(),
  thumbnailUrl: z.string(),
  durationMs: z.number().int().nullable(),
  resumeMs: z.number().int(),
  /** Whether the player should report progress (students only; staff don't keep any). */
  tracksProgress: z.boolean(),
});

export type VideoPlayback = z.infer<typeof videoPlaybackSchema>;

export const playVideo = endpoint({
  method: "GET",
  path: "/videos/:id/play",
  summary: "What the player needs to show a recording, with the viewer's resume point",
  tag: "Video",
  auth: "session",
  permission: "video:asset:play",
  resource: { type: "video", param: "id" },
  rateLimit: "playback",
  params: idParams,
  response: videoPlaybackSchema,
});

export const playbackProgressSchema = z.object({
  positionMs: z.number().int(),
  maxPositionMs: z.number().int(),
  durationMs: z.number().int(),
  completed: z.boolean(),
});

export type PlaybackProgress = z.infer<typeof playbackProgressSchema>;

export const saveProgress = endpoint({
  method: "PATCH",
  path: "/videos/:id/progress",
  summary: "Where the viewer is in a recording (sent every 15 s, on pause and on leaving the page)",
  tag: "Video",
  auth: "session",
  permission: "video:progress:write",
  resource: { type: "video", param: "id", ownPart: true },
  rateLimit: "progress",
  params: idParams,
  body: z
    .object({
      positionMs: z.number().int().min(0).max(86_400_000),
      durationMs: z.number().int().min(1).max(86_400_000),
      /** Increases with each report from a page; an older one arriving late is ignored. */
      seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  response: playbackProgressSchema,
});

/** A video as the System Admin's management screen shows it (§13.6). */
export const adminVideoSchema = videoSchema.extend({
  origin: z.enum(ENUMS["videos.origin"]),
  courseCode: z.string(),
  courseTitle: z.string(),
  semesterName: z.string(),
  sessionCode: z.string(),
  /** Why YouTube stopped serving it, when UNAVAILABLE. */
  unavailableReason: z.string().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  /** Where the System Admin downloads or deletes it on YouTube. */
  studioUrl: z.string().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  /** The end of the 7-day undo window for a deleted video. */
  deleteAfter: z.iso.datetime().nullable(),
  /** Set once the System Admin was reminded to delete it in YouTube Studio. */
  youtubeDeleteRemindedAt: z.iso.datetime().nullable(),
  /** A Meet recording's upload to YouTube (origin RECORDING, integration slice); else null. */
  ingest: z
    .object({
      status: z.enum(ENUMS["recordings.status"]),
      errorCode: z.string().nullable(),
      error: z.string().nullable(),
      attempts: z.number().int(),
    })
    .nullable(),
});

export type AdminVideo = z.infer<typeof adminVideoSchema>;

export const listAdminVideos = endpoint({
  method: "GET",
  path: "/admin/videos",
  summary: "Every video, unavailable ones first, filtered by offering, status or origin",
  tag: "Video admin",
  auth: "session",
  permission: "video:asset:admin",
  query: pageQuery.extend({
    offeringId: z.uuid().optional(),
    status: z.enum(ENUMS["videos.status"]).optional(),
    origin: z.enum(ENUMS["videos.origin"]).optional(),
  }),
  response: page(adminVideoSchema),
});

export const replaceVideoLink = endpoint({
  method: "PUT",
  path: "/videos/:id/youtube-link",
  summary: "Swap a video's YouTube link (same checks as adding), keeping its place in the course",
  tag: "Video admin",
  auth: "session",
  permission: "video:asset:admin",
  resource: { type: "video", param: "id" },
  params: idParams,
  body: z.object({ youtubeUrl: z.string().trim().min(1).max(500) }).strict(),
  response: adminVideoSchema,
});

export const deleteVideo = endpoint({
  method: "DELETE",
  path: "/videos/:id",
  summary: "Delete a video: hidden at once, restorable for 7 days",
  tag: "Video admin",
  auth: "session",
  permission: "video:asset:admin",
  resource: { type: "video", param: "id" },
  params: idParams,
  response: adminVideoSchema,
  successStatus: 200,
});

export const restoreVideo = endpoint({
  method: "POST",
  path: "/videos/:id/restore",
  summary: "Undo a delete within 7 days",
  tag: "Video admin",
  auth: "session",
  permission: "video:asset:admin",
  resource: { type: "video", param: "id" },
  params: idParams,
  response: adminVideoSchema,
  successStatus: 200,
});

/** Uploads a failed Meet recording to YouTube again (TRD §13.3; integration slice). */
export const retryIngest = endpoint({
  method: "POST",
  path: "/videos/:id/retry-ingest",
  summary: "Upload a failed recording to YouTube again",
  tag: "Video admin",
  auth: "session",
  permission: "video:asset:admin",
  resource: { type: "video", param: "id" },
  params: idParams,
  response: adminVideoSchema,
  successStatus: 202,
});

export const recheckVideo = endpoint({
  method: "POST",
  path: "/videos/:id/recheck",
  summary: "Ask YouTube again whether it serves the video; a success restores an unavailable one",
  tag: "Video",
  auth: "session",
  permission: "video:asset:manage",
  resource: { type: "video", param: "id" },
  params: idParams,
  response: videoSchema,
  successStatus: 200,
});
