import { AssessmentModule } from "@glim/modules/assessment";
import { AuditModule } from "@glim/modules/audit";
import { IdentityModule } from "@glim/modules/identity";
import { NotificationsModule } from "@glim/modules/notifications";
import { Module } from "@nestjs/common";
import { AwardsService } from "./awards.service";
import { CourseResultsService } from "./course-results.service";
import { GradingSchemesService } from "./grading-schemes.service";
import { SemesterResultsService } from "./semester-results.service";

const services = [
  GradingSchemesService,
  CourseResultsService,
  SemesterResultsService,
  AwardsService,
];

/** Results (TRD §14.3–14.5): grading schemes, course results and the results arithmetic. */
@Module({
  imports: [AuditModule, AssessmentModule, IdentityModule, NotificationsModule],
  providers: services,
  exports: services,
})
export class ResultsModule {}
