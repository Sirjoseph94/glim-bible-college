import { Db, schema, type TxQueue } from "@glim/db";
import {
  LIVE_PROVIDER,
  ProviderNotFoundError,
  ProviderPermanentError,
  type LiveProvider,
} from "@glim/integrations/live-provider/port";
import {
  ChannelAuthError,
  ChannelQuotaError,
  VIDEO_HOST,
  type ChannelApi,
  type VideoHost,
} from "@glim/integrations/video-host/port";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { PolicyService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import { IntegrationsService } from "@glim/modules/ops";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { toLocalDate } from "@glim/shared/time";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const JOB: AuditActor = { userId: null, type: "JOB" };
/** YouTube's processing is polled with backoff, up to about a day (§17.1). */
const PROCESSING_POLLS = 40;
/** Recordings from conferences that ended this long ago are still looked for. */
const RECONCILE_LOOKBACK_MS = 7 * 24 * HOUR;
/** A quota-limited upload waits this long (the quota resets daily). */
const QUOTA_WAIT_MS = 6 * HOUR;

type RecordingRow = typeof schema.recordings.$inferSelect;

/** INV-9: the upload is the recording when its length is within max(2 s, 2 %). */
export function durationsMatch(sourceMs: number, uploadedMs: number): boolean {
  return Math.abs(sourceMs - uploadedMs) <= Math.max(2000, Math.ceil(sourceMs * 0.02));
}

/**
 * Meet recordings to YouTube (owner: video, TRD §13.2–13.3, integration slice): a recording found
 * in the host's Drive becomes a PROCESSING video; the worker streams the file from Drive into an
 * unlisted upload (video bytes never pass through the API or a temp file); once YouTube has
 * processed it and its length matches the original (INV-9), the video is published per policy.
 * Drive originals are kept unless `DRIVE_CLEANUP_MODE=TRASH_AFTER_INGEST` (D-07).
 */
@Injectable()
export class RecordingsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(LIVE_PROVIDER) private readonly provider: LiveProvider | null,
    @Inject(VIDEO_HOST) private readonly videoHost: VideoHost,
    @Inject(IntegrationsService) private readonly integrations: IntegrationsService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** Uploads happen only when the app can act as the channel. */
  private get channel(): ChannelApi | null {
    return this.videoHost.channelApi ?? null;
  }

  /**
   * The `recording.discover` job (§13.3 step 1): finds the recording in Meet, records it with its
   * Drive file's facts, creates the PROCESSING video and queues the upload. Idempotent per Meet
   * recording; a recording whose file isn't ready yet is retried.
   */
  async discover(input: {
    meetingId: string;
    conferenceId: string;
    recordingId: string;
  }): Promise<"DISCOVERED" | "SKIPPED"> {
    const provider = this.provider;
    if (provider === null) return "SKIPPED";
    const r = schema.recordings;
    const [known] = await this.db.read
      .select({ id: r.id })
      .from(r)
      .where(eq(r.providerRecordingId, input.recordingId));
    if (known !== undefined) return "SKIPPED";
    const m = schema.classMeetings;
    const c = schema.conferenceRecords;
    const h = schema.providerHostAccounts;
    const [found] = await this.db.read
      .select({ meeting: m, conferenceRecordId: c.id, hostEmail: h.email })
      .from(c)
      .innerJoin(m, eq(m.id, c.classMeetingId))
      .innerJoin(h, eq(h.id, m.hostAccountId))
      .where(and(eq(c.providerConferenceId, input.conferenceId), eq(m.id, input.meetingId)));
    if (found === undefined || found.meeting.recordingMode === "OFF") return "SKIPPED";
    const recordings = await provider.listRecordings({
      hostEmail: found.hostEmail,
      conferenceId: input.conferenceId,
    });
    const recording = recordings.find((x) => x.recordingId === input.recordingId);
    if (recording === undefined) return "SKIPPED";
    if (recording.state !== "FILE_GENERATED" || recording.fileId === null)
      throw new Error("The recording's file isn't in Drive yet.");
    const file = await provider.describeArtifact({
      hostEmail: found.hostEmail,
      fileId: recording.fileId,
    });
    const meeting = found.meeting;

    await this.db.withTx(async ({ db, boss }) => {
      const now = this.clock.now();
      const [{ parts } = { parts: 0 }] = await db
        .select({ parts: sql<number>`count(*)::int` })
        .from(r)
        .where(eq(r.conferenceRecordId, found.conferenceRecordId));
      const [row] = await db
        .insert(r)
        .values({
          classMeetingId: meeting.id,
          conferenceRecordId: found.conferenceRecordId,
          partNo: parts + 1,
          providerRecordingId: recording.recordingId,
          driveFileId: recording.fileId,
          status: file.exists ? "DISCOVERED" : "SOURCE_MISSING",
          sourceSizeBytes: file.sizeBytes,
          sourceMd5: file.md5,
          sourceMime: file.mime,
          sourceDurationMs: file.durationMs,
          recordingStartedAt: recording.startedAt,
          recordingEndedAt: recording.endedAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (row === undefined) return;
      if (this.channel === null) {
        // Link mode (v1 hosting): staff upload in YouTube Studio; the recording is only noted.
        this.logger.info({ recordingId: row.id }, "recording found; uploads are by hand");
        return;
      }
      const v = schema.videos;
      const [{ position } = { position: 0 }] = await db
        .select({ position: sql<number>`coalesce(max(${v.position}) + 1, 0)::int` })
        .from(v)
        .where(eq(v.courseOfferingId, meeting.courseOfferingId));
      await db.insert(v).values({
        courseOfferingId: meeting.courseOfferingId,
        classMeetingId: meeting.id,
        recordingId: row.id,
        origin: "RECORDING",
        title: parts > 0 ? `${meeting.title} (part ${String(parts + 1)})` : meeting.title,
        status: file.exists ? "PROCESSING" : "FAILED",
        position,
        createdAt: now,
        updatedAt: now,
      });
      await boss.publish(
        "recording.discovered",
        { recordingId: row.id, meetingId: meeting.id, offeringId: meeting.courseOfferingId },
        { occurredAt: now, actorUserId: null },
      );
      if (file.exists)
        await boss.send(
          "recording.ingest",
          { recordingId: row.id },
          { singletonKey: `recording:${row.id}` },
        );
    });
    if (!file.exists)
      await this.notifyFailure(input.recordingId, "SOURCE_MISSING", "The file is gone from Drive.");
    return "DISCOVERED";
  }

  /**
   * The `recording.ingest` job (§13.3 step 2; media role, one at a time, up to 2 h): streams the
   * Drive file into an unlisted YouTube upload. A missing file is SOURCE_MISSING; a spent quota
   * waits for the next day; a revoked channel grant degrades the integration; other failures are
   * retried, and the last attempt marks the recording FAILED.
   */
  async ingest(recordingId: string, attempt: { final: boolean }): Promise<string> {
    const provider = this.provider;
    const channel = this.channel;
    if (provider === null || channel === null) return "SKIPPED";
    const claim = await this.claim(recordingId);
    if (claim === null) return "SKIPPED";
    const { recording, hostEmail, title, description, videoId } = claim;
    const connection = await this.integrations.youtube();
    if (connection === null)
      return this.fail(recording, "CHANNEL_NOT_CONNECTED", "The YouTube channel isn't connected.");

    let uploaded: { videoId: string };
    try {
      const ref = { hostEmail, fileId: recording.driveFileId ?? "" };
      const file = await provider.describeArtifact(ref);
      if (!file.exists)
        return await this.fail(
          recording,
          "SOURCE_MISSING",
          "The recording is gone from Drive.",
          "SOURCE_MISSING",
        );
      const stream = await provider.openArtifactStream(ref);
      uploaded = await channel.upload(connection.credentials, {
        title,
        description,
        body: stream.body,
        sizeBytes: stream.sizeBytes,
        mime: file.mime ?? recording.sourceMime ?? "video/mp4",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ProviderNotFoundError)
        return this.fail(recording, "SOURCE_MISSING", message, "SOURCE_MISSING");
      if (error instanceof ChannelAuthError) {
        await this.integrations.markDegraded("video_host", message, "the YouTube channel");
        return this.fail(recording, "CHANNEL_NOT_CONNECTED", message);
      }
      if (error instanceof ChannelQuotaError) {
        await this.release(recording.id, "QUOTA", message, QUOTA_WAIT_MS);
        return "QUOTA";
      }
      if (error instanceof ProviderPermanentError || attempt.final)
        return this.fail(recording, "UPLOAD_FAILED", message);
      await this.release(recording.id, "UPLOAD_FAILED", message, null);
      throw error;
    }

    await this.db.withTx(async ({ db, boss }) => {
      const now = this.clock.now();
      const r = schema.recordings;
      await db
        .update(r)
        .set({
          status: "PROCESSING",
          uploadedAt: now,
          lastError: null,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(eq(r.id, recording.id));
      const v = schema.videos;
      await db
        .update(v)
        .set({
          youtubeVideoId: uploaded.videoId,
          youtubeChannelUrl: connection.channel.url,
          updatedAt: now,
        })
        .where(eq(v.id, videoId));
      await boss.send(
        "video.youtube-processing-sync",
        { videoId, poll: 0 },
        { startAfter: new Date(now.getTime() + MINUTE) },
      );
    });
    this.logger.info({ recordingId, youtubeVideoId: uploaded.videoId }, "recording uploaded");
    return "UPLOADED";
  }

  /**
   * The `video.youtube-processing-sync` job (§13.3 steps 3–4): asks YouTube whether it has
   * processed the upload, polling again with backoff. When it has, the upload's length must
   * match the recording's (INV-9) before the video is published per the RECORDING policy.
   */
  async processingSync(videoId: string, poll: number): Promise<string> {
    const channel = this.channel;
    if (channel === null) return "SKIPPED";
    const v = schema.videos;
    const r = schema.recordings;
    const [row] = await this.db.read
      .select({ video: v, recording: r })
      .from(v)
      .innerJoin(r, eq(r.id, v.recordingId))
      .where(eq(v.id, videoId));
    if (row?.video.status !== "PROCESSING" || row.video.youtubeVideoId === null) return "SKIPPED";
    const { video, recording } = row;
    const connection = await this.integrations.youtube();
    if (connection === null)
      return this.fail(recording, "CHANNEL_NOT_CONNECTED", "The YouTube channel isn't connected.");
    let status;
    try {
      status = await channel.getProcessing(connection.credentials, video.youtubeVideoId ?? "");
    } catch (error) {
      if (error instanceof ChannelAuthError) {
        await this.integrations.markDegraded("video_host", error.message, "the YouTube channel");
        return this.fail(recording, "CHANNEL_NOT_CONNECTED", error.message);
      }
      throw error;
    }
    if (status.state === "PROCESSING") {
      if (poll + 1 >= PROCESSING_POLLS)
        return this.fail(
          recording,
          "PROCESSING_TIMEOUT",
          "YouTube didn't finish processing the upload.",
        );
      const delay = Math.min(30 * MINUTE, 30_000 * 2 ** poll);
      await this.db.withTx(({ boss }) =>
        boss.send(
          "video.youtube-processing-sync",
          { videoId, poll: poll + 1 },
          { startAfter: new Date(this.clock.now().getTime() + delay) },
        ),
      );
      return "PROCESSING";
    }
    if (status.state === "FAILED")
      return this.fail(recording, "PROCESSING_FAILED", "YouTube couldn't process the upload.");

    // INV-9: never publish a video that isn't the recording.
    const source =
      recording.sourceDurationMs ??
      (recording.recordingStartedAt !== null && recording.recordingEndedAt !== null
        ? recording.recordingEndedAt.getTime() - recording.recordingStartedAt.getTime()
        : null);
    if (source === null || status.durationMs === null)
      return this.fail(
        recording,
        "DURATION_UNKNOWN",
        "The length couldn't be checked against the recording.",
      );
    if (!durationsMatch(source, status.durationMs))
      return this.fail(
        recording,
        "DURATION_MISMATCH",
        `YouTube's copy is ${String(Math.round(status.durationMs / 1000))} s; the recording is ${String(Math.round(source / 1000))} s.`,
      );

    const policy = await this.policies.current("RECORDING");
    const publish = policy.config.autoPublish;
    await this.db.withTx(async ({ db, boss }) => {
      const now = this.clock.now();
      await db
        .update(v)
        .set({
          status: publish ? "PUBLISHED" : "UNPUBLISHED",
          durationMs: status.durationMs,
          thumbnailUrl:
            status.thumbnailUrl ??
            this.videoHost.embed(video.youtubeVideoId ?? "", {}).thumbnailUrl,
          publishedAt: publish ? now : null,
          lastCheckedAt: now,
          updatedAt: now,
          version: sql`${v.version} + 1`,
        })
        .where(eq(v.id, videoId));
      await db.update(r).set({ status: "READY", updatedAt: now }).where(eq(r.id, recording.id));
      await this.audit.record(db, JOB, {
        action: "video.asset.ingested",
        resourceType: "video",
        resourceId: videoId,
        metadata: {
          recordingId: recording.id,
          youtubeVideoId: video.youtubeVideoId,
          published: publish,
        },
      });
      const event = { videoId, offeringId: video.courseOfferingId };
      await boss.publish("video.added", event, { occurredAt: now, actorUserId: null });
      if (publish)
        await boss.publish("video.published", event, { occurredAt: now, actorUserId: null });
      if (this.config.driveCleanupMode === "TRASH_AFTER_INGEST") {
        await db.update(r).set({ driveCleanupStatus: "PENDING" }).where(eq(r.id, recording.id));
        await boss.send("drive.cleanup", { recordingId: recording.id });
      }
    });
    return publish ? "PUBLISHED" : "UNPUBLISHED";
  }

  /** `POST /videos/:id/retry-ingest` (System Admin): uploads a failed recording again. */
  async retry(
    videoId: string,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<null>> {
    if (this.channel === null || this.provider === null)
      return err(domainError("CONFLICT", "Automatic upload isn't switched on."));
    return this.db.withTxResult(async ({ db, boss }) => {
      const v = schema.videos;
      const r = schema.recordings;
      const [row] = await db
        .select({ video: v, recording: r })
        .from(v)
        .innerJoin(r, eq(r.id, v.recordingId))
        .where(eq(v.id, videoId))
        .for("update");
      if (row === undefined) return err(domainError("NOT_FOUND", "Not found."));
      if (row.video.status !== "FAILED")
        return err(domainError("CONFLICT", "Only a failed recording can be uploaded again."));
      const now = this.clock.now();
      await db
        .update(r)
        .set({ status: "DISCOVERED", lastError: null, lastErrorCode: null, updatedAt: now })
        .where(eq(r.id, row.recording.id));
      await db
        .update(v)
        .set({
          status: "PROCESSING",
          youtubeVideoId: null,
          updatedAt: now,
          version: sql`${v.version} + 1`,
        })
        .where(eq(v.id, videoId));
      await boss.send("recording.ingest", { recordingId: row.recording.id });
      await this.audit.record(db, actor, {
        action: "video.asset.retry-ingest",
        resourceType: "video",
        resourceId: videoId,
        metadata: { recordingId: row.recording.id, previousError: row.recording.lastErrorCode },
      });
      return ok(null);
    });
  }

  /**
   * The `recording.reconcile` job (every 10 minutes): recordings of the past week's ended
   * conferences that no event announced, and uploads left behind by a crashed worker.
   */
  async reconcile(): Promise<{ discovered: number; requeued: number }> {
    const provider = this.provider;
    const counts = { discovered: 0, requeued: 0 };
    if (provider === null) return counts;
    const now = this.clock.now();
    const c = schema.conferenceRecords;
    const m = schema.classMeetings;
    const h = schema.providerHostAccounts;
    const r = schema.recordings;
    const conferences = await this.db.read
      .select({
        meetingId: m.id,
        conferenceId: c.providerConferenceId,
        hostEmail: h.email,
      })
      .from(c)
      .innerJoin(m, eq(m.id, c.classMeetingId))
      .innerJoin(h, eq(h.id, m.hostAccountId))
      .where(
        and(
          eq(c.status, "ENDED"),
          gte(c.endedAt, new Date(now.getTime() - RECONCILE_LOOKBACK_MS)),
          ne(m.recordingMode, "OFF"),
        ),
      );
    const known = new Set(
      (await this.db.read.select({ id: r.providerRecordingId }).from(r)).map((x) => x.id),
    );
    for (const conference of conferences) {
      try {
        for (const recording of await provider.listRecordings({
          hostEmail: conference.hostEmail,
          conferenceId: conference.conferenceId,
        })) {
          if (recording.state !== "FILE_GENERATED" || known.has(recording.recordingId)) continue;
          await this.db.withTx(({ boss }) =>
            boss.send(
              "recording.discover",
              {
                meetingId: conference.meetingId,
                conferenceId: conference.conferenceId,
                recordingId: recording.recordingId,
              },
              { singletonKey: `recording:${recording.recordingId}` },
            ),
          );
          counts.discovered++;
        }
      } catch (error) {
        this.logger.warn(
          { err: error, conferenceId: conference.conferenceId },
          "recording reconciliation failed",
        );
      }
    }
    if (this.channel !== null) {
      // An upload that never finished (the job expires after 2 h), or never started.
      const stuck = await this.db.read
        .select({ id: r.id })
        .from(r)
        .where(
          sql`(${r.status} = 'UPLOADING' AND ${r.updatedAt} < ${new Date(now.getTime() - 3 * HOUR)})
            OR (${r.status} = 'DISCOVERED' AND ${r.updatedAt} < ${new Date(now.getTime() - HOUR)}
                AND coalesce(${r.lastErrorCode}, '') <> 'QUOTA')`,
        );
      for (const { id } of stuck) {
        await this.db.withTx(async ({ db, boss }) => {
          await db.update(r).set({ status: "DISCOVERED", updatedAt: now }).where(eq(r.id, id));
          await boss.send(
            "recording.ingest",
            { recordingId: id },
            { singletonKey: `recording:${id}` },
          );
        });
        counts.requeued++;
      }
    }
    return counts;
  }

  /**
   * The `drive.cleanup` job (C-16, only with `DRIVE_CLEANUP_MODE=TRASH_AFTER_INGEST`): moves an
   * ingested recording's Drive original to the bin, once its video is safely on YouTube.
   */
  async cleanup(recordingId: string): Promise<string> {
    const provider = this.provider;
    if (provider === null || this.config.driveCleanupMode !== "TRASH_AFTER_INGEST")
      return "SKIPPED";
    const r = schema.recordings;
    const v = schema.videos;
    const m = schema.classMeetings;
    const h = schema.providerHostAccounts;
    const [row] = await this.db.read
      .select({ recording: r, videoStatus: v.status, hostEmail: h.email })
      .from(r)
      .innerJoin(v, eq(v.recordingId, r.id))
      .innerJoin(m, eq(m.id, r.classMeetingId))
      .innerJoin(h, eq(h.id, m.hostAccountId))
      .where(eq(r.id, recordingId));
    if (
      row === undefined ||
      row.recording.status !== "READY" ||
      row.recording.driveFileId === null ||
      !["PUBLISHED", "UNPUBLISHED"].includes(row.videoStatus) ||
      row.recording.driveCleanupStatus === "TRASHED"
    )
      return "SKIPPED";
    let outcome: "TRASHED" | "SKIPPED" = "TRASHED";
    try {
      await provider.trashArtifact({ hostEmail: row.hostEmail, fileId: row.recording.driveFileId });
    } catch (error) {
      if (!(error instanceof ProviderNotFoundError)) throw error;
      outcome = "SKIPPED";
    }
    await this.db.withTx(({ db }) =>
      db
        .update(r)
        .set({ driveCleanupStatus: outcome, updatedAt: this.clock.now() })
        .where(eq(r.id, recordingId)),
    );
    return outcome;
  }

  /** The `video.youtube-metadata` job: a title edited in the app is changed on YouTube. */
  async syncMetadata(videoId: string): Promise<string> {
    const channel = this.channel;
    if (channel === null) return "SKIPPED";
    const connection = await this.integrations.youtube();
    if (connection === null) return "SKIPPED";
    const v = schema.videos;
    const [video] = await this.db.read.select().from(v).where(eq(v.id, videoId));
    // Only videos on the connected channel: a pasted link may be on another of GLIM's channels.
    if (
      video?.youtubeVideoId === null ||
      video === undefined ||
      video.status === "DELETED" ||
      video.youtubeChannelUrl !== connection.channel.url
    )
      return "SKIPPED";
    await channel.updateMetadata(connection.credentials, video.youtubeVideoId, {
      title: video.title,
      description: video.description ?? undefined,
    });
    return "UPDATED";
  }

  /** Queues a title sync with the change that caused it, when the app manages the channel. */
  async queueMetadataSync(boss: TxQueue, videoId: string): Promise<void> {
    if (this.channel !== null) await boss.send("video.youtube-metadata", { videoId });
  }

  // ---- helpers ----

  /** Marks the recording UPLOADING (one attempt at a time) and gathers what the upload needs. */
  private async claim(recordingId: string) {
    return this.db.withTx(async ({ db }) => {
      const r = schema.recordings;
      const v = schema.videos;
      const m = schema.classMeetings;
      const h = schema.providerHostAccounts;
      const [row] = await db
        .select({
          recording: r,
          videoId: v.id,
          meeting: m,
          hostEmail: h.email,
          courseCode: schema.courses.code,
        })
        .from(r)
        .innerJoin(v, eq(v.recordingId, r.id))
        .innerJoin(m, eq(m.id, r.classMeetingId))
        .innerJoin(h, eq(h.id, m.hostAccountId))
        .innerJoin(schema.courseOfferings, eq(schema.courseOfferings.id, m.courseOfferingId))
        .innerJoin(schema.courses, eq(schema.courses.id, schema.courseOfferings.courseId))
        .where(eq(r.id, recordingId))
        .for("update", { of: r });
      if (row === undefined || !["DISCOVERED", "FAILED"].includes(row.recording.status))
        return null;
      const now = this.clock.now();
      await db
        .update(r)
        .set({
          status: "UPLOADING",
          attemptCount: sql`${r.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(eq(r.id, recordingId));
      const date = toLocalDate(row.meeting.scheduledStart, row.meeting.timezone);
      const part = row.recording.partNo > 1 ? ` (part ${String(row.recording.partNo)})` : "";
      return {
        recording: row.recording,
        hostEmail: row.hostEmail,
        videoId: row.videoId,
        title: `${row.courseCode} ${row.meeting.title}${part}`,
        // No personal data: course, class and date only.
        description: `${row.courseCode}: ${row.meeting.title}, recorded on ${date}. GLIM Online Bible College.`,
      };
    });
  }

  /** Back to DISCOVERED after a failure that will be retried (now, or after `waitMs`). */
  private async release(id: string, code: string, message: string, waitMs: number | null) {
    await this.db.withTx(async ({ db, boss }) => {
      const r = schema.recordings;
      await db
        .update(r)
        .set({
          status: "DISCOVERED",
          lastErrorCode: code,
          lastError: message.slice(0, 500),
          updatedAt: this.clock.now(),
        })
        .where(eq(r.id, id));
      if (waitMs !== null)
        await boss.send(
          "recording.ingest",
          { recordingId: id },
          { startAfter: new Date(this.clock.now().getTime() + waitMs) },
        );
    });
  }

  /** FAILED (or SOURCE_MISSING) for good: on the ops page, and the System Admins are told. */
  private async fail(
    recording: RecordingRow,
    code: string,
    message: string,
    status: "FAILED" | "SOURCE_MISSING" = "FAILED",
  ): Promise<string> {
    await this.db.withTx(async ({ db }) => {
      const now = this.clock.now();
      const r = schema.recordings;
      const v = schema.videos;
      await db
        .update(r)
        .set({ status, lastErrorCode: code, lastError: message.slice(0, 500), updatedAt: now })
        .where(eq(r.id, recording.id));
      await db
        .update(v)
        .set({ status: "FAILED", unavailableReason: code, updatedAt: now })
        .where(and(eq(v.recordingId, recording.id), inArray(v.status, ["PROCESSING"])));
      await this.audit.record(db, JOB, {
        action: "video.recording.failed",
        resourceType: "recording",
        resourceId: recording.id,
        outcome: "FAILURE",
        metadata: { code, message: message.slice(0, 300) },
      });
    });
    await this.notifyFailure(recording.providerRecordingId, code, message);
    return status;
  }

  private async notifyFailure(providerRecordingId: string, code: string, message: string) {
    const r = schema.recordings;
    const [row] = await this.db.read
      .select({
        id: r.id,
        title: schema.classMeetings.title,
        courseCode: schema.courses.code,
      })
      .from(r)
      .innerJoin(schema.classMeetings, eq(schema.classMeetings.id, r.classMeetingId))
      .innerJoin(
        schema.courseOfferings,
        eq(schema.courseOfferings.id, schema.classMeetings.courseOfferingId),
      )
      .innerJoin(schema.courses, eq(schema.courses.id, schema.courseOfferings.courseId))
      .where(eq(r.providerRecordingId, providerRecordingId));
    if (row === undefined) return;
    await this.db.withTx(async (tx) => {
      for (const userId of await this.roles.holders("SYSTEM_ADMIN", tx.db))
        await this.notifications.notify(tx, {
          userId,
          kind: "recording.failed",
          title: `${row.courseCode} recording not uploaded: ${row.title}`,
          data: {
            recordingId: row.id,
            courseCode: row.courseCode,
            title: row.title,
            reason: message.slice(0, 300),
            code,
          },
          email: true,
          dedupeKey: `recording-failed:${row.id}:${code}`,
        });
    });
    this.logger.warn({ recordingId: row.id, code }, "recording failed");
  }
}
