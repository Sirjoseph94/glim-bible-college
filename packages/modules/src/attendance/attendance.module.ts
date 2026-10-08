import { AuditModule } from "@glim/modules/audit";
import { ClassMeetingModule, MeetingLifecycleService } from "@glim/modules/class-meeting";
import { ContentModule } from "@glim/modules/content";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";
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

/** Roll call and, later, attendance records (TRD §12). */
@Module({
  imports: [AuditModule, ClassMeetingModule, ContentModule],
  providers: [RollCallService, AttendanceService, AttendanceHooks],
  exports: [RollCallService, AttendanceService],
})
export class AttendanceModule {}
