import type { Question, Quiz, QuizAttempt } from "@glim/contracts";
import { QuizAttemptsService } from "@glim/modules/assessment";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type PersonaName, type Personas } from "./personas";

/**
 * The question bank and quizzes (TRD §14.2). O1 and O2 are offerings of the same course, taught
 * by l1Primary (O1, PRIMARY), l2Co, l3Assistant (who may mark but not set quizzes) and l4Other
 * (O2). sEnrolled takes O1; sCompleted finished it; sOther takes O2. The clock starts at
 * 2026-11-02T09:00Z.
 */

let t: TestApp;
let p: Personas;
const bank: Record<string, Question> = {};

interface ErrorBody {
  error: { code: string };
}

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

const send = (
  as: PersonaName,
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  t.request({
    method,
    url: `/api/v1${url}`,
    headers: { ...p[as].headers, ...headers },
    ...(payload === undefined ? {} : { payload }),
  });

const key = () => ({ "idempotency-key": idempotencyKey() });
const O1 = () => p.world.offerings.O1;

async function at(iso: string) {
  t.clock.set(iso);
  for (const name of Object.keys(p).filter((k) => k !== "world") as PersonaName[])
    p[name].headers = await sessionFor(t, p[name].userId);
}

async function question(name: string, body: Record<string, unknown>) {
  const res = await send("l1Primary", "POST", `/course-offerings/${O1()}/questions`, body, key());
  expect(res.statusCode, res.body).toBe(201);
  bank[name] = res.json<Question>();
}

async function quiz(body: Record<string, unknown>): Promise<Quiz> {
  const created = await send(
    "l1Primary",
    "POST",
    `/course-offerings/${O1()}/quizzes`,
    {
      title: "Quiz 1",
      weight: "20",
      timeLimitMinutes: 10,
      maxAttempts: 2,
      showAnswers: "AFTER_ATTEMPT",
      questions: ["single", "multi", "tf", "short", "essay"].map((n) => ({
        questionId: bank[n]?.id,
      })),
      ...body,
    },
    key(),
  );
  expect(created.statusCode, created.body).toBe(201);
  const pub = await send(
    "l1Primary",
    "POST",
    `/quizzes/${created.json<Quiz>().id}/publish`,
    undefined,
    key(),
  );
  expect(pub.statusCode).toBe(200);
  return pub.json<Quiz>();
}

const start = (as: PersonaName, quizId: string) => send(as, "POST", `/quizzes/${quizId}/attempts`);
const save = (as: PersonaName, attemptId: string, seq: number, responses: unknown[]) =>
  send(as, "PATCH", `/quiz-attempts/${attemptId}`, { seq, responses });
const submit = (as: PersonaName, attemptId: string) =>
  send(as, "POST", `/quiz-attempts/${attemptId}/submit`, undefined, key());

/** Right answers for every objective question, and an essay. */
const goodAnswers = () => [
  { questionId: bank.single?.id, response: { optionIds: ["b"] } },
  { questionId: bank.multi?.id, response: { optionIds: ["a", "c"] } },
  { questionId: bank.tf?.id, response: { optionIds: ["true"] } },
  { questionId: bank.short?.id, response: { text: "  WORD " } },
  { questionId: bank.essay?.id, response: { text: "Because..." } },
];

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  const abc = (right: string[]) =>
    ["a", "b", "c"].map((id) => ({ id, text: `Option ${id}`, correct: right.includes(id) }));
  await question("single", {
    qtype: "MCQ_SINGLE",
    promptMd: "Who wrote the fourth Gospel?",
    options: abc(["b"]),
    defaultPoints: "2",
  });
  await question("multi", {
    qtype: "MCQ_MULTI",
    promptMd: "Which are Gospels?",
    options: abc(["a", "c"]),
    defaultPoints: "2",
  });
  await question("tf", {
    qtype: "TRUE_FALSE",
    promptMd: "John 1 begins *In the beginning*.",
    options: [
      { id: "true", text: "True", correct: true },
      { id: "false", text: "False", correct: false },
    ],
  });
  await question("short", {
    qtype: "SHORT_TEXT",
    promptMd: "In the beginning was the …",
    options: [{ id: "1", text: "Word", correct: true }],
    explanationMd: "John 1:1.",
  });
  await question("essay", { qtype: "ESSAY", promptMd: "Why?", defaultPoints: "4" });
});

afterAll(async () => {
  await t.close();
});

