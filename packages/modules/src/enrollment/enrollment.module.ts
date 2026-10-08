import { schema } from "@glim/db";
import { AcademicModule, CurriculaService } from "@glim/modules/academic";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { StudentsService } from "./students.service";

/** Enrollment tells academic which curricula are in use, so they can't be edited (§9.1). */
@Injectable()
class EnrollmentHooks implements OnModuleInit {
  constructor(@Inject(CurriculaService) private readonly curricula: CurriculaService) {}

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
  }
}

const services = [StudentsService];

/** Students, programme enrollments and (later) course enrollments (TRD §9.3). */
@Module({
  imports: [AcademicModule],
  providers: [...services, EnrollmentHooks],
  exports: services,
})
export class EnrollmentModule {}
