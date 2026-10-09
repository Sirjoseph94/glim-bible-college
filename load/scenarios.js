// k6 load scenarios at GLIM scale with ~5x headroom (TRD §21.4). The thresholds are the SLOs in
// TRD §20.2; k6 exits non-zero if any is missed. See load/README.md for the inputs.
import { check, sleep } from "k6";
import exec from "k6/execution";
import { accounts, api, signInAll } from "./lib.js";

const STUDENTS = accounts(__ENV.STUDENTS ?? "./students.csv");
const APPLICANTS = __ENV.APPLICANTS ? accounts(__ENV.APPLICANTS) : [];
const VIDEO_ID = __ENV.VIDEO_ID;
const MEETING_ID = __ENV.MEETING_ID;
const SIGN_INS_PER_MINUTE = Number(__ENV.SIGN_INS_PER_MINUTE ?? "9");

// SMOKE=1: one student browses once, to check the inputs before the full run.
const SMOKE = __ENV.SMOKE === "1";

export const options = {
  // Signing everyone in, paced under the per-address limit, takes about (accounts / 9) minutes.
  setupTimeout: "60m",
  scenarios: SMOKE
    ? { smoke: { executor: "per-vu-iterations", vus: 1, iterations: 1, exec: "browse" } }
    : {
        // 250 signed-in users browsing their pages.
        browsing: { executor: "constant-vus", vus: 250, duration: "5m", exec: "browse" },
        // Video authorization burst: 20 req/s on /play.
        play: {
          executor: "constant-arrival-rate",
          rate: 20,
          timeUnit: "1s",
          duration: "2m",
          preAllocatedVUs: 40,
          exec: "play",
          startTime: "30s",
        },
        // Join storm: 150 joins in 60 s, by different students.
        join: {
          executor: "constant-arrival-rate",
          rate: 150,
          timeUnit: "60s",
          duration: "60s",
          preAllocatedVUs: 60,
          exec: "join",
          startTime: "1m",
        },
        // Playback progress: 10 writes/s, spread over the students (each under 12 a minute).
        progress: {
          executor: "constant-arrival-rate",
          rate: 10,
          timeUnit: "1s",
          duration: "3m",
          preAllocatedVUs: 30,
          exec: "progress",
          startTime: "30s",
        },
        // Application autosave: 50 applicants at once, every 3 s.
        ...(APPLICANTS.length > 0
          ? {
              autosave: {
                executor: "constant-vus",
                vus: Math.min(50, APPLICANTS.length),
                duration: "3m",
                exec: "autosave",
                startTime: "1m",
              },
            }
          : {}),
      },
  thresholds: {
    // §20.2: read p95 < 300 ms, write p95 < 500 ms, availability (errors under 0.5 %).
    "http_req_duration{kind:read}": ["p(95)<300"],
    "http_req_duration{kind:write}": ["p(95)<500"],
    // §20.2: video authorization p95 < 300 ms; join authorization on the server p95 < 100 ms
    // (the 1.5 s end-to-end budget includes the phone's network, which k6 doesn't have).
    "http_req_duration{name:play}": ["p(95)<300"],
    "http_req_duration{name:join}": ["p(95)<100"],
    http_req_failed: ["rate<0.005"],
    checks: ["rate>0.995"],
  },
};

export function setup() {
  return {
    students: signInAll(STUDENTS, SIGN_INS_PER_MINUTE),
    applicants: signInAll(APPLICANTS, SIGN_INS_PER_MINUTE),
  };
}

// Each iteration acts as the next student, so per-user limits see realistic rates.
const next = (list) => list[exec.scenario.iterationInTest % list.length];

export function browse(data) {
  const s = data.students[exec.vu.idInTest % data.students.length];
  for (const [path, name] of [
    ["/me", "me"],
    ["/me/schedule", "schedule"],
    ["/me/notifications", "notifications"],
    ["/me/results", "results"],
  ]) {
    const res = api.get(s, path, name);
    check(res, { [`${name} ok`]: (r) => r.status === 200 });
  }
  sleep(5 + Math.random() * 10);
}

export function play(data) {
  const res = api.get(next(data.students), `/videos/${VIDEO_ID}/play`, "play");
  check(res, { "play ok": (r) => r.status === 200 });
}

export function join(data) {
  // The join path reads the database only: no provider is called (TRD §0.2).
  const res = api.post(next(data.students), `/class-meetings/${MEETING_ID}/join`, null, "join");
  check(res, { "join ok": (r) => r.status === 200 });
}

export function progress(data) {
  const i = exec.scenario.iterationInTest;
  // A student's reports move forward; `seq` keeps increasing across the run.
  const body = { positionMs: (i % 240) * 15_000, durationMs: 3_600_000, seq: i };
  const res = api.patch(next(data.students), `/videos/${VIDEO_ID}/progress`, body, "progress");
  check(res, { "progress ok": (r) => r.status === 200 });
}

let application = null;
export function autosave(data) {
  const s = data.applicants[exec.vu.idInTest % data.applicants.length];
  if (application === null) {
    const id = api.get(s, "/applications/mine", "applications").json("items.0.id");
    application = api.get(s, `/applications/${id}`, "application").json();
  }
  const res = api.patch(
    s,
    `/applications/${application.id}`,
    { personal: { occupation: `Pastor ${String(Date.now())}` } },
    "autosave",
    { "if-match": `"${String(application.version)}"` },
  );
  if (check(res, { "autosave ok": (r) => r.status === 200 }))
    application = { id: application.id, version: res.json("version") };
  sleep(3);
}
