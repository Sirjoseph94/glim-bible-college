import type {
  AcademicSession,
  Application,
  ApplicationQueueItem,
  Intake,
  Programme,
  ReviewedApplication,
} from "@glim/contracts";
import { FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applicantKit, idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type Personas } from "./personas";

let issuer: FakeOidcIssuer;
let t: TestApp;
let p: Personas;
let certificate: Programme;
let diploma: Programme;
let kit: ReturnType<typeof applicantKit>;

const SECRET = "SENSITIVE-TESTIMONY-4b7e";

/** Submitted applications by name, set up once for the whole file. */
const submitted: Record<string, { headers: Record<string, string>; application: Application }> = {};

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
  kit = applicantKit(t, issuer, () => certificate.id);
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
  const intake = (
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
  await t.request({
    method: "POST",
    url: `/api/v1/intakes/${intake.id}/open`,
    headers: p.admOfficer.headers,
  });
  // Someone with a personal referral code (codes themselves arrive with ticket 18).
  await t.db.pool.query("UPDATE users SET referral_code = 'ABCD234' WHERE id = $1", [
    p.registrar.userId,
  ]);

  const submitAs = async (name: string, change?: object, spiritual?: object) => {
    const ready = await kit.complete(name, spiritual === undefined ? undefined : { spiritual });
    const application =
      change === undefined
        ? ready.application
        : (await kit.save(ready.headers, ready.application, change)).json<Application>();
    const res = await kit.submit(ready.headers, application.id);
    expect(res.statusCode).toBe(200);
    submitted[name] = { headers: ready.headers, application: res.json<Application>() };
    t.clock.advance({ minutes: 1 });
  };
  await submitAs("Ada", undefined, { bornAgainWhen: SECRET });
  await submitAs("Bola", { studyMode: "ON_CAMPUS", programmeId: diploma.id });
  await submitAs("Chidi", { feedback: { heardVia: ["STAFF"], referralCode: "abcd234" } });
  await submitAs("Dayo", { feedback: { heardVia: ["FRIEND"], referralCode: "ZZZZ999" } });
  // A draft that was never submitted stays private to its applicant.
  const drafter = await kit.signUp({ sub: "google-drafter", email: "drafter@gmail.com" });
  submitted.draft = {
    headers: drafter,
    application: (await kit.start(drafter)).json<Application>(),
  };
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

const officer = () => p.admOfficer.headers;
const idOf = (name: string) => submitted[name]?.application.id ?? "";

async function queue(query = "") {
  const res = await t.request({
    url: `/api/v1/admissions/applications${query}`,
    headers: officer(),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ items: ApplicationQueueItem[]; nextCursor: string | null }>();
}

const post = (url: string, payload?: unknown, headers = officer()) =>
  t.request({ method: "POST", url, headers, payload });

describe("the officers' queue", () => {
  it("lists submitted applications oldest first, never drafts or sensitive answers", async () => {
    const page = await queue();
    expect(page.items.map((i) => i.name)).toEqual([
      "Ada Okafor",
      "Bola Okafor",
      "Chidi Okafor",
      "Dayo Okafor",
    ]);
    expect(page.items[0]).toMatchObject({
      referenceNo: "GLIM-APP-2027-00001",
      status: "SUBMITTED",
      programme: { code: "CERT" },
      studyMode: "ONLINE",
    });
    expect(JSON.stringify(page)).not.toContain(SECRET);
    expect(JSON.stringify(page)).not.toMatch(/spiritual/i);
  });

  it("filters by programme, study mode and status, searches by name or reference, and pages", async () => {
    expect((await queue(`?programmeId=${diploma.id}`)).items.map((i) => i.name)).toEqual([
      "Bola Okafor",
    ]);
    expect((await queue("?studyMode=ON_CAMPUS")).items.map((i) => i.name)).toEqual(["Bola Okafor"]);
    expect((await queue("?q=chidi")).items.map((i) => i.name)).toEqual(["Chidi Okafor"]);
    expect((await queue("?q=APP-2027-00004")).items.map((i) => i.name)).toEqual(["Dayo Okafor"]);
    expect((await queue("?status=UNDER_REVIEW")).items).toEqual([]);
    const first = await queue("?limit=3");
    expect(first.items).toHaveLength(3);
    const rest = await queue(`?limit=3&cursor=${first.nextCursor ?? ""}`);
    expect(rest.items.map((i) => i.name)).toEqual(["Dayo Okafor"]);
    expect(rest.nextCursor).toBeNull();
  });

  it("flags a referral code that matched nobody, and credits one that did", async () => {
    const items = (await queue()).items;
    expect(items.find((i) => i.name === "Dayo Okafor")?.unmatchedReferral).toBe(true);
    expect(items.find((i) => i.name === "Chidi Okafor")?.unmatchedReferral).toBe(false);
    const chidi = await t.request({
      url: `/api/v1/admissions/applications/${idOf("Chidi")}`,
      headers: officer(),
    });
    expect(chidi.json<ReviewedApplication>().referral).toEqual({
      code: "abcd234",
      matched: true,
      referrerName: "registrar",
    });
  });
});

describe("reviewing an application", () => {
  it("shows staff every section, including spiritual background; drafts stay private", async () => {
    for (const headers of [officer(), p.sysAdmin.headers]) {
      const res = await t.request({
        url: `/api/v1/admissions/applications/${idOf("Ada")}`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<ReviewedApplication>().spiritual?.bornAgainWhen).toBe(SECRET);
    }
    const draft = await t.request({
      url: `/api/v1/admissions/applications/${idOf("draft")}`,
      headers: officer(),
    });
    expect(draft.statusCode).toBe(404);
  });

  it("marks it Under Review when opened, and keeps internal notes from the applicant", async () => {
    const opened = await post(`/api/v1/admissions/applications/${idOf("Ada")}/review`);
    expect(opened.statusCode).toBe(200);
    expect(opened.json<ReviewedApplication>()).toMatchObject({
      status: "UNDER_REVIEW",
      review: { by: "admofficer" },
    });
    // Opening again changes nothing.
    const again = await post(`/api/v1/admissions/applications/${idOf("Ada")}/review`);
    expect(again.json<ReviewedApplication>().timeline.map((e) => e.status)).toEqual([
      "DRAFT",
      "SUBMITTED",
      "UNDER_REVIEW",
    ]);

    const noted = await post(`/api/v1/admissions/applications/${idOf("Ada")}/notes`, {
      note: "Interviewed by phone: clear calling",
    });
    expect(noted.json<ReviewedApplication>().notes).toEqual([
      expect.objectContaining({ note: "Interviewed by phone: clear calling", by: "admofficer" }),
    ]);
    const own = await t.request({
      url: `/api/v1/applications/${idOf("Ada")}`,
      headers: submitted.Ada?.headers ?? {},
    });
    expect(own.json<Application>().status).toBe("UNDER_REVIEW");
    expect(own.body).not.toContain("Interviewed by phone");
  });
});

describe("deciding", () => {
  it("needs the application opened for review first", async () => {
    const res = await post(
      `/api/v1/admissions/applications/${idOf("Dayo")}/decide`,
      { decision: "ADMIT" },
      { ...officer(), "idempotency-key": idempotencyKey() },
    );
    expect(res.statusCode).toBe(409);
  });

  it("admits with an offer that expires after the intake's acceptance days, emailing the applicant", async () => {
    const key = idempotencyKey();
    const decide = () =>
      post(
        `/api/v1/admissions/applications/${idOf("Ada")}/decide`,
        { decision: "ADMIT", note: "Strong pastor's reference" },
        { ...officer(), "idempotency-key": key },
      );
    const res = await decide();
    expect(res.statusCode).toBe(200);
    const admitted = res.json<ReviewedApplication>();
    expect(admitted.status).toBe("ADMITTED");
    expect(admitted.decision.offerExpiresAt).toBe(
      new Date(t.clock.now().getTime() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(admitted.decision).toMatchObject({
      note: "Strong pastor's reference",
      by: "admofficer",
    });
    expect((await decide()).json()).toEqual(admitted);
    const twice = await post(
      `/api/v1/admissions/applications/${idOf("Ada")}/decide`,
      { decision: "REJECT" },
      { ...officer(), "idempotency-key": idempotencyKey() },
    );
    expect(twice.statusCode).toBe(409);

    await kit.sendQueuedEmails();
    // Queued emails may go out in any order; find the offer among Ada's.
    const offer = t.mailer.sent.find(
      (m) => m.to === "ada.mail@gmail.com" && m.subject.startsWith("Your offer"),
    );
    expect(offer?.text).toContain("Please accept your offer by");
    expect(JSON.stringify(offer)).not.toContain("Strong pastor's reference");
  });

  it("rejects with neutral wording, never sending the internal note, and schedules the purge", async () => {
    await post(`/api/v1/admissions/applications/${idOf("Bola")}/review`);
    const res = await post(
      `/api/v1/admissions/applications/${idOf("Bola")}/decide`,
      { decision: "REJECT", note: "Church reference could not be verified" },
      { ...officer(), "idempotency-key": idempotencyKey() },
    );
    expect(res.json<ReviewedApplication>().status).toBe("REJECTED");
    const { rows } = await t.db.pool.query<{ months: number }>(
      "SELECT (EXTRACT(year FROM age(purge_after, decided_at)) * 12 + EXTRACT(month FROM age(purge_after, decided_at)))::int AS months FROM applications WHERE id = $1",
      [idOf("Bola")],
    );
    expect(rows[0]?.months).toBe(12);

    await kit.sendQueuedEmails();
    const letter = t.mailer.sent.find(
      (m) => m.to === "bola.mail@gmail.com" && m.subject.startsWith("Your application to"),
    );
    expect(letter?.text).toContain("unable to offer you a place");
    expect(JSON.stringify(letter)).not.toContain("could not be verified");
    const status = await t.request({
      url: `/api/v1/applications/${idOf("Bola")}`,
      headers: submitted.Bola?.headers ?? {},
    });
    expect(status.body).not.toContain("could not be verified");
  });

  it("never puts spiritual-background answers in notifications, audit or logs (INV-15)", async () => {
    const { rows } = await t.db.pool.query<{ row: string }>(
      "SELECT row_to_json(n)::text AS row FROM notifications n UNION ALL SELECT row_to_json(a)::text FROM audit_logs a UNION ALL SELECT row_to_json(e)::text FROM application_events e",
    );
    for (const { row } of rows) expect(row).not.toContain(SECRET);
    expect(t.logs.filter((line) => line.includes(SECRET))).toEqual([]);
    for (const mail of t.mailer.sent) expect(JSON.stringify(mail)).not.toContain(SECRET);
  });
});
