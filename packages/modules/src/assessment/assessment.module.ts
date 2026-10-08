import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { ContentModule } from "@glim/modules/content";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { AssignmentsService } from "./assignments.service";
import { GradesService } from "./grades.service";
import { SubmissionsService } from "./submissions.service";

/** Assessments tell authorization which offering (and student) each resource belongs to (§7.2). */
@Injectable()
class AssessmentResources implements OnModuleInit {
  constructor(
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(SubmissionsService) private readonly submissions: SubmissionsService,
  ) {}

  onModuleInit(): void {
    this.authorization.registerLoader("assignment", async (id) => {
      if (!isUuid(id)) return null;
      const offeringId = await this.assignments.offeringOf(id);
      return offeringId === null ? null : { offeringId };
    });
    this.authorization.registerLoader("assessment", async (id) => {
      if (!isUuid(id)) return null;
      const offeringId = await this.assignments.offeringOfAssessment(id);
      return offeringId === null ? null : { offeringId };
    });
    this.authorization.registerLoader("assignment-submission", async (id) =>
      isUuid(id) ? this.submissions.ownerOf(id) : null,
    );
  }
}

const services = [AssignmentsService, SubmissionsService, GradesService];

/** Assessment (TRD §14.2): gradebook columns, assignments, submissions and grades. */
@Module({
  imports: [AuditModule, AuthorizationModule, ContentModule],
  providers: [...services, AssessmentResources],
  exports: services,
})
export class AssessmentModule {}
