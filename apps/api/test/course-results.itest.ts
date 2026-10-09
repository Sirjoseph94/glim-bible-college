import type { CourseResultRow, CourseResults, GradebookColumn, MyResults } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * Course result finalization (TRD §14.3, Appendix C.2). O1 (PBIB101, 3 credits) is taught by
 * l1Primary (PRIMARY) and l2Co, and taken by sEnrolled (ENROLLED); sCompleted and sGraduated
 * finished it (COMPLETED).
 */

let t: TestApp;
let p: Personas;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

interface ErrorBody {
  error: { code: string; message: string };
}

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
const finalize = (as: PersonaName = "l1Primary") =>
  send(as, "POST", `/course-offerings/${O1()}/results/finalize`, undefined, key());
const results = async () =>
  (await send("l1Primary", "GET", `/course-offerings/${O1()}/results`)).json<CourseResults>();

async function studentId(as: PersonaName): Promise<string> {
  const { rows } = await q<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [
    p[as].userId,
  ]);
  return rows[0]?.id ?? "";
}

async function column(title: string, maxScore: string, weight: string): Promise<GradebookColumn> {
  const res = await send(
    "l1Primary",
    "POST",
    `/course-offerings/${O1()}/assessments`,
    { title, maxScore, weight },
    key(),
  );
  expect(res.statusCode, res.body).toBe(201);
  return res.json<GradebookColumn>();
}

async function grade(
  col: GradebookColumn,
  as: PersonaName,
  body: Record<string, unknown>,
  version = 0,
) {
  return send(
    "l1Primary",
    "PUT",
    `/assessments/${col.assessmentId}/grades/${await studentId(as)}`,
    body,
    { "if-match": `"${String(version)}"` },
  );
}

const row = (r: CourseResults, as: PersonaName) =>
  r.items.find((i) => i.studentName === `${as} Persona`);

let quiz: GradebookColumn;
let assignment: GradebookColumn;
let exam: GradebookColumn;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  // Appendix C.2: Quiz (max 20, weight 20), Assignment (max 50, weight 30), Exam (max 100, weight 50).
  quiz = await column("Quiz", "20", "20");
  assignment = await column("Assignment", "50", "30");
  exam = await column("Exam", "100", "50");
  for (const [col, score] of [
    [quiz, "15"],
    [assignment, "40"],
    [exam, "66"],
  ] as const)
    expect((await grade(col, "sEnrolled", { score })).statusCode).toBe(200);
  expect((await grade(quiz, "sCompleted", { score: "15" })).statusCode).toBe(200);
  expect((await grade(assignment, "sCompleted", { score: null, excused: true })).statusCode).toBe(
    200,
  );
  expect((await grade(exam, "sCompleted", { score: "66" })).statusCode).toBe(200);
});

afterAll(async () => {
  await t.close();
});

describe("before finalizing", () => {
  it("needs the programme to have a grading scheme", async () => {
    const r = await results();
    expect(r.blocker).toContain("PDIP programme has no grading scheme");
    const res = await finalize();
    expect(res.statusCode).toBe(409);
    await q(
      "UPDATE programmes SET grading_scheme_id = (SELECT id FROM grading_schemes WHERE name = 'GLIM Diploma') WHERE code = 'PDIP'",
    );
  });

  it("previews each result: 72.00 ⇒ A, and the excused assignment renormalised to 68.57 ⇒ B", async () => {
    const r = await results();
    expect(r.blocker).toBeNull();
    expect(r.finalized).toBe(0);
    expect(row(r, "sEnrolled")).toMatchObject({
      id: null,
      status: null,
      creditsX10: 30,
      finalPctX100: 7200,
      letter: "A",
      pointsX100: 500,
      qualityPointsX1000: 15_000,
      passed: true,
      resultKind: "GRADED",
      attemptNo: 1,
    });
    expect(row(r, "sCompleted")).toMatchObject({
      finalPctX100: 6857,
      letter: "B",
      pointsX100: 400,
    });
  });

  it("refuses when the weights don't total 100", async () => {
    const extra = await column("Extra", "10", "0.01");
    const res = await finalize();
    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe("WEIGHTS_NOT_100");
    await send(
      "l1Primary",
      "PATCH",
      `/assessments/${extra.assessmentId}`,
      { weight: "0" },
      { "if-match": `"${String(extra.version)}"` },
    );
  });

  it("is for the PRIMARY Lecturer (or an Academic Admin), not a Co-Lecturer", async () => {
    expect((await finalize("l2Co")).statusCode).toBe(404);
    expect((await send("sEnrolled", "GET", `/course-offerings/${O1()}/results`)).statusCode).toBe(
      404,
    );
  });
});

