import type {
  Application,
  Course,
  CurriculumDetail,
  MyRegistration,
  Offering,
  RosterItem,
  Semester,
  SemesterRegistration,
} from "@glim/contracts";
import { FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import type { LightMyRequestResponse } from "fastify";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { RegistrationService } from "@glim/modules/enrollment";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admissionsWorld, type AdmissionsWorld } from "./admissions-world";
import { applicantKit, idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, sessionFor, type Personas } from "./personas";

let issuer: FakeOidcIssuer;
let t: TestApp;
let p: Personas;
let world: AdmissionsWorld;
let kit: ReturnType<typeof applicantKit>;
let semester: Semester;
const offerings: Record<string, Offering> = {};
const students: Record<
  string,
  { headers: Record<string, string>; semesterEnrollmentId: string; matric: string }
> = {};

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
  kit = applicantKit(t, issuer, () => world.certificate.id);
  const acad = p.acadAdmin.headers;
  const send = async <T>(method: "POST" | "PUT", url: string, payload?: unknown, extra = {}) => {
    const res = await t.request({ method, url, headers: { ...acad, ...extra }, payload });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res.json<T>();
  };

  // Certificate v2: BIB101 compulsory, two electives, all Level 1 semester 1.
  const ministry = await send<Course>("POST", "/api/v1/courses", {
    code: "MIN101",
    title: "Ministry",
    credits: "2",
  });
  const evangelism = await send<Course>("POST", "/api/v1/courses", {
    code: "EVA101",
    title: "Evangelism",
    credits: "2",
  });
  const v2 = await send<CurriculumDetail>("POST", "/api/v1/curricula", {
    programmeId: world.certificate.id,
    effectiveFrom: "2027-09-01",
  });
  await send(
    "PUT",
    `/api/v1/curricula/${v2.id}/courses`,
    {
      placements: [
        { courseId: world.courses.bible.id, levelNo: 1, semesterNo: 1, courseType: "COMPULSORY" },
        { courseId: ministry.id, levelNo: 1, semesterNo: 1, courseType: "ELECTIVE" },
        { courseId: evangelism.id, levelNo: 1, semesterNo: 1, courseType: "ELECTIVE" },
      ],
    },
    { "if-match": `"${String(v2.version)}"` },
  );
  await send("POST", `/api/v1/curricula/${v2.id}/activate`);

  await send("POST", `/api/v1/academic-sessions/${world.session.id}/activate`);
  semester = await send<Semester>("POST", "/api/v1/semesters", {
    academicSessionId: world.session.id,
    code: "S1",
    name: "First Semester",
    sequence: 1,
    startsOn: "2027-09-06",
    endsOn: "2028-01-28",
    addDropDeadlineOn: "2027-09-20",
  });
  const { lecturer } = await send<{ lecturer: { id: string } }>("POST", "/api/v1/lecturers", {
    email: "electives.lecturer@glim.edu.ng",
    givenName: "Esi",
    familyName: "Lecturer",
  });
  for (const [key, course, capacity] of [
    ["bible", world.courses.bible, null],
    ["ministry", ministry, 1],
    ["evangelism", evangelism, null],
  ] as const) {
    const created = await send<Offering>("POST", "/api/v1/course-offerings", {
      courseId: course.id,
      semesterId: semester.id,
      ...(capacity === null ? {} : { capacity }),
      lecturers: [{ lecturerId: lecturer.id, role: "PRIMARY" }],
    });
    await send("POST", `/api/v1/course-offerings/${created.id}/publish`);
    offerings[key] = created;
  }

  for (const name of ["Ada", "Bayo"]) {
    const ready = await kit.complete(name);
    await kit.submit(ready.headers, ready.application.id);
    await kit.admit(ready.application.id, p.admOfficer.headers);
    const accepted = await t.request({
      method: "POST",
      url: `/api/v1/applications/${ready.application.id}/accept`,
      headers: { ...ready.headers, "idempotency-key": idempotencyKey() },
    });
    students[name] = {
      headers: ready.headers,
      semesterEnrollmentId: "",
      matric: accepted.json<Application>().enrollment?.matricNumber ?? "",
    };
  }
  await send("POST", `/api/v1/semesters/${semester.id}/open-registration`);
  await t.app.get(RegistrationService).openRegistration(semester.id);
  for (const s of Object.values(students)) {
    const mine = (
      await t.request({ url: "/api/v1/me/registration", headers: s.headers })
    ).json<MyRegistration>();
    s.semesterEnrollmentId = mine.programmes[0]?.semesters[0]?.semesterEnrollmentId ?? "";
  }
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

