import { Db, schema } from "@glim/db";
import {
  LIVE_PROVIDER,
  ProviderNotFoundError,
  type LiveProvider,
} from "@glim/integrations/live-provider/port";
import { CLOCK, type Clock } from "@glim/shared";
import { LOGGER, type Logger } from "@glim/telemetry";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";

const HOUR = 3_600_000;

type SubscriptionRow = typeof schema.providerSubscriptions.$inferSelect;
type HostRow = typeof schema.providerHostAccounts.$inferSelect;

export interface SubscriptionSweep {
  created: number;
  renewed: number;
  failed: number;
  /** Host accounts that can't be subscribed until their user id is set. */
  missingUserId: string[];
}

/**
 * Workspace Events subscriptions (owner: class-meeting, TRD §11.8, S-04): one per ACTIVE host
 * account, renewed before `expires_at − max(24 h, half its lifetime)`; an expired or suspended
 * one is created again. Reconciliation keeps attendance right even while events are missing.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(LIVE_PROVIDER) private readonly provider: LiveProvider | null,
  ) {}

  /**
   * The `subscription.renew` job: one subscription (a lifecycle event named it), or the sweep
   * (every 15 minutes) that creates missing subscriptions and renews those falling due.
   */
  async run(remoteName?: string): Promise<SubscriptionSweep> {
    const sweep: SubscriptionSweep = { created: 0, renewed: 0, failed: 0, missingUserId: [] };
    if (this.provider === null) return sweep;
    const s = schema.providerSubscriptions;
    const h = schema.providerHostAccounts;
    const hosts = await this.db.read
      .select()
      .from(h)
      .where(and(eq(h.provider, "google_meet"), eq(h.status, "ACTIVE")));
    const subs = await this.db.read.select().from(s);
    const now = this.clock.now();

    for (const host of hosts) {
      if (host.providerUserId === null) {
        sweep.missingUserId.push(host.email);
        continue;
      }
      const sub = subs.find((x) => x.hostAccountId === host.id);
      const named = remoteName !== undefined && sub?.remoteName === remoteName;
      if (remoteName !== undefined && !named) continue;
      try {
        if (sub === undefined || ["EXPIRED", "SUSPENDED", "ERROR"].includes(sub.status)) {
          await this.create(host, sub);
          sweep.created++;
        } else if (named || this.due(sub, now)) {
          await this.renew(host, sub);
          sweep.renewed++;
        }
      } catch (error) {
        sweep.failed++;
        await this.markError(host, sub, error);
      }
    }
    if (sweep.created + sweep.renewed + sweep.failed > 0)
      this.logger.info({ ...sweep }, "subscription sweep");
    return sweep;
  }

  /** Renew before `expires_at − max(24 h, 50 % of the lifetime)` (§11.8). */
  private due(sub: SubscriptionRow, now: Date): boolean {
    if (sub.expiresAt === null) return true;
    const from = (sub.lastRenewedAt ?? sub.createdAt).getTime();
    const lifetime = sub.expiresAt.getTime() - from;
    const margin = Math.max(24 * HOUR, lifetime / 2);
    return now.getTime() >= sub.expiresAt.getTime() - margin;
  }

  private async create(host: HostRow, existing: SubscriptionRow | undefined): Promise<void> {
    const created = await (this.provider as LiveProvider).subscribe({
      email: host.email,
      userId: host.providerUserId ?? "",
    });
    const now = this.clock.now();
    const s = schema.providerSubscriptions;
    const values = {
      eventTypes: created.eventTypes,
      remoteName: created.remoteName,
      expiresAt: created.expiresAt,
      status: "ACTIVE",
      lastRenewedAt: now,
      lastError: null,
      updatedAt: now,
    };
    await this.db.withTx(async ({ db }) => {
      if (existing === undefined)
        await db.insert(s).values({
          hostAccountId: host.id,
          targetResource: `users/${host.providerUserId ?? ""}`,
          createdAt: now,
          ...values,
        });
      else
        await db
          .update(s)
          .set({ ...values, version: sql`${s.version} + 1` })
          .where(eq(s.id, existing.id));
    });
  }

  private async renew(host: HostRow, sub: SubscriptionRow): Promise<void> {
    try {
      const renewed = await (this.provider as LiveProvider).renewSubscription(
        host.email,
        sub.remoteName ?? "",
      );
      const now = this.clock.now();
      const s = schema.providerSubscriptions;
      await this.db.withTx(({ db }) =>
        db
          .update(s)
          .set({
            expiresAt: renewed.expiresAt,
            status: "ACTIVE",
            lastRenewedAt: now,
            lastError: null,
            updatedAt: now,
            version: sql`${s.version} + 1`,
          })
          .where(eq(s.id, sub.id)),
      );
    } catch (error) {
      // Gone at Google: make a new one.
      if (error instanceof ProviderNotFoundError) await this.create(host, sub);
      else throw error;
    }
  }

  private async markError(
    host: HostRow,
    sub: SubscriptionRow | undefined,
    error: unknown,
  ): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    this.logger.warn({ err: error, hostAccountId: host.id }, "subscription failed");
    const s = schema.providerSubscriptions;
    const now = this.clock.now();
    // Recorded even when the first attempt failed, so the ops page shows it (§6.7).
    if (sub === undefined) {
      await this.db.withTx(({ db }) =>
        db
          .insert(s)
          .values({
            hostAccountId: host.id,
            targetResource: `users/${host.providerUserId ?? host.id}`,
            eventTypes: [],
            status: "ERROR",
            lastError: message,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing(),
      );
      return;
    }
    await this.db.withTx(({ db }) =>
      db
        .update(s)
        .set({ status: "ERROR", lastError: message, updatedAt: now })
        .where(and(eq(s.id, sub.id), inArray(s.status, ["ACTIVE", "EXPIRING", "ERROR"]))),
    );
  }
}