describe("finalizing", () => {
  it("freezes each result, locks the scheme and the gradebook, and tells the students", async () => {
    const res = await finalize();
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json<CourseResults>();
    expect(r.finalized).toBe(3);
    expect(row(r, "sEnrolled")).toMatchObject({ status: "FINALIZED", letter: "A" });
    expect(row(r, "sCompleted")).toMatchObject({ status: "FINALIZED", letter: "B" });

    const frozen = await q<Record<string, unknown>>(
      `SELECT r.credits_x10, r.final_pct_x100, r.letter, r.points_x100, r.quality_points_x1000::int AS qp,
              r.passed, r.counts_in_gpa, r.result_kind, r.attempt_no,
              r.programme_enrollment_id = ce.programme_enrollment_id AS same_enrollment,
              r.semester_id = o.semester_id AS same_semester,
              r.grading_scheme_id = (SELECT id FROM grading_schemes WHERE name = 'GLIM Diploma') AS same_scheme
         FROM course_results r JOIN course_enrollments ce ON ce.id = r.course_enrollment_id
         JOIN course_offerings o ON o.id = r.course_offering_id
        WHERE r.student_id = $1`,
      [await studentId("sEnrolled")],
    );
    expect(frozen.rows[0]).toEqual({
      credits_x10: 30,
      final_pct_x100: 7200,
      letter: "A",
      points_x100: 500,
      qp: 15_000,
      passed: true,
      counts_in_gpa: true,
      result_kind: "GRADED",
      attempt_no: 1,
      same_enrollment: true,
      same_semester: true,
      same_scheme: true,
    });
    const scheme = await q<{ locked_at: Date | null }>(
      "SELECT locked_at FROM grading_schemes WHERE name = 'GLIM Diploma'",
    );
    expect(scheme.rows[0]?.locked_at).not.toBeNull();

    const locked = await grade(exam, "sEnrolled", { score: "90", reason: "x" }, 1);
    expect(locked.statusCode).toBe(409);
    expect(locked.json<ErrorBody>().error.code).toBe("GRADEBOOK_LOCKED");
    const newColumn = await send(
      "l1Primary",
      "POST",
      `/course-offerings/${O1()}/assessments`,
      { title: "Late", maxScore: "10", weight: "0" },
      key(),
    );
    expect(newColumn.json<ErrorBody>().error.code).toBe("GRADEBOOK_LOCKED");

    const notices = await q(
      "SELECT 1 FROM notifications WHERE kind = 'results.course-finalized' AND user_id = $1",
      [p.sEnrolled.userId],
    );
    expect(notices.rowCount).toBe(1);
    const audit = await q<{ metadata: { count: number } }>(
      "SELECT metadata FROM audit_logs WHERE action = 'results.course.finalized' AND resource_id = $1",
      [O1()],
    );
    expect(audit.rows.map((a) => a.metadata.count)).toEqual([3]);

    // Finalizing again with nothing new changes nothing.
    expect((await finalize()).json<CourseResults>().finalized).toBe(3);
    const again = await q(
      "SELECT 1 FROM audit_logs WHERE action = 'results.course.finalized' AND resource_id = $1",
      [O1()],
    );
    expect(again.rowCount).toBe(1);
  });

  it("shows students their results at once, with GPA and CGPA Provisional", async () => {
    const mine = (await send("sEnrolled", "GET", "/me/results")).json<MyResults>();
    const programme = mine.programmes[0];
    expect(programme?.programmeName).toBe("Persona Diploma");
    expect(programme?.semesters).toHaveLength(1);
    expect(programme?.semesters[0]).toMatchObject({
      creditsAttemptedX10: 30,
      creditsEarnedX10: 30,
      gpaX100: 500,
      cgpaX100: 500,
      standing: "GOOD",
      provisional: true,
    });
    expect(programme?.semesters[0]?.results[0]).toMatchObject({
      courseCode: "PBIB101",
      letter: "A",
      finalPctX100: 7200,
      status: "FINALIZED",
    });
    const other = (await send("sOther", "GET", "/me/results")).json<MyResults>();
    expect(other.programmes.flatMap((x) => x.semesters)).toEqual([]);
    expect((await send("l1Primary", "GET", "/me/results")).json<MyResults>().programmes).toEqual(
      [],
    );
  });
});

