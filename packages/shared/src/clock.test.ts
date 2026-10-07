import { describe, expect, it } from "vitest";
import { TestClock, systemClock } from "./clock";

describe("systemClock", () => {
  it("reads the current time", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe("TestClock", () => {
  it("stays at the time it was set to until advanced", () => {
    const clock = new TestClock("2026-11-01T09:00:00Z");
    expect(clock.now().toISOString()).toBe("2026-11-01T09:00:00.000Z");

    clock.advance({ days: 21, minutes: 1 });
    expect(clock.now().toISOString()).toBe("2026-11-22T09:01:00.000Z");

    clock.set("2027-06-30T23:59:59Z");
    expect(clock.now().toISOString()).toBe("2027-06-30T23:59:59.000Z");
  });

  it("hands out copies, so callers can't move the clock by mutating a Date", () => {
    const clock = new TestClock("2026-11-01T09:00:00Z");
    clock.now().setUTCFullYear(2000);
    expect(clock.now().toISOString()).toBe("2026-11-01T09:00:00.000Z");
  });
});
