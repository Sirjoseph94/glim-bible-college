import {
  CRITICAL_KINDS,
  NOTIFICATION_KINDS,
  QUIET_HOURS,
  type Notification,
  type NotificationPreference,
} from "@glim/contracts";
import { Db, schema, type Database, type TxQueue } from "@glim/db";
import { MAILER, type Mailer } from "@glim/integrations/mail/port";
import { CLOCK, type Clock } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { isValidTimeZone, zonedToInstant, toLocalDate } from "@glim/shared/time";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { digestEmail, TEMPLATES } from "./templates";

/** The most items listed in one digest email; the rest are counted. */
const DIGEST_LIMIT = 20;

/** The hour (0–23) it is now in a time zone. */
function hourIn(now: Date, zone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
  })
    .formatToParts(now)
    .find((p) => p.type === "hour")?.value;
  return Number(hour ?? "0");
}

/** Whether it's quiet hours (21:00–06:00) for someone in this zone (§15.1). */
export function inQuietHours(now: Date, zone: string): boolean {
  const hour = hourIn(now, zone);
  return hour >= QUIET_HOURS.from || hour < QUIET_HOURS.to;
}

/** The next 06:00 in a zone after `now`. */
export function nextMorning(now: Date, zone: string): Date {
  const today = toLocalDate(now, zone);
  const at = new Date(zonedToInstant(today, "06:00", zone));
  if (at > now) return at;
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return new Date(zonedToInstant(tomorrow.toISOString().slice(0, 10), "06:00", zone));
}

