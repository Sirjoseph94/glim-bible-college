import { Db, schema } from "@glim/db";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, type Clock } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

/** SendGrid events that mean an address can't, or mustn't, be emailed again (§15.1). */
const SUPPRESSING: Record<string, "BOUNCED" | "COMPLAINED"> = {
  bounce: "BOUNCED",
  dropped: "BOUNCED",
  spamreport: "COMPLAINED",
};

export type InboxProvider = "google_meet" | "video_host" | "sendgrid";

/** A stored event as a processor sees it. Its payload is the raw message, never changed. */
export interface InboxEvent {
  id: string;
  eventId: string;
  eventType: string;
  subject: string | null;
  payload: unknown;
}

/** What a module does with one of its provider's events; throws to be retried. */
export type InboxProcessor = (event: InboxEvent) => Promise<"PROCESSED" | "IGNORED">;

/**
 * The durable inbox (owner: ops, TRD §5.5): provider events are stored before the provider is
 * answered (or a pulled message acknowledged), each with a `provider-event.process` job in the
 * same transaction (INV-5). Modules register a processor for their provider's events.
 */
@Injectable()
export class InboxService {
  private readonly processors = new Map<InboxProvider, InboxProcessor>();

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** The module that owns a provider's events handles them (Google Meet: class-meeting). */
  registerProcessor(provider: InboxProvider, processor: InboxProcessor): void {
    this.processors.set(provider, processor);
  }

  /**
   * Stores events from a provider in one transaction; one already stored (same provider and
   * event id) is ignored. Returns how many were new. The caller acknowledges the provider only
   * after this returns (§11.8).
   */
  async receive(
    provider: InboxProvider,
    events: {
      eventId: string;
      eventType: string;
      subject: string | null;
      payload: Record<string, unknown>;
    }[],
  ): Promise<number> {
    if (events.length === 0) return 0;
    return this.db.withTx(async ({ db, boss }) => {
      let stored = 0;
      for (const event of events) {
        const now = this.clock.now();
        const [row] = await db
          .insert(schema.providerEvents)
          .values({ provider, ...event, receivedAt: now, createdAt: now })
          .onConflictDoNothing()
          .returning({ id: schema.providerEvents.id });
        if (row === undefined) continue;
        await boss.send("provider-event.process", { providerEventId: row.id });
        stored++;
      }
      return stored;
    });
  }

  /** Stores SendGrid's events (a repeat of one already stored is ignored). */
  async receiveSendgrid(events: Record<string, unknown>[]): Promise<number> {
    return this.db.withTx(async ({ db, boss }) => {
      let stored = 0;
      for (const event of events) {
        const eventId = typeof event.sg_event_id === "string" ? event.sg_event_id : null;
        const eventType = typeof event.event === "string" ? event.event : null;
        if (eventId === null || eventType === null) continue;
        const [row] = await db
          .insert(schema.providerEvents)
          .values({
            provider: "sendgrid",
            eventId,
            eventType,
            subject: typeof event.email === "string" ? event.email.toLowerCase() : null,
            payload: event,
            receivedAt: this.clock.now(),
            createdAt: this.clock.now(),
          })
          .onConflictDoNothing()
          .returning({ id: schema.providerEvents.id });
        if (row === undefined) continue;
        await boss.send("provider-event.process", { providerEventId: row.id });
        stored++;
      }
      return stored;
    });
  }

  /**
   * The `provider-event.process` job. SendGrid: a bounce, drop or spam report suppresses the
   * address; other events are kept and marked IGNORED. Other providers go to their module's
   * processor; a failure is recorded on the row (FAILED, for the ops page) and retried.
   * Processing again changes nothing.
   */
  async process(providerEventId: string): Promise<"PROCESSED" | "IGNORED" | "SKIPPED"> {
    const e = schema.providerEvents;
    const [row] = await this.db.read.select().from(e).where(eq(e.id, providerEventId));
    if (row === undefined || row.status === "PROCESSED" || row.status === "IGNORED")
      return "SKIPPED";
    if (row.provider !== "sendgrid") {
      const processor = this.processors.get(row.provider as InboxProvider);
      let status: "PROCESSED" | "IGNORED" = "IGNORED";
      try {
        if (processor !== undefined) status = await processor(row);
      } catch (error) {
        await this.db.withTx(({ db }) =>
          db
            .update(e)
            .set({
              status: "FAILED",
              attempts: sql`${e.attempts} + 1`,
              lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
            })
            .where(eq(e.id, providerEventId)),
        );
        throw error;
      }
      await this.db.withTx(({ db }) =>
        db
          .update(e)
          .set({
            status,
            processedAt: this.clock.now(),
            attempts: sql`${e.attempts} + 1`,
            lastError: null,
          })
          .where(eq(e.id, providerEventId)),
      );
      return status;
    }
    const outcome = SUPPRESSING[row.eventType];
    if (outcome !== undefined && row.subject !== null)
      await this.notifications.suppressAddress(row.subject, outcome);
    const status = outcome === undefined ? "IGNORED" : "PROCESSED";
    await this.db.withTx(({ db }) =>
      db
        .update(e)
        .set({
          status,
          processedAt: this.clock.now(),
          attempts: sql`${e.attempts} + 1`,
        })
        .where(eq(e.id, providerEventId)),
    );
    return status;
  }
}
