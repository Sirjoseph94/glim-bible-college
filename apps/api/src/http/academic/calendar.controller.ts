import { calendar, type BodyOf, type ParamsOf } from "@glim/contracts";
import { RoomsService } from "@glim/modules/academic";
import type { AuditActor } from "@glim/modules/audit";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof calendar.updateRoom>;

/** Rooms (TRD §9.1, §16 Calendar). Courses run on their own dates, so there is no term calendar (ADR-0005). */
@Controller()
export class CalendarController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @Endpoint(calendar.listRooms)
  async listRooms(): Promise<Reply<typeof calendar.listRooms>> {
    return { items: await this.rooms.list() };
  }

  @Endpoint(calendar.createRoom)
  async createRoom(
    @Body(calendar.createRoom) body: BodyOf<typeof calendar.createRoom>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.createRoom>> {
    return unwrap(await this.rooms.create(body, actor));
  }

  @Endpoint(calendar.updateRoom)
  async updateRoom(
    @Params(calendar.updateRoom) params: IdParams,
    @IfMatch() version: number,
    @Body(calendar.updateRoom) body: BodyOf<typeof calendar.updateRoom>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.updateRoom>> {
    return unwrap(await this.rooms.update(params.id, version, body, actor));
  }
}
