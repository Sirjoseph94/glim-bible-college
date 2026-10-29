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
  BACKUP_AGE_RECIPIENT: "age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq",
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

  describe("email over SMTP in production (Brevo, decisions.md OPS-2)", () => {
    const { SENDGRID_API_KEY: _k, ...base } = production;
    const smtp = { ...base, MAIL_PROVIDER: "smtp" };
    const url = "smtps://glim%40smtp-brevo.com:xsmtpsib-secret@smtp-relay.brevo.com:465";

    it("sends through SMTP_URL", () => {
      const config = loadConfig({ ...smtp, SMTP_URL: url });
      expect(config.mail.provider).toBe("smtp");
      expect(config.mail.smtpUrl).toBe(url);
    });

    it("needs SMTP_URL", () => {
      expect(() => loadConfig(smtp)).toThrow(/SMTP_URL: required when MAIL_PROVIDER=smtp/);
    });

    it("refuses a server that would see the key unencrypted, without echoing the URL", () => {
      const plain = "smtp://glim%40smtp-brevo.com:xsmtpsib-secret@smtp-relay.brevo.com:587";
      expect(() => loadConfig({ ...smtp, SMTP_URL: plain })).toThrow(/SMTP_URL: must be smtps:/);
      expect(() => loadConfig({ ...smtp, SMTP_URL: plain })).not.toThrow(/xsmtpsib-secret/);
    });
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

  describe("the Google integration switches (off by default)", () => {
    const key = Buffer.from(
      JSON.stringify({
        client_email: "glim-meet@glim-lms.iam.gserviceaccount.com",
        client_id: "1234567890",
        private_key: "-----BEGIN PRIVATE KEY-----\nSECRETKEYMATERIAL\n-----END PRIVATE KEY-----\n",
      }),
    ).toString("base64");

    it("keeps v1's pasted links unless LIVE_PROVIDER is set", () => {
      const config = loadConfig({});
      expect(config.liveProvider).toBe("none");
      expect(config.google.serviceAccount).toBeUndefined();
    });

    it("needs the service account and Pub/Sub names for Google Meet, qualifying short names", () => {
      expect(() => loadConfig({ LIVE_PROVIDER: "google_meet" })).toThrow(
        /GOOGLE_SA_KEY_JSON_B64[\s\S]*GOOGLE_PUBSUB_SUBSCRIPTION[\s\S]*GOOGLE_PUBSUB_TOPIC/,
      );
      const config = loadConfig({
        LIVE_PROVIDER: "google_meet",
        GOOGLE_PROJECT_ID: "glim-lms",
        GOOGLE_SA_KEY_JSON_B64: key,
        GOOGLE_PUBSUB_SUBSCRIPTION: "glim-meet-events-pull",
        GOOGLE_PUBSUB_TOPIC: "projects/glim-lms/topics/glim-meet-events",
      });
      expect(config.google.serviceAccount).toMatchObject({
        clientEmail: "glim-meet@glim-lms.iam.gserviceaccount.com",
        clientId: "1234567890",
      });
      expect(config.google.pubsubSubscription).toBe(
        "projects/glim-lms/subscriptions/glim-meet-events-pull",
      );
      expect(config.google.pubsubTopic).toBe("projects/glim-lms/topics/glim-meet-events");
    });

    it("rejects a malformed key without echoing it", () => {
      try {
        loadConfig({
          GOOGLE_SA_KEY_JSON_B64: Buffer.from('{"private_key":"SECRETX"}').toString("base64"),
        });
      } catch (e) {
        expect((e as Error).message).toContain("GOOGLE_SA_KEY_JSON_B64");
        expect((e as Error).message).not.toContain("SECRETX");
        return;
      }
      expect.unreachable("loadConfig should have thrown");
    });

    it("needs the channel OAuth client and a 32-byte token key for YouTube uploads", () => {
      expect(() => loadConfig({ VIDEO_HOST: "youtube_api" })).toThrow(
        /YOUTUBE_OAUTH_CLIENT_ID[\s\S]*TOKEN_ENCRYPTION_KEY/,
      );
      expect(() =>
        loadConfig({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
      ).toThrow(/TOKEN_ENCRYPTION_KEY: must be 32 bytes/);
      const config = loadConfig({
        VIDEO_HOST: "youtube_api",
        YOUTUBE_OAUTH_CLIENT_ID: "yt.apps.googleusercontent.com",
        YOUTUBE_OAUTH_CLIENT_SECRET: "yt-secret",
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      });
      expect(config.tokenEncryptionKey?.length).toBe(32);
    });

    it("refuses the fakes in production", () => {
      expect(() => loadConfig({ ...production, LIVE_PROVIDER: "fake" })).toThrow(/LIVE_PROVIDER/);
    });
  });
});
