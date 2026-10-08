import type { PlaybackProgress, VideoPlayback } from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { VIDEO_HOST, type VideoHost } from "@glim/integrations/video-host/port";
import { AuthorizationService } from "@glim/modules/authorization";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";

type ProgressRow = typeof schema.playbackProgress.$inferSelect;

export interface ProgressReport {
  positionMs: number;
  durationMs: number;
  seq: number;
}

/** At most one stored report per viewer and video in this window (§13.4). */
export const PROGRESS_MIN_INTERVAL_MS = 5_000;

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * Playback (owner: video, TRD §13.4–13.5). `/play` hands the browser what it needs to load the
 * YouTube player itself (the video never passes through the API) and where the viewer stopped;
 * the player reports progress back so the next visit resumes there.
 */
@Injectable()
export class PlaybackService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(VIDEO_HOST) private readonly host: VideoHost,
  ) {}

  /**
   * The embed for a video the caller may watch. The guard has already checked entitlement
   * (`video:asset:play`); this adds the release rules: students get published, released videos
   * only, while people who manage the course may preview any video YouTube serves.
   */
  async play(id: string, userId: string): Promise<DomainResult<VideoPlayback>> {
    const v = schema.videos;
    const p = schema.playbackProgress;
    const [manages, tracksProgress] = await Promise.all([
      this.can(userId, "video:asset:manage", id),
      this.can(userId, "video:progress:write", id),
    ]);
    const [row] = await this.db.read
      .select({
        id: v.id,
        title: v.title,
        youtubeVideoId: v.youtubeVideoId,
        durationMs: v.durationMs,
        positionMs: p.positionMs,
        progressDurationMs: p.durationMs,
        completed: p.completed,
      })
      .from(v)
      .leftJoin(p, and(eq(p.videoId, v.id), eq(p.userId, userId)))
      .where(and(eq(v.id, id), this.playable(manages)));
    if (row?.youtubeVideoId === undefined || row.youtubeVideoId === null) return notFound();
    // A finished video starts again from the beginning, and so does one whose link was replaced
    // by a video of another length.
    const resumeMs =
      row.completed === true || lengthChanged(row.progressDurationMs, row.durationMs)
        ? 0
        : (row.positionMs ?? 0);
    const { embedUrl, thumbnailUrl } = this.host.embed(row.youtubeVideoId, {
      startSeconds: Math.floor(resumeMs / 1000),
    });
    return ok({
      videoId: row.id,
      title: row.title,
      youtubeVideoId: row.youtubeVideoId,
      embedUrl,
      thumbnailUrl,
      durationMs: row.durationMs,
      resumeMs,
      tracksProgress,
    });
  }

  /**
   * Stores where the viewer is (§13.4): clamped to the duration, keeping the furthest point,
   * complete at 90 %. A report older than the last one stored (`seq`), or within 5 s of it, is
   * ignored. The video's duration is learned from the first report when it's unknown.
   */
  async saveProgress(
    id: string,
    userId: string,
    report: ProgressReport,
  ): Promise<DomainResult<PlaybackProgress>> {
    return this.db.withTxResult(async ({ db }) => {
      const v = schema.videos;
      const [video] = await db
        .select({ durationMs: v.durationMs })
        .from(v)
        .where(and(eq(v.id, id), this.playable(false)));
      if (video === undefined) return notFound();
      let durationMs = video.durationMs;
      if (durationMs === null) {
        await db
          .update(v)
          .set({ durationMs: report.durationMs })
          .where(and(eq(v.id, id), isNull(v.durationMs)));
        const [learned] = await db.select({ durationMs: v.durationMs }).from(v).where(eq(v.id, id));
        durationMs = learned?.durationMs ?? report.durationMs;
      }

      const now = this.clock.now();
      const positionMs = Math.min(report.positionMs, durationMs);
      const p = schema.playbackProgress;
      const existing = await this.lockProgress(db, id, userId);
      if (existing === null) {
        const [inserted] = await db
          .insert(p)
          .values({
            videoId: id,
            userId,
            ...measure(positionMs, positionMs, durationMs, now, null),
            lastSeq: report.seq,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: [p.videoId, p.userId] })
          .returning();
        if (inserted !== undefined) return ok(toView(inserted));
      }
      const current = existing ?? (await this.lockProgress(db, id, userId));
      if (current === null) throw new Error("playback progress vanished");
      if (
        report.seq <= current.lastSeq ||
        now.getTime() - current.updatedAt.getTime() < PROGRESS_MIN_INTERVAL_MS
      )
        return ok(toView(current));
      // Progress on a replaced video of another length starts over (§13.6).
      const kept = lengthChanged(current.durationMs, durationMs) ? null : current;
      const maxPositionMs = Math.min(Math.max(kept?.maxPositionMs ?? 0, positionMs), durationMs);
      const [updated] = await db
        .update(p)
        .set({
          ...measure(positionMs, maxPositionMs, durationMs, now, kept),
          lastSeq: report.seq,
          updatedAt: now,
          version: sql`${p.version} + 1`,
        })
        .where(eq(p.id, current.id))
        .returning();
      if (updated === undefined) throw new Error("playback progress update returned nothing");
      return ok(toView(updated));
    });
  }

  // ---- helpers ----

  /** Students: published, for enrolled viewers, released. Managers: anything YouTube serves. */
  private playable(manages: boolean): SQL | undefined {
    const v = schema.videos;
    if (manages) return inArray(v.status, ["PUBLISHED", "UNPUBLISHED"]);
    return and(
      eq(v.status, "PUBLISHED"),
      eq(v.visibility, "ENROLLED"),
      or(isNull(v.publishAfter), lte(v.publishAfter, this.clock.now())),
    );
  }

  private async can(
    userId: string,
    permission: "video:asset:manage" | "video:progress:write",
    videoId: string,
  ): Promise<boolean> {
    const decision = await this.authorization.authorize(
      this.authorization.principal(userId),
      permission,
      { type: "video", id: videoId, ownPart: true },
    );
    return decision === "ALLOW";
  }

  private async lockProgress(
    db: Database,
    videoId: string,
    userId: string,
  ): Promise<ProgressRow | null> {
    const p = schema.playbackProgress;
    const [row] = await db
      .select()
      .from(p)
      .where(and(eq(p.videoId, videoId), eq(p.userId, userId)))
      .for("update");
    return row ?? null;
  }
}

/** Whether two durations differ by more than 5 % (§13.6: progress then resets). */
function lengthChanged(recordedMs: number | null, videoMs: number | null): boolean {
  if (recordedMs === null || videoMs === null) return false;
  return Math.abs(recordedMs - videoMs) * 20 > videoMs;
}

/** Position, furthest point, percentage (exact, two places) and completion at 90 %. */
function measure(
  positionMs: number,
  maxPositionMs: number,
  durationMs: number,
  now: Date,
  current: ProgressRow | null,
) {
  const basisPoints = Math.floor((maxPositionMs * 10_000) / durationMs);
  const completed = current?.completed === true || maxPositionMs * 10 >= durationMs * 9;
  return {
    positionMs,
    maxPositionMs,
    durationMs,
    percentComplete: `${String(Math.floor(basisPoints / 100))}.${String(basisPoints % 100).padStart(2, "0")}`,
    completed,
    completedAt: current?.completedAt ?? (completed ? now : null),
  };
}

function toView(row: ProgressRow): PlaybackProgress {
  return {
    positionMs: row.positionMs,
    maxPositionMs: row.maxPositionMs,
    durationMs: row.durationMs,
    completed: row.completed,
  };
}
