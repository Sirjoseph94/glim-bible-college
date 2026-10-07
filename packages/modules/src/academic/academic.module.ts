import { Db, schema } from "@glim/db";
import { AuditModule } from "@glim/modules/audit";
import { AuthorizationModule, AuthorizationService } from "@glim/modules/authorization";
import { isUuid } from "@glim/shared";
import { Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { CalendarService } from "./calendar.service";
import { CoursesService } from "./courses.service";
import { CurriculaService } from "./curricula.service";
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
    this.authorization.registerLoader(
      "academic-session",
      exists(schema.academicSessions, schema.academicSessions.id),
    );
    this.authorization.registerLoader("semester", exists(schema.semesters, schema.semesters.id));
    this.authorization.registerLoader("room", exists(schema.rooms, schema.rooms.id));
  }
}

const services = [
  ProgrammesService,
  CoursesService,
  CurriculaService,
  CalendarService,
  RoomsService,
];

@Module({
  imports: [AuditModule, AuthorizationModule],
  providers: [...services, AcademicResources],
  exports: services,
})
export class AcademicModule {}
