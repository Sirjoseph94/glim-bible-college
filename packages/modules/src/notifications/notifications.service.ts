import { Db, schema, type Database, type TxQueue } from "@glim/db";
import { MAILER, type Mailer } from "@glim/integrations/mail/port";
import { CONFIG, type Config } from "@glim/shared/config";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { TEMPLATES } from "./templates";

export interface NotificationInput {
  userId: string;
  kind: string;
  title: string;
  body?: string;
  /** What the kind's template needs. Never sensitive applicant answers (INV-15). */
  data: Record<string, unknown>;
  /** Also email it (critical kinds, TRD §15.1); the kind must have a template. */
  email: boolean;
  /** Prevents the same notification twice for a user (unique per user). */
  dedupeKey?: string;
}

/**
 * Notifications (owner: notifications, TRD §15.1): an in-app row, and for critical kinds an email
 * sent by the `notify.send` job, enqueued in the caller's transaction (INV-5).
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Records a notification inside the caller's transaction; false if its dedupe key was used. */
  async notify(tx: { db: Database; boss: TxQueue }, input: NotificationInput): Promise<boolean> {
    if (input.email && TEMPLATES[input.kind] === undefined)
      throw new Error(`No email template for notification kind ${input.kind}`);
    const [row] = await tx.db
      .insert(schema.notifications)
      .values({
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        data: input.data,
        emailStatus: input.email ? "PENDING" : "NOT_REQUESTED",
        dedupeKey: input.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.notifications.id });
    if (row === undefined) return false;
    if (input.email) await tx.boss.send("notify.send", { notificationId: row.id });
    return true;
  }

  /**
   * The `notify.send` job: emails a pending notification once. Addresses that bounced or
   * complained, and users who can't sign in any more, are suppressed rather than emailed.
   * A failed send throws, so the queue retries it.
   */
  async deliver(notificationId: string): Promise<"SENT" | "SUPPRESSED" | "SKIPPED"> {
    const n = schema.notifications;
    const u = schema.users;
    const [row] = await this.db.read
      .select({ notification: n, email: u.email, emailStatus: u.emailStatus, status: u.status })
      .from(n)
      .innerJoin(u, eq(u.id, n.userId))
      .where(eq(n.id, notificationId));
    if (row?.notification.emailStatus !== "PENDING") return "SKIPPED";
    const setStatus = (emailStatus: "SENT" | "SUPPRESSED") =>
      this.db.withTx(({ db }) => db.update(n).set({ emailStatus }).where(eq(n.id, notificationId)));
    if (row.emailStatus !== "OK" || row.status !== "ACTIVE") {
      await setStatus("SUPPRESSED");
      return "SUPPRESSED";
    }
    const template = TEMPLATES[row.notification.kind];
    if (template === undefined) throw new Error(`No template for ${row.notification.kind}`);
    const data = row.notification.data;
    const to = typeof data.emailTo === "string" ? data.emailTo : row.email;
    await this.mailer.send({ to, ...template({ data, appOrigin: this.config.appOrigin }) });
    await setStatus("SENT");
    return "SENT";
  }
}
