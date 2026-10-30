import { enrollment, type BodyOf, type ParamsOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import { CourseEnrollmentsService } from "@glim/modules/enrollment";
import type { ActiveSession } from "@glim/modules/identity";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof enrollment.getRoster>;

/** Rosters, manual registration and withdrawal (Academic Admin), §9.3, ADR-0005. */
@Controller()
export class CourseEnrollmentsController {
  constructor(
    @Inject(CourseEnrollmentsService) private readonly enrollments: CourseEnrollmentsService,
  ) {}

  @Endpoint(enrollment.getRoster)
  async roster(
    @Params(enrollment.getRoster) params: IdParams,
  ): Promise<Reply<typeof enrollment.getRoster>> {
    return { items: await this.enrollments.roster(params.id) };
  }

  @Endpoint(enrollment.registerManually)
  async registerManually(
    @Params(enrollment.registerManually) params: IdParams,
    @Body(enrollment.registerManually) body: BodyOf<typeof enrollment.registerManually>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof enrollment.registerManually>> {
    return unwrap(
      await this.enrollments.registerManually(params.id, body, {
        ...actor,
        userId: session.userId,
      }),
    );
  }

  @Endpoint(enrollment.withdrawCourseEnrollment)
  async withdraw(
    @Params(enrollment.withdrawCourseEnrollment) params: IdParams,
    @Body(enrollment.withdrawCourseEnrollment)
    body: BodyOf<typeof enrollment.withdrawCourseEnrollment>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof enrollment.withdrawCourseEnrollment>> {
    return unwrap(
      await this.enrollments.withdraw(params.id, body.reason, { ...actor, userId: session.userId }),
    );
  }
}
