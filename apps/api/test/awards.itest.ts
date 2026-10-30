import type { Award, AwardCandidate, GradebookColumn, MyResults, Video } from "@glim/contracts";
import { recordImportedResult } from "@glim/modules/results";
import { FAKE_CHANNEL_URL } from "@glim/integrations/video-host/fake";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * Awards and graduation (TRD §14.6, ADR-0005). The curriculum is PBIB101 then PBIB102, 3 credits
 * each: the Certificate needs 3 credits passed, the Diploma both courses. O1 (PBIB101) is
 * finalized: sEnrolled 80 ⇒ A (CGPA 5.00), sCompleted 20 ⇒ F (0.00), sGraduated 90 ⇒ A.
 */

let t: TestApp;
let p: Personas;
let video: Video;

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

interface ErrorBody {
  error: { code: string; message: string };
}

const send = (
  as: PersonaName,
  method: "GET" | "POST" | "PUT",
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

async function enrollmentOf(as: PersonaName): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `SELECT pe.id FROM programme_enrollments pe JOIN students s ON s.id = pe.student_id
      JOIN programmes pr ON pr.id = pe.programme_id WHERE s.user_id = $1 AND pr.code = 'PDIP'`,
    [p[as].userId],
  );
  return rows[0]?.id ?? "";
}

const propose = async (as: PersonaName, awardType: "CERTIFICATE" | "DIPLOMA") =>
  send("registrar", "POST", `/programme-enrollments/${await enrollmentOf(as)}/award/propose`, {
    awardType,
  });
const confirm = (awardId: string, as: PersonaName = "registrar") =>
  send(as, "POST", `/awards/${awardId}/confirm`, undefined, key());

/** A past PBIB102 result for the persona, approved as imports are (D-04). */
async function passSecondCourse(as: PersonaName): Promise<void> {
  const course = await q<{ id: string }>("SELECT id FROM courses WHERE code = 'PBIB102'");
  const recorded = await t.db.withTx(({ db }) =>
    enrollmentOf(as).then((programmeEnrollmentId) =>
      recordImportedResult(
        db,
        {
          programmeEnrollmentId,
          completedOn: "2026-10-30",
          courseId: course.rows[0]?.id ?? "",
          creditsX10: null,
          finalPctX100: 7500,
          resultKind: "GRADED",
        },
        new Date("2026-11-01T00:00:00Z"),
      ),
    ),
  );
  expect(recorded.ok).toBe(true);
}

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  await q("UPDATE course_offerings SET status = 'PUBLISHED' WHERE id = ANY($1)", [
    Object.values(p.world.offerings),
  ]);
  await q(
    "UPDATE programmes SET grading_scheme_id = (SELECT id FROM grading_schemes WHERE name = 'GLIM Diploma') WHERE code = 'PDIP'",
  );
  await q("UPDATE settings SET youtube_channel_urls = $1", [[FAKE_CHANNEL_URL]]);
  await q("INSERT INTO courses (code, title, credits) VALUES ('PBIB102', 'Second Course', 3)");
  await q(
    `INSERT INTO curriculum_courses (curriculum_id, course_id, position)
     SELECT $1, id, CASE code WHEN 'PBIB101' THEN 1 ELSE 2 END FROM courses
      WHERE code IN ('PBIB101', 'PBIB102')`,
    [p.world.curriculumId],
  );

  const added = await send(
    "l1Primary",
    "POST",
    `/course-offerings/${p.world.offerings.O1}/videos`,
    { youtubeUrl: "https://youtu.be/award000001" },
    key(),
  );
  expect(added.statusCode, added.body).toBe(201);
  video = added.json<Video>();

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
    ["sCompleted", "20"],
    ["sGraduated", "90"],
  ] as const) {
    const { rows } = await q<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [
      p[who].userId,
    ]);
    const res = await send(
      "l1Primary",
      "PUT",
      `/assessments/${col.assessmentId}/grades/${rows[0]?.id ?? ""}`,
      { score },
      { "if-match": '"0"' },
    );
    expect(res.statusCode, res.body).toBe(200);
  }
  const finalized = await send(
    "l1Primary",
    "POST",
    `/course-offerings/${p.world.offerings.O1}/results/finalize`,
    undefined,
    key(),
  );
  expect(finalized.statusCode, finalized.body).toBe(200);
});

afterAll(async () => {
  await t.close();
});

