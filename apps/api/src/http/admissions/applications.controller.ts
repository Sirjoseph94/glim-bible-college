import { applications, type BodyOf, type ParamsOf } from "@glim/contracts";
import { ApplicationsService } from "@glim/modules/admissions";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof applications.getApplication>;

/** The applicant's own application (TRD §10.2); the guard has already checked ownership. */
@Controller()
export class ApplicationsController {
  constructor(@Inject(ApplicationsService) private readonly applications: ApplicationsService) {}

  @Endpoint(applications.startApplication)
  async start(
    @Body(applications.startApplication) body: BodyOf<typeof applications.startApplication>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof applications.startApplication>> {
    return unwrap(await this.applications.start(body, { ...actor, userId: session.userId }));
  }

  @Endpoint(applications.myApplications)
  async mine(
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof applications.myApplications>> {
    return { items: await this.applications.mine(session.userId) };
  }

  @Endpoint(applications.getApplication)
  async get(
    @Params(applications.getApplication) params: IdParams,
  ): Promise<Reply<typeof applications.getApplication>> {
    const found = await this.applications.get(params.id);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(applications.saveApplicationDraft)
  async save(
    @Params(applications.saveApplicationDraft) params: IdParams,
    @IfMatch() version: number,
    @Body(applications.saveApplicationDraft)
    body: BodyOf<typeof applications.saveApplicationDraft>,
  ): Promise<Reply<typeof applications.saveApplicationDraft>> {
    return unwrap(await this.applications.saveDraft(params.id, version, body));
  }
}
