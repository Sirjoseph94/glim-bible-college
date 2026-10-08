import {
  ERROR_STATUS,
  type ErrorCode,
  type FieldError,
  type ScheduleConflict,
} from "@glim/contracts";

/** Expected domain failures are returned as values; exceptions are for bugs and infrastructure (§5.8). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

/** An expected domain failure (§5.8): a value an application service returns, not throws. */
export interface DomainError {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldError[];
  conflicts?: ScheduleConflict[];
  headers?: Record<string, string>;
}

export type DomainResult<T> = Result<T, DomainError>;

export function domainError(
  code: ErrorCode,
  message: string,
  extra: {
    fieldErrors?: FieldError[];
    conflicts?: ScheduleConflict[];
    headers?: Record<string, string>;
  } = {},
): DomainError {
  return { code, message, ...extra };
}

/**
 * An error that maps to the API error envelope. Controllers raise it by unwrapping a service's
 * Result; it is thrown directly only at the edge (validation, authentication, authorization).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: FieldError[] | undefined;
  readonly conflicts: ScheduleConflict[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      fieldErrors?: FieldError[];
      conflicts?: ScheduleConflict[];
      headers?: Record<string, string>;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fieldErrors = options.fieldErrors;
    this.conflicts = options.conflicts;
    this.headers = options.headers;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** The value of a success; an expected failure becomes an AppError for the API to render. */
export function unwrap<T>(result: Result<T, DomainError>): T {
  if (result.ok) return result.value;
  const { code, message, fieldErrors, conflicts, headers } = result.error;
  throw new AppError(code, message, {
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
    ...(conflicts === undefined ? {} : { conflicts }),
    ...(headers === undefined ? {} : { headers }),
  });
}

/** A partial update as parsed from a request: every field optional, and `undefined` means "leave it". */
export type Patch<T> = { [K in keyof T]?: T[K] | undefined };

/** The fields of a patch that were actually given, ready for an UPDATE's SET clause. */
export function definedFields(patch: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}
