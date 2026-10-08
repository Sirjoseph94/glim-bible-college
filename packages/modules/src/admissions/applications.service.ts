import type { Application, applications, ApplicationSummary, BodyOf } from "@glim/contracts";
import { Db, PG, pgError, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { FilesService } from "@glim/modules/content";
import { PolicyService, SettingsService, UserService } from "@glim/modules/identity";
import { NotificationsService } from "@glim/modules/notifications";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  ok,
  type Clock,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { ageOn, formAnswers, missingFields } from "./application-form";
import { selectApplications } from "./application-query";
import { recordTransition } from "./transitions";

export type ApplicationDraftChange = BodyOf<typeof applications.saveApplicationDraft>;
type ApplicationRow = typeof schema.applications.$inferSelect;

const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * The applicant's side of an application (owner: admissions, TRD §10.2–10.3): start it in the
 * open intake, save the draft a section at a time, submit it, or withdraw it. Spiritual-background
 * answers (INV-15) are stored and shown back to the applicant only; they never go into audit,
 * events, notifications or logs.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policies: PolicyService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(UserService) private readonly users: UserService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** Starts a draft in the open intake; that makes the user an Applicant (§7.1). */
  async start(
    input: { programmeId: string; studyMode: "ON_CAMPUS" | "ONLINE" },
    actor: AuditActor & { userId: string },
  ): Promise<DomainResult<Application>> {
    const user = await this.users.findById(actor.userId);
    if (user === null) return notFound();
    try {
      return await this.db.withTxResult(async ({ db }) => {
        const i = schema.intakes;
        const [intake] = await db
          .select({ id: i.id })
          .from(i)
          .where(eq(i.status, "OPEN"))
          .orderBy(asc(i.opensOn))
          .limit(1);
        if (intake === undefined)
          return err(domainError("INTAKE_CLOSED", "Applications aren't open at the moment."));
        const pr = schema.programmes;
        const [programme] = await db
          .select({ id: pr.id })
          .from(pr)
          .where(and(eq(pr.id, input.programmeId), eq(pr.status, "ACTIVE")));
        if (programme === undefined)
          return err(
            domainError("VALIDATION_FAILED", "Choose a programme that's taking applications.", {
              fieldErrors: [
                { path: "programmeId", code: "invalid", message: "Not an open programme." },
              ],
            }),
          );
        const now = this.clock.now();
        const [row] = await db
          .insert(schema.applications)
          .values({
            intakeId: intake.id,
            programmeId: programme.id,
            applicantUserId: actor.userId,
            studyMode: input.studyMode,
            email: user.email,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: schema.applications.id });
        if (row === undefined) throw new Error("application insert returned nothing");
        await db.insert(schema.applicationEvents).values({
          applicationId: row.id,
          fromStatus: null,
          toStatus: "DRAFT",
          actorUserId: actor.userId,
          createdAt: now,
        });
        await this.audit.record(db, actor, {
          action: "admissions.application.started",
          resourceType: "application",
          resourceId: row.id,
          metadata: { intakeId: intake.id, programmeId: programme.id, studyMode: input.studyMode },
        });
        return this.view(db, row.id);
      });
    } catch (error) {
      if (pgError(error)?.code === PG.UNIQUE_VIOLATION)
        return err(
          domainError(
            "APPLICATION_ALREADY_OPEN",
            "You already have an application for this intake. Carry on with that one.",
          ),
        );
      throw error;
    }
  }

  async mine(userId: string): Promise<ApplicationSummary[]> {
    const rows = await selectApplications(
      eq(schema.applications.applicantUserId, userId),
      this.db.read,
      [desc(schema.applications.createdAt)],
    );
    return rows.map((r) => ({
      id: r.application.id,
      status: r.application.status as Application["status"],
      referenceNo: r.application.referenceNo,
      intake: r.intake,
      programme: r.programme,
      studyMode: r.application.studyMode as Application["studyMode"],
      submittedAt: iso(r.application.submittedAt),
      updatedAt: r.application.updatedAt.toISOString(),
    }));
  }

  async get(id: string): Promise<Application | null> {
    const found = await this.view(this.db.read, id);
    return found.ok ? found.value : null;
  }

  /** Who owns an application, for authorization (§7.2 applicant path); null if it doesn't exist. */
  async ownerOf(id: string): Promise<string | null> {
    const a = schema.applications;
    const [row] = await this.db.read
      .select({ owner: a.applicantUserId })
      .from(a)
      .where(eq(a.id, id));
    return row?.owner ?? null;
  }

  /** Autosave: changes the sections given, leaving the rest. Only a draft can change. */
  saveDraft(
    id: string,
    expectedVersion: number,
    change: ApplicationDraftChange,
  ): Promise<DomainResult<Application>> {
    return this.db.withTxResult(async ({ db }) => {
      const a = schema.applications;
      const [current] = await db.select().from(a).where(eq(a.id, id)).for("update");
      if (current === undefined) return notFound();
      if (current.version !== expectedVersion)
        return err(
          domainError(
            "VERSION_MISMATCH",
            "Your application was changed in another window. Reload to carry on.",
          ),
        );
      if (current.status !== "DRAFT")
        return err(
          domainError("APPLICATION_STATE_INVALID", "A submitted application can't be edited."),
        );

      if (change.programmeId !== undefined) {
        const pr = schema.programmes;
        const [programme] = await db
          .select({ id: pr.id })
          .from(pr)
          .where(and(eq(pr.id, change.programmeId), eq(pr.status, "ACTIVE")));
        if (programme === undefined)
          return err(
            domainError("VALIDATION_FAILED", "Choose a programme that's taking applications."),
          );
      }

      const photoFileId = change.photo?.fileId;
      if (
        photoFileId !== undefined &&
        photoFileId !== null &&
        !(await this.files.isUsable(photoFileId, current.applicantUserId, "PASSPORT_PHOTO", db))
      )
        return err(
          domainError("VALIDATION_FAILED", "Upload the passport photo again.", {
            fieldErrors: [
              { path: "photo.fileId", code: "invalid", message: "That photo isn't available." },
            ],
          }),
        );

      const dateOfBirth = change.personal?.dateOfBirth;
      if (dateOfBirth !== undefined && dateOfBirth !== null) {
        const tooYoung = await this.tooYoung(db, current.intakeId, dateOfBirth);
        if (tooYoung !== null) return err(tooYoung);
      }

      const fields = await this.columnsFor(db, current, change);
      await db
        .update(a)
        .set({ ...fields, updatedAt: this.clock.now(), version: sql`${a.version} + 1` })
        .where(eq(a.id, id));
      return this.view(db, id);
    });
  }

  /**
   * Submits a complete draft while its intake is open: allocates the next reference number from
   * the intake's sequence under a row lock (gap-free, since it rolls back with a failed submit),
   * records the event, and queues the receipt email, all in one transaction.
   */
  submit(id: string, actor: AuditActor & { userId: string }): Promise<DomainResult<Application>> {
    return this.db.withTxResult(async (tx) => {
      const { db } = tx;
      const a = schema.applications;
      const [current] = await db.select().from(a).where(eq(a.id, id)).for("update");
      if (current === undefined) return notFound();
      if (current.status !== "DRAFT")
        return err(
          domainError("APPLICATION_STATE_INVALID", "This application has already been submitted."),
        );
      const [found] = await selectApplications(eq(a.id, id), db);
      if (found === undefined) return notFound();
      if (found.intake.status !== "OPEN")
        return err(domainError("INTAKE_CLOSED", "Applications for this intake have closed."));
      const missing = Object.entries(missingFields(current)).flatMap(([section, fields]) =>
        fields.map((field) => ({
          path: `${section}.${field}`,
          code: "required",
          message: "Required.",
        })),
      );
      if (
        current.photoFileId !== null &&
        !(await this.files.isUsable(
          current.photoFileId,
          current.applicantUserId,
          "PASSPORT_PHOTO",
          db,
        ))
      )
        missing.push({
          path: "photo.fileId",
          code: "required",
          message: "Upload the photo again.",
        });
      if (missing.length > 0)
        return err(
          domainError("APPLICATION_INCOMPLETE", "Some required answers are missing.", {
            fieldErrors: missing,
          }),
        );
      if (current.dateOfBirth !== null) {
        const tooYoung = await this.tooYoung(db, current.intakeId, current.dateOfBirth);
        if (tooYoung !== null) return err(tooYoung);
      }

      const referenceNo = await this.nextReferenceNo(db, current.intakeId, found.intake.code);
      // Credit the referrer whose personal code was entered; an unknown code is flagged for staff.
      const referrer =
        current.referralCodeEntered === null
          ? undefined
          : (
              await db
                .select({ id: schema.users.id })
                .from(schema.users)
                .where(
                  eq(schema.users.referralCode, current.referralCodeEntered.trim().toUpperCase()),
                )
            )[0];
      const now = this.clock.now();
      await db
        .update(a)
        .set({
          status: "SUBMITTED",
          referenceNo,
          referrerUserId: referrer?.id ?? null,
          submittedAt: now,
          updatedAt: now,
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, id));
      await recordTransition(tx, this.audit, {
        applicationId: id,
        from: current.status,
        to: "SUBMITTED",
        actor,
        now,
        metadata: { referenceNo },
      });
      await this.notifications.notify(tx, {
        userId: current.applicantUserId,
        kind: "admissions.application.receipt",
        title: `Application ${referenceNo} received`,
        data: {
          referenceNo,
          applicationId: id,
          name: [current.firstName, current.lastName].filter(Boolean).join(" "),
          programmeName: found.programme.name,
          studyMode: current.studyMode === "ON_CAMPUS" ? "on campus" : "online",
          academicSessionName: found.intake.academicSessionName,
          ...(current.email === null ? {} : { emailTo: current.email }),
        },
        email: true,
        dedupeKey: `application-receipt:${id}`,
      });
      return this.view(db, id);
    });
  }

  /** Withdraws an application before an offer is accepted; it is deleted after the purge period. */
  withdraw(id: string, actor: AuditActor & { userId: string }): Promise<DomainResult<Application>> {
    return this.db.withTxResult(async (tx) => {
      const { db } = tx;
      const a = schema.applications;
      const [current] = await db.select().from(a).where(eq(a.id, id)).for("update");
      if (current === undefined) return notFound();
      if (!["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ADMITTED"].includes(current.status))
        return err(
          domainError(
            "APPLICATION_STATE_INVALID",
            `An application that is ${current.status.toLowerCase().replaceAll("_", " ")} can't be withdrawn.`,
          ),
        );
      const now = this.clock.now();
      const { config } = await this.policies.current("ADMISSIONS", db);
      const purgeAfter = new Date(now);
      purgeAfter.setUTCMonth(purgeAfter.getUTCMonth() + config.purgeAfterMonths);
      await db
        .update(a)
        .set({
          status: "WITHDRAWN",
          withdrawnAt: now,
          purgeAfter,
          updatedAt: now,
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, id));
      await recordTransition(tx, this.audit, {
        applicationId: id,
        from: current.status,
        to: "WITHDRAWN",
        actor,
        now,
      });
      return this.view(db, id);
    });
  }

  /** Locks the intake's sequence row and takes its next number: GLIM-APP-{intake}-{NNNNN}. */
  private async nextReferenceNo(db: Database, intakeId: string, intakeCode: string) {
    const q = schema.applicationSequences;
    await db.insert(q).values({ intakeId }).onConflictDoNothing();
    const [sequence] = await db.select().from(q).where(eq(q.intakeId, intakeId)).for("update");
    if (sequence === undefined) throw new Error("application sequence row missing");
    await db
      .update(q)
      .set({ nextValue: sequence.nextValue + 1 })
      .where(eq(q.intakeId, intakeId));
    return `GLIM-APP-${intakeCode}-${String(sequence.nextValue).padStart(5, "0")}`;
  }

  /** APPLICANT_UNDER_AGE unless they reach the minimum age by the day the Academic Session starts (Q-15). */
  private async tooYoung(db: Database, intakeId: string, dateOfBirth: string) {
    const s = schema.academicSessions;
    const [session] = await db
      .select({ startsOn: s.startsOn })
      .from(schema.intakes)
      .innerJoin(s, eq(s.id, schema.intakes.academicSessionId))
      .where(eq(schema.intakes.id, intakeId));
    if (session === undefined) throw new Error("intake without an Academic Session");
    const { config } = await this.policies.current("ADMISSIONS", db);
    if (ageOn(dateOfBirth, session.startsOn) >= config.minimumAgeYears) return null;
    return domainError(
      "APPLICANT_UNDER_AGE",
      `Applicants must be at least ${String(config.minimumAgeYears)} when the session starts on ${session.startsOn}.`,
      {
        fieldErrors: [
          {
            path: "personal.dateOfBirth",
            code: "under_age",
            message: `You must be at least ${String(config.minimumAgeYears)} when the session starts.`,
          },
        ],
      },
    );
  }

  /** Maps the sections of a draft save onto columns; dates are the server's, never the client's. */
  private async columnsFor(
    db: Database,
    current: ApplicationRow,
    change: ApplicationDraftChange,
  ): Promise<Partial<ApplicationRow>> {
    const now = this.clock.now();
    const { feedback, declaration, consent, spiritual } = change;
    const declared =
      declaration?.declared === undefined
        ? {}
        : { declaredAt: declaration.declared ? (current.declaredAt ?? now) : null };
    const consented =
      consent === undefined
        ? {}
        : { dataConsentAt: consent.consented ? (current.dataConsentAt ?? now) : null };
    const texts =
      declaration?.declared === true || consent?.consented === true
        ? { admissionsPolicyVersion: (await this.policies.current("ADMISSIONS", db)).version }
        : {};
    return definedFields({
      programmeId: change.programmeId,
      studyMode: change.studyMode,
      ...change.personal,
      ...change.contact,
      ...change.address,
      ...change.church,
      spiritualBackground:
        spiritual === undefined
          ? undefined
          : { ...current.spiritualBackground, ...definedFields(spiritual) },
      heardVia: feedback?.heardVia,
      heardViaOther: feedback?.heardViaOther,
      referralCodeEntered: feedback?.referralCode,
      declarationFullName: declaration?.fullName,
      statementOfFaithRead: declaration?.statementOfFaithRead,
      photoFileId: change.photo?.fileId,
      ...declared,
      ...consented,
      ...texts,
    });
  }

  private async view(db: Database, id: string): Promise<DomainResult<Application>> {
    const [found] = await selectApplications(eq(schema.applications.id, id), db);
    if (found === undefined) return notFound();
    const { application: r, intake, programme } = found;
    const [{ config }, settings] = await Promise.all([
      this.policies.current("ADMISSIONS", db),
      this.settings.get(db),
    ]);
    const ev = schema.applicationEvents;
    const timeline = await db
      .select({ status: ev.toStatus, at: ev.createdAt })
      .from(ev)
      // Internal notes are events too; the applicant sees only status changes.
      .where(and(eq(ev.applicationId, r.id), isNull(ev.note)))
      .orderBy(asc(ev.createdAt), asc(ev.id));
    return ok({
      id: r.id,
      status: r.status as Application["status"],
      version: r.version,
      referenceNo: r.referenceNo,
      intake,
      programme,
      studyMode: r.studyMode as Application["studyMode"],
      ...formAnswers(r),
      missing: missingFields(r),
      texts: {
        declarationText: config.declarationText,
        consentText: config.consentText,
        statementOfFaithUrl: settings.statementOfFaithUrl,
      },
      minimumAgeYears: config.minimumAgeYears,
      submittedAt: iso(r.submittedAt),
      withdrawnAt: iso(r.withdrawnAt),
      timeline: timeline.map((e) => ({
        status: e.status as Application["status"],
        at: e.at.toISOString(),
      })),
      updatedAt: r.updatedAt.toISOString(),
    });
  }
}
