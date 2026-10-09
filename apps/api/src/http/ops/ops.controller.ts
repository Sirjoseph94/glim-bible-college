import { ops, type ParamsOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { OpsService } from "@glim/modules/ops";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Endpoint, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** The ops page and job dashboard (§15.3, §20.1). */
@Controller()
export class OpsController {
  constructor(@Inject(OpsService) private readonly ops: OpsService) {}

  @Endpoint(ops.listOpsFailures)
  async failures(): Promise<Reply<typeof ops.listOpsFailures>> {
    return { items: await this.ops.failures() };
  }

  @Endpoint(ops.replayOpsFailure)
  async replay(
    @Params(ops.replayOpsFailure) params: ParamsOf<typeof ops.replayOpsFailure>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof ops.replayOpsFailure>> {
    return unwrap(
      await this.ops.replay(params.kind, params.id, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(ops.listQueues)
  async queues(): Promise<Reply<typeof ops.listQueues>> {
    return { items: await this.ops.queues() };
  }

  @Endpoint(ops.getYouTubeStatus)
  async youtube(): Promise<Reply<typeof ops.getYouTubeStatus>> {
    return { status: await this.ops.youtubeStatus() };
  }

  @Endpoint(ops.testYouTube)
  async testYoutube(
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof ops.testYouTube>> {
    await this.ops.requestYoutubeCheck({ ...actor, userId: session.userId });
    return {};
  }
}
