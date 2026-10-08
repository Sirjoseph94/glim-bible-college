import type { Question, Quiz } from "@glim/contracts";
import { Db, schema, type Database, type QuestionOption } from "@glim/db";
import { AuthorizationService } from "@glim/modules/authorization";
import { renderMarkdown } from "@glim/modules/content";
import {
  CLOCK,
  definedFields,
  domainError,
  err,
  formatDecimal,
  ok,
  parseDecimal,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, max, sql, type SQL } from "drizzle-orm";

type QuizRow = typeof schema.quizzes.$inferSelect;
type QuestionRow = typeof schema.questions.$inferSelect;

export interface QuestionInput {
  qtype: "MCQ_SINGLE" | "MCQ_MULTI" | "TRUE_FALSE" | "SHORT_TEXT" | "ESSAY";
  promptMd: string;
  options?: QuestionOption[] | undefined;
  defaultPoints?: string | undefined;
  explanationMd?: string | null | undefined;
}

export interface QuizInput {
  title: string;
  weight: string;
  questions: { questionId: string; points?: string | undefined }[];
  instructionsMd?: string | null | undefined;
  timeLimitMinutes?: number | null | undefined;
  maxAttempts?: number | undefined;
  attemptScoring?: "HIGHEST" | "LAST" | "AVERAGE" | undefined;
  opensAt?: string | null | undefined;
  closesAt?: string | null | undefined;
  shuffleQuestions?: boolean | undefined;
  showAnswers?: "NEVER" | "AFTER_ATTEMPT" | "AFTER_CLOSE" | undefined;
}

export type QuizChange = { [K in keyof QuizInput]?: QuizInput[K] | undefined };

/** The online part of an exam: the exam column already has its title, maximum and weight. */
export type OnlineExamInput = Omit<QuizInput, "title" | "weight">;

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const invalid = (path: string, message: string): DomainError =>
  domainError("VALIDATION_FAILED", message, {
    fieldErrors: [{ path, code: "invalid", message }],
  });
const toDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(v);

/** Checks a question's options for its type and puts them in stored form. */
export function normaliseOptions(input: QuestionInput): DomainResult<QuestionOption[]> {
  const options = input.options ?? [];
  const ids = new Set(options.map((o) => o.id));
  if (ids.size !== options.length)
    return err(invalid("body.options", "Each option needs its own id."));
  const correct = options.filter((o) => o.correct).length;
  switch (input.qtype) {
    case "ESSAY":
      return options.length === 0
        ? ok([])
        : err(invalid("body.options", "An essay question has no options."));
    case "SHORT_TEXT":
      return options.length === 0
        ? err(invalid("body.options", "Give at least one accepted answer."))
        : ok(options.map((o) => ({ ...o, correct: true })));
    case "TRUE_FALSE": {
      const truth = options.find((o) => o.id === "true");
      if (options.length !== 2 || truth === undefined || !ids.has("false") || correct !== 1)
        return err(invalid("body.options", "Mark either True or False as the answer."));
      return ok([
        { id: "true", text: "True", correct: truth.correct },
        { id: "false", text: "False", correct: !truth.correct },
      ]);
    }
    case "MCQ_SINGLE":
      if (options.length < 2 || correct !== 1)
        return err(invalid("body.options", "Give at least two options and mark exactly one."));
      return ok(options);
    case "MCQ_MULTI":
      if (options.length < 2 || correct < 1)
        return err(invalid("body.options", "Give at least two options and mark the right ones."));
      return ok(options);
  }
}

/**
 * The question bank and quizzes (owner: assessment, TRD §14.2). The bank belongs to the course,
 * so every offering of it shares the questions; a quiz backs a QUIZ assessment whose maximum is
 * the total of its questions' points.
 */
