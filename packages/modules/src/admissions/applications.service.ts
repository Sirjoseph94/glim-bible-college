import type { Application, applications, ApplicationSummary, BodyOf } from "@glim/contracts";
import { Db, PG, pgError, schema, type Database } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { FilesService } from "@glim/modules/content";
import { PolicyService, SettingsService, UserService } from "@glim/modules/identity";
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
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { ageOn, missingFields } from "./application-form";

export type ApplicationDraftChange = BodyOf<typeof applications.saveApplicationDraft>;
type ApplicationRow = typeof schema.applications.$inferSelect;

const iso = (d: Date | null) => (d === null ? null : d.toISOString());
const notFound = () => err(domainError("NOT_FOUND", "Not found."));

/**
 * The applicant's side of an application (owner: admissions, TRD §10.2): start it in the open
 * intake, then save the draft a section at a time. Spiritual-background answers (INV-15) are
 * stored and shown back to the applicant only; they never go into audit, events or logs.
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
    const rows = await this.query(eq(schema.applications.applicantUserId, userId), this.db.read, [
      desc(schema.applications.createdAt),
    ]);
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
        !(await this.files.isUsable(photoFileId, current.applicantUserId, "PASSPORT_PHOTO"))
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

      const fields = await this.columnsFor(current, change);
      await db
        .update(a)
        .set({ ...fields, updatedAt: this.clock.now(), version: sql`${a.version} + 1` })
        .where(eq(a.id, id));
      return this.view(db, id);
    });
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
    const { config } = await this.policies.current("ADMISSIONS");
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
        ? { admissionsPolicyVersion: (await this.policies.current("ADMISSIONS")).version }
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
    const [found] = await this.query(eq(schema.applications.id, id), db);
    if (found === undefined) return notFound();
    const { application: r, intake, programme } = found;
    const [{ config }, settings] = await Promise.all([
      this.policies.current("ADMISSIONS"),
      this.settings.get(),
    ]);
    const spiritual = r.spiritualBackground ?? {};
    return ok({
      id: r.id,
      status: r.status as Application["status"],
      version: r.version,
      referenceNo: r.referenceNo,
      intake,
      programme,
      studyMode: r.studyMode as Application["studyMode"],
      personal: {
        firstName: r.firstName,
        middleName: r.middleName,
        lastName: r.lastName,
        title: r.title as Application["personal"]["title"],
        titleOther: r.titleOther,
        gender: r.gender as Application["personal"]["gender"],
        dateOfBirth: r.dateOfBirth,
        maritalStatus: r.maritalStatus as Application["personal"]["maritalStatus"],
        nationality: r.nationality,
        occupation: r.occupation,
      },
      contact: {
        email: r.email,
        phoneWhatsapp: r.phoneWhatsapp,
        altPhoneWhatsapp: r.altPhoneWhatsapp,
      },
      address: {
        country: r.country,
        stateProvince: r.stateProvince,
        city: r.city,
        postcode: r.postcode,
        address: r.address,
      },
      church: {
        churchName: r.churchName,
        churchAddress: r.churchAddress,
        pastorName: r.pastorName,
        pastorPhone: r.pastorPhone,
      },
      spiritual: {
        bornAgain: spiritual.bornAgain ?? null,
        bornAgainWhen: spiritual.bornAgainWhen ?? null,
        waterBaptism: spiritual.waterBaptism ?? null,
        holySpiritBaptism: spiritual.holySpiritBaptism ?? null,
        holySpiritSince: spiritual.holySpiritSince ?? null,
      },
      feedback: {
        heardVia: r.heardVia as Application["feedback"]["heardVia"],
        heardViaOther: r.heardViaOther,
        referralCode: r.referralCodeEntered,
      },
      declaration: {
        fullName: r.declarationFullName,
        statementOfFaithRead: r.statementOfFaithRead,
        declaredAt: iso(r.declaredAt),
      },
      consent: { consentedAt: iso(r.dataConsentAt) },
      photo:
        r.photoFileId === null
          ? null
          : { fileId: r.photoFileId, downloadPath: `/api/v1/files/${r.photoFileId}/download` },
      missing: missingFields(r),
      texts: {
        declarationText: config.declarationText,
        consentText: config.consentText,
        statementOfFaithUrl: settings.statementOfFaithUrl,
      },
      minimumAgeYears: config.minimumAgeYears,
      submittedAt: iso(r.submittedAt),
      updatedAt: r.updatedAt.toISOString(),
    });
  }

  private query(where: SQL, db: Database = this.db.read, order: SQL[] = []) {
    const a = schema.applications;
    const i = schema.intakes;
    const s = schema.academicSessions;
    const pr = schema.programmes;
    return db
      .select({
        application: a,
        intake: {
          id: i.id,
          code: i.code,
          academicSessionName: s.name,
          startsOn: s.startsOn,
          closesOn: i.closesOn,
          status: sql<Application["intake"]["status"]>`${i.status}`,
        },
        programme: {
          id: pr.id,
          code: pr.code,
          name: pr.name,
          awardType: sql<Application["programme"]["awardType"]>`${pr.awardType}`,
        },
      })
      .from(a)
      .innerJoin(i, eq(i.id, a.intakeId))
      .innerJoin(s, eq(s.id, i.academicSessionId))
      .innerJoin(pr, eq(pr.id, a.programmeId))
      .where(where)
      .orderBy(...order);
  }
}
