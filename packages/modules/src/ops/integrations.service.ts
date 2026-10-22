import { Db, schema, type Database } from "@glim/db";
import {
  VIDEO_HOST,
  type ChannelCredentials,
  type ChannelInfo,
  type VideoHost,
} from "@glim/integrations/video-host/port";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { openSecret, sealSecret } from "@glim/shared/secrets";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

export type IntegrationProvider = "google_workspace" | "video_host";
export type IntegrationStatus = "UNVERIFIED" | "VERIFIED" | "DEGRADED" | "DISABLED";

export interface IntegrationState {
  status: IntegrationStatus;
  config: Record<string, unknown>;
  verifiedAt: Date | null;
  lastError: string | null;
}

const KIND: Record<IntegrationProvider, string> = {
  google_workspace: "Google Workspace",
  video_host: "YouTube",
};

/**
 * The integrations' settings and health (owner: ops, TRD §6.2, §11.7, §15.3). Holds the YouTube
 * channel's grant, sealed under `TOKEN_ENCRYPTION_KEY` and opened only for the length of a call;
 * marks an integration DEGRADED when Google refuses for good, and tells the System Admins.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(VIDEO_HOST) private readonly videoHost: VideoHost,
  ) {}

  /** Stores the latest result of an integration's test, for its admin page. */
  async recordCheck(provider: string, ok: boolean, result: Record<string, unknown>): Promise<Date> {
    const c = schema.integrationChecks;
    const now = this.clock.now();
    await this.db.withTx(({ db }) =>
      db
        .insert(c)
        .values({ provider, checkedAt: now, ok, result })
        .onConflictDoUpdate({ target: c.provider, set: { checkedAt: now, ok, result } }),
    );
    return now;
  }

  async latestCheck(
    provider: string,
  ): Promise<{ checkedAt: Date; ok: boolean; result: Record<string, unknown> } | null> {
    const c = schema.integrationChecks;
    const [row] = await this.db.read.select().from(c).where(eq(c.provider, provider));
    return row ?? null;
  }

  /** The channel connection as the admin page shows it (never the grant). */
  async youtubeChannel(): Promise<{
    uploadsEnabled: boolean;
    connected: boolean;
    status: IntegrationStatus | null;
    channel: ChannelInfo | null;
    lastError: string | null;
  }> {
    const c = schema.integrationConfigs;
    const [row] = await this.db.read.select().from(c).where(eq(c.provider, "video_host"));
    return {
      uploadsEnabled: this.videoHost.channelApi !== undefined,
      connected: row?.secretCiphertext != null,
      status: (row?.status as IntegrationStatus | undefined) ?? null,
      channel: (row?.config.channel as ChannelInfo | undefined) ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  /** Where to send the System Admin to consent, and the state to check on return. */
  beginYoutubeConnect(redirectUri: string): DomainResult<{ url: string; state: string }> {
    const api = this.videoHost.channelApi;
    if (api === undefined || this.config.tokenEncryptionKey === undefined)
      return err(
        domainError(
          "CONFLICT",
          "Automatic upload isn't switched on (VIDEO_HOST=youtube_api and TOKEN_ENCRYPTION_KEY).",
        ),
      );
    const state = randomBytes(24).toString("base64url");
    return ok({ url: api.authorizationUrl({ redirectUri, state }), state });
  }

  /** Google's code → the channel's grant, sealed and stored. */
  async completeYoutubeConnect(
    code: string,
    redirectUri: string,
    actor: AuditActor,
  ): Promise<DomainResult<ChannelInfo>> {
    const api = this.videoHost.channelApi;
    if (api === undefined)
      return err(domainError("CONFLICT", "Automatic upload isn't switched on."));
    try {
      const { refreshToken, channel } = await api.exchangeCode({ code, redirectUri });
      await this.connectYoutube(refreshToken, channel, actor);
      return ok(channel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ reason: message }, "youtube connect failed");
      return err(domainError("PROVIDER_UNAVAILABLE", message.slice(0, 300)));
    }
  }

  async state(provider: IntegrationProvider): Promise<IntegrationState | null> {
    const c = schema.integrationConfigs;
    const [row] = await this.db.read.select().from(c).where(eq(c.provider, provider));
    return row === undefined
      ? null
      : {
          status: row.status as IntegrationStatus,
          config: row.config,
          verifiedAt: row.verifiedAt,
          lastError: row.lastError,
        };
  }

  /** Writes an integration's non-secret config (merged), keeping its status. */
  async saveConfig(
    db: Database,
    provider: IntegrationProvider,
    config: Record<string, unknown>,
  ): Promise<void> {
    const c = schema.integrationConfigs;
    const now = this.clock.now();
    await db
      .insert(c)
      .values({ provider, config, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: c.provider,
        set: {
          config: sql`${c.config} || ${JSON.stringify(config)}::jsonb`,
          updatedAt: now,
          version: sql`${c.version} + 1`,
        },
      });
  }

  /** A check passed: VERIFIED, error cleared. */
  async markVerified(provider: IntegrationProvider): Promise<void> {
    const c = schema.integrationConfigs;
    const now = this.clock.now();
    await this.db.withTx(async ({ db }) => {
      await this.saveConfig(db, provider, {});
      await db
        .update(c)
        .set({ status: "VERIFIED", verifiedAt: now, lastError: null, updatedAt: now })
        .where(eq(c.provider, provider));
    });
  }

  /**
   * Google refused for good (403, a revoked grant): DEGRADED, with the reason, and the System
   * Admins are told once a day while it lasts (§11.7).
   */
  async markDegraded(
    provider: IntegrationProvider,
    reason: string,
    subject?: string,
  ): Promise<void> {
    const c = schema.integrationConfigs;
    const now = this.clock.now();
    await this.db.withTx(async (tx) => {
      await this.saveConfig(tx.db, provider, {});
      await tx.db
        .update(c)
        .set({ status: "DEGRADED", lastError: reason.slice(0, 500), updatedAt: now })
        .where(eq(c.provider, provider));
      const r = schema.roleAssignments;
      const admins = await tx.db
        .selectDistinct({ userId: r.userId })
        .from(r)
        .innerJoin(schema.users, eq(schema.users.id, r.userId))
        .where(
          and(eq(r.role, "SYSTEM_ADMIN"), isNull(r.revokedAt), eq(schema.users.status, "ACTIVE")),
        );
      for (const { userId } of admins)
        await this.notifications.notify(tx, {
          userId,
          kind: "integration.google-degraded",
          title: `${KIND[provider]} integration needs attention`,
          data: { provider, subject: subject ?? KIND[provider], reason: reason.slice(0, 300) },
          email: true,
          dedupeKey: `integration-degraded:${provider}:${now.toISOString().slice(0, 10)}`,
        });
    });
    this.logger.warn({ provider, subject, reason }, "integration degraded");
  }

  /** The connected YouTube channel and its grant, or null if none is connected. */
  async youtube(): Promise<{ credentials: ChannelCredentials; channel: ChannelInfo } | null> {
    const key = this.config.tokenEncryptionKey;
    if (key === undefined) return null;
    const c = schema.integrationConfigs;
    const [row] = await this.db.read.select().from(c).where(eq(c.provider, "video_host"));
    if (row?.secretCiphertext === null || row === undefined) return null;
    const channel = row.config.channel as ChannelInfo | undefined;
    if (channel === undefined) return null;
    return { credentials: { refreshToken: openSecret(key, row.secretCiphertext) }, channel };
  }

  /** Stores the channel's grant (sealed) after the owner's consent (Appendix A.4 step 5). */
  async connectYoutube(
    refreshToken: string,
    channel: ChannelInfo,
    actor: AuditActor,
  ): Promise<void> {
    const key = this.config.tokenEncryptionKey;
    if (key === undefined) throw new Error("TOKEN_ENCRYPTION_KEY isn't set.");
    const c = schema.integrationConfigs;
    const now = this.clock.now();
    await this.db.withTx(async ({ db }) => {
      await this.saveConfig(db, "video_host", { provider: "youtube_api", channel });
      await db
        .update(c)
        .set({
          secretCiphertext: sealSecret(key, refreshToken),
          status: "VERIFIED",
          verifiedAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(c.provider, "video_host"));
      await this.audit.record(db, actor, {
        action: "ops.integration.youtube-connected",
        resourceType: "integration",
        resourceId: "video_host",
        metadata: { channelId: channel.id, channelTitle: channel.title },
      });
    });
  }

  async disconnectYoutube(actor: AuditActor): Promise<void> {
    const c = schema.integrationConfigs;
    await this.db.withTx(async ({ db }) => {
      await db
        .update(c)
        .set({ secretCiphertext: null, status: "DISABLED", updatedAt: this.clock.now() })
        .where(eq(c.provider, "video_host"));
      await this.audit.record(db, actor, {
        action: "ops.integration.youtube-disconnected",
        resourceType: "integration",
        resourceId: "video_host",
      });
    });
  }
}
