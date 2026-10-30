import type { MyQuizAttempts, QuizAttempt } from "@glim/contracts";
import {
  Db,
  schema,
  type Database,
  type QuizResponseValue,
  type SnapshotQuestion,
  type Tx,
} from "@glim/db";
import type { AuditActor } from "@glim/modules/audit";
import { AuthorizationService } from "@glim/modules/authorization";
import { renderMarkdown } from "@glim/modules/content";
import {
  CLOCK,
  domainError,
  err,
  formatDecimal,
  ok,
  parseDecimal,
  type Clock,
  type DomainError,
  type DomainResult,
} from "@glim/shared";
import { zonedToInstant } from "@glim/shared/time";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { QUIZ_GRACE_MS, deadlineFor, markResponse, shuffled } from "./domain/quiz";
import { attemptsScore, onlineEligible } from "./exam-scores";
import { GradesService } from "./grades.service";

type QuizRow = typeof schema.quizzes.$inferSelect;
type AttemptRow = typeof schema.quizAttempts.$inferSelect;
type ResponseRow = typeof schema.quizResponses.$inferSelect;

export interface ResponsesInput {
  seq: number;
  responses: { questionId: string; response: QuizResponseValue | null }[];
}

const notFound = () => err(domainError("NOT_FOUND", "Not found."));
const invalid = (message: string) =>
  err(
    domainError("VALIDATION_FAILED", message, {
      fieldErrors: [{ path: "body.responses", code: "invalid", message }],
    }),
  );
const x100 = (v: string | null) => (v === null ? null : parseDecimal(v, 2));
const fmt = (v: number | null) => (v === null ? null : formatDecimal(v, 2));
const CHOICE = new Set(["MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE"]);
const JOB_ACTOR: AuditActor = { userId: null, type: "JOB" };
type Actor = AuditActor & { userId: string };

/**
 * Quiz attempts (owner: assessment, TRD §14.2). Starting an attempt freezes its questions; the
 * server keeps the deadline (saves are accepted for 30 s after it, for answers already on their
 * way), and `quiz.expire` submits whatever was saved once that grace has passed. Objective
 * questions are marked on submit; essays by hand. The attempts' scores go to the gradebook per
 * the quiz's attempt scoring.
 */
