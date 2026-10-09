import { privacy, type BodyOf, type ParamsOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { DataRightsService } from "@glim/modules/privacy";
import { unwrap } from "@glim/shared";
import { Controller, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Data subject requests (§19.4). */
@Controller()
export class PrivacyController {
  constructor(@Inject(DataRightsService) private readonly rights: DataRightsService) {}

  @Endpoint(privacy.getDataExport)
  async export(
    @CurrentSession() session: ActiveSession,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Reply<typeof privacy.getDataExport>> {
    void reply.header("content-disposition", 'attachment; filename="glim-my-data.json"');
    void reply.header("cache-control", "no-store");
    return this.rights.exportFor(session.userId);
  }

  @Endpoint(privacy.eraseUser)
  async erase(
    @Params(privacy.eraseUser) params: ParamsOf<typeof privacy.eraseUser>,
    @Body(privacy.eraseUser) body: BodyOf<typeof privacy.eraseUser>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof privacy.eraseUser>> {
    return unwrap(
      await this.rights.erase(params.id, body.reason, { ...actor, userId: session.userId }),
    );
  }
}
