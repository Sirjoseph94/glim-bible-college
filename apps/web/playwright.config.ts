import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: "retain-on-failure",
  },
  // Students and applicants are mostly on phones (TRD §18).
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm --filter @glim/web build && pnpm --filter @glim/api e2e:serve",
    url: `http://localhost:${String(PORT)}/readyz`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
