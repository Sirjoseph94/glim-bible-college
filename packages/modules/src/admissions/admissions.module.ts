import { Db, schema } from "@glim/db";
import { AcademicModule } from "@glim/modules/academic";
import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { ContentModule } from "@glim/modules/content";
import { EnrollmentModule } from "@glim/modules/enrollment";
import { IdentityModule } from "@glim/modules/identity";
import { NotificationsModule } from "@glim/modules/notifications";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { AcceptanceService } from "./acceptance.service";
import { ApplicationsService } from "./applications.service";
import { IntakesService } from "./intakes.service";
import { OffersService } from "./offers.service";
import { ReviewService } from "./review.service";

/**
 * Admissions owns intakes and applications, so it tells authorization whether one exists and,
 * for an application, whose it is (§7.2 applicant path).
 */
@Injectable()
class AdmissionsResources implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
  ) {}

  onModuleInit(): void {
    this.authorization.registerLoader("intake", async (id) => {
      if (!isUuid(id)) return null;
      const [row] = await this.db.read
        .select({ id: schema.intakes.id })
        .from(schema.intakes)
        .where(eq(schema.intakes.id, id));
      return row === undefined ? null : {};
    });
    this.authorization.registerLoader("application", async (id) => {
      if (!isUuid(id)) return null;
      const owner = await this.applications.ownerOf(id);
      return owner === null ? null : { ownerUserId: owner, applicationId: id };
    });
  }
}

const services = [
  IntakesService,
  ApplicationsService,
  ReviewService,
  AcceptanceService,
  OffersService,
];

@Module({
  imports: [
    AcademicModule,
    AuditModule,
    AuthorizationModule,
    ContentModule,
    EnrollmentModule,
    IdentityModule,
    NotificationsModule,
  ],
  providers: [...services, AdmissionsResources],
  exports: services,
})
export class AdmissionsModule {}
