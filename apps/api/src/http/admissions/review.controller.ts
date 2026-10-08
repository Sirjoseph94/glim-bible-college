import { admissions, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import { OffersService, ReviewService } from "@glim/modules/admissions";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

type IdParams = ParamsOf<typeof admissions.getReviewedApplication>;

/** The Admissions Officers' queue, review and decision (TRD §10.3). */
@Controller()
export class ReviewController {
  constructor(
    @Inject(ReviewService) private readonly review: ReviewService,
    @Inject(OffersService) private readonly offers: OffersService,
  ) {}

  @Endpoint(admissions.listApplications)
  queue(
    @Query(admissions.listApplications) query: QueryOf<typeof admissions.listApplications>,
  ): Promise<Reply<typeof admissions.listApplications>> {
    return this.review.queue(query);
  }

  @Endpoint(admissions.getReviewedApplication)
  async get(
    @Params(admissions.getReviewedApplication) params: IdParams,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof admissions.getReviewedApplication>> {
    const found = await this.review.get(params.id, session.userId);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(admissions.startReview)
  async startReview(
    @Params(admissions.startReview) params: IdParams,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof admissions.startReview>> {
    return unwrap(await this.review.startReview(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(admissions.addApplicationNote)
  async addNote(
    @Params(admissions.addApplicationNote) params: IdParams,
    @Body(admissions.addApplicationNote) body: BodyOf<typeof admissions.addApplicationNote>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof admissions.addApplicationNote>> {
    return unwrap(
      await this.review.addNote(params.id, body.note, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(admissions.decideApplication)
  async decide(
    @Params(admissions.decideApplication) params: IdParams,
    @Body(admissions.decideApplication) body: BodyOf<typeof admissions.decideApplication>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof admissions.decideApplication>> {
    return unwrap(await this.review.decide(params.id, body, { ...actor, userId: session.userId }));
  }

  @Endpoint(admissions.reopenOffer)
  async reopen(
    @Params(admissions.reopenOffer) params: IdParams,
    @Body(admissions.reopenOffer) body: BodyOf<typeof admissions.reopenOffer>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof admissions.reopenOffer>> {
    return unwrap(
      await this.offers.reopen(params.id, body.reason, { ...actor, userId: session.userId }),
    );
  }
}
