import type { Award, AwardCandidate, GradebookColumn, Video } from "@glim/contracts";
import { FAKE_CHANNEL_URL } from "@glim/integrations/video-host/fake";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/**
 * Awards and graduation (TRD §14.6). PBIB101 (3 credits) is the curriculum's one compulsory
 * course and 2 elective credits are required. O1 is finalized and the semester published:
 * sEnrolled 80 ⇒ A (CGPA 5.00), sCompleted 20 ⇒ F (0.00), sGraduated 90 ⇒ A.
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

const propose = async (as: PersonaName) =>
  send("registrar", "POST", `/programme-enrollments/${await enrollmentOf(as)}/award/propose`);
const confirm = (awardId: string, as: PersonaName = "registrar") =>
  send(as, "POST", `/awards/${awardId}/confirm`, undefined, key());

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
  // The curriculum: PBIB101 compulsory; an elective placement; 2 elective credits required.
  await q("UPDATE curricula SET min_elective_credits = 2 WHERE id = $1", [p.world.curriculumId]);
  await q(
    `INSERT INTO curriculum_courses (curriculum_id, course_id, level_no, semester_no, course_type)
     SELECT $1, id, 1, 1, 'COMPULSORY' FROM courses WHERE code = 'PBIB101'`,
    [p.world.curriculumId],
  );
  await q("INSERT INTO courses (code, title, credits) VALUES ('ELC101', 'Elective', 2)");
  await q(
    `INSERT INTO curriculum_courses (curriculum_id, course_id, level_no, semester_no, course_type)
     SELECT $1, id, 1, 1, 'ELECTIVE' FROM courses WHERE code = 'ELC101'`,
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
  for (const [as, url, body] of [
    ["l1Primary", `/course-offerings/${p.world.offerings.O1}/results/finalize`, undefined],
    ["registrar", "/results/semesters/compute", { semesterId: p.world.semesterId }],
    ["registrar", "/results/semesters/approve", { semesterId: p.world.semesterId }],
    ["registrar", "/results/semesters/publish", { semesterId: p.world.semesterId }],
  ] as const) {
    const res = await send(as, "POST", url, body, key());
    expect(res.statusCode, res.body).toBe(200);
  }
});

afterAll(async () => {
  await t.close();
});

describe("proposing", () => {
  it("lists ACTIVE students with their CGPA", async () => {
    const res = await send("registrar", "GET", "/awards/candidates");
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: AwardCandidate[] }>().items;
    const enrolled = items.find((c) => c.studentName === "sEnrolled Persona");
    expect(enrolled).toMatchObject({ cgpaX100: 500, creditsEarnedX10: 30, award: null });
    // sGraduated's programme enrollment is COMPLETED already.
    expect(items.some((c) => c.studentName === "sGraduated Persona")).toBe(false);
    expect((await send("acadAdmin", "GET", "/awards/candidates")).statusCode).toBe(403);
  });

  it("works out CGPA, credits and class, with a checklist that doesn't block the proposal", async () => {
    const res = await propose("sEnrolled");
    expect(res.statusCode, res.body).toBe(200);
    const award = res.json<Award>();
    expect(award).toMatchObject({
      status: "DRAFT",
      cgpaX100: 500,
      creditsEarnedX10: 30,
      awardClass: "Distinction",
      certificateNo: null,
    });
    expect(award.requirements.map((r) => [r.key, r.met])).toEqual([
      ["COMPULSORY", true],
      ["ELECTIVE_CREDITS", false],
      ["PUBLISHED", true],
      ["SCHEME", true],
    ]);
    expect(award.requirements[1]?.detail).toBe("0 of 2 elective credits earned");
    const refused = await confirm(award.id);
    expect(refused.statusCode).toBe(422);
    expect(refused.json<ErrorBody>().error.code).toBe("REQUIREMENTS_NOT_MET");
    expect(refused.json<ErrorBody>().error.message).toContain("Minimum elective credits");
  });

  it("refuses an award below a CGPA of 1.00 with NO_AWARD", async () => {
    const res = await propose("sCompleted");
    const award = res.json<Award>();
    expect(award).toMatchObject({ cgpaX100: 0, awardClass: null });
    expect(award.requirements.find((r) => r.key === "COMPULSORY")).toMatchObject({
      met: false,
      detail: "Not yet passed: PBIB101",
    });
    const refused = await confirm(award.id);
    expect(refused.json<ErrorBody>().error.code).toBe("NO_AWARD");
  });
});

describe("confirming", () => {
  it("confers the award with a certificate number, completes the enrollment and graduates the student", async () => {
    await q("UPDATE curricula SET min_elective_credits = 0 WHERE id = $1", [p.world.curriculumId]);
    await q("UPDATE users SET referral_code = 'ALUM01' WHERE id = $1", [p.sEnrolled.userId]);
    // Before: the recording plays.
    expect((await send("sEnrolled", "GET", `/videos/${video.id}/play`)).statusCode).toBe(200);
    const proposed = (await propose("sEnrolled")).json<Award>();
    expect(proposed.requirements.every((r) => r.met)).toBe(true);
    expect((await confirm(proposed.id, "acadAdmin")).statusCode).toBe(403);

    const res = await confirm(proposed.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Award>()).toMatchObject({
      status: "CONFERRED",
      awardClass: "Distinction",
      certificateNo: "GLIM/DIP/AWD/2026/0001",
      awardedOn: "2026-11-02",
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
    // Proposing a conferred award is refused.
    expect((await propose("sEnrolled")).statusCode).toBe(409);

    const audit = await q(
      "SELECT 1 FROM audit_logs WHERE action = 'results.award.conferred' AND resource_id = $1",
      [proposed.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("ends access to the course's recordings once the student graduates", async () => {
    const t2 = await send("sEnrolled", "GET", `/videos/${video.id}/play`);
    expect(t2.statusCode).toBe(404);
  });

  it("numbers certificates without gaps, and keeps a student with another ACTIVE enrollment active", async () => {
    // sGraduated is made ACTIVE with an ACTIVE Certificate enrollment too.
    await q("UPDATE students SET status = 'ACTIVE' WHERE user_id = $1", [p.sGraduated.userId]);
    await q(
      `INSERT INTO programmes (code, name, award_type, duration_semesters, levels)
       VALUES ('PCERT', 'Persona Certificate', 'CERTIFICATE', 2, 1)`,
    );
    await q(
      `INSERT INTO programme_enrollments (student_id, programme_id, curriculum_id, entry_session_id, matric_number, study_mode, started_on)
       SELECT s.id, (SELECT id FROM programmes WHERE code = 'PCERT'), $2, $3, 'GLIM/PCERT/0009', 'ONLINE', '2080-09-01'
         FROM students s WHERE s.user_id = $1`,
      [p.sGraduated.userId, p.world.curriculumId, p.world.sessionId],
    );
    const proposed = (await propose("sGraduated")).json<Award>();
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
      "GLIM/DIP/AWD/2026/0001",
      "GLIM/DIP/AWD/2026/0002",
    ]);
  });
});
