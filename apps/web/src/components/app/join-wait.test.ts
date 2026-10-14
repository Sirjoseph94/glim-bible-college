import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/client";
import { joinWaitUntil, secondsLeft } from "./join-wait";

const notReady = (retryAfter: number | null) =>
  new ApiError(
    409,
    { error: { code: "PROVIDER_NOT_READY", message: "…", requestId: "r" } } as never,
    retryAfter,
  );

describe("joinWaitUntil", () => {
  it("waits as long as the server asked when the link is being prepared", () => {
    expect(joinWaitUntil(notReady(30), 1_000)).toBe(31_000);
  });

  it("doesn't wait without Retry-After or for other errors", () => {
    expect(joinWaitUntil(notReady(null), 1_000)).toBeNull();
    expect(
      joinWaitUntil(
        new ApiError(
          403,
          { error: { code: "JOIN_WINDOW_CLOSED", message: "…", requestId: "r" } } as never,
          30,
        ),
        1_000,
      ),
    ).toBeNull();
    expect(joinWaitUntil(new Error("offline"), 1_000)).toBeNull();
  });
});

describe("secondsLeft", () => {
  it("rounds up and stops at zero", () => {
    expect(secondsLeft(31_000, 2_500)).toBe(29);
    expect(secondsLeft(31_000, 40_000)).toBe(0);
  });
});
