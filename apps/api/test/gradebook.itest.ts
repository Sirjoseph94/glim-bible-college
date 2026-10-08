import type { Assignment, Grade, Gradebook, GradebookColumn, MyGrade } from "@glim/contracts";
import { GradebookService } from "@glim/modules/assessment";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * The gradebook and grade release (TRD §14.2, AC-11). O1 is taught by l1Primary (PRIMARY), l2Co
 * and l3Assistant (who may enter grades but not release them) and taken by sEnrolled; sCompleted
 * finished it; sOther takes O2.
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

async function student(as: PersonaName): Promise<{ id: string; matric: string }> {
  const { rows } = await q<{ id: string; matric: string }>(
    `SELECT s.id, pe.matric_number AS matric FROM students s
       JOIN programme_enrollments pe ON pe.student_id = s.id WHERE s.user_id = $1`,
    [p[as].userId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`${as} isn't a student`);
  return row;
}

async function assignmentColumn(title: string, weight = "20"): Promise<Assignment> {
  const res = await send(
    "l1Primary",
    "POST",
    `/course-offerings/${O1()}/assignments`,
    {
      title,
      instructionsMd: "Write.",
      dueAt: "2026-11-10T23:59:00Z",
      maxScore: "20",
      weight,
    },
    key(),
  );
  expect(res.statusCode, res.body).toBe(201);
  const created = res.json<Assignment>();
  const pub = await send(
    "l1Primary",
    "POST",
    `/assignments/${created.id}/publish`,
    undefined,
    key(),
  );
  expect(pub.statusCode, pub.body).toBe(200);
  return pub.json<Assignment>();
}

async function manualColumn(title: string, weight: string, maxScore = "10") {
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
  assessmentId: string,
  studentId: string,
  body: Record<string, unknown>,
  version = 0,
  as: PersonaName = "l1Primary",
) {
  return send(as, "PUT", `/assessments/${assessmentId}/grades/${studentId}`, body, {
    "if-match": `"${String(version)}"`,
  });
}

const gradebook = async (as: PersonaName = "l1Primary") =>
  (await send(as, "GET", `/course-offerings/${O1()}/gradebook`)).json<Gradebook>();
const myGrades = async (as: PersonaName) =>
  (await send(as, "GET", `/course-offerings/${O1()}/my-grades`)).json<{ items: MyGrade[] }>().items;
const release = (assessmentId: string, as: PersonaName = "l1Primary", k = key()) =>
  send(as, "POST", `/assessments/${assessmentId}/release`, undefined, k);
const importCsv = (assessmentId: string, csv: string, dryRun: boolean, as: PersonaName = "l2Co") =>
  send(as, "POST", `/course-offerings/${O1()}/grades/import`, { assessmentId, csv, dryRun });

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

describe("the gradebook view", () => {
  it("lists every column and the course's students with their grades, and the weight total", async () => {
    const a = await assignmentColumn("Gradebook essay", "30");
    const enrolled = await student("sEnrolled");
    const res = await grade(a.assessmentId, enrolled.id, { score: "15", feedbackMd: "Good." });
    expect(res.statusCode, res.body).toBe(200);

    const view = await gradebook();
    const column = view.columns.find((c) => c.assessmentId === a.assessmentId);
    expect(column).toMatchObject({ kind: "ASSIGNMENT", weight: "30.00", status: "PUBLISHED" });
    expect(column?.unreleased).toBe(1);
    const names = view.rows.map((r) => r.studentName);
    expect(names).toContain("sEnrolled Persona");
    expect(names).toContain("sCompleted Persona");
    expect(names).not.toContain("sOther Persona");
    const row = view.rows.find((r) => r.studentId === enrolled.id);
    expect(row?.matricNumber).toBe(enrolled.matric);
    expect(row?.studyMode).toBe("ONLINE");
    expect(row?.grades.find((g) => g.assessmentId === a.assessmentId)).toMatchObject({
      score: "15.00",
      status: "DRAFT",
      source: "SUBMISSION",
    });
    expect(view.weightsValid).toBe(view.weightTotal === "100.00");
  });

  it("is for the course's staff: students and other Lecturers can't see it", async () => {
    expect((await send("sEnrolled", "GET", `/course-offerings/${O1()}/gradebook`)).statusCode).toBe(
      404,
    );
    expect((await send("l4Other", "GET", `/course-offerings/${O1()}/gradebook`)).statusCode).toBe(
      404,
    );
    expect((await send("registrar", "GET", `/course-offerings/${O1()}/gradebook`)).statusCode).toBe(
      200,
    );
  });
});

describe("columns and weights", () => {
  it("adds hand-entered columns and changes weights with If-Match", async () => {
    const column = await manualColumn("Participation", "5");
    expect(column).toMatchObject({ kind: "MANUAL", status: "PUBLISHED", maxScore: "10.00" });

    const stale = await send(
      "l1Primary",
      "PATCH",
      `/assessments/${column.assessmentId}`,
      { weight: "7.5" },
      { "if-match": `"${String(column.version + 1)}"` },
    );
    expect(stale.statusCode).toBe(412);
    const res = await send(
      "l1Primary",
      "PATCH",
      `/assessments/${column.assessmentId}`,
      { weight: "7.5", title: "Class participation" },
      { "if-match": `"${String(column.version)}"` },
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<GradebookColumn>()).toMatchObject({
      title: "Class participation",
      weight: "7.50",
    });
    const audit = await q<{ metadata: Record<string, string> }>(
      "SELECT metadata FROM audit_logs WHERE action = 'assessment.column.updated' AND resource_id = $1",
      [column.assessmentId],
    );
    expect(audit.rows[0]?.metadata).toMatchObject({ oldWeight: "5.00", weight: "7.5" });

    // An Assistant may grade but not set up the gradebook.
    const assistant = await send(
      "l3Assistant",
      "POST",
      `/course-offerings/${O1()}/assessments`,
      { title: "Nope", maxScore: "10", weight: "1" },
      key(),
    );
    expect(assistant.statusCode).toBe(404);
  });

  it("finalization's weights check needs the published columns to add up to exactly 100", async () => {
    const service = t.app.get(GradebookService);
    const before = await gradebook();
    const missing = 10_000 - Math.round(Number(before.weightTotal) * 100);
    const check = await t.db.withTx(({ db }) => service.checkWeights(db, O1()));
    if (missing !== 0) {
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.error.code).toBe("WEIGHTS_NOT_100");
    }
    if (missing > 0) {
      await manualColumn("Balance", (missing / 100).toFixed(2));
      const after = await gradebook();
      expect(after.weightTotal).toBe("100.00");
      expect(after.weightsValid).toBe(true);
      const ok = await t.db.withTx(({ db }) => service.checkWeights(db, O1()));
      expect(ok.ok).toBe(true);
      // One hundredth over is refused too.
      const extra = await manualColumn("Extra", "0.01");
      const over = await t.db.withTx(({ db }) => service.checkWeights(db, O1()));
      expect(over.ok).toBe(false);
      await send(
        "l1Primary",
        "PATCH",
        `/assessments/${extra.assessmentId}`,
        { weight: "0" },
        { "if-match": `"${String(extra.version)}"` },
      );
    }
  });
});

