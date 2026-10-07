import { Db, schema } from "@glim/db";
import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { IdentityModule } from "@glim/modules/identity";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { IntakesService } from "./intakes.service";

/** Admissions owns intakes, so it tells authorization whether one exists (§7.2). */
@Injectable()
class AdmissionsResources implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
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
  }
}

const services = [IntakesService];

@Module({
  imports: [AuditModule, AuthorizationModule, IdentityModule],
  providers: [...services, AdmissionsResources],
  exports: services,
})
export class AdmissionsModule {}
