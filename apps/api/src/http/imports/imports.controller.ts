import { imports, type BodyOf, type ParamsOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { ImportsService } from "@glim/modules/imports";
import { AppError, Csv, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params } from "../../common/endpoint";
import type { Reply, ReplyOrCsv } from "../../common/response.interceptor";

/** CSV imports (TRD §15.2): templates, dry runs and commits. */
@Controller()
export class ImportsController {
  constructor(@Inject(ImportsService) private readonly imports: ImportsService) {}

  @Endpoint(imports.getImportTemplate)
  template(
    @Params(imports.getImportTemplate) params: ParamsOf<typeof imports.getImportTemplate>,
  ): ReplyOrCsv<typeof imports.getImportTemplate> {
    return new Csv(`${params.kind.toLowerCase()}-template.csv`, this.imports.template(params.kind));
  }

  @Endpoint(imports.startImport)
  async start(
    @Body(imports.startImport) body: BodyOf<typeof imports.startImport>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof imports.startImport>> {
    return unwrap(await this.imports.start(body, { ...actor, userId: session.userId }));
  }

  @Endpoint(imports.listImports)
  async list(): Promise<Reply<typeof imports.listImports>> {
    return { items: await this.imports.list() };
  }

  @Endpoint(imports.getImport)
  async get(
    @Params(imports.getImport) params: ParamsOf<typeof imports.getImport>,
  ): Promise<Reply<typeof imports.getImport>> {
    const found = await this.imports.get(params.id);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }
}
