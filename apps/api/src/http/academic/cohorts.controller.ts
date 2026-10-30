import { cohorts, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import { CohortsService } from "@glim/modules/academic";
import type { AuditActor } from "@glim/modules/audit";
import { OfferingViewsService } from "@glim/modules/lecturing";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor } from "../../common/auth.guard";
import { Body, Endpoint, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof cohorts.getCohortSchedule>;

/** Cohorts and their Cohort Schedules (TRD §9, ADR-0005). */
@Controller()
export class CohortsController {
  constructor(
    @Inject(CohortsService) private readonly cohorts: CohortsService,
    @Inject(OfferingViewsService) private readonly views: OfferingViewsService,
  ) {}

  @Endpoint(cohorts.listCohorts)
  async list(
    @Query(cohorts.listCohorts) query: QueryOf<typeof cohorts.listCohorts>,
  ): Promise<Reply<typeof cohorts.listCohorts>> {
    return { items: await this.cohorts.list(query.status) };
  }

  @Endpoint(cohorts.getCohortSchedule)
  schedule(
    @Params(cohorts.getCohortSchedule) params: IdParams,
  ): Promise<Reply<typeof cohorts.getCohortSchedule>> {
    return this.view(params.id);
  }

  @Endpoint(cohorts.planCohortSchedule)
  async plan(
    @Params(cohorts.planCohortSchedule) params: IdParams,
    @Body(cohorts.planCohortSchedule) body: BodyOf<typeof cohorts.planCohortSchedule>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof cohorts.planCohortSchedule>> {
    unwrap(await this.cohorts.plan(params.id, body, actor));
    return this.view(params.id);
  }

  private async view(cohortId: string): Promise<Reply<typeof cohorts.getCohortSchedule>> {
    const cohort = await this.cohorts.get(cohortId);
    if (cohort === null) throw new AppError("NOT_FOUND", "Not found.");
    return {
      cohort,
      offerings: await this.views.listVisible({ userId: "", seeAll: true, cohortId }),
      unscheduled: await this.cohorts.unscheduled(cohortId),
    };
  }
}
