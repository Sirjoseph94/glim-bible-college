import { admissions, type BodyOf, type ParamsOf } from "@glim/contracts";
import { IntakesService } from "@glim/modules/admissions";
import type { AuditActor } from "@glim/modules/audit";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof admissions.updateIntake>;

/** The yearly intake (TRD §10.1) and what applicants see before starting. */
@Controller()
export class IntakesController {
  constructor(@Inject(IntakesService) private readonly intakes: IntakesService) {}

  @Endpoint(admissions.getCurrentIntake)
  current(): Promise<Reply<typeof admissions.getCurrentIntake>> {
    return this.intakes.current();
  }

  @Endpoint(admissions.listIntakes)
  async list(): Promise<Reply<typeof admissions.listIntakes>> {
    return { items: await this.intakes.list() };
  }

  @Endpoint(admissions.createIntake)
  async create(
    @Body(admissions.createIntake) body: BodyOf<typeof admissions.createIntake>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof admissions.createIntake>> {
    return unwrap(await this.intakes.create(body, actor));
  }

  @Endpoint(admissions.updateIntake)
  async update(
    @Params(admissions.updateIntake) params: IdParams,
    @IfMatch() version: number,
    @Body(admissions.updateIntake) body: BodyOf<typeof admissions.updateIntake>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof admissions.updateIntake>> {
    return unwrap(await this.intakes.update(params.id, version, body, actor));
  }

  @Endpoint(admissions.openIntake)
  async open(
    @Params(admissions.openIntake) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof admissions.openIntake>> {
    return unwrap(await this.intakes.transition(params.id, "OPEN", actor));
  }

  @Endpoint(admissions.closeIntake)
  async close(
    @Params(admissions.closeIntake) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof admissions.closeIntake>> {
    return unwrap(await this.intakes.transition(params.id, "CLOSED", actor));
  }
}
