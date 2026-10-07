import { WORKER_ROLES, QUEUE_NAMES, type QueueName, type WorkerRole } from "@glim/contracts";
import { z } from "zod";
import { isValidTimeZone } from "./time";

/**
 * The only reader of `process.env` (TRD §5.8, §22.3). Locally everything defaults to the Docker
 * compose stack; in production every secret and connection string is required.
 */

const DEV = {
  DATABASE_URL: "postgres://glim_app:glim_app@localhost:5432/glim",
  DATABASE_URL_DIRECT: "postgres://glim_app:glim_app@localhost:5432/glim",
  DATABASE_URL_MIGRATOR: "postgres://glim_migrator:glim_migrator@localhost:5432/glim",
  SESSION_SECRET: "dev-only-session-secret-change-me-0123456789",
  CSRF_SECRET: "dev-only-csrf-secret-change-me-0123456789abc",
  STORAGE_ENDPOINT: "http://localhost:9000",
  STORAGE_REGION: "us-east-1",
  STORAGE_BUCKET: "glim-files",
  STORAGE_BACKUP_BUCKET: "glim-backups",
  STORAGE_ACCESS_KEY: "minioadmin",
  STORAGE_SECRET_KEY: "minioadmin",
  MAIL_FROM: "GLIM Bible College <no-reply@glim.local>",
  SMTP_URL: "smtp://localhost:1025",
} as const;

const REQUIRED_IN_PRODUCTION = [
  "APP_ORIGIN",
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "DATABASE_URL_MIGRATOR",
  "SESSION_SECRET",
  "CSRF_SECRET",
  "STORAGE_ENDPOINT",
  "STORAGE_REGION",
  "STORAGE_BUCKET",
  "STORAGE_ACCESS_KEY",
  "STORAGE_SECRET_KEY",
  "MAIL_FROM",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
] as const;

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v));
const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const flag = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: int(3000),
  APP_ORIGIN: optionalText,
  INSTITUTION_DEFAULT_TZ: z
    .string()
    .default("Africa/Lagos")
    .refine(isValidTimeZone, "must be an IANA timezone"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: optionalText,
  DATABASE_URL_DIRECT: optionalText,
  DATABASE_URL_MIGRATOR: optionalText,
  DB_CONNECTION_BUDGET: int(50),
  DB_POOL_API: int(8),
  DB_POOL_WORKER: int(6),
  DB_POOL_BOSS: int(4),
  API_INSTANCE_COUNT: int(2),
  WORKER_INSTANCE_COUNT: int(1),

  WORKER_ROLE: z.enum(WORKER_ROLES).default("all"),

  GOOGLE_OAUTH_CLIENT_ID: optionalText,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalText,

  VIDEO_HOST: z.enum(["youtube_link", "youtube_api", "fake"]).default("youtube_link"),
  DRIVE_CLEANUP_MODE: z.enum(["NONE", "TRASH_AFTER_INGEST"]).default("NONE"),

  STORAGE_ENDPOINT: optionalText,
  STORAGE_REGION: optionalText,
  STORAGE_BUCKET: optionalText,
  STORAGE_BACKUP_BUCKET: optionalText,
  STORAGE_ACCESS_KEY: optionalText,
  STORAGE_SECRET_KEY: optionalText,

  MAIL_PROVIDER: z.enum(["sendgrid", "smtp"]).optional(),
  SENDGRID_API_KEY: optionalText,
  SENDGRID_WEBHOOK_PUBLIC_KEY: optionalText,
  MAIL_FROM: optionalText,
  SMTP_URL: optionalText,

  SESSION_SECRET: optionalText,
  CSRF_SECRET: optionalText,
  BACKUP_AGE_RECIPIENT: optionalText,

  TEST_POSTGRES_URL: optionalText,
  TEST_S3_ENDPOINT: optionalText,

  FEATURE_DIRECT_UPLOAD: flag,
  FEATURE_PHONE_DIAL_IN: flag,
});

export type NodeEnv = "development" | "test" | "production";

