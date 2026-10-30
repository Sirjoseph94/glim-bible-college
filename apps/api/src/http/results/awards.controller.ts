import { results, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { AwardsService } from "@glim/modules/results";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Awards: propose with a checklist, then confer (§14.6). */
@Controller()
export class AwardsController {
  constructor(@Inject(AwardsService) private readonly awards: AwardsService) {}

  @Endpoint(results.listAwardCandidates)
  async candidates(
    @Query(results.listAwardCandidates) query: QueryOf<typeof results.listAwardCandidates>,
  ): Promise<Reply<typeof results.listAwardCandidates>> {
    return { items: await this.awards.candidates(query.cohortId) };
  }

  @Endpoint(results.listAwards)
  async list(
    @Query(results.listAwards) query: QueryOf<typeof results.listAwards>,
  ): Promise<Reply<typeof results.listAwards>> {
    return { items: await this.awards.list(query.status) };
  }

  @Endpoint(results.proposeAward)
  async propose(
    @Params(results.proposeAward) params: ParamsOf<typeof results.proposeAward>,
    @Body(results.proposeAward) body: BodyOf<typeof results.proposeAward>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.proposeAward>> {
    return unwrap(
      await this.awards.propose(params.id, body.awardType, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(results.confirmAward)
  async confirm(
    @Params(results.confirmAward) params: ParamsOf<typeof results.confirmAward>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.confirmAward>> {
    return unwrap(await this.awards.confirm(params.id, { ...actor, userId: session.userId }));
  }
}
