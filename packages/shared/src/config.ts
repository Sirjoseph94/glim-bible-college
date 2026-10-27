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
  "BACKUP_AGE_RECIPIENT",
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

  /** A header set by the edge proxy with the client's IP (Caddy on the VPS: x-real-ip). */
  CLIENT_IP_HEADER: optionalText,

  WORKER_ROLE: z.enum(WORKER_ROLES).default("all"),

  GOOGLE_OIDC_ISSUER: z.url().default("https://accounts.google.com"),
  GOOGLE_OAUTH_CLIENT_ID: optionalText,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalText,

  /** The Google integration switch (integration slice): `none` keeps v1's pasted Meet links. */
  LIVE_PROVIDER: z.enum(["none", "google_meet", "fake"]).default("none"),
  GOOGLE_PROJECT_ID: optionalText,
  /** The DWD service account's JSON key, base64 (secret, TRD §11.3). */
  GOOGLE_SA_KEY_JSON_B64: optionalText,
  /** `projects/<p>/subscriptions/<s>`, or just `<s>` with GOOGLE_PROJECT_ID. */
  GOOGLE_PUBSUB_SUBSCRIPTION: optionalText,
  /** `projects/<p>/topics/<t>`, or just `<t>`: where Workspace Events publish. */
  GOOGLE_PUBSUB_TOPIC: optionalText,
  GOOGLE_EVENTS_MODE: z.enum(["pull", "push"]).default("pull"),

  VIDEO_HOST: z.enum(["youtube_link", "youtube_api", "fake"]).default("youtube_link"),
  YOUTUBE_OAUTH_CLIENT_ID: optionalText,
  YOUTUBE_OAUTH_CLIENT_SECRET: optionalText,
  /** 32 bytes, base64: encrypts the YouTube channel token at rest (secret). */
  TOKEN_ENCRYPTION_KEY: optionalText,
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
  /** The pg_dump binary for the weekly logical backup; must match the server's major version (18). */
  PG_DUMP_PATH: z.string().min(1).default("pg_dump"),

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
  clientIpHeader: string | undefined;
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
  google: {
    oidcIssuer: string;
    oauthClientId: string | undefined;
    oauthClientSecret: string | undefined;
    projectId: string | undefined;
    /** Parsed from GOOGLE_SA_KEY_JSON_B64; never logged. */
    serviceAccount: GoogleServiceAccount | undefined;
    pubsubSubscription: string | undefined;
    pubsubTopic: string | undefined;
    eventsMode: "pull" | "push";
  };
  liveProvider: "none" | "google_meet" | "fake";
  videoHost: "youtube_link" | "youtube_api" | "fake";
  youtube: { oauthClientId: string | undefined; oauthClientSecret: string | undefined };
  tokenEncryptionKey: Buffer | undefined;
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
  backup: { ageRecipient: string | undefined; pgDumpPath: string };
  features: { directUpload: boolean; phoneDialIn: boolean };
  /** Test harness overrides: use an existing server instead of starting Testcontainers. */
  testing: { postgresUrl: string | undefined; s3Endpoint: string | undefined };
}

export interface GoogleServiceAccount {
  clientEmail: string;
  /** The numeric client id the Admin Console's domain-wide delegation entry needs. */
  clientId: string;
  privateKey: string;
}

/** Decodes the service-account key; null if it isn't one. Never echoes the input. */
function parseServiceAccount(b64: string): GoogleServiceAccount | null {
  try {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, unknown>;
    const { client_email: clientEmail, client_id: clientId, private_key: privateKey } = json;
    if (
      typeof clientEmail !== "string" ||
      typeof privateKey !== "string" ||
      !privateKey.includes("PRIVATE KEY")
    )
      return null;
    return { clientEmail, clientId: typeof clientId === "string" ? clientId : "", privateKey };
  } catch {
    return null;
  }
}

