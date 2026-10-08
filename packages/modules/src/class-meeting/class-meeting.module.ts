import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { IdentityModule } from "@glim/modules/identity";
import { SchedulingModule } from "@glim/modules/scheduling";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { ClassMeetingsService } from "./class-meetings.service";

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

/** Hybrid Class Meetings: a Room and an online link (TRD §11, v1 spec). */
@Module({
  imports: [AuditModule, AuthorizationModule, IdentityModule, SchedulingModule],
  providers: [ClassMeetingsService, ClassMeetingResources],
  exports: [ClassMeetingsService],
})
export class ClassMeetingModule {}
