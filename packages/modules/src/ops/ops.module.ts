import { AuditModule } from "@glim/modules/audit";
import { NotificationsModule } from "@glim/modules/notifications";
import { Module } from "@nestjs/common";
import { BackupService } from "./backup.service";
import { InboxService } from "./inbox.service";
import { OpsService } from "./ops.service";

@Module({
  imports: [AuditModule, NotificationsModule],
  providers: [BackupService, InboxService, OpsService],
  exports: [BackupService, InboxService, OpsService],
})
export class OpsModule {}
