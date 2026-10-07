import { me, type BodyOf, type ResponseOf } from "@glim/contracts";
import { MeService, UserService, type ActiveSession } from "@glim/modules/identity";
import { AppError } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint } from "../../common/endpoint";

@Controller()
export class MeController {
  constructor(
    @Inject(MeService) private readonly me: MeService,
    @Inject(UserService) private readonly users: UserService,
  ) {}

  @Endpoint(me.getMe)
  async getMe(@CurrentSession() session: ActiveSession): Promise<ResponseOf<typeof me.getMe>> {
    const result = await this.me.forSession(session);
    if (result === null) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    return result;
  }

  @Endpoint(me.updateMe)
  async updateMe(
    @CurrentSession() session: ActiveSession,
    @Body(me.updateMe) body: BodyOf<typeof me.updateMe>,
  ): Promise<ResponseOf<typeof me.updateMe>> {
    await this.users.updateOwnProfile(session.userId, body);
    return this.getMe(session);
  }
}
