import type { ErrorCode } from "@glim/contracts";
import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { describeError } from "./error-copy";

const apiError = (status: number, code: ErrorCode, message = "Server words.") =>
  new ApiError(status, { error: { code, message, requestId: "req-4f2a" } });

describe("describeError (handoff §12.3)", () => {
  it("uses the fixed wording for sign-in failures, the same for a wrong password and a lockout", () => {
    const wrong = describeError(apiError(401, "INVALID_CREDENTIALS"));
    expect(wrong).toEqual({
      title: "That email and password don't match",
      body: "Check them and try again, or continue with Google.",
    });
    expect(describeError(apiError(429, "RATE_LIMITED"))).toEqual({
      title: "Slow down a little",
      body: "Try again in a moment.",
    });
  });

  it("explains the class-joining failures in plain words", () => {
    expect(describeError(apiError(403, "GOOGLE_ACCOUNT_REQUIRED")).title).toBe(
      "Link your Google account",
    );
    expect(describeError(apiError(503, "PROVIDER_UNAVAILABLE"))).toEqual({
      title: "Google Meet is unavailable",
      body: "Classes already in progress are not affected. We'll keep trying.",
    });
  });

  it("keeps the server's own message for errors without fixed copy", () => {
    expect(describeError(apiError(422, "VALIDATION_FAILED", "Enter a valid email."))).toEqual({
      title: "Enter a valid email.",
    });
  });

  it("owns up to failures on our side and gives a reference to quote", () => {
    expect(describeError(apiError(500, "VALIDATION_FAILED"))).toEqual({
      title: "Something went wrong on our side",
      body: "Try again. If it keeps happening, quote reference req-4f2a.",
    });
  });

  it("says the device is offline when the request never reached us", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toEqual({
      title: "You are offline",
      body: "Check your connection and try again.",
    });
  });
});
