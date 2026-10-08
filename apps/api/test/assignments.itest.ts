import type {
  Assignment,
  FileView,
  Grade,
  MySubmissions,
  Submission,
  SubmissionForGrading,
  UploadTarget,
} from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type PersonaName, type Personas } from "./personas";

/**
 * Assignments and submissions (TRD §14.2). O1 is taught by l1Primary (PRIMARY), l2Co and
 * l3Assistant (who may grade but not set work) and taken by sEnrolled; sCompleted finished it;
 * sOther takes O2. The clock starts at 2026-11-02T09:00Z.
 */

let t: TestApp;
let p: Personas;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

interface ErrorBody {
  error: { code: string };
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

async function createAssignment(body: Record<string, unknown>, as: PersonaName = "l1Primary") {
  return send(
    as,
    "POST",
    `/course-offerings/${p.world.offerings.O1}/assignments`,
    {
      title: "Essay 1",
      instructionsMd: "Write **500 words** on John 1.",
      dueAt: "2026-11-10T23:59:00Z",
      maxScore: "20",
      weight: "15",
      ...body,
    },
    key(),
  );
}

async function published(body: Record<string, unknown>): Promise<Assignment> {
  const res = await createAssignment(body);
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

const draft = (as: PersonaName, id: string, body: Record<string, unknown>) =>
  send(as, "PUT", `/assignments/${id}/my-submissions/draft`, body);
const submit = (as: PersonaName, id: string) =>
  send(as, "POST", `/assignments/${id}/my-submissions/submit`, undefined, key());
const mine = async (as: PersonaName, id: string) =>
  (await send(as, "GET", `/assignments/${id}/my-submissions`)).json<MySubmissions>();

async function at(iso: string) {
  t.clock.set(iso);
  for (const name of Object.keys(p).filter((k) => k !== "world") as PersonaName[])
    p[name].headers = await sessionFor(t, p[name].userId);
}

/** A small coursework file uploaded by a student. */
async function upload(as: PersonaName, name = "essay.pdf"): Promise<string> {
  const bytes = Buffer.from("%PDF-1.4 my essay");
  const res = await send(as, "POST", "/files/uploads", {
    name,
    mime: "application/pdf",
    sizeBytes: bytes.length,
    purpose: "SUBMISSION",
  });
  expect(res.statusCode, res.body).toBe(201);
  const started = res.json<{ file: FileView; upload: UploadTarget }>();
  if (started.upload.method !== "PUT") throw new Error("expected a PUT");
  await fetch(started.upload.url, { method: "PUT", headers: started.upload.headers, body: bytes });
  expect((await send(as, "POST", `/files/${started.file.id}/complete`)).statusCode).toBe(200);
  return started.file.id;
}

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

describe("setting an assignment", () => {
  it("creates a draft and its gradebook column together", async () => {
    const res = await createAssignment({ maxAttempts: 2, cutoffAt: "2026-11-12T23:59:00Z" });
    expect(res.statusCode, res.body).toBe(201);
    const a = res.json<Assignment>();
    expect(a).toMatchObject({
      status: "DRAFT",
      maxScore: "20.00",
      weight: "15.00",
      maxAttempts: 2,
      closesAt: "2026-11-12T23:59:00.000Z",
      latePolicy: { allowLate: false },
      submissionTypes: ["FILE", "TEXT"],
    });
    expect(a.instructionsHtml).toBe("<p>Write <strong>500 words</strong> on John 1.</p>");
    const column = await q<{ kind: string; status: string; due_at: Date }>(
      "SELECT kind, status, due_at FROM assessments WHERE id = $1",
      [a.assessmentId],
    );
    expect(column.rows[0]).toMatchObject({ kind: "ASSIGNMENT", status: "DRAFT" });
  });

  it("refuses a cutoff before the due date, and bad scores and weights", async () => {
    expect((await createAssignment({ cutoffAt: "2026-11-09T00:00:00Z" })).statusCode).toBe(400);
    expect((await createAssignment({ maxScore: "0" })).statusCode).toBe(400);
    expect((await createAssignment({ weight: "100.01" })).statusCode).toBe(400);
    expect((await createAssignment({ maxScore: "12.345" })).statusCode).toBe(400);
  });

  it("is for the course's Primary and Co-lecturers and the academic admins", async () => {
    for (const who of ["l3Assistant", "l4Other", "sEnrolled", "registrar"] as const)
      expect([403, 404], who).toContain((await createAssignment({}, who)).statusCode);
    expect((await createAssignment({}, "l2Co")).statusCode).toBe(201);
  });

  it("shows students published assignments only", async () => {
    const titles = async (as: PersonaName) =>
      (await send(as, "GET", `/course-offerings/${p.world.offerings.O1}/assignments`))
        .json<{ items: Assignment[] }>()
        .items.map((a) => a.status);
    expect(await titles("sEnrolled")).toEqual([]);
    const a = await published({ title: "Reading log" });
    expect(await titles("sEnrolled")).toEqual(["PUBLISHED"]);
    expect((await send("sEnrolled", "GET", `/assignments/${a.id}`)).statusCode).toBe(200);
    expect((await send("sOther", "GET", `/assignments/${a.id}`)).statusCode).toBe(404);
  });

  it("edits with If-Match, the gradebook column too", async () => {
    const a = await published({ title: "To edit" });
    const res = await send(
      "l2Co",
      "PATCH",
      `/assignments/${a.id}`,
      { title: "Edited", weight: "10.5", maxAttempts: 3 },
      { "if-match": `"${String(a.version)}"` },
    );
    expect(res.json<Assignment>()).toMatchObject({
      title: "Edited",
      weight: "10.50",
      maxAttempts: 3,
    });
    const stale = await send(
      "l2Co",
      "PATCH",
      `/assignments/${a.id}`,
      { title: "Again" },
      { "if-match": `"${String(a.version)}"` },
    );
    expect(stale.statusCode).toBe(412);
  });
});

describe("submitting", () => {
  let a: Assignment;

  beforeAll(async () => {
    a = await published({ title: "Essay 2", maxAttempts: 2 });
  });

  it("autosaves a text draft and attaches files, then submits on time", async () => {
    const first = await draft("sEnrolled", a.id, { textBody: "In the beginning" });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<Submission>()).toMatchObject({ attemptNo: 1, status: "DRAFT" });
    const fileId = await upload("sEnrolled");
    const second = await draft("sEnrolled", a.id, {
      textBody: "In the beginning was the Word",
      fileIds: [fileId],
    });
    expect(second.json<Submission>()).toMatchObject({
      id: first.json<Submission>().id,
      textBody: "In the beginning was the Word",
      files: [{ id: fileId, name: "essay.pdf" }],
    });

    const sent = await submit("sEnrolled", a.id);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json<Submission>()).toMatchObject({ status: "SUBMITTED", isLate: false });
    const state = await mine("sEnrolled", a.id);
    expect(state).toMatchObject({ attemptsLeft: 1, open: true });
    expect(state.attempts).toHaveLength(1);
  });

  it("allows resubmitting up to the attempt limit", async () => {
    await draft("sEnrolled", a.id, { textBody: "Second try" });
    expect((await submit("sEnrolled", a.id)).json<Submission>().attemptNo).toBe(2);
    const more = await draft("sEnrolled", a.id, { textBody: "Third" });
    expect(more.json<ErrorBody>().error.code).toBe("ATTEMPT_LIMIT_REACHED");
    expect(await mine("sEnrolled", a.id)).toMatchObject({ attemptsLeft: 0, open: false });
  });

  it("refuses an empty submission, files for a text-only assignment, and others' files", async () => {
    const textOnly = await published({ title: "Short answer", submissionTypes: ["TEXT"] });
    expect((await submit("sEnrolled", textOnly.id)).statusCode).toBe(400);
    const res = await draft("sEnrolled", textOnly.id, { fileIds: [await upload("sEnrolled")] });
    expect(res.statusCode).toBe(400);
    const open = await published({ title: "Anything" });
    const someoneElses = await upload("sCompleted");
    expect((await draft("sEnrolled", open.id, { fileIds: [someoneElses] })).statusCode).toBe(400);
  });

  it("is only for students enrolled now; a finished student may still read their work", async () => {
    expect((await draft("sCompleted", a.id, { textBody: "x" })).statusCode).toBe(404);
    expect((await draft("sOther", a.id, { textBody: "x" })).statusCode).toBe(404);
    expect(
      (await send("sCompleted", "GET", `/assignments/${a.id}/my-submissions`)).statusCode,
    ).toBe(200);
    expect(await mine("sOther", a.id)).toEqual({ attempts: [], attemptsLeft: 0, open: false });
    const lecturerUpload = await send("l1Primary", "POST", "/files/uploads", {
      name: "x.pdf",
      mime: "application/pdf",
      sizeBytes: 10,
      purpose: "SUBMISSION",
    });
    expect(lecturerUpload.statusCode).toBe(403);
  });
});

