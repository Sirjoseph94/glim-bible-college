import { assessment, type BodyOf, type ParamsOf } from "@glim/contracts";
import { GradebookService } from "@glim/modules/assessment";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** The gradebook: columns, CSV grade import, release, and students' released grades (§14.2). */
@Controller()
export class GradebookController {
  constructor(@Inject(GradebookService) private readonly gradebook: GradebookService) {}

  @Endpoint(assessment.getGradebook)
  async view(
    @Params(assessment.getGradebook) params: ParamsOf<typeof assessment.getGradebook>,
  ): Promise<Reply<typeof assessment.getGradebook>> {
    return this.gradebook.view(params.id);
  }

  @Endpoint(assessment.createGradebookColumn)
  async createColumn(
    @Params(assessment.createGradebookColumn)
    params: ParamsOf<typeof assessment.createGradebookColumn>,
    @Body(assessment.createGradebookColumn) body: BodyOf<typeof assessment.createGradebookColumn>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.createGradebookColumn>> {
    return this.gradebook.createColumn(params.id, body, actor);
  }

  @Endpoint(assessment.updateGradebookColumn)
  async updateColumn(
    @Params(assessment.updateGradebookColumn)
    params: ParamsOf<typeof assessment.updateGradebookColumn>,
    @Body(assessment.updateGradebookColumn) body: BodyOf<typeof assessment.updateGradebookColumn>,
    @IfMatch() version: number,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.updateGradebookColumn>> {
    return unwrap(await this.gradebook.updateColumn(params.id, version, body, actor));
  }

  @Endpoint(assessment.releaseGrades)
  async release(
    @Params(assessment.releaseGrades) params: ParamsOf<typeof assessment.releaseGrades>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.releaseGrades>> {
    return unwrap(await this.gradebook.release(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(assessment.importGrades)
  async importCsv(
    @Params(assessment.importGrades) params: ParamsOf<typeof assessment.importGrades>,
    @Body(assessment.importGrades) body: BodyOf<typeof assessment.importGrades>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.importGrades>> {
    return unwrap(
      await this.gradebook.importCsv(params.id, body, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(assessment.getMyGrades)
  async mine(
    @Params(assessment.getMyGrades) params: ParamsOf<typeof assessment.getMyGrades>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.getMyGrades>> {
    return { items: await this.gradebook.mine(params.id, session.userId) };
  }
}
