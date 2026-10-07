import { Db, schema } from "@glim/db";
import { AcademicModule } from "@glim/modules/academic";
import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { IdentityModule } from "@glim/modules/identity";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { AssignmentsService } from "./assignments.service";
import { LecturersService } from "./lecturers.service";
import { OfferingViewsService } from "./offering-views.service";

/** Lecturing owns Lecturer profiles, so it tells authorization whether one exists (§7.2). */
@Injectable()
class LecturingResources implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  onModuleInit(): void {
    this.authorization.registerLoader("lecturer", async (id) => {
      if (!isUuid(id)) return null;
      const l = schema.lecturers;
      const [row] = await this.db.read.select({ userId: l.userId }).from(l).where(eq(l.id, id));
      return row === undefined ? null : { ownerUserId: row.userId };
    });
  }
}

const services = [LecturersService, AssignmentsService, OfferingViewsService];

@Module({
  imports: [AuditModule, AuthorizationModule, IdentityModule, AcademicModule],
  providers: [...services, LecturingResources],
  exports: services,
})
export class LecturingModule {}
