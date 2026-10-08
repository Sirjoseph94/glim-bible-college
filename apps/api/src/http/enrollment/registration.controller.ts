import { enrollment } from "@glim/contracts";
import { RegistrationService } from "@glim/modules/enrollment";
import type { ActiveSession } from "@glim/modules/identity";
import { Controller, Inject } from "@nestjs/common";
import { CurrentSession } from "../../common/auth.guard";
import { Endpoint } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** A student's own registration (TRD §9.3). */
@Controller()
export class RegistrationController {
  constructor(@Inject(RegistrationService) private readonly registration: RegistrationService) {}

  @Endpoint(enrollment.getMyRegistration)
  mine(
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof enrollment.getMyRegistration>> {
    return this.registration.forUser(session.userId);
  }
}
