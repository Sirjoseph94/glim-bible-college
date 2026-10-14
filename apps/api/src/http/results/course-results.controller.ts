import { results, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { CourseResultsService, SemesterResultsService } from "@glim/modules/results";
import { Csv, toCsv, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params, Query } from "../../common/endpoint";
import type { Reply, ReplyOrCsv } from "../../common/response.interceptor";

/** Course results: finalize, reopen, and students' own results (§14.3). */
@Controller()
export class CourseResultsController {
  constructor(
    @Inject(CourseResultsService) private readonly results: CourseResultsService,
    @Inject(SemesterResultsService) private readonly semesters: SemesterResultsService,
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

  @Endpoint(results.listSemesterResults)
  async semesterResults(
    @Query(results.listSemesterResults) query: QueryOf<typeof results.listSemesterResults>,
  ): Promise<Reply<typeof results.listSemesterResults>> {
    const [items, courses] = await Promise.all([
      this.semesters.list(query),
      this.semesters.courseCounts(query),
    ]);
    return { items, courses };
  }

  @Endpoint(results.computeSemesterResults)
  async compute(
    @Body(results.computeSemesterResults) body: BodyOf<typeof results.computeSemesterResults>,
  ): Promise<Reply<typeof results.computeSemesterResults>> {
    return this.semesters.compute(body.semesterId, body.programmeId);
  }

  @Endpoint(results.approveSemesterResults)
  async approve(
    @Body(results.approveSemesterResults) body: BodyOf<typeof results.approveSemesterResults>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.approveSemesterResults>> {
    return unwrap(await this.semesters.approve(body, { ...actor, userId: session.userId }));
  }

  @Endpoint(results.publishSemesterResults)
  async publish(
    @Body(results.publishSemesterResults) body: BodyOf<typeof results.publishSemesterResults>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.publishSemesterResults>> {
    return unwrap(await this.semesters.publish(body, { ...actor, userId: session.userId }));
  }

  @Endpoint(results.getResultsBroadsheet)
  async broadsheet(
    @Query(results.getResultsBroadsheet) query: QueryOf<typeof results.getResultsBroadsheet>,
  ): Promise<ReplyOrCsv<typeof results.getResultsBroadsheet>> {
    const sheet = unwrap(await this.semesters.broadsheet(query));
    if (query.format === "json") return sheet;
    const { headers, rows } = this.semesters.broadsheetCsv(sheet.items);
    const name = `${sheet.semester.sessionCode}-${sheet.semester.name}`.replaceAll(
      /[^A-Za-z0-9]+/g,
      "-",
    );
    return new Csv(`results-${name}.csv`, toCsv(headers, rows));
  }
}