describe("the question bank", () => {
  it("checks each type's options", async () => {
    const bad = (body: Record<string, unknown>) =>
      send("l1Primary", "POST", `/course-offerings/${O1()}/questions`, body, key());
    const two = [
      { id: "a", text: "A", correct: true },
      { id: "b", text: "B", correct: true },
    ];
    expect((await bad({ qtype: "MCQ_SINGLE", promptMd: "?", options: two })).statusCode).toBe(400);
    expect((await bad({ qtype: "SHORT_TEXT", promptMd: "?" })).statusCode).toBe(400);
    expect((await bad({ qtype: "ESSAY", promptMd: "?", options: two })).statusCode).toBe(400);
    expect(
      (
        await bad({
          qtype: "TRUE_FALSE",
          promptMd: "?",
          options: [{ id: "true", text: "T", correct: true }],
        })
      ).statusCode,
    ).toBe(400);
  });

  it("belongs to the course: another offering of it sees the same questions", async () => {
    const o2 = await send("l4Other", "GET", `/course-offerings/${p.world.offerings.O2}/questions`);
    expect(o2.statusCode, o2.body).toBe(200);
    expect(o2.json<{ items: Question[] }>().items).toHaveLength(5);
    for (const who of ["l3Assistant", "sEnrolled", "registrar"] as const)
      expect([403, 404], who).toContain(
        (await send(who, "GET", `/course-offerings/${O1()}/questions`)).statusCode,
      );
  });
});

describe("quizzes", () => {
  it("creates a quiz whose column's maximum is the questions' total", async () => {
    const created = await quiz({ title: "Totals" });
    expect(created).toMatchObject({
      status: "PUBLISHED",
      maxScore: "10.00",
      weight: "20.00",
      questionCount: 5,
      kind: "QUIZ",
    });
    const column = await q<{ kind: string; max_score: string }>(
      "SELECT kind, max_score FROM assessments WHERE id = $1",
      [created.assessmentId],
    );
    expect(column.rows[0]).toEqual({ kind: "QUIZ", max_score: "10.00" });
  });

  it("refuses questions from elsewhere, a closing before opening, and edits to published questions", async () => {
    const bad = await send(
      "l1Primary",
      "POST",
      `/course-offerings/${O1()}/quizzes`,
      {
        title: "x",
        weight: "1",
        questions: [{ questionId: "00000000-0000-7000-8000-000000000000" }],
      },
      key(),
    );
    expect(bad.statusCode).toBe(400);
    const window = await send(
      "l1Primary",
      "POST",
      `/course-offerings/${O1()}/quizzes`,
      {
        title: "x",
        weight: "1",
        opensAt: "2026-11-05T00:00:00Z",
        closesAt: "2026-11-04T00:00:00Z",
        questions: [{ questionId: bank.tf?.id }],
      },
      key(),
    );
    expect(window.statusCode).toBe(400);
    const published = await quiz({ title: "Locked" });
    const res = await send(
      "l1Primary",
      "PATCH",
      `/quizzes/${published.id}`,
      { questions: [{ questionId: bank.tf?.id }] },
      { "if-match": `"${String(published.version)}"` },
    );
    expect(res.statusCode).toBe(409);
  });

  it("shows students published quizzes without their questions", async () => {
    const items = (await send("sEnrolled", "GET", `/course-offerings/${O1()}/quizzes`)).json<{
      items: Quiz[];
    }>().items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((x) => x.status === "PUBLISHED" && x.questions.length === 0)).toBe(true);
    for (const who of ["l3Assistant", "sEnrolled"] as const)
      expect([403, 404], who).toContain(
        (
          await send(
            who,
            "POST",
            `/course-offerings/${O1()}/quizzes`,
            { title: "x", weight: "1", questions: [{ questionId: bank.tf?.id }] },
            key(),
          )
        ).statusCode,
      );
  });
});

