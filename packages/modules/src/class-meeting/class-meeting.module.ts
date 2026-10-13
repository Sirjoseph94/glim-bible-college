import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { IdentityModule } from "@glim/modules/identity";
import { NotificationsModule } from "@glim/modules/notifications";
import { OpsModule } from "@glim/modules/ops";
import { SchedulingModule } from "@glim/modules/scheduling";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { ClassMeetingsService } from "./class-meetings.service";
import { MeetingLifecycleService } from "./lifecycle.service";
import { GoogleIntegrationService } from "./google-integration.service";
import { MeetEventsService } from "./meet-events.service";
import { MeetingWriter } from "./meeting-writer";
import { ProvisioningService } from "./provisioning.service";
import { SeriesService } from "./series.service";
import { SubscriptionsService } from "./subscriptions.service";

/** Class Meetings tell authorization which offering each belongs to (§7.2). */
@Injectable()
class ClassMeetingResources implements OnModuleInit {
  constructor(
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(ClassMeetingsService) private readonly meetings: ClassMeetingsService,
  ) {}

  onModuleInit(): void {
    this.authorization.registerLoader("class-meeting", async (id) => {
      if (!isUuid(id)) return null;
      const offeringId = await this.meetings.offeringOf(id);
      return offeringId === null ? null : { offeringId };
    });
  }
}

/** Hybrid Class Meetings: a Room and Google Meet, provisioned or pasted (TRD §11). */
@Module({
  imports: [
    AuditModule,
    AuthorizationModule,
    IdentityModule,
    NotificationsModule,
    OpsModule,
    SchedulingModule,
  ],
  providers: [
    ProvisioningService,
    MeetingWriter,
    ClassMeetingsService,
    SeriesService,
    MeetingLifecycleService,
    MeetEventsService,
    SubscriptionsService,
    GoogleIntegrationService,
    ClassMeetingResources,
  ],
  exports: [
    ClassMeetingsService,
    SeriesService,
    MeetingLifecycleService,
    ProvisioningService,
    MeetEventsService,
    SubscriptionsService,
    GoogleIntegrationService,
  ],
})
export class ClassMeetingModule {}
