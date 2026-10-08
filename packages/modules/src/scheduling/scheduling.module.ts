import { AssignmentsService, LecturingModule } from "@glim/modules/lecturing";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { SchedulingService } from "./scheduling.service";

/** Scheduling keeps Lecturers' slots in step with their assignments (§9.4). */
@Injectable()
class SchedulingHooks implements OnModuleInit {
  constructor(
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
  ) {}

  onModuleInit(): void {
    this.assignments.onAssignmentChange({
      added: (db, change) => this.scheduling.lecturerAdded(db, change),
      ended: (db, change) => this.scheduling.lecturerEnded(db, change),
    });
  }
}

/** Conflict rules and Lecturer slots for Class Meetings (TRD §9.5). */
@Module({
  imports: [LecturingModule],
  providers: [SchedulingService, SchedulingHooks],
  exports: [SchedulingService],
})
export class SchedulingModule {}
