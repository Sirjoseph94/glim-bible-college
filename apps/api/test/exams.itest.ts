import type {
  Gradebook,
  GradebookColumn,
  Grade,
  MyQuizAttempts,
  OnlineGrant,
  Question,
  Quiz,
  QuizAttempt,
} from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * Hybrid exams (TRD §14.2, C-34, Appendix C.2). O1 is taught by l1Primary (PRIMARY) and taken by
 * sEnrolled; sCompleted finished it; sOther takes O2. Persona students are Online unless a test
 * makes them On-campus.
 */

let t: TestApp;
let p: Personas;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

interface ErrorBody {
  error: { code: string; fieldErrors?: { path: string }[] };
}

const send = (
  as: PersonaName,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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
const ifMatch = (v: number) => ({ "if-match": `"${String(v)}"` });

async function studentId(as: PersonaName): Promise<string> {
  const { rows } = await q<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [
    p[as].userId,
  ]);
  return rows[0]?.id ?? "";
}

async function setStudyMode(as: PersonaName, mode: "ON_CAMPUS" | "ONLINE") {
  await q(
    "UPDATE programme_enrollments SET study_mode = $2 WHERE student_id = (SELECT id FROM students WHERE user_id = $1)",
    [p[as].userId, mode],
  );
}

/** Two choice questions worth 33 and 17 points: 50 in all. */
async function questions(): Promise<[Question, Question]> {
  const make = async (points: string, prompt: string) => {
    const res = await send(
      "l1Primary",
      "POST",
      `/course-offerings/${O1()}/questions`,
      {
        qtype: "MCQ_SINGLE",
        promptMd: prompt,
        defaultPoints: points,
        options: [
          { id: "a", text: "Right", correct: true },
          { id: "b", text: "Wrong", correct: false },
        ],
      },
      key(),
    );
    expect(res.statusCode, res.body).toBe(201);
    return res.json<Question>();
  };
  return [await make("33", "Who wrote Romans?"), await make("17", "Where is Corinth?")];
}

async function exam(title: string, maxScore = "100", weight = "0"): Promise<GradebookColumn> {
  const res = await send(
    "l1Primary",
    "POST",
    `/course-offerings/${O1()}/exams`,
    { title, maxScore, weight, heldAt: "2026-12-01T09:00:00Z" },
    key(),
  );
  expect(res.statusCode, res.body).toBe(201);
  return res.json<GradebookColumn>();
}

async function online(column: GradebookColumn, qs: Question[]): Promise<Quiz> {
  const res = await send(
    "l1Primary",
    "POST",
    `/assessments/${column.assessmentId}/online-exam`,
    { questions: qs.map((x) => ({ questionId: x.id })), timeLimitMinutes: 60 },
    key(),
  );
  expect(res.statusCode, res.body).toBe(201);
  const quiz = res.json<Quiz>();
  const pub = await send("l1Primary", "POST", `/quizzes/${quiz.id}/publish`, undefined, key());
  expect(pub.statusCode, pub.body).toBe(200);
  return pub.json<Quiz>();
}

/** Starts, answers the first question right and the second wrong (33/50), and submits. */
async function sit(as: PersonaName, quiz: Quiz, qs: Question[]): Promise<QuizAttempt> {
  const started = await send(as, "POST", `/quizzes/${quiz.id}/attempts`);
  expect(started.statusCode, started.body).toBe(200);
  const attempt = started.json<QuizAttempt>();
  const saved = await send(as, "PATCH", `/quiz-attempts/${attempt.id}`, {
    seq: 1,
    responses: [
      { questionId: qs[0]?.id, response: { optionIds: ["a"] } },
      { questionId: qs[1]?.id, response: { optionIds: ["b"] } },
    ],
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const done = await send(as, "POST", `/quiz-attempts/${attempt.id}/submit`, undefined, key());
  expect(done.statusCode, done.body).toBe(200);
  return done.json<QuizAttempt>();
}

const gradeOf = async (assessmentId: string, sid: string) => {
  const { rows } = await q<{
    score: string | null;
    source: string;
    status: string;
    version: number;
  }>(
    "SELECT score, source, status, version FROM grades WHERE assessment_id = $1 AND student_id = $2",
    [assessmentId, sid],
  );
  return rows[0];
};

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
});

