import type {
  CourseResults,
  GradebookColumn,
  ImportJob,
  MyResults,
  SemesterResultRow,
} from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { ImportsService } from "@glim/modules/imports";
import { SemesterResultsService } from "@glim/modules/results";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * Semester results, the broadsheet and legacy results (TRD §14.5, §15.2, D-04). O1 (PBIB101,
 * 3 credits) is finalized for sEnrolled (80 ⇒ A), sCompleted (50 ⇒ C) and sGraduated (missing ⇒ F)
 * in the persona semester (2080/2081). An earlier semester (2079/2080) takes imported results.
 */

let t: TestApp;
let p: Personas;
let oldSemesterId = "";
let certEnrollmentId = "";
let enrolledMatric = "";

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
const semester = () => p.world.semesterId;
const list = async (semesterId = semester()) =>
  (await send("registrar", "GET", `/results/semesters?semesterId=${semesterId}`)).json<{
    items: SemesterResultRow[];
  }>().items;
/** The whole list response, with the per-programme course counts. */
const listing = async (semesterId = semester()) =>
  (await send("registrar", "GET", `/results/semesters?semesterId=${semesterId}`)).json<{
    items: SemesterResultRow[];
    courses: {
      programmeId: string;
      programmeCode: string;
      offerings: number;
      offeringsFinalized: number;
    }[];
  }>();
const rowOf = (items: SemesterResultRow[], matric: string) =>
  items.find((i) => i.matricNumber === matric);

async function studentId(as: PersonaName): Promise<string> {
  const { rows } = await q<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [
    p[as].userId,
  ]);
  return rows[0]?.id ?? "";
}

async function matricOf(as: PersonaName): Promise<string> {
  const { rows } = await q<{ m: string }>(
    `SELECT pe.matric_number AS m FROM programme_enrollments pe JOIN students s ON s.id = pe.student_id
      JOIN programmes pr ON pr.id = pe.programme_id WHERE s.user_id = $1 AND pr.code = 'PDIP'`,
    [p[as].userId],
  );
  return rows[0]?.m ?? "";
}

/** Uploads CSV text and runs a dry run, then the commit, as the Academic Admin. */
async function importCsv(kind: string, text: string): Promise<ImportJob | null> {
  const bytes = Buffer.from(text);
  const started = await send("acadAdmin", "POST", "/files/uploads", {
    name: "results.csv",
    mime: "text/csv",
    sizeBytes: bytes.length,
    purpose: "IMPORT",
  });
  const { file, upload } = started.json<{
    file: { id: string };
    upload: { url: string; headers: Record<string, string> };
  }>();
  await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes });
  await send("acadAdmin", "POST", `/files/${file.id}/complete`);
  let job: ImportJob | null = null;
  for (const dryRun of [true, false]) {
    const res = await send(
      "acadAdmin",
      "POST",
      "/imports",
      { kind, fileId: file.id, dryRun },
      key(),
    );
    expect(res.statusCode, res.body).toBe(202);
    await t.app.get(ImportsService).run(res.json<ImportJob>().id);
    job = (
      await send("acadAdmin", "GET", `/imports/${res.json<ImportJob>().id}`)
    ).json<ImportJob>();
  }
  return job;
}