describe("reopening", () => {
  it("is for the Registrar with a reason: back to DRAFT, that student's grades unlocked, revisions kept", async () => {
    const before = row(await results(), "sCompleted");
    const id = before?.id ?? "";
    expect(
      (await send("acadAdmin", "POST", `/course-results/${id}/reopen`, { reason: "x" })).statusCode,
    ).toBe(403);
    expect(
      (await send("l1Primary", "POST", `/course-results/${id}/reopen`, { reason: "x" })).statusCode,
    ).toBe(403);
    expect((await send("registrar", "POST", `/course-results/${id}/reopen`, {})).statusCode).toBe(
      400,
    );
    const res = await send("registrar", "POST", `/course-results/${id}/reopen`, {
      reason: "Exam script found unmarked",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<CourseResultRow>()).toMatchObject({ status: "DRAFT", reopenedCount: 1 });
    expect(
      (
        await send("registrar", "POST", `/course-results/${id}/reopen`, { reason: "again" })
      ).json<ErrorBody>().error.code,
    ).toBe("RESULT_NOT_FINALIZED");

    const revisions = await q<{
      change_kind: string;
      reason: string;
      old_value: { letter: string };
    }>(
      "SELECT change_kind, reason, old_value FROM course_result_revisions WHERE course_result_id = $1",
      [id],
    );
    expect(revisions.rows).toHaveLength(1);
    expect(revisions.rows[0]).toMatchObject({
      change_kind: "REOPEN",
      reason: "Exam script found unmarked",
      old_value: { letter: "B" },
    });
    // The student no longer sees it; their grades open up, the other student's stay locked.
    const mine = (await send("sCompleted", "GET", "/me/results")).json<MyResults>();
    expect(mine.programmes.flatMap((x) => x.semesters)).toEqual([]);
    expect((await grade(exam, "sEnrolled", { score: "90", reason: "x" }, 1)).statusCode).toBe(409);
    // The missing exam grade now counts 0: (15/20 × 20 + 0) ÷ 70 = 21.43 % ⇒ F.
    const cleared = await grade(exam, "sCompleted", { score: null }, 1);
    expect(cleared.statusCode, cleared.body).toBe(200);
    const preview = row(await results(), "sCompleted");
    expect(preview).toMatchObject({
      status: "DRAFT",
      finalPctX100: 2143,
      letter: "F",
      passed: false,
    });

    const refinalized = await finalize();
    expect(row(refinalized.json<CourseResults>(), "sCompleted")).toMatchObject({
      status: "FINALIZED",
      letter: "F",
      reopenedCount: 1,
    });
    const kinds = await q<{ change_kind: string }>(
      "SELECT change_kind FROM course_result_revisions WHERE course_result_id = $1 ORDER BY created_at, id",
      [id],
    );
    expect(kinds.rows.map((k) => k.change_kind)).toEqual(["REOPEN", "REFINALIZE"]);
    const audit = await q(
      "SELECT 1 FROM audit_logs WHERE action = 'results.course.reopened' AND resource_id = $1",
      [id],
    );
    expect(audit.rowCount).toBe(1);
  });
});
