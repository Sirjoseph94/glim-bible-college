import { results, type BodyOf, type ParamsOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import { GradingSchemesService } from "@glim/modules/results";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Grading schemes and which programme uses which (§14.4). */
@Controller()
export class GradingSchemesController {
  constructor(@Inject(GradingSchemesService) private readonly schemes: GradingSchemesService) {}

  @Endpoint(results.listGradingSchemes)
  async list(): Promise<Reply<typeof results.listGradingSchemes>> {
    return { items: await this.schemes.list() };
  }

  @Endpoint(results.createGradingScheme)
  async create(
    @Body(results.createGradingScheme) body: BodyOf<typeof results.createGradingScheme>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.createGradingScheme>> {
    return unwrap(await this.schemes.create(body, actor));
  }

  @Endpoint(results.updateGradingScheme)
  async update(
    @Params(results.updateGradingScheme) params: ParamsOf<typeof results.updateGradingScheme>,
    @Body(results.updateGradingScheme) body: BodyOf<typeof results.updateGradingScheme>,
    @IfMatch() version: number,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.updateGradingScheme>> {
    return unwrap(await this.schemes.update(params.id, version, body, actor));
  }

  @Endpoint(results.setProgrammeScheme)
  async assign(
    @Params(results.setProgrammeScheme) params: ParamsOf<typeof results.setProgrammeScheme>,
    @Body(results.setProgrammeScheme) body: BodyOf<typeof results.setProgrammeScheme>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof results.setProgrammeScheme>> {
    return unwrap(await this.schemes.assign(params.id, body.gradingSchemeId, actor));
  }
}
