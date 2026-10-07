import { me, type ResponseOf } from "@glim/contracts";
import type { ActiveSession } from "@glim/modules/identity";
import { Controller, Inject } from "@nestjs/common";
import { CurrentSession } from "../../common/auth.guard";
import { Endpoint } from "../../common/endpoint";
import { MeAssembler } from "./me.assembler";

@Controller()
export class MeController {
  constructor(@Inject(MeAssembler) private readonly me: MeAssembler) {}

  @Endpoint(me.getMe)
  getMe(@CurrentSession() session: ActiveSession): Promise<ResponseOf<typeof me.getMe>> {
    return this.me.build(session);
  }
}
