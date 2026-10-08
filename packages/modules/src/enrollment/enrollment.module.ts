import { schema } from "@glim/db";
import { AcademicModule, CurriculaService } from "@glim/modules/academic";
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
 * Enrollment tells academic which curricula are in use, so they can't be edited (§9.1), and
 * tells authorization whose enrollments are whose.
 */
@Injectable()
class EnrollmentHooks implements OnModuleInit {
  constructor(
    @Inject(CurriculaService) private readonly curricula: CurriculaService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(CourseEnrollmentsService) private readonly enrollments: CourseEnrollmentsService,
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
    // Enrollment owns semester and course enrollments, so it says whose they are (§7.2).
    this.authorization.registerLoader("semester-enrollment", async (id) => {
      if (!isUuid(id)) return null;
      const owner = await this.enrollments.ownerOfSemesterEnrollment(id);
      return owner === null ? null : { ownerUserId: owner };
    });
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
