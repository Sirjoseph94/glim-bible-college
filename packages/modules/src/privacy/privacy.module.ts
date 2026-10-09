import { AuditModule } from "@glim/modules/audit";
import { ContentModule } from "@glim/modules/content";
import { IdentityModule } from "@glim/modules/identity";
import { NotificationsModule } from "@glim/modules/notifications";
import { Module } from "@nestjs/common";
import { DataRightsService } from "./data-rights.service";

/** Data subject requests (TRD §19.4): export and erasure. */
@Module({
  imports: [AuditModule, ContentModule, IdentityModule, NotificationsModule],
  providers: [DataRightsService],
  exports: [DataRightsService],
})
export class PrivacyModule {}
