import type { AuditLogItem, UserDetail, UserListItem } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import { createPersonas, createUser, sessionFor, type Persona, type PersonaName } from "./personas";

let t: TestApp;
let p: Record<PersonaName, Persona>;
let admin: Record<string, string>;

beforeAll(async () => {
  t = await createTestApp();
  p = await createPersonas(t);
  admin = p.sysAdmin.headers;
});

afterAll(async () => {
  await t.close();
});

async function auditFor(resourceId: string): Promise<AuditLogItem[]> {
  const res = await t.request({
    url: `/api/v1/audit-logs?resourceType=user&resourceId=${resourceId}`,
    headers: admin,
  });
  return res.json<{ items: AuditLogItem[] }>().items;
}

async function getUser(id: string): Promise<UserDetail> {
  return (await t.request({ url: `/api/v1/users/${id}`, headers: admin })).json<UserDetail>();
}

describe("inviting staff", () => {
  it("creates the account with its roles, emails the invite, and audits both", async () => {
    const res = await t.request({
      method: "POST",
      url: "/api/v1/users",
      headers: admin,
      payload: {
        email: "ruth@glim.edu.ng",
        displayName: "Ruth Admissions",
        roles: ["ADMISSIONS_OFFICER"],
      },
    });
    expect(res.statusCode).toBe(201);
    const { user, emailSent } = res.json<{ user: UserDetail; emailSent: boolean }>();
    expect(emailSent).toBe(true);
    expect(user).toMatchObject({
      email: "ruth@glim.edu.ng",
      status: "INVITED",
      roles: [{ role: "ADMISSIONS_OFFICER" }],
    });
    expect(t.mailer.lastTo("ruth@glim.edu.ng")?.text).toMatch(/\/invite\//);

    const actions = (await auditFor(user.id)).map((a) => [a.action, a.actorUserId]);
    expect(actions).toEqual(
      expect.arrayContaining([
        ["identity.user.invited", p.sysAdmin.userId],
        ["authorization.role.granted", p.sysAdmin.userId],
      ]),
    );
  });

  it("refuses an email that already has an account", async () => {
    const res = await t.request({
      method: "POST",
      url: "/api/v1/users",
      headers: admin,
      payload: { email: "RUTH@glim.edu.ng", displayName: "Ruth again", roles: [] },
    });
    expect(res.statusCode).toBe(409);
  });

  it("re-sends an invite only to someone who hasn't accepted one", async () => {
    const list = await t.request({ url: "/api/v1/users?q=ruth", headers: admin });
    const ruth = list.json<{ items: UserListItem[] }>().items[0];
    const resend = await t.request({
      method: "POST",
      url: `/api/v1/users/${ruth?.id ?? ""}/invite`,
      headers: admin,
    });
    expect(resend.json()).toEqual({ emailSent: true });
    const active = await t.request({
      method: "POST",
      url: `/api/v1/users/${p.registrar.userId}/invite`,
      headers: admin,
    });
    expect(active.statusCode).toBe(409);
  });
});

describe("listing users", () => {
  it("filters by status and searches names and emails, a page at a time", async () => {
    for (let i = 1; i <= 3; i++)
      await createUser(t, {
        email: `page${String(i)}@list.glim.test`,
        displayName: `Paging ${String(i)}`,
      });

    const first = await t.request({ url: "/api/v1/users?q=paging&limit=2", headers: admin });
    const page1 = first.json<{ items: UserListItem[]; nextCursor: string | null }>();
    expect(page1.items.map((u) => u.email)).toEqual([
      "page1@list.glim.test",
      "page2@list.glim.test",
    ]);
    const second = await t.request({
      url: `/api/v1/users?q=paging&limit=2&cursor=${page1.nextCursor ?? ""}`,
      headers: admin,
    });
    expect(second.json<{ items: UserListItem[]; nextCursor: string | null }>()).toEqual({
      items: [
        expect.objectContaining({ email: "page3@list.glim.test", status: "ACTIVE", roles: [] }),
      ],
      nextCursor: null,
    });

    const invited = await t.request({ url: "/api/v1/users?status=INVITED", headers: admin });
    expect(
      invited.json<{ items: UserListItem[] }>().items.every((u) => u.status === "INVITED"),
    ).toBe(true);
  });

  it("treats an unknown or malformed user id as not found", async () => {
    expect(
      (
        await t.request({
          url: "/api/v1/users/0199b8a2-7c1e-7d3a-9f00-123456789abc",
          headers: admin,
        })
      ).statusCode,
    ).toBe(404);
    expect((await t.request({ url: "/api/v1/users/not-an-id", headers: admin })).statusCode).toBe(
      404,
    );
  });
});

describe("editing users", () => {
  it("renames a user under optimistic concurrency", async () => {
    const user = await createUser(t, { email: "rename@glim.test", displayName: "Old Name" });
    const missing = await t.request({
      method: "PATCH",
      url: `/api/v1/users/${user.id}`,
      headers: admin,
      payload: { displayName: "New" },
    });
    expect(missing.statusCode).toBe(400);

    const renamed = await t.request({
      method: "PATCH",
      url: `/api/v1/users/${user.id}`,
      headers: { ...admin, "if-match": '"1"' },
      payload: { displayName: "New Name" },
    });
    expect(renamed.json()).toMatchObject({ displayName: "New Name", version: 2 });

    const stale = await t.request({
      method: "PATCH",
      url: `/api/v1/users/${user.id}`,
      headers: { ...admin, "if-match": '"1"' },
      payload: { displayName: "Lost Update" },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ error: { code: "VERSION_MISMATCH" } });
  });

  it("ends a user's sessions when they're suspended, and lets them back in when reactivated", async () => {
    const user = await createUser(t, { email: "suspend@glim.test" });
    const theirs = await sessionFor(t, user.id);
    expect((await t.request({ url: "/api/v1/me", headers: theirs })).statusCode).toBe(200);

    const suspended = await t.request({
      method: "PATCH",
      url: `/api/v1/users/${user.id}`,
      headers: { ...admin, "if-match": '"1"' },
      payload: { status: "SUSPENDED", reason: "Investigation" },
    });
    expect(suspended.json()).toMatchObject({ status: "SUSPENDED" });
    expect((await t.request({ url: "/api/v1/me", headers: theirs })).statusCode).toBe(401);

    const back = await t.request({
      method: "PATCH",
      url: `/api/v1/users/${user.id}`,
      headers: { ...admin, "if-match": '"2"' },
      payload: { status: "ACTIVE" },
    });
    expect(back.json()).toMatchObject({ status: "ACTIVE" });
    expect(
      (await t.request({ url: "/api/v1/me", headers: await sessionFor(t, user.id) })).statusCode,
    ).toBe(200);
  });

  it("deactivates for good: sessions end, roles can't be added, and it's audited with the reason", async () => {
    const user = await createUser(t, { email: "leaver@glim.test", roles: ["REGISTRAR"] });
    const theirs = await sessionFor(t, user.id);
    const res = await t.request({
      method: "POST",
      url: `/api/v1/users/${user.id}/deactivate`,
      headers: admin,
      payload: { reason: "Left the college" },
    });
    expect(res.json()).toMatchObject({ status: "DEACTIVATED" });
    expect((await t.request({ url: "/api/v1/me", headers: theirs })).statusCode).toBe(401);

    const role = await t.request({
      method: "POST",
      url: `/api/v1/users/${user.id}/roles`,
      headers: admin,
      payload: { role: "ACADEMIC_ADMIN", reason: "Mistake" },
    });
    expect(role.statusCode).toBe(409);
    expect(await auditFor(user.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "identity.user.deactivated",
          metadata: { from: "ACTIVE", reason: "Left the college" },
        }),
      ]),
    );
  });
});

