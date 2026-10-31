import { results, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { CohortResultsService, CourseResultsService } from "@glim/modules/results";
import { AppError, Csv, toCsv, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params, Query } from "../../common/endpoint";
import type { Reply, ReplyOrCsv } from "../../common/response.interceptor";

/** Course results: finalize, reopen, approve, cohort views and students' own results (§14.3–14.5). */
@Controller()
export class CourseResultsController {
  constructor(
    @Inject(CourseResultsService) private readonly results: CourseResultsService,
    @Inject(CohortResultsService) private readonly cohorts: CohortResultsService,
  ) {}

  @Endpoint(results.listCourseResults)
  async list(
    @Params(results.listCourseResults) params: ParamsOf<typeof results.listCourseResults>,
  ): Promise<Reply<typeof results.listCourseResults>> {
    return unwrap(await this.results.list(params.id));
  }

  @Endpoint(results.finalizeCourseResults)
  async finalize(
    @Params(results.finalizeCourseResults)
    params: ParamsOf<typeof results.finalizeCourseResults>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.finalizeCourseResults>> {
    return unwrap(await this.results.finalize(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(results.reopenCourseResult)
  async reopen(
    @Params(results.reopenCourseResult) params: ParamsOf<typeof results.reopenCourseResult>,
    @Body(results.reopenCourseResult) body: BodyOf<typeof results.reopenCourseResult>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.reopenCourseResult>> {
    return unwrap(
      await this.results.reopen(params.id, body.reason, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(results.getMyResults)
  async mine(
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof results.getMyResults>> {
    return this.results.mine(session.userId);
  }

  @Endpoint(results.getCohortResults)
  async cohort(
    @Params(results.getCohortResults) params: ParamsOf<typeof results.getCohortResults>,
  ): Promise<Reply<typeof results.getCohortResults>> {
    const view = await this.cohorts.view(params.id);
    if (view === null) throw new AppError("NOT_FOUND", "Not found.");
    return view;
  }

  @Endpoint(results.approveResults)
  async approve(
    @Body(results.approveResults) body: BodyOf<typeof results.approveResults>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.approveResults>> {
    return unwrap(await this.cohorts.approve(body, { ...actor, userId: session.userId }));
  }

  @Endpoint(results.getResultsBroadsheet)
  async broadsheet(
    @Query(results.getResultsBroadsheet) query: QueryOf<typeof results.getResultsBroadsheet>,
  ): Promise<ReplyOrCsv<typeof results.getResultsBroadsheet>> {
    const sheet = await this.cohorts.view(query.cohortId);
    if (sheet === null) throw new AppError("NOT_FOUND", "Not found.");
    if (query.format === "json") return sheet;
    const { headers, rows } = this.cohorts.broadsheetCsv(sheet);
    const name = sheet.cohort.code.replaceAll(/[^A-Za-z0-9]+/g, "-");
    return new Csv(`results-${name}.csv`, toCsv(headers, rows));
  }
}
