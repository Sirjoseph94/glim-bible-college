import { describe, expect, it } from "vitest";
import { matchSession, normaliseName, type MatchDirectory, type SessionToMatch } from "./matching";

const directory: MatchDirectory = {
  bySubject: new Map([["111", "user-ada"]]),
  byRememberedId: new Map([["999", "user-ben"]]),
  byEmail: new Map([["ada@gmail.com", "user-ada"]]),
  byName: new Map([
    ["ada obi", ["user-ada"]],
    ["john musa", ["user-john-1", "user-john-2"]],
  ]),
};
const on = { googleId: true, memberEmail: true, nameAssisted: true };
const reviewMode = { googleId: false, memberEmail: false, nameAssisted: true };
const session = (over: Partial<SessionToMatch>): SessionToMatch => ({
  kind: "SIGNED_IN",
  providerUserId: null,
  email: null,
  displayName: null,
  current: { userId: null, method: "NONE", status: "UNMATCHED" },
  ...over,
});

describe("matchSession (TRD §12.4)", () => {
  it("matches the Meet user id to the sign-in subject only when S-01 switched it on", () => {
    const s = session({ providerUserId: "users/111" });
    expect(matchSession(s, directory, on)).toEqual({
      userId: "user-ada",
      method: "GOOGLE_ID",
      status: "CONFIRMED",
    });
    expect(matchSession(s, directory, reviewMode).status).toBe("UNMATCHED");
  });

  it("always uses a Meet id a person confirmed before", () => {
    expect(matchSession(session({ providerUserId: "users/999" }), directory, reviewMode)).toEqual({
      userId: "user-ben",
      method: "GOOGLE_ID",
      status: "CONFIRMED",
    });
  });

  it("matches an exposed email when switched on", () => {
    const s = session({ email: "ADA@gmail.com" });
    expect(matchSession(s, directory, on).method).toBe("MEMBER_EMAIL");
    expect(matchSession(s, directory, reviewMode).method).toBe("NONE");
  });

  it("only suggests a match by name, and only when exactly one student has it", () => {
    expect(matchSession(session({ displayName: "  Ádá  OBI " }), directory, reviewMode)).toEqual({
      userId: "user-ada",
      method: "NAME_ASSISTED",
      status: "SUGGESTED",
    });
    expect(matchSession(session({ displayName: "John Musa" }), directory, on).status).toBe(
      "UNMATCHED",
    );
  });

  it("leaves anonymous and phone participants for a person, and never overrides a manual match", () => {
    expect(
      matchSession(session({ kind: "PHONE", displayName: "Ada Obi" }), directory, on).status,
    ).toBe("UNMATCHED");
    const manual = { userId: "user-x", method: "MANUAL" as const, status: "CONFIRMED" as const };
    expect(
      matchSession(session({ providerUserId: "users/111", current: manual }), directory, on),
    ).toEqual(manual);
  });

  it("normalises names", () => {
    expect(normaliseName("Chinwe-Ọkafor  Jr.")).toBe("chinwe okafor jr");
  });
});
