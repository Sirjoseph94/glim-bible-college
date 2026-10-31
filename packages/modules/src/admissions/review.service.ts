import type {
  ApplicationQueueItem,
  ApplicationStatus,
  ReviewedApplication,
  StudyMode,
} from "@glim/contracts";
import { Db, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { AuthorizationService } from "@glim/modules/authorization";
import { PolicyService, SettingsService } from "@glim/modules/identity";
import { StudentsService } from "@glim/modules/enrollment";
import { NotificationsService } from "@glim/modules/notifications";
import {
  CLOCK,
  DAY_MS,
  decodeCursor,
  domainError,
  err,
  ok,
  toPage,
  type Clock,
  type DomainResult,
  type Page,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { formAnswers, missingFields, offerAndEnrollment } from "./application-form";
import { selectApplications } from "./application-query";
import { recordTransition } from "./transitions";

type Actor = AuditActor & { userId: string };

const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const MODE_LABEL: Record<string, string> = { ON_CAMPUS: "on campus", ONLINE: "online" };

/**
 * The Admissions Officers' side (owner: admissions, TRD §10.3): the queue, the full application
 * (section 5 only with `read-sensitive`, INV-15), review, internal notes, and the decision.
 * Drafts stay private to the applicant until submitted.
 */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(StudentsService) private readonly students: StudentsService,
  ) {}

  /** Submitted applications, oldest first (rolling review), filtered and searchable. */
  async queue(filter: {
    intakeId?: string | undefined;
    status?: string | undefined;
    programmeId?: string | undefined;
    studyMode?: StudyMode | undefined;
    q?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  }): Promise<Page<ApplicationQueueItem>> {
    const a = schema.applications;
    const conditions: SQL[] = [ne(a.status, "DRAFT")];
    if (filter.intakeId !== undefined) conditions.push(eq(a.intakeId, filter.intakeId));
    if (filter.status !== undefined) conditions.push(eq(a.status, filter.status));
    if (filter.programmeId !== undefined) conditions.push(eq(a.programmeId, filter.programmeId));
    if (filter.studyMode !== undefined) conditions.push(eq(a.studyMode, filter.studyMode));
    if (filter.q !== undefined) {
      const pattern = `%${filter.q.replaceAll(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const match = or(
        ilike(sql`concat_ws(' ', ${a.firstName}, ${a.middleName}, ${a.lastName})`, pattern),
        ilike(sql`concat_ws(' ', ${a.firstName}, ${a.lastName})`, pattern),
        ilike(a.referenceNo, pattern),
      );
      if (match) conditions.push(match);
    }
    if (filter.cursor !== undefined) {
      const at = decodeCursor(filter.cursor);
      const after = or(
        gt(a.submittedAt, new Date(at.sortKey)),
        and(eq(a.submittedAt, new Date(at.sortKey)), gt(a.id, at.id)),
      );
      if (after) conditions.push(after);
    }
    const rows = await selectApplications(and(...conditions), this.db.read, [
      asc(a.submittedAt),
      asc(a.id),
    ]).limit(filter.limit + 1);
    const items = rows.map(({ application: r, intake, programme }) => ({
      id: r.id,
      referenceNo: r.referenceNo ?? "",
      name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "),
      intakeCode: intake.code,
      programme: { id: programme.id, code: programme.code, name: programme.name },
      studyMode: r.studyMode as StudyMode,
      status: r.status as ApplicationStatus,
      submittedAt: (r.submittedAt ?? r.updatedAt).toISOString(),
      unmatchedReferral: r.referralCodeEntered !== null && r.referrerUserId === null,
    }));
    return toPage(items, filter.limit, (item) => item.submittedAt);
  }

  /** The whole application for staff; null for drafts and unknown ids. */
  async get(id: string, viewerUserId: string): Promise<ReviewedApplication | null> {
    const found = await this.view(this.db.read, id, await this.mayReadSensitive(viewerUserId));
    return found.ok ? found.value : null;
  }

  /** Opening a submitted application marks it Under Review (spec story 31). */
  async startReview(id: string, actor: Actor): Promise<DomainResult<ReviewedApplication>> {
    const sensitive = await this.mayReadSensitive(actor.userId);
    return this.db.withTxResult(async (tx) => {
      const a = schema.applications;
      const [current] = await tx.db.select().from(a).where(eq(a.id, id)).for("update");
      if (current === undefined || current.status === "DRAFT") return notFound();
      if (current.status === "SUBMITTED") {
        const now = this.clock.now();
        await tx.db
          .update(a)
          .set({
            status: "UNDER_REVIEW",
            reviewStartedAt: now,
            reviewedBy: actor.userId,
            updatedAt: now,
            version: sql`${a.version} + 1`,
          })
          .where(eq(a.id, id));
        await recordTransition(tx, this.audit, {
          applicationId: id,
          from: current.status,
          to: "UNDER_REVIEW",
          actor,
          now,
        });
      }
      return this.view(tx.db, id, sensitive);
    });
  }

  /** An internal note (e.g. from an interview). Never shown or sent to the applicant. */
  async addNote(
    id: string,
    note: string,
    actor: Actor,
  ): Promise<DomainResult<ReviewedApplication>> {
    const sensitive = await this.mayReadSensitive(actor.userId);
    return this.db.withTxResult(async ({ db }) => {
      const a = schema.applications;
      const [current] = await db.select().from(a).where(eq(a.id, id)).for("update");
      if (current === undefined || current.status === "DRAFT") return notFound();
      const now = this.clock.now();
      await db.insert(schema.applicationEvents).values({
        applicationId: id,
        fromStatus: current.status,
        toStatus: current.status,
        actorUserId: actor.userId,
        note,
        createdAt: now,
      });
      await this.audit.record(db, actor, {
        action: "admissions.application.note-added",
        resourceType: "application",
        resourceId: id,
      });
      return this.view(db, id, sensitive);
    });
  }

  /**
   * Admits (offer expires `offer_acceptance_days` after the decision) or rejects (purged after the
   * policy's months) an application under review, and emails the applicant neutral wording that
   * never includes the internal note.
   */
  async decide(
    id: string,
    input: { decision: "ADMIT" | "REJECT"; note?: string | undefined },
    actor: Actor,
  ): Promise<DomainResult<ReviewedApplication>> {
    const sensitive = await this.mayReadSensitive(actor.userId);
    return this.db.withTxResult(async (tx) => {
      const a = schema.applications;
      const [current] = await tx.db.select().from(a).where(eq(a.id, id)).for("update");
      if (current === undefined || current.status === "DRAFT") return notFound();
      if (current.status !== "UNDER_REVIEW")
        return err(
          domainError(
            "APPLICATION_STATE_INVALID",
            current.status === "SUBMITTED"
              ? "Open the application for review before deciding."
              : "This application has already been decided.",
          ),
        );
      const [found] = await selectApplications(eq(a.id, id), tx.db);
      if (found === undefined) return notFound();
      const [intake] = await tx.db
        .select({ offerAcceptanceDays: schema.intakes.offerAcceptanceDays })
        .from(schema.intakes)
        .where(eq(schema.intakes.id, current.intakeId));
      if (intake === undefined) return notFound();
      const now = this.clock.now();
      const admit = input.decision === "ADMIT";
      const offerExpiresAt = admit
        ? new Date(now.getTime() + intake.offerAcceptanceDays * DAY_MS)
        : null;
      const { config } = await this.policies.current("ADMISSIONS", tx.db);
      const purgeAfter = admit ? null : new Date(now);
      purgeAfter?.setUTCMonth(purgeAfter.getUTCMonth() + config.purgeAfterMonths);
      await tx.db
        .update(a)
        .set({
          status: admit ? "ADMITTED" : "REJECTED",
          decidedAt: now,
          decidedBy: actor.userId,
          decisionNote: input.note === undefined || input.note === "" ? null : input.note,
          offerExpiresAt,
          purgeAfter,
          updatedAt: now,
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, id));
      await recordTransition(tx, this.audit, {
        applicationId: id,
        from: current.status,
        to: admit ? "ADMITTED" : "REJECTED",
        actor,
        now,
      });
      const settings = await this.settings.get(tx.db);
      const referenceNo = current.referenceNo ?? "";
      await this.notifications.notify(tx, {
        userId: current.applicantUserId,
        kind: admit ? "admissions.application.admitted" : "admissions.application.rejected",
        title: admit
          ? `You've been offered a place (${referenceNo})`
          : `Your application ${referenceNo}`,
        data: {
          applicationId: id,
          referenceNo,
          name: [current.firstName, current.lastName].filter(Boolean).join(" "),
          programmeName: found.programme.name,
          studyMode: MODE_LABEL[current.studyMode ?? ""] ?? "",
          startsOn: found.intake.startsOn,
          ...(offerExpiresAt === null ? {} : { offerExpiresAt: offerExpiresAt.toISOString() }),
          timeZone: settings.timezone,
          ...(current.email === null ? {} : { emailTo: current.email }),
        },
        email: true,
        dedupeKey: `application-decision:${id}`,
      });
      return this.view(tx.db, id, sensitive);
    });
  }

  /** Section 5 is shown only with read-sensitive (INV-15). Decided outside any transaction. */
  private async mayReadSensitive(userId: string): Promise<boolean> {
    const decision = await this.authorization.authorize(
      this.authorization.principal(userId),
      "admissions:application:read-sensitive",
    );
    return decision === "ALLOW";
  }

  private async view(
    db: Database,
    id: string,
    sensitive: boolean,
  ): Promise<DomainResult<ReviewedApplication>> {
    const a = schema.applications;
    const [found] = await selectApplications(eq(a.id, id), db);
    if (found === undefined || found.application.status === "DRAFT") return notFound();
    const { application: r, intake, programme } = found;
    const users = await this.names(
      db,
      [r.applicantUserId, r.reviewedBy, r.decidedBy, r.referrerUserId].filter(
        (u): u is string => u !== null,
      ),
    );
    const ev = schema.applicationEvents;
    const events = await db
      .select()
      .from(ev)
      .where(eq(ev.applicationId, id))
      .orderBy(asc(ev.createdAt), asc(ev.id));
    const noteAuthors = await this.names(
      db,
      events.flatMap((e) => (e.note !== null && e.actorUserId !== null ? [e.actorUserId] : [])),
    );
    const applicant = users.get(r.applicantUserId);
    const { spiritual, ...answers } = formAnswers(r);
    const name = (userId: string | null) =>
      userId === null ? null : (users.get(userId)?.name ?? null);

    return ok({
      id: r.id,
      status: r.status as ApplicationStatus,
      version: r.version,
      referenceNo: r.referenceNo,
      intake,
      programme,
      studyMode: r.studyMode as StudyMode | null,
      ...answers,
      ...(sensitive ? { spiritual } : {}),
      missing: missingFields(r),
      submittedAt: iso(r.submittedAt),
      withdrawnAt: iso(r.withdrawnAt),
      ...(await offerAndEnrollment(r, db, this.students)),
      timeline: events
        .filter((e) => e.note === null)
        .map((e) => ({ status: e.toStatus as ApplicationStatus, at: e.createdAt.toISOString() })),
      updatedAt: r.updatedAt.toISOString(),
      applicant: {
        userId: r.applicantUserId,
        displayName: applicant?.name ?? "",
        accountEmail: applicant?.email ?? "",
      },
      review: { startedAt: iso(r.reviewStartedAt), by: name(r.reviewedBy) },
      decision: {
        decidedAt: iso(r.decidedAt),
        by: name(r.decidedBy),
        note: r.decisionNote,
        offerExpiresAt: iso(r.offerExpiresAt),
      },
      referral:
        r.referralCodeEntered === null
          ? null
          : {
              code: r.referralCodeEntered,
              matched: r.referrerUserId !== null,
              referrerName: name(r.referrerUserId),
            },
      notes: events.flatMap((e) =>
        e.note === null
          ? []
          : [
              {
                id: e.id,
                note: e.note,
                at: e.createdAt.toISOString(),
                by: e.actorUserId === null ? null : (noteAuthors.get(e.actorUserId)?.name ?? null),
              },
            ],
      ),
    });
  }

  private async names(db: Database, ids: string[]) {
    const out = new Map<string, { name: string; email: string }>();
    if (ids.length === 0) return out;
    const u = schema.users;
    const rows = await db
      .select({ id: u.id, name: u.displayName, email: u.email })
      .from(u)
      .where(inArray(u.id, [...new Set(ids)]));
    for (const row of rows) out.set(row.id, { name: row.name, email: row.email });
    return out;
  }
}
