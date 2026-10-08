import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

const services = [NotificationsService];

/** In-app notifications and their emails (TRD §15.1). */
@Module({ providers: services, exports: services })
export class NotificationsModule {}
