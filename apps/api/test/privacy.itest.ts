import type { Application, DataExport } from "@glim/contracts";
import { FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admissionsWorld } from "./admissions-world";
import { applicantKit, idempotencyKey } from "./applicants";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, type PersonaName, type Personas } from "./personas";

/** Data subject requests (TRD §19.4): export everything held about you; erasure by the System Admin. */

let issuer: FakeOidcIssuer;
let t: TestApp;
let p: Personas;
let kit: ReturnType<typeof applicantKit>;
let headers: Record<string, string>;
let application: Application;
let userId = "";

const q = <R extends object>(text: string, values: unknown[] = []) =>
  t.db.pool.query<R>(text, values);

const erase = (as: PersonaName, id: string, reason = "Asked to be forgotten") =>
  t.request({
    method: "POST",
    url: `/api/v1/users/${id}/erase`,
    headers: p[as].headers,
    payload: { reason },
  });

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
  await admissionsWorld(t, p);
  kit = applicantKit(t, issuer);
  // An applicant admitted and accepted: an application with sensitive answers, and a student.
  const ready = await kit.complete("Chiamaka", { spiritual: { bornAgainWhen: "SECRET-WHEN" } });
  headers = ready.headers;
  application = ready.application;
  expect((await kit.submit(headers, application.id)).statusCode).toBe(200);
  await kit.admit(application.id, p.admOfficer.headers);
  const accepted = await t.request({
    method: "POST",
    url: `/api/v1/applications/${application.id}/accept`,
    headers: { ...headers, "idempotency-key": idempotencyKey() },
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  const { rows } = await q<{ applicant_user_id: string }>(
    "SELECT applicant_user_id FROM applications WHERE id = $1",
    [application.id],
  );
  userId = rows[0]?.applicant_user_id ?? "";
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

describe("data export", () => {
  it("gives a person everything held about them, without secrets or anyone else's data", async () => {
    const res = await t.request({ url: "/api/v1/me/data-export", headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="glim-my-data.json"');
    expect(res.headers["cache-control"]).toBe("no-store");
    const data = res.json<DataExport>();
    expect(data.userId).toBe(userId);
    const s = data.sections as Record<string, unknown[] | Record<string, unknown>>;
    expect(Object.keys(s)).toEqual(
      expect.arrayContaining([
        "account",
        "signInMethods",
        "sessions",
        "applications",
        "student",
        "programmeEnrollments",
        "notifications",
      ]),
    );
    expect(s.signInMethods).toEqual([expect.objectContaining({ provider: "google" })]);
    // Their own application, with their own answers.
    expect(res.body).toContain("SECRET-WHEN");
    expect(res.body).toContain("GLIM/DIP/");
    for (const secret of ["passwordHash", "tokenHash", "csrfSecret", "storageKey"])
      expect(res.body).not.toContain(secret);
    expect(res.body).not.toContain(p.sEnrolled.email);
  });
});

describe("erasure", () => {
  it("is for the System Admin, never of themselves or of someone holding a staff role", async () => {
    expect((await erase("acadAdmin", userId)).statusCode).toBe(403);
    expect((await erase("sysAdmin", p.sysAdmin.userId)).statusCode).toBe(409);
    expect((await erase("sysAdmin", p.registrar.userId)).statusCode).toBe(409);
    expect((await erase("sysAdmin", "01900000-0000-7000-8000-000000000000")).statusCode).toBe(404);
  });

  it("removes and anonymises personal data but keeps the academic record", async () => {
    const before = await q<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]);
    const email = before.rows[0]?.email ?? "";
    const photo = await q<{ photo_file_id: string }>(
      "SELECT photo_file_id FROM students WHERE user_id = $1",
      [userId],
    );
    const res = await erase("sysAdmin", userId);
    expect(res.statusCode, res.body).toBe(200);
    const { pseudonym } = res.json<{ pseudonym: string }>();
    expect(pseudonym).toMatch(/^Erased [0-9a-f]{10}$/);

    const user = await q<Record<string, unknown>>(
      "SELECT email, display_name, status, password_hash, referral_code, timezone FROM users WHERE id = $1",
      [userId],
    );
    expect(user.rows[0]).toMatchObject({
      display_name: pseudonym,
      status: "DEACTIVATED",
      password_hash: null,
      referral_code: null,
      timezone: null,
    });
    expect(user.rows[0]?.email).toMatch(/@erased\.invalid$/);
    for (const table of ["identities", "auth_sessions", "auth_tokens", "notifications"])
      expect((await q(`SELECT 1 FROM ${table} WHERE user_id = $1`, [userId])).rowCount, table).toBe(
        0,
      );
    expect((await q("SELECT 1 FROM applications WHERE id = $1", [application.id])).rowCount).toBe(
      0,
    );
    // Nothing left that names them or holds their sensitive answers.
    expect((await q("SELECT 1 FROM users WHERE email = $1", [email])).rowCount).toBe(0);
    const anywhere = await q(
      "SELECT 1 FROM notifications WHERE data::text LIKE '%SECRET-WHEN%' UNION ALL SELECT 1 FROM applications WHERE spiritual_background::text LIKE '%SECRET-WHEN%'",
    );
    expect(anywhere.rowCount).toBe(0);
    const student = await q<Record<string, unknown>>(
      "SELECT given_name, family_name, date_of_birth, phone_whatsapp, photo_file_id FROM students WHERE user_id = $1",
      [userId],
    );
    expect(student.rows[0]).toMatchObject({
      given_name: "Erased",
      date_of_birth: null,
      phone_whatsapp: null,
      photo_file_id: null,
    });
    expect(
      (await q("SELECT 1 FROM files WHERE id = $1", [photo.rows[0]?.photo_file_id])).rowCount,
    ).toBe(0);
    // The academic record stays: the programme enrollment and its Matric Number.
    const enrollment = await q<{ matric_number: string; application_id: string | null }>(
      `SELECT pe.matric_number, pe.application_id FROM programme_enrollments pe
         JOIN students s ON s.id = pe.student_id WHERE s.user_id = $1`,
      [userId],
    );
    expect(enrollment.rows[0]?.matric_number).toMatch(/^GLIM\/DIP\//);
    expect(enrollment.rows[0]?.application_id).toBeNull();
    // Signed out everywhere.
    expect((await t.request({ url: "/api/v1/me/data-export", headers })).statusCode).toBe(401);
    // Audited without the personal details.
    const audit = await q<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE action = 'identity.user.erased' AND resource_id = $1",
      [userId],
    );
    expect(audit.rows[0]?.metadata).toEqual({
      pseudonym,
      reason: "Asked to be forgotten",
      applicationsDeleted: 1,
    });
    expect(JSON.stringify(audit.rows[0]?.metadata)).not.toContain(email);
    // Erasing again changes nothing.
    expect((await erase("sysAdmin", userId)).json()).toEqual({ pseudonym });
  });
});
