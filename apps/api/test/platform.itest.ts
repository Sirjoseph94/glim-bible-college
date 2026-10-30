import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENDPOINTS } from "@glim/contracts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createTestApp, type TestApp } from "./harness";

let t: TestApp;
const staticDir = mkdtempSync(join(tmpdir(), "glim-static-"));

beforeAll(async () => {
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>GLIM</title>");
  writeFileSync(join(staticDir, "app.abc123.js"), "console.log('app')");
  writeFileSync(join(staticDir, "privacy.html"), "<!doctype html><h1>Privacy policy</h1>");
  writeFileSync(join(staticDir, "terms.html"), "<!doctype html><h1>Terms of service</h1>");
  writeFileSync(join(staticDir, "contact.html"), "<!doctype html><h1>Contact us</h1>");
  t = await createTestApp({ staticDir });
});

afterAll(async () => {
  await t.close();
});

describe("public institution", () => {
  it("returns the institution name and timezone read from Postgres", async () => {
    const res = await t.request({ url: "/api/v1/public/institution" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: "GLIM Online Bible College",
      timezone: "Africa/Lagos",
      googleSignIn: false,
    });
  });
});

describe("errors and request ids", () => {
  it("answers unknown API routes with the error envelope and the request id", async () => {
    const res = await t.request({
      url: "/api/v1/nope",
      headers: { "x-request-id": "req-abc-123" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-request-id"]).toBe("req-abc-123");
    expect(res.json()).toMatchObject({ error: { code: "NOT_FOUND", requestId: "req-abc-123" } });
  });

  it("generates a request id when the caller sends none or an unsafe one", async () => {
    const res = await t.request({
      url: "/api/v1/public/institution",
      headers: { "x-request-id": "bad id\n" },
    });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("health", () => {
  it("reports liveness and readiness of the database and pg-boss", async () => {
    expect((await t.request({ url: "/healthz" })).json()).toEqual({ status: "ok" });
    const ready = await t.request({ url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ok", checks: { database: "ok", queue: "ok" } });
  });
});

describe("security headers", () => {
  it("sends the CSP and headers from TRD §19.1", async () => {
    const res = await t.request({ url: "/api/v1/public/institution" });
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-src https://www.youtube-nocookie.com");
    expect(csp).toContain("script-src 'self' https://www.youtube.com");
    // Files load and upload through presigned URLs on the bucket's server.
    const bucket = new URL(inject("glim").s3.endpoint).origin;
    expect(csp).toContain(`img-src 'self' data: blob: https://i.ytimg.com ${bucket}`);
    expect(csp).toContain(`connect-src 'self' ${bucket}`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toContain("max-age=");
  });
});

describe("single origin: SPA and API", () => {
  it("serves the SPA at / and falls back to index.html for client routes", async () => {
    const root = await t.request({ url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("<title>GLIM</title>");

    const deep = await t.request({ url: "/registration", headers: { accept: "text/html" } });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("<title>GLIM</title>");
    expect(deep.headers["cache-control"]).toBe("no-cache");
  });

  it("serves the prerendered privacy policy, terms and contact page to any client, not only browsers", async () => {
    for (const [url, heading] of [
      ["/privacy", "Privacy policy"],
      ["/terms", "Terms of service"],
      ["/contact", "Contact us"],
    ] as const) {
      // No Accept header, as a crawler or Google's OAuth review may send.
      const res = await t.request({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.body).toContain(`<h1>${heading}</h1>`);
    }
    // Other client routes still need a browser's Accept header.
    const other = await t.request({ url: "/registration" });
    expect(other.statusCode).toBe(404);
  });

  it("serves hashed assets as immutable", async () => {
    const res = await t.request({ url: "/app.abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });
});

describe("OpenAPI", () => {
  it("documents every endpoint in the contracts, and each one is routed", async () => {
    const res = await t.request({ url: "/api/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ openapi: string; paths: Record<string, Record<string, unknown>> }>();
    expect(doc.openapi).toBe("3.1.0");
    for (const e of ENDPOINTS) {
      const path = e.path.replaceAll(/:(\w+)/g, "{$1}");
      expect(
        doc.paths[`/api/v1${path}`]?.[e.method.toLowerCase()],
        `${e.method} ${e.path}`,
      ).toBeDefined();
      const routed = t.app
        .getHttpAdapter()
        .getInstance()
        .hasRoute({ method: e.method, url: `/api/v1${e.path}` });
      expect(routed, `${e.method} ${e.path} is routed`).toBe(true);
    }
  });
});
