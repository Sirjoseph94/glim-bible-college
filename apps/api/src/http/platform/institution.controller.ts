import { platform, type ResponseOf } from "@glim/contracts";
import { SettingsService } from "@glim/modules/identity";
import { Controller, Inject } from "@nestjs/common";
import { Endpoint } from "../../common/endpoint";

@Controller()
export class InstitutionController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Endpoint(platform.getInstitution)
  getInstitution(): Promise<ResponseOf<typeof platform.getInstitution>> {
    return this.settings.getInstitution();
  }
}
