import { FakeOidcIssuer, type FakeGoogleUser } from "@glim/integrations/oidc/fake-issuer";
import { OpenIdConnectProvider } from "@glim/integrations/oidc/openid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cookieValue, viaGoogle as viaFakeGoogle } from "./google-flow";
import { createTestApp, type TestApp } from "./harness";
import { createUser, sessionFor } from "./personas";

let issuer: FakeOidcIssuer;
let t: TestApp;

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
});

afterAll(async () => {
  await t.close();
  await issuer.stop();
});

beforeEach(async () => {
  await t.db.pool.query("UPDATE settings SET staff_email_domains = '{}'");
});

const viaGoogle = (user: FakeGoogleUser, options?: Parameters<typeof viaFakeGoogle>[3]) =>
  viaFakeGoogle(t, issuer, user, options);

async function meWith(sessionCookie: string | undefined) {
  return t.request({ url: "/api/v1/me", headers: { cookie: sessionCookie ?? "" } });
}

describe("signing in with Google", () => {
  it("signs in an existing user by verified email, links the identity, and matches by Google id afterwards", async () => {
    const staff = await createUser(t, { email: "grace@glim.edu.ng", roles: ["REGISTRAR"] });
    const first = await viaGoogle({
      sub: "google-grace",
      email: "grace@glim.edu.ng",
      name: "Grace O.",
      hd: "glim.edu.ng",
    });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe("/");
    const me = await meWith(cookieValue(first, "__Host-glim_sid"));
    expect(me.json()).toMatchObject({ user: { id: staff.id, googleLinked: true } });

    // A later sign-in matches on the Google id even if the Google email has changed.
    const again = await viaGoogle({
      sub: "google-grace",
      email: "grace.new@gmail.com",
      hd: "glim.edu.ng",
    });
    expect((await meWith(cookieValue(again, "__Host-glim_sid"))).json()).toMatchObject({
      user: { id: staff.id },
    });
  });

  it("refuses a Google account that matches nobody, without creating a session", async () => {
    const res = await viaGoogle({ sub: "google-stranger", email: "stranger@gmail.com" });
    expect(res.headers.location).toBe("/login?error=ACCOUNT_NOT_FOUND");
    expect(cookieValue(res, "__Host-glim_sid")).toBeUndefined();
  });

  it("requires Google to have verified the email", async () => {
    await createUser(t, { email: "unverified@glim.test" });
    const res = await viaGoogle({
      sub: "google-unverified",
      email: "unverified@glim.test",
      emailVerified: false,
    });
    expect(res.headers.location).toBe("/login?error=GOOGLE_EMAIL_UNVERIFIED");
  });

  it("restricts staff to the configured Google Workspace domains, but not other users", async () => {
    await t.db.pool.query("UPDATE settings SET staff_email_domains = '{glim.edu.ng}'");
    await createUser(t, { email: "ada@gmail.com", roles: ["ACADEMIC_ADMIN"] });
    const personal = await viaGoogle({ sub: "google-ada", email: "ada@gmail.com" });
    expect(personal.headers.location).toBe("/login?error=GOOGLE_DOMAIN_NOT_ALLOWED");

    await createUser(t, { email: "bola@glim.edu.ng", roles: ["ACADEMIC_ADMIN"] });
    const workspace = await viaGoogle({
      sub: "google-bola",
      email: "bola@glim.edu.ng",
      hd: "GLIM.edu.ng",
    });
    expect(workspace.headers.location).toBe("/");

    await createUser(t, { email: "student@gmail.com" });
    const nonStaff = await viaGoogle({ sub: "google-student", email: "student@gmail.com" });
    expect(nonStaff.headers.location).toBe("/");
  });

  it("activates an invited staff member, since Google verified the address the invite went to", async () => {
    const user = await createUser(t, { email: "invited@glim.edu.ng" });
    await t.db.pool.query("UPDATE users SET status = 'INVITED' WHERE id = $1", [user.id]);
    const res = await viaGoogle({ sub: "google-invited", email: "invited@glim.edu.ng" });
    expect(res.headers.location).toBe("/");
    expect((await meWith(cookieValue(res, "__Host-glim_sid"))).statusCode).toBe(200);
  });

  it("rejects a callback without the flow cookie this browser was given", async () => {
    await createUser(t, { email: "forged@glim.test" });
    issuer.nextSignIn({ sub: "google-forged", email: "forged@glim.test" });
    const start = await t.request({ url: "/api/v1/auth/google/start" });
    const atGoogle = await fetch(String(start.headers.location), { redirect: "manual" });
    const callback = new URL(atGoogle.headers.get("location") ?? "");
    const res = await t.request({
      url: `${callback.pathname}${callback.search}`,
      headers: { cookie: "__Host-glim_oidc=forged.value" },
    });
    expect(res.headers.location).toBe("/login?error=GOOGLE_SIGN_IN_FAILED");
  });

  it("only returns to paths on this site", async () => {
    await createUser(t, { email: "returner@glim.test" });
    const evil = await viaGoogle(
      { sub: "google-returner", email: "returner@glim.test" },
      { returnTo: "//evil.example/x" },
    );
    expect(evil.headers.location).toBe("/");
    const fine = await viaGoogle(
      { sub: "google-returner", email: "returner@glim.test" },
      { returnTo: "/courses" },
    );
    expect(fine.headers.location).toBe("/courses");
  });
});