describe("taking a quiz", () => {
  let z: Quiz;
  let attempt: QuizAttempt;

  beforeAll(async () => {
    z = await quiz({ title: "Taken" });
  });

  it("freezes the questions, hides the answers and keeps the deadline", async () => {
    const res = await start("sEnrolled", z.id);
    expect(res.statusCode, res.body).toBe(200);
    attempt = res.json<QuizAttempt>();
    expect(attempt).toMatchObject({
      attemptNo: 1,
      status: "IN_PROGRESS",
      deadlineAt: "2026-11-02T09:10:00.000Z",
      maxScore: "10.00",
    });
    expect(attempt.questions[0]?.options).toEqual([
      { id: "a", text: "Option a" },
      { id: "b", text: "Option b" },
      { id: "c", text: "Option c" },
    ]);
    expect(attempt.questions.every((x) => x.correctOptionIds === null)).toBe(true);
    expect(JSON.stringify(attempt)).not.toContain('"correct"');
    const jobs = await q<{ n: string }>(
      "SELECT count(*) AS n FROM pgboss.job WHERE name = 'quiz.expire' AND data->>'attemptId' = $1",
      [attempt.id],
    );
    expect(Number(jobs.rows[0]?.n)).toBe(1);

    // Editing the bank later doesn't change a started attempt.
    await q("UPDATE questions SET prompt_md = 'Changed!' WHERE id = $1", [bank.single?.id]);
    const again = (await start("sEnrolled", z.id)).json<QuizAttempt>();
    expect(again.id).toBe(attempt.id);
    expect(again.questions[0]?.promptHtml).toContain("fourth Gospel");
    await q("UPDATE questions SET prompt_md = 'Who wrote the fourth Gospel?' WHERE id = $1", [
      bank.single?.id,
    ]);
  });

  it("autosaves idempotently by seq and checks responses", async () => {
    const first = await save("sEnrolled", attempt.id, 1, goodAnswers());
    expect(first.json()).toEqual({ lastSeq: 1, saved: true });
    const stale = await save("sEnrolled", attempt.id, 1, [
      { questionId: bank.single?.id, response: { optionIds: ["a"] } },
    ]);
    expect(stale.json()).toEqual({ lastSeq: 1, saved: false });
    const unknownOption = await save("sEnrolled", attempt.id, 2, [
      { questionId: bank.single?.id, response: { optionIds: ["z"] } },
    ]);
    expect(unknownOption.statusCode).toBe(400);
    const twoForSingle = await save("sEnrolled", attempt.id, 2, [
      { questionId: bank.single?.id, response: { optionIds: ["a", "b"] } },
    ]);
    expect(twoForSingle.statusCode).toBe(400);
    expect((await save("sOther", attempt.id, 3, [])).statusCode).toBe(404);
    expect((await send("sOther", "GET", `/quiz-attempts/${attempt.id}`)).statusCode).toBe(404);
  });

  it("marks objective questions on submit and waits for the essay", async () => {
    await at("2026-11-02T09:05:00Z");
    const res = await submit("sEnrolled", attempt.id);
    expect(res.statusCode, res.body).toBe(200);
    const done = res.json<QuizAttempt>();
    expect(done).toMatchObject({ status: "SUBMITTED", score: null });
    expect(done.questions.map((x) => [x.isCorrect, x.pointsAwarded])).toEqual([
      [true, "2.00"],
      [true, "2.00"],
      [true, "1.00"],
      [true, "1.00"],
      [null, null],
    ]);
    // Answers may be seen after the attempt (showAnswers AFTER_ATTEMPT).
    expect(done.questions[0]?.correctOptionIds).toEqual(["b"]);
    expect(done.questions[3]?.acceptedAnswers).toEqual(["Word"]);
    expect(done.questions[3]?.explanationHtml).toContain("John 1:1");
    expect((await submit("sEnrolled", attempt.id)).json<QuizAttempt>().status).toBe("SUBMITTED");
    expect((await save("sEnrolled", attempt.id, 9, [])).json<ErrorBody>().error.code).toBe(
      "ATTEMPT_EXPIRED",
    );
    const grade = await q("SELECT 1 FROM grades WHERE assessment_id = $1", [z.assessmentId]);
    expect(grade.rowCount).toBe(0);
  });

  it("lets a grader mark the essay, which scores the attempt into the gradebook", async () => {
    const list = await send("l3Assistant", "GET", `/quizzes/${z.id}/attempts`);
    expect(list.statusCode, list.body).toBe(200);
    expect(
      list.json<{ items: { attemptId: string; essaysToMark: number }[] }>().items[0],
    ).toMatchObject({
      attemptId: attempt.id,
      essaysToMark: 1,
    });
    const tooMany = await send(
      "l3Assistant",
      "PUT",
      `/quiz-attempts/${attempt.id}/responses/${bank.essay?.id ?? ""}`,
      { points: "4.5" },
    );
    expect(tooMany.statusCode).toBe(400);
    const notEssay = await send(
      "l3Assistant",
      "PUT",
      `/quiz-attempts/${attempt.id}/responses/${bank.single?.id ?? ""}`,
      { points: "1" },
    );
    expect(notEssay.statusCode).toBe(400);
    const marked = await send(
      "l3Assistant",
      "PUT",
      `/quiz-attempts/${attempt.id}/responses/${bank.essay?.id ?? ""}`,
      { points: "3.5", comment: "Good start." },
    );
    expect(marked.statusCode, marked.body).toBe(200);
    expect(marked.json<QuizAttempt>()).toMatchObject({ status: "GRADED", score: "9.50" });
    const grade = await q<{ score: string; source: string; status: string }>(
      "SELECT score, source, status FROM grades WHERE assessment_id = $1",
      [z.assessmentId],
    );
    expect(grade.rows[0]).toEqual({ score: "9.50", source: "QUIZ", status: "DRAFT" });
    expect(
      (
        await send(
          "sEnrolled",
          "PUT",
          `/quiz-attempts/${attempt.id}/responses/${bank.essay?.id ?? ""}`,
          { points: "4" },
        )
      ).statusCode,
    ).toBe(404);
  });

  it("accepts a save on its way during the 30 s grace, then expires the attempt", async () => {
    await at("2026-11-02T10:00:00Z");
    const second = (await start("sEnrolled", z.id)).json<QuizAttempt>();
    expect(second.attemptNo).toBe(2);
    const attempts = t.app.get(QuizAttemptsService);
    expect(await attempts.expire(second.id)).toBe("NOT_YET");

    await at("2026-11-02T10:10:20Z");
    const late = await save("sEnrolled", second.id, 1, [
      { questionId: bank.single?.id, response: { optionIds: ["b"] } },
    ]);
    expect(late.json()).toEqual({ lastSeq: 1, saved: true });
    await at("2026-11-02T10:10:31Z");
    expect((await save("sEnrolled", second.id, 2, [])).json<ErrorBody>().error.code).toBe(
      "ATTEMPT_EXPIRED",
    );
    expect(await attempts.expire(second.id)).toBe("EXPIRED");
    expect(await attempts.expire(second.id)).toBe("DONE");
    const view = (
      await send("sEnrolled", "GET", `/quiz-attempts/${second.id}`)
    ).json<QuizAttempt>();
    // Handed in at the deadline with what was saved; the unanswered essay still needs marking.
    expect(view).toMatchObject({
      status: "EXPIRED",
      submittedAt: "2026-11-02T10:10:00.000Z",
      score: null,
    });
    await send("l2Co", "PUT", `/quiz-attempts/${second.id}/responses/${bank.essay?.id ?? ""}`, {
      points: "0",
    });
    // HIGHEST of 9.50 and 2.00 stays 9.50.
    const grade = await q<{ score: string }>("SELECT score FROM grades WHERE assessment_id = $1", [
      z.assessmentId,
    ]);
    expect(grade.rows[0]?.score).toBe("9.50");
  });

  it("stops at the attempt limit", async () => {
    const res = await start("sEnrolled", z.id);
    expect(res.json<ErrorBody>().error.code).toBe("ATTEMPT_LIMIT_REACHED");
    const mine = await send("sEnrolled", "GET", `/quizzes/${z.id}/my-attempts`);
    expect(mine.json()).toMatchObject({ attemptsLeft: 0, open: false });
  });

  it("is for students enrolled now, while the quiz is open; the close cuts the deadline short", async () => {
    expect((await start("sCompleted", z.id)).statusCode).toBe(404);
    expect((await start("sOther", z.id)).statusCode).toBe(404);
    const closing = await quiz({
      title: "Closing",
      opensAt: "2026-11-02T09:00:00Z",
      closesAt: "2026-11-02T10:15:00Z",
      timeLimitMinutes: 30,
    });
    const att = (await start("sEnrolled", closing.id)).json<QuizAttempt>();
    expect(att.deadlineAt).toBe("2026-11-02T10:15:00.000Z");
    await at("2026-11-02T10:16:00Z");
    const later = await quiz({
      title: "Not yet",
      opensAt: "2026-11-03T09:00:00Z",
    });
    expect((await start("sEnrolled", later.id)).json<ErrorBody>().error.code).toBe(
      "SUBMISSION_CLOSED",
    );
  });

  it("marks AVERAGE and LAST scoring across attempts", async () => {
    const avg = await quiz({
      title: "Average",
      attemptScoring: "AVERAGE",
      timeLimitMinutes: null,
      questions: [{ questionId: bank.tf?.id }, { questionId: bank.single?.id }],
    });
    for (const answers of [
      [{ questionId: bank.tf?.id, response: { optionIds: ["true"] } }],
      [
        { questionId: bank.tf?.id, response: { optionIds: ["true"] } },
        { questionId: bank.single?.id, response: { optionIds: ["b"] } },
      ],
    ]) {
      const a = (await start("sEnrolled", avg.id)).json<QuizAttempt>();
      await save("sEnrolled", a.id, 1, answers);
      expect((await submit("sEnrolled", a.id)).json<QuizAttempt>().status).toBe("GRADED");
    }
    const grade = await q<{ score: string }>("SELECT score FROM grades WHERE assessment_id = $1", [
      avg.assessmentId,
    ]);
    // (1.00 + 3.00) / 2
    expect(grade.rows[0]?.score).toBe("2.00");
  });
});
