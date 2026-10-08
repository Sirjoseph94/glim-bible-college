import type { ReviewedApplication } from "@glim/contracts";
import { Db, schema, type Tx } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { PolicyService, SettingsService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import { CLOCK, DAY_MS, domainError, err, type Clock, type DomainResult } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { selectApplications } from "./application-query";
import { ReviewService } from "./review.service";
import { recordTransition } from "./transitions";

type ApplicationRow = typeof schema.applications.$inferSelect;

const JOB: AuditActor & { userId: null } = { userId: null, type: "JOB" };

/**
 * The life of an offer after the decision (TRD §10.3): reminders before it expires, the lapse
 * at expiry (both from the hourly `admissions.offer-sweep`), and an officer reopening a lapsed one.
 */
@Injectable()
export class OffersService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ReviewService) private readonly review: ReviewService,
  ) {}

  /**
   * Lapses offers past their expiry, then sends the most urgent reminder due for each open offer
   * (7 and 2 days before, from the ADMISSIONS policy). Each reminder goes once per offer deadline,
   * so a reopened offer gets its own.
   */
  async sweep(): Promise<{ lapsed: number; reminded: number }> {
    const now = this.clock.now();
    const { config } = await this.policies.current("ADMISSIONS");
    const a = schema.applications;

    const expired = await this.db.read
      .select({ id: a.id })
      .from(a)
      .where(and(eq(a.status, "ADMITTED"), lt(a.offerExpiresAt, now)));
    let lapsed = 0;
    for (const { id } of expired) {
      const done = await this.db.withTx(async (tx) => {
        const [current] = await tx.db.select().from(a).where(eq(a.id, id)).for("update");
        if (current?.status !== "ADMITTED" || current.offerExpiresAt === null) return false;
        if (current.offerExpiresAt >= now) return false;
        const purgeAfter = new Date(now);
        purgeAfter.setUTCMonth(purgeAfter.getUTCMonth() + config.purgeAfterMonths);
        await tx.db
          .update(a)
          .set({ status: "LAPSED", purgeAfter, updatedAt: now, version: sql`${a.version} + 1` })
          .where(eq(a.id, id));
        await recordTransition(tx, this.audit, {
          applicationId: id,
          from: current.status,
          to: "LAPSED",
          actor: JOB,
          now,
        });
        await this.notifyApplicant(tx, current, "admissions.application.lapsed", {
          title: `Your offer has lapsed (${current.referenceNo ?? ""})`,
          dedupeKey: `offer-lapsed:${id}:${current.offerExpiresAt.toISOString()}`,
        });
        return true;
      });
      if (done) lapsed++;
    }

    // Most urgent first: an offer 1 day from expiry gets the 2-day reminder, not the 7-day one.
    const thresholds = [...config.offerReminderDaysBefore].sort((x, y) => x - y);
    const widest = thresholds.at(-1);
    if (widest === undefined) return { lapsed, reminded: 0 };
    const open = await this.db.read
      .select()
      .from(a)
      .where(
        and(
          eq(a.status, "ADMITTED"),
          gt(a.offerExpiresAt, now),
          lt(a.offerExpiresAt, new Date(now.getTime() + widest * DAY_MS + 1)),
        ),
      );
    let reminded = 0;
    for (const offer of open) {
      if (offer.offerExpiresAt === null) continue;
      const left = offer.offerExpiresAt.getTime() - now.getTime();
      const due = thresholds.find((days) => left <= days * DAY_MS);
      if (due === undefined) continue;
      const sent = await this.db.withTx((tx) =>
        this.notifyApplicant(tx, offer, "admissions.offer.reminder", {
          title: `Your offer expires in ${String(due)} day${due === 1 ? "" : "s"}`,
          dedupeKey: `offer-reminder:${offer.id}:${offer.offerExpiresAt?.toISOString() ?? ""}:${String(due)}`,
          extra: { daysLeft: due },
        }),
      );
      if (sent) reminded++;
    }
    return { lapsed, reminded };
  }

  /** Reopens a lapsed offer with a new deadline (spec story 34); the reason is required. */
  async reopen(
    id: string,
    reason: string,
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<ReviewedApplication>> {
    const result = await this.db.withTxResult(async (tx) => {
      const a = schema.applications;
      const [current] = await tx.db.select().from(a).where(eq(a.id, id)).for("update");
      if (current === undefined || current.status === "DRAFT")
        return err(domainError("NOT_FOUND", "Not found."));
      if (current.status !== "LAPSED")
        return err(
          domainError("APPLICATION_STATE_INVALID", "Only a lapsed offer can be reopened."),
        );
      const [intake] = await tx.db
        .select({ days: schema.intakes.offerAcceptanceDays })
        .from(schema.intakes)
        .where(eq(schema.intakes.id, current.intakeId));
      const now = this.clock.now();
      const offerExpiresAt = new Date(now.getTime() + (intake?.days ?? 21) * DAY_MS);
      await tx.db
        .update(a)
        .set({
          status: "ADMITTED",
          offerExpiresAt,
          purgeAfter: null,
          updatedAt: now,
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, id));
      await recordTransition(tx, this.audit, {
        applicationId: id,
        from: current.status,
        to: "ADMITTED",
        actor,
        now,
        verb: "offer-reopened",
        metadata: { reason },
      });
      // The reason is also kept with the application, for staff (notes never reach the applicant).
      await tx.db.insert(schema.applicationEvents).values({
        applicationId: id,
        fromStatus: "ADMITTED",
        toStatus: "ADMITTED",
        actorUserId: actor.userId,
        note: `Offer reopened: ${reason}`,
        createdAt: now,
      });
      await this.notifyApplicant(
        tx,
        { ...current, offerExpiresAt },
        "admissions.application.admitted",
        {
          title: `Your offer has been reopened (${current.referenceNo ?? ""})`,
          dedupeKey: `offer-reopened:${id}:${offerExpiresAt.toISOString()}`,
        },
      );
      return { ok: true as const, value: null };
    });
    if (!result.ok) return result;
    const view = await this.review.get(id, actor.userId);
    return view === null ? err(domainError("NOT_FOUND", "Not found.")) : { ok: true, value: view };
  }

  private async notifyApplicant(
    tx: Tx,
    application: ApplicationRow,
    kind: string,
    options: { title: string; dedupeKey: string; extra?: Record<string, unknown> },
  ): Promise<boolean> {
    const [found] = await selectApplications(eq(schema.applications.id, application.id), tx.db);
    const settings = await this.settings.get(tx.db);
    return this.notifications.notify(tx, {
      userId: application.applicantUserId,
      kind,
      title: options.title,
      data: {
        applicationId: application.id,
        referenceNo: application.referenceNo ?? "",
        name: [application.firstName, application.lastName].filter(Boolean).join(" "),
        programmeName: found?.programme.name ?? "",
        studyMode: application.studyMode === "ON_CAMPUS" ? "on campus" : "online",
        academicSessionName: found?.intake.academicSessionName ?? "",
        timeZone: settings.timezone,
        ...(application.offerExpiresAt === null
          ? {}
          : { offerExpiresAt: application.offerExpiresAt.toISOString() }),
        ...(application.email === null ? {} : { emailTo: application.email }),
        ...options.extra,
      },
      email: true,
      dedupeKey: options.dedupeKey,
    });
  }
}
