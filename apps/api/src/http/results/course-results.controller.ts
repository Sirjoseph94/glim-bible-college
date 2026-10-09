import { results, type BodyOf, type ParamsOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { CourseResultsService } from "@glim/modules/results";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Course results: finalize, reopen, and students' own results (§14.3). */
@Controller()
export class CourseResultsController {
  constructor(@Inject(CourseResultsService) private readonly results: CourseResultsService) {}

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
}
