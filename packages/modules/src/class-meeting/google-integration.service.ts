import type { GoogleIntegration, HostAccount } from "@glim/contracts";
import { Db, PG, pgError, schema } from "@glim/db";
import { LIVE_PROVIDER, type LiveProvider } from "@glim/integrations/live-provider/port";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { RoleService } from "@glim/modules/authorization";
import { NotificationsService } from "@glim/modules/notifications";
import { IntegrationsService } from "@glim/modules/ops";
import { CLOCK, domainError, err, ok, type Clock, type DomainResult } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { SubscriptionsService, type SubscriptionSweep } from "./subscriptions.service";

type HostRow = typeof schema.providerHostAccounts.$inferSelect;
type Check = NonNullable<GoogleIntegration["lastCheck"]>;

/** Drive storage alerts (§11.2). */
const STORAGE_WARN = 0.7;
const STORAGE_ALARM = 0.85;

/**
 * The System Admin's Google Meet integration (owner: class-meeting, TRD §11.2, §15.3, Appendix
 * A.2): the values to paste into the Admin Console, the host accounts, the background test
 * (tokens, delegated scopes, Drive storage, subscriptions) and the hourly storage watch. Google
 * is only ever called from the worker.
 */
@Injectable()
export class GoogleIntegrationService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(LIVE_PROVIDER) private readonly provider: LiveProvider | null,
    @Inject(IntegrationsService) private readonly integrations: IntegrationsService,
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RoleService) private readonly roles: RoleService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async view(): Promise<GoogleIntegration> {
    const state = await this.integrations.state("google_workspace");
    const check = await this.integrations.latestCheck("google_workspace");
    const sa = this.config.google.serviceAccount;
    return {
      mode: this.config.liveProvider,
      status: state?.status ?? null,
      lastError: state?.lastError ?? null,
      verifiedAt: state?.verifiedAt?.toISOString() ?? null,
      primaryDomain:
        typeof state?.config.primaryDomain === "string" ? state.config.primaryDomain : null,
      serviceAccount:
        sa === undefined ? null : { clientEmail: sa.clientEmail, clientId: sa.clientId },
      delegationScopes: [...(this.provider?.requiredPermissions ?? [])],
      pubsubSubscription: this.config.google.pubsubSubscription ?? null,
      pubsubTopic: this.config.google.pubsubTopic ?? null,
      hostAccounts: await this.hosts(),
      lastCheck:
        check === null
          ? null
          : ({
              ...(check.result as Omit<Check, "checkedAt" | "ok">),
              checkedAt: check.checkedAt.toISOString(),
              ok: check.ok,
            } satisfies Check),
    };
  }

  async save(
    input: { primaryDomain: string | null },
    actor: AuditActor,
  ): Promise<GoogleIntegration> {
    await this.db.withTx(async ({ db }) => {
      await this.integrations.saveConfig(db, "google_workspace", {
        primaryDomain: input.primaryDomain?.toLowerCase() ?? null,
      });
      await this.audit.record(db, actor, {
        action: "ops.integration.google-saved",
        resourceType: "integration",
        resourceId: "google_workspace",
        metadata: { primaryDomain: input.primaryDomain },
      });
    });
    return this.view();
  }

  async addHost(
    input: { email: string; providerUserId: string | null; weight: number },
    actor: AuditActor,
  ): Promise<DomainResult<HostAccount>> {
    const h = schema.providerHostAccounts;
    const domain = (await this.integrations.state("google_workspace"))?.config.primaryDomain;
    const email = input.email.toLowerCase();
    if (typeof domain === "string" && !email.endsWith(`@${domain}`))
      return err(
        domainError("VALIDATION_FAILED", `Host accounts are Workspace accounts on ${domain}.`, {
          fieldErrors: [
            { path: "body.email", code: "invalid", message: `Not an @${domain} account.` },
          ],
        }),
      );
    try {
      const id = await this.db.withTx(async ({ db }) => {
        const now = this.clock.now();
        const [row] = await db
          .insert(h)
          .values({
            email,
            providerUserId: input.providerUserId,
            weight: input.weight,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: h.id });
        if (row === undefined) throw new Error("host insert returned nothing");
        await this.audit.record(db, actor, {
          action: "ops.integration.host-added",
          resourceType: "host-account",
          resourceId: row.id,
          metadata: { email },
        });
        return row.id;
      });
      return ok(await this.host(id));
    } catch (error) {
      if (pgError(error)?.code === PG.UNIQUE_VIOLATION)
        return err(domainError("CONFLICT", "That account is already a host account."));
      throw error;
    }
  }

  async updateHost(
    id: string,
    change: {
      providerUserId?: string | null | undefined;
      weight?: number | undefined;
      status?: "ACTIVE" | "DISABLED" | undefined;
    },
    actor: AuditActor,
  ): Promise<DomainResult<HostAccount>> {
    const h = schema.providerHostAccounts;
    const updated = await this.db.withTx(async ({ db }) => {
      const now = this.clock.now();
      const [row] = await db
        .update(h)
        .set({
          ...(change.providerUserId === undefined ? {} : { providerUserId: change.providerUserId }),
          ...(change.weight === undefined ? {} : { weight: change.weight }),
          ...(change.status === undefined ? {} : { status: change.status }),
          updatedAt: now,
          version: sql`${h.version} + 1`,
        })
        .where(eq(h.id, id))
        .returning({ id: h.id });
      if (row === undefined) return false;
      await this.audit.record(db, actor, {
        action: "ops.integration.host-updated",
        resourceType: "host-account",
        resourceId: id,
        metadata: { fields: Object.keys(change) },
      });
      return true;
    });
    return updated ? ok(await this.host(id)) : err(domainError("NOT_FOUND", "Not found."));
  }

  /** "Test Google": queued; the result appears on the page when the worker has run it. */
  async requestCheck(actor: AuditActor): Promise<DomainResult<null>> {
    if (this.provider === null)
      return err(domainError("CONFLICT", "Google Meet isn't switched on (LIVE_PROVIDER=none)."));
    await this.db.withTx(async ({ db, boss }) => {
      await boss.send("ops.google-check", {});
      await this.audit.record(db, actor, {
        action: "ops.google-check.requested",
        resourceType: "integration",
        resourceId: "google_workspace",
      });
    });
    return ok(null);
  }

  /**
   * The `ops.google-check` job (§15.3): per ACTIVE host account, a token and a cheap read, the
   * delegated scopes granted, and Drive storage; then subscriptions are made or renewed. All
   * well ⇒ VERIFIED; a refusal ⇒ DEGRADED with the reason.
   */
  async runCheck(): Promise<Check | "SKIPPED"> {
    const provider = this.provider;
    if (provider === null) return "SKIPPED";
    const h = schema.providerHostAccounts;
    const hosts = await this.db.read
      .select()
      .from(h)
      .where(eq(h.status, "ACTIVE"))
      .orderBy(asc(h.email));
    const results: Check["hosts"] = [];
    for (const host of hosts) {
      const health = await provider.health(host.email);
      let permissions: Check["hosts"][number]["permissions"] = [];
      let storage: Check["hosts"][number]["storage"] = null;
      let detail = health.detail;
      try {
        permissions = await provider.checkPermissions(host.email);
        if (health.ok) storage = await provider.storageUsage(host.email);
      } catch (error) {
        detail ??= error instanceof Error ? error.message : String(error);
      }
      const missing = permissions.filter((p) => !p.granted).map((p) => p.permission);
      if (missing.length > 0) detail ??= `Not granted: ${missing.join(", ")}`;
      results.push({
        email: host.email,
        ok: health.ok && missing.length === 0 && detail === null,
        detail,
        permissions,
        storage,
      });
    }
    let subscriptions: SubscriptionSweep = { created: 0, renewed: 0, failed: 0, missingUserId: [] };
    try {
      subscriptions = await this.subscriptions.run();
    } catch (error) {
      this.logger.warn({ err: error }, "subscription sweep failed during the Google check");
    }
    const problems = [
      ...(hosts.length === 0 ? ["Add at least one host account."] : []),
      ...results.filter((r) => !r.ok).map((r) => `${r.email}: ${r.detail ?? "failed"}`),
      ...(subscriptions.failed > 0
        ? [`${String(subscriptions.failed)} event subscription(s) failed.`]
        : []),
      ...(subscriptions.missingUserId.length > 0
        ? [
            `Set the Google user id of ${subscriptions.missingUserId.join(", ")} for event subscriptions.`,
          ]
        : []),
    ];
    const okNow = problems.length === 0;
    const detail = okNow ? null : problems.join(" ");
    const result = { detail, hosts: results, subscriptions };
    const checkedAt = await this.integrations.recordCheck("google_workspace", okNow, result);
    if (okNow) await this.integrations.markVerified("google_workspace");
    else await this.integrations.markDegraded("google_workspace", detail ?? "The check failed.");
    return { checkedAt: checkedAt.toISOString(), ok: okNow, ...result };
  }

  /**
   * The `drive.storage-monitor` job (hourly, §11.2): each host account's Drive use; the System
   * Admins hear at 70 % (weekly) and at 85 % (daily) while it lasts.
   */
  async monitorStorage(): Promise<Record<string, number>> {
    const provider = this.provider;
    if (provider === null) return {};
    const h = schema.providerHostAccounts;
    const hosts = await this.db.read.select().from(h).where(eq(h.status, "ACTIVE"));
    const usage: Record<string, number> = {};
    for (const host of hosts) {
      try {
        const { usedBytes, limitBytes } = await provider.storageUsage(host.email);
        if (limitBytes === null || limitBytes <= 0) continue;
        const share = usedBytes / limitBytes;
        usage[host.email] = Math.round(share * 1000) / 10;
        if (share >= STORAGE_WARN) await this.alertStorage(host, share);
      } catch (error) {
        this.logger.warn({ err: error, hostAccountId: host.id }, "storage check failed");
      }
    }
    return usage;
  }

  private async alertStorage(host: HostRow, share: number): Promise<void> {
    const now = this.clock.now();
    const alarm = share >= STORAGE_ALARM;
    // Daily at 85 %, weekly at 70 %.
    const period = alarm
      ? now.toISOString().slice(0, 10)
      : `${String(now.getUTCFullYear())}-w${String(Math.floor(now.getTime() / (7 * 86_400_000)))}`;
    const percent = String(Math.floor(share * 100));
    await this.db.withTx(async (tx) => {
      for (const userId of await this.roles.holders("SYSTEM_ADMIN", tx.db))
        await this.notifications.notify(tx, {
          userId,
          kind: "integration.drive-storage",
          title: `Recording storage ${percent}% full on ${host.email}`,
          data: { hostEmail: host.email, percent },
          email: true,
          dedupeKey: `drive-storage:${host.id}:${alarm ? "85" : "70"}:${period}`,
        });
    });
  }

  private async hosts(): Promise<HostAccount[]> {
    const h = schema.providerHostAccounts;
    const s = schema.providerSubscriptions;
    const rows = await this.db.read
      .select({
        host: h,
        sub: { status: s.status, expiresAt: s.expiresAt, lastError: s.lastError },
      })
      .from(h)
      .leftJoin(s, eq(s.hostAccountId, h.id))
      .orderBy(asc(h.email));
    const circuits = this.provider?.circuitStates() ?? {};
    return rows.map(({ host, sub }) => ({
      id: host.id,
      email: host.email,
      providerUserId: host.providerUserId,
      status: host.status as HostAccount["status"],
      weight: host.weight,
      subscription:
        sub?.status == null
          ? null
          : {
              status: sub.status as NonNullable<HostAccount["subscription"]>["status"],
              expiresAt: sub.expiresAt?.toISOString() ?? null,
              lastError: sub.lastError,
            },
      circuit: circuits[host.email] ?? "CLOSED",
    }));
  }

  private async host(id: string): Promise<HostAccount> {
    const found = (await this.hosts()).find((x) => x.id === id);
    if (found === undefined) throw new Error("host account vanished");
    return found;
  }
}
