import type { ErrorCode } from "@glim/contracts";
import { ApiError } from "./client";

export interface ErrorCopy {
  title: string;
  body?: string;
}

/**
 * Fixed wording for errors people meet often (docs/ui-design-handoff.md §12.3). `ACCOUNT_LOCKED`
 * is absent on purpose: a locked account answers like a wrong password, so the copy can't reveal
 * which emails have accounts (docs/implementation-notes.md, "Lockout").
 */
const COPY: Partial<Record<ErrorCode, ErrorCopy>> = {
  GOOGLE_ACCOUNT_REQUIRED: {
    title: "Link your Google account",
    body: "You need it to join live classes. Use the Gmail account you gave the school.",
  },
  PROVIDER_NOT_READY: {
    title: "The class link is being prepared",
    body: "Try again in a few seconds.",
  },
  PROVIDER_UNAVAILABLE: {
    title: "Google Meet is unavailable",
    body: "Classes already in progress are not affected. We'll keep trying.",
  },
  JOIN_WINDOW_CLOSED: { title: "This class isn't open" },
  OFFERING_FULL: {
    title: "This class is full",
    body: "Ask the academic office about another section.",
  },
  INVALID_CREDENTIALS: {
    title: "That email and password don't match",
    body: "Check them and try again, or continue with Google.",
  },
  RATE_LIMITED: { title: "Slow down a little", body: "Try again in a moment." },
  VERSION_MISMATCH: {
    title: "Someone else changed this",
    body: "We've loaded the latest version. Check it and save again.",
  },
  RESULT_LOCKED: {
    title: "Results are finalized",
    body: "Ask an academic admin to reopen them if something is wrong.",
  },
};

/** What to tell the person about a failed request: a short title and, where useful, a body. */
export function describeError(error: unknown): ErrorCopy {
  if (!(error instanceof ApiError))
    return { title: "You are offline", body: "Check your connection and try again." };
  const fixed = error.code === undefined ? undefined : COPY[error.code as ErrorCode];
  if (fixed) return fixed;
  if (error.status >= 500)
    return {
      title: "Something went wrong on our side",
      body: `Try again. If it keeps happening, quote reference ${error.envelope?.error.requestId ?? "unknown"}.`,
    };
  return { title: error.message };
}
