import { describe, expect, it } from "vitest";
import { settings } from "./api/index";
import { defaultPolicy, POLICY_SCHEMAS } from "./policies";

describe("policy defaults", () => {
  it("match the TRD for attendance (§12.2) and the D-02 good-standing default", () => {
    expect(defaultPolicy("ATTENDANCE")).toMatchObject({
      basis: "ACTUAL_CAPPED",
      presentThresholdBp: 7500,
      partialThresholdBp: 2500,
      lateGraceMinutes: 15,
      lockAfterDays: 7,
      rollCallOpensBeforeMinutes: 15,
    });
    expect(defaultPolicy("JOIN_WINDOW")).toEqual({
      studentOpensBeforeMinutes: 15,
      studentClosesAfterMinutes: 60,
      staffOpensBeforeMinutes: 60,
      maxOverrunMinutes: 180,
    });
    expect(defaultPolicy("ADMISSIONS")).toMatchObject({
      offerReminderDaysBefore: [7, 2],
      minimumAgeYears: 18,
    });
    expect(defaultPolicy("GRADING_DEFAULTS")).toEqual({
      repeatPolicy: "BEST",
      goodStandingMinCgpaX100: 100,
      missingGradeAsZero: true,
      roundBeforeBanding: "INTEGER",
    });
  });

  it("keeps Meet matching in review mode until spike S-01 passes (Q-02)", () => {
    expect(defaultPolicy("GOOGLE_MEET")).toEqual({
      accessType: "RESTRICTED",
      moderation: true,
      presentRestriction: "HOSTS_ONLY",
      provisionLeadHours: 24,
      syncAccessWithinDays: 14,
      matching: { googleId: false, memberEmail: false, nameAssisted: true },
    });
  });

  it("reject unknown keys and inconsistent thresholds", () => {
    expect(POLICY_SCHEMAS.JOIN_WINDOW.safeParse({ studentOpensBefore: 5 }).success).toBe(false);
    expect(
      POLICY_SCHEMAS.ATTENDANCE.safeParse({ presentThresholdBp: 2000, partialThresholdBp: 5000 })
        .success,
    ).toBe(false);
  });
});

describe("settings validation", () => {
  const body = settings.updateSettings.body;

  it("normalises staff domains and YouTube channel URLs", () => {
    expect(
      body.parse({
        staffEmailDomains: [" GLIM.edu.ng "],
        youtubeChannelUrls: [
          "https://www.youtube.com/@GLIMBibleCollege/",
          "https://www.youtube.com/channel/UC1234567890abcdefghijkl",
        ],
      }),
    ).toEqual({
      staffEmailDomains: ["glim.edu.ng"],
      youtubeChannelUrls: [
        "https://www.youtube.com/@GLIMBibleCollege",
        "https://www.youtube.com/channel/UC1234567890abcdefghijkl",
      ],
    });
  });

  it("rejects other sites, unknown timezones and plain-http links", () => {
    expect(body.safeParse({ youtubeChannelUrls: ["https://vimeo.com/glim"] }).success).toBe(false);
    expect(
      body.safeParse({ youtubeChannelUrls: ["https://www.youtube.com/watch?v=abc"] }).success,
    ).toBe(false);
    expect(body.safeParse({ timezone: "Africa/Atlantis" }).success).toBe(false);
    expect(body.safeParse({ timezone: "Europe/London" }).success).toBe(true);
    expect(body.safeParse({ statementOfFaithUrl: "http://glim.edu.ng/faith" }).success).toBe(false);
    expect(body.safeParse({ staffEmailDomains: ["not a domain"] }).success).toBe(false);
  });
});
