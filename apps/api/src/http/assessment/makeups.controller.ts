import { assessment, type BodyOf, type ParamsOf } from "@glim/contracts";
import { MakeupsService } from "@glim/modules/assessment";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type StudentParams = ParamsOf<typeof assessment.setMakeupExam>;

/** Makeup exams: a later exam date for a student who missed the offering's exam (ADR-0005). */
@Controller()
export class MakeupsController {
  constructor(@Inject(MakeupsService) private readonly makeups: MakeupsService) {}

  @Endpoint(assessment.listMakeupExams)
  async list(
    @Params(assessment.listMakeupExams) params: ParamsOf<typeof assessment.listMakeupExams>,
  ): Promise<Reply<typeof assessment.listMakeupExams>> {
    return { items: await this.makeups.list(params.id) };
  }

  @Endpoint(assessment.setMakeupExam)
  async set(
    @Params(assessment.setMakeupExam) params: StudentParams,
    @Body(assessment.setMakeupExam) body: BodyOf<typeof assessment.setMakeupExam>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.setMakeupExam>> {
    return unwrap(
      await this.makeups.set(params.id, params.studentId, body, {
        ...actor,
        userId: session.userId,
      }),
    );
  }

  @Endpoint(assessment.removeMakeupExam)
  async remove(
    @Params(assessment.removeMakeupExam) params: StudentParams,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.removeMakeupExam>> {
    unwrap(
      await this.makeups.remove(params.id, params.studentId, { ...actor, userId: session.userId }),
    );
    return {};
  }
}