describe("late work and the cutoff", () => {
  it("flags late work on the server and closes at the cutoff (SUBMISSION_CLOSED)", async () => {
    const a = await published({
      title: "Late allowed",
      dueAt: "2026-11-05T12:00:00Z",
      cutoffAt: "2026-11-08T12:00:00Z",
      latePolicy: { allowLate: true, penaltyPercentPerDay: 10 },
    });
    await at("2026-11-06T12:00:01Z");
    await draft("sEnrolled", a.id, { textBody: "Sorry it's late" });
    const sent = await submit("sEnrolled", a.id);
    expect(sent.json<Submission>().isLate).toBe(true);

    const grading = await send("l3Assistant", "GET", `/assignments/${a.id}/submissions`);
    expect(grading.statusCode, grading.body).toBe(200);
    const row = grading
      .json<{ items: SubmissionForGrading[] }>()
      .items.find((i) => i.latest !== null);
    expect(row).toMatchObject({ daysLate: 2, suggestedPenaltyPercent: 20, submittedAttempts: 1 });

    await at("2026-11-08T12:00:01Z");
    const after = await draft("sEnrolled", a.id, { textBody: "x" });
    expect(after.json<ErrorBody>().error.code).toBe("SUBMISSION_CLOSED");
  });

  it("closes at the due date when late work isn't allowed", async () => {
    await at("2026-11-08T13:00:00Z");
    const a = await published({ title: "Strict", dueAt: "2026-11-09T12:00:00Z" });
    await draft("sEnrolled", a.id, { textBody: "Draft" });
    await at("2026-11-09T12:00:01Z");
    expect((await submit("sEnrolled", a.id)).json<ErrorBody>().error.code).toBe(
      "SUBMISSION_CLOSED",
    );
    expect((await mine("sEnrolled", a.id)).open).toBe(false);
  });
});

