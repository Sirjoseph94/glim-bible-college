import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { courseOfferings } from "./academic";
import { enumCheck, std, tstz } from "./columns";
import { users } from "./identity";
import { classMeetings } from "./meetings";

/**
 * Owner: video. A course video: an unlisted YouTube video on GLIM's channel (TRD §6.5, §13,
 * ADR-0003). In v1 every video is `origin='LINK'`, pasted by staff; `recording_id` and the
 * `recordings` table come with the Google integration slice.
 */
export const videos = pgTable(
  "videos",
  {
    ...std(),
    courseOfferingId: uuid("course_offering_id")
      .notNull()
      .references(() => courseOfferings.id, { onDelete: "restrict" }),
    classMeetingId: uuid("class_meeting_id").references(() => classMeetings.id, {
      onDelete: "set null",
    }),
    origin: text().notNull(),
    title: text().notNull(),
    description: text(),
    position: integer().notNull().default(0),
    status: text().notNull().default("UNPUBLISHED"),
    statusBeforeUnavailable: text("status_before_unavailable"),
    visibility: text().notNull().default("ENROLLED"),
    youtubeVideoId: text("youtube_video_id"),
    youtubeChannelUrl: text("youtube_channel_url"),
    thumbnailUrl: text("thumbnail_url"),
    durationMs: bigint("duration_ms", { mode: "number" }),
    lastCheckedAt: tstz("last_checked_at"),
    unavailableReason: text("unavailable_reason"),
    audioKey: text("audio_key"),
    publishAfter: tstz("publish_after"),
    publishedAt: tstz("published_at"),
    deletedAt: tstz("deleted_at"),
    deleteAfter: tstz("delete_after"),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    youtubeDeleteRemindedAt: tstz("youtube_delete_reminded_at"),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    enumCheck("videos.origin", t.origin),
    enumCheck("videos.status", t.status),
    enumCheck("videos.visibility", t.visibility),
    check("videos_youtube_video_id_check", sql`${t.youtubeVideoId} ~ '^[A-Za-z0-9_-]{11}$'`),
    check(
      "videos_youtube_id_required",
      sql`${t.status} IN ('PROCESSING', 'FAILED') OR ${t.youtubeVideoId} IS NOT NULL`,
    ),
    index("videos_offering_status_position").on(t.courseOfferingId, t.status, t.position),
    uniqueIndex("videos_offering_youtube")
      .on(t.courseOfferingId, t.youtubeVideoId)
      .where(sql`status <> 'DELETED'`),
    index("videos_delete_after")
      .on(t.deleteAfter)
      .where(sql`status = 'DELETED'`),
  ],
);
