import { describe, expect, it } from "vitest";
import { ApiError, retryAfterSeconds } from "./client";

describe("retryAfterSeconds", () => {
  const now = new Date("2026-10-14T09:00:00Z");

  it("reads a number of seconds", () => {
    expect(retryAfterSeconds("30", now)).toBe(30);
  });

  it("reads an HTTP date, rounding up and never below zero", () => {
    expect(retryAfterSeconds("Wed, 14 Oct 2026 09:00:12 GMT", now)).toBe(12);
    expect(retryAfterSeconds("Wed, 14 Oct 2026 08:59:00 GMT", now)).toBe(0);
  });

  it("is null when missing or unreadable", () => {
    expect(retryAfterSeconds(null, now)).toBeNull();
    expect(retryAfterSeconds("soon", now)).toBeNull();
    expect(retryAfterSeconds("-5", now)).toBeNull();
  });
});

describe("ApiError", () => {
  it("keeps the Retry-After it was given", () => {
    expect(new ApiError(409, null, 30).retryAfterSeconds).toBe(30);
    expect(new ApiError(409, null).retryAfterSeconds).toBeNull();
  });
});
