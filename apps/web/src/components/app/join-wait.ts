import { ApiError } from "../../api/client";

/**
 * When Join may be tried again after it failed (handoff §9.14): the server's `Retry-After` when
 * the Meet link is still being prepared, otherwise no wait.
 */
export function joinWaitUntil(error: unknown, now: number): number | null {
  if (!(error instanceof ApiError) || error.code !== "PROVIDER_NOT_READY") return null;
  return error.retryAfterSeconds === null ? null : now + error.retryAfterSeconds * 1000;
}

/** Whole seconds until `until`, never below zero. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}
