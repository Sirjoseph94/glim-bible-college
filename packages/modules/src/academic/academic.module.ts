import { Db, schema } from "@glim/db";
import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { CohortsService } from "./cohorts.service";
import { CoursesService } from "./courses.service";
import { CurriculaService } from "./curricula.service";
import { OfferingsService } from "./offerings.service";
import { ProgrammesService } from "./programmes.service";
import { RoomsService } from "./rooms.service";

/** Academic owns programmes, courses and curricula, so it tells authorization whether one exists (§7.2). */
@Injectable()
class AcademicResources implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  onModuleInit(): void {
    const exists = (table: PgTable, id: PgColumn) => async (key: string) => {
      if (!isUuid(key)) return null;
      const [row] = await this.db.read.select({ id }).from(table).where(eq(id, key));
      return row === undefined ? null : {};
    };
    this.authorization.registerLoader("programme", exists(schema.programmes, schema.programmes.id));
    this.authorization.registerLoader("course", exists(schema.courses, schema.courses.id));
    this.authorization.registerLoader("curriculum", exists(schema.curricula, schema.curricula.id));
    this.authorization.registerLoader("cohort", exists(schema.cohorts, schema.cohorts.id));
    this.authorization.registerLoader("room", exists(schema.rooms, schema.rooms.id));
    // An offering is its own access context: lecturers' and students' rights hang off it (§7.2).
    this.authorization.registerLoader("course-offering", async (key) => {
      if (!isUuid(key)) return null;
      const o = schema.courseOfferings;
      const [row] = await this.db.read.select({ id: o.id }).from(o).where(eq(o.id, key));
      return row === undefined ? null : { offeringId: row.id };
    });
  }
}

const services = [
  ProgrammesService,
  CoursesService,
  CurriculaService,
  RoomsService,
  OfferingsService,
  CohortsService,
];

@Module({
  imports: [AuditModule, AuthorizationModule],
  providers: [...services, AcademicResources],
  exports: services,
})
export class AcademicModule {}
