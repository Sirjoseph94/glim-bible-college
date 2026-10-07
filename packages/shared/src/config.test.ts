import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const production = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://portal.glim.edu.ng",
  DATABASE_URL: "postgres://glim_app:pw@db:25061/glim-tx?sslmode=require",
  DATABASE_URL_DIRECT: "postgres://glim_app:pw@db:25060/glim?sslmode=require",
  DATABASE_URL_MIGRATOR: "postgres://glim_migrator:pw@db:25060/glim?sslmode=require",
  SESSION_SECRET: "s".repeat(48),
  CSRF_SECRET: "c".repeat(48),
  STORAGE_ENDPOINT: "https://fra1.digitaloceanspaces.com",
  STORAGE_REGION: "fra1",
  STORAGE_BUCKET: "glim-files",
  STORAGE_ACCESS_KEY: "AKIA-SECRET-VALUE",
  STORAGE_SECRET_KEY: "very-secret-storage-key",
  MAIL_PROVIDER: "sendgrid",
  SENDGRID_API_KEY: "SG.secret",
  MAIL_FROM: "GLIM Bible College <no-reply@glim.edu.ng>",
  GOOGLE_OAUTH_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
};

describe("loadConfig", () => {
  it("runs locally against the Docker compose stack with no variables set", () => {
    const config = loadConfig({});
    expect(config.nodeEnv).toBe("development");
    expect(config.institutionDefaultTz).toBe("Africa/Lagos");
    expect(config.db.url).toMatch(/^postgres:\/\/.+localhost/);
    expect(config.workerRole).toBe("all");
    expect(config.videoHost).toBe("youtube_link");
    expect(config.mail.provider).toBe("smtp");
    expect(config.driveCleanupMode).toBe("NONE");
  });

  it("parses production settings and per-queue concurrency", () => {
    const config = loadConfig({
      ...production,
      QUEUE_CONCURRENCY_NOTIFY_SEND: "4",
      DB_POOL_API: "8",
    });
    expect(config.appOrigin).toBe("https://portal.glim.edu.ng");
    expect(config.db.poolApi).toBe(8);
    expect(config.queueConcurrency).toEqual({ "notify.send": 4 });
  });

  it("refuses to start production without its secrets, naming the variables but never their values", () => {
    const { SESSION_SECRET: _s, SENDGRID_API_KEY: _k, ...missing } = production;
    expect(() => loadConfig(missing)).toThrow(ConfigError);
    try {
      loadConfig({ ...missing, STORAGE_REGION: "" });
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("SESSION_SECRET");
      expect(message).toContain("SENDGRID_API_KEY");
      expect(message).not.toContain("very-secret-storage-key");
      expect(message).not.toContain("pw@db");
      return;
    }
    expect.unreachable("loadConfig should have thrown");
  });

  it("rejects values outside their allowed sets", () => {
    expect(() => loadConfig({ WORKER_ROLE: "everything" })).toThrow(/WORKER_ROLE/);
    expect(() => loadConfig({ INSTITUTION_DEFAULT_TZ: "Mars/Base" })).toThrow(
      /INSTITUTION_DEFAULT_TZ/,
    );
  });

  it("fails when the connection pools exceed the database's connection budget (§5.2)", () => {
    // default allocation: API 2 × 8 + worker 1 × 6 + pg-boss 4 + migrate 1 = 27
    expect(() => loadConfig({ DB_CONNECTION_BUDGET: "27" })).not.toThrow();
    expect(() => loadConfig({ DB_CONNECTION_BUDGET: "26" })).toThrow(/DB_CONNECTION_BUDGET/);
  });
});
