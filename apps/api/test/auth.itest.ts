import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSystemAdmin } from "../src/bin/bootstrap";
import { createTestApp, type TestApp } from "./harness";

let t: TestApp;
const ADMIN = { email: "admin@glim.edu.ng", displayName: "Grace Admin" };
const GOOD_PASSWORD = "correct horse battery staple 7";

function tokenFrom(text: string, path: "invite" | "reset"): string {
  const match = new RegExp(`/${path}/([A-Za-z0-9_-]+)`).exec(text);
  if (!match?.[1]) throw new Error(`No ${path} link in email:\n${text}`);
  return match[1];
}

function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const all = (Array.isArray(raw) ? raw : [raw]).filter((c): c is string => typeof c === "string");
  const cookie = all.find((c) => c.startsWith("__Host-glim_sid="));
  if (cookie === undefined) throw new Error("No session cookie set");
  return cookie.split(";")[0] ?? "";
}

async function acceptAdminInvite(): Promise<{ cookie: string; csrf: string }> {
  const token = tokenFrom(t.mailer.lastTo(ADMIN.email)?.text ?? "", "invite");
  const res = await t.request({
    method: "POST",
    url: "/api/v1/auth/invite/accept",
    payload: { token, password: GOOD_PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return { cookie: sessionCookie(res), csrf: res.json<{ csrfToken: string }>().csrfToken };
}

async function login(password = GOOD_PASSWORD, email = ADMIN.email) {
  return t.request({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
}

beforeAll(async () => {
  t = await createTestApp();
  await bootstrapSystemAdmin(t.app, ADMIN);
});

afterAll(async () => {
  await t.close();
});

beforeEach(() => {
  t.clock.advance({ hours: 1 });
});

describe("bootstrap and invite", () => {
  it("invites the first System Admin by email and refuses to bootstrap a second one", async () => {
    const mail = t.mailer.lastTo(ADMIN.email);
    expect(mail?.subject).toContain("GLIM");
    expect(mail?.text).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}/);
    await expect(
      bootstrapSystemAdmin(t.app, { email: "second@glim.edu.ng", displayName: "Second" }),
    ).rejects.toThrow(/already has a System Admin/);
  });

  it("refuses short and breached passwords when accepting the invite", async () => {
    const token = tokenFrom(t.mailer.lastTo(ADMIN.email)?.text ?? "", "invite");
    for (const [password, code] of [
      ["short", "password_too_short"],
      ["Password1234", "password_breached"],
    ] as const) {
      const res = await t.request({
        method: "POST",
        url: "/api/v1/auth/invite/accept",
        payload: { token, password },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: { code: "VALIDATION_FAILED", fieldErrors: [{ path: "body.password", code }] },
      });
    }
  });

  it("signs the admin in on acceptance and shows them as System Admin; the link then stops working", async () => {
    const token = tokenFrom(t.mailer.lastTo(ADMIN.email)?.text ?? "", "invite");
    const { cookie } = await acceptAdminInvite();
    const me = await t.request({ url: "/api/v1/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email: ADMIN.email, displayName: ADMIN.displayName, timezone: "Africa/Lagos" },
      institution: { name: "GLIM Online Bible College", timezone: "Africa/Lagos" },
      roles: { staff: ["SYSTEM_ADMIN"], isLecturer: false, isStudent: false, isApplicant: false },
    });

    const reuse = await t.request({
      method: "POST",
      url: "/api/v1/auth/invite/accept",
      payload: { token, password: GOOD_PASSWORD },
    });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json()).toMatchObject({
      error: { fieldErrors: [{ path: "body.token", code: "token_invalid" }] },
    });
  });
});

describe("sign-in, sessions and sign-out", () => {
  it("sets an HttpOnly, Secure, SameSite=Lax __Host- cookie and rotates it on every sign-in", async () => {
    const first = await login();
    expect(first.statusCode).toBe(200);
    const header = (first.headers["set-cookie"] as string[] | string).toString();
    expect(header).toMatch(
      /__Host-glim_sid=[^;]+; Max-Age=43200; Path=\/; HttpOnly; Secure; SameSite=Lax/,
    );

    const firstCookie = sessionCookie(first);
    const second = await t.request({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { cookie: firstCookie },
      payload: { email: ADMIN.email, password: GOOD_PASSWORD },
    });
    expect(sessionCookie(second)).not.toBe(firstCookie);
    expect(
      (await t.request({ url: "/api/v1/me", headers: { cookie: firstCookie } })).statusCode,
    ).toBe(401);
  });

  it("rejects /me without a session", async () => {
    const res = await t.request({ url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("requires the CSRF header to sign out, then ends the session", async () => {
    const res = await login();
    const cookie = sessionCookie(res);
    const csrf = res.json<{ csrfToken: string }>().csrfToken;

    const noCsrf = await t.request({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });

    const out = await t.request({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie, "x-csrf-token": csrf },
    });
    expect(out.statusCode).toBe(204);
    expect((await t.request({ url: "/api/v1/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("refuses cross-site writes by Origin and Sec-Fetch-Site", async () => {
    const evil = await t.request({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { email: ADMIN.email, password: GOOD_PASSWORD },
    });
    expect(evil.statusCode).toBe(403);
    expect(evil.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });
    const crossSite = await t.request({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "sec-fetch-site": "cross-site" },
      payload: { email: ADMIN.email, password: GOOD_PASSWORD },
    });
    expect(crossSite.statusCode).toBe(403);
    const sameOrigin = await t.request({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
      payload: { email: ADMIN.email, password: GOOD_PASSWORD },
    });
    expect(sameOrigin.statusCode).toBe(200);
  });

  it("expires a session after 2 hours idle, and after 12 hours however active", async () => {
    const cookie = sessionCookie(await login());
    t.clock.advance({ hours: 1, minutes: 59 });
    expect((await t.request({ url: "/api/v1/me", headers: { cookie } })).statusCode).toBe(200);
    t.clock.advance({ hours: 2, seconds: 1 });
    expect((await t.request({ url: "/api/v1/me", headers: { cookie } })).statusCode).toBe(401);

    const busy = sessionCookie(await login());
    for (let hour = 0; hour < 11; hour++) {
      t.clock.advance({ hours: 1, minutes: 5 });
      expect((await t.request({ url: "/api/v1/me", headers: { cookie: busy } })).statusCode).toBe(
        200,
      );
    }
    t.clock.advance({ hours: 1 });
    expect((await t.request({ url: "/api/v1/me", headers: { cookie: busy } })).statusCode).toBe(
      401,
    );
  });
});

describe("lockout", () => {
  it("answers unknown emails and wrong passwords identically", async () => {
    const unknown = await login(GOOD_PASSWORD, "nobody@glim.edu.ng");
    const wrong = await login("wrong password!!");
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    const { requestId: _a, ...unknownError } = unknown.json<{ error: Record<string, string> }>()
      .error;
    const { requestId: _b, ...wrongError } = wrong.json<{ error: Record<string, string> }>().error;
    expect(unknownError).toEqual(wrongError);
    expect((await login()).statusCode).toBe(200); // a success clears the failure count
  });

  it("locks the account for 15 minutes after 5 failures", async () => {
    for (let i = 0; i < 5; i++) expect((await login("wrong password!!")).statusCode).toBe(401);
    const locked = await login();
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: { code: "ACCOUNT_LOCKED" } });
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);

    t.clock.advance({ minutes: 15, seconds: 1 });
    expect((await login()).statusCode).toBe(200);
  });
});

describe("password reset", () => {
  it("always accepts a reset request, but emails only real accounts", async () => {
    t.mailer.clear();
    const unknown = await t.request({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "nobody@glim.edu.ng" },
    });
    expect(unknown.statusCode).toBe(202);
    expect(t.mailer.sent).toHaveLength(0);
  });

  it("resets the password once, revokes existing sessions, and expires after 30 minutes", async () => {
    const before = sessionCookie(await login());
    await t.request({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: ADMIN.email },
    });
    const token = tokenFrom(t.mailer.lastTo(ADMIN.email)?.text ?? "", "reset");
    const newPassword = "a much better passphrase 2026";

    const reset = await t.request({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, password: newPassword },
    });
    expect(reset.statusCode).toBe(204);
    expect((await t.request({ url: "/api/v1/me", headers: { cookie: before } })).statusCode).toBe(
      401,
    );
    expect((await login()).statusCode).toBe(401);
    expect((await login(newPassword)).statusCode).toBe(200);

    const again = await t.request({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, password: GOOD_PASSWORD },
    });
    expect(again.statusCode).toBe(400);

    await t.request({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: ADMIN.email },
    });
    const late = tokenFrom(t.mailer.lastTo(ADMIN.email)?.text ?? "", "reset");
    t.clock.advance({ minutes: 31 });
    const expired = await t.request({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token: late, password: GOOD_PASSWORD },
    });
    expect(expired.statusCode).toBe(400);
  });
});

describe("rate limiting (§5.4)", () => {
  it("allows 10 auth requests a minute per client IP, then answers RATE_LIMITED", async () => {
    const attempt = (remoteAddress: string) =>
      t.request({
        method: "POST",
        url: "/api/v1/auth/password/forgot",
        remoteAddress,
        payload: { email: "nobody@glim.edu.ng" },
      });
    for (let i = 0; i < 10; i++) expect((await attempt("192.0.2.10")).statusCode).toBe(202);
    const limited = await attempt("192.0.2.10");
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect((await attempt("192.0.2.11")).statusCode).toBe(202);
  });
});
