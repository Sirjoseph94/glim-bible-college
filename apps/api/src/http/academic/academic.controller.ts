import { academic, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import { CoursesService, CurriculaService, ProgrammesService } from "@glim/modules/academic";
import type { AuditActor } from "@glim/modules/audit";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof academic.getCurriculum>;

/** Programmes, the course catalogue and curricula (TRD §9.1, §16 Academic). */
@Controller()
export class AcademicController {
  constructor(
    @Inject(ProgrammesService) private readonly programmes: ProgrammesService,
    @Inject(CoursesService) private readonly courses: CoursesService,
    @Inject(CurriculaService) private readonly curricula: CurriculaService,
  ) {}

  @Endpoint(academic.listProgrammes)
  async listProgrammes(): Promise<Reply<typeof academic.listProgrammes>> {
    return { items: await this.programmes.list() };
  }

  @Endpoint(academic.createProgramme)
  async createProgramme(
    @Body(academic.createProgramme) body: BodyOf<typeof academic.createProgramme>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof academic.createProgramme>> {
    return unwrap(await this.programmes.create(body, actor));
  }

  @Endpoint(academic.updateProgramme)
  async updateProgramme(
    @Params(academic.updateProgramme) params: IdParams,
    @IfMatch() version: number,
    @Body(academic.updateProgramme) body: BodyOf<typeof academic.updateProgramme>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof academic.updateProgramme>> {
    return unwrap(await this.programmes.update(params.id, version, body, actor));
  }

  @Endpoint(academic.listCourses)
  listCourses(
    @Query(academic.listCourses) query: QueryOf<typeof academic.listCourses>,
  ): Promise<Reply<typeof academic.listCourses>> {
    return this.courses.list(query);
  }

  @Endpoint(academic.createCourse)
  async createCourse(
    @Body(academic.createCourse) body: BodyOf<typeof academic.createCourse>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof academic.createCourse>> {
    return unwrap(await this.courses.create(body, actor));
  }

  @Endpoint(academic.updateCourse)
  async updateCourse(
    @Params(academic.updateCourse) params: IdParams,
    @IfMatch() version: number,
    @Body(academic.updateCourse) body: BodyOf<typeof academic.updateCourse>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof academic.updateCourse>> {
    return unwrap(await this.courses.update(params.id, version, body, actor));
  }

  @Endpoint(academic.listCurricula)
  async listCurricula(
    @Query(academic.listCurricula) query: QueryOf<typeof academic.listCurricula>,
  ): Promise<Reply<typeof academic.listCurricula>> {
    return { items: await this.curricula.list(query.programmeId) };
  }

  @Endpoint(academic.getCurriculum)
  async getCurriculum(
    @Params(academic.getCurriculum) params: IdParams,
  ): Promise<Reply<typeof academic.getCurriculum>> {
    const detail = await this.curricula.get(params.id);
    if (detail === null) throw new AppError("NOT_FOUND", "Not found.");
    return detail;
  }

  @Endpoint(academic.createCurriculum)
  async createCurriculum(
    @Body(academic.createCurriculum) body: BodyOf<typeof academic.createCurriculum>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof academic.createCurriculum>> {
    return unwrap(await this.curricula.create(body, actor));
  }

  @Endpoint(academic.updateCurriculum)
  async updateCurriculum(
    @Params(academic.updateCurriculum) params: IdParams,
    @IfMatch() version: number,
    @Body(academic.updateCurriculum) body: BodyOf<typeof academic.updateCurriculum>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof academic.updateCurriculum>> {
    return unwrap(await this.curricula.update(params.id, version, body, actor));
  }

  @Endpoint(academic.putPlacements)
  async putPlacements(
    @Params(academic.putPlacements) params: IdParams,
    @IfMatch() version: number,
    @Body(academic.putPlacements) body: BodyOf<typeof academic.putPlacements>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof academic.putPlacements>> {
    return unwrap(
      await this.curricula.replacePlacements(params.id, version, body.placements, actor),
    );
  }

  @Endpoint(academic.activateCurriculum)
  async activateCurriculum(
    @Params(academic.activateCurriculum) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof academic.activateCurriculum>> {
    return unwrap(await this.curricula.activate(params.id, actor));
  }

  @Endpoint(academic.cloneCurriculum)
  async cloneCurriculum(
    @Params(academic.cloneCurriculum) params: IdParams,
    @Body(academic.cloneCurriculum) body: BodyOf<typeof academic.cloneCurriculum>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof academic.cloneCurriculum>> {
    return unwrap(await this.curricula.clone(params.id, body.effectiveFrom, actor));
  }
}
