// Lighthouse CI (TRD §18, §21.2; docs/ui-design-handoff.md §14): starts the e2e stack once, runs
// the public routes, then signs in as the seeded online student and runs the signed-in routes with
// that session cookie (lighthouserc.cjs). Run from apps/web after `pnpm build`:
// `node scripts/lighthouse.mjs`; extra arguments go to `lhci autorun` (as root, add
// `--collect.settings.chromeFlags=--no-sandbox`). The cookie goes through the environment only.
import { spawn } from "node:child_process";

const ORIGIN = "http://localhost:4173";
const LHCI = ["dlx", "@lhci/cli@0.15.1", "autorun"];
// Seeded by apps/api/test/e2e-server.ts for the recordings spec.
const STUDENT = { email: "e2e-student2@glim.test", password: "student passphrase 2026" };

/** Starts the e2e stack and resolves once it says it is ready. */
function startStack() {
  const stack = spawn("pnpm", ["--filter", "@glim/api", "e2e:serve"], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("the e2e stack wasn't ready within 240 s"));
    }, 240_000);
    stack.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      if (String(chunk).includes("e2e stack ready")) {
        clearTimeout(timer);
        resolve(stack);
      }
    });
    stack.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the e2e stack exited (${String(code)})`));
    });
  });
}

function lhci(env = {}) {
  return new Promise((resolve) => {
    const run = spawn("pnpm", [...LHCI, ...process.argv.slice(2)], {
      stdio: "inherit",
      // eslint-disable-next-line no-restricted-syntax -- passes the environment on to lhci.
      env: { ...process.env, ...env },
    });
    run.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

/** Signs in through the API and returns the session cookie as `name=value`. */
async function signIn() {
  const response = await fetch(`${ORIGIN}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(STUDENT),
  });
  const cookie = response.headers.getSetCookie()[0]?.split(";")[0];
  if (!response.ok || cookie === undefined)
    throw new Error(`signing in failed (${String(response.status)})`);
  return cookie;
}

const stack = await startStack();
let failed = 0;
try {
  failed += await lhci();
  failed += await lhci({ LHCI_SESSION_COOKIE: await signIn() });
} finally {
  process.kill(-stack.pid, "SIGTERM");
}
process.exit(failed === 0 ? 0 : 1);
