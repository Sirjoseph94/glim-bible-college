import { attendance, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import { AttendanceService, RollCallService } from "@glim/modules/attendance";
import type { AuditActor } from "@glim/modules/audit";
import { SettingsService, type ActiveSession } from "@glim/modules/identity";
import { AppError, Csv, toCsv, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params, Query } from "../../common/endpoint";
import type { Reply, ReplyOrCsv } from "../../common/response.interceptor";

/** Roll call and attendance records (TRD §12.3, §12.5). */
@Controller()
export class RollCallController {
  constructor(
    @Inject(RollCallService) private readonly rollCall: RollCallService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  @Endpoint(attendance.overrideAttendance)
  async override(
    @Params(attendance.overrideAttendance) params: ParamsOf<typeof attendance.overrideAttendance>,
    @Body(attendance.overrideAttendance) body: BodyOf<typeof attendance.overrideAttendance>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof attendance.overrideAttendance>> {
    return unwrap(
      await this.attendance.setOverride(params.id, params.studentId, body, {
        ...actor,
        userId: session.userId,
      }),
    );
  }

  @Endpoint(attendance.clearAttendanceOverride)
  async clearOverride(
    @Params(attendance.clearAttendanceOverride)
    params: ParamsOf<typeof attendance.clearAttendanceOverride>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof attendance.clearAttendanceOverride>> {
    return unwrap(
      await this.attendance.setOverride(params.id, params.studentId, null, {
        ...actor,
        userId: session.userId,
      }),
    );
  }

  @Endpoint(attendance.getAttendanceReport)
  async report(
    @Query(attendance.getAttendanceReport) query: QueryOf<typeof attendance.getAttendanceReport>,
  ): Promise<ReplyOrCsv<typeof attendance.getAttendanceReport>> {
    const report = await this.attendance.report(query.offeringId);
    if (report === null) throw new AppError("NOT_FOUND", "Not found.");
    if (query.format === "json") return report;
    const { timezone } = await this.settings.getInstitution();
    const { headers, rows } = this.attendance.reportCsv(report, timezone);
    return new Csv(`attendance-${report.offering.courseCode}.csv`, toCsv(headers, rows));
  }

  @Endpoint(attendance.getMeetingAttendance)
  async meeting(
    @Params(attendance.getMeetingAttendance)
    params: ParamsOf<typeof attendance.getMeetingAttendance>,
  ): Promise<Reply<typeof attendance.getMeetingAttendance>> {
    const found = await this.attendance.forMeeting(params.id);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(attendance.getMyAttendance)
  mine(
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof attendance.getMyAttendance>> {
    return this.attendance.mine(session.userId);
  }

  @Endpoint(attendance.getRollCall)
  async get(
    @Params(attendance.getRollCall) params: ParamsOf<typeof attendance.getRollCall>,
  ): Promise<Reply<typeof attendance.getRollCall>> {
    const found = await this.rollCall.get(params.id);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(attendance.putRollCall)
  async put(
    @Params(attendance.putRollCall) params: ParamsOf<typeof attendance.putRollCall>,
    @Body(attendance.putRollCall) body: BodyOf<typeof attendance.putRollCall>,
    @IfMatch() version: number,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof attendance.putRollCall>> {
    return unwrap(
      await this.rollCall.put(params.id, version, body.marks, { ...actor, userId: session.userId }),
    );
  }
}