@Injectable()
export class QuizAttemptsService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
    @Inject(GradesService) private readonly grades: GradesService,
  ) {}

  /** Starts an attempt, or returns the one in progress. */
  async start(quizId: string, actor: Actor): Promise<DomainResult<QuizAttempt>> {
    const userId = actor.userId;
    const result = await this.db.withTxResult(async (tx) => {
      const quiz = await this.lockQuiz(tx.db, quizId);
      if (quiz === null) return notFound();
      const studentId = await this.studentOn(tx.db, quiz.courseOfferingId, userId, ["ENROLLED"]);
      if (studentId === null) return notFound();
      const now = this.clock.now();
      const a = schema.quizAttempts;
      const [running] = await tx.db
        .select()
        .from(a)
        .where(and(eq(a.quizId, quizId), eq(a.studentId, studentId), eq(a.status, "IN_PROGRESS")))
        .for("update");
      if (running !== undefined) {
        if (!this.pastGrace(running, now)) return ok(running.id);
        await this.finish(tx, running, "EXPIRED", userId, JOB_ACTOR);
      }
      if (!(await onlineEligible(tx.db, quiz, studentId)))
        return err(
          domainError(
            "NOT_ELIGIBLE_FOR_ONLINE_EXAM",
            "You sit this exam on paper in the Room. Ask your Lecturer if you need to take it online.",
          ),
        );
      const window = await windowFor(tx.db, quiz, studentId);
      if (
        quiz.status !== "PUBLISHED" ||
        (window.opensAt !== null && now < window.opensAt) ||
        (window.closesAt !== null && now >= window.closesAt)
      )
        return err(domainError("SUBMISSION_CLOSED", "This quiz isn't open now."));
      const [counted] = await tx.db
        .select({ used: sql<number>`count(*)::int` })
        .from(a)
        .where(and(eq(a.quizId, quizId), eq(a.studentId, studentId)));
      const used = counted?.used ?? 0;
      if (used >= quiz.maxAttempts)
        return err(
          domainError("ATTEMPT_LIMIT_REACHED", "You've used all your attempts at this quiz."),
        );
      const snapshot = await this.snapshot(tx.db, quiz);
      const deadlineAt = deadlineFor(now, quiz.timeLimitMinutes, window.closesAt);
      const [attempt] = await tx.db
        .insert(a)
        .values({
          quizId,
          studentId,
          attemptNo: used + 1,
          startedAt: now,
          deadlineAt,
          questionSnapshot: snapshot,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (attempt === undefined) throw new Error("attempt insert returned nothing");
      if (deadlineAt !== null)
        await tx.boss.send(
          "quiz.expire",
          { attemptId: attempt.id },
          {
            startAfter: Math.max(
              1,
              Math.ceil((deadlineAt.getTime() + QUIZ_GRACE_MS - now.getTime()) / 1000),
            ),
          },
        );
      return ok(attempt.id);
    });
    return result.ok ? ok(await this.view(result.value, false)) : result;
  }

  async mine(quizId: string, userId: string): Promise<DomainResult<MyQuizAttempts>> {
    const z = schema.quizzes;
    const [quiz] = await this.db.read.select().from(z).where(eq(z.id, quizId));
    if (quiz === undefined) return notFound();
    const studentId = await this.studentOn(this.db.read, quiz.courseOfferingId, userId, [
      "ENROLLED",
      "COMPLETED",
    ]);
    if (studentId === null || quiz.status === "DRAFT")
      return ok({ attempts: [], attemptsLeft: 0, open: false, eligible: false });
    const eligible = await onlineEligible(this.db.read, quiz, studentId);
    const a = schema.quizAttempts;
    const rows = await this.db.read
      .select()
      .from(a)
      .where(and(eq(a.quizId, quizId), eq(a.studentId, studentId)))
      .orderBy(asc(a.attemptNo));
    const now = this.clock.now();
    const running = rows.some((r) => r.status === "IN_PROGRESS" && !this.pastGrace(r, now));
    const attemptsLeft = Math.max(0, quiz.maxAttempts - rows.length);
    const window = await windowFor(this.db.read, quiz, studentId);
    const windowOpen =
      quiz.status === "PUBLISHED" &&
      (window.opensAt === null || now >= window.opensAt) &&
      (window.closesAt === null || now < window.closesAt);
    return ok({
      attempts: rows.map((r) => ({
        id: r.id,
        attemptNo: r.attemptNo,
        status: r.status as MyQuizAttempts["attempts"][number]["status"],
        submittedAt: r.submittedAt?.toISOString() ?? null,
        score: r.score,
      })),
      attemptsLeft,
      open: running || (eligible && windowOpen && attemptsLeft > 0),
      eligible,
    });
  }

  /** An attempt, with answers shown as the quiz allows (always to the course's graders). */
  async get(attemptId: string, viewerUserId: string): Promise<DomainResult<QuizAttempt>> {
    const owner = await this.ownerOf(attemptId);
    if (owner === null) return notFound();
    const staff = owner.ownerUserId !== viewerUserId;
    return ok(await this.view(attemptId, staff));
  }

  /** Autosave: stores the responses unless `seq` is stale; refused once the attempt is over. */
  async save(
    attemptId: string,
    input: ResponsesInput,
  ): Promise<DomainResult<{ lastSeq: number; saved: boolean }>> {
    return this.db.withTxResult<{ lastSeq: number; saved: boolean }, DomainError>(
      async ({ db }) => {
        const a = schema.quizAttempts;
        const [attempt] = await db.select().from(a).where(eq(a.id, attemptId)).for("update");
        if (attempt === undefined) return notFound();
        const now = this.clock.now();
        if (attempt.status !== "IN_PROGRESS" || this.pastGrace(attempt, now))
          return err(domainError("ATTEMPT_EXPIRED", "This attempt has ended."));
        if (input.seq <= attempt.lastSeq) return ok({ lastSeq: attempt.lastSeq, saved: false });
        const byId = new Map(attempt.questionSnapshot.map((q) => [q.questionId, q]));
        for (const { questionId, response } of input.responses) {
          const question = byId.get(questionId);
          if (question === undefined) return invalid("That question isn't in this attempt.");
          if (response === null) continue;
          if (CHOICE.has(question.qtype)) {
            if (!("optionIds" in response)) return invalid("Choose from the options.");
            const known = new Set(question.options.map((o) => o.id));
            if (!response.optionIds.every((id) => known.has(id)))
              return invalid("Choose from the options.");
            if (question.qtype !== "MCQ_MULTI" && response.optionIds.length > 1)
              return invalid("Choose one option.");
          } else if (!("text" in response)) return invalid("Write your answer.");
        }
        const r = schema.quizResponses;
        for (const { questionId, response } of input.responses)
          await db
            .insert(r)
            .values({ attemptId, questionId, response, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({
              target: [r.attemptId, r.questionId],
              set: { response, updatedAt: now, version: sql`${r.version} + 1` },
            });
        await db.update(a).set({ lastSeq: input.seq, updatedAt: now }).where(eq(a.id, attemptId));
        return ok({ lastSeq: input.seq, saved: true });
      },
    );
  }

  /** Submits (or, past the deadline and its grace, expires) the attempt; again changes nothing. */
  async submit(attemptId: string, actor: Actor): Promise<DomainResult<QuizAttempt>> {
    const result = await this.db.withTxResult(async (tx) => {
      const a = schema.quizAttempts;
      const [attempt] = await tx.db.select().from(a).where(eq(a.id, attemptId)).for("update");
      if (attempt === undefined) return notFound();
      if (attempt.status === "IN_PROGRESS")
        await this.finish(
          tx,
          attempt,
          this.pastGrace(attempt, this.clock.now()) ? "EXPIRED" : "SUBMITTED",
          actor.userId,
          actor,
        );
      return ok(null);
    });
    return result.ok ? ok(await this.view(attemptId, false)) : result;
  }

  /**
   * The `quiz.expire` job: submits an attempt still in progress once its deadline and grace have
   * passed. Run early (a clock difference), it asks to be run again when due.
   */
  async expire(attemptId: string): Promise<"EXPIRED" | "DONE" | "NOT_YET"> {
    return this.db.withTx(async (tx) => {
      const a = schema.quizAttempts;
      const [attempt] = await tx.db.select().from(a).where(eq(a.id, attemptId)).for("update");
      if (attempt?.status !== "IN_PROGRESS") return "DONE";
      const now = this.clock.now();
      if (!this.pastGrace(attempt, now)) {
        const due = (attempt.deadlineAt?.getTime() ?? now.getTime()) + QUIZ_GRACE_MS;
        await tx.boss.send(
          "quiz.expire",
          { attemptId },
          { startAfter: Math.max(1, Math.ceil((due - now.getTime()) / 1000)) },
        );
        return "NOT_YET";
      }
      const [student] = await tx.db
        .select({ userId: schema.students.userId })
        .from(schema.students)
        .where(eq(schema.students.id, attempt.studentId));
      await this.finish(tx, attempt, "EXPIRED", student?.userId ?? null, JOB_ACTOR);
      return "EXPIRED";
    });
  }

  /** Finished attempts on a quiz, those with essays to mark first. */
  async forGrading(quizId: string) {
    const a = schema.quizAttempts;
    const st = schema.students;
    const rows = await this.db.read
      .select({ attempt: a, given: st.givenName, family: st.familyName })
      .from(a)
      .innerJoin(st, eq(st.id, a.studentId))
      .where(and(eq(a.quizId, quizId), ne(a.status, "IN_PROGRESS")))
      .orderBy(asc(st.familyName), asc(st.givenName), asc(a.attemptNo));
    const marked =
      rows.length === 0
        ? []
        : await this.db.read
            .select({
              attemptId: schema.quizResponses.attemptId,
              questionId: schema.quizResponses.questionId,
            })
            .from(schema.quizResponses)
            .where(
              and(
                inArray(
                  schema.quizResponses.attemptId,
                  rows.map((r) => r.attempt.id),
                ),
                isNotNull(schema.quizResponses.pointsAwarded),
              ),
            );
    const items = rows.map(({ attempt, given, family }) => {
      const essays = attempt.questionSnapshot.filter((q) => q.qtype === "ESSAY");
      const done = marked.filter(
        (m) => m.attemptId === attempt.id && essays.some((e) => e.questionId === m.questionId),
      ).length;
      return {
        attemptId: attempt.id,
        studentId: attempt.studentId,
        studentName: `${given} ${family}`,
        attemptNo: attempt.attemptNo,
        status: attempt.status as QuizAttempt["status"],
        submittedAt: attempt.submittedAt?.toISOString() ?? null,
        score: attempt.score,
        essaysToMark: essays.length - done,
      };
    });
    return items.sort((x, y) => Number(y.essaysToMark > 0) - Number(x.essaysToMark > 0));
  }

  /** Marks an essay answer; once every essay is marked the attempt is scored. */
  async mark(
    attemptId: string,
    questionId: string,
    input: { points: string; comment?: string | null | undefined },
    actor: Actor,
  ): Promise<DomainResult<QuizAttempt>> {
    const result = await this.db.withTxResult(async (tx) => {
      const a = schema.quizAttempts;
      const [attempt] = await tx.db.select().from(a).where(eq(a.id, attemptId)).for("update");
      if (attempt === undefined) return notFound();
      if (attempt.status === "IN_PROGRESS")
        return err(domainError("CONFLICT", "The attempt hasn't been submitted yet."));
      const question = attempt.questionSnapshot.find((q) => q.questionId === questionId);
      if (question?.qtype !== "ESSAY")
        return err(domainError("VALIDATION_FAILED", "Only essay answers are marked by hand."));
      const points = parseDecimal(input.points, 2);
      if (points > question.pointsX100)
        return err(
          domainError(
            "VALIDATION_FAILED",
            `At most ${formatDecimal(question.pointsX100, 2)} points.`,
            { fieldErrors: [{ path: "body.points", code: "too_big", message: "Too many." }] },
          ),
        );
      const now = this.clock.now();
      const r = schema.quizResponses;
      await tx.db
        .insert(r)
        .values({
          attemptId,
          questionId,
          response: null,
          pointsAwarded: formatDecimal(points, 2),
          graderComment: input.comment ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [r.attemptId, r.questionId],
          set: {
            pointsAwarded: formatDecimal(points, 2),
            graderComment: input.comment ?? null,
            updatedAt: now,
            version: sql`${r.version} + 1`,
          },
        });
      await this.score(tx, attempt, actor.userId, actor);
      return ok(null);
    });
    return result.ok ? ok(await this.view(attemptId, true)) : result;
  }

  async ownerOf(attemptId: string): Promise<{ offeringId: string; ownerUserId: string } | null> {
    const a = schema.quizAttempts;
    const [row] = await this.db.read
      .select({ offeringId: schema.quizzes.courseOfferingId, ownerUserId: schema.students.userId })
      .from(a)
      .innerJoin(schema.quizzes, eq(schema.quizzes.id, a.quizId))
      .innerJoin(schema.students, eq(schema.students.id, a.studentId))
      .where(eq(a.id, attemptId));
    return row ?? null;
  }

  // ---- helpers ----

  private pastGrace(attempt: AttemptRow, now: Date): boolean {
    return (
      attempt.deadlineAt !== null && now.getTime() > attempt.deadlineAt.getTime() + QUIZ_GRACE_MS
    );
  }

  private async lockQuiz(db: Database, quizId: string): Promise<QuizRow | null> {
    const z = schema.quizzes;
    const [row] = await db.select().from(z).where(eq(z.id, quizId)).for("update");
    return row ?? null;
  }

  private async studentOn(
    db: Database,
    offeringId: string,
    userId: string,
    statuses: string[],
  ): Promise<string | null> {
    const ce = schema.courseEnrollments;
    const st = schema.students;
    const [row] = await db
      .select({ id: st.id })
      .from(ce)
      .innerJoin(st, eq(st.id, ce.studentId))
      .where(
        and(
          eq(ce.courseOfferingId, offeringId),
          eq(st.userId, userId),
          inArray(ce.status, statuses),
        ),
      );
    return row?.id ?? null;
  }

  /** The quiz's questions as they are now, frozen into the attempt (shuffled if asked). */
  private async snapshot(db: Database, quiz: QuizRow): Promise<SnapshotQuestion[]> {
    const qq = schema.quizQuestions;
    const q = schema.questions;
    const rows = await db
      .select({ link: qq, question: q })
      .from(qq)
      .innerJoin(q, eq(q.id, qq.questionId))
      .where(eq(qq.quizId, quiz.id))
      .orderBy(asc(qq.position));
    const frozen = rows.map(({ link, question }) => ({
      questionId: question.id,
      qtype: question.qtype,
      promptMd: question.promptMd,
      options: question.options,
      pointsX100: parseDecimal(link.points, 2),
      explanationMd: question.explanationMd,
    }));
    return quiz.shuffleQuestions ? shuffled(frozen) : frozen;
  }

  /** Ends an attempt: marks what can be marked and, without essays, scores it. */
  private async finish(
    tx: Tx,
    attempt: AttemptRow,
    status: "SUBMITTED" | "EXPIRED",
    byUserId: string | null,
    actor: AuditActor,
  ): Promise<void> {
    const now = this.clock.now();
    const r = schema.quizResponses;
    const saved = await tx.db.select().from(r).where(eq(r.attemptId, attempt.id));
    let auto = 0;
    for (const question of attempt.questionSnapshot) {
      const existing = saved.find((s) => s.questionId === question.questionId);
      const mark = markResponse(question, existing?.response ?? null);
      if (mark.pointsX100 !== null) auto += mark.pointsX100;
      if (question.qtype === "ESSAY") continue;
      await tx.db
        .insert(r)
        .values({
          attemptId: attempt.id,
          questionId: question.questionId,
          response: existing?.response ?? null,
          isCorrect: mark.isCorrect,
          pointsAwarded: fmt(mark.pointsX100),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [r.attemptId, r.questionId],
          set: { isCorrect: mark.isCorrect, pointsAwarded: fmt(mark.pointsX100), updatedAt: now },
        });
    }
    const a = schema.quizAttempts;
    // An expired attempt counts as handed in at its deadline.
    const submittedAt = status === "EXPIRED" ? (attempt.deadlineAt ?? now) : now;
    await tx.db
      .update(a)
      .set({
        status,
        submittedAt,
        autoScore: formatDecimal(auto, 2),
        updatedAt: now,
        version: sql`${a.version} + 1`,
      })
      .where(eq(a.id, attempt.id));
    const [updated] = await tx.db.select().from(a).where(eq(a.id, attempt.id));
    if (updated !== undefined && byUserId !== null) await this.score(tx, updated, byUserId, actor);
  }

  /** Scores the attempt once no essay is left unmarked, then updates the gradebook. */
  private async score(
    tx: Tx,
    attempt: AttemptRow,
    changedBy: string,
    actor: AuditActor,
  ): Promise<void> {
    const essays = attempt.questionSnapshot.filter((q) => q.qtype === "ESSAY");
    const r = schema.quizResponses;
    const marks = await tx.db.select().from(r).where(eq(r.attemptId, attempt.id));
    const essayMarks = essays.map(
      (e) => marks.find((m) => m.questionId === e.questionId)?.pointsAwarded ?? null,
    );
    if (essayMarks.some((m) => m === null)) return;
    const manual = essayMarks.reduce((sum, m) => sum + (x100(m) ?? 0), 0);
    const total = (x100(attempt.autoScore) ?? 0) + manual;
    const a = schema.quizAttempts;
    const now = this.clock.now();
    await tx.db
      .update(a)
      .set({
        manualScore: essays.length === 0 ? null : formatDecimal(manual, 2),
        score: formatDecimal(total, 2),
        status: attempt.status === "EXPIRED" ? "EXPIRED" : "GRADED",
        updatedAt: now,
      })
      .where(eq(a.id, attempt.id));

    const [quiz] = await tx.db
      .select()
      .from(schema.quizzes)
      .where(eq(schema.quizzes.id, attempt.quizId));
    if (quiz === undefined) return;
    const combined = await attemptsScore(tx.db, quiz, attempt.studentId);
    if (combined === null) return;
    await this.grades.recordComputed(tx.db, {
      assessmentId: quiz.assessmentId,
      courseOfferingId: quiz.courseOfferingId,
      studentId: attempt.studentId,
      scoreX100: combined,
      source: "QUIZ",
      changedBy,
      actor,
    });
  }

  private async view(attemptId: string, staff: boolean): Promise<QuizAttempt> {
    const a = schema.quizAttempts;
    const [attempt] = await this.db.read.select().from(a).where(eq(a.id, attemptId));
    if (attempt === undefined) throw new Error(`attempt ${attemptId} vanished`);
    const [quiz] = await this.db.read
      .select()
      .from(schema.quizzes)
      .where(eq(schema.quizzes.id, attempt.quizId));
    const responses: ResponseRow[] = await this.db.read
      .select()
      .from(schema.quizResponses)
      .where(eq(schema.quizResponses.attemptId, attemptId))
      .orderBy(desc(schema.quizResponses.updatedAt));
    const now = this.clock.now();
    const over = attempt.status !== "IN_PROGRESS";
    const showAnswers =
      staff ||
      (over &&
        (quiz?.showAnswers === "AFTER_ATTEMPT" ||
          (quiz?.showAnswers === "AFTER_CLOSE" && quiz.closesAt !== null && now >= quiz.closesAt)));
    const total = attempt.questionSnapshot.reduce((sum, q) => sum + q.pointsX100, 0);
    return {
      id: attempt.id,
      quizId: attempt.quizId,
      attemptNo: attempt.attemptNo,
      status: attempt.status as QuizAttempt["status"],
      startedAt: attempt.startedAt.toISOString(),
      deadlineAt: attempt.deadlineAt?.toISOString() ?? null,
      serverNow: now.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      lastSeq: attempt.lastSeq,
      score: over ? attempt.score : null,
      maxScore: formatDecimal(total, 2),
      questions: attempt.questionSnapshot.map((q) => {
        const saved = responses.find((r) => r.questionId === q.questionId);
        const choice = CHOICE.has(q.qtype);
        return {
          questionId: q.questionId,
          qtype: q.qtype as QuizAttempt["questions"][number]["qtype"],
          promptHtml: renderMarkdown(q.promptMd),
          options: choice ? q.options.map((o) => ({ id: o.id, text: o.text })) : [],
          points: formatDecimal(q.pointsX100, 2),
          response: saved?.response ?? null,
          correctOptionIds:
            showAnswers && choice ? q.options.filter((o) => o.correct).map((o) => o.id) : null,
          acceptedAnswers:
            showAnswers && q.qtype === "SHORT_TEXT" ? q.options.map((o) => o.text) : null,
          explanationHtml:
            showAnswers && q.explanationMd !== null ? renderMarkdown(q.explanationMd) : null,
          isCorrect: over ? (saved?.isCorrect ?? null) : null,
          pointsAwarded: over ? (saved?.pointsAwarded ?? null) : null,
          graderComment: over ? (saved?.graderComment ?? null) : null,
        };
      }),
    };
  }
}

/**
 * When a student may attempt the quiz: its own window, except that a student with a makeup exam
 * sits an online exam on their makeup day, all day in the institution's timezone (ADR-0005).
 */
async function windowFor(
  db: Database,
  quiz: { assessmentId: string; courseOfferingId: string; opensAt: Date | null; closesAt: Date | null },
  studentId: string,
): Promise<{ opensAt: Date | null; closesAt: Date | null }> {
  const m = schema.examMakeups;
  const [makeup] = await db
    .select({ makeupOn: m.makeupOn, zone: schema.settings.timezone })
    .from(m)
    .innerJoin(schema.assessments, eq(schema.assessments.id, quiz.assessmentId))
    .innerJoin(schema.settings, sql`true`)
    .where(
      and(
        eq(m.courseOfferingId, quiz.courseOfferingId),
        eq(m.studentId, studentId),
        eq(schema.assessments.kind, "EXAM"),
      ),
    )
    .limit(1);
  if (makeup === undefined) return { opensAt: quiz.opensAt, closesAt: quiz.closesAt };
  const nextDay = new Date(Date.parse(`${makeup.makeupOn}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    opensAt: new Date(zonedToInstant(makeup.makeupOn, "00:00", makeup.zone)),
    closesAt: new Date(zonedToInstant(nextDay, "00:00", makeup.zone)),
  };
}