describe("release", () => {
  it("students see nothing until the column is released, then only released grades", async () => {
    const a = await assignmentColumn("Release essay", "0");
    const enrolled = await student("sEnrolled");
    const completed = await student("sCompleted");
    expect(
      (await grade(a.assessmentId, enrolled.id, { score: "18.5", feedbackMd: "**Well** argued." }))
        .statusCode,
    ).toBe(200);
    expect(
      (await myGrades("sEnrolled")).find((x) => x.assessmentId === a.assessmentId),
    ).toBeUndefined();

    const k = key();
    const res = await release(a.assessmentId, "l2Co", k);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ released: number }>().released).toBe(1);
    // The same key replays; a new release with nothing new changes nothing.
    const replay = await release(a.assessmentId, "l2Co", k);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect((await release(a.assessmentId)).json<{ released: number }>().released).toBe(0);

    const mine = (await myGrades("sEnrolled")).find((x) => x.assessmentId === a.assessmentId);
    expect(mine).toMatchObject({ score: "18.50", maxScore: "20.00", excused: false });
    expect(mine?.feedbackHtml).toContain("<strong>Well</strong>");
    const notices = await q<{ title: string }>(
      "SELECT title FROM notifications WHERE kind = 'assessment.grade-released' AND user_id = $1",
      [p.sEnrolled.userId],
    );
    expect(notices.rows.map((r) => r.title)).toContainEqual(
      expect.stringContaining("Release essay"),
    );

    // A grade entered after the release waits for the next one.
    expect((await grade(a.assessmentId, completed.id, { score: "12" })).statusCode).toBe(200);
    expect((await myGrades("sCompleted")).some((x) => x.assessmentId === a.assessmentId)).toBe(
      false,
    );
    const column = (await gradebook()).columns.find((c) => c.assessmentId === a.assessmentId);
    expect(column).toMatchObject({ released: 1, unreleased: 1 });

    const history = await q<{ old_status: string; new_status: string }>(
      `SELECT gc.old_status, gc.new_status FROM grade_changes gc JOIN grades g ON g.id = gc.grade_id
        WHERE g.assessment_id = $1 AND g.student_id = $2 ORDER BY gc.created_at, gc.id`,
      [a.assessmentId, enrolled.id],
    );
    expect(history.rows.at(-1)).toEqual({ old_status: "DRAFT", new_status: "RELEASED" });
    const audit = await q<{ metadata: { count: number } }>(
      "SELECT metadata FROM audit_logs WHERE action = 'assessment.grades.released' AND resource_id = $1",
      [a.assessmentId],
    );
    expect(audit.rows.map((r) => r.metadata.count)).toEqual([1]);

    // Other students on the course don't see someone else's grade.
    expect((await myGrades("sOther")).length).toBe(0);
  });

  it("only the PRIMARY and Co-Lecturers release; an Assistant can't", async () => {
    const a = await assignmentColumn("Assistant release", "0");
    const res = await release(a.assessmentId, "l3Assistant");
    expect(res.statusCode).toBe(404);
  });

  it("changing a released grade needs a reason, and it stays released", async () => {
    const a = await assignmentColumn("Regrade essay", "0");
    const enrolled = await student("sEnrolled");
    const first = await grade(a.assessmentId, enrolled.id, { score: "10" });
    await release(a.assessmentId);
    const version = first.json<Grade>().version + 1;

    const noReason = await grade(a.assessmentId, enrolled.id, { score: "12" }, version);
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json<ErrorBody>().error.fieldErrors?.[0]?.path).toBe("body.reason");
    // Feedback alone is fine.
    const feedback = await grade(
      a.assessmentId,
      enrolled.id,
      { score: "10", feedbackMd: "See me." },
      version,
    );
    expect(feedback.statusCode, feedback.body).toBe(200);

    const res = await grade(
      a.assessmentId,
      enrolled.id,
      { score: "12", reason: "Marking error" },
      version + 1,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Grade>().status).toBe("RELEASED");
    expect(
      (await myGrades("sEnrolled")).find((x) => x.assessmentId === a.assessmentId)?.score,
    ).toBe("12.00");
    const history = await q<{ reason: string | null; new_score: string }>(
      `SELECT gc.reason, gc.new_score FROM grade_changes gc JOIN grades g ON g.id = gc.grade_id
        WHERE g.assessment_id = $1 ORDER BY gc.created_at DESC, gc.id DESC LIMIT 1`,
      [a.assessmentId],
    );
    expect(history.rows[0]).toEqual({ reason: "Marking error", new_score: "12.00" });
  });

  it("excuses a student: no score, shown to them as excused", async () => {
    const column = await manualColumn("Excusable", "0");
    const enrolled = await student("sEnrolled");
    const res = await grade(column.assessmentId, enrolled.id, { score: null, excused: true });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Grade>()).toMatchObject({ status: "EXCUSED", score: null });
    expect((await release(column.assessmentId)).json<{ released: number }>().released).toBe(0);
    expect(
      (await myGrades("sEnrolled")).find((x) => x.assessmentId === column.assessmentId),
    ).toMatchObject({ excused: true, score: null });
    // Un-excusing with a score puts it back in draft.
    const back = await grade(column.assessmentId, enrolled.id, { score: "6" }, 1);
    expect(back.json<Grade>()).toMatchObject({ status: "DRAFT", score: "6.00" });
  });
});

