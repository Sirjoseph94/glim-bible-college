import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { NotificationsModule } from "@glim/modules/notifications";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { FilesService } from "./files.service";
import { MaterialsService } from "./materials.service";

/** Materials and announcements tell authorization which offering each belongs to (§7.2). */
@Injectable()
class ContentResources implements OnModuleInit {
  constructor(
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(MaterialsService) private readonly materials: MaterialsService,
  ) {}

  onModuleInit(): void {
    this.authorization.registerLoader("course-material", async (id) => {
      if (!isUuid(id)) return null;
      const offeringId = await this.materials.offeringOfMaterial(id);
      return offeringId === null ? null : { offeringId };
    });
    this.authorization.registerLoader("announcement", async (id) => {
      if (!isUuid(id)) return null;
      const offeringId = await this.materials.offeringOfAnnouncement(id);
      return offeringId === null ? null : { offeringId };
    });
  }
}

const services = [FilesService, MaterialsService];

/** Content (TRD §14.1): uploaded files, course materials and announcements. */
@Module({
  imports: [AuthorizationModule, NotificationsModule],
  providers: [...services, ContentResources],
  exports: services,
})
export class ContentModule {}
