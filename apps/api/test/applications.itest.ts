import type { AcademicSession, Application, Intake, Me, Programme } from "@glim/contracts";
import { FakeOidcIssuer, type FakeGoogleUser } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieValue, viaGoogle } from "./google-flow";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Personas } from "./personas";

let issuer: FakeOidcIssuer;
let t: TestApp;
let p: Personas;
let intake: Intake;
let certificate: Programme;
let diploma: Programme;

beforeAll(async () => {
  issuer = await new FakeOidcIssuer().start();
  t = await createTestApp({
    captureLogs: true,
    identityProvider: new OpenIdConnectProvider({
      issuer: issuer.issuerUrl,
      clientId: issuer.clientId,
      clientSecret: issuer.clientSecret,
      allowHttp: true,
    }),
  });
  p = await createPersonas(t);
  const acad = p.acadAdmin.headers;
  const programme = async (code: string, awardType: string, levels: number) =>
    (
      await t.request({
        method: "POST",
        url: "/api/v1/programmes",
        headers: acad,
        payload: {
          code,
          name: `${code} programme`,
          awardType,
          durationSemesters: 2 * levels,
          levels,
        },
      })
    ).json<Programme>();
  certificate = await programme("CERT", "CERTIFICATE", 1);
  diploma = await programme("DIP", "DIPLOMA", 2);
  const session = (
    await t.request({
      method: "POST",
      url: "/api/v1/academic-sessions",
      headers: acad,
      payload: {
        code: "2027/2028",
        name: "2027/2028 Session",
        startsOn: "2027-09-01",
        endsOn: "2028-06-30",
      },
    })
  ).json<AcademicSession>();
  intake = (
    await t.request({
      method: "POST",
      url: "/api/v1/intakes",
      headers: p.admOfficer.headers,
      payload: {
        code: "2027",
        academicSessionId: session.id,
        opensOn: "2026-11-01",
        closesOn: "2027-06-30",
      },
    })
  ).json<Intake>();
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

/** Signs up (or back in) from /apply, returning headers that act as that applicant. */
async function applicant(user: FakeGoogleUser): Promise<Record<string, string>> {
  const res = await viaGoogle(t, issuer, user, { intent: "apply", returnTo: "/application/edit" });
  expect(res.headers.location).toBe("/application/edit");
  const cookie = cookieValue(res, "__Host-glim_sid") ?? "";
  const me = await t.request({ url: "/api/v1/me", headers: { cookie } });
  return { cookie, "x-csrf-token": me.json<Me>().csrfToken };
}

async function start(headers: Record<string, string>, programmeId = certificate.id) {
  return t.request({
    method: "POST",
    url: "/api/v1/applications",
    headers,
    payload: { programmeId, studyMode: "ONLINE" },
  });
}

async function save(
  headers: Record<string, string>,
  application: { id: string; version: number },
  payload: unknown,
) {
  return t.request({
    method: "PATCH",
    url: `/api/v1/applications/${application.id}`,
    headers: { ...headers, "if-match": `"${String(application.version)}"` },
    payload,
  });
}

describe("signing up to apply", () => {
  it("creates a role-less account only from /apply, with a 24-hour idle session", async () => {
    const ngozi = { sub: "google-ngozi", email: "ngozi@gmail.com", name: "Ngozi Okeke" };
    const elsewhere = await viaGoogle(t, issuer, ngozi);
    expect(elsewhere.headers.location).toBe("/login?error=ACCOUNT_NOT_FOUND");

    const headers = await applicant(ngozi);
    const me = await t.request({ url: "/api/v1/me", headers });
    expect(me.json()).toMatchObject({
      user: { email: "ngozi@gmail.com", displayName: "Ngozi Okeke", googleLinked: true },
      roles: { staff: [], isApplicant: false },
    });

    // Staff sessions end after 2 idle hours; an applicant filling in the long form keeps going.
    const now = t.clock.now();
    t.clock.advance({ hours: 3 });
    expect((await t.request({ url: "/api/v1/me", headers })).statusCode).toBe(200);
    t.clock.set(now); // so the personas' staff sessions are still live for the other tests

    // Coming back from /apply finds the same account rather than making another.
    const again = await applicant(ngozi);
    expect((await t.request({ url: "/api/v1/me", headers: again })).json<Me>().user.id).toBe(
      me.json<Me>().user.id,
    );
  });

  it("sends a failed sign-up back to /apply with the reason", async () => {
    const res = await viaGoogle(
      t,
      issuer,
      { sub: "google-unverified-applicant", email: "unverified@gmail.com", emailVerified: false },
      { intent: "apply" },
    );
    expect(res.headers.location).toBe("/apply?error=GOOGLE_EMAIL_UNVERIFIED");
  });
});

describe("starting an application", () => {
  it("is refused while the intake isn't open", async () => {
    const headers = await applicant({ sub: "google-early", email: "early@gmail.com" });
    const res = await start(headers);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: "INTAKE_CLOSED" } });
  });

  it("makes the user an Applicant, with their Google email filled in, once per intake", async () => {
    await t.request({
      method: "POST",
      url: `/api/v1/intakes/${intake.id}/open`,
      headers: p.admOfficer.headers,
    });
    const headers = await applicant({
      sub: "google-tunde",
      email: "tunde@gmail.com",
      name: "Tunde",
    });
    const res = await start(headers, diploma.id);
    expect(res.statusCode).toBe(201);
    const application = res.json<Application>();
    expect(application).toMatchObject({
      status: "DRAFT",
      referenceNo: null,
      studyMode: "ONLINE",
      programme: { code: "DIP", awardType: "DIPLOMA" },
      intake: { code: "2027", startsOn: "2027-09-01", status: "OPEN" },
      contact: { email: "tunde@gmail.com" },
      minimumAgeYears: 18,
    });
    expect(application.missing.personal).toContain("firstName");
    expect(application.missing.consent).toEqual(["consented"]);

    const me = await t.request({ url: "/api/v1/me", headers });
    expect(me.json<Me>().roles.isApplicant).toBe(true);
    const mine = await t.request({ url: "/api/v1/applications/mine", headers });
    expect(mine.json<{ items: { id: string }[] }>().items.map((a) => a.id)).toEqual([
      application.id,
    ]);

    const twice = await start(headers);
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ error: { code: "APPLICATION_ALREADY_OPEN" } });
  });
});