describe("CSV grade import", () => {
  it("checks every row on a dry run and saves nothing", async () => {
    const column = await manualColumn("Paper test", "0", "50");
    const enrolled = await student("sEnrolled");
    const other = await student("sOther");
    const csv = [
      "Matric_Number,Score,Feedback",
      `${enrolled.matric.toLowerCase()},41.5,Solid`,
      `${other.matric},30,`,
      "GLIM/NOBODY,10,",
      `${enrolled.matric},20,`,
    ].join("\n");
    const res = await importCsv(column.assessmentId, csv, true);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<{
      applied: boolean;
      errors: number;
      created: number;
      rows: { line: number; outcome: string; newScore: string | null; message: string | null }[];
    }>();
    expect(body).toMatchObject({ applied: false, errors: 3, created: 1 });
    expect(body.rows.map((r) => [r.line, r.outcome])).toEqual([
      [2, "created"],
      [3, "error"],
      [4, "error"],
      [5, "error"],
    ]);
    expect(body.rows[0]?.newScore).toBe("41.50");
    expect(body.rows[3]?.message).toContain("earlier line");
    // A row with an error stops the whole import even when it isn't a dry run.
    expect(
      (await importCsv(column.assessmentId, csv, false)).json<{ applied: boolean }>().applied,
    ).toBe(false);
    const saved = await q("SELECT 1 FROM grades WHERE assessment_id = $1", [column.assessmentId]);
    expect(saved.rowCount).toBe(0);
  });

  it("imports a clean file as IMPORT grades with history and audit", async () => {
    const column = await manualColumn("Paper exam", "0", "50");
    const enrolled = await student("sEnrolled");
    const completed = await student("sCompleted");
    await grade(column.assessmentId, completed.id, { score: "30" });
    const csv = `matric_number,score\n${enrolled.matric},44\n${completed.matric},30\n`;
    const res = await importCsv(column.assessmentId, csv, false);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ applied: true, created: 1, unchanged: 1, errors: 0 });

    const rows = await q<{ score: string; source: string; status: string }>(
      "SELECT score, source, status FROM grades WHERE assessment_id = $1 AND student_id = $2",
      [column.assessmentId, enrolled.id],
    );
    expect(rows.rows[0]).toEqual({ score: "44.00", source: "IMPORT", status: "DRAFT" });
    const history = await q<{ reason: string }>(
      `SELECT gc.reason FROM grade_changes gc JOIN grades g ON g.id = gc.grade_id
        WHERE g.assessment_id = $1 AND g.student_id = $2`,
      [column.assessmentId, enrolled.id],
    );
    expect(history.rows.map((r) => r.reason)).toEqual(["Imported from CSV"]);
    const audit = await q(
      "SELECT 1 FROM audit_logs WHERE action = 'assessment.grade.imported' AND metadata->>'assessmentId' = $1",
      [column.assessmentId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("refuses scores above the column's maximum and files without the right headers", async () => {
    const column = await manualColumn("Short test", "0", "10");
    const enrolled = await student("sEnrolled");
    const over = await importCsv(
      column.assessmentId,
      `matric_number,score\n${enrolled.matric},10.01\n`,
      true,
    );
    expect(over.json<{ rows: { message: string }[] }>().rows[0]?.message).toContain("10.00");
    const headers = await importCsv(column.assessmentId, "student,mark\nx,1\n", true);
    expect(headers.statusCode).toBe(400);
    // A column of another course is refused.
    const elsewhere = await q<{ id: string }>(
      `INSERT INTO assessments (course_offering_id, kind, title, max_score, weight, status)
       VALUES ($1, 'MANUAL', 'Elsewhere', 10, 0, 'PUBLISHED') RETURNING id`,
      [p.world.offerings.O2],
    );
    const wrong = await importCsv(elsewhere.rows[0]?.id ?? "", "matric_number,score\n", true);
    expect(wrong.statusCode).toBe(400);
  });
});
