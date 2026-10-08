import type { AdmissionsReport, Application, Me, ReferralReport } from "@glim/contracts";
import { FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
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
let referrerCode: string;
const SECRET = "SENSITIVE-ANSWER-55aa";

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

  // A member of staff invited now gets a referral code.
  const invited = await t.request({
    method: "POST",
    url: "/api/v1/users",
    headers: p.sysAdmin.headers,
    payload: { email: "referrer@glim.edu.ng", displayName: "Rita Referrer", roles: ["REGISTRAR"] },
  });
  expect(invited.statusCode).toBe(201);
  const { rows } = await t.db.pool.query<{ referral_code: string }>(
    "SELECT referral_code FROM users WHERE email = 'referrer@glim.edu.ng'",
  );
  referrerCode = rows[0]?.referral_code ?? "";

  const submitAs = async (applicantName: string, change: object, spiritual?: object) => {
    const ready = await kit.complete(
      applicantName,
      spiritual === undefined ? undefined : { spiritual },
    );
    const application = (
      await kit.save(ready.headers, ready.application, change)
    ).json<Application>();
    expect((await kit.submit(ready.headers, application.id)).statusCode).toBe(200);
    return { headers: ready.headers, application };
  };
  const amaka = await submitAs(
    "Amaka",
    { feedback: { heardVia: ["FRIEND", "STAFF"], referralCode: referrerCode.toLowerCase() } },
    { bornAgainWhen: SECRET },
  );
  await submitAs("Kwame", {
    programmeId: world.diploma.id,
    studyMode: "ON_CAMPUS",
    address: { country: "Ghana" },
    feedback: { heardVia: ["FACEBOOK"], referralCode: "ZZZZ999" },
  });
  await submitAs("Musa", { feedback: { heardVia: ["FRIEND"] } });
  const drafter = await kit.signUp({ sub: "google-drafty", email: "drafty@gmail.com" });
  await kit.start(drafter);

  await kit.admit(amaka.application.id, p.admOfficer.headers);
  await t.request({
    method: "POST",
    url: `/api/v1/applications/${amaka.application.id}/accept`,
    headers: { ...amaka.headers, "idempotency-key": idempotencyKey() },
  });
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

const officer = () => p.admOfficer.headers;
const get = (url: string, headers = officer()) => t.request({ url, headers });

describe("referral codes", () => {
  it("are 7 characters without look-alikes, shown on the profile of staff and students", async () => {
    expect(referrerCode).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
    const { rows } = await t.db.pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'amaka@gmail.com'",
    );
    const student = await t.request({
      url: "/api/v1/me",
      headers: await sessionFor(t, rows[0]?.id ?? ""),
    });
    expect(student.json<Me>().user.referralCode).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
  });
});

describe("the admissions report", () => {
  it("counts submitted applications by status, programme, study mode, country and how they heard", async () => {
    const res = await get(`/api/v1/reports/admissions?intakeId=${world.intake.id}`);
    const report = res.json<AdmissionsReport>();
    const counts = (list: AdmissionsReport["byStatus"]) =>
      Object.fromEntries(list.map((c) => [c.label, c.count]));
    expect(report).toMatchObject({ intake: { code: "2027" }, total: 3, draftsInProgress: 1 });
    expect(counts(report.byStatus)).toEqual({ Accepted: 1, Submitted: 2 });
    expect(counts(report.byProgramme)).toEqual({
      "Certificate in Theology": 2,
      "Diploma in Theology": 1,
    });
    expect(counts(report.byStudyMode)).toEqual({ Online: 2, "On campus": 1 });
    expect(counts(report.byCountry)).toEqual({ Nigeria: 2, Ghana: 1 });
    expect(counts(report.byHeardVia)).toEqual({
      "A friend": 2,
      Facebook: 1,
      "A member of staff": 1,
    });
  });

  it("downloads as CSV", async () => {
    const res = await get(`/api/v1/reports/admissions?intakeId=${world.intake.id}&format=csv`);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="admissions-report-/);
    expect(res.body.split("\r\n")[0]).toBe("Dimension,Value,Applications");
    expect(res.body).toContain("Country,Ghana,1\r\n");
  });
});

describe("the referral report", () => {
  it("credits each referrer with their applicants' outcomes, and lists codes that matched nobody", async () => {
    const report = (await get("/api/v1/reports/referrals")).json<ReferralReport>();
    expect(report.referrers).toEqual([
      expect.objectContaining({
        name: "Rita Referrer",
        code: referrerCode,
        total: 1,
        // Offered a place (whether or not accepted yet), and accepted.
        admitted: 1,
        accepted: 1,
      }),
    ]);
    expect(report.unmatched).toEqual([
      {
        code: "ZZZZ999",
        applications: [expect.objectContaining({ applicantName: "Kwame Okafor" })],
      },
    ]);
    const csv = await get("/api/v1/reports/referrals?format=csv");
    expect(csv.body).toContain("Rita Referrer");
  });
});

describe("the export", () => {
  it("leaves spiritual background out unless asked for, and audits every export", async () => {
    const plain = await get(`/api/v1/admissions/applications/export?intakeId=${world.intake.id}`);
    expect(plain.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(plain.body.split("\r\n")).toHaveLength(5); // header, 3 rows, final line end
    expect(plain.body).not.toContain("Born again");
    expect(plain.body).not.toContain(SECRET);

    const sensitive = await get(
      `/api/v1/admissions/applications/export?intakeId=${world.intake.id}&includeSensitive=true&format=json`,
    );
    const items = sensitive.json<{ items: Record<string, unknown>[] }>().items;
    expect(items.find((i) => i["First name"] === "Amaka")?.["Born again when"]).toBe(SECRET);

    const { rows } = await t.db.pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE action = 'admissions.applications.exported' ORDER BY created_at",
    );
    expect(rows.map((r) => r.metadata)).toEqual([
      { intakeId: world.intake.id, includeSensitive: false, format: "csv", count: 3 },
      { intakeId: world.intake.id, includeSensitive: true, format: "json", count: 3 },
    ]);
  });

  it("is only for Admissions staff", async () => {
    for (const headers of [p.registrar.headers, p.acadAdmin.headers, p.noRole.headers])
      expect((await get("/api/v1/admissions/applications/export", headers)).statusCode).toBe(403);
  });
});
