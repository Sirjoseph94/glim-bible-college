import type { OpsFailure, QueueStat, YouTubeStatus } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { VIDEO_HOST, type VideoHost } from "@glim/integrations/video-host/port";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";

/** A queue whose oldest waiting job is older than this alerts the System Admin (§20.1). */
export const QUEUE_AGE_ALERT_SECONDS = 120;

type Actor = AuditActor & { userId: string };

const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * The System Admin's ops page (owner: ops, TRD §15.3, §20.1): what failed and can be replayed,
 * how the job queues are doing, and whether YouTube answers. Replays are audited.
 */
@Injectable()
export class OpsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(VIDEO_HOST) private readonly videoHost: VideoHost,
  ) {}

  /** `v_ops_failures` plus pg-boss jobs that failed in the last 7 days, newest first. */
  async failures(): Promise<OpsFailure[]> {
    const rows = await this.db.read.execute<{
      kind: OpsFailure["kind"];
      id: string;
      label: string;
      status: string;
      detail: string | null;
      occurred_at: Date | string;
    }>(sql`
      SELECT kind, id, label, status, detail, occurred_at FROM v_ops_failures
      UNION ALL
      SELECT 'job', j.id::text, j.name, 'FAILED',
             left(coalesce(j.output->>'message', j.output::text), 300), j.completed_on
        FROM pgboss.job j
       WHERE j.state = 'failed' AND j.completed_on > now() - interval '7 days'
      ORDER BY occurred_at DESC
      LIMIT 200`);
    return rows.rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      label: r.label,
      status: r.status,
      detail: r.detail,
      occurredAt: new Date(r.occurred_at).toISOString(),
      replayable: r.kind !== "meeting-provision",
    }));
  }

  /** Each queue's depth and the age of its oldest waiting job (due now, not scheduled later). */
  async queues(): Promise<QueueStat[]> {
    const rows = await this.db.read.execute<{
      name: string;
      queued: number;
      active: number;
      failed: number;
      oldest_seconds: number | null;
    }>(sql`
      SELECT name,
             count(*) FILTER (WHERE state IN ('created', 'retry') AND start_after <= now())::int AS queued,
             count(*) FILTER (WHERE state = 'active')::int AS active,
             count(*) FILTER (WHERE state = 'failed' AND completed_on > now() - interval '1 day')::int AS failed,
             floor(extract(epoch FROM now() - min(created_on)
               FILTER (WHERE state IN ('created', 'retry') AND start_after <= now())))::int AS oldest_seconds
        FROM pgboss.job
       GROUP BY name
       ORDER BY name`);
    return rows.rows.map((r) => ({
      name: r.name,
      queued: r.queued,
      active: r.active,
      failedLastDay: r.failed,
      oldestQueuedSeconds: r.oldest_seconds,
      behind: (r.oldest_seconds ?? 0) > QUEUE_AGE_ALERT_SECONDS,
    }));
  }

  /**
   * The `ops.queue-health` cron (every minute): emails the System Admins when a queue's oldest
   * waiting job is older than 120 s, at most once an hour per queue.
   */
  async checkQueues(): Promise<string[]> {
    const behind = (await this.queues()).filter((q) => q.behind);
    if (behind.length === 0) return [];
    const r = schema.roleAssignments;
    const admins = await this.db.read
      .selectDistinct({ userId: r.userId })
      .from(r)
      .innerJoin(schema.users, eq(schema.users.id, r.userId))
      .where(
        and(eq(r.role, "SYSTEM_ADMIN"), isNull(r.revokedAt), eq(schema.users.status, "ACTIVE")),
      );
    const hour = this.clock.now().toISOString().slice(0, 13);
    await this.db.withTx(async (tx) => {
      for (const q of behind)
        for (const admin of admins)
          await this.notifications.notify(tx, {
            userId: admin.userId,
            kind: "ops.queue-backlog",
            title: `Job queue ${q.name} is falling behind`,
            data: { queue: q.name, oldestSeconds: q.oldestQueuedSeconds, queued: q.queued },
            email: true,
            dedupeKey: `queue-backlog:${q.name}:${hour}`,
          });
    });
    return behind.map((q) => q.name);
  }

  /**
   * Replays one failure (§15.3), audited: a provider event is processed again, a video's link is
   * rechecked, a failed job is sent again with its payload, and a suppressed address is cleared.
   */
  async replay(
    kind: OpsFailure["kind"],
    id: string,
    actor: Actor,
  ): Promise<DomainResult<{ replayed: true }>> {
    const result = await this.db.withTxResult<string, ReturnType<typeof domainError>>(
      async ({ db, boss }) => {
        if (kind === "provider-event") {
          const e = schema.providerEvents;
          const [row] = await db
            .update(e)
            .set({ status: "RECEIVED", lastError: null })
            .where(eq(e.id, id))
            .returning({ id: e.id });
          if (row === undefined) return notFound();
          await boss.send("provider-event.process", { providerEventId: id });
          return ok("provider event processed again");
        }
        if (kind === "video") {
          const [row] = await db
            .select({ id: schema.videos.id })
            .from(schema.videos)
            .where(eq(schema.videos.id, id));
          if (row === undefined) return notFound();
          await boss.send("video.availability-check", { videoId: id, actorUserId: actor.userId });
          return ok("video link check queued");
        }
        if (kind === "job") {
          const found = await db.execute<{ name: string; data: object | null }>(
            sql`SELECT name, data FROM pgboss.job WHERE id = ${id}::uuid AND state = 'failed'`,
          );
          const job = found.rows[0];
          if (job === undefined) return notFound();
          await boss.send(job.name as Parameters<typeof boss.send>[0], job.data ?? {});
          return ok(`job ${job.name} sent again`);
        }
        if (kind === "email") {
          const u = schema.users;
          const [row] = await db
            .update(u)
            .set({ emailStatus: "OK", updatedAt: this.clock.now() })
            .where(eq(u.id, id))
            .returning({ id: u.id });
          if (row === undefined) return notFound();
          return ok("address no longer suppressed");
        }
        return err(
          domainError(
            "VALIDATION_FAILED",
            "Class Meeting provisioning comes with the Google integration; nothing to replay yet.",
          ),
        );
      },
    );
    if (!result.ok) return result;
    await this.db.withTx(({ db }) =>
      this.audit.record(db, actor, {
        action: "ops.replayed",
        resourceType: kind,
        resourceId: id,
        metadata: { outcome: result.value },
      }),
    );
    return ok({ replayed: true });
  }

  /** The last YouTube check, if one has run. */
  async youtubeStatus(): Promise<YouTubeStatus | null> {
    const c = schema.integrationChecks;
    const [row] = await this.db.read.select().from(c).where(eq(c.provider, "youtube"));
    if (row === undefined) return null;
    return {
      checkedAt: row.checkedAt.toISOString(),
      ok: row.ok,
      ...(row.result as Omit<YouTubeStatus, "checkedAt" | "ok">),
    };
  }

  /** Queues a YouTube check; the job calls YouTube, never the request (CLAUDE.md). */
  async requestYoutubeCheck(actor: Actor): Promise<void> {
    await this.db.withTx(async ({ db, boss }) => {
      await boss.send("ops.youtube-check", {});
      await this.audit.record(db, actor, {
        action: "ops.youtube-check.requested",
        resourceType: "integration",
        resourceId: "youtube",
      });
    });
  }

  /** The `ops.youtube-check` job: oEmbed reachable, and each configured channel URL resolving. */
  async runYoutubeCheck(): Promise<YouTubeStatus> {
    const [settings] = await this.db.read
      .select({ urls: schema.settings.youtubeChannelUrls })
      .from(schema.settings)
      .limit(1);
    const check = await this.videoHost.checkService(settings?.urls ?? []);
    const okNow = check.reachable && check.channels.every((c) => c.resolves);
    const now = this.clock.now();
    const result = { reachable: check.reachable, detail: check.detail, channels: check.channels };
    const c = schema.integrationChecks;
    await this.db.withTx(({ db }) =>
      db
        .insert(c)
        .values({ provider: "youtube", checkedAt: now, ok: okNow, result })
        .onConflictDoUpdate({ target: c.provider, set: { checkedAt: now, ok: okNow, result } }),
    );
    return { checkedAt: now.toISOString(), ok: okNow, ...result };
  }
}
