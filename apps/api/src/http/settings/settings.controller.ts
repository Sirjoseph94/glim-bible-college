import {
  EDITABLE_POLICY_TYPES,
  settings,
  type BodyOf,
  type EditablePolicyType,
  type ParamsOf,
} from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import { PolicyService, SettingsService } from "@glim/modules/identity";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

@Controller()
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PolicyService) private readonly policies: PolicyService,
  ) {}

  @Endpoint(settings.getSettings)
  get(): Promise<Reply<typeof settings.getSettings>> {
    return this.settings.get();
  }

  @Endpoint(settings.updateSettings)
  async update(
    @IfMatch() version: number,
    @Body(settings.updateSettings) body: BodyOf<typeof settings.updateSettings>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof settings.updateSettings>> {
    return unwrap(await this.settings.update(version, body, actor));
  }

  @Endpoint(settings.listPolicies)
  async listPolicies(): Promise<Reply<typeof settings.listPolicies>> {
    return {
      items: await Promise.all(EDITABLE_POLICY_TYPES.map((type) => this.policies.current(type))),
    };
  }

  @Endpoint(settings.getPolicy)
  getPolicy(
    @Params(settings.getPolicy) params: ParamsOf<typeof settings.getPolicy>,
  ): Promise<Reply<typeof settings.getPolicy>> {
    return this.policies.current(params.type as EditablePolicyType);
  }

  @Endpoint(settings.putPolicy)
  async putPolicy(
    @Params(settings.putPolicy) params: ParamsOf<typeof settings.putPolicy>,
    @IfMatch() version: number,
    @Body(settings.putPolicy) body: BodyOf<typeof settings.putPolicy>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof settings.putPolicy>> {
    return unwrap(
      await this.policies.save(params.type as EditablePolicyType, version, body.config, actor),
    );
  }
}