const ada = () => students.Ada ?? { headers: {}, semesterEnrollmentId: "", matric: "" };
const bayo = () => students.Bayo ?? { headers: {}, semesterEnrollmentId: "", matric: "" };
const offering = (key: string) => offerings[key]?.id ?? "";

function addElective(student: ReturnType<typeof ada>, offeringId: string) {
  return t.request({
    method: "POST",
    url: `/api/v1/semester-enrollments/${student.semesterEnrollmentId}/electives`,
    headers: student.headers,
    payload: { offeringId },
  });
}
function drop(student: ReturnType<typeof ada>, courseEnrollmentId: string) {
  return t.request({
    method: "DELETE",
    url: `/api/v1/semester-enrollments/${student.semesterEnrollmentId}/electives/${courseEnrollmentId}`,
    headers: student.headers,
  });
}
const code = (res: LightMyRequestResponse) => res.json<{ error: { code: string } }>().error.code;

describe("electives", () => {
  it("are offered for the student's Level and semester, with credits, capacity and the deadline", async () => {
    const res = await t.request({
      url: `/api/v1/semester-enrollments/${ada().semesterEnrollmentId}/registration`,
      headers: ada().headers,
    });
    const reg = res.json<SemesterRegistration>();
    expect(reg).toMatchObject({ windowOpen: true, semester: { addDropDeadlineOn: "2027-09-20" } });
    expect(reg.courses.map((c) => [c.courseCode, c.selection])).toEqual([["BIB101", "COMPULSORY"]]);
    expect(reg.electives.map((e) => [e.courseCode, e.credits, e.capacity, e.full])).toEqual([
      ["EVA101", "2.0", null, false],
      ["MIN101", "2.0", 1, false],
    ]);
  });

  it("can be added until the course is full, once each, and only real electives", async () => {
    const added = await addElective(ada(), offering("ministry"));
    expect(added.statusCode).toBe(200);
    expect(
      added.json<SemesterRegistration>().courses.map((c) => [c.courseCode, c.selection, c.status]),
    ).toEqual([
      ["BIB101", "COMPULSORY", "ENROLLED"],
      ["MIN101", "ELECTIVE", "ENROLLED"],
    ]);
    expect(code(await addElective(bayo(), offering("ministry")))).toBe("OFFERING_FULL");
    expect(code(await addElective(ada(), offering("ministry")))).toBe("ALREADY_ENROLLED");
    expect(code(await addElective(ada(), offering("bible")))).toBe("ELECTIVE_NOT_AVAILABLE");
    expect(code(await addElective(ada(), p.world.offerings.O1))).toBe("ELECTIVE_NOT_AVAILABLE");
  });

  it("can be dropped, which frees the place; compulsory courses can't be", async () => {
    const reg = (
      await t.request({
        url: `/api/v1/semester-enrollments/${ada().semesterEnrollmentId}/registration`,
        headers: ada().headers,
      })
    ).json<SemesterRegistration>();
    const ministry = reg.courses.find((c) => c.courseCode === "MIN101");
    const bible = reg.courses.find((c) => c.courseCode === "BIB101");
    const dropped = await drop(ada(), ministry?.courseEnrollmentId ?? "");
    expect(
      dropped.json<SemesterRegistration>().courses.find((c) => c.courseCode === "MIN101")?.status,
    ).toBe("DROPPED");
    expect((await addElective(bayo(), offering("ministry"))).statusCode).toBe(200);
    expect(code(await drop(ada(), bible?.courseEnrollmentId ?? ""))).toBe("ELECTIVE_NOT_AVAILABLE");
  });

  it("belong to the student: others can't see or change them", async () => {
    const theirs = await t.request({
      url: `/api/v1/semester-enrollments/${ada().semesterEnrollmentId}/registration`,
      headers: bayo().headers,
    });
    expect(theirs.statusCode).toBe(404);
    const forOthers = await t.request({
      method: "POST",
      url: `/api/v1/semester-enrollments/${ada().semesterEnrollmentId}/electives`,
      headers: bayo().headers,
      payload: { offeringId: offering("evangelism") },
    });
    expect(forOthers.statusCode).toBe(404);
  });
});