@Injectable()
export class QuizzesService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  // ---- question bank ----

  async questions(offeringId: string): Promise<Question[]> {
    const courseId = await this.courseOf(this.db.read, offeringId);
    if (courseId === null) return [];
    const q = schema.questions;
    const rows = await this.db.read
      .select()
      .from(q)
      .where(and(eq(q.courseId, courseId), eq(q.status, "ACTIVE")))
      .orderBy(asc(q.createdAt), asc(q.id));
    return rows.map(toQuestion);
  }

  async createQuestion(
    offeringId: string,
    input: QuestionInput,
    authorUserId: string,
  ): Promise<DomainResult<Question>> {
    const options = normaliseOptions(input);
    if (!options.ok) return options;
    const courseId = await this.courseOf(this.db.read, offeringId);
    if (courseId === null) return notFound();
    const now = this.clock.now();
    const [row] = await this.db.withTx(({ db }) =>
      db
        .insert(schema.questions)
        .values({
          courseId,
          authorUserId,
          qtype: input.qtype,
          promptMd: input.promptMd,
          options: options.value,
          defaultPoints: input.defaultPoints ?? "1",
          explanationMd: input.explanationMd ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
    );
    if (row === undefined) throw new Error("question insert returned nothing");
    return ok(toQuestion(row));
  }

  // ---- quizzes ----

  async list(offeringId: string, viewerUserId: string): Promise<Quiz[]> {
    const manages = await this.manages(viewerUserId, offeringId);
    return this.views(
      and(eq(schema.quizzes.courseOfferingId, offeringId), this.visible(manages)),
      manages,
    );
  }

  async get(id: string, viewerUserId: string): Promise<Quiz | null> {
    const offeringId = await this.offeringOf(id);
    if (offeringId === null) return null;
    const manages = await this.manages(viewerUserId, offeringId);
    const [found] = await this.views(
      and(eq(schema.quizzes.id, id), this.visible(manages)),
      manages,
    );
    return found ?? null;
  }

  async create(offeringId: string, input: QuizInput): Promise<DomainResult<Quiz>> {
    const window = checkWindow(toDate(input.opensAt) ?? null, toDate(input.closesAt) ?? null);
    if (window !== null) return err(window);
    const result = await this.db.withTxResult(async ({ db }) => {
      const picked = await this.pickQuestions(db, offeringId, input.questions);
      if (!picked.ok) return picked;
      const now = this.clock.now();
      const a = schema.assessments;
      const [last] = await db
        .select({ position: max(a.position) })
        .from(a)
        .where(eq(a.courseOfferingId, offeringId));
      const [assessment] = await db
        .insert(a)
        .values({
          courseOfferingId: offeringId,
          kind: "QUIZ",
          title: input.title,
          maxScore: formatDecimal(picked.value.totalX100, 2),
          weight: input.weight,
          position: (last?.position ?? -1) + 1,
          dueAt: toDate(input.closesAt) ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: a.id });
      if (assessment === undefined) throw new Error("assessment insert returned nothing");
      const quizId = await this.insertQuiz(db, {
        offeringId,
        assessmentId: assessment.id,
        title: input.title,
        input,
        eligibleStudyMode: "ALL",
        rows: picked.value.rows,
        now,
      });
      return ok(quizId);
    });
    return result.ok ? ok(await this.one(result.value)) : result;
  }

  /**
   * Adds the timed online part to an EXAM column (C-34): a draft quiz for Online students (and
   * On-campus students the Lecturer lets in), whose score is scaled to the exam's maximum. An
   * exam has at most one.
   */
  async createOnlineExam(
    assessmentId: string,
    input: OnlineExamInput,
  ): Promise<DomainResult<Quiz>> {
    const window = checkWindow(toDate(input.opensAt) ?? null, toDate(input.closesAt) ?? null);
    if (window !== null) return err(window);
    const result = await this.db.withTxResult<string, DomainError>(async ({ db }) => {
      const a = schema.assessments;
      const [exam] = await db.select().from(a).where(eq(a.id, assessmentId)).for("update");
      if (exam === undefined) return notFound();
      if (exam.kind !== "EXAM")
        return err(domainError("CONFLICT", "Only an exam column can have an online part."));
      const [existing] = await db
        .select({ id: schema.quizzes.id })
        .from(schema.quizzes)
        .where(eq(schema.quizzes.assessmentId, assessmentId));
      if (existing !== undefined)
        return err(domainError("CONFLICT", "This exam already has an online part."));
      const picked = await this.pickQuestions(db, exam.courseOfferingId, input.questions);
      if (!picked.ok) return picked;
      const quizId = await this.insertQuiz(db, {
        offeringId: exam.courseOfferingId,
        assessmentId,
        title: exam.title,
        input,
        eligibleStudyMode: "ONLINE",
        rows: picked.value.rows,
        now: this.clock.now(),
      });
      return ok(quizId);
    });
    return result.ok ? ok(await this.one(result.value)) : result;
  }

  async update(
    id: string,
    expectedVersion: number,
    change: QuizChange,
  ): Promise<DomainResult<Quiz>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      const z = schema.quizzes;
      const [row] = await db.select().from(z).where(eq(z.id, id)).for("update");
      if (row === undefined) return notFound();
      if (row.version !== expectedVersion)
        return err(domainError("VERSION_MISMATCH", "Someone else changed this quiz. Reload it."));
      const opensAt = change.opensAt === undefined ? row.opensAt : (toDate(change.opensAt) ?? null);
      const closesAt =
        change.closesAt === undefined ? row.closesAt : (toDate(change.closesAt) ?? null);
      const window = checkWindow(opensAt, closesAt);
      if (window !== null) return err(window);
      const now = this.clock.now();
      const a = schema.assessments;
      const [column] = await db.select({ kind: a.kind }).from(a).where(eq(a.id, row.assessmentId));
      // An exam keeps its own maximum and date; a quiz's maximum is its questions' total.
      const exam = column?.kind === "EXAM";
      let maxScore: string | undefined;
      if (change.questions !== undefined) {
        if (row.status !== "DRAFT")
          return err(
            domainError(
              "CONFLICT",
              "A published quiz's questions can't change: students may have started it.",
            ),
          );
        const picked = await this.pickQuestions(db, row.courseOfferingId, change.questions);
        if (!picked.ok) return picked;
        await db.delete(schema.quizQuestions).where(eq(schema.quizQuestions.quizId, id));
        await this.setQuestions(db, id, picked.value.rows, now);
        if (!exam) maxScore = formatDecimal(picked.value.totalX100, 2);
      }
      await db
        .update(z)
        .set({
          ...definedFields({
            title: change.title,
            instructionsMd: change.instructionsMd,
            timeLimitMinutes: change.timeLimitMinutes,
            maxAttempts: change.maxAttempts,
            attemptScoring: change.attemptScoring,
            shuffleQuestions: change.shuffleQuestions,
            showAnswers: change.showAnswers,
          }),
          opensAt,
          closesAt,
          updatedAt: now,
          version: sql`${z.version} + 1`,
        })
        .where(eq(z.id, id));
      await db
        .update(a)
        .set({
          ...definedFields({ title: change.title, weight: change.weight, maxScore }),
          ...(exam ? {} : { dueAt: closesAt }),
          updatedAt: now,
          version: sql`${a.version} + 1`,
        })
        .where(eq(a.id, row.assessmentId));
      return ok(null);
    });
    return result.ok ? ok(await this.one(id)) : result;
  }

  /** DRAFT → PUBLISHED with its column; publishing again changes nothing. */
  async publish(id: string): Promise<DomainResult<Quiz>> {
    const result = await this.db.withTxResult(async ({ db }) => {
      const z = schema.quizzes;
      const [row] = await db.select().from(z).where(eq(z.id, id)).for("update");
      if (row === undefined) return notFound();
      if (row.status !== "DRAFT") return ok(null);
      const now = this.clock.now();
      await db
        .update(z)
        .set({ status: "PUBLISHED", updatedAt: now, version: sql`${z.version} + 1` })
        .where(eq(z.id, id));
      const a = schema.assessments;
      await db
        .update(a)
        .set({ status: "PUBLISHED", updatedAt: now, version: sql`${a.version} + 1` })
        .where(eq(a.id, row.assessmentId));
      return ok(null);
    });
    return result.ok ? ok(await this.one(id)) : result;
  }

  async offeringOf(id: string): Promise<string | null> {
    const z = schema.quizzes;
    const [row] = await this.db.read
      .select({ offeringId: z.courseOfferingId })
      .from(z)
      .where(eq(z.id, id));
    return row?.offeringId ?? null;
  }

  async manages(userId: string, offeringId: string): Promise<boolean> {
    const decision = await this.authorization.authorize(
      this.authorization.principal(userId),
      "assessment:quiz:manage",
      { type: "course-offering", id: offeringId },
    );
    return decision === "ALLOW";
  }

  // ---- helpers ----

  private visible(manages: boolean): SQL | undefined {
    return manages ? undefined : inArray(schema.quizzes.status, ["PUBLISHED", "CLOSED"]);
  }

  private async courseOf(db: Database, offeringId: string): Promise<string | null> {
    const o = schema.courseOfferings;
    const [row] = await db.select({ courseId: o.courseId }).from(o).where(eq(o.id, offeringId));
    return row?.courseId ?? null;
  }

  /** The chosen questions, from this course's active bank, with their points. */
  private async pickQuestions(
    db: Database,
    offeringId: string,
    wanted: { questionId: string; points?: string | undefined }[],
  ): Promise<DomainResult<{ rows: { questionId: string; points: string }[]; totalX100: number }>> {
    const ids = wanted.map((w) => w.questionId);
    if (new Set(ids).size !== ids.length)
      return err(invalid("body.questions", "Each question can be used once."));
    const courseId = await this.courseOf(db, offeringId);
    const q = schema.questions;
    const found = await db
      .select({ id: q.id, defaultPoints: q.defaultPoints })
      .from(q)
      .where(and(inArray(q.id, ids), eq(q.courseId, courseId ?? ""), eq(q.status, "ACTIVE")));
    if (found.length !== ids.length)
      return err(invalid("body.questions", "Choose questions from this course's bank."));
    const rows = wanted.map((w) => ({
      questionId: w.questionId,
      points: w.points ?? found.find((f) => f.id === w.questionId)?.defaultPoints ?? "1",
    }));
    const totalX100 = rows.reduce((sum, r) => sum + parseDecimal(r.points, 2), 0);
    return ok({ rows, totalX100 });
  }

  private async insertQuiz(
    db: Database,
    q: {
      offeringId: string;
      assessmentId: string;
      title: string;
      input: OnlineExamInput;
      eligibleStudyMode: "ALL" | "ONLINE";
      rows: { questionId: string; points: string }[];
      now: Date;
    },
  ): Promise<string> {
    const { input, now } = q;
    const [quiz] = await db
      .insert(schema.quizzes)
      .values({
        courseOfferingId: q.offeringId,
        assessmentId: q.assessmentId,
        title: q.title,
        instructionsMd: input.instructionsMd ?? null,
        timeLimitMinutes: input.timeLimitMinutes ?? null,
        maxAttempts: input.maxAttempts ?? 1,
        attemptScoring: input.attemptScoring ?? "HIGHEST",
        opensAt: toDate(input.opensAt) ?? null,
        closesAt: toDate(input.closesAt) ?? null,
        shuffleQuestions: input.shuffleQuestions ?? false,
        showAnswers: input.showAnswers ?? "AFTER_CLOSE",
        eligibleStudyMode: q.eligibleStudyMode,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.quizzes.id });
    if (quiz === undefined) throw new Error("quiz insert returned nothing");
    await this.setQuestions(db, quiz.id, q.rows, now);
    return quiz.id;
  }

  private async setQuestions(
    db: Database,
    quizId: string,
    rows: { questionId: string; points: string }[],
    now: Date,
  ): Promise<void> {
    await db.insert(schema.quizQuestions).values(
      rows.map((r, position) => ({
        quizId,
        questionId: r.questionId,
        position,
        points: r.points,
        createdAt: now,
      })),
    );
  }

  private async views(where: SQL | undefined, withQuestions: boolean): Promise<Quiz[]> {
    const z = schema.quizzes;
    const a = schema.assessments;
    const rows = await this.db.read
      .select({ quiz: z, assessment: a })
      .from(z)
      .innerJoin(a, eq(a.id, z.assessmentId))
      .where(where)
      .orderBy(sql`${z.opensAt} ASC NULLS FIRST`, asc(z.createdAt));
    if (rows.length === 0) return [];
    const qq = schema.quizQuestions;
    const q = schema.questions;
    const questions = await this.db.read
      .select({
        quizId: qq.quizId,
        questionId: qq.questionId,
        points: qq.points,
        qtype: q.qtype,
        promptMd: q.promptMd,
      })
      .from(qq)
      .innerJoin(q, eq(q.id, qq.questionId))
      .where(
        inArray(
          qq.quizId,
          rows.map((r) => r.quiz.id),
        ),
      )
      .orderBy(asc(qq.position));
    return rows.map((r) => {
      const mine = questions.filter((x) => x.quizId === r.quiz.id);
      return toQuiz(
        r.quiz,
        r.assessment,
        mine.reduce((sum, x) => sum + parseDecimal(x.points, 2), 0),
        mine.length,
        withQuestions
          ? mine.map((x) => ({
              questionId: x.questionId,
              points: x.points,
              qtype: x.qtype as Question["qtype"],
              promptMd: x.promptMd,
            }))
          : [],
      );
    });
  }

  private async one(id: string): Promise<Quiz> {
    const [found] = await this.views(eq(schema.quizzes.id, id), true);
    if (found === undefined) throw new Error(`quiz ${id} vanished`);
    return found;
  }
}

