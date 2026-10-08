import { files, type BodyOf, type ParamsOf } from "@glim/contracts";
import { FilesService } from "@glim/modules/content";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof files.downloadFile>;

/**
 * Uploads and downloads (TRD §14.1). Bytes go straight between the browser and the bucket; who
 * may fetch a file is decided by FilesService (the owner, or a role that reads that purpose).
 */
@Controller()
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Endpoint(files.createUpload)
  async createUpload(
    @Body(files.createUpload) body: BodyOf<typeof files.createUpload>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof files.createUpload>> {
    return unwrap(await this.files.createUpload(session.userId, body));
  }

  @Endpoint(files.completeUpload)
  async complete(
    @Params(files.completeUpload) params: IdParams,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof files.completeUpload>> {
    return unwrap(await this.files.complete(params.id, session.userId));
  }

  @Endpoint(files.downloadFile)
  async download(
    @Params(files.downloadFile) params: IdParams,
    @CurrentSession() session: ActiveSession,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const url = await this.files.downloadUrl(params.id, session.userId);
    if (url === null) throw new AppError("NOT_FOUND", "Not found.");
    void reply.header("cache-control", "private, max-age=240");
    return void reply.redirect(url, 302);
  }
}
