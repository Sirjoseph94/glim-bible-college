import { me, type ResponseOf } from "@glim/contracts";
import { MeService, type ActiveSession } from "@glim/modules/identity";
import { AppError } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { CurrentSession } from "../../common/auth.guard";
import { Endpoint } from "../../common/endpoint";

@Controller()
export class MeController {
  constructor(@Inject(MeService) private readonly me: MeService) {}

  @Endpoint(me.getMe)
  async getMe(@CurrentSession() session: ActiveSession): Promise<ResponseOf<typeof me.getMe>> {
    const result = await this.me.forSession(session);
    if (result === null) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    return result;
  }
}
