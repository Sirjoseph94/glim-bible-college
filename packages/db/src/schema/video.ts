import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { courseOfferings } from "./academic";
import { enumCheck, std, tstz } from "./columns";
import { users } from "./identity";
import { classMeetings, conferenceRecords } from "./meetings";

/**
 * Owner: video. One Meet recording file (TRD §6.5, §13.3; a conference may have several), from
 * discovery in the host's Drive to a processed YouTube upload. Drive metadata is kept so the
 * upload can be checked against it (INV-9).
 */
export const recordings = pgTable(
  "recordings",
  {
    ...std(),
    classMeetingId: uuid("class_meeting_id")
      .notNull()
      .references(() => classMeetings.id, { onDelete: "restrict" }),
    conferenceRecordId: uuid("conference_record_id")
      .notNull()
      .references(() => conferenceRecords.id, { onDelete: "restrict" }),
    partNo: integer("part_no").notNull().default(1),
    providerRecordingId: text("provider_recording_id").notNull().unique(),
    driveFileId: text("drive_file_id").unique(),
    status: text().notNull().default("DISCOVERED"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    lastError: text("last_error"),
    sourceSizeBytes: bigint("source_size_bytes", { mode: "number" }),
    sourceMd5: text("source_md5"),
    sourceMime: text("source_mime"),
    sourceDurationMs: bigint("source_duration_ms", { mode: "number" }),
    recordingStartedAt: tstz("recording_started_at"),
    recordingEndedAt: tstz("recording_ended_at"),
    uploadedAt: tstz("uploaded_at"),
    driveCleanupStatus: text("drive_cleanup_status").notNull().default("NOT_REQUESTED"),
  },
  (t) => [
    enumCheck("recordings.status", t.status),
    enumCheck("recordings.drive_cleanup_status", t.driveCleanupStatus),
    index("recordings_open")
      .on(t.status, t.updatedAt)
      .where(sql`status <> 'READY'`),
  ],
);

/**
 * Owner: video. A course video: an unlisted YouTube video on GLIM's channel (TRD §6.5, §13,
 * ADR-0003). `origin='LINK'` is pasted by staff; `origin='RECORDING'` is a Meet recording the
 * worker uploaded (integration slice), linked through `recording_id`.
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
    recordingId: uuid("recording_id")
      .unique()
      .references(() => recordings.id, { onDelete: "restrict" }),
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
    /** What a restore puts back (§13.6). */
    statusBeforeDelete: text("status_before_delete"),
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
    index("videos_class_meeting")
      .on(t.classMeetingId)
      .where(sql`class_meeting_id IS NOT NULL`),
  ],
);

/**
 * Owner: video. Where a viewer stopped in a video, so it resumes there (TRD §6.5, §13.4). One row
 * per viewer and video; `max_position_ms` only grows, `completed` is set at 90 %, and `last_seq`
 * drops reports that arrive out of order.
 */
export const playbackProgress = pgTable(
  "playback_progress",
  {
    ...std(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    positionMs: bigint("position_ms", { mode: "number" }).notNull(),
    maxPositionMs: bigint("max_position_ms", { mode: "number" }).notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
    percentComplete: numeric("percent_complete", { precision: 5, scale: 2 }).notNull(),
    completed: boolean().notNull().default(false),
    completedAt: tstz("completed_at"),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    uniqueIndex("playback_progress_video_user").on(t.videoId, t.userId),
    index("playback_progress_user").on(t.userId),
    check(
      "playback_progress_positions",
      sql`${t.positionMs} >= 0 AND ${t.positionMs} <= ${t.maxPositionMs} AND ${t.maxPositionMs} <= ${t.durationMs}`,
    ),
  ],
);
