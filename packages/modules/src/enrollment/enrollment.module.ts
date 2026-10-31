import { schema } from "@glim/db";
import { AcademicModule, CurriculaService, OfferingsService } from "@glim/modules/academic";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { IdentityModule } from "@glim/modules/identity";
import { AuditModule } from "@glim/modules/audit";
import { isUuid } from "@glim/shared";
import { NotificationsModule } from "@glim/modules/notifications";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { CourseEnrollmentsService } from "./course-enrollments.service";
import { RegistrationService } from "./registration.service";
import { StudentsService } from "./students.service";

/**
 * Enrollment tells academic which curricula are in use, so they can't be edited (§9.1), registers
 * a cohort when its offering is published and completes enrollments when it completes
 * (ADR-0005), and tells authorization whose enrollments are whose.
 */
@Injectable()
class EnrollmentHooks implements OnModuleInit {
  constructor(
    @Inject(CurriculaService) private readonly curricula: CurriculaService,
    @Inject(OfferingsService) private readonly offerings: OfferingsService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(CourseEnrollmentsService) private readonly enrollments: CourseEnrollmentsService,
    @Inject(RegistrationService) private readonly registration: RegistrationService,
  ) {}

  onModuleInit(): void {
    this.curricula.registerUsage(async (db, curriculumId) => {
      const pe = schema.programmeEnrollments;
      const [row] = await db
        .select({ id: pe.id })
        .from(pe)
        .where(eq(pe.curriculumId, curriculumId))
        .limit(1);
      return row !== undefined;
    });
    this.offerings.registerPublishStep(async (db, boss, offering) => {
      await this.registration.registerCohort(db, boss, offering);
    });
    this.offerings.registerCompleteStep((db, offeringId, now) =>
      this.enrollments.completeForOffering(db, offeringId, now),
    );
    // Enrollment owns course enrollments, so it says whose they are (§7.2).
    this.authorization.registerLoader("course-enrollment", async (id) => {
      if (!isUuid(id)) return null;
      return this.enrollments.courseEnrollmentContext(id);
    });
  }
}

const services = [StudentsService, RegistrationService, CourseEnrollmentsService];

/** Students, programme enrollments and (later) course enrollments (TRD §9.3). */
@Module({
  imports: [AcademicModule, AuditModule, AuthorizationModule, IdentityModule, NotificationsModule],
  providers: [...services, EnrollmentHooks],
  exports: services,
})
export class EnrollmentModule {}
