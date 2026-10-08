import type { ImportJob, Offering, Semester } from "@glim/contracts";
import { drainQueues } from "@glim/db/testing";
import { OBJECT_STORAGE, type ObjectStorage } from "@glim/integrations/storage/port";
import { UserAdminService } from "@glim/modules/identity";
import { ImportsService } from "@glim/modules/imports";
import { parseCsv, toCsv } from "@glim/shared";
import { CONFIG, type Config } from "@glim/shared/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admissionsWorld } from "./admissions-world";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Personas } from "./personas";

let t: TestApp;
let p: Personas;

const STUDENT_COLUMNS = [
  "email",
  "given_name",
  "middle_name",
  "family_name",
  "title",
  "gender",
  "date_of_birth",
  "phone_whatsapp",
  "matric_number",
  "programme_code",
  "study_mode",
  "level",
  "entry_session_code",
];

const studentRow = (n: number, overrides: Partial<Record<string, string>> = {}) => {
  const row: Record<string, string> = {
    email: `legacy${String(n)}@gmail.com`,
    given_name: `Student${String(n)}`,
    middle_name: "",
    family_name: "Legacy",
    title: "Mr",
    gender: "male",
    date_of_birth: "1990-01-01",
    phone_whatsapp: "+2348030000000",
    matric_number: `GLIM/DIP/2025/${String(n).padStart(4, "0")}`,
    programme_code: "DIP",
    study_mode: "Online",
    level: "2",
    entry_session_code: "2025/2026",
    ...overrides,
  };
  return STUDENT_COLUMNS.map((c) => row[c] ?? "");
};

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await admissionsWorld(t, p);
  const acad = p.acadAdmin.headers;
  await t.request({
    method: "POST",
    url: "/api/v1/academic-sessions",
    headers: acad,
    payload: {
      code: "2025/2026",
      name: "2025/2026 Session",
      startsOn: "2025-09-01",
      endsOn: "2026-06-30",
    },
  });
});

afterAll(async () => {
  await t.close();
});

const acad = () => p.acadAdmin.headers;

/** Uploads CSV text as the Academic Admin, the way the browser does. */
async function upload(text: string, name = "import.csv"): Promise<string> {
  const bytes = Buffer.from(text);
  const started = await t.request({
    method: "POST",
    url: "/api/v1/files/uploads",
    headers: acad(),
    payload: { name, mime: "text/csv", sizeBytes: bytes.length, purpose: "IMPORT" },
  });
  const { file, upload: target } = started.json<{
    file: { id: string };
    upload: { url: string; headers: Record<string, string> };
  }>();
  const put = await fetch(target.url, { method: "PUT", headers: target.headers, body: bytes });
  expect(put.status).toBe(200);
  await t.request({ method: "POST", url: `/api/v1/files/${file.id}/complete`, headers: acad() });
  return file.id;
}

/** Starts an import and runs the job, as the worker would. */
async function runImport(kind: string, fileId: string, dryRun: boolean) {
  const started = await t.request({
    method: "POST",
    url: "/api/v1/imports",
    headers: { ...acad(), "idempotency-key": idempotencyKey() },
    payload: { kind, fileId, dryRun },
  });
  if (started.statusCode !== 202) return { started, job: null };
  await t.app.get(ImportsService).run(started.json<ImportJob>().id);
  const job = await t.request({
    url: `/api/v1/imports/${started.json<ImportJob>().id}`,
    headers: acad(),
  });
  return { started, job: job.json<ImportJob>() };
}

const count = async (sql: string, values: unknown[] = []) =>
  Number((await t.db.pool.query<{ n: string }>(sql, values)).rows[0]?.n ?? 0);

describe("templates", () => {
  it("download as CSV with each kind's columns and an example row", async () => {
    const res = await t.request({ url: "/api/v1/imports/templates/STUDENTS", headers: acad() });
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    const [header, example] = parseCsv(res.body);
    expect(header).toEqual(STUDENT_COLUMNS);
    expect(example).toHaveLength(STUDENT_COLUMNS.length);
  });
});

