import type {
  Application,
  Cohort,
  CohortSchedule,
  CourseResults,
  GradebookColumn,
  Lecturer,
  MakeupExam,
  MyRegistration,
  RosterItem,
} from "@glim/contracts";
import { FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { OfferingsService } from "@glim/modules/academic";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admissionsWorld, type AdmissionsWorld } from "./admissions-world";
import { applicantKit, idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Personas } from "./personas";

/**
 * Block teaching (ADR-0005): the DIP-2027 cohort's schedule is planned from the curriculum
 * (BIB101 then THE101), publishing an offering registers the cohort, students accepted later join
 * the running offerings, Class Meetings stay within their offering, offerings start and complete
 * on their dates, and a student who misses the exam gets a makeup.
 */

let issuer: FakeOidcIssuer;
let t: TestApp;
let p: Personas;
let world: AdmissionsWorld;
let kit: ReturnType<typeof applicantKit>;
let cohort: Cohort;
let bib101 = "";
let the101 = "";
const students: Record<string, { headers: Record<string, string>; matric: string }> = {};

interface ErrorBody {
  error: { code: string; message: string };
}

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

const acad = () => p.acadAdmin.headers;

function send(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = acad(),
) {
  return t.request({
    method,
    url: `/api/v1${url}`,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
}

/** Applies, is admitted and accepts: a student of the 2027 intake's cohort. */
async function accepted(name: string): Promise<void> {
  const ready = await kit.complete(name);
  expect((await kit.submit(ready.headers, ready.application.id)).statusCode).toBe(200);
  await kit.admit(ready.application.id, p.admOfficer.headers);
  const res = await t.request({
    method: "POST",
    url: `/api/v1/applications/${ready.application.id}/accept`,
    headers: { ...ready.headers, "idempotency-key": idempotencyKey() },
  });
  expect(res.statusCode, res.body).toBe(200);
  students[name] = {
    headers: ready.headers,
    matric: res.json<Application>().enrollment?.matricNumber ?? "",
  };
}

async function studentId(name: string): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `SELECT pe.student_id AS id FROM programme_enrollments pe WHERE pe.matric_number = $1`,
    [students[name]?.matric],
  );
  return rows[0]?.id ?? "";
}

const roster = async (offeringId: string) =>
  (await send("GET", `/course-offerings/${offeringId}/enrollments`)).json<{
    items: RosterItem[];
  }>().items;

