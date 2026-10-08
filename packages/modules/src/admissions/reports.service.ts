import type { AdmissionsReport, ReferralReport } from "@glim/contracts";
import { Db, schema } from "@glim/db";
import { AuditService, type AuditActor } from "@glim/modules/audit";
import { AuthorizationService } from "@glim/modules/authorization";
import { AppError, type CsvCell } from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { formAnswers } from "./application-form";
import { selectApplications } from "./application-query";

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  ADMITTED: "Admitted",
  ACCEPTED: "Accepted",
  REJECTED: "Not admitted",
  LAPSED: "Offer lapsed",
  WITHDRAWN: "Withdrawn",
};
const MODE_LABEL: Record<string, string> = { ON_CAMPUS: "On campus", ONLINE: "Online" };
const HEARD_LABEL: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  EMAIL: "Email",
  SMS: "SMS",
  BILLBOARD: "Billboard",
  FLYER: "Flyer",
  FRIEND: "A friend",
  STUDENT: "A student",
  ALUMNI: "An alumnus",
  STAFF: "A member of staff",
  BABIC_CONFERENCE: "BABIC Conference",
  NCGC_MEMBER: "NCGC member",
  OTHER: "Other",
};

const name = (r: { firstName: string | null; lastName: string | null }) =>
  [r.firstName, r.lastName].filter(Boolean).join(" ");

/**
 * Admissions reports and the export (owner: admissions, TRD §10.5–10.6). Reports count submitted
 * applications only. The export includes spiritual background only when asked for, and only for
 * holders of `read-sensitive`; every export is audited (INV-15).
 */