const drainCompute = () =>
  drainQueues(t.boss, {
    "results.compute-semester": async (job) => {
      await t.app
        .get(SemesterResultsService)
        .compute((job.data as { semesterId: string }).semesterId);
    },
  });

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q(
    "UPDATE programmes SET grading_scheme_id = (SELECT id FROM grading_schemes WHERE name = 'GLIM Diploma') WHERE code = 'PDIP'",
  );
  // An earlier session and semester, and a course, for past results.
  const session = await q<{ id: string }>(
    `INSERT INTO academic_sessions (code, name, starts_on, ends_on, status)
     VALUES ('2079/2080', '2079/2080 Session', '2079-09-01', '2080-06-30', 'CLOSED') RETURNING id`,
  );
  const old = await q<{ id: string }>(
    `INSERT INTO semesters (academic_session_id, code, name, sequence, starts_on, ends_on, status)
     VALUES ($1, 'S1', 'First Semester', 1, '2079-09-01', '2080-01-31', 'CLOSED') RETURNING id`,
    [session.rows[0]?.id],
  );
  oldSemesterId = old.rows[0]?.id ?? "";
  await q(
    "INSERT INTO courses (code, title, credits) VALUES ('OLD101', 'Old Testament Survey', 2)",
  );
  // sEnrolled also once took the Certificate: a separate programme enrollment.
  const cert = await q<{ id: string }>(
    `INSERT INTO programmes (code, name, award_type, duration_semesters, levels, grading_scheme_id)
     VALUES ('PCERT', 'Persona Certificate', 'CERTIFICATE', 2, 1,
       (SELECT id FROM grading_schemes WHERE name = 'GLIM Certificate')) RETURNING id`,
  );
  const certEnrollment = await q<{ id: string }>(
    `INSERT INTO programme_enrollments (student_id, programme_id, curriculum_id, entry_session_id, matric_number, study_mode, started_on, status)
     VALUES ($1, $2, $3, $4, 'GLIM/PCERT/2079/0001', 'ONLINE', '2079-09-01', 'COMPLETED') RETURNING id`,
    [await studentId("sEnrolled"), cert.rows[0]?.id, p.world.curriculumId, session.rows[0]?.id],
  );
  certEnrollmentId = certEnrollment.rows[0]?.id ?? "";
  enrolledMatric = await matricOf("sEnrolled");

  // O1's gradebook: one column worth 100.
  const col = (
    await send(
      "l1Primary",
      "POST",
      `/course-offerings/${p.world.offerings.O1}/assessments`,
      { title: "Everything", maxScore: "100", weight: "100" },
      key(),
    )
  ).json<GradebookColumn>();
  for (const [who, score] of [
    ["sEnrolled", "80"],
    ["sCompleted", "50"],
  ] as const) {
    const res = await send(
      "l1Primary",
      "PUT",
      `/assessments/${col.assessmentId}/grades/${await studentId(who)}`,
      { score },
      { "if-match": '"0"' },
    );
    expect(res.statusCode, res.body).toBe(200);
  }
  const fin = await send(
    "l1Primary",
    "POST",
    `/course-offerings/${p.world.offerings.O1}/results/finalize`,
    undefined,
    key(),
  );
  expect(fin.statusCode, fin.body).toBe(200);
  expect(fin.json<CourseResults>().finalized).toBe(3);
});

afterAll(async () => {
  await t.close();
});

describe("computing", () => {
  it("computes each student's semester from finalized results, and is idempotent", async () => {
    expect(
      (
        await send(
          "acadAdmin",
          "POST",
          "/results/semesters/compute",
          { semesterId: semester() },
          key(),
        )
      ).json(),
    ).toEqual({ computed: 3, changed: 3 });
    const items = await list();
    expect(rowOf(items, enrolledMatric)).toMatchObject({
      creditsAttemptedX10: 30,
      creditsEarnedX10: 30,
      gpaX100: 500,
      cgpaX100: 500,
      standing: "GOOD",
      status: "DRAFT",
      calcVersion: 1,
      levelNo: 1,
      draftCourseCodes: [],
    });
    expect((await listing()).courses).toEqual([
      {
        programmeId: p.world.programmeId,
        programmeCode: "PDIP",
        offerings: 2,
        offeringsFinalized: 1,
      },
    ]);
    const completed = rowOf(items, await matricOf("sCompleted"));
    expect(completed).toMatchObject({ gpaX100: 300, standing: "GOOD" });
    const graduated = rowOf(items, await matricOf("sGraduated"));
    expect(graduated).toMatchObject({
      gpaX100: 0,
      creditsEarnedX10: 0,
      standing: "WITHDRAW_REQUIRED",
    });

    const again = await send(
      "registrar",
      "POST",
      "/results/semesters/compute",
      { semesterId: semester() },
      key(),
    );
    expect(again.json()).toEqual({ computed: 3, changed: 0 });
    expect(rowOf(await list(), enrolledMatric)?.calcVersion).toBe(1);
  });

  it("is computed when the semester closes", async () => {
    const before = await q("SELECT 1 FROM pgboss.job WHERE name = 'results.compute-semester'");
    // The semester-closed subscriber queues it (§14.5).
    const { createSubscribers } = await import("../../worker/src/subscribers");
    const registry = createSubscribers(t.app);
    for (const subscriber of registry["academic.semester.closed"] ?? [])
      await subscriber({
        id: "00000000-0000-7000-8000-000000000001",
        name: "academic.semester.closed",
        payload: { semesterId: semester() },
        occurredAt: new Date().toISOString(),
        actorUserId: null,
      } as never);
    const after = await q("SELECT 1 FROM pgboss.job WHERE name = 'results.compute-semester'");
    expect(after.rowCount).toBe((before.rowCount ?? 0) + 1);
    await drainCompute();
  });
});