export interface Config {
  nodeEnv: NodeEnv;
  port: number;
  appOrigin: string;
  institutionDefaultTz: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  db: {
    url: string;
    directUrl: string;
    migratorUrl: string;
    connectionBudget: number;
    poolApi: number;
    poolWorker: number;
    poolBoss: number;
    apiInstances: number;
    workerInstances: number;
  };
  workerRole: WorkerRole;
  queueConcurrency: Partial<Record<QueueName, number>>;
  google: { oauthClientId: string | undefined; oauthClientSecret: string | undefined };
  videoHost: "youtube_link" | "youtube_api" | "fake";
  driveCleanupMode: "NONE" | "TRASH_AFTER_INGEST";
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    backupBucket: string;
    accessKey: string;
    secretKey: string;
  };
  mail: {
    provider: "sendgrid" | "smtp";
    from: string;
    sendgridApiKey: string | undefined;
    sendgridWebhookPublicKey: string | undefined;
    smtpUrl: string | undefined;
  };
  auth: { sessionSecret: string; csrfSecret: string };
  backupAgeRecipient: string | undefined;
  features: { directUpload: boolean; phoneDialIn: boolean };
  /** Test harness overrides: use an existing server instead of starting Testcontainers. */
  testing: { postgresUrl: string | undefined; s3Endpoint: string | undefined };
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Name the variable and the rule, never the value: values may be secrets (INV-12).
    throw new ConfigError(
      parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message.replace(/received .*$/i, "").trim()}`,
      ),
    );
  }
  const e = parsed.data;
  const production = e.NODE_ENV === "production";
  const problems: string[] = [];

  const mailProvider = e.MAIL_PROVIDER ?? (production ? "sendgrid" : "smtp");
  if (production) {
    for (const name of REQUIRED_IN_PRODUCTION) {
      if (e[name] === undefined) problems.push(`${name}: required in production`);
    }
    if (mailProvider === "sendgrid" && e.SENDGRID_API_KEY === undefined) {
      problems.push("SENDGRID_API_KEY: required when MAIL_PROVIDER=sendgrid");
    }
  }
  if (mailProvider === "smtp" && production) {
    problems.push("MAIL_PROVIDER: smtp is for local development only");
  }

  const pick = (name: keyof typeof DEV): string => e[name] ?? DEV[name];

  const db = {
    url: pick("DATABASE_URL"),
    directUrl: pick("DATABASE_URL_DIRECT"),
    migratorUrl: pick("DATABASE_URL_MIGRATOR"),
    connectionBudget: e.DB_CONNECTION_BUDGET,
    poolApi: e.DB_POOL_API,
    poolWorker: e.DB_POOL_WORKER,
    poolBoss: e.DB_POOL_BOSS,
    apiInstances: e.API_INSTANCE_COUNT,
    workerInstances: e.WORKER_INSTANCE_COUNT,
  };
  const connections =
    db.apiInstances * db.poolApi + db.workerInstances * db.poolWorker + db.poolBoss + 1;
  if (connections > db.connectionBudget) {
    problems.push(
      `DB_CONNECTION_BUDGET: pools need ${connections} connections but the budget is ${db.connectionBudget}`,
    );
  }

  const queueConcurrency: Partial<Record<QueueName, number>> = {};
  for (const queue of QUEUE_NAMES) {
    const name = `QUEUE_CONCURRENCY_${queue.replaceAll(/[.-]/g, "_").toUpperCase()}`;
    const raw = env[name];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) problems.push(`${name}: must be a positive integer`);
    else queueConcurrency[queue] = n;
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    appOrigin: e.APP_ORIGIN ?? `http://localhost:${e.PORT}`,
    institutionDefaultTz: e.INSTITUTION_DEFAULT_TZ,
    logLevel: e.LOG_LEVEL,
    db,
    workerRole: e.WORKER_ROLE,
    queueConcurrency,
    google: {
      oauthClientId: e.GOOGLE_OAUTH_CLIENT_ID,
      oauthClientSecret: e.GOOGLE_OAUTH_CLIENT_SECRET,
    },
    videoHost: e.VIDEO_HOST,
    driveCleanupMode: e.DRIVE_CLEANUP_MODE,
    storage: {
      endpoint: pick("STORAGE_ENDPOINT"),
      region: pick("STORAGE_REGION"),
      bucket: pick("STORAGE_BUCKET"),
      backupBucket: pick("STORAGE_BACKUP_BUCKET"),
      accessKey: pick("STORAGE_ACCESS_KEY"),
      secretKey: pick("STORAGE_SECRET_KEY"),
    },
    mail: {
      provider: mailProvider,
      from: pick("MAIL_FROM"),
      sendgridApiKey: e.SENDGRID_API_KEY,
      sendgridWebhookPublicKey: e.SENDGRID_WEBHOOK_PUBLIC_KEY,
      smtpUrl: e.SMTP_URL ?? (production ? undefined : DEV.SMTP_URL),
    },
    auth: { sessionSecret: pick("SESSION_SECRET"), csrfSecret: pick("CSRF_SECRET") },
    backupAgeRecipient: e.BACKUP_AGE_RECIPIENT,
    features: { directUpload: e.FEATURE_DIRECT_UPLOAD, phoneDialIn: e.FEATURE_PHONE_DIAL_IN },
    testing: { postgresUrl: e.TEST_POSTGRES_URL, s3Endpoint: e.TEST_S3_ENDPOINT },
  };
}