describe("candidates", () => {
  it("lists ACTIVE students with their CGPA, credits passed and which awards they've earned", async () => {
    const res = await send("registrar", "GET", "/awards/candidates");
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: AwardCandidate[] }>().items;
    expect(items.find((c) => c.studentName === "sEnrolled Persona")).toMatchObject({
      cgpaX100: 500,
      creditsEarnedX10: 30,
      totalCreditsX10: 60,
      certificateEligible: true,
      diplomaEligible: false,
      awards: [],
    });
    expect(items.find((c) => c.studentName === "sCompleted Persona")).toMatchObject({
      creditsEarnedX10: 0,
      certificateEligible: false,
    });
    // sGraduated's programme enrollment is COMPLETED already.
    expect(items.some((c) => c.studentName === "sGraduated Persona")).toBe(false);
    expect((await send("acadAdmin", "GET", "/awards/candidates")).statusCode).toBe(403);
  });
});

describe("proposing", () => {
  it("works out the Certificate with a checklist: it waits for the Registrar's approval", async () => {
    const res = await propose("sEnrolled", "CERTIFICATE");
    expect(res.statusCode, res.body).toBe(200);
    const award = res.json<Award>();
    expect(award).toMatchObject({
      awardType: "CERTIFICATE",
      status: "DRAFT",
      cgpaX100: 500,
      awardClass: "Distinction",
      certificateNo: null,
    });
    expect(award.requirements.map((r) => [r.key, r.met])).toEqual([
      ["HALF_CREDITS", true],
      ["APPROVED", false],
      ["SCHEME", true],
    ]);
    expect(award.requirements[0]?.detail).toBe("3 of 6 credits passed");
    const refused = await confirm(award.id);
    expect(refused.statusCode).toBe(422);
    expect(refused.json<ErrorBody>().error.code).toBe("REQUIREMENTS_NOT_MET");
  });

  it("needs every curriculum course passed for the Diploma", async () => {
    const award = (await propose("sEnrolled", "DIPLOMA")).json<Award>();
    expect(award.requirements.find((r) => r.key === "ALL_COURSES")).toMatchObject({
      met: false,
      detail: "Not yet passed: PBIB102",
    });
  });

  it("refuses an award below a CGPA of 1.00 with NO_AWARD", async () => {
    const award = (await propose("sCompleted", "CERTIFICATE")).json<Award>();
    expect(award).toMatchObject({ cgpaX100: 0, awardClass: null });
    expect(award.requirements.find((r) => r.key === "HALF_CREDITS")).toMatchObject({
      met: false,
      detail: "0 of 6 credits passed",
    });
    expect((await confirm(award.id)).json<ErrorBody>().error.code).toBe("NO_AWARD");
  });
});

describe("approving results", () => {
  it("is the Registrar's, by offering or by cohort; Lecturers and Academic Admins can't", async () => {
    const scope = { offeringId: p.world.offerings.O1 };
    expect((await send("l1Primary", "POST", "/results/approve", scope, key())).statusCode).toBe(
      403,
    );
    expect((await send("acadAdmin", "POST", "/results/approve", scope, key())).statusCode).toBe(
      403,
    );
    const res = await send("registrar", "POST", "/results/approve", scope, key());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ approved: 3, skipped: 0 });
    // Again, for the whole cohort: nothing left to approve.
    const again = await send(
      "registrar",
      "POST",
      "/results/approve",
      { cohortId: p.world.cohortId },
      key(),
    );
    expect(again.json()).toEqual({ approved: 0, skipped: 0 });
    const mine = (await send("sEnrolled", "GET", "/me/results")).json<MyResults>();
    expect(mine.programmes[0]?.summary.provisional).toBe(false);
    const notices = await q(
      "SELECT 1 FROM notifications WHERE kind = 'results.course-approved' AND user_id = $1",
      [p.sEnrolled.userId],
    );
    expect(notices.rowCount).toBe(1);
  });
});

