import type { FakeGoogleUser, FakeOidcIssuer } from "@glim/integrations/oidc/fake-issuer";
import { expect } from "vitest";
import type { TestApp } from "./harness";

export function cookieValue(
  res: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const raw = res.headers["set-cookie"];
  const all = (Array.isArray(raw) ? raw : [raw]).filter((c): c is string => typeof c === "string");
  return all.find((c) => c.startsWith(`${name}=`))?.split(";")[0];
}

/** Drives the whole redirect dance: app → Google → app callback. Returns the callback response. */
export async function viaGoogle(
  t: TestApp,
  issuer: FakeOidcIssuer,
  user: FakeGoogleUser,
  options: {
    intent?: "signin" | "link" | "apply";
    headers?: Record<string, string>;
    returnTo?: string;
  } = {},
) {
  issuer.nextSignIn(user);
  const query = new URLSearchParams({
    intent: options.intent ?? "signin",
    ...(options.returnTo ? { returnTo: options.returnTo } : {}),
  });
  const start = await t.request({
    url: `/api/v1/auth/google/start?${query.toString()}`,
    headers: options.headers ?? {},
  });
  expect(start.statusCode).toBe(302);
  const flowCookie = cookieValue(start, "__Host-glim_oidc");
  const atGoogle = await fetch(String(start.headers.location), { redirect: "manual" });
  const callback = new URL(atGoogle.headers.get("location") ?? "");
  const cookies = [flowCookie, options.headers?.cookie].filter((c) => c !== undefined).join("; ");
  return t.request({
    url: `${callback.pathname}${callback.search}`,
    headers: { ...options.headers, cookie: cookies },
  });
}
