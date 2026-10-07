import { platform, type ResponseOf } from "@glim/contracts";
import { GoogleSignInService, SettingsService } from "@glim/modules/identity";
import { Controller, Inject } from "@nestjs/common";
import { Endpoint } from "../../common/endpoint";

@Controller()
export class InstitutionController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(GoogleSignInService) private readonly google: GoogleSignInService,
  ) {}

  @Endpoint(platform.getInstitution)
  async getInstitution(): Promise<ResponseOf<typeof platform.getInstitution>> {
    return { ...(await this.settings.getInstitution()), googleSignIn: this.google.enabled };
  }
}
