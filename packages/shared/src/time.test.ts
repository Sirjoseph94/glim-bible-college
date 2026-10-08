import { describe, expect, it } from "vitest";
import { formatDualTime, isValidTimeZone, toLocalDate, zonedToInstant, zoneLabel } from "./time";

describe("formatDualTime", () => {
  const twoPmUtc = "2026-11-02T14:00:00Z";

  it("shows the viewer's time with Lagos time alongside when the zones differ", () => {
    expect(formatDualTime(twoPmUtc, { viewerZone: "Europe/London" })).toBe(
      "14:00 London (15:00 Lagos)",
    );
  });

  it("shows a single time when the viewer is on Lagos time", () => {
    expect(formatDualTime(twoPmUtc, { viewerZone: "Africa/Lagos" })).toBe("15:00");
    // Kinshasa shares Lagos's offset, so a second time adds nothing.
    expect(formatDualTime(twoPmUtc, { viewerZone: "Africa/Kinshasa" })).toBe("15:00");
  });

  it("follows daylight saving: in British Summer Time London and Lagos agree", () => {
    expect(formatDualTime("2026-07-01T14:00:00Z", { viewerZone: "Europe/London" })).toBe("15:00");
  });

  it("includes the date when asked, and Lagos's date when it falls on a different day", () => {
    expect(formatDualTime(twoPmUtc, { viewerZone: "Europe/London", withDate: true })).toBe(
      "Mon 2 Nov 2026, 14:00 London (15:00 Lagos)",
    );
    expect(formatDualTime("2026-11-02T23:30:00Z", { viewerZone: "America/New_York" })).toBe(
      "18:30 New York (Tue 3 Nov, 00:30 Lagos)",
    );
  });

  it("uses a different institution zone when one is configured", () => {
    expect(
      formatDualTime(twoPmUtc, { viewerZone: "Africa/Lagos", institutionZone: "Europe/London" }),
    ).toBe("15:00 Lagos (14:00 London)");
  });
});

describe("zoneLabel", () => {
  it("names a zone by its city", () => {
    expect(zoneLabel("America/New_York")).toBe("New York");
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneLabel("UTC")).toBe("UTC");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones only", () => {
    expect(isValidTimeZone("Africa/Lagos")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("toLocalDate", () => {
  it("gives the calendar date of an instant in a zone", () => {
    expect(toLocalDate("2026-11-02T23:30:00Z", "Africa/Lagos")).toBe("2026-11-03");
    expect(toLocalDate("2026-11-02T23:30:00Z", "America/New_York")).toBe("2026-11-02");
  });
});

describe("zonedToInstant", () => {
  it("reads a wall-clock time in the zone", () => {
    expect(zonedToInstant("2080-09-07", "09:00", "Africa/Lagos")).toBe("2080-09-07T08:00:00.000Z");
    expect(zonedToInstant("2026-01-15", "09:00", "Europe/London")).toBe("2026-01-15T09:00:00.000Z");
    expect(zonedToInstant("2026-07-15", "09:00", "Europe/London")).toBe("2026-07-15T08:00:00.000Z");
    expect(zonedToInstant("2026-07-15", "23:30", "America/New_York")).toBe(
      "2026-07-16T03:30:00.000Z",
    );
  });

  it("handles the days the clocks change", () => {
    // London: 01:00 → 02:00 on 29 March 2026; 02:00 → 01:00 on 25 October 2026.
    expect(zonedToInstant("2026-03-29", "03:00", "Europe/London")).toBe("2026-03-29T02:00:00.000Z");
    expect(zonedToInstant("2026-03-29", "00:30", "Europe/London")).toBe("2026-03-29T00:30:00.000Z");
    expect(zonedToInstant("2026-10-25", "03:00", "Europe/London")).toBe("2026-10-25T03:00:00.000Z");
  });

  it("refuses nonsense", () => {
    expect(() => zonedToInstant("2026-13-01", "25:00", "Africa/Lagos")).toThrow(RangeError);
    expect(() => zonedToInstant("2026-01-01", "09:00", "Mars/Olympus")).toThrow(RangeError);
  });
});
