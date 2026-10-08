import { assessment, type BodyOf, type ParamsOf } from "@glim/contracts";
import { ExamsService, GradebookService, QuizzesService } from "@glim/modules/assessment";
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
  constructor(
    @Inject(GradebookService) private readonly gradebook: GradebookService,
    @Inject(ExamsService) private readonly exams: ExamsService,
    @Inject(QuizzesService) private readonly quizzes: QuizzesService,
  ) {}

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

  @Endpoint(assessment.createExam)
  async createExam(
    @Params(assessment.createExam) params: ParamsOf<typeof assessment.createExam>,
    @Body(assessment.createExam) body: BodyOf<typeof assessment.createExam>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.createExam>> {
    return this.exams.create(params.id, body, actor);
  }

  @Endpoint(assessment.createOnlineExam)
  async createOnlineExam(
    @Params(assessment.createOnlineExam) params: ParamsOf<typeof assessment.createOnlineExam>,
    @Body(assessment.createOnlineExam) body: BodyOf<typeof assessment.createOnlineExam>,
  ): Promise<Reply<typeof assessment.createOnlineExam>> {
    return unwrap(await this.quizzes.createOnlineExam(params.id, body));
  }

  @Endpoint(assessment.listOnlineGrants)
  async grants(
    @Params(assessment.listOnlineGrants) params: ParamsOf<typeof assessment.listOnlineGrants>,
  ): Promise<Reply<typeof assessment.listOnlineGrants>> {
    return { items: await this.exams.grants(params.id) };
  }

  @Endpoint(assessment.grantOnline)
  async grant(
    @Params(assessment.grantOnline) params: ParamsOf<typeof assessment.grantOnline>,
    @Body(assessment.grantOnline) body: BodyOf<typeof assessment.grantOnline>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.grantOnline>> {
    return unwrap(
      await this.exams.grant(params.id, params.studentId, body.reason, {
        ...actor,
        userId: session.userId,
      }),
    );
  }

  @Endpoint(assessment.revokeOnline)
  async revoke(
    @Params(assessment.revokeOnline) params: ParamsOf<typeof assessment.revokeOnline>,
    @Actor() actor: AuditActor,
  ): Promise<void> {
    unwrap(await this.exams.revoke(params.id, params.studentId, actor));
  }

  @Endpoint(assessment.useOnlineScore)
  async useOnlineScore(
    @Params(assessment.useOnlineScore) params: ParamsOf<typeof assessment.useOnlineScore>,
    @Body(assessment.useOnlineScore) body: BodyOf<typeof assessment.useOnlineScore>,
    @IfMatch() version: number,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.useOnlineScore>> {
    return unwrap(
      await this.exams.useOnlineScore(params.id, params.studentId, version, body.reason, {
        ...actor,
        userId: session.userId,
      }),
    );
  }
}