afterAll(async () => {
  await t.close();
});

describe("an exam with paper and online parts", () => {
  it("Appendix C.2: 66 on paper and 33/50 online both give 66.00 in the same column", async () => {
    const qs = await questions();
    const column = await exam("Final exam", "100", "0");
    expect(column).toMatchObject({ kind: "EXAM", status: "PUBLISHED", onlineQuizId: null });
    const quiz = await online(column, qs);
    expect(quiz).toMatchObject({
      kind: "EXAM",
      eligibleStudyMode: "ONLINE",
      maxScore: "100.00",
      pointsTotal: "50.00",
      title: "Final exam",
    });

    // The Online student sits it online: 33 of 50 points, scaled to the exam's 100.
    await setStudyMode("sEnrolled", "ONLINE");
    const attempt = await sit("sEnrolled", quiz, qs);
    expect(attempt).toMatchObject({ score: "33.00", maxScore: "50.00" });
    const enrolled = await studentId("sEnrolled");
    expect(await gradeOf(column.assessmentId, enrolled)).toMatchObject({
      score: "66.00",
      source: "QUIZ",
      status: "DRAFT",
    });

    // A paper score for another student goes in the same column as MANUAL.
    const completed = await studentId("sCompleted");
    const paper = await send(
      "l1Primary",
      "PUT",
      `/assessments/${column.assessmentId}/grades/${completed}`,
      { score: "66" },
      ifMatch(0),
    );
    expect(paper.statusCode, paper.body).toBe(200);
    expect(paper.json<Grade>()).toMatchObject({ score: "66.00", source: "MANUAL" });

    const book = (
      await send("l1Primary", "GET", `/course-offerings/${O1()}/gradebook`)
    ).json<Gradebook>();
    expect(book.columns.find((c) => c.assessmentId === column.assessmentId)?.onlineQuizId).toBe(
      quiz.id,
    );
    const row = book.rows.find((r) => r.studentId === enrolled);
    expect(row?.onlineScores).toEqual([{ assessmentId: column.assessmentId, score: "66.00" }]);
  });

  it("keeps an exam's maximum when the online part's questions change", async () => {
    const qs = await questions();
    const column = await exam("Resit", "80");
    const res = await send(
      "l1Primary",
      "POST",
      `/assessments/${column.assessmentId}/online-exam`,
      { questions: [{ questionId: qs[0].id }], timeLimitMinutes: 30 },
      key(),
    );
    const quiz = res.json<Quiz>();
    const changed = await send(
      "l1Primary",
      "PATCH",
      `/quizzes/${quiz.id}`,
      { questions: qs.map((x) => ({ questionId: x.id })) },
      ifMatch(quiz.version),
    );
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json<Quiz>()).toMatchObject({ maxScore: "80.00", pointsTotal: "50.00" });
    const { rows } = await q<{ due_at: Date }>("SELECT due_at FROM assessments WHERE id = $1", [
      column.assessmentId,
    ]);
    expect(rows[0]?.due_at.toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });

  it("gives an exam one online part, and only an exam", async () => {
    const qs = await questions();
    const column = await exam("One online part");
    await online(column, qs);
    const again = await send(
      "l1Primary",
      "POST",
      `/assessments/${column.assessmentId}/online-exam`,
      { questions: [{ questionId: qs[0].id }], timeLimitMinutes: 30 },
      key(),
    );
    expect(again.statusCode).toBe(409);
    const manual = await send(
      "l1Primary",
      "POST",
      `/course-offerings/${O1()}/assessments`,
      { title: "Not an exam", maxScore: "10", weight: "0" },
      key(),
    );
    const notExam = await send(
      "l1Primary",
      "POST",
      `/assessments/${manual.json<GradebookColumn>().assessmentId}/online-exam`,
      { questions: [{ questionId: qs[0].id }], timeLimitMinutes: 30 },
      key(),
    );
    expect(notExam.statusCode).toBe(409);
    // An Assistant can't set exams.
    const assistant = await send(
      "l3Assistant",
      "POST",
      `/course-offerings/${O1()}/exams`,
      { title: "Nope", maxScore: "100", weight: "0" },
      key(),
    );
    expect(assistant.statusCode).toBe(404);
  });
});