describe("linking a Google account", () => {
  it("links Google to the signed-in user, audited", async () => {
    const user = await createUser(t, { email: "linker@glim.test" });
    const headers = await sessionFor(t, user.id);
    const res = await viaGoogle(
      { sub: "google-linker", email: "linker.personal@gmail.com", name: "Linker" },
      { intent: "link", headers },
    );
    expect(res.headers.location).toBe("/profile?linked=google");
    expect((await t.request({ url: "/api/v1/me", headers })).json()).toMatchObject({
      user: { googleLinked: true },
    });
    const admin = await createUser(t, { email: "auditor@glim.test", roles: ["SYSTEM_ADMIN"] });
    const log = await t.request({
      url: `/api/v1/audit-logs?resourceType=user&resourceId=${user.id}`,
      headers: await sessionFor(t, admin.id),
    });
    expect(log.json<{ items: { action: string }[] }>().items.map((i) => i.action)).toEqual([
      "identity.google.linked",
    ]);
  });

  it("won't link a Google account that belongs to someone else", async () => {
    const owner = await createUser(t, { email: "owner@glim.test" });
    await viaGoogle({ sub: "google-shared", email: "owner@glim.test" });
    const other = await createUser(t, { email: "other@glim.test" });
    const res = await viaGoogle(
      { sub: "google-shared", email: "owner@glim.test" },
      { intent: "link", headers: await sessionFor(t, other.id) },
    );
    expect(res.headers.location).toBe("/profile?error=GOOGLE_ALREADY_LINKED");
    expect(owner.id).not.toBe(other.id);
  });

  it("sends a signed-out link attempt to sign in first", async () => {
    const res = await t.request({ url: "/api/v1/auth/google/start?intent=link" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/login");
  });
});

describe("when Google sign-in isn't configured", () => {
  it("says so on the public institution endpoint, and the start endpoint sends users back to sign in", async () => {
    const plain = await createTestApp();
    try {
      expect((await plain.request({ url: "/api/v1/public/institution" })).json()).toMatchObject({
        googleSignIn: false,
      });
      const start = await plain.request({ url: "/api/v1/auth/google/start" });
      expect(start.headers.location).toBe("/login?error=GOOGLE_UNAVAILABLE");
    } finally {
      await plain.close();
    }
    expect((await t.request({ url: "/api/v1/public/institution" })).json()).toMatchObject({
      googleSignIn: true,
    });
  });
});
