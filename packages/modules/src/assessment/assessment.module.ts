import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { ContentModule } from "@glim/modules/content";
import { NotificationsModule } from "@glim/modules/notifications";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { AssignmentsService } from "./assignments.service";
import { ExamsService } from "./exams.service";
import { GradebookService } from "./gradebook.service";
import { GradesService } from "./grades.service";
import { MakeupsService } from "./makeups.service";
import { QuizAttemptsService } from "./quiz-attempts.service";
import { QuizzesService } from "./quizzes.service";
import { SubmissionsService } from "./submissions.service";

/** Assessments tell authorization which offering (and student) each resource belongs to (§7.2). */
@Injectable()
class AssessmentResources implements OnModuleInit {
  constructor(
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(SubmissionsService) private readonly submissions: SubmissionsService,
    @Inject(QuizzesService) private readonly quizzes: QuizzesService,
    @Inject(QuizAttemptsService) private readonly attempts: QuizAttemptsService,
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
    this.authorization.registerLoader("quiz", async (id) => {
      if (!isUuid(id)) return null;
      const offeringId = await this.quizzes.offeringOf(id);
      return offeringId === null ? null : { offeringId };
    });
    this.authorization.registerLoader("quiz-attempt", async (id) =>
      isUuid(id) ? this.attempts.ownerOf(id) : null,
    );
  }
}

const services = [
  AssignmentsService,
  SubmissionsService,
  GradesService,
  GradebookService,
  ExamsService,
  QuizzesService,
  QuizAttemptsService,
  MakeupsService,
];

/** Assessment (TRD §14.2): gradebook columns, assignments, submissions and grades. */
@Module({
  imports: [AuditModule, AuthorizationModule, ContentModule, NotificationsModule],
  providers: [...services, AssessmentResources],
  exports: services,
})
export class AssessmentModule {}