describe("legacy results", () => {
  it("imports past results as APPROVED, counting toward CGPA, and recomputes", async () => {
    const csv = [
      "matric_number,course_code,session_code,semester_code,percent,credits,result_kind",
      `${enrolledMatric},OLD101,2079/2080,S1,60,,`,
      "GLIM/PCERT/2079/0001,OLD101,2079/2080,S1,30,,",
      `${enrolledMatric},NOPE999,2079/2080,S1,60,,`,
      `${enrolledMatric},OLD101,2079/2080,S1,,,`,
    ].join("\n");
    const job = await importCsv("COURSE_RESULTS", csv);
    expect(job?.stats).toMatchObject({ created: 2, invalid: 2 });
    const imported = await q<{
      source: string;
      status: string;
      letter: string;
      credits_x10: number;
    }>(
      `SELECT r.source, r.status, r.letter, r.credits_x10 FROM course_results r
         JOIN programme_enrollments pe ON pe.id = r.programme_enrollment_id
        WHERE pe.matric_number = $1 AND r.semester_id = $2`,
      [enrolledMatric, oldSemesterId],
    );
    expect(imported.rows).toEqual([
      { source: "IMPORT", status: "APPROVED", letter: "B", credits_x10: 20 },
    ]);

    // The import queued a recompute of the old semester, which carries on to the later one.
    await drainCompute();
    const old = rowOf(await list(oldSemesterId), enrolledMatric);
    expect(old).toMatchObject({ gpaX100: 400, cgpaX100: 400 });
    // (2 × 4.00 + 3 × 5.00) ÷ 5 = 4.60, now including the imported result.
    const now = rowOf(await list(), enrolledMatric);
    expect(now).toMatchObject({
      gpaX100: 500,
      cgpaX100: 460,
      cumCreditsAttemptedX10: 50,
      calcVersion: 2,
    });
  });

  it("keeps the Certificate's results out of the Diploma's CGPA", async () => {
    const cert = (await list(oldSemesterId)).find(
      (x) => x.programmeEnrollmentId === certEnrollmentId,
    );
    expect(cert).toMatchObject({ programmeCode: "PCERT", gpaX100: 0, cgpaX100: 0 });
    // The Diploma's CGPA stays 4.60: the Certificate's F doesn't count there.
    expect(rowOf(await list(), enrolledMatric)?.cgpaX100).toBe(460);
    const mine = (await send("sEnrolled", "GET", "/me/results")).json<MyResults>();
    const diploma = mine.programmes.find((x) => x.matricNumber === enrolledMatric);
    expect(diploma?.semesters.map((s) => s.cgpaX100)).toEqual([400, 460]);
  });

  it("importing the same file again changes nothing", async () => {
    const csv = `matric_number,course_code,session_code,semester_code,percent\n${enrolledMatric},OLD101,2079/2080,S1,60\n`;
    const jobsBefore = await q("SELECT 1 FROM pgboss.job WHERE name = 'results.compute-semester'");
    const job = await importCsv("COURSE_RESULTS", csv);
    expect(job?.stats).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    const jobsAfter = await q("SELECT 1 FROM pgboss.job WHERE name = 'results.compute-semester'");
    expect(jobsAfter.rowCount).toBe(jobsBefore.rowCount);
  });
});

