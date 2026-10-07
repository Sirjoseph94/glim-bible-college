import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** The vitest config every package uses for `*.itest.ts` integration tests. */
export function integrationConfig() {
  // Local overrides such as TEST_POSTGRES_URL live in the repo's gitignored .env.
  const envFile = fileURLToPath(new URL("../../../../.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  return defineConfig({
    test: {
      include: ["**/*.itest.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      globalSetup: [fileURLToPath(new URL("./global-setup.ts", import.meta.url))],
      testTimeout: 30_000,
      hookTimeout: 180_000,
      fileParallelism: true,
    },
  });
}
