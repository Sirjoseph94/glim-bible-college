// Shared helpers for the k6 scenarios (TRD §21.4). Run against staging only, never production.
import http from "k6/http";
import { check, fail, sleep } from "k6";

export const BASE_URL = __ENV.BASE_URL ?? fail("Set BASE_URL, e.g. https://staging.glim.example");
/** The app's own origin, sent on writes; differs from BASE_URL only when k6 runs in Docker. */
const ORIGIN = __ENV.ORIGIN ?? BASE_URL;
const API = `${BASE_URL}/api/v1`;

/** Test accounts, one per line as `email,password` (made by the staging seed; never real people). */
export function accounts(file) {
  return open(file)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [email, password] = line.split(",");
      return { email, password };
    });
}

/**
 * Signs each account in once, from `setup()`. Sign-ins are limited to 10 a minute per address
 * (§5.4) and the load runs from one machine, so they're paced under that; a session then lasts
 * 2 h idle, longer than the run. Returns what each request needs: the cookies and the headers a
 * browser sends on writes (same origin, CSRF token from /me).
 */
export function signInAll(list, perMinute) {
  return list.map((account, i) => {
    if (i > 0) sleep(60 / perMinute);
    const res = http.post(`${API}/auth/login`, JSON.stringify(account), {
      headers: { "content-type": "application/json", origin: ORIGIN },
      tags: { name: "login" },
    });
    if (!check(res, { "signed in": (r) => r.status === 200 }))
      fail(`sign-in failed for account ${String(i)}: ${String(res.status)}`);
    // Taken from the response and sent explicitly on every request (replacing whatever the VU's
    // cookie jar holds), so each request is the intended account. The cookie is Secure, which a
    // jar won't send over plain http in a local smoke run.
    const cookies = {};
    for (const [name, values] of Object.entries(res.cookies)) cookies[name] = values[0].value;
    const session = { cookies, csrf: "" };
    const me = http.get(`${API}/me`, { cookies: sent(session), tags: { name: "me" } });
    if (!check(me, { "session works": (r) => r.status === 200 }))
      fail(`the session for account ${String(i)} didn't work: ${String(me.status)}`);
    session.csrf = me.json("csrfToken");
    return session;
  });
}

const sent = (s) =>
  Object.fromEntries(Object.entries(s.cookies).map(([k, value]) => [k, { value, replace: true }]));
const writes = (s) => ({
  origin: ORIGIN,
  "content-type": "application/json",
  "x-csrf-token": s.csrf,
});

// Every request is tagged with its name and kind (read or write) for the thresholds.
export const api = {
  get: (s, path, name) =>
    http.get(`${API}${path}`, { cookies: sent(s), tags: { name, kind: "read" } }),
  post: (s, path, body, name, extra = {}) =>
    http.post(`${API}${path}`, body === null ? null : JSON.stringify(body), {
      cookies: sent(s),
      headers: { ...writes(s), ...extra },
      tags: { name, kind: "write" },
    }),
  patch: (s, path, body, name, extra = {}) =>
    http.patch(`${API}${path}`, JSON.stringify(body), {
      cookies: sent(s),
      headers: { ...writes(s), ...extra },
      tags: { name, kind: "write" },
    }),
};