describe("approving and publishing", () => {
  it("approves in bulk (Registrar only), then publishes and drops the Provisional label", async () => {
    expect(
      (
        await send(
          "acadAdmin",
          "POST",
          "/results/semesters/approve",
          { semesterId: semester() },
          key(),
        )
      ).statusCode,
    ).toBe(403);
    // By programme: only the Diploma's students in this semester.
    const approved = await send(
      "registrar",
      "POST",
      "/results/semesters/approve",
      { semesterId: semester(), programmeId: p.world.programmeId },
      key(),
    );
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toEqual({ approved: 3, skipped: 0 });
    const courseStatus = await q<{ status: string }>(
      "SELECT DISTINCT status FROM course_results WHERE semester_id = $1",
      [semester()],
    );
    expect(courseStatus.rows.map((r) => r.status)).toEqual(["APPROVED"]);
    expect(
      (await send("sEnrolled", "GET", "/me/results"))
        .json<MyResults>()
        .programmes.find((x) => x.matricNumber === enrolledMatric)?.semesters[1]?.provisional,
    ).toBe(true);

    const published = await send(
      "registrar",
      "POST",
      "/results/semesters/publish",
      { semesterId: semester() },
      key(),
    );
    expect(published.json()).toEqual({ published: 3 });
    expect(rowOf(await list(), enrolledMatric)?.status).toBe("PUBLISHED");
    const mine = (await send("sEnrolled", "GET", "/me/results")).json<MyResults>();
    expect(
      mine.programmes.find((x) => x.matricNumber === enrolledMatric)?.semesters[1]?.provisional,
    ).toBe(false);
    const notices = await q(
      "SELECT 1 FROM notifications WHERE kind = 'results.semester-published' AND user_id = $1",
      [p.sEnrolled.userId],
    );
    expect(notices.rowCount).toBe(1);
    const audit = await q<{ action: string }>(
      "SELECT action FROM audit_logs WHERE resource_id = $1 AND action LIKE 'results.semester.%' ORDER BY created_at",
      [semester()],
    );
    expect(audit.rows.map((a) => a.action)).toEqual([
      "results.semester.approved",
      "results.semester.published",
    ]);
  });

  it("reopening a course result moves the semester back to DRAFT; approving waits for it", async () => {
    const { rows } = await q<{ id: string }>(
      "SELECT id FROM course_results WHERE student_id = $1 AND semester_id = $2",
      [await studentId("sCompleted"), semester()],
    );
    const reopened = await send(
      "registrar",
      "POST",
      `/course-results/${rows[0]?.id ?? ""}/reopen`,
      {
        reason: "Re-marked",
      },
    );
    expect(reopened.statusCode, reopened.body).toBe(200);
    const completed = rowOf(await list(), await matricOf("sCompleted"));
    expect(completed).toMatchObject({
      status: "DRAFT",
      draftCourseResults: 1,
      draftCourseCodes: ["PBIB101"],
    });
    // O1 has a reopened result again, so it no longer counts as finalized.
    expect((await listing()).courses[0]).toMatchObject({ offerings: 2, offeringsFinalized: 0 });
    const approved = await send(
      "registrar",
      "POST",
      "/results/semesters/approve",
      { semesterId: semester() },
      key(),
    );
    expect(approved.json()).toEqual({ approved: 0, skipped: 1 });
  });
});

describe("the broadsheet", () => {
  it("exports credits, GPA, CGPA and standing as CSV", async () => {
    const res = await send(
      "registrar",
      "GET",
      `/reports/results?semesterId=${semester()}&format=csv`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.body
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/);
    expect(lines[0]).toBe(
      "matric_number,student,programme,credits_attempted,credits_earned,gpa,cum_credits_attempted,cum_credits_earned,cgpa,standing,status",
    );
    expect(lines).toContainEqual(
      `${enrolledMatric},sEnrolled Persona,PDIP,3.0,3.0,5.00,5.0,5.0,4.60,GOOD,PUBLISHED`,
    );
    expect(
      (await send("l1Primary", "GET", `/reports/results?semesterId=${semester()}`)).statusCode,
    ).toBe(403);
  });
});