describe("grading", () => {
  let a: Assignment;
  let entry: SubmissionForGrading;

  beforeAll(async () => {
    await at("2026-11-09T13:00:00Z");
    a = await published({ title: "Graded essay", dueAt: "2026-11-20T12:00:00Z" });
    await draft("sEnrolled", a.id, { textBody: "My essay", fileIds: [await upload("sEnrolled")] });
    await submit("sEnrolled", a.id);
    const list = await send("l1Primary", "GET", `/assignments/${a.id}/submissions`);
    const found = list
      .json<{ items: SubmissionForGrading[] }>()
      .items.find((i) => i.latest !== null);
    if (found === undefined) throw new Error("no submission");
    entry = found;
  });

  it("lists everyone on the course, for graders only", async () => {
    const list = await send("l2Co", "GET", `/assignments/${a.id}/submissions`);
    const items = list.json<{ items: SubmissionForGrading[] }>().items;
    // sEnrolled and sCompleted are on O1 (sGraduated too, as COMPLETED).
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(entry).toMatchObject({ grade: null, daysLate: 0, submittedAttempts: 1 });
    for (const who of ["sEnrolled", "l4Other", "registrar"] as const)
      expect([403, 404], who).toContain(
        (await send(who, "GET", `/assignments/${a.id}/submissions`)).statusCode,
      );
  });

  it("downloads submitted files for the grader and the student, nobody else", async () => {
    const file = entry.latest?.files[0];
    if (file === undefined) throw new Error("no file");
    const url = file.downloadPath.replace("/api/v1", "");
    expect((await send("l3Assistant", "GET", url)).statusCode).toBe(302);
    expect((await send("sEnrolled", "GET", url)).statusCode).toBe(302);
    expect((await send("sOther", "GET", url)).statusCode).toBe(404);
    expect((await send("sCompleted", "GET", url)).statusCode).toBe(404);
  });

  it("records a score and feedback, exactly, with history and audit", async () => {
    const put = (body: Record<string, unknown>, version: number, as: PersonaName = "l3Assistant") =>
      send(as, "PUT", `/assessments/${a.assessmentId}/grades/${entry.studentId}`, body, {
        "if-match": `"${String(version)}"`,
      });
    const first = await put({ score: "18.5", feedbackMd: "Good **argument**." }, 0);
    expect(first.statusCode, first.body).toBe(200);
    const grade = first.json<Grade>();
    expect(grade).toMatchObject({
      score: "18.50",
      source: "SUBMISSION",
      status: "DRAFT",
      version: 1,
    });

    expect((await put({ score: "19" }, 0)).statusCode).toBe(412);
    expect((await put({ score: "20.01" }, 1)).statusCode).toBe(400);
    expect((await put({ score: "19.555" }, 1)).statusCode).toBe(400);
    const second = await put({ score: "17", reason: "Late section" }, 1, "l2Co");
    expect(second.json<Grade>()).toMatchObject({ score: "17.00", version: 2 });
    expect(second.json<Grade>().feedbackMd).toBe("Good **argument**.");

    const history = await q<{ old_score: string | null; new_score: string; reason: string | null }>(
      "SELECT old_score, new_score, reason FROM grade_changes WHERE grade_id = $1 ORDER BY created_at, id",
      [grade.id],
    );
    expect(history.rows).toEqual([
      { old_score: null, new_score: "18.50", reason: null },
      { old_score: "18.50", new_score: "17.00", reason: "Late section" },
    ]);
    const audit = await q<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE action = 'assessment.grade.updated' AND resource_id = $1 ORDER BY created_at, id",
      [grade.id],
    );
    expect(audit.rows).toHaveLength(2);
    expect(JSON.stringify(audit.rows)).not.toContain("argument");

    // Not the student's to write, and not for a student off the course.
    expect((await put({ score: "20" }, 2, "sEnrolled")).statusCode).toBe(404);
    const other = await q<{ id: string }>(
      "SELECT s.id FROM students s JOIN users u ON u.id = s.user_id WHERE u.id = $1",
      [p.sOther.userId],
    );
    const off = await send(
      "l1Primary",
      "PUT",
      `/assessments/${a.assessmentId}/grades/${other.rows[0]?.id ?? ""}`,
      { score: "1" },
      { "if-match": '"0"' },
    );
    expect(off.statusCode).toBe(404);
  });
});
