import { admissions, reports, type QueryOf } from "@glim/contracts";
import { AdmissionsReportsService } from "@glim/modules/admissions";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { CLOCK, Csv, toCsv, type Clock } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Endpoint, Query } from "../../common/endpoint";
import type { ReplyOrCsv } from "../../common/response.interceptor";

/** Admissions reports and the application export (TRD §10.5–10.6), as JSON or CSV. */
@Controller()
export class AdmissionsReportsController {
  constructor(
    @Inject(AdmissionsReportsService) private readonly reports: AdmissionsReportsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private today(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }

  @Endpoint(reports.getAdmissionsReport)
  async admissions(
    @Query(reports.getAdmissionsReport) query: QueryOf<typeof reports.getAdmissionsReport>,
  ): Promise<ReplyOrCsv<typeof reports.getAdmissionsReport>> {
    const report = await this.reports.admissions(query.intakeId);
    if (query.format === "json") return report;
    const { headers, rows } = this.reports.admissionsCsv(report);
    return new Csv(`admissions-report-${this.today()}.csv`, toCsv(headers, rows));
  }

  @Endpoint(reports.getReferralReport)
  async referrals(
    @Query(reports.getReferralReport) query: QueryOf<typeof reports.getReferralReport>,
  ): Promise<ReplyOrCsv<typeof reports.getReferralReport>> {
    const report = await this.reports.referrals(query.intakeId);
    if (query.format === "json") return report;
    const { headers, rows } = this.reports.referralsCsv(report);
    return new Csv(`referral-report-${this.today()}.csv`, toCsv(headers, rows));
  }

  @Endpoint(admissions.exportApplications)
  async export(
    @Query(admissions.exportApplications) query: QueryOf<typeof admissions.exportApplications>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<ReplyOrCsv<typeof admissions.exportApplications>> {
    const { headers, rows } = await this.reports.export(query, {
      ...actor,
      userId: session.userId,
    });
    if (query.format === "csv")
      return new Csv(`applications-${this.today()}.csv`, toCsv(headers, rows));
    return {
      items: rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? null]))),
    };
  }
}
