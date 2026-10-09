import { NotificationsModule } from "@glim/modules/notifications";
import { Module } from "@nestjs/common";
import { BackupService } from "./backup.service";
import { InboxService } from "./inbox.service";

@Module({
  imports: [NotificationsModule],
  providers: [BackupService, InboxService],
  exports: [BackupService, InboxService],
})
export class OpsModule {}
