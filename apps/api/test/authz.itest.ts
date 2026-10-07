import { ENDPOINTS, type EndpointSpec } from "@glim/contracts";
import { AuthorizationService } from "@glim/modules/authorization";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";
import {
  createPersonas,
  createUser,
  PERSONA_ROLES,
  type Persona,
  type PersonaName,
} from "./personas";

/**
 * Deny-path tests generated from matrix.json (TRD §0.3, §7.5): every endpoint that declares a
 * permission, called by every persona and by nobody.
 */

interface SampleRequest {
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

type Sample = (t: TestApp) => Promise<SampleRequest>;

let n = 0;
/** A fresh user to act on, so allowed calls never interfere with each other. */
async function freshUser(t: TestApp, status: "ACTIVE" | "INVITED" = "ACTIVE") {
  n++;
  const user = await createUser(t, { email: `target${String(n)}@authz.glim.test` });
  if (status === "INVITED") {
    await t.db.pool.query("UPDATE users SET status = 'INVITED' WHERE id = $1", [user.id]);
  }
  return user;
}

/** One valid request per endpoint. A new protected endpoint must add its sample here. */
const SAMPLES: Record<string, Sample> = {
  "GET /users": () => Promise.resolve({ url: "/api/v1/users" }),
  "POST /users": () => {
    n++;
    return Promise.resolve({
      url: "/api/v1/users",
      payload: { email: `invitee${String(n)}@authz.glim.test`, displayName: "Invitee", roles: [] },
    });
  },
  "GET /users/:id": async (t) => ({ url: `/api/v1/users/${(await freshUser(t)).id}` }),
  "PATCH /users/:id": async (t) => ({
    url: `/api/v1/users/${(await freshUser(t)).id}`,
    payload: { displayName: "Renamed" },
    headers: { "if-match": '"1"' },
  }),
  "POST /users/:id/deactivate": async (t) => ({
    url: `/api/v1/users/${(await freshUser(t)).id}/deactivate`,
    payload: { reason: "Left the college" },
  }),
  "POST /users/:id/invite": async (t) => ({
    url: `/api/v1/users/${(await freshUser(t, "INVITED")).id}/invite`,
  }),
  "POST /users/:id/roles": async (t) => ({
    url: `/api/v1/users/${(await freshUser(t)).id}/roles`,
    payload: { role: "REGISTRAR", reason: "New registrar" },
  }),
  "DELETE /users/:id/roles/:assignmentId": async (t) => {
    const user = await freshUser(t);
    const { rows } = await t.db.pool.query<{ id: string }>(
      "INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, 'REGISTRAR', 'test') RETURNING id",
      [user.id],
    );
    return {
      url: `/api/v1/users/${user.id}/roles/${rows[0]?.id ?? ""}`,
      payload: { reason: "No longer needed" },
    };
  },
  "GET /audit-logs": () => Promise.resolve({ url: "/api/v1/audit-logs" }),
  "GET /settings": () => Promise.resolve({ url: "/api/v1/settings" }),
  // A stale If-Match keeps allowed callers from changing shared state; they get 412, not 403/404.
  "PATCH /settings": () =>
    Promise.resolve({
      url: "/api/v1/settings",
      payload: { name: "x" },
      headers: { "if-match": '"999"' },
    }),
  "GET /policies": () => Promise.resolve({ url: "/api/v1/policies" }),
  "GET /policies/:type": () => Promise.resolve({ url: "/api/v1/policies/NOTIFICATION" }),
  "PUT /policies/:type": () =>
    Promise.resolve({
      url: "/api/v1/policies/NOTIFICATION",
      payload: { config: {} },
      headers: { "if-match": '"999"' },
    }),
};

const key = (e: EndpointSpec) => `${e.method} ${e.path}`;
const protectedEndpoints = (ENDPOINTS as readonly EndpointSpec[]).filter(
  (e): e is EndpointSpec & { permission: NonNullable<EndpointSpec["permission"]> } =>
    e.permission !== undefined,
);

let t: TestApp;
let personas: Record<PersonaName, Persona>;

beforeAll(async () => {
  t = await createTestApp();
  personas = await createPersonas(t);
});

afterAll(async () => {
  await t.close();
});

it("has a sample request for every endpoint that declares a permission", () => {
  expect(protectedEndpoints.map(key).filter((k) => SAMPLES[k] === undefined)).toEqual([]);
});

describe.each(protectedEndpoints.map((e) => [key(e), e] as const))("%s", (_name, endpoint) => {
  it("refuses an unauthenticated caller with 401", async () => {
    const sample = await SAMPLES[key(endpoint)]?.(t);
    if (sample === undefined) return;
    const res = await t.request({
      method: endpoint.method,
      url: sample.url,
      payload: sample.payload,
      headers: sample.headers ?? {},
    });
    expect(res.statusCode).toBe(401);
  });

  it.each(Object.keys(PERSONA_ROLES) as PersonaName[])(
    "as %s: allowed exactly when matrix.json grants it",
    async (name) => {
      const sample = await SAMPLES[key(endpoint)]?.(t);
      if (sample === undefined) return;
      const persona = personas[name];
      const res = await t.request({
        method: endpoint.method,
        url: sample.url,
        payload: sample.payload,
        headers: { ...persona.headers, ...sample.headers },
      });
      const granted = AuthorizationService.staffGrants(persona.roles, endpoint.permission);
      if (granted) {
        expect([401, 403, 404], `${name} should be allowed: ${res.body}`).not.toContain(
          res.statusCode,
        );
      } else {
        // A resource the caller can't see is a 404, never a 403 (§7.2).
        expect(res.statusCode, res.body).toBe(endpoint.resource === undefined ? 403 : 404);
      }
    },
  );
});

describe("denied writes", () => {
  it("are audited, at most once a minute per user and permission (§7.2)", async () => {
    const attempt = () =>
      t.request({
        method: "POST",
        url: "/api/v1/users",
        headers: personas.registrar.headers,
        payload: { email: "nope@authz.glim.test", displayName: "Nope", roles: [] },
      });
    expect((await attempt()).statusCode).toBe(403);
    expect((await attempt()).statusCode).toBe(403);
    const log = await t.request({
      url: `/api/v1/audit-logs?actorUserId=${personas.registrar.userId}`,
      headers: personas.sysAdmin.headers,
    });
    const denied = log
      .json<{ items: { action: string; outcome: string; metadata: Record<string, unknown> }[] }>()
      .items.filter(
        (i) =>
          i.action === "authorization.denied" && i.metadata.permission === "identity:user:manage",
      );
    expect(denied).toEqual([
      expect.objectContaining({
        outcome: "DENIED",
        metadata: { permission: "identity:user:manage" },
      }),
    ]);
  });
});
