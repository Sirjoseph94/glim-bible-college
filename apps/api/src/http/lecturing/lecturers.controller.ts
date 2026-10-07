import { offerings, type BodyOf, type ParamsOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import { LecturersService } from "@glim/modules/lecturing";
import { unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Lecturer profiles (TRD §16 People). */
@Controller()
export class LecturersController {
  constructor(@Inject(LecturersService) private readonly lecturers: LecturersService) {}

  @Endpoint(offerings.listLecturers)
  async list(): Promise<Reply<typeof offerings.listLecturers>> {
    return { items: await this.lecturers.list() };
  }

  @Endpoint(offerings.createLecturer)
  async create(
    @Body(offerings.createLecturer) body: BodyOf<typeof offerings.createLecturer>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof offerings.createLecturer>> {
    return unwrap(await this.lecturers.create(body, actor));
  }

  @Endpoint(offerings.updateLecturer)
  async update(
    @Params(offerings.updateLecturer) params: ParamsOf<typeof offerings.updateLecturer>,
    @IfMatch() version: number,
    @Body(offerings.updateLecturer) body: BodyOf<typeof offerings.updateLecturer>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof offerings.updateLecturer>> {
    return unwrap(await this.lecturers.update(params.id, version, body, actor));
  }
}