function checkWindow(opensAt: Date | null, closesAt: Date | null): DomainError | null {
  return opensAt !== null && closesAt !== null && closesAt <= opensAt
    ? invalid("body.closesAt", "The quiz must close after it opens.")
    : null;
}

function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    qtype: row.qtype as Question["qtype"],
    promptMd: row.promptMd,
    promptHtml: renderMarkdown(row.promptMd),
    options: row.options,
    defaultPoints: row.defaultPoints,
    explanationMd: row.explanationMd,
    status: row.status as Question["status"],
  };
}

function toQuiz(
  row: QuizRow,
  assessment: typeof schema.assessments.$inferSelect,
  pointsTotalX100: number,
  questionCount: number,
  questions: Quiz["questions"],
): Quiz {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    courseOfferingId: row.courseOfferingId,
    kind: assessment.kind as Quiz["kind"],
    title: row.title,
    instructionsMd: row.instructionsMd,
    instructionsHtml: row.instructionsMd === null ? null : renderMarkdown(row.instructionsMd),
    timeLimitMinutes: row.timeLimitMinutes,
    maxAttempts: row.maxAttempts,
    attemptScoring: row.attemptScoring as Quiz["attemptScoring"],
    opensAt: row.opensAt?.toISOString() ?? null,
    closesAt: row.closesAt?.toISOString() ?? null,
    shuffleQuestions: row.shuffleQuestions,
    showAnswers: row.showAnswers as Quiz["showAnswers"],
    eligibleStudyMode: row.eligibleStudyMode as Quiz["eligibleStudyMode"],
    status: row.status as Quiz["status"],
    maxScore: assessment.maxScore,
    pointsTotal: formatDecimal(pointsTotalX100, 2),
    weight: assessment.weight,
    questionCount,
    questions,
    version: row.version,
  };
}