describe("the Academic Admin", () => {
  const acad = () => p.acadAdmin.headers;

  it("sees the roster, registers a student manually with a reason, and withdraws one", async () => {
    const roster = await t.request({
      url: `/api/v1/course-offerings/${offering("ministry")}/enrollments`,
      headers: acad(),
    });
    expect(
      roster.json<{ items: RosterItem[] }>().items.map((r) => [r.studentName, r.status]),
    ).toEqual([
      ["Ada Okafor", "DROPPED"],
      ["Bayo Okafor", "ENROLLED"],
    ]);

    const manual = await t.request({
      method: "POST",
      url: `/api/v1/course-offerings/${offering("evangelism")}/enrollments`,
      headers: acad(),
      payload: {
        matricNumber: ada().matric.toLowerCase(),
        reason: "Retake agreed with the student",
      },
    });
    expect(manual.statusCode).toBe(201);
    expect(manual.json<RosterItem>()).toMatchObject({ selection: "MANUAL", status: "ENROLLED" });
    const full = await t.request({
      method: "POST",
      url: `/api/v1/course-offerings/${offering("ministry")}/enrollments`,
      headers: acad(),
      payload: { matricNumber: ada().matric, reason: "Exception" },
    });
    expect(code(full)).toBe("OFFERING_FULL");
    const unknown = await t.request({
      method: "POST",
      url: `/api/v1/course-offerings/${offering("evangelism")}/enrollments`,
      headers: acad(),
      payload: { matricNumber: "GLIM/CERT/2027/9999", reason: "Typo" },
    });
    expect(unknown.statusCode).toBe(404);

    const bayoMinistry = roster
      .json<{ items: RosterItem[] }>()
      .items.find((r) => r.studentName === "Bayo Okafor");
    const withdraw = () =>
      t.request({
        method: "POST",
        url: `/api/v1/course-enrollments/${bayoMinistry?.courseEnrollmentId ?? ""}/withdraw`,
        headers: acad(),
        payload: { reason: "Changed programme of study" },
      });
    const withdrawn = await withdraw();
    expect(withdrawn.json<RosterItem>().status).toBe("WITHDRAWN");
    expect((await withdraw()).statusCode).toBe(409);

    const { rows: events } = await t.db.pool.query<{ to_status: string; reason: string }>(
      "SELECT to_status, reason FROM course_enrollment_events WHERE course_enrollment_id = $1 ORDER BY created_at",
      [bayoMinistry?.courseEnrollmentId],
    );
    expect(events).toEqual([
      { to_status: "ENROLLED", reason: "Elective chosen by the student" },
      { to_status: "WITHDRAWN", reason: "Changed programme of study" },
    ]);
    const { rows: ended } = await t.db.pool.query(
      "SELECT 1 FROM pgboss.job WHERE name = 'domain-event' AND data->>'name' = 'course.enrollment.ended'",
    );
    expect(ended.length).toBe(2); // Ada's drop and Bayo's withdrawal
  });

  it("is the only one who can register manually", async () => {
    const res = await t.request({
      method: "POST",
      url: `/api/v1/course-offerings/${offering("evangelism")}/enrollments`,
      headers: bayo().headers,
      payload: { matricNumber: bayo().matric, reason: "Let me in" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("after the add/drop deadline", () => {
  it("students can no longer add or drop electives", async () => {
    t.clock.set("2027-09-21T09:00:00Z");
    const { rows } = await t.db.pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'ada@gmail.com'",
    );
    const headers = await sessionFor(t, rows[0]?.id ?? "");
    const late = { ...ada(), headers };
    expect(code(await addElective(late, offering("ministry")))).toBe("REGISTRATION_CLOSED");
    const reg = (
      await t.request({
        url: `/api/v1/semester-enrollments/${late.semesterEnrollmentId}/registration`,
        headers,
      })
    ).json<SemesterRegistration>();
    expect(reg.windowOpen).toBe(false);
  });
});
