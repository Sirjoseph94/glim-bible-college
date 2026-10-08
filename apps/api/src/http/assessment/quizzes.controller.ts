import { assessment, type BodyOf, type ParamsOf } from "@glim/contracts";
import { QuizAttemptsService, QuizzesService } from "@glim/modules/assessment";
import type { AuditActor } from "@glim/modules/audit";
import type { ActiveSession } from "@glim/modules/identity";
import { AppError, unwrap } from "@glim/shared";
import { Controller, Inject } from "@nestjs/common";
import { Actor, CurrentSession } from "../../common/auth.guard";
import { Body, Endpoint, IfMatch, Params } from "../../common/endpoint";
import type { Reply } from "../../common/response.interceptor";

/** The question bank, quizzes and attempts (TRD §14.2). */
@Controller()
export class QuizzesController {
  constructor(
    @Inject(QuizzesService) private readonly quizzes: QuizzesService,
    @Inject(QuizAttemptsService) private readonly attempts: QuizAttemptsService,
  ) {}

  @Endpoint(assessment.listQuestions)
  async questions(
    @Params(assessment.listQuestions) params: ParamsOf<typeof assessment.listQuestions>,
  ): Promise<Reply<typeof assessment.listQuestions>> {
    return { items: await this.quizzes.questions(params.id) };
  }

  @Endpoint(assessment.createQuestion)
  async createQuestion(
    @Params(assessment.createQuestion) params: ParamsOf<typeof assessment.createQuestion>,
    @Body(assessment.createQuestion) body: BodyOf<typeof assessment.createQuestion>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.createQuestion>> {
    return unwrap(await this.quizzes.createQuestion(params.id, body, session.userId));
  }

  @Endpoint(assessment.listQuizzes)
  async list(
    @Params(assessment.listQuizzes) params: ParamsOf<typeof assessment.listQuizzes>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.listQuizzes>> {
    return { items: await this.quizzes.list(params.id, session.userId) };
  }

  @Endpoint(assessment.createQuiz)
  async create(
    @Params(assessment.createQuiz) params: ParamsOf<typeof assessment.createQuiz>,
    @Body(assessment.createQuiz) body: BodyOf<typeof assessment.createQuiz>,
  ): Promise<Reply<typeof assessment.createQuiz>> {
    return unwrap(await this.quizzes.create(params.id, body));
  }

  @Endpoint(assessment.getQuiz)
  async get(
    @Params(assessment.getQuiz) params: ParamsOf<typeof assessment.getQuiz>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.getQuiz>> {
    const found = await this.quizzes.get(params.id, session.userId);
    if (found === null) throw new AppError("NOT_FOUND", "Not found.");
    return found;
  }

  @Endpoint(assessment.updateQuiz)
  async update(
    @Params(assessment.updateQuiz) params: ParamsOf<typeof assessment.updateQuiz>,
    @Body(assessment.updateQuiz) body: BodyOf<typeof assessment.updateQuiz>,
    @IfMatch() version: number,
  ): Promise<Reply<typeof assessment.updateQuiz>> {
    return unwrap(await this.quizzes.update(params.id, version, body));
  }

  @Endpoint(assessment.publishQuiz)
  async publish(
    @Params(assessment.publishQuiz) params: ParamsOf<typeof assessment.publishQuiz>,
  ): Promise<Reply<typeof assessment.publishQuiz>> {
    return unwrap(await this.quizzes.publish(params.id));
  }

  @Endpoint(assessment.startAttempt)
  async start(
    @Params(assessment.startAttempt) params: ParamsOf<typeof assessment.startAttempt>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.startAttempt>> {
    return unwrap(await this.attempts.start(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(assessment.getMyQuizAttempts)
  async mine(
    @Params(assessment.getMyQuizAttempts) params: ParamsOf<typeof assessment.getMyQuizAttempts>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.getMyQuizAttempts>> {
    return unwrap(await this.attempts.mine(params.id, session.userId));
  }

  @Endpoint(assessment.getQuizAttempt)
  async attempt(
    @Params(assessment.getQuizAttempt) params: ParamsOf<typeof assessment.getQuizAttempt>,
    @CurrentSession() session: ActiveSession,
  ): Promise<Reply<typeof assessment.getQuizAttempt>> {
    return unwrap(await this.attempts.get(params.id, session.userId));
  }

  @Endpoint(assessment.saveQuizResponses)
  async save(
    @Params(assessment.saveQuizResponses) params: ParamsOf<typeof assessment.saveQuizResponses>,
    @Body(assessment.saveQuizResponses) body: BodyOf<typeof assessment.saveQuizResponses>,
  ): Promise<Reply<typeof assessment.saveQuizResponses>> {
    return unwrap(await this.attempts.save(params.id, body));
  }

  @Endpoint(assessment.submitQuizAttempt)
  async submit(
    @Params(assessment.submitQuizAttempt) params: ParamsOf<typeof assessment.submitQuizAttempt>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.submitQuizAttempt>> {
    return unwrap(await this.attempts.submit(params.id, { ...actor, userId: session.userId }));
  }

  @Endpoint(assessment.listQuizAttempts)
  async forGrading(
    @Params(assessment.listQuizAttempts) params: ParamsOf<typeof assessment.listQuizAttempts>,
  ): Promise<Reply<typeof assessment.listQuizAttempts>> {
    return { items: await this.attempts.forGrading(params.id) };
  }

  @Endpoint(assessment.markQuizResponse)
  async mark(
    @Params(assessment.markQuizResponse) params: ParamsOf<typeof assessment.markQuizResponse>,
    @Body(assessment.markQuizResponse) body: BodyOf<typeof assessment.markQuizResponse>,
    @CurrentSession() session: ActiveSession,
    @Actor() actor: AuditActor,
  ): Promise<Reply<typeof assessment.markQuizResponse>> {
    return unwrap(
      await this.attempts.mark(params.id, params.questionId, body, {
        ...actor,
        userId: session.userId,
      }),
    );
  }
}
