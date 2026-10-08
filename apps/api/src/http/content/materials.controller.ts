import { content, type BodyOf, type ParamsOf } from "@glim/contracts";
import { MaterialsService } from "@glim/modules/content";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** A course's materials and announcements (TRD §14.1). */
@Controller()
export class MaterialsController {
  constructor(@Inject(MaterialsService) private readonly materials: MaterialsService) {}

  @Endpoint(content.listMaterials)
  async list(
    @Params(content.listMaterials) params: ParamsOf<typeof content.listMaterials>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof content.listMaterials>> {
    return { items: await this.materials.list(params.id, session.userId) };
  }

  @Endpoint(content.createMaterial)
  async create(
    @Params(content.createMaterial) params: ParamsOf<typeof content.createMaterial>,
    @Body(content.createMaterial) body: BodyOf<typeof content.createMaterial>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof content.createMaterial>> {
    return unwrap(await this.materials.create(params.id, body, session.userId));
  }

  @Endpoint(content.updateMaterial)
  async update(
    @Params(content.updateMaterial) params: ParamsOf<typeof content.updateMaterial>,
    @Body(content.updateMaterial) body: BodyOf<typeof content.updateMaterial>,
    @IfMatch() version: number,
  ): Promise<Reply<typeof content.updateMaterial>> {
    return unwrap(await this.materials.update(params.id, version, body));
  }

  @Endpoint(content.deleteMaterial)
  async remove(
    @Params(content.deleteMaterial) params: ParamsOf<typeof content.deleteMaterial>,
  ): Promise<void> {
    unwrap(await this.materials.remove(params.id));
  }

  @Endpoint(content.downloadMaterial)
  async download(
    @Params(content.downloadMaterial) params: ParamsOf<typeof content.downloadMaterial>,
    @CurrentSession() session: ActiveSession,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const url = await this.materials.downloadUrl(params.id, session.userId);
    if (url === null) throw new AppError("NOT_FOUND", "Not found.");
    void reply.header("cache-control", "private, max-age=240");
    return void reply.redirect(url, 302);
  }

  @Endpoint(content.listAnnouncements)
  async announcements(
    @Params(content.listAnnouncements) params: ParamsOf<typeof content.listAnnouncements>,
  ): Promise<Reply<typeof content.listAnnouncements>> {
    return { items: await this.materials.announcements(params.id) };
  }

  @Endpoint(content.createAnnouncement)
  async announce(
    @Params(content.createAnnouncement) params: ParamsOf<typeof content.createAnnouncement>,
    @Body(content.createAnnouncement) body: BodyOf<typeof content.createAnnouncement>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof content.createAnnouncement>> {
    return unwrap(await this.materials.announce(params.id, body, session.userId));
  }

  @Endpoint(content.updateAnnouncement)
  async updateAnnouncement(
    @Params(content.updateAnnouncement) params: ParamsOf<typeof content.updateAnnouncement>,
    @Body(content.updateAnnouncement) body: BodyOf<typeof content.updateAnnouncement>,
    @IfMatch() version: number,
  ): Promise<Reply<typeof content.updateAnnouncement>> {
    return unwrap(await this.materials.updateAnnouncement(params.id, version, body));
  }

  @Endpoint(content.deleteAnnouncement)
  async deleteAnnouncement(
    @Params(content.deleteAnnouncement) params: ParamsOf<typeof content.deleteAnnouncement>,
  ): Promise<void> {
    unwrap(await this.materials.deleteAnnouncement(params.id));
  }
}
