import type { Video } from "@glim/contracts";
import { Db, schema, type Database, type TxQueue } from "@glim/db";
import {
  VIDEO_HOST,
  VideoHostUnavailableError,
  type VideoCheck,
  type VideoHost,
} from "@glim/integrations/video-host/port";
import { AuditService, SYSTEM_ACTOR, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { studioUrl } from "./video-admin.service";
import { toView } from "./videos.service";

type VideoRow = typeof schema.videos.$inferSelect;

/** Videos checked per batch by the daily job (§17.1). */
export const AVAILABILITY_BATCH = 50;

type Outcome = "AVAILABLE" | "UNAVAILABLE" | "RESTORED" | "SKIPPED";

/**
 * Whether YouTube still serves each video (owner: video, TRD §13.3 "Availability check"). A video
 * made private, deleted or taken down becomes UNAVAILABLE: hidden from students, shown on the ops
 * view, and the person who added it and the System Admin are told. A recheck that succeeds puts
 * it back as it was.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(VIDEO_HOST) private readonly host: VideoHost,
  ) {}

  /**
   * The daily `video.availability-check` job: every PUBLISHED or UNPUBLISHED video, in batches of
   * 50. If YouTube can't be reached it stops and throws, so the queue retries later.
   */
  async checkAll(): Promise<{ checked: number; unavailable: number }> {
    const v = schema.videos;
    let checked = 0;
    let unavailable = 0;
    let after: string | null = null;
    for (;;) {
      const batch = await this.db.read
        .select({ id: v.id })
        .from(v)
        .where(
          and(
            inArray(v.status, ["PUBLISHED", "UNPUBLISHED"]),
            after === null ? undefined : gt(v.id, after),
          ),
        )
        .orderBy(asc(v.id))
        .limit(AVAILABILITY_BATCH);
      for (const { id } of batch) {
        if ((await this.checkOne(id, SYSTEM_ACTOR, null)) === "UNAVAILABLE") unavailable++;
        checked++;
      }
      const last = batch.at(-1);
      if (last === undefined || batch.length < AVAILABILITY_BATCH) break;
      after = last.id;
    }
    return { checked, unavailable };
  }

  /** `POST /videos/:id/recheck`: checks now; a success restores an UNAVAILABLE video. */
  async recheck(id: string, actor: AuditActor & { userId: string }): Promise<DomainResult<Video>> {
    const v = schema.videos;
    const [row] = await this.db.read.select().from(v).where(eq(v.id, id));
    if (row === undefined || !["PUBLISHED", "UNPUBLISHED", "UNAVAILABLE"].includes(row.status))
      return err(domainError("NOT_FOUND", "Not found."));
    let check: VideoCheck;
    try {
      check = await this.ask(row);
    } catch (error) {
      if (!(error instanceof VideoHostUnavailableError)) throw error;
      return err(
        domainError(
          "VIDEO_CHECK_UNAVAILABLE",
          "YouTube couldn't be checked just now. Try again shortly.",
        ),
      );
    }
    await this.apply(id, check, actor, actor.userId);
    const [updated] = await this.db.read.select().from(v).where(eq(v.id, id));
    if (updated === undefined) throw new Error(`video ${id} vanished`);
    return ok(toView(updated));
  }

  // ---- helpers ----

  private async checkOne(
    id: string,
    actor: AuditActor,
    actorUserId: string | null,
  ): Promise<Outcome> {
    const [row] = await this.db.read.select().from(schema.videos).where(eq(schema.videos.id, id));
    if (row === undefined) return "SKIPPED";
    return this.apply(id, await this.ask(row), actor, actorUserId);
  }

  private async ask(row: VideoRow): Promise<VideoCheck> {
    if (row.youtubeVideoId === null) return { status: "NOT_FOUND" };
    return this.host.checkVideo(row.youtubeVideoId);
  }

  /** Records what YouTube said, under a lock so a concurrent change wins cleanly. */
  private apply(
    id: string,
    check: VideoCheck,
    actor: AuditActor,
    actorUserId: string | null,
  ): Promise<Outcome> {
    return this.db.withTx(async (tx) => {
      const v = schema.videos;
      const [row] = await tx.db.select().from(v).where(eq(v.id, id)).for("update");
      if (row === undefined) return "SKIPPED";
      const now = this.clock.now();
      const served = check.status === "AVAILABLE";
      if (served && row.status !== "UNAVAILABLE") {
        await tx.db.update(v).set({ lastCheckedAt: now }).where(eq(v.id, id));
        return "AVAILABLE";
      }
      if (served) {
        const status = row.statusBeforeUnavailable ?? "UNPUBLISHED";
        await tx.db
          .update(v)
          .set({
            status,
            statusBeforeUnavailable: null,
            unavailableReason: null,
            lastCheckedAt: now,
            updatedAt: now,
            version: sql`${v.version} + 1`,
          })
          .where(eq(v.id, id));
        await this.audit.record(tx.db, actor, {
          action: "video.asset.available-again",
          resourceType: "video",
          resourceId: id,
          metadata: { status },
        });
        return "RESTORED";
      }
      if (row.status === "UNAVAILABLE") {
        await tx.db
          .update(v)
          .set({ lastCheckedAt: now, unavailableReason: check.status })
          .where(eq(v.id, id));
        return "UNAVAILABLE";
      }
      if (row.status !== "PUBLISHED" && row.status !== "UNPUBLISHED") return "SKIPPED";
      await tx.db
        .update(v)
        .set({
          status: "UNAVAILABLE",
          statusBeforeUnavailable: row.status,
          unavailableReason: check.status,
          lastCheckedAt: now,
          updatedAt: now,
          version: sql`${v.version} + 1`,
        })
        .where(eq(v.id, id));
      await this.audit.record(tx.db, actor, {
        action: "video.asset.unavailable",
        resourceType: "video",
        resourceId: id,
        metadata: { reason: check.status, youtubeVideoId: row.youtubeVideoId },
      });
      await tx.boss.publish(
        "video.unavailable",
        { videoId: id, offeringId: row.courseOfferingId, reason: check.status },
        { occurredAt: now, actorUserId },
      );
      await this.tell(tx, row, check.status, now);
      return "UNAVAILABLE";
    });
  }

  /** The person who added it and every System Admin, in-app and by email. */
  private async tell(
    tx: { db: Database; boss: TxQueue },
    row: VideoRow,
    reason: VideoCheck["status"],
    now: Date,
  ): Promise<void> {
    const o = schema.courseOfferings;
    const [course] = await tx.db
      .select({ code: schema.courses.code })
      .from(o)
      .innerJoin(schema.courses, eq(schema.courses.id, o.courseId))
      .where(eq(o.id, row.courseOfferingId));
    const recipients = new Set(await this.roles.holders("SYSTEM_ADMIN", tx.db));
    if (row.addedBy !== null) recipients.add(row.addedBy);
    for (const userId of recipients)
      await this.notifications.notify(tx, {
        userId,
        kind: "video.unavailable",
        title: `YouTube no longer serves "${row.title}"`,
        data: {
          videoId: row.id,
          offeringId: row.courseOfferingId,
          title: row.title,
          courseCode: course?.code ?? "",
          reason,
          studioUrl: studioUrl(row.youtubeVideoId),
        },
        email: true,
        dedupeKey: `video.unavailable:${row.id}:${now.toISOString()}`,
      });
  }
}
