import { schema } from "@glim/db";
import { AcademicModule, OfferingsService } from "@glim/modules/academic";
import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { IdentityModule, SettingsService } from "@glim/modules/identity";
import { NotificationsModule } from "@glim/modules/notifications";
import { OpsModule } from "@glim/modules/ops";
import { SchedulingModule } from "@glim/modules/scheduling";
import { VideoModule } from "@glim/modules/video";
import { domainError, isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { and, eq, gt, lt, ne, or, sql } from "drizzle-orm";
import { ClassMeetingsService } from "./class-meetings.service";
import { MeetingLifecycleService } from "./lifecycle.service";
import { GoogleIntegrationService } from "./google-integration.service";
import { MeetEventsService } from "./meet-events.service";
import { MeetingWriter } from "./meeting-writer";
import { ProvisioningService } from "./provisioning.service";
import { SeriesService } from "./series.service";
import { SubscriptionsService } from "./subscriptions.service";

/**
 * Class Meetings tell authorization which offering each belongs to (§7.2), and stop an offering's
 * dates moving away from its Class Meetings and series (ADR-0005).
 */
@Injectable()
class ClassMeetingResources implements OnModuleInit {
  constructor(
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(ClassMeetingsService) private readonly meetings: ClassMeetingsService,
    @Inject(OfferingsService) private readonly offerings: OfferingsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.authorization.registerLoader("class-meeting", async (id) => {
      if (!isUuid(id)) return null;
      const offeringId = await this.meetings.offeringOf(id);
      return offeringId === null ? null : { offeringId };
    });
    this.offerings.registerDatesCheck(async (db, offeringId, dates) => {
      const zone = (await this.settings.get()).timezone;
      const m = schema.classMeetings;
      const day = (column: typeof m.scheduledStart) =>
        sql`(${column} AT TIME ZONE ${zone})::date`;
      const [meeting] = await db
        .select({ id: m.id })
        .from(m)
        .where(
          and(
            eq(m.courseOfferingId, offeringId),
            ne(m.state, "CANCELLED"),
            or(
              sql`${day(m.scheduledStart)} < ${dates.startsOn}::date`,
              sql`${day(m.scheduledEnd)} > ${dates.endsOn}::date`,
            ),
          ),
        )
        .limit(1);
      const sr = schema.classMeetingSeries;
      const [series] = await db
        .select({ id: sr.id })
        .from(sr)
        .where(
          and(
            eq(sr.courseOfferingId, offeringId),
            eq(sr.status, "ACTIVE"),
            or(lt(sr.startsOn, dates.startsOn), gt(sr.untilOn, dates.endsOn)),
          ),
        )
        .limit(1);
      if (meeting === undefined && series === undefined) return null;
      return domainError(
        "OUTSIDE_OFFERING_DATES",
        `Some of this offering's Class Meetings fall outside ${dates.startsOn} to ${dates.endsOn}. Move or cancel them first.`,
      );
    });
  }
}

/** Hybrid Class Meetings: a Room and Google Meet, provisioned or pasted (TRD §11). */
@Module({
  imports: [
    AcademicModule,
    AuditModule,
    AuthorizationModule,
    IdentityModule,
    NotificationsModule,
    OpsModule,
    SchedulingModule,
    VideoModule,
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