describe("eligibility and exceptions", () => {
  it("On-campus students sit on paper unless the Lecturer lets them in", async () => {
    const qs = await questions();
    const quiz = await online(await exam("Eligibility exam"), qs);
    await setStudyMode("sEnrolled", "ON_CAMPUS");
    try {
      const refused = await send("sEnrolled", "POST", `/quizzes/${quiz.id}/attempts`);
      expect(refused.statusCode).toBe(403);
      expect(refused.json<ErrorBody>().error.code).toBe("NOT_ELIGIBLE_FOR_ONLINE_EXAM");
      const mine = (
        await send("sEnrolled", "GET", `/quizzes/${quiz.id}/my-attempts`)
      ).json<MyQuizAttempts>();
      expect(mine).toMatchObject({ eligible: false, open: false });

      const sid = await studentId("sEnrolled");
      const granted = await send("l1Primary", "PUT", `/quizzes/${quiz.id}/online-grants/${sid}`, {
        reason: "Travelling for ministry",
      });
      expect(granted.statusCode, granted.body).toBe(200);
      expect(granted.json<OnlineGrant>()).toMatchObject({
        studentName: "sEnrolled Persona",
        reason: "Travelling for ministry",
      });
      // Granting again keeps the first grant.
      await send("l1Primary", "PUT", `/quizzes/${quiz.id}/online-grants/${sid}`, {
        reason: "Again",
      });
      const list = (await send("l1Primary", "GET", `/quizzes/${quiz.id}/online-grants`)).json<{
        items: OnlineGrant[];
      }>();
      expect(list.items.map((g) => g.reason)).toEqual(["Travelling for ministry"]);
      const audit = await q(
        "SELECT 1 FROM audit_logs WHERE action = 'assessment.exam.online-granted' AND resource_id = $1",
        [quiz.id],
      );
      expect(audit.rowCount).toBe(1);

      expect(
        (await send("sEnrolled", "GET", `/quizzes/${quiz.id}/my-attempts`)).json<MyQuizAttempts>(),
      ).toMatchObject({ eligible: true, open: true });
      const started = await send("sEnrolled", "POST", `/quizzes/${quiz.id}/attempts`);
      expect(started.statusCode, started.body).toBe(200);

      // Withdrawing the exception keeps the attempt already started.
      const revoked = await send("l1Primary", "DELETE", `/quizzes/${quiz.id}/online-grants/${sid}`);
      expect(revoked.statusCode).toBe(204);
      const resumed = await send("sEnrolled", "POST", `/quizzes/${quiz.id}/attempts`);
      expect(resumed.statusCode, resumed.body).toBe(200);
      expect(resumed.json<QuizAttempt>().id).toBe(started.json<QuizAttempt>().id);
      expect(
        (await send("l1Primary", "DELETE", `/quizzes/${quiz.id}/online-grants/${sid}`)).statusCode,
      ).toBe(404);
    } finally {
      await setStudyMode("sEnrolled", "ONLINE");
    }
  });

  it("refuses grants for students not on the course and for ordinary quizzes", async () => {
    const qs = await questions();
    const quiz = await online(await exam("Grant checks"), qs);
    const other = await send(
      "l1Primary",
      "PUT",
      `/quizzes/${quiz.id}/online-grants/${await studentId("sOther")}`,
      { reason: "x" },
    );
    expect(other.statusCode).toBe(404);
    const plain = await send(
      "l1Primary",
      "POST",
      `/course-offerings/${O1()}/quizzes`,
      { title: "Plain quiz", weight: "0", questions: [{ questionId: qs[0].id }] },
      key(),
    );
    const forAll = await send(
      "l1Primary",
      "PUT",
      `/quizzes/${plain.json<Quiz>().id}/online-grants/${await studentId("sEnrolled")}`,
      { reason: "x" },
    );
    expect(forAll.statusCode).toBe(409);
  });
});