describe("saving the draft", () => {
  let headers: Record<string, string>;
  let draft: Application;

  beforeAll(async () => {
    headers = await applicant({ sub: "google-amina", email: "amina@gmail.com" });
    draft = (await start(headers)).json<Application>();
  });

  it("saves a section at a time with If-Match, and resumes where the applicant left off", async () => {
    const res = await save(headers, draft, {
      personal: {
        firstName: "Amina",
        lastName: "Bello",
        title: "OTHER",
        gender: "FEMALE",
        dateOfBirth: "1990-04-12",
        maritalStatus: "SINGLE_PARENT",
        nationality: "Nigerian",
        occupation: "Teacher",
      },
    });
    expect(res.statusCode).toBe(200);
    draft = res.json<Application>();
    expect(draft.personal).toMatchObject({ firstName: "Amina", middleName: null, title: "OTHER" });
    // "Other" needs saying what the title is.
    expect(draft.missing.personal).toEqual(["titleOther"]);
    expect(draft.version).toBe(2);

    const stale = await save(headers, { ...draft, version: 1 }, { personal: { titleOther: "Dr" } });
    expect(stale.statusCode).toBe(412);

    draft = (
      await save(headers, draft, {
        personal: { titleOther: "Evangelist", middleName: "" },
        contact: { email: "amina.correspondence@gmail.com", phoneWhatsapp: "+234 803 123 4567" },
        feedback: { heardVia: ["FRIEND", "OTHER"] },
      })
    ).json<Application>();
    expect(draft.missing.personal).toEqual([]);
    expect(draft.missing.contact).toEqual([]);
    expect(draft.missing.feedback).toEqual(["heardViaOther"]);

    const resumed = await t.request({ url: `/api/v1/applications/${draft.id}`, headers });
    expect(resumed.json()).toMatchObject({
      contact: { email: "amina.correspondence@gmail.com" },
      feedback: { heardVia: ["FRIEND", "OTHER"] },
      version: draft.version,
    });
  });

  it("records the declaration and consent with the server's time and the texts shown", async () => {
    draft = (
      await save(headers, draft, {
        declaration: { fullName: "Amina Bello", statementOfFaithRead: true, declared: true },
        consent: { consented: true },
      })
    ).json<Application>();
    expect(draft.declaration).toMatchObject({
      fullName: "Amina Bello",
      statementOfFaithRead: true,
      declaredAt: t.clock.now().toISOString(),
    });
    expect(draft.consent.consentedAt).toBe(t.clock.now().toISOString());
    expect(draft.texts.declarationText).toMatch(/true and complete/);
    expect(draft.missing.declaration).toEqual([]);
    expect(draft.missing.consent).toEqual([]);
  });

  it("refuses applicants under 18 when the Academic Session starts", async () => {
    // 18 on 2 September 2027: one day too young for a session starting on 1 September.
    const young = await save(headers, draft, { personal: { dateOfBirth: "2009-09-02" } });
    expect(young.statusCode).toBe(422);
    expect(young.json()).toMatchObject({ error: { code: "APPLICANT_UNDER_AGE" } });
    const current = await t.request({ url: `/api/v1/applications/${draft.id}`, headers });
    expect(current.json<Application>().personal.dateOfBirth).toBe("1990-04-12");

    const justEighteen = await save(headers, draft, { personal: { dateOfBirth: "2009-09-01" } });
    expect(justEighteen.statusCode).toBe(200);
    draft = justEighteen.json<Application>();
  });

  it("keeps spiritual-background answers out of logs, audit and the status history (INV-15)", async () => {
    const secret = "SECRET-TESTIMONY-7f3a";
    const saved = await save(headers, draft, {
      spiritual: {
        bornAgain: true,
        bornAgainWhen: secret,
        waterBaptism: `Yes, ${secret}`,
        holySpiritBaptism: false,
      },
    });
    expect(saved.statusCode).toBe(200);
    draft = saved.json<Application>();
    // The applicant sees their own answers back while editing.
    expect(draft.spiritual).toMatchObject({ bornAgain: true, bornAgainWhen: secret });
    expect(draft.missing.spiritual).toEqual([]);
    // A rejected save must not echo them either.
    await save(headers, { ...draft, version: 1 }, { spiritual: { bornAgainWhen: secret } });

    const { rows: audit } = await t.db.pool.query<{ row: string }>(
      "SELECT row_to_json(a)::text AS row FROM audit_logs a",
    );
    const { rows: events } = await t.db.pool.query<{ row: string }>(
      "SELECT row_to_json(e)::text AS row FROM application_events e",
    );
    expect(events.length).toBeGreaterThan(0);
    for (const { row } of [...audit, ...events]) expect(row).not.toContain(secret);
    expect(t.logs.length).toBeGreaterThan(0);
    expect(t.logs.filter((line) => line.includes(secret))).toEqual([]);
  });

  it("is the applicant's own: anyone else gets a 404", async () => {
    const other = await applicant({ sub: "google-other", email: "other.applicant@gmail.com" });
    for (const headers of [other, p.admOfficer.headers, p.sysAdmin.headers]) {
      expect(
        (await t.request({ url: `/api/v1/applications/${draft.id}`, headers })).statusCode,
      ).toBe(404);
      expect((await save(headers, draft, { personal: { firstName: "X" } })).statusCode).toBe(404);
    }
  });
});
