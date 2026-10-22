/**
 * The participant → person matching ladder (TRD §12.4), pure. Strategies run in order; the first
 * that answers wins. A MANUAL match is never overwritten. NAME_ASSISTED only suggests: a
 * suggestion isn't counted until a person confirms it.
 */

export type MatchMethod = "NONE" | "GOOGLE_ID" | "MEMBER_EMAIL" | "NAME_ASSISTED" | "MANUAL";
export type MatchStatus = "UNMATCHED" | "SUGGESTED" | "CONFIRMED";

export interface SessionToMatch {
  kind: "SIGNED_IN" | "ANONYMOUS" | "PHONE";
  /** `users/123` as Meet reports it. */
  providerUserId: string | null;
  email: string | null;
  displayName: string | null;
  current: { userId: string | null; method: MatchMethod; status: MatchStatus };
}

export interface MatchDirectory {
  /** Google `sub` (from sign-in) → user. Used only with `googleId` on (S-01). */
  bySubject: ReadonlyMap<string, string>;
  /** Meet user ids a person confirmed before → user (always on: they are Meet's own ids). */
  byRememberedId: ReadonlyMap<string, string>;
  /** Linked Google email (lower case) → user. */
  byEmail: ReadonlyMap<string, string>;
  /** Normalised Google name → the enrolled students' users with that name. */
  byName: ReadonlyMap<string, readonly string[]>;
}

export interface MatchSwitches {
  googleId: boolean;
  memberEmail: boolean;
  nameAssisted: boolean;
}

export interface MatchResult {
  userId: string | null;
  method: MatchMethod;
  status: MatchStatus;
}

/** Lower case, accents removed, punctuation dropped, single spaces. */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The numeric part of `users/123`. */
export function meetUserId(providerUserId: string): string {
  return providerUserId.replace(/^users\//, "");
}

export function matchSession(
  session: SessionToMatch,
  directory: MatchDirectory,
  switches: MatchSwitches,
): MatchResult {
  if (session.current.method === "MANUAL") return session.current;
  // Anonymous and phone participants can only be matched by hand.
  if (session.kind !== "SIGNED_IN") return { userId: null, method: "NONE", status: "UNMATCHED" };

  if (session.providerUserId !== null) {
    const id = meetUserId(session.providerUserId);
    const remembered = directory.byRememberedId.get(id);
    if (remembered !== undefined)
      return { userId: remembered, method: "GOOGLE_ID", status: "CONFIRMED" };
    if (switches.googleId) {
      const user = directory.bySubject.get(id);
      if (user !== undefined) return { userId: user, method: "GOOGLE_ID", status: "CONFIRMED" };
    }
  }
  if (switches.memberEmail && session.email !== null) {
    const user = directory.byEmail.get(session.email.toLowerCase());
    if (user !== undefined) return { userId: user, method: "MEMBER_EMAIL", status: "CONFIRMED" };
  }
  if (switches.nameAssisted && session.displayName !== null) {
    const candidates = directory.byName.get(normaliseName(session.displayName)) ?? [];
    if (candidates.length === 1)
      return { userId: candidates[0] ?? null, method: "NAME_ASSISTED", status: "SUGGESTED" };
  }
  return { userId: null, method: "NONE", status: "UNMATCHED" };
}