@Injectable()
export class AdmissionsReportsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  async admissions(intakeId?: string): Promise<AdmissionsReport> {
    const a = schema.applications;
    const scope = this.scope(intakeId);
    const submitted = and(scope, ne(a.status, "DRAFT"));
    const grouped = async (column: SQL, label: (key: string) => string) => {
      const rows = await this.db.read
        .select({ key: sql<string>`coalesce(${column}, '')`, count: count() })
        .from(a)
        .innerJoin(schema.programmes, eq(schema.programmes.id, a.programmeId))
        .where(submitted)
        .groupBy(sql`1`)
        .orderBy(sql`2 desc`, sql`1`);
      return rows.map((r) => ({ key: r.key, label: label(r.key) || "Not given", count: r.count }));
    };
    const [total] = await this.db.read.select({ n: count() }).from(a).where(submitted);
    const [drafts] = await this.db.read
      .select({ n: count() })
      .from(a)
      .where(and(scope, eq(a.status, "DRAFT")));
    const heard = await this.db.read
      .select({ key: sql<string>`via`, count: count() })
      .from(sql`${a}, unnest(${a.heardVia}) AS via`)
      .where(submitted)
      .groupBy(sql`via`)
      .orderBy(sql`2 desc`, sql`via`);
    return {
      intake: await this.intake(intakeId),
      total: total?.n ?? 0,
      draftsInProgress: drafts?.n ?? 0,
      byStatus: await grouped(sql`${a.status}`, (k) => STATUS_LABEL[k] ?? k),
      byProgramme: await grouped(sql`${schema.programmes.name}`, (k) => k),
      byStudyMode: await grouped(sql`${a.studyMode}`, (k) => MODE_LABEL[k] ?? k),
      byCountry: await grouped(sql`${a.country}`, (k) => k),
      byHeardVia: heard.map((r) => ({
        key: r.key,
        label: HEARD_LABEL[r.key] ?? r.key,
        count: r.count,
      })),
    };
  }

  async referrals(intakeId?: string): Promise<ReferralReport> {
    const a = schema.applications;
    const rows = await selectApplications(
      and(this.scope(intakeId), ne(a.status, "DRAFT"), sql`${a.referralCodeEntered} IS NOT NULL`),
      this.db.read,
      [asc(a.submittedAt)],
    );
    const referrerIds = [
      ...new Set(
        rows.flatMap((r) => (r.application.referrerUserId ? [r.application.referrerUserId] : [])),
      ),
    ];
    const u = schema.users;
    const people =
      referrerIds.length === 0
        ? []
        : await this.db.read
            .select({ id: u.id, name: u.displayName, code: u.referralCode })
            .from(u)
            .where(inArray(u.id, referrerIds));
    const entry = (r: (typeof rows)[number]) => ({
      referenceNo: r.application.referenceNo ?? "",
      applicantName: name(r.application),
      programmeName: r.programme.name,
      status: STATUS_LABEL[r.application.status] ?? r.application.status,
    });
    const referrers = people
      .map((person) => {
        const theirs = rows.filter((r) => r.application.referrerUserId === person.id);
        return {
          userId: person.id,
          name: person.name,
          code: person.code ?? "",
          total: theirs.length,
          admitted: theirs.filter((r) =>
            ["ADMITTED", "ACCEPTED", "LAPSED"].includes(r.application.status),
          ).length,
          accepted: theirs.filter((r) => r.application.status === "ACCEPTED").length,
          applications: theirs.map(entry),
        };
      })
      .sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));
    const unmatchedCodes = new Map<string, ReturnType<typeof entry>[]>();
    for (const r of rows) {
      if (r.application.referrerUserId !== null) continue;
      const code = (r.application.referralCodeEntered ?? "").trim().toUpperCase();
      unmatchedCodes.set(code, [...(unmatchedCodes.get(code) ?? []), entry(r)]);
    }
    return {
      intake: await this.intake(intakeId),
      referrers,
      unmatched: [...unmatchedCodes].map(([code, applications]) => ({ code, applications })),
    };
  }

  /** CSV rows for the reports. */
  admissionsCsv(report: AdmissionsReport): { headers: string[]; rows: CsvCell[][] } {
    const rows: CsvCell[][] = [];
    const add = (dimension: string, counts: AdmissionsReport["byStatus"]) => {
      for (const c of counts) rows.push([dimension, c.label, c.count]);
    };
    add("Status", report.byStatus);
    add("Programme", report.byProgramme);
    add("Study mode", report.byStudyMode);
    add("Country", report.byCountry);
    add("Heard via", report.byHeardVia);
    rows.push(
      ["Total", "Submitted", report.total],
      ["Total", "Drafts in progress", report.draftsInProgress],
    );
    return { headers: ["Dimension", "Value", "Applications"], rows };
  }

  referralsCsv(report: ReferralReport): { headers: string[]; rows: CsvCell[][] } {
    const rows: CsvCell[][] = [];
    for (const r of report.referrers)
      for (const app of r.applications)
        rows.push([
          r.name,
          r.code,
          app.referenceNo,
          app.applicantName,
          app.programmeName,
          app.status,
        ]);
    for (const u of report.unmatched)
      for (const app of u.applications)
        rows.push([
          "(no match)",
          u.code,
          app.referenceNo,
          app.applicantName,
          app.programmeName,
          app.status,
        ]);
    return {
      headers: ["Referrer", "Code", "Application Reference No", "Applicant", "Programme", "Status"],
      rows,
    };
  }

  /**
   * Every submitted application as one row. Section 5 only with `includeSensitive`, which needs
   * read-sensitive (else 403). Each export is audited with its scope, never its contents.
   */
  async export(
    input: { intakeId?: string | undefined; includeSensitive: boolean; format: string },
    actor: AuditActor & { userId: string },
  ): Promise<{ headers: string[]; rows: CsvCell[][] }> {
    if (input.includeSensitive) {
      const decision = await this.authorization.authorize(
        this.authorization.principal(actor.userId),
        "admissions:application:read-sensitive",
      );
      if (decision !== "ALLOW")
        throw new AppError("FORBIDDEN", "You can't export spiritual-background answers.");
    }
    const a = schema.applications;
    const found = await selectApplications(
      and(this.scope(input.intakeId), ne(a.status, "DRAFT")),
      this.db.read,
      [asc(a.submittedAt), asc(a.id)],
    );
    const headers = [
      "Application Reference No",
      "Status",
      "Submitted",
      "Intake",
      "Programme",
      "Study mode",
      "Title",
      "First name",
      "Middle name",
      "Last name",
      "Gender",
      "Date of birth",
      "Marital status",
      "Nationality",
      "Occupation",
      "Email",
      "Phone (WhatsApp)",
      "Alternative phone",
      "Country",
      "State/province",
      "City",
      "Post code",
      "Address",
      "Church",
      "Church address",
      "Pastor",
      "Pastor's phone",
      "Heard via",
      "Referral code",
      "Referral matched",
      ...(input.includeSensitive
        ? [
            "Born again",
            "Born again when",
            "Water baptism",
            "Holy Spirit baptism",
            "Holy Spirit since",
          ]
        : []),
    ];
    const rows = found.map(({ application: r, intake, programme }): CsvCell[] => {
      const f = formAnswers(r);
      return [
        r.referenceNo,
        STATUS_LABEL[r.status] ?? r.status,
        r.submittedAt?.toISOString() ?? null,
        intake.code,
        programme.name,
        MODE_LABEL[r.studyMode ?? ""] ?? null,
        f.personal.title === "OTHER" ? f.personal.titleOther : f.personal.title,
        f.personal.firstName,
        f.personal.middleName,
        f.personal.lastName,
        f.personal.gender,
        f.personal.dateOfBirth,
        f.personal.maritalStatus,
        f.personal.nationality,
        f.personal.occupation,
        f.contact.email,
        f.contact.phoneWhatsapp,
        f.contact.altPhoneWhatsapp,
        f.address.country,
        f.address.stateProvince,
        f.address.city,
        f.address.postcode,
        f.address.address,
        f.church.churchName,
        f.church.churchAddress,
        f.church.pastorName,
        f.church.pastorPhone,
        f.feedback.heardVia
          .map((v) =>
            v === "OTHER" ? `Other: ${f.feedback.heardViaOther ?? ""}` : (HEARD_LABEL[v] ?? v),
          )
          .join("; "),
        f.feedback.referralCode,
        r.referralCodeEntered === null ? null : r.referrerUserId !== null,
        ...(input.includeSensitive
          ? [
              f.spiritual.bornAgain,
              f.spiritual.bornAgainWhen,
              f.spiritual.waterBaptism,
              f.spiritual.holySpiritBaptism,
              f.spiritual.holySpiritSince,
            ]
          : []),
      ];
    });
    await this.db.withTx(({ db }) =>
      this.audit.record(db, actor, {
        action: "admissions.applications.exported",
        resourceType: "application",
        metadata: {
          intakeId: input.intakeId ?? null,
          includeSensitive: input.includeSensitive,
          format: input.format,
          count: rows.length,
        },
      }),
    );
    return { headers, rows };
  }

  private scope(intakeId: string | undefined): SQL | undefined {
    return intakeId === undefined ? undefined : eq(schema.applications.intakeId, intakeId);
  }

  private async intake(intakeId: string | undefined) {
    if (intakeId === undefined) return null;
    const [row] = await this.db.read
      .select({ id: schema.intakes.id, code: schema.intakes.code })
      .from(schema.intakes)
      .where(eq(schema.intakes.id, intakeId));
    return row ?? null;
  }
}