/** Where in the app a notification points, from its kind and data. */
function linkFor(kind: string, data: Record<string, unknown>): string | null {
  if (kind.startsWith("transcript.")) return "/transcripts";
  if (kind.startsWith("results.")) return "/results";
  if (kind === "assessment.grade-released" || kind === "content.announcement") return "/courses";
  if (kind === "meeting.provision-failed") return "/admin/ops";
  if (kind.startsWith("integration.")) return "/admin/integrations";
  if (kind.startsWith("recording.")) return "/admin/videos";
  if (kind.startsWith("meeting.")) return "/";
  if (kind.startsWith("video.")) return "/admin/videos";
  if (kind.startsWith("admissions.")) return "/application";
  return typeof data.link === "string" && data.link.startsWith("/") ? data.link : null;
}

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
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Records a notification inside the caller's transaction; false if its dedupe key was used. */
  async notify(tx: { db: Database; boss: TxQueue }, input: NotificationInput): Promise<boolean> {
    if (input.email && TEMPLATES[input.kind] === undefined)
      throw new Error(`No email template for notification kind ${input.kind}`);
    // Critical kinds are emailed at once, always. Everything else waits for the daily digest,
    // unless the person turned email off for that kind (§15.1).
    const critical = input.email && CRITICAL_KINDS.has(input.kind);
    let emailStatus: "PENDING" | "DIGEST" | "NOT_REQUESTED" = critical ? "PENDING" : "DIGEST";
    if (!critical) {
      const p = schema.notificationPreferences;
      const [pref] = await tx.db
        .select({ email: p.email })
        .from(p)
        .where(and(eq(p.userId, input.userId), eq(p.kind, input.kind)));
      if (pref?.email === false) emailStatus = "NOT_REQUESTED";
    }
    const [row] = await tx.db
      .insert(schema.notifications)
      .values({
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        data: input.data,
        emailStatus,
        dedupeKey: input.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.notifications.id });
    if (row === undefined) return false;
    if (emailStatus === "PENDING") await tx.boss.send("notify.send", { notificationId: row.id });
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
      .select({
        notification: n,
        email: u.email,
        emailStatus: u.emailStatus,
        status: u.status,
        timezone: u.timezone,
      })
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
    // Times are written in the recipient's own zone, with the institution's alongside.
    const institutionZone = await this.institutionZone();
    const data: Record<string, unknown> = {
      ...row.notification.data,
      timeZone:
        row.timezone !== null && isValidTimeZone(row.timezone) ? row.timezone : institutionZone,
      institutionZone,
    };
    const to = typeof data.emailTo === "string" ? data.emailTo : row.email;
    await this.mailer.send({ to, ...template({ data, appOrigin: this.config.appOrigin }) });
    await setStatus("SENT");
    return "SENT";
  }

  /**
   * The `notify.digest` job. Without a user (the 06:00 Lagos cron) it fans out: each person with
   * something waiting gets their digest now, or at their own 06:00 if it's quiet hours where they
   * are. With a user it sends that person's digest: the unread non-critical notifications since
   * the last one, in one email.
   */
  async digest(userId?: string): Promise<number> {
    const n = schema.notifications;
    if (userId === undefined) {
      const waiting = await this.db.read
        .selectDistinct({ userId: n.userId, timezone: schema.users.timezone })
        .from(n)
        .innerJoin(schema.users, eq(schema.users.id, n.userId))
        .where(eq(n.emailStatus, "DIGEST"));
      const now = this.clock.now();
      const institutionZone = await this.institutionZone();
      await this.db.withTx(async ({ boss }) => {
        for (const w of waiting) {
          const zone =
            w.timezone !== null && isValidTimeZone(w.timezone) ? w.timezone : institutionZone;
          const startAfter = inQuietHours(now, zone)
            ? Math.ceil((nextMorning(now, zone).getTime() - now.getTime()) / 1000)
            : 0;
          await boss.send(
            "notify.digest",
            { userId: w.userId },
            startAfter > 0 ? { startAfter } : {},
          );
        }
      });
      return waiting.length;
    }
    return this.digestFor(userId);
  }

  private async digestFor(userId: string): Promise<number> {
    const n = schema.notifications;
    const u = schema.users;
    const [user] = await this.db.read
      .select({
        email: u.email,
        emailStatus: u.emailStatus,
        status: u.status,
        timezone: u.timezone,
      })
      .from(u)
      .where(eq(u.id, userId));
    if (user === undefined) return 0;
    const rows = await this.db.read
      .select()
      .from(n)
      .where(and(eq(n.userId, userId), eq(n.emailStatus, "DIGEST")))
      .orderBy(desc(n.createdAt));
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    const mark = (emailStatus: "SENT" | "SUPPRESSED" | "NOT_REQUESTED", which: string[]) =>
      which.length === 0
        ? Promise.resolve()
        : this.db
            .withTx(({ db }) =>
              db
                .update(n)
                .set({ emailStatus })
                .where(and(inArray(n.id, which), eq(n.emailStatus, "DIGEST"))),
            )
            .then(() => undefined);
    if (user.emailStatus !== "OK" || user.status !== "ACTIVE") {
      await mark("SUPPRESSED", ids);
      return 0;
    }
    const zone =
      user.timezone !== null && isValidTimeZone(user.timezone)
        ? user.timezone
        : await this.institutionZone();
    // A retry that lands in quiet hours waits for the morning (§15.1).
    if (inQuietHours(this.clock.now(), zone)) return 0;
    const unread = rows.filter((r) => r.readAt === null);
    // Already seen in the app: nothing to email about.
    await mark(
      "NOT_REQUESTED",
      rows.filter((r) => r.readAt !== null).map((r) => r.id),
    );
    if (unread.length === 0) return 0;
    await this.mailer.send({
      to: user.email,
      ...digestEmail({
        items: unread.slice(0, DIGEST_LIMIT).map((r) => r.title),
        more: Math.max(0, unread.length - DIGEST_LIMIT),
        appOrigin: this.config.appOrigin,
      }),
    });
    await mark(
      "SENT",
      unread.map((r) => r.id),
    );
    return unread.length;
  }

  /** The caller's notifications, newest first, without kinds they turned off in-app. */
  async list(
    userId: string,
    before: string | undefined,
    limit: number,
  ): Promise<{ items: Notification[]; unread: number; nextBefore: string | null }> {
    const n = schema.notifications;
    const p = schema.notificationPreferences;
    const hidden = sql`NOT EXISTS (SELECT 1 FROM ${p} WHERE ${p.userId} = ${n.userId} AND ${p.kind} = ${n.kind} AND ${p.inApp} = false)`;
    const rows = await this.db.read
      .select()
      .from(n)
      .where(and(eq(n.userId, userId), hidden, before === undefined ? undefined : lt(n.id, before)))
      .orderBy(desc(n.id))
      .limit(limit + 1);
    const [counted] = await this.db.read
      .select({ unread: sql<number>`count(*)::int` })
      .from(n)
      .where(and(eq(n.userId, userId), isNull(n.readAt), hidden));
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        link: linkFor(r.kind, r.data),
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      unread: counted?.unread ?? 0,
      nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Marks one of the caller's notifications read; another person's is left alone. */
  async markRead(userId: string, id: string): Promise<void> {
    const n = schema.notifications;
    await this.db.withTx(({ db }) =>
      db
        .update(n)
        .set({ readAt: this.clock.now() })
        .where(and(eq(n.id, id), eq(n.userId, userId), isNull(n.readAt))),
    );
  }

  async markAllRead(userId: string): Promise<number> {
    const n = schema.notifications;
    const rows = await this.db.withTx(({ db }) =>
      db
        .update(n)
        .set({ readAt: this.clock.now() })
        .where(and(eq(n.userId, userId), isNull(n.readAt)))
        .returning({ id: n.id }),
    );
    return rows.length;
  }

  async preferences(userId: string): Promise<NotificationPreference[]> {
    const p = schema.notificationPreferences;
    const rows = await this.db.read.select().from(p).where(eq(p.userId, userId));
    return NOTIFICATION_KINDS.map((k) => {
      const row = rows.find((r) => r.kind === k.kind);
      return {
        kind: k.kind,
        label: k.label,
        critical: k.critical,
        inApp: row?.inApp ?? true,
        // Critical kinds are always emailed.
        email: k.critical ? true : (row?.email ?? true),
      };
    });
  }

  async setPreference(
    userId: string,
    kind: string,
    choice: { inApp: boolean; email: boolean },
  ): Promise<NotificationPreference | null> {
    const known = NOTIFICATION_KINDS.find((k) => k.kind === kind);
    if (known === undefined) return null;
    const p = schema.notificationPreferences;
    const now = this.clock.now();
    const email = known.critical ? true : choice.email;
    await this.db.withTx(({ db }) =>
      db
        .insert(p)
        .values({ userId, kind, inApp: choice.inApp, email, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [p.userId, p.kind],
          set: { inApp: choice.inApp, email, updatedAt: now, version: sql`${p.version} + 1` },
        }),
    );
    return (await this.preferences(userId)).find((x) => x.kind === kind) ?? null;
  }

  private async institutionZone(): Promise<string> {
    const [settings] = await this.db.read
      .select({ timezone: schema.settings.timezone })
      .from(schema.settings)
      .limit(1);
    return settings?.timezone ?? "Africa/Lagos";
  }

  /**
   * Stops emailing an address SendGrid bounced, dropped or got a spam report for (§15.1): its
   * user's `email_status` is set, and waiting emails to them are recorded as SUPPRESSED.
   */
  async suppressAddress(email: string, status: "BOUNCED" | "COMPLAINED"): Promise<number> {
    const u = schema.users;
    const n = schema.notifications;
    return this.db.withTx(async ({ db }) => {
      const users = await db
        .update(u)
        .set({ emailStatus: status, updatedAt: this.clock.now() })
        .where(sql`lower(${u.email}) = ${email.toLowerCase()}`)
        .returning({ id: u.id });
      for (const user of users)
        await db
          .update(n)
          .set({ emailStatus: "SUPPRESSED" })
          .where(and(eq(n.userId, user.id), inArray(n.emailStatus, ["PENDING", "DIGEST"])));
      return users.length;
    });
  }

  /** Deletes the notifications about an application (its purge, §10.5). */
  async forgetApplication(db: Database, applicationId: string): Promise<number> {
    const n = schema.notifications;
    const rows = await db
      .delete(n)
      .where(sql`${n.data}->>'applicationId' = ${applicationId}`)
      .returning({ id: n.id });
    return rows.length;
  }
}
