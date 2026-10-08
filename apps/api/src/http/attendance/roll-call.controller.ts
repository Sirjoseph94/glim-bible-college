import { attendance, type BodyOf, type ParamsOf } from "@glim/contracts";
import { RollCallService } from "@glim/modules/attendance";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Roll call (TRD §12.3). */
@Controller()
export class RollCallController {
  constructor(@Inject(RollCallService) private readonly rollCall: RollCallService) {}

  @Endpoint(attendance.getRollCall)
  async get(
    @Params(attendance.getRollCall) params: ParamsOf<typeof attendance.getRollCall>,
  ): Promise<Reply<typeof attendance.getRollCall>> {
    const found = await this.rollCall.get(params.id);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(attendance.putRollCall)
  async put(
    @Params(attendance.putRollCall) params: ParamsOf<typeof attendance.putRollCall>,
    @Body(attendance.putRollCall) body: BodyOf<typeof attendance.putRollCall>,
    @IfMatch() version: number,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof attendance.putRollCall>> {
    return unwrap(
      await this.rollCall.put(params.id, version, body.marks, { ...actor, userId: session.userId }),
    );
  }
}
