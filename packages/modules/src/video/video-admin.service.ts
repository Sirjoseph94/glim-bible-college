import type { AdminVideo, ErrorCode } from "@glim/contracts";
import { Db, PG, pgError, schema, type Database, type TxQueue } from "@glim/db";
import { AuditService, SYSTEM_ACTOR, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { NotificationsService } from "@glim/modules/notifications";
import { IntegrationsService } from "@glim/modules/ops";
import { VIDEO_HOST, type VideoHost } from "@glim/integrations/video-host/port";
import {
  CLOCK,
  decodeCursor,
  domainError,
  err,
  ok,
  toPage,
  type Clock,
  type DomainResult,
  type Page,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { toView, VideosService } from "./videos.service";

type VideoRow = typeof schema.videos.$inferSelect;
type Actor = AuditActor & { userId: string };

/** How long a deleted video can be restored (§13.6). */
export const DELETE_UNDO_MS = 7 * 86_400_000;

export interface AdminVideoFilter {
  offeringId?: string | undefined;
  status?: VideoRow["status"] | undefined;
  origin?: VideoRow["origin"] | undefined;
  limit: number;
  cursor?: string | undefined;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const conflict = (code: ErrorCode, message: string) => err(domainError(code, message));

/** YouTube Studio's page for a video, where channel managers download or delete it. */
export const studioUrl = (youtubeVideoId: string | null) =>
  youtubeVideoId === null ? null : `https://studio.youtube.com/video/${youtubeVideoId}/edit`;

/** Unavailable videos sort first on the management screen. */
const rank = sql<number>`(CASE WHEN ${schema.videos.status} = 'UNAVAILABLE' THEN 0 ELSE 1 END)`;

/**
 * The System Admin's video management (owner: video, TRD §13.6): every video across offerings,
 * replacing a link, deleting with a 7-day undo, and the daily purge that finishes a delete and
 * reminds the System Admin to remove the video in YouTube Studio.
 */
@Injectable()
export class VideoAdminService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(VideosService) private readonly videos: VideosService,
    @Inject(VIDEO_HOST) private readonly host: VideoHost,
    @Inject(IntegrationsService) private readonly integrations: IntegrationsService,
  ) {}

  async list(filter: AdminVideoFilter): Promise<Page<AdminVideo>> {
    const v = schema.videos;
    const conditions: SQL[] = [];
    if (filter.offeringId !== undefined) conditions.push(eq(v.courseOfferingId, filter.offeringId));
    if (filter.status !== undefined) conditions.push(eq(v.status, filter.status));
    if (filter.origin !== undefined) conditions.push(eq(v.origin, filter.origin));
    if (filter.cursor !== undefined) {
      const at = decodeCursor(filter.cursor);
      const after = or(
        sql`${rank} > ${Number(at.sortKey)}`,
        and(sql`${rank} = ${Number(at.sortKey)}`, lt(v.id, at.id)),
      );
      if (after) conditions.push(after);
    }
    const rows = await this.withOffering()
      .where(and(...conditions))
      .orderBy(rank, desc(v.id))
      .limit(filter.limit + 1);
    const result = toPage(
      rows.map((r) => ({ ...r, id: r.video.id })),
      filter.limit,
      (r) => String(r.video.status === "UNAVAILABLE" ? 0 : 1),
    );
    return { items: result.items.map(toAdminView), nextCursor: result.nextCursor };
  }

  /**
   * Swaps the YouTube link (§13.6): the same checks as adding, in one transaction, keeping the
   * video's place, title and release settings. The duration is learned again from the next viewer,
   * and progress recorded against a duration more than 5 % off is reset then.
   */
  async replaceLink(
    id: string,
    youtubeUrl: string,
    actor: Actor,
  ): Promise<DomainResult<AdminVideo>> {
    const current = await this.row(id);
    if (current === null || current.status === "DELETED") return notFound();
    const link = await this.videos.checkLink(youtubeUrl);
    if (!link.ok) return link;
    const { videoId, check } = link.value;
    try {
      const result = await this.db.withTxResult(async ({ db }) => {
        const v = schema.videos;
        const [row] = await db.select().from(v).where(eq(v.id, id)).for("update");
        if (row === undefined || row.status === "DELETED") return notFound();
        const now = this.clock.now();
        const changed = row.youtubeVideoId !== videoId;
        const [updated] = await db
          .update(v)
          .set({
            youtubeVideoId: videoId,
            youtubeChannelUrl: check.channelUrl ?? null,
            thumbnailUrl: check.thumbnailUrl ?? null,
            lastCheckedAt: now,
            ...(changed ? { durationMs: null } : {}),
            // A working link brings an unavailable video back as it was.
            ...(row.status === "UNAVAILABLE"
              ? {
                  status: row.statusBeforeUnavailable ?? "UNPUBLISHED",
                  statusBeforeUnavailable: null,
                  unavailableReason: null,
                }
              : {}),
            updatedAt: now,
            version: sql`${v.version} + 1`,
          })
          .where(eq(v.id, id))
          .returning();
        if (updated === undefined) throw new Error("video update returned nothing");
        await this.audit.record(db, actor, {
          action: "video.asset.link-replaced",
          resourceType: "video",
          resourceId: id,
          metadata: { from: row.youtubeVideoId, to: videoId },
        });
        return ok(updated);
      });
      return result.ok ? ok(await this.adminView(id)) : result;
    } catch (error) {
      if (pgError(error)?.code === PG.UNIQUE_VIOLATION)
        return conflict("CONFLICT", "That video is already on this course.");
      throw error;
    }
  }

  /** Hidden at once, restorable for 7 days (§13.6). Deleting a deleted video changes nothing. */
  async delete(id: string, actor: Actor): Promise<DomainResult<AdminVideo>> {
    const result = await this.db.withTxResult(async ({ db, boss }) => {
      const v = schema.videos;
      const [row] = await db.select().from(v).where(eq(v.id, id)).for("update");
      if (row === undefined) return notFound();
      if (row.status === "DELETED") return ok(null);
      const now = this.clock.now();
      await db
        .update(v)
        .set({
          status: "DELETED",
          statusBeforeDelete: row.status,
          deletedAt: now,
          deleteAfter: new Date(now.getTime() + DELETE_UNDO_MS),
          deletedBy: actor.userId,
          youtubeDeleteRemindedAt: null,
          updatedAt: now,
          version: sql`${v.version} + 1`,
        })
        .where(eq(v.id, id));
      await this.audit.record(db, actor, {
        action: "video.asset.deleted",
        resourceType: "video",
        resourceId: id,
        metadata: { offeringId: row.courseOfferingId, youtubeVideoId: row.youtubeVideoId },
      });
      await boss.publish(
        "video.deleted",
        { videoId: id, offeringId: row.courseOfferingId },
        { occurredAt: now, actorUserId: actor.userId },
      );
      return ok(null);
    });
    return result.ok ? ok(await this.adminView(id)) : result;
  }

  /** Undoes a delete within the window, back to the status it had. */
  async restore(id: string, actor: Actor): Promise<DomainResult<AdminVideo>> {
    try {
      const result = await this.db.withTxResult(async ({ db }) => {
        const v = schema.videos;
        const [row] = await db.select().from(v).where(eq(v.id, id)).for("update");
        if (row === undefined) return notFound();
        if (row.status !== "DELETED") return ok(null);
        const now = this.clock.now();
        if (row.deleteAfter === null || row.deleteAfter <= now)
          return conflict(
            "CONFLICT",
            "The 7-day undo has passed. Add the video again from its YouTube link.",
          );
        await db
          .update(v)
          .set({
            status: row.statusBeforeDelete ?? "UNPUBLISHED",
            statusBeforeDelete: null,
            deletedAt: null,
            deleteAfter: null,
            deletedBy: null,
            updatedAt: now,
            version: sql`${v.version} + 1`,
          })
          .where(eq(v.id, id));
        await this.audit.record(db, actor, {
          action: "video.asset.restored",
          resourceType: "video",
          resourceId: id,
          metadata: { status: row.statusBeforeDelete },
        });
        return ok(null);
      });
      return result.ok ? ok(await this.adminView(id)) : result;
    } catch (error) {
      // The same YouTube video was added to the course again after the delete.
      if (pgError(error)?.code === PG.UNIQUE_VIOLATION)
        return conflict("CONFLICT", "That video was added to the course again since.");
      throw error;
    }
  }

  /**
   * The `video.purge-deleted` job (§13.6): once the undo window has passed, a deleted video's
   * viewing progress is removed and every System Admin is reminded, once, to delete it in YouTube
   * Studio (v1 can't delete on YouTube). Returns how many videos it finished.
   */
  async purgeDeleted(): Promise<number> {
    const v = schema.videos;
    const due = await this.db.read
      .select({ id: v.id })
      .from(v)
      .where(
        and(
          eq(v.status, "DELETED"),
          lte(v.deleteAfter, this.clock.now()),
          isNull(v.youtubeDeleteRemindedAt),
        ),
      )
      .limit(500);
    let done = 0;
    // With the channel connected, the video is deleted on YouTube too (integration slice);
    // otherwise, or if that fails, the System Admin is reminded to delete it in Studio (v1).
    const connection =
      this.host.channelApi === undefined ? null : await this.integrations.youtube();
    for (const { id } of due) {
      let deletedOnYoutube = false;
      const [video] = await this.db.read.select().from(v).where(eq(v.id, id));
      if (
        connection !== null &&
        video !== undefined &&
        video.youtubeVideoId !== null &&
        video.youtubeChannelUrl === connection.channel.url
      )
        try {
          await this.host.channelApi?.deleteVideo(connection.credentials, video.youtubeVideoId);
          deletedOnYoutube = true;
        } catch {
          deletedOnYoutube = false;
        }
      const finished = await this.db.withTx(async (tx) => {
        const [row] = await tx.db.select().from(v).where(eq(v.id, id)).for("update");
        const now = this.clock.now();
        if (
          row?.status !== "DELETED" ||
          row.deleteAfter === null ||
          row.deleteAfter > now ||
          row.youtubeDeleteRemindedAt !== null
        )
          return false;
        await tx.db.delete(schema.playbackProgress).where(eq(schema.playbackProgress.videoId, id));
        await tx.db
          .update(v)
          .set({ youtubeDeleteRemindedAt: now, updatedAt: now })
          .where(eq(v.id, id));
        if (!deletedOnYoutube) await this.remindToDelete(tx, row);
        await this.audit.record(tx.db, SYSTEM_ACTOR, {
          action: "video.asset.purged",
          resourceType: "video",
          resourceId: id,
          metadata: { youtubeVideoId: row.youtubeVideoId, deletedOnYoutube },
        });
        return true;
      });
      if (finished) done++;
    }
    return done;
  }

  // ---- helpers ----

  private async remindToDelete(tx: { db: Database; boss: TxQueue }, row: VideoRow): Promise<void> {
    if (row.youtubeVideoId === null) return;
    const course = await this.courseOf(tx.db, row.courseOfferingId);
    for (const userId of await this.roles.holders("SYSTEM_ADMIN", tx.db))
      await this.notifications.notify(tx, {
        userId,
        kind: "video.youtube-delete-reminder",
        title: `Delete "${row.title}" in YouTube Studio`,
        data: {
          videoId: row.id,
          title: row.title,
          courseCode: course,
          studioUrl: studioUrl(row.youtubeVideoId),
        },
        email: true,
        dedupeKey: `video.youtube-delete-reminder:${row.id}`,
      });
  }

  private async courseOf(db: Database, offeringId: string): Promise<string> {
    const o = schema.courseOfferings;
    const [row] = await db
      .select({ code: schema.courses.code })
      .from(o)
      .innerJoin(schema.courses, eq(schema.courses.id, o.courseId))
      .where(eq(o.id, offeringId));
    return row?.code ?? "";
  }

  private withOffering() {
    const v = schema.videos;
    const o = schema.courseOfferings;
    const c = schema.courses;
    const s = schema.semesters;
    const a = schema.academicSessions;
    return this.db.read
      .select({
        video: v,
        courseCode: c.code,
        courseTitle: sql<string>`coalesce(${o.titleOverride}, ${c.title})`,
        semesterName: s.name,
        sessionCode: a.code,
        ingest: {
          status: schema.recordings.status,
          errorCode: schema.recordings.lastErrorCode,
          error: schema.recordings.lastError,
          attempts: schema.recordings.attemptCount,
        },
      })
      .from(v)
      .leftJoin(schema.recordings, eq(schema.recordings.id, v.recordingId))
      .innerJoin(o, eq(o.id, v.courseOfferingId))
      .innerJoin(c, eq(c.id, o.courseId))
      .innerJoin(s, eq(s.id, o.semesterId))
      .innerJoin(a, eq(a.id, s.academicSessionId));
  }

  async adminView(id: string): Promise<AdminVideo> {
    const [row] = await this.withOffering().where(eq(schema.videos.id, id));
    if (row === undefined) throw new Error(`video ${id} vanished`);
    return toAdminView(row);
  }

  private async row(id: string): Promise<VideoRow | null> {
    const v = schema.videos;
    const [row] = await this.db.read.select().from(v).where(eq(v.id, id));
    return row ?? null;
  }
}

function toAdminView(row: {
  video: VideoRow;
  courseCode: string;
  courseTitle: string;
  semesterName: string;
  sessionCode: string;
  ingest: {
    status: string | null;
    errorCode: string | null;
    error: string | null;
    attempts: number | null;
  } | null;
}): AdminVideo {
  const v = row.video;
  const ingest = row.ingest?.status == null ? null : row.ingest;
  return {
    ...toView(v),
    origin: v.origin as AdminVideo["origin"],
    courseCode: row.courseCode,
    courseTitle: row.courseTitle,
    semesterName: row.semesterName,
    sessionCode: row.sessionCode,
    unavailableReason: v.unavailableReason,
    lastCheckedAt: v.lastCheckedAt?.toISOString() ?? null,
    studioUrl: studioUrl(v.youtubeVideoId),
    deletedAt: v.deletedAt?.toISOString() ?? null,
    deleteAfter: v.deleteAfter?.toISOString() ?? null,
    youtubeDeleteRemindedAt: v.youtubeDeleteRemindedAt?.toISOString() ?? null,
    ingest:
      ingest === null
        ? null
        : {
            status: ingest.status as NonNullable<AdminVideo["ingest"]>["status"],
            errorCode: ingest.errorCode,
            error: ingest.error,
            attempts: ingest.attempts ?? 0,
          },
  };
}
