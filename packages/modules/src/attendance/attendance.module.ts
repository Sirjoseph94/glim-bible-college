import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule } from "@glim/modules/authorization";
import { IdentityModule } from "@glim/modules/identity";
import { NotificationsModule } from "@glim/modules/notifications";
import { ClassMeetingModule, MeetingLifecycleService } from "@glim/modules/class-meeting";
import { ContentModule } from "@glim/modules/content";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";
import { ParticipantsService } from "./participants.service";
import { RollCallService } from "./roll-call.service";

/** Attendance tells the meeting lifecycle whether roll call was taken (NO_SHOW vs ENDED, §11.4). */
@Injectable()
class AttendanceHooks implements OnModuleInit {
  constructor(
    @Inject(MeetingLifecycleService) private readonly lifecycle: MeetingLifecycleService,
    @Inject(RollCallService) private readonly rollCall: RollCallService,
  ) {}

  onModuleInit(): void {
    this.lifecycle.registerRollCallCheck((db, meetingId) => this.rollCall.hasMarks(db, meetingId));
  }
}

/** Roll call, Meet participants and attendance records (TRD §12). */
@Module({
  imports: [
    AuditModule,
    AuthorizationModule,
    ClassMeetingModule,
    ContentModule,
    IdentityModule,
    NotificationsModule,
  ],
  providers: [RollCallService, ParticipantsService, AttendanceService, AttendanceHooks],
  exports: [RollCallService, ParticipantsService, AttendanceService],
})
export class AttendanceModule {}