describe("importing students", () => {
  let fileId: string;

  beforeAll(async () => {
    fileId = await upload(
      toCsv(STUDENT_COLUMNS, [
        studentRow(1),
        studentRow(2, { study_mode: "on campus", level: "1" }),
        studentRow(3),
        studentRow(4, { email: "not-an-email" }),
        studentRow(5, { programme_code: "NOPE" }),
      ]),
      "students.csv",
    );
  });

  it("checks every row in a dry run, reports the bad ones in an error CSV, and writes nothing", async () => {
    const { job } = await runImport("STUDENTS", fileId, true);
    expect(job).toMatchObject({
      status: "COMPLETED",
      dryRun: true,
      fileName: "students.csv",
      stats: {
        total: 5,
        valid: 3,
        invalid: 2,
        created: 3,
        updated: 0,
        unchanged: 0,
        failure: null,
      },
    });
    expect(await count("SELECT count(*) AS n FROM users WHERE email LIKE 'legacy%'")).toBe(0);

    const errors = await t.request({ url: job?.errorFile?.downloadPath ?? "", headers: acad() });
    const csv = await fetch(String(errors.headers.location));
    const rows = parseCsv(await csv.text());
    expect(rows[0]?.slice(0, 3)).toEqual(["row", "errors", "email"]);
    expect(rows.slice(1).map((r) => [r[0], r[1]])).toEqual([
      ["5", expect.stringContaining("email")],
      ["6", "No programme with code NOPE"],
    ]);
  });

  it("commits only a file whose dry run passed unchanged", async () => {
    const other = await upload(toCsv(STUDENT_COLUMNS, [studentRow(9)]));
    expect((await runImport("STUDENTS", other, false)).started.statusCode).toBe(400);

    const { job } = await runImport("STUDENTS", fileId, false);
    expect(job?.stats).toMatchObject({ valid: 3, invalid: 2, created: 3 });
    const { rows } = await t.db.pool.query<{
      status: string;
      referral_code: string;
      matric: string;
      level: number;
      mode: string;
    }>(
      `SELECT u.status, u.referral_code, pe.matric_number AS matric, pe.current_level AS level, pe.study_mode AS mode
         FROM users u JOIN students s ON s.user_id = u.id JOIN programme_enrollments pe ON pe.student_id = s.id
        WHERE u.email LIKE 'legacy%' ORDER BY pe.matric_number`,
    );
    expect(rows.map((r) => [r.status, r.matric, r.level, r.mode])).toEqual([
      ["INVITED", "GLIM/DIP/2025/0001", 2, "ONLINE"],
      ["INVITED", "GLIM/DIP/2025/0002", 1, "ON_CAMPUS"],
      ["INVITED", "GLIM/DIP/2025/0003", 2, "ONLINE"],
    ]);
    for (const r of rows) expect(r.referral_code).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
  });

  it("invites the imported people, spread out over time", async () => {
    const { rows } = await t.db.pool.query<{ start_after: Date; created_on: Date }>(
      "SELECT start_after, created_on FROM pgboss.job WHERE name = 'identity.invite'",
    );
    expect(rows).toHaveLength(3);
    const userAdmin = t.app.get(UserAdminService);
    await drainQueues(t.boss, {
      "identity.invite": (job) =>
        userAdmin.resendInvite((job.data as { userId: string }).userId, {
          userId: null,
          type: "JOB",
        }),
    });
    expect(t.mailer.lastTo("legacy1@gmail.com")?.text).toMatch(/\/invite\//);
  });

  it("is idempotent: importing the same file again changes nothing", async () => {
    await runImport("STUDENTS", fileId, true);
    const { job } = await runImport("STUDENTS", fileId, false);
    expect(job?.stats).toMatchObject({ created: 0, updated: 0, unchanged: 3, invalid: 2 });
  });

  it("refuses to commit a file that changed after its dry run", async () => {
    const changed = await upload(toCsv(STUDENT_COLUMNS, [studentRow(20)]));
    await runImport("STUDENTS", changed, true);
    const { rows } = await t.db.pool.query<{ storage_key: string }>(
      "SELECT storage_key FROM files WHERE id = $1",
      [changed],
    );
    await t.app.get<ObjectStorage>(OBJECT_STORAGE).upload({
      bucket: t.app.get<Config>(CONFIG).storage.bucket,
      key: rows[0]?.storage_key ?? "",
      body: Buffer.from(toCsv(STUDENT_COLUMNS, [studentRow(21)])),
      contentType: "text/csv",
    });
    const { started } = await runImport("STUDENTS", changed, false);
    expect(started.statusCode).toBe(409);
    expect(started.json()).toMatchObject({ error: { code: "IMPORT_FILE_CHANGED" } });
  });
});

describe("importing Lecturers and course enrollments", () => {
  it("upserts Lecturers by staff code, inviting new people", async () => {
    const columns = ["email", "title", "given_name", "family_name", "kind", "staff_code"];
    const first = await upload(
      toCsv(columns, [
        ["tunde@glim.edu.ng", "Rev", "Tunde", "Bello", "INTERNAL", "GL-014"],
        ["guest@gmail.com", "", "Grace", "Guest", "guest", ""],
      ]),
    );
    await runImport("LECTURERS", first, true);
    expect((await runImport("LECTURERS", first, false)).job?.stats).toMatchObject({ created: 2 });
    const renamed = await upload(
      toCsv(columns, [["tunde.new@glim.edu.ng", "Dr", "Tunde", "Bello", "INTERNAL", "GL-014"]]),
    );
    await runImport("LECTURERS", renamed, true);
    expect((await runImport("LECTURERS", renamed, false)).job?.stats).toMatchObject({ updated: 1 });
    expect(
      await count(
        "SELECT count(*) AS n FROM lecturers WHERE staff_code = 'GL-014' AND title = 'Dr'",
      ),
    ).toBe(1);
  });

  it("registers imported students on past offerings, by Matric Number and course", async () => {
    const semester = (
      await t.request({
        method: "POST",
        url: "/api/v1/semesters",
        headers: acad(),
        payload: {
          academicSessionId: (
            await t.db.pool.query<{ id: string }>(
              "SELECT id FROM academic_sessions WHERE code = '2025/2026'",
            )
          ).rows[0]?.id,
          code: "S1",
          name: "First Semester",
          sequence: 1,
          startsOn: "2025-09-08",
          endsOn: "2026-01-30",
        },
      })
    ).json<Semester>();
    const course = (
      await t.db.pool.query<{ id: string }>("SELECT id FROM courses WHERE code = 'BIB101'")
    ).rows[0]?.id;
    await t
      .request({
        method: "POST",
        url: "/api/v1/course-offerings",
        headers: acad(),
        payload: { courseId: course, semesterId: semester.id },
      })
      .then((r) => r.json<Offering>());
    const columns = [
      "matric_number",
      "course_code",
      "session_code",
      "semester_code",
      "section_code",
      "status",
    ];
    const file = await upload(
      toCsv(columns, [
        ["glim/dip/2025/0001", "BIB101", "2025/2026", "S1", "", "COMPLETED"],
        ["GLIM/DIP/2025/0002", "BIB101", "2025/2026", "s1", "01", ""],
        ["GLIM/DIP/2025/0002", "NOPE101", "2025/2026", "S1", "", ""],
      ]),
    );
    expect((await runImport("COURSE_ENROLLMENTS", file, true)).job?.stats).toMatchObject({
      valid: 2,
      invalid: 1,
    });
    expect((await runImport("COURSE_ENROLLMENTS", file, false)).job?.stats).toMatchObject({
      created: 2,
    });
    expect(
      await count(
        "SELECT count(*) AS n FROM course_enrollments WHERE course_offering_id IN (SELECT id FROM course_offerings WHERE semester_id = $1)",
        [semester.id],
      ),
    ).toBe(2);
  });
});

describe("a large import", () => {
  it("handles 5,000 rows in under a minute each way, resuming from its last batch", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => studentRow(1000 + i));
    const file = await upload(toCsv(STUDENT_COLUMNS, rows), "big.csv");
    const started = Date.now();
    const dry = await runImport("STUDENTS", file, true);
    expect(dry.job?.stats).toMatchObject({ valid: 5000, invalid: 0 });
    expect(Date.now() - started).toBeLessThan(60_000);

    // A commit that already did its first two batches resumes from row 401.
    const commit = await t.request({
      method: "POST",
      url: "/api/v1/imports",
      headers: { ...acad(), "idempotency-key": idempotencyKey() },
      payload: { kind: "STUDENTS", fileId: file, dryRun: false },
    });
    const id = commit.json<ImportJob>().id;
    await t.db.pool.query("UPDATE import_jobs SET rows_done = 400 WHERE id = $1", [id]);
    const committing = Date.now();
    const stats = await t.app.get(ImportsService).run(id);
    expect(Date.now() - committing).toBeLessThan(60_000);
    expect(stats).toMatchObject({ total: 5000, created: 4600 });
    expect(
      await count(
        "SELECT count(*) AS n FROM programme_enrollments WHERE matric_number LIKE 'GLIM/DIP/2025/%'",
      ),
    ).toBe(3 + 4600);
  }, 180_000);
});
