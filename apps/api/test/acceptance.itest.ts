import type { Application, Me } from "@glim/contracts";
import { FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
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
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

/** An applicant whose application has been admitted: submitted, reviewed and offered a place. */
async function admitted(
  name: string,
): Promise<{ headers: Record<string, string>; application: Application }> {
  const ready = await kit.complete(name, { spiritual: { bornAgainWhen: "SECRET-WHEN" } });
  const application = ready.application;
  expect((await kit.submit(ready.headers, application.id)).statusCode).toBe(200);
  await kit.admit(application.id, p.admOfficer.headers);
  return { headers: ready.headers, application };
}

function accept(headers: Record<string, string>, id: string, key = idempotencyKey()) {
  return t.request({
    method: "POST",
    url: `/api/v1/applications/${id}/accept`,
    headers: { ...headers, "idempotency-key": key },
  });
}

describe("accepting an offer", () => {
  it("makes the applicant a student with a Matric Number, in one step", async () => {
    const { headers, application } = await admitted("Ngozi");
    const before = await t.request({ url: `/api/v1/applications/${application.id}`, headers });
    expect(before.json<Application>().offer?.expiresAt).toBeDefined();

    const key = idempotencyKey();
    const res = await accept(headers, application.id, key);
    expect(res.statusCode).toBe(200);
    const accepted = res.json<Application>();
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.enrollment).toEqual({ matricNumber: "GLIM/DIP/2027/0001" });
    expect(accepted.timeline.map((e) => e.status).at(-1)).toBe("ACCEPTED");
    expect((await accept(headers, application.id, key)).json()).toEqual(accepted);
    const again = await accept(headers, application.id);
    expect(again.statusCode).toBe(409);

    const me = (await t.request({ url: "/api/v1/me", headers })).json<Me>();
    expect(me.roles.isStudent).toBe(true);
  });

  it("copies only the permitted profile fields to the student record (INV-15)", async () => {
    const { rows } = await t.db.pool.query<Record<string, unknown>>(
      `SELECT s.* FROM students s JOIN users u ON u.id = s.user_id WHERE u.email = 'ngozi@gmail.com'`,
    );
    expect(rows[0]).toMatchObject({
      title: "Mr",
      given_name: "Ngozi",
      family_name: "Okafor",
      gender: "MALE",
      nationality: "Nigerian",
      phone_whatsapp: "+2348031234567",
      city: "Nsukka",
      church_name: "Grace Chapel",
      pastor_name: "Pastor Obi",
      status: "ACTIVE",
    });
    expect(rows[0]?.photo_file_id).toEqual(expect.any(String));
    const columns = Object.keys(rows[0] ?? {});
    for (const forbidden of ["marital_status", "occupation", "spiritual_background"])
      expect(columns).not.toContain(forbidden);
    expect(JSON.stringify(rows[0])).not.toContain("SECRET-WHEN");
  });

  it("enrolls them on the active curriculum, in the intake's cohort", async () => {
    const { rows } = await t.db.pool.query<Record<string, unknown>>(
      `SELECT pe.*, pe.started_on::text AS started_on, c.code AS cohort_code, cu.status AS curriculum_status
         FROM programme_enrollments pe
         JOIN cohorts c ON c.id = pe.cohort_id
         JOIN curricula cu ON cu.id = pe.curriculum_id
        WHERE pe.matric_number = 'GLIM/DIP/2027/0001'`,
    );
    expect(rows[0]).toMatchObject({
      cohort_code: "DIP-2027",
      curriculum_status: "ACTIVE",
      intake_id: world.intake.id,
      study_mode: "ONLINE",
      status: "ACTIVE",
      started_on: "2027-09-01",
    });
  });

  it("gives them a referral code, emails a welcome with the Matric Number, and tells the Academic Admins", async () => {
    const { rows } = await t.db.pool.query<{ referral_code: string }>(
      "SELECT referral_code FROM users WHERE email = 'ngozi@gmail.com'",
    );
    const code = rows[0]?.referral_code ?? "";
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);

    await kit.sendQueuedEmails();
    const welcome = t.mailer.sent.find(
      (m) => m.to === "ngozi.mail@gmail.com" && m.subject.startsWith("Welcome"),
    );
    expect(welcome?.subject).toBe(
      "Welcome to GLIM Online Bible College: your Matric Number is GLIM/DIP/2027/0001",
    );
    expect(welcome?.text).toContain(code);

    const { rows: told } = await t.db.pool.query<{ title: string; email_status: string }>(
      "SELECT title, email_status FROM notifications WHERE user_id = $1 AND kind = 'enrollment.student.admitted'",
      [p.acadAdmin.userId],
    );
    expect(told).toEqual([
      {
        title: "Ngozi Okafor accepted a place on the Diploma in Theology",
        // In-app, and in the Academic Admin's daily digest (not critical, §15.1).
        email_status: "DIGEST",
      },
    ]);
  });

  it("is refused once the offer has expired", async () => {
    const { application } = await admitted("Tardy");
    const now = t.clock.now();
    t.clock.advance({ days: 21, minutes: 1 });
    // Three weeks on, they sign in again to accept.
    const headers = await kit.signUp({ sub: "google-tardy", email: "tardy@gmail.com" });
    const late = await accept(headers, application.id);
    t.clock.set(now);
    expect(late.statusCode).toBe(422);
    expect(late.json()).toMatchObject({ error: { code: "OFFER_EXPIRED" } });
  });

  it("numbers concurrent acceptances consecutively, per programme and year, with no gaps", async () => {
    const offers = [];
    for (const name of ["Uche", "Vera", "Wale", "Xena", "Yemi"]) offers.push(await admitted(name));
    const results = await Promise.all(offers.map((o) => accept(o.headers, o.application.id)));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(results.map((r) => r.json<Application>().enrollment?.matricNumber).sort()).toEqual([
      "GLIM/DIP/2027/0002",
      "GLIM/DIP/2027/0003",
      "GLIM/DIP/2027/0004",
      "GLIM/DIP/2027/0005",
      "GLIM/DIP/2027/0006",
    ]);
  });

  it("is the applicant's own offer to accept", async () => {
    const { application } = await admitted("Zara");
    for (const headers of [p.admOfficer.headers, p.sysAdmin.headers, p.noRole.headers])
      expect((await accept(headers, application.id)).statusCode).toBe(404);
  });
});
