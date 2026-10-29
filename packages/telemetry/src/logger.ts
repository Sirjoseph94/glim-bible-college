import { pino, type DestinationStream, type Logger } from "pino";

export type { Logger } from "pino";

const SECRET_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "password",
  "newPassword",
  "currentPassword",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "secret",
  "clientSecret",
  "apiKey",
  // INV-15: sensitive applicant answers never reach logs.
  "spiritual",
  "spiritualBackground",
  "spiritual_background",
];

/** Redact each key at the top level and up to three levels deep (pino has no recursive wildcard). */
const REDACT_PATHS = SECRET_KEYS.flatMap((key) => {
  const k = /^[A-Za-z_$][\w$]*$/.test(key) ? key : `["${key}"]`;
  const join = (prefix: string) => (k.startsWith("[") ? `${prefix}${k}` : `${prefix}.${k}`);
  return [k, join("*"), join("*.*"), join("*.*.*")];
});

export interface LoggerOptions {
  service: string;
  level: string;
}

/** JSON logs to stdout, kept by Docker on the VPS (TRD §20.1). */
export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  return pino(
    {
      level: options.level,
      base: { service: options.service },
      messageKey: "msg",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
    destination,
  );
}

/** DI token for the Logger. */
export const LOGGER = Symbol.for("glim.Logger");