beforeAll(async () => {
  issuer = await new FakeOidcIssuer().start();
  t = await createTestApp({
    identityProvider: new OpenIdConnectProvider({
      issuer: issuer.issuerUrl,
      clientId: issuer.clientId,
      clientSecret: issuer.clientSecret,
      allowHttp: true,
    }),
  });
  p = await createPersonas(t);
  world = await admissionsWorld(t, p);
  kit = applicantKit(t, issuer);
  await q(
    "UPDATE programmes SET grading_scheme_id = (SELECT id FROM grading_schemes WHERE name = 'GLIM Diploma') WHERE code = 'DIP'",
  );
  await accepted("Ada");
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

describe("a Cohort Schedule", () => {
  it("lists the cohort the first acceptance created, from the intake's start date", async () => {
    const list = (await send("GET", "/cohorts")).json<{ items: Cohort[] }>().items;
    const found = list.find((c) => c.code === "DIP-2027");
    expect(found).toMatchObject({
      intakeId: world.intake.id,
      startsOn: "2027-09-01",
      activeStudents: 1,
      status: "ACTIVE",
    });
    cohort = found as Cohort;
    const schedule = (await send("GET", `/cohorts/${cohort.id}/schedule`)).json<CohortSchedule>();
    expect(schedule.offerings).toEqual([]);
    expect(schedule.unscheduled.map((u) => u.courseCode)).toEqual(["BIB101", "THE101"]);
  });

  it("is planned end to end in curriculum order, never before the cohort starts", async () => {
    const early = await send("POST", `/cohorts/${cohort.id}/schedule`, {
      startsOn: "2027-08-02",
      weeksPerCourse: 4,
    });
    expect(early.statusCode).toBe(422);
    expect(early.json<ErrorBody>().error.code).toBe("BEFORE_INTAKE_START");
    // All or nothing: the refused plan created no offering.
    expect(
      (await send("GET", `/cohorts/${cohort.id}/schedule`)).json<CohortSchedule>().offerings,
    ).toEqual([]);

    const res = await send("POST", `/cohorts/${cohort.id}/schedule`, {
      startsOn: "2027-09-06",
      weeksPerCourse: 4,
    });
    expect(res.statusCode, res.body).toBe(201);
    const schedule = res.json<CohortSchedule>();
    expect(
      schedule.offerings.map((o) => [o.courseCode, o.startsOn, o.endsOn, o.examOn, o.status]),
    ).toEqual([
      ["BIB101", "2027-09-06", "2027-10-03", "2027-10-03", "DRAFT"],
      ["THE101", "2027-10-04", "2027-10-31", "2027-10-31", "DRAFT"],
    ]);
    expect(schedule.unscheduled).toEqual([]);
    [bib101, the101] = schedule.offerings.map((o) => o.id) as [string, string];

    // Planning again has nothing left to plan.
    const again = await send("POST", `/cohorts/${cohort.id}/schedule`, {
      startsOn: "2027-11-01",
      weeksPerCourse: 4,
    });
    expect(again.json<CohortSchedule>().offerings).toHaveLength(2);
  });
});

describe("registration", () => {
  it("registers every active student of the cohort when an offering is published", async () => {
    const lecturer = (await send("GET", "/lecturers"))
      .json<{ items: Lecturer[] }>()
      .items.find((l) => l.userId === p.l1Primary.userId);
    expect(
      (
        await send("POST", `/course-offerings/${bib101}/lecturers`, {
          lecturerId: lecturer?.id,
          role: "PRIMARY",
        })
      ).statusCode,
    ).toBe(201);
    expect((await roster(bib101)).length).toBe(0);
    const published = await send("POST", `/course-offerings/${bib101}/publish`);
    expect(published.statusCode, published.body).toBe(200);
    expect((await roster(bib101)).map((r) => [r.matricNumber, r.selection, r.cohortCode])).toEqual([
      [students.Ada?.matric, "COHORT", "DIP-2027"],
    ]);

    const mine = (
      await send("GET", "/me/registration", undefined, students.Ada?.headers)
    ).json<MyRegistration>();
    expect(mine.programmes[0]?.cohort.code).toBe("DIP-2027");
    expect(mine.programmes[0]?.courses).toEqual([
      expect.objectContaining({
        courseCode: "BIB101",
        startsOn: "2027-09-06",
        examOn: "2027-10-03",
        makeupOn: null,
        offeringStatus: "PUBLISHED",
        status: "ENROLLED",
      }),
    ]);
  });

  it("registers a student accepted later for the cohort's published offerings only", async () => {
    await accepted("Bola");
    expect((await roster(bib101)).map((r) => r.matricNumber).sort()).toEqual(
      [students.Ada?.matric, students.Bola?.matric].sort(),
    );
    expect(await roster(the101)).toEqual([]);
  });

  it("registers a Retake into another cohort's offering by hand, with a reason, and withdraws", async () => {
    const matric = (
      await q<{ matric_number: string }>(
        `SELECT pe.matric_number FROM programme_enrollments pe JOIN students s ON s.id = pe.student_id
          WHERE s.user_id = $1`,
        [p.sOther.userId],
      )
    ).rows[0]?.matric_number;
    const noReason = await send("POST", `/course-offerings/${the101}/enrollments`, {
      matricNumber: matric,
    });
    expect(noReason.statusCode).toBe(400);
    const lecturerTries = await send(
      "POST",
      `/course-offerings/${the101}/enrollments`,
      { matricNumber: matric, reason: "Retake" },
      p.l1Primary.headers,
    );
    expect([403, 404]).toContain(lecturerTries.statusCode);
    const res = await send("POST", `/course-offerings/${the101}/enrollments`, {
      matricNumber: matric,
      reason: "Retake of THE101",
    });
    expect(res.statusCode, res.body).toBe(201);
    const item = res.json<RosterItem>();
    expect(item).toMatchObject({ selection: "MANUAL", status: "ENROLLED" });
    expect(item.cohortCode).not.toBe("DIP-2027");
    const withdrawn = await send("POST", `/course-enrollments/${item.courseEnrollmentId}/withdraw`, {
      reason: "Changed their mind",
    });
    expect(withdrawn.json<RosterItem>().status).toBe("WITHDRAWN");
  });
});

describe("an offering's dates", () => {
  it("hold its Class Meetings, and can't move away from them or overlap the cohort's others", async () => {
    const meeting = (start: string, end: string) =>
      send(
        "POST",
        `/course-offerings/${bib101}/class-meetings`,
        { title: "Lecture", scheduledStart: start, scheduledEnd: end },
        { ...acad(), "idempotency-key": idempotencyKey() },
      );
    const outside = await meeting("2027-10-05T09:00:00Z", "2027-10-05T10:00:00Z");
    expect(outside.statusCode).toBe(422);
    expect(outside.json<ErrorBody>().error.code).toBe("OUTSIDE_OFFERING_DATES");
    const inside = await meeting("2027-09-20T09:00:00Z", "2027-09-20T10:00:00Z");
    expect(inside.statusCode, inside.body).toBe(201);

    const version = async () =>
      (await send("GET", `/course-offerings/${bib101}`)).json<{ version: number }>().version;
    const move = async (dates: object) =>
      send("PATCH", `/course-offerings/${bib101}`, dates, {
        ...acad(),
        "if-match": `"${String(await version())}"`,
      });
    const leavesMeeting = await move({ startsOn: "2027-09-27" });
    expect(leavesMeeting.statusCode).toBe(422);
    expect(leavesMeeting.json<ErrorBody>().error.code).toBe("OUTSIDE_OFFERING_DATES");
    const overlaps = await move({ endsOn: "2027-10-10", examOn: "2027-10-10" });
    expect(overlaps.statusCode).toBe(409);
    expect(overlaps.json<ErrorBody>().error.code).toBe("OFFERING_OVERLAP");
    const examOutside = await move({ examOn: "2027-10-04" });
    expect(examOutside.statusCode).toBe(400);
    const earlierExam = await move({ examOn: "2027-10-01" });
    expect(earlierExam.statusCode, earlierExam.body).toBe(200);
  });
});

describe("the daily lifecycle", () => {
  it("starts published offerings on their first day and completes them after their last", async () => {
    const offerings = t.app.get(OfferingsService);
    expect(await offerings.advance("2027-09-05")).toEqual({ started: 0, completed: 0 });
    expect(await offerings.advance("2027-09-06")).toEqual({ started: 1, completed: 0 });
    const status = async (id: string) =>
      (await q<{ status: string }>("SELECT status FROM course_offerings WHERE id = $1", [id]))
        .rows[0]?.status;
    expect(await status(bib101)).toBe("ACTIVE");
    expect(await status(the101)).toBe("DRAFT");

    // On its last day it's still running.
    expect(await offerings.advance("2027-10-03")).toEqual({ started: 0, completed: 0 });
    expect(await offerings.advance("2027-10-04")).toEqual({ started: 0, completed: 1 });
    expect(await status(bib101)).toBe("COMPLETED");
    expect(await status(the101)).toBe("DRAFT");
    const enrollments = await q<{ status: string }>(
      "SELECT status FROM course_enrollments WHERE course_offering_id = $1",
      [bib101],
    );
    expect(enrollments.rows.map((r) => r.status)).toEqual(["COMPLETED", "COMPLETED"]);
    const events = await q(
      "SELECT 1 FROM course_enrollment_events WHERE to_status = 'COMPLETED' AND reason = 'Offering completed'",
    );
    expect(events.rowCount).toBe(2);
    // Idempotent.
    expect(await offerings.advance("2027-10-05")).toEqual({ started: 0, completed: 0 });
  });
});

describe("makeup exams", () => {
  let exam: GradebookColumn;

  const results = async () =>
    (
      await send("GET", `/course-offerings/${bib101}/results`, undefined, p.l1Primary.headers)
    ).json<CourseResults>();
  const finalize = () =>
    send("POST", `/course-offerings/${bib101}/results/finalize`, undefined, {
      ...p.l1Primary.headers,
      "idempotency-key": idempotencyKey(),
    });
  const grade = async (name: string, score: string, version = 0) =>
    send("PUT", `/assessments/${exam.assessmentId}/grades/${await studentId(name)}`, { score }, {
      ...p.l1Primary.headers,
      "if-match": `"${String(version)}"`,
    });
  const setMakeup = async (name: string, makeupOn: string, headers = p.l1Primary.headers) =>
    send(
      "PUT",
      `/course-offerings/${bib101}/makeup-exams/${await studentId(name)}`,
      { makeupOn, reason: "In hospital on the exam day" },
      headers,
    );

  beforeAll(async () => {
    const res = await send(
      "POST",
      `/course-offerings/${bib101}/exams`,
      { title: "Final exam", maxScore: "100", weight: "100" },
      { ...p.l1Primary.headers, "idempotency-key": idempotencyKey() },
    );
    expect(res.statusCode, res.body).toBe(201);
    exam = res.json<GradebookColumn>();
    expect((await grade("Ada", "75")).statusCode).toBe(200);
  });

  it("are set by the course's Lecturer, on or after the exam date, and the student is told", async () => {
    const early = await setMakeup("Bola", "2027-09-30");
    expect(early.statusCode).toBe(400);
    // A Lecturer of another course doesn't see this one.
    expect((await setMakeup("Bola", "2027-10-12", p.l2Co.headers)).statusCode).toBe(404);
    const res = await setMakeup("Bola", "2027-10-12");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<MakeupExam>()).toMatchObject({
      makeupOn: "2027-10-12",
      reason: "In hospital on the exam day",
    });
    const list = (
      await send("GET", `/course-offerings/${bib101}/makeup-exams`, undefined, p.l1Primary.headers)
    ).json<{ items: MakeupExam[] }>().items;
    expect(list.map((m) => m.makeupOn)).toEqual(["2027-10-12"]);
    const notices = await q<{ email_status: string }>(
      `SELECT email_status FROM notifications n JOIN students s ON s.user_id = n.user_id
        WHERE n.kind = 'assessment.makeup-exam' AND s.id = $1`,
      [await studentId("Bola")],
    );
    expect(notices.rows).toHaveLength(1);
    const mine = (
      await send("GET", "/me/registration", undefined, students.Bola?.headers)
    ).json<MyRegistration>();
    expect(mine.programmes[0]?.courses[0]?.makeupOn).toBe("2027-10-12");
  });

  it("leave the student out of finalization until their exam is graded", async () => {
    const preview = await results();
    expect(preview.awaitingMakeup).toBe(1);
    const res = await finalize();
    expect(res.statusCode, res.body).toBe(200);
    const after = res.json<CourseResults>();
    expect(after.finalized).toBe(1);
    expect(after.awaitingMakeup).toBe(1);
    const bola = after.items.find((i) => i.matricNumber === students.Bola?.matric);
    expect(bola).toMatchObject({ status: null, makeupOn: "2027-10-12" });
    // Bola's grades stay open; Ada's are locked.
    expect((await grade("Ada", "80", 1)).statusCode).toBe(409);
    expect((await grade("Bola", "64")).statusCode).toBe(200);

    const again = (await finalize()).json<CourseResults>();
    expect(again.finalized).toBe(2);
    expect(again.awaitingMakeup).toBe(0);
    expect(again.items.find((i) => i.matricNumber === students.Bola?.matric)).toMatchObject({
      status: "FINALIZED",
      letter: "B",
    });
    // A finalized student's makeup can't change without reopening the result.
    const locked = await setMakeup("Bola", "2027-10-20");
    expect(locked.statusCode).toBe(409);
    expect(locked.json<ErrorBody>().error.code).toBe("GRADEBOOK_LOCKED");
  });

  it("can be removed, but only while the student's result isn't finalized", async () => {
    const remove = async () =>
      send(
        "DELETE",
        `/course-offerings/${bib101}/makeup-exams/${await studentId("Bola")}`,
        undefined,
        p.l1Primary.headers,
      );
    const locked = await remove();
    expect(locked.statusCode).toBe(409);
    expect(locked.json<ErrorBody>().error.code).toBe("GRADEBOOK_LOCKED");
    const bola = (await results()).items.find((i) => i.matricNumber === students.Bola?.matric);
    const reopened = await send(
      "POST",
      `/course-results/${bola?.id ?? ""}/reopen`,
      { reason: "Makeup recorded in error" },
      p.registrar.headers,
    );
    expect(reopened.statusCode, reopened.body).toBe(200);
    const removed = await remove();
    expect(removed.statusCode).toBe(204);
    const audit = await q(
      "SELECT 1 FROM audit_logs WHERE action IN ('assessment.makeup-exam.set', 'assessment.makeup-exam.removed') AND resource_id = $1",
      [bib101],
    );
    expect(audit.rowCount).toBe(2);
  });
});
