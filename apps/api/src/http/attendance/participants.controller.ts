import { attendance, type BodyOf, type ParamsOf } from "@glim/contracts";
import { ParticipantsService } from "@glim/modules/attendance";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Meet participants and manual matching (TRD §12.4, §12.7; integration slice). */
@Controller()
export class ParticipantsController {
  constructor(@Inject(ParticipantsService) private readonly participants: ParticipantsService) {}

  @Endpoint(attendance.getParticipants)
  async list(
    @Params(attendance.getParticipants) params: ParamsOf<typeof attendance.getParticipants>,
  ): Promise<Reply<typeof attendance.getParticipants>> {
    const view = await this.participants.list(params.id);
    if (view === null) throw new AppError("NOT_FOUND", "Not found.");
    return view;
  }

  @Endpoint(attendance.matchParticipant)
  async match(
    @Params(attendance.matchParticipant) params: ParamsOf<typeof attendance.matchParticipant>,
    @Body(attendance.matchParticipant) body: BodyOf<typeof attendance.matchParticipant>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof attendance.matchParticipant>> {
    return unwrap(
      await this.participants.match(params.id, params.pid, body, {
        ...actor,
        userId: session.userId,
      }),
    );
  }
}
