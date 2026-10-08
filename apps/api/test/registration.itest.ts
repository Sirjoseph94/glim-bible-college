import type { Application, MyRegistration, Offering, Semester } from "@glim/contracts";
import { FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { RegistrationService } from "@glim/modules/enrollment";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admissionsWorld, type AdmissionsWorld } from "./admissions-world";
import { applicantKit, idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Personas } from "./personas";

let issuer: FakeOidcIssuer;
let t: TestApp;
let p: Personas;
let world: AdmissionsWorld;
let kit: ReturnType<typeof applicantKit>;
let semester: Semester;
let bibleOffering: Offering;
const students: Record<string, Record<string, string>> = {};

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
  const post = async <T>(url: string, payload?: unknown) => {
    const res = await t.request({ method: "POST", url, headers: acad, payload });
    expect(res.statusCode, res.body).toBeLessThan(300);
    return res.json<T>();
  };
  await post(`/api/v1/academic-sessions/${world.session.id}/activate`);
  semester = await post<Semester>("/api/v1/semesters", {
    academicSessionId: world.session.id,
    code: "S1",
    name: "First Semester",
    sequence: 1,
    startsOn: "2027-09-06",
    endsOn: "2028-01-28",
  });
  const { lecturer } = await post<{ lecturer: { id: string } }>("/api/v1/lecturers", {
    email: "bible.lecturer@glim.edu.ng",
    givenName: "Bisi",
    familyName: "Teacher",
  });
  bibleOffering = await post<Offering>("/api/v1/course-offerings", {
    courseId: world.courses.bible.id,
    semesterId: semester.id,
    lecturers: [{ lecturerId: lecturer.id, role: "PRIMARY" }],
  });
  await post(`/api/v1/course-offerings/${bibleOffering.id}/publish`);

  for (const [name, programmeId] of [
    ["Ada", world.certificate.id],
    ["Bayo", world.diploma.id],
  ] as const)
    students[name] = await acceptedStudent(name, programmeId);
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

/** Applies, is admitted and accepts: returns the new student's headers. */
async function acceptedStudent(name: string, programmeId: string) {
  const ready = await kit.complete(name);
  let application = ready.application;
  if (programmeId !== world.certificate.id)
    application = (await kit.save(ready.headers, application, { programmeId })).json<Application>();
  await kit.submit(ready.headers, application.id);
  await kit.admit(application.id, p.admOfficer.headers);
  const accepted = await t.request({
    method: "POST",
    url: `/api/v1/applications/${application.id}/accept`,
    headers: { ...ready.headers, "idempotency-key": idempotencyKey() },
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  return ready.headers;
}

async function registration(headers: Record<string, string>) {
  return (await t.request({ url: "/api/v1/me/registration", headers })).json<MyRegistration>();
}
const courses = (r: MyRegistration) =>
  r.programmes[0]?.semesters[0]?.courses.map((c) => [c.courseCode, c.selection, c.status]);

describe("opening registration", () => {
  it("registers every active student for their compulsory courses that have an offering", async () => {
    expect((await registration(students.Ada ?? {})).programmes[0]?.semesters).toEqual([]);
    const opened = await t.request({
      method: "POST",
      url: `/api/v1/semesters/${semester.id}/open-registration`,
      headers: p.acadAdmin.headers,
    });
    expect(opened.statusCode).toBe(200);
    const result = await t.app.get(RegistrationService).openRegistration(semester.id);
    expect(result).toEqual({ enrollments: 2, registered: 2, missing: ["THE101"] });

    expect(courses(await registration(students.Ada ?? {}))).toEqual([
      ["BIB101", "COMPULSORY", "ENROLLED"],
    ]);
    const bayo = await registration(students.Bayo ?? {});
    expect(bayo.programmes[0]?.semesters[0]).toMatchObject({
      levelNo: 1,
      semester: { name: "First Semester", status: "REGISTRATION" },
    });
    expect(courses(bayo)).toEqual([["BIB101", "COMPULSORY", "ENROLLED"]]);
  });

  it("can be run again without registering anyone twice", async () => {
    expect(await t.app.get(RegistrationService).openRegistration(semester.id)).toEqual({
      enrollments: 2,
      registered: 0,
      missing: ["THE101"],
    });
  });

  it("tells the Academic Admins about a compulsory course with no published offering, once", async () => {
    const { rows } = await t.db.pool.query<{ title: string }>(
      "SELECT title FROM notifications WHERE user_id = $1 AND kind = 'enrollment.registration.offering-missing'",
      [p.acadAdmin.userId],
    );
    expect(rows.map((r) => r.title)).toEqual([
      "THE101 has no published offering in First Semester",
    ]);
  });

  it("registers a student accepted after registration opened, inside the acceptance", async () => {
    students.Chidi = await acceptedStudent("Chidi", world.certificate.id);
    expect(courses(await registration(students.Chidi))).toEqual([
      ["BIB101", "COMPULSORY", "ENROLLED"],
    ]);
  });
});

describe("a registered student", () => {
  it("sees the offerings they're registered for, and no others", async () => {
    const headers = students.Ada ?? {};
    const list = await t.request({ url: "/api/v1/course-offerings", headers });
    expect(list.json<{ items: Offering[] }>().items.map((o) => o.id)).toEqual([bibleOffering.id]);
    expect(
      (await t.request({ url: `/api/v1/course-offerings/${bibleOffering.id}`, headers }))
        .statusCode,
    ).toBe(200);
    const other = await t.request({
      url: `/api/v1/course-offerings/${p.world.offerings.O1}`,
      headers,
    });
    expect(other.statusCode).toBe(404);
  });
});

describe("course enrollment consistency", () => {
  it("rejects a course enrollment that doesn't match its semester enrollment", async () => {
    const { rows } = await t.db.pool.query<{ se: string; pe: string; student: string }>(
      `SELECT se.id AS se, pe.id AS pe, s.id AS student
         FROM semester_enrollments se
         JOIN programme_enrollments pe ON pe.id = se.programme_enrollment_id
         JOIN students s ON s.id = pe.student_id
        WHERE se.semester_id = $1
        LIMIT 2`,
      [semester.id],
    );
    const [first, second] = rows;
    await expect(
      t.db.pool.query(
        `INSERT INTO course_enrollments (semester_enrollment_id, programme_enrollment_id, course_offering_id, student_id, selection)
         VALUES ($1, $2, $3, $4, 'MANUAL')`,
        [first?.se, first?.pe, bibleOffering.id, second?.student],
      ),
    ).rejects.toThrow(/does not match its semester enrollment/);
    await expect(
      t.db.pool.query(
        `INSERT INTO course_enrollments (semester_enrollment_id, programme_enrollment_id, course_offering_id, student_id, selection)
         VALUES ($1, $2, $3, $4, 'MANUAL')`,
        [first?.se, first?.pe, p.world.offerings.O1, first?.student],
      ),
    ).rejects.toThrow(/does not match its semester enrollment/);
  });
});