/** `<s>` + project → `projects/<project>/<kind>/<s>`; a full name is kept. */
function qualify(name: string | undefined, kind: string, project: string | undefined) {
  if (name === undefined || name.startsWith("projects/")) return name;
  return project === undefined ? name : `projects/${project}/${kind}/${name}`;
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

  const serviceAccount =
    e.GOOGLE_SA_KEY_JSON_B64 === undefined
      ? undefined
      : parseServiceAccount(e.GOOGLE_SA_KEY_JSON_B64);
  if (serviceAccount === null)
    problems.push("GOOGLE_SA_KEY_JSON_B64: must be a base64 service-account JSON key");
  const pubsubSubscription = qualify(
    e.GOOGLE_PUBSUB_SUBSCRIPTION,
    "subscriptions",
    e.GOOGLE_PROJECT_ID,
  );
  const pubsubTopic = qualify(e.GOOGLE_PUBSUB_TOPIC, "topics", e.GOOGLE_PROJECT_ID);
  if (e.LIVE_PROVIDER === "google_meet") {
    if (e.GOOGLE_SA_KEY_JSON_B64 === undefined)
      problems.push("GOOGLE_SA_KEY_JSON_B64: required when LIVE_PROVIDER=google_meet");
    for (const [name, value] of [
      ["GOOGLE_PUBSUB_SUBSCRIPTION", pubsubSubscription],
      ["GOOGLE_PUBSUB_TOPIC", pubsubTopic],
    ] as const)
      if (value === undefined || !value.startsWith("projects/"))
        problems.push(
          `${name}: required when LIVE_PROVIDER=google_meet (a full name, or set GOOGLE_PROJECT_ID)`,
        );
  }
  let tokenEncryptionKey: Buffer | undefined;
  if (e.TOKEN_ENCRYPTION_KEY !== undefined) {
    tokenEncryptionKey = Buffer.from(e.TOKEN_ENCRYPTION_KEY, "base64");
    if (tokenEncryptionKey.length !== 32)
      problems.push("TOKEN_ENCRYPTION_KEY: must be 32 bytes, base64-encoded");
  }
  if (e.VIDEO_HOST === "youtube_api")
    for (const name of [
      "YOUTUBE_OAUTH_CLIENT_ID",
      "YOUTUBE_OAUTH_CLIENT_SECRET",
      "TOKEN_ENCRYPTION_KEY",
    ] as const)
      if (e[name] === undefined) problems.push(`${name}: required when VIDEO_HOST=youtube_api`);
  if (production && e.LIVE_PROVIDER === "fake")
    problems.push("LIVE_PROVIDER: fake is for development and tests only");
  if (production && e.VIDEO_HOST === "fake")
    problems.push("VIDEO_HOST: fake is for development and tests only");

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
    clientIpHeader: e.CLIENT_IP_HEADER?.toLowerCase(),
    db,
    workerRole: e.WORKER_ROLE,
    queueConcurrency,
    google: {
      oidcIssuer: e.GOOGLE_OIDC_ISSUER,
      oauthClientId: e.GOOGLE_OAUTH_CLIENT_ID,
      oauthClientSecret: e.GOOGLE_OAUTH_CLIENT_SECRET,
      projectId: e.GOOGLE_PROJECT_ID,
      serviceAccount: serviceAccount ?? undefined,
      pubsubSubscription,
      pubsubTopic,
      eventsMode: e.GOOGLE_EVENTS_MODE,
    },
    liveProvider: e.LIVE_PROVIDER,
    videoHost: e.VIDEO_HOST,
    youtube: {
      oauthClientId: e.YOUTUBE_OAUTH_CLIENT_ID,
      oauthClientSecret: e.YOUTUBE_OAUTH_CLIENT_SECRET,
    },
    tokenEncryptionKey,
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
    backup: { ageRecipient: e.BACKUP_AGE_RECIPIENT, pgDumpPath: e.PG_DUMP_PATH },
    features: { directUpload: e.FEATURE_DIRECT_UPLOAD, phoneDialIn: e.FEATURE_PHONE_DIAL_IN },
    testing: { postgresUrl: e.TEST_POSTGRES_URL, s3Endpoint: e.TEST_S3_ENDPOINT },
  };
}

/** DI token for the loaded Config. */
export const CONFIG = Symbol.for("glim.Config");
