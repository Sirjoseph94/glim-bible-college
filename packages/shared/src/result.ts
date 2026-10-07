import { ERROR_STATUS, type ErrorCode, type FieldError } from "@glim/contracts";

/** Expected domain failures are returned as values; exceptions are for bugs and infrastructure (§5.8). */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

/**
 * An error that maps to the API error envelope. Application services throw it at the edge of a
 * use case (or convert a Result into it); the API filter renders it.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors: FieldError[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { fieldErrors?: FieldError[]; headers?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fieldErrors = options.fieldErrors;
    this.headers = options.headers;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