describe("confirming", () => {
  it("confers the Certificate halfway: numbered, and the student carries on", async () => {
    await q("UPDATE users SET referral_code = 'ALUM01' WHERE id = $1", [p.sEnrolled.userId]);
    const proposed = (await propose("sEnrolled", "CERTIFICATE")).json<Award>();
    expect(proposed.requirements.every((r) => r.met)).toBe(true);
    expect((await confirm(proposed.id, "acadAdmin")).statusCode).toBe(403);

    const res = await confirm(proposed.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Award>()).toMatchObject({
      awardType: "CERTIFICATE",
      status: "CONFERRED",
      awardClass: "Distinction",
      certificateNo: "GLIM/CERT/AWD/2026/0001",
      awardedOn: "2026-11-02",
    });
    const state = await q<{ pe: string; student: string }>(
      `SELECT pe.status AS pe, s.status AS student FROM programme_enrollments pe
         JOIN students s ON s.id = pe.student_id WHERE pe.id = $1`,
      [proposed.programmeEnrollmentId],
    );
    expect(state.rows[0]).toEqual({ pe: "ACTIVE", student: "ACTIVE" });
    expect((await send("sEnrolled", "GET", `/videos/${video.id}/play`)).statusCode).toBe(200);
    // Proposing a conferred Certificate is refused.
    expect((await propose("sEnrolled", "CERTIFICATE")).statusCode).toBe(409);
  });

  it("confers the Diploma at the end: numbered, the enrollment completed and the student graduated", async () => {
    await passSecondCourse("sEnrolled");
    const proposed = (await propose("sEnrolled", "DIPLOMA")).json<Award>();
    expect(proposed.requirements.every((r) => r.met)).toBe(true);
    const res = await confirm(proposed.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Award>()).toMatchObject({
      awardType: "DIPLOMA",
      status: "CONFERRED",
      certificateNo: "GLIM/DIP/AWD/2026/0001",
    });
    const state = await q<{ pe: string; ended: string; student: string; referral: string }>(
      `SELECT pe.status AS pe, pe.ended_on::text AS ended, s.status AS student, u.referral_code AS referral
         FROM programme_enrollments pe JOIN students s ON s.id = pe.student_id
         JOIN users u ON u.id = s.user_id WHERE pe.id = $1`,
      [proposed.programmeEnrollmentId],
    );
    expect(state.rows[0]).toEqual({
      pe: "COMPLETED",
      ended: "2026-11-02",
      student: "GRADUATED",
      referral: "ALUM01",
    });

    // Confirming again changes nothing: no second number.
    const again = await confirm(proposed.id);
    expect(again.json<Award>().certificateNo).toBe("GLIM/DIP/AWD/2026/0001");
    const audit = await q(
      "SELECT 1 FROM audit_logs WHERE action = 'results.award.conferred' AND resource_id = $1",
      [proposed.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("ends access to the course's recordings once the student graduates", async () => {
    expect((await send("sEnrolled", "GET", `/videos/${video.id}/play`)).statusCode).toBe(404);
  });

  it("numbers certificates without gaps, and keeps a student with another ACTIVE enrollment active", async () => {
    // sGraduated is made ACTIVE with an ACTIVE enrollment on another programme too.
    await q("UPDATE students SET status = 'ACTIVE' WHERE user_id = $1", [p.sGraduated.userId]);
    await q("INSERT INTO programmes (code, name) VALUES ('POTHER', 'Persona Other')");
    await q(
      `INSERT INTO programme_enrollments (student_id, programme_id, curriculum_id, intake_id, cohort_id, matric_number, study_mode, started_on)
       SELECT s.id, (SELECT id FROM programmes WHERE code = 'POTHER'), $2, $3, $4, 'GLIM/POTHER/0009', 'ONLINE', '2025-01-01'
         FROM students s WHERE s.user_id = $1`,
      [p.sGraduated.userId, p.world.curriculumId, p.world.intakeId, p.world.cohortId],
    );
    await passSecondCourse("sGraduated");
    const proposed = (await propose("sGraduated", "DIPLOMA")).json<Award>();
    expect(proposed.requirements.every((r) => r.met)).toBe(true);
    const res = await confirm(proposed.id);
    expect(res.json<Award>().certificateNo).toBe("GLIM/DIP/AWD/2026/0002");
    const student = await q<{ status: string }>("SELECT status FROM students WHERE user_id = $1", [
      p.sGraduated.userId,
    ]);
    expect(student.rows[0]?.status).toBe("ACTIVE");
    const listed = (await send("registrar", "GET", "/awards?status=CONFERRED")).json<{
      items: Award[];
    }>();
    expect(listed.items.map((a) => a.certificateNo).sort()).toEqual([
      "GLIM/CERT/AWD/2026/0001",
      "GLIM/DIP/AWD/2026/0001",
      "GLIM/DIP/AWD/2026/0002",
    ]);
  });
});
