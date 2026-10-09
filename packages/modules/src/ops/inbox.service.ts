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

/**
 * The durable inbox (owner: ops, TRD §5.5): provider events are stored before the provider is
 * answered, each with a `provider-event.process` job in the same transaction (INV-5).
 */
@Injectable()
export class InboxService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

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
   * The `provider-event.process` job: a bounce, drop or spam report suppresses the address; other
   * events are kept and marked IGNORED. Processing again changes nothing.
   */
  async process(providerEventId: string): Promise<"PROCESSED" | "IGNORED" | "SKIPPED"> {
    const e = schema.providerEvents;
    const [row] = await this.db.read.select().from(e).where(eq(e.id, providerEventId));
    if (row === undefined || row.status === "PROCESSED" || row.status === "IGNORED")
      return "SKIPPED";
    const outcome = SUPPRESSING[row.eventType];
    if (row.provider === "sendgrid" && outcome !== undefined && row.subject !== null)
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