describe("choosing between paper and online scores", () => {
  it("a paper score stays when the student also sits online; the Lecturer can switch with a reason", async () => {
    const qs = await questions();
    const column = await exam("Both ways");
    const quiz = await online(column, qs);
    const sid = await studentId("sEnrolled");
    const paper = await send(
      "l1Primary",
      "PUT",
      `/assessments/${column.assessmentId}/grades/${sid}`,
      { score: "50" },
      ifMatch(0),
    );
    expect(paper.statusCode, paper.body).toBe(200);

    await sit("sEnrolled", quiz, qs);
    expect(await gradeOf(column.assessmentId, sid)).toMatchObject({
      score: "50.00",
      source: "MANUAL",
    });

    const version = (await gradeOf(column.assessmentId, sid))?.version ?? 0;
    const noReason = await send(
      "l1Primary",
      "POST",
      `/assessments/${column.assessmentId}/grades/${sid}/online-score`,
      {},
      ifMatch(version),
    );
    expect(noReason.statusCode).toBe(400);
    const used = await send(
      "l1Primary",
      "POST",
      `/assessments/${column.assessmentId}/grades/${sid}/online-score`,
      { reason: "Sat online after illness" },
      ifMatch(version),
    );
    expect(used.statusCode, used.body).toBe(200);
    expect(used.json<Grade>()).toMatchObject({ score: "66.00", source: "QUIZ" });
    const history = await q<{ old_source: string; new_source: string; reason: string }>(
      `SELECT gc.old_source, gc.new_source, gc.reason FROM grade_changes gc
         JOIN grades g ON g.id = gc.grade_id
        WHERE g.assessment_id = $1 AND g.student_id = $2 ORDER BY gc.created_at DESC, gc.id DESC LIMIT 1`,
      [column.assessmentId, sid],
    );
    expect(history.rows[0]).toEqual({
      old_source: "MANUAL",
      new_source: "QUIZ",
      reason: "Sat online after illness",
    });
    const audit = await q<{ metadata: { reason: string } }>(
      "SELECT metadata FROM audit_logs WHERE action = 'assessment.grade.source-changed' AND metadata->>'assessmentId' = $1",
      [column.assessmentId],
    );
    expect(audit.rows[0]?.metadata.reason).toBe("Sat online after illness");

    // Typing a paper score over the online one needs a reason too.
    const back = used.json<Grade>().version;
    const typed = await send(
      "l1Primary",
      "PUT",
      `/assessments/${column.assessmentId}/grades/${sid}`,
      { score: "70" },
      ifMatch(back),
    );
    expect(typed.statusCode).toBe(400);
    expect(typed.json<ErrorBody>().error.fieldErrors?.[0]?.path).toBe("body.reason");
    // Feedback alone keeps the online score's source.
    const feedback = await send(
      "l1Primary",
      "PUT",
      `/assessments/${column.assessmentId}/grades/${sid}`,
      { score: "66", feedbackMd: "Good recovery." },
      ifMatch(back),
    );
    expect(feedback.json<Grade>()).toMatchObject({ source: "QUIZ", score: "66.00" });
    const withReason = await send(
      "l1Primary",
      "PUT",
      `/assessments/${column.assessmentId}/grades/${sid}`,
      { score: "70", reason: "Paper script found" },
      ifMatch(back + 1),
    );
    expect(withReason.json<Grade>()).toMatchObject({ source: "MANUAL", score: "70.00" });
  });

  it("refuses to use an online score the student doesn't have", async () => {
    const qs = await questions();
    const column = await exam("No attempt");
    await online(column, qs);
    const res = await send(
      "l1Primary",
      "POST",
      `/assessments/${column.assessmentId}/grades/${await studentId("sCompleted")}/online-score`,
      { reason: "x" },
      ifMatch(0),
    );
    expect(res.statusCode).toBe(409);
  });

  it("a CSV import can't replace an online score", async () => {
    const qs = await questions();
    const column = await exam("Import over online");
    const quiz = await online(column, qs);
    await sit("sEnrolled", quiz, qs);
    const { rows } = await q<{ matric: string }>(
      `SELECT pe.matric_number AS matric FROM programme_enrollments pe
         JOIN students s ON s.id = pe.student_id WHERE s.user_id = $1`,
      [p.sEnrolled.userId],
    );
    const res = await send("l1Primary", "POST", `/course-offerings/${O1()}/grades/import`, {
      assessmentId: column.assessmentId,
      csv: `matric_number,score\n${rows[0]?.matric ?? ""},40\n`,
      dryRun: false,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{ applied: boolean; rows: { message: string }[] }>();
    expect(body.applied).toBe(false);
    expect(body.rows[0]?.message).toContain("online exam score");
  });
});
