import { enrollment, type BodyOf, type ParamsOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import { CourseEnrollmentsService } from "@glim/modules/enrollment";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof enrollment.getSemesterRegistration>;

/** Electives (students), rosters, manual registration and withdrawal (Academic Admin), §9.3. */
@Controller()
export class CourseEnrollmentsController {
  constructor(
    @Inject(CourseEnrollmentsService) private readonly enrollments: CourseEnrollmentsService,
  ) {}

  @Endpoint(enrollment.getSemesterRegistration)
  async registration(
    @Params(enrollment.getSemesterRegistration) params: IdParams,
  ): Promise<Reply<typeof enrollment.getSemesterRegistration>> {
    const found = await this.enrollments.registration(params.id);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(enrollment.addElective)
  async addElective(
    @Params(enrollment.addElective) params: IdParams,
    @Body(enrollment.addElective) body: BodyOf<typeof enrollment.addElective>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof enrollment.addElective>> {
    return unwrap(
      await this.enrollments.addElective(params.id, body.offeringId, {
        ...actor,
        userId: session.userId,
      }),
    );
  }

  @Endpoint(enrollment.dropElective)
  async dropElective(
    @Params(enrollment.dropElective) params: ParamsOf<typeof enrollment.dropElective>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof enrollment.dropElective>> {
    return unwrap(
      await this.enrollments.dropElective(params.id, params.courseEnrollmentId, {
        ...actor,
        userId: session.userId,
      }),
    );
  }

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
