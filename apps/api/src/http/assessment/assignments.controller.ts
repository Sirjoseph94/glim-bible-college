import { assessment, type BodyOf, type ParamsOf } from "@glim/contracts";
import { AssignmentsService, GradesService, SubmissionsService } from "@glim/modules/assessment";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** Assignments, submissions and grading (TRD §14.2). */
@Controller()
export class AssignmentsController {
  constructor(
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(SubmissionsService) private readonly submissions: SubmissionsService,
    @Inject(GradesService) private readonly grades: GradesService,
  ) {}

  @Endpoint(assessment.listAssignments)
  async list(
    @Params(assessment.listAssignments) params: ParamsOf<typeof assessment.listAssignments>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.listAssignments>> {
    return { items: await this.assignments.list(params.id, session.userId) };
  }

  @Endpoint(assessment.createAssignment)
  async create(
    @Params(assessment.createAssignment) params: ParamsOf<typeof assessment.createAssignment>,
    @Body(assessment.createAssignment) body: BodyOf<typeof assessment.createAssignment>,
  ): Promise<Reply<typeof assessment.createAssignment>> {
    return unwrap(await this.assignments.create(params.id, body));
  }

  @Endpoint(assessment.getAssignment)
  async get(
    @Params(assessment.getAssignment) params: ParamsOf<typeof assessment.getAssignment>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.getAssignment>> {
    const found = await this.assignments.get(params.id, session.userId);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(assessment.updateAssignment)
  async update(
    @Params(assessment.updateAssignment) params: ParamsOf<typeof assessment.updateAssignment>,
    @Body(assessment.updateAssignment) body: BodyOf<typeof assessment.updateAssignment>,
    @IfMatch() version: number,
  ): Promise<Reply<typeof assessment.updateAssignment>> {
    return unwrap(await this.assignments.update(params.id, version, body));
  }

  @Endpoint(assessment.publishAssignment)
  async publish(
    @Params(assessment.publishAssignment) params: ParamsOf<typeof assessment.publishAssignment>,
  ): Promise<Reply<typeof assessment.publishAssignment>> {
    return unwrap(await this.assignments.publish(params.id));
  }

  @Endpoint(assessment.getMySubmissions)
  async mine(
    @Params(assessment.getMySubmissions) params: ParamsOf<typeof assessment.getMySubmissions>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.getMySubmissions>> {
    return unwrap(await this.submissions.mine(params.id, session.userId));
  }

  @Endpoint(assessment.saveDraft)
  async saveDraft(
    @Params(assessment.saveDraft) params: ParamsOf<typeof assessment.saveDraft>,
    @Body(assessment.saveDraft) body: BodyOf<typeof assessment.saveDraft>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.saveDraft>> {
    return unwrap(await this.submissions.saveDraft(params.id, session.userId, body));
  }

  @Endpoint(assessment.submitDraft)
  async submit(
    @Params(assessment.submitDraft) params: ParamsOf<typeof assessment.submitDraft>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.submitDraft>> {
    return unwrap(await this.submissions.submit(params.id, session.userId));
  }

  @Endpoint(assessment.listSubmissions)
  async forGrading(
    @Params(assessment.listSubmissions) params: ParamsOf<typeof assessment.listSubmissions>,
  ): Promise<Reply<typeof assessment.listSubmissions>> {
    return { items: unwrap(await this.submissions.forGrading(params.id)) };
  }

  @Endpoint(assessment.downloadSubmissionFile)
  async download(
    @Params(assessment.downloadSubmissionFile)
    params: ParamsOf<typeof assessment.downloadSubmissionFile>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const url = await this.submissions.fileUrl(params.id, params.fileId);
    if (url === null) throw new AppError("NOT_FOUND", "Not found.");
    void reply.header("cache-control", "private, max-age=240");
    return void reply.redirect(url, 302);
  }

  @Endpoint(assessment.putGrade)
  async putGrade(
    @Params(assessment.putGrade) params: ParamsOf<typeof assessment.putGrade>,
    @Body(assessment.putGrade) body: BodyOf<typeof assessment.putGrade>,
    @IfMatch() version: number,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.putGrade>> {
    return unwrap(
      await this.grades.put(params.id, params.studentId, version, body, {
        ...actor,
        userId: session.userId,
      }),
    );
  }
}
