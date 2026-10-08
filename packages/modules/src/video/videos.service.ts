import type { ErrorCode, Video } from "@glim/contracts";
import { Db, PG, pgError, schema, type Database } from "@glim/db";
import {
  normaliseChannelUrl,
  VIDEO_HOST,
  VideoHostUnavailableError,
  type VideoCheck,
  type VideoHost,
} from "@glim/integrations/video-host/port";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { AuthorizationService } from "@glim/modules/authorization";
import { PolicyService, SettingsService } from "@glim/modules/identity";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, lte, max, ne, or, sql, type SQL } from "drizzle-orm";

type VideoRow = typeof schema.videos.$inferSelect;
type Actor = AuditActor & { userId: string };

export interface NewVideo {
  youtubeUrl: string;
  title?: string | undefined;
  description?: string | null | undefined;
  classMeetingId?: string | null | undefined;
  publishAfter?: string | null | undefined;
}

export interface VideoChange {
  title?: string | undefined;
  description?: string | null | undefined;
  classMeetingId?: string | null | undefined;
  publishAfter?: string | null | undefined;
  visibility?: "ENROLLED" | "STAFF_ONLY" | undefined;
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const fail = (code: ErrorCode, message: string, path = "body.youtubeUrl") =>
  domainError(code, message, { fieldErrors: [{ path, code: "invalid", message }] });

/**
 * Course videos (owner: video, TRD §13; v1: link-based). A Lecturer (own offerings) or an admin
 * pastes a YouTube link; the app checks that YouTube serves it and that it's on GLIM's channel,
 * then lists it for the course. Students see published videos whose release time has passed.
 */
@Injectable()
export class VideosService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(VIDEO_HOST) private readonly host: VideoHost,
  ) {}

  /**
   * Checks a link (§13.3): a video URL, served by YouTube, on a channel in
   * `settings.youtube_channel_urls`. Returns the video id and what YouTube says about it.
   */
  async checkLink(url: string): Promise<DomainResult<{ videoId: string; check: VideoCheck }>> {
    const parsed = this.host.parseUrl(url);
    if (parsed === null)
      return err(
        fail(
          "YOUTUBE_URL_INVALID",
          "Paste the link of a YouTube video (a watch, youtu.be, live or embed link).",
        ),
      );
    let check: VideoCheck;
    try {
      check = await this.host.checkVideo(parsed.videoId);
    } catch (error) {
      if (!(error instanceof VideoHostUnavailableError)) throw error;
      return err(
        domainError(
          "VIDEO_CHECK_UNAVAILABLE",
          "YouTube couldn't be checked just now. Try again shortly.",
        ),
      );
    }
    if (check.status === "PRIVATE_OR_RESTRICTED")
      return err(
        fail(
          "YOUTUBE_VIDEO_PRIVATE",
          "That video is private. Set it to Unlisted in YouTube Studio, then add it again.",
        ),
      );
    if (check.status === "NOT_FOUND")
      return err(fail("YOUTUBE_VIDEO_NOT_FOUND", "YouTube doesn't have that video."));
    const allowed = (await this.settings.get()).youtubeChannelUrls.map(normaliseChannelUrl);
    if (check.channelUrl === undefined || !allowed.includes(normaliseChannelUrl(check.channelUrl)))
      return err(
        fail(
          "YOUTUBE_CHANNEL_NOT_ALLOWED",
          allowed.length === 0
            ? "No YouTube channel is set up for recordings yet. Ask the System Admin to add GLIM's channel in Settings."
            : "That video isn't on GLIM's YouTube channel. Upload it there (as Unlisted), then add that link.",
        ),
      );
    return ok({ videoId: parsed.videoId, check });
  }

  /** Adds a recording to an offering, published straight away if the policy says so. */
  async add(offeringId: string, input: NewVideo, actor: Actor): Promise<DomainResult<Video>> {
    const o = schema.courseOfferings;
    const [offering] = await this.db.read
      .select({ status: o.status })
      .from(o)
      .where(eq(o.id, offeringId));
    if (offering === undefined) return notFound();
    if (offering.status === "CANCELLED")
      return err(domainError("CONFLICT", "This offering was cancelled."));
    const meetingProblem = await this.checkMeeting(offeringId, input.classMeetingId ?? null);
    if (meetingProblem !== null) return err(meetingProblem);
    const link = await this.checkLink(input.youtubeUrl);
    if (!link.ok) return link;
    const { videoId, check } = link.value;
    const recording = await this.policies.current("RECORDING");
    const status = recording.config.autoPublish ? "PUBLISHED" : "UNPUBLISHED";

    try {
      const created = await this.db.withTx(async ({ db, boss }) => {
        const now = this.clock.now();
        const v = schema.videos;
        const [last] = await db
          .select({ position: max(v.position) })
          .from(v)
          .where(eq(v.courseOfferingId, offeringId));
        const [row] = await db
          .insert(v)
          .values({
            courseOfferingId: offeringId,
            classMeetingId: input.classMeetingId ?? null,
            origin: "LINK",
            title: input.title ?? check.title ?? "Recording",
            description: input.description ?? null,
            position: (last?.position ?? -1) + 1,
            status,
            youtubeVideoId: videoId,
            youtubeChannelUrl: check.channelUrl ?? null,
            thumbnailUrl: check.thumbnailUrl ?? null,
            lastCheckedAt: now,
            publishAfter:
              input.publishAfter === undefined || input.publishAfter === null
                ? null
                : new Date(input.publishAfter),
            publishedAt: status === "PUBLISHED" ? now : null,
            addedBy: actor.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (row === undefined) throw new Error("video insert returned nothing");
        await this.audit.record(db, actor, {
          action: "video.asset.added",
          resourceType: "video",
          resourceId: row.id,
          metadata: { offeringId, youtubeVideoId: videoId, status },
        });
        await boss.publish(
          "video.added",
          { videoId: row.id, offeringId },
          { occurredAt: now, actorUserId: actor.userId },
        );
        if (status === "PUBLISHED")
          await boss.publish(
            "video.published",
            { videoId: row.id, offeringId },
            { occurredAt: now, actorUserId: actor.userId },
          );
        return row;
      });
      return ok(toView(created));
    } catch (error) {
      if (pgError(error)?.code === PG.UNIQUE_VIOLATION)
        return err(domainError("CONFLICT", "That video is already on this course."));
      throw error;
    }
  }

  /**
   * An offering's videos, in order. People who manage them see every one that isn't deleted;
   * everyone else sees published videos for enrolled viewers whose release time has passed.
   */
  async list(offeringId: string, viewerUserId: string): Promise<Video[]> {
    const manages = await this.manages(viewerUserId, offeringId);
    const v = schema.videos;
    const rows = await this.db.read
      .select()
      .from(v)
      .where(and(eq(v.courseOfferingId, offeringId), this.visible(manages)))
      .orderBy(asc(v.position), asc(v.createdAt));
    return rows.map(toView);
  }

  async get(id: string, viewerUserId: string): Promise<Video | null> {
    const row = await this.row(id);
    if (row === null) return null;
    const manages = await this.manages(viewerUserId, row.courseOfferingId);
    const v = schema.videos;
    const [visible] = await this.db.read
      .select()
      .from(v)
      .where(and(eq(v.id, id), this.visible(manages)));
    return visible === undefined ? null : toView(visible);
  }

  /** App-side metadata (§13.6); the YouTube title isn't changed in v1. */
  async update(
    id: string,
    expectedVersion: number,
    change: VideoChange,
    actor: Actor,
  ): Promise<DomainResult<Video>> {
    const current = await this.row(id);
    if (current === null || current.status === "DELETED") return notFound();
    if (change.classMeetingId !== undefined) {
      const problem = await this.checkMeeting(current.courseOfferingId, change.classMeetingId);
      if (problem !== null) return err(problem);
    }
    return this.change(id, expectedVersion, actor, "video.asset.updated", () => ({
      ...definedFields({
        title: change.title,
        description: change.description,
        classMeetingId: change.classMeetingId,
        visibility: change.visibility,
      }),
      ...(change.publishAfter === undefined
        ? {}
        : { publishAfter: change.publishAfter === null ? null : new Date(change.publishAfter) }),
    }));
  }

  /** UNPUBLISHED → PUBLISHED (publishing a published video changes nothing). */
  async publish(id: string, actor: Actor): Promise<DomainResult<Video>> {
    const current = await this.row(id);
    if (current === null || current.status === "DELETED") return notFound();
    if (current.status === "PUBLISHED") return ok(toView(current));
    if (current.status !== "UNPUBLISHED")
      return err(
        domainError(
          "VIDEO_NOT_AVAILABLE",
          "YouTube isn't serving this video; it can't be published until a recheck succeeds.",
        ),
      );
    return this.change(
      id,
      null,
      actor,
      "video.asset.published",
      (now) => ({
        status: "PUBLISHED",
        publishedAt: current.publishedAt ?? now,
      }),
      "video.published",
    );
  }

  /** PUBLISHED → UNPUBLISHED. */
  async unpublish(id: string, actor: Actor): Promise<DomainResult<Video>> {
    const current = await this.row(id);
    if (current === null || current.status === "DELETED") return notFound();
    if (current.status === "UNPUBLISHED") return ok(toView(current));
    if (current.status !== "PUBLISHED")
      return err(domainError("CONFLICT", "Only a published video can be unpublished."));
    return this.change(
      id,
      null,
      actor,
      "video.asset.unpublished",
      () => ({ status: "UNPUBLISHED" }),
      "video.unpublished",
    );
  }

  /** Sets the order; the list must be exactly the offering's videos (not deleted). */
  async reorder(
    offeringId: string,
    videoIds: string[],
    actor: Actor,
  ): Promise<DomainResult<Video[]>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      const v = schema.videos;
      const rows = await db
        .select({ id: v.id })
        .from(v)
        .where(and(eq(v.courseOfferingId, offeringId), ne(v.status, "DELETED")))
        .for("update");
      const current = new Set(rows.map((r) => r.id));
      if (current.size !== videoIds.length || !videoIds.every((id) => current.has(id)))
        return err(
          domainError("VALIDATION_FAILED", "List every recording of the course, once each.", {
            fieldErrors: [
              { path: "body.videoIds", code: "invalid", message: "Not the course's recordings." },
            ],
          }),
        );
      const now = this.clock.now();
      for (const [position, id] of videoIds.entries())
        await db
          .update(v)
          .set({ position, updatedAt: now, version: sql`${v.version} + 1` })
          .where(eq(v.id, id));
      await this.audit.record(db, actor, {
        action: "video.asset.reordered",
        resourceType: "course-offering",
        resourceId: offeringId,
        metadata: { videoIds },
      });
      return ok(null);
    });
    if (!result.ok) return result;
    const v = schema.videos;
    const rows = await this.db.read
      .select()
      .from(v)
      .where(and(eq(v.courseOfferingId, offeringId), ne(v.status, "DELETED")))
      .orderBy(asc(v.position));
    return ok(rows.map(toView));
  }

  /** The offering a video belongs to, for authorization (§7.2). */
  async offeringOf(id: string): Promise<string | null> {
    return (await this.row(id))?.courseOfferingId ?? null;
  }

  // ---- helpers ----

  private async change(
    id: string,
    expectedVersion: number | null,
    actor: Actor,
    action: string,
    fields: (now: Date) => Partial<VideoRow>,
    event?: "video.published" | "video.unpublished",
  ): Promise<DomainResult<Video>> {
    const result = await this.db.withTxResult(async ({ db, boss }) => {
      const v = schema.videos;
      const [row] = await db.select().from(v).where(eq(v.id, id)).for("update");
      if (row === undefined || row.status === "DELETED") return notFound();
      if (expectedVersion !== null && row.version !== expectedVersion)
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Someone else changed this recording. Reload and try again.",
          ),
        );
      const now = this.clock.now();
      const change = fields(now);
      const [updated] = await db
        .update(v)
        .set({ ...change, updatedAt: now, version: sql`${v.version} + 1` })
        .where(eq(v.id, id))
        .returning();
      if (updated === undefined) throw new Error("video update returned nothing");
      await this.audit.record(db, actor, {
        action,
        resourceType: "video",
        resourceId: id,
        metadata: { fields: Object.keys(change) },
      });
      if (event !== undefined)
        await boss.publish(
          event,
          { videoId: id, offeringId: row.courseOfferingId },
          { occurredAt: now, actorUserId: actor.userId },
        );
      return ok(updated);
    });
    return result.ok ? ok(toView(result.value)) : result;
  }

  /** What a viewer may see (§13.4–13.5): managers everything but deleted videos. */
  private visible(manages: boolean): SQL | undefined {
    const v = schema.videos;
    if (manages) return ne(v.status, "DELETED");
    return and(
      eq(v.status, "PUBLISHED"),
      eq(v.visibility, "ENROLLED"),
      or(isNull(v.publishAfter), lte(v.publishAfter, this.clock.now())),
    );
  }

  private async checkMeeting(
    offeringId: string,
    meetingId: string | null,
  ): Promise<DomainError | null> {
    if (meetingId === null) return null;
    const m = schema.classMeetings;
    const [meeting] = await this.db.read
      .select({ id: m.id })
      .from(m)
      .where(and(eq(m.id, meetingId), eq(m.courseOfferingId, offeringId)));
    return meeting === undefined
      ? fail("VALIDATION_FAILED", "Choose a Class Meeting of this course.", "body.classMeetingId")
      : null;
  }

  private async manages(userId: string, offeringId: string): Promise<boolean> {
    const decision = await this.authorization.authorize(
      this.authorization.principal(userId),
      "video:asset:manage",
      { type: "course-offering", id: offeringId },
    );
    return decision === "ALLOW";
  }

  private async row(id: string, db: Database = this.db.read): Promise<VideoRow | null> {
    const v = schema.videos;
    const [row] = await db.select().from(v).where(eq(v.id, id));
    return row ?? null;
  }
}

function toView(row: VideoRow): Video {
  return {
    id: row.id,
    courseOfferingId: row.courseOfferingId,
    classMeetingId: row.classMeetingId,
    title: row.title,
    description: row.description,
    position: row.position,
    status: row.status as Video["status"],
    visibility: row.visibility as Video["visibility"],
    youtubeVideoId: row.youtubeVideoId,
    thumbnailUrl: row.thumbnailUrl,
    durationMs: row.durationMs,
    publishAfter: row.publishAfter?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    addedAt: row.createdAt.toISOString(),
    version: row.version,
  };
}
