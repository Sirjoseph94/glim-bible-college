import { transcripts, type BodyOf, type ParamsOf, type QueryOf } from "@glim/contracts";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { TranscriptsService } from "@glim/modules/transcripts";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, Params, Query } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Transcript requests, issue, and public verification (§14.7). */
@Controller()
export class TranscriptsController {
  constructor(@Inject(TranscriptsService) private readonly transcripts: TranscriptsService) {}

  @Endpoint(transcripts.requestTranscript)
  async request(
    @Params(transcripts.requestTranscript) params: ParamsOf<typeof transcripts.requestTranscript>,
    @Body(transcripts.requestTranscript) body: BodyOf<typeof transcripts.requestTranscript>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof transcripts.requestTranscript>> {
    return unwrap(
      await this.transcripts.request(params.id, body, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(transcripts.getMyTranscripts)
  async mine(
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof transcripts.getMyTranscripts>> {
    return { items: await this.transcripts.mine(session.userId) };
  }

  @Endpoint(transcripts.listTranscriptRequests)
  async list(
    @Query(transcripts.listTranscriptRequests)
    query: QueryOf<typeof transcripts.listTranscriptRequests>,
  ): Promise<Reply<typeof transcripts.listTranscriptRequests>> {
    return { items: await this.transcripts.listRequests(query.status) };
  }

  @Endpoint(transcripts.approveTranscriptRequest)
  async approve(
    @Params(transcripts.approveTranscriptRequest)
    params: ParamsOf<typeof transcripts.approveTranscriptRequest>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof transcripts.approveTranscriptRequest>> {
    return unwrap(await this.transcripts.approve(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(transcripts.rejectTranscriptRequest)
  async reject(
    @Params(transcripts.rejectTranscriptRequest)
    params: ParamsOf<typeof transcripts.rejectTranscriptRequest>,
    @Body(transcripts.rejectTranscriptRequest)
    body: BodyOf<typeof transcripts.rejectTranscriptRequest>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof transcripts.rejectTranscriptRequest>> {
    return unwrap(
      await this.transcripts.reject(params.id, body.reason, { ...actor, userId: session.userId }),
    );
  }

  @Endpoint(transcripts.issueTranscript)
  async issue(
    @Params(transcripts.issueTranscript) params: ParamsOf<typeof transcripts.issueTranscript>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof transcripts.issueTranscript>> {
    return unwrap(await this.transcripts.issue(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(transcripts.getTranscript)
  async get(
    @Params(transcripts.getTranscript) params: ParamsOf<typeof transcripts.getTranscript>,
  ): Promise<Reply<typeof transcripts.getTranscript>> {
    const found = await this.transcripts.get(params.id);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(transcripts.verifyTranscript)
  async verify(
    @Params(transcripts.verifyTranscript) params: ParamsOf<typeof transcripts.verifyTranscript>,
  ): Promise<Reply<typeof transcripts.verifyTranscript>> {
    const found = await this.transcripts.verify(params.code);
    if (found === null)
      throw new AppError("NOT_FOUND", "No transcript has this verification code.");
    return found;
  }
}
