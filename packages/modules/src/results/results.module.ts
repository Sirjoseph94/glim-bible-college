import { AssessmentModule } from "@glim/modules/assessment";
import { AuditModule } from "@glim/modules/audit";
import { IdentityModule } from "@glim/modules/identity";
import { NotificationsModule } from "@glim/modules/notifications";
import { Module } from "@nestjs/common";
import { AwardsService } from "./awards.service";
import { CourseResultsService } from "./course-results.service";
import { GradingSchemesService } from "./grading-schemes.service";
import { CohortResultsService } from "./cohort-results.service";

const services = [
  GradingSchemesService,
  CourseResultsService,
  CohortResultsService,
  AwardsService,
];

/** Results (TRD §14.3–14.6): grading schemes, course results, approval, awards and the arithmetic. */
@Module({
  imports: [AuditModule, AssessmentModule, IdentityModule, NotificationsModule],
  providers: services,
  exports: services,
})
export class ResultsModule {}