describe("roles", () => {
  it("grants and revokes roles with a reason, and the change applies to the user's next request", async () => {
    const user = await createUser(t, { email: "roles@glim.test" });
    const theirs = await sessionFor(t, user.id);
    expect((await t.request({ url: "/api/v1/users", headers: theirs })).statusCode).toBe(403);

    const granted = await t.request({
      method: "POST",
      url: `/api/v1/users/${user.id}/roles`,
      headers: admin,
      payload: { role: "ACADEMIC_ADMIN", reason: "New academic admin" },
    });
    expect(granted.statusCode).toBe(201);
    const assignment = granted.json<{ id: string; role: string }>();
    expect((await t.request({ url: "/api/v1/users", headers: theirs })).statusCode).toBe(200);

    const duplicate = await t.request({
      method: "POST",
      url: `/api/v1/users/${user.id}/roles`,
      headers: admin,
      payload: { role: "ACADEMIC_ADMIN", reason: "Again" },
    });
    expect(duplicate.statusCode).toBe(409);

    const revoked = await t.request({
      method: "DELETE",
      url: `/api/v1/users/${user.id}/roles/${assignment.id}`,
      headers: admin,
      payload: { reason: "Moved to lecturing" },
    });
    expect(revoked.statusCode).toBe(204);
    expect((await getUser(user.id)).roles).toEqual([]);
    expect(
      (await auditFor(user.id))
        .filter((a) => a.action.startsWith("authorization.role"))
        .map((a) => a.metadata),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "ACADEMIC_ADMIN", reason: "New academic admin" }),
        expect.objectContaining({ role: "ACADEMIC_ADMIN", reason: "Moved to lecturing" }),
      ]),
    );
  });

  it("never removes the last active System Admin", async () => {
    const me = await getUser(p.sysAdmin.userId);
    const adminRole = me.roles.find((r) => r.role === "SYSTEM_ADMIN");
    const revoke = await t.request({
      method: "DELETE",
      url: `/api/v1/users/${p.sysAdmin.userId}/roles/${adminRole?.id ?? ""}`,
      headers: admin,
      payload: { reason: "Trying to leave" },
    });
    expect(revoke.statusCode).toBe(409);
    const deactivate = await t.request({
      method: "POST",
      url: `/api/v1/users/${p.sysAdmin.userId}/deactivate`,
      headers: admin,
      payload: { reason: "Trying to leave" },
    });
    expect(deactivate.statusCode).toBe(409);

    const successor = await createUser(t, {
      email: "successor@glim.test",
      roles: ["SYSTEM_ADMIN"],
    });
    expect(successor.id).toBeDefined();
    const now = await t.request({
      method: "DELETE",
      url: `/api/v1/users/${p.sysAdmin.userId}/roles/${adminRole?.id ?? ""}`,
      headers: admin,
      payload: { reason: "Handed over" },
    });
    expect(now.statusCode).toBe(204);
  });
});
