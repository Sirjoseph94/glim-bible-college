import { offerings, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import { OfferingsService } from "@glim/modules/academic";
import type { AuditActor } from "@glim/modules/audit";
import { AuthorizationService } from "@glim/modules/authorization";
import type { ActiveSession } from "@glim/modules/identity";
import {
  AssignmentsService,
  OfferingViewsService,
  type OfferingView,
} from "@glim/modules/lecturing";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof offerings.getOffering>;

/** Course Offerings and who teaches them (TRD §9.2, §9.4). */
@Controller()
export class OfferingsController {
  constructor(
    @Inject(OfferingsService) private readonly offerings: OfferingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(OfferingViewsService) private readonly views: OfferingViewsService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  /** Academic staff see every offering; a Lecturer sees the ones they teach (filtered in SQL). */
  @Endpoint(offerings.listOfferings)
  async list(
    @Query(offerings.listOfferings) query: QueryOf<typeof offerings.listOfferings>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof offerings.listOfferings>> {
    const roles = await this.authorization.principal(session.userId).roles();
    const seeAll = AuthorizationService.staffGrants(roles, "academic:course-offering:read");
    return { items: await this.views.listVisible({ userId: session.userId, seeAll, ...query }) };
  }

  @Endpoint(offerings.createOffering)
  async create(
    @Body(offerings.createOffering) body: BodyOf<typeof offerings.createOffering>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof offerings.createOffering>> {
    return this.detail(unwrap(await this.assignments.createOfferingWithLecturers(body, actor)));
  }

  @Endpoint(offerings.getOffering)
  get(
    @Params(offerings.getOffering) params: IdParams,
  ): Promise<Reply<typeof offerings.getOffering>> {
    return this.detail(params.id);
  }

  @Endpoint(offerings.updateOffering)
  async update(
    @Params(offerings.updateOffering) params: IdParams,
    @IfMatch() version: number,
    @Body(offerings.updateOffering) body: BodyOf<typeof offerings.updateOffering>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof offerings.updateOffering>> {
    unwrap(await this.offerings.update(params.id, version, body, actor));
    return this.detail(params.id);
  }

  @Endpoint(offerings.publishOffering)
  async publish(
    @Params(offerings.publishOffering) params: IdParams,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof offerings.publishOffering>> {
    unwrap(await this.offerings.publish(params.id, actor));
    return this.detail(params.id);
  }

  @Endpoint(offerings.cancelOffering)
  async cancel(
    @Params(offerings.cancelOffering) params: IdParams,
    @Body(offerings.cancelOffering) body: BodyOf<typeof offerings.cancelOffering>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof offerings.cancelOffering>> {
    unwrap(await this.offerings.cancel(params.id, body.reason, actor));
    return this.detail(params.id);
  }

  @Endpoint(offerings.listOfferingLecturers)
  async lecturers(
    @Params(offerings.listOfferingLecturers) params: IdParams,
  ): Promise<Reply<typeof offerings.listOfferingLecturers>> {
    return { items: await this.views.assignments(params.id) };
  }

  @Endpoint(offerings.assignLecturer)
  async assign(
    @Params(offerings.assignLecturer) params: IdParams,
    @Body(offerings.assignLecturer) body: BodyOf<typeof offerings.assignLecturer>,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof offerings.assignLecturer>> {
    unwrap(await this.assignments.assign(params.id, body.lecturerId, body.role, actor));
    return this.detail(params.id);
  }

  @Endpoint(offerings.endAssignment)
  async endAssignment(
    @Params(offerings.endAssignment) params: ParamsOf<typeof offerings.endAssignment>,
    @Actor() actor: AuditActor,
  ): Promise<void> {
    unwrap(await this.assignments.end(params.id, params.assignmentId, actor));
  }

  private async detail(id: string): Promise<OfferingView> {
    const view = await this.views.detail(id);
    if (view === null) throw new AppError("NOT_FOUND", "Not found.");
    return view;
  }
}
