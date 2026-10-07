import { calendar, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import { CalendarService, RoomsService } from "@glim/modules/academic";
import type { AuditActor } from "@glim/modules/audit";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof calendar.updateRoom>;

/** Academic Sessions, semesters and Rooms (TRD §9.1, §16 Calendar). */
@Controller()
export class CalendarController {
  constructor(
    @Inject(CalendarService) private readonly calendar: CalendarService,
    @Inject(RoomsService) private readonly rooms: RoomsService,
  ) {}

  @Endpoint(calendar.listAcademicSessions)
  async listSessions(): Promise<Reply<typeof calendar.listAcademicSessions>> {
    return { items: await this.calendar.listSessions() };
  }

  @Endpoint(calendar.createAcademicSession)
  async createSession(
    @Body(calendar.createAcademicSession) body: BodyOf<typeof calendar.createAcademicSession>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.createAcademicSession>> {
    return unwrap(await this.calendar.createSession(body, actor));
  }

  @Endpoint(calendar.updateAcademicSession)
  async updateSession(
    @Params(calendar.updateAcademicSession) params: IdParams,
    @IfMatch() version: number,
    @Body(calendar.updateAcademicSession) body: BodyOf<typeof calendar.updateAcademicSession>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.updateAcademicSession>> {
    return unwrap(await this.calendar.updateSession(params.id, version, body, actor));
  }

  @Endpoint(calendar.activateAcademicSession)
  async activateSession(
    @Params(calendar.activateAcademicSession) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.activateAcademicSession>> {
    return unwrap(await this.calendar.activateSession(params.id, actor));
  }

  @Endpoint(calendar.closeAcademicSession)
  async closeSession(
    @Params(calendar.closeAcademicSession) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.closeAcademicSession>> {
    return unwrap(await this.calendar.closeSession(params.id, actor));
  }

  @Endpoint(calendar.listSemesters)
  async listSemesters(
    @Query(calendar.listSemesters) query: QueryOf<typeof calendar.listSemesters>,
  ): Promise<Reply<typeof calendar.listSemesters>> {
    return { items: await this.calendar.listSemesters(query.sessionId) };
  }

  @Endpoint(calendar.createSemester)
  async createSemester(
    @Body(calendar.createSemester) body: BodyOf<typeof calendar.createSemester>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.createSemester>> {
    return unwrap(await this.calendar.createSemester(body, actor));
  }

  @Endpoint(calendar.updateSemester)
  async updateSemester(
    @Params(calendar.updateSemester) params: IdParams,
    @IfMatch() version: number,
    @Body(calendar.updateSemester) body: BodyOf<typeof calendar.updateSemester>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.updateSemester>> {
    return unwrap(await this.calendar.updateSemester(params.id, version, body, actor));
  }

  @Endpoint(calendar.openSemesterRegistration)
  async openRegistration(
    @Params(calendar.openSemesterRegistration) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.openSemesterRegistration>> {
    return unwrap(await this.calendar.openRegistration(params.id, actor));
  }

  @Endpoint(calendar.activateSemester)
  async activateSemester(
    @Params(calendar.activateSemester) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.activateSemester>> {
    return unwrap(await this.calendar.activateSemester(params.id, actor));
  }

  @Endpoint(calendar.closeSemester)
  async closeSemester(
    @Params(calendar.closeSemester) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.closeSemester>> {
    return unwrap(await this.calendar.closeSemester(params.id, actor));
  }

  @Endpoint(calendar.listRooms)
  async listRooms(): Promise<Reply<typeof calendar.listRooms>> {
    return { items: await this.rooms.list() };
  }

  @Endpoint(calendar.createRoom)
  async createRoom(
    @Body(calendar.createRoom) body: BodyOf<typeof calendar.createRoom>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.createRoom>> {
    return unwrap(await this.rooms.create(body, actor));
  }

  @Endpoint(calendar.updateRoom)
  async updateRoom(
    @Params(calendar.updateRoom) params: IdParams,
    @IfMatch() version: number,
    @Body(calendar.updateRoom) body: BodyOf<typeof calendar.updateRoom>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof calendar.updateRoom>> {
    return unwrap(await this.rooms.update(params.id, version, body, actor));
  }
}
