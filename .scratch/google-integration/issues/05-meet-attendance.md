# 05: Meet attendance: conference sync, matching, review

**What to build:** Online attendance from Meet participant sessions, matched to students and fed to `computeAttendance` (TRD §12.1, §12.4–12.7; WP-ATT-1).

**Blocked by:** 04

**Status:** done

- [x] `conference.sync`: upsert conferences and `provider_participant_sessions` (never delete), run matching, clear `dirty`; at end, +30 min and in finalize
- [x] Ladder: GOOGLE_ID and MEMBER_EMAIL behind `GOOGLE_MEET.matching` switches (off: S-01 not run); NAME_ASSISTED → SUGGESTED, never counted; MANUAL via `POST /class-meetings/:id/participants/:pid/match` (optionally remembers the Google id), audited, triggers recompute
- [x] `GET /class-meetings/:id/participants`; ANONYMOUS/PHONE manual only; several Google accounts unioned; non-students (room laptop) kept but excluded
- [x] Compute feeds conferences + matched intervals; finalize waits for sync; REVIEW_REQUIRED for short conference or unresolved overlap > `unmatchedReviewMinutes`, with a Lecturer notification
- [x] Appendix C vectors still pass

**Spec:** `.scratch/google-integration/spec.md`

## Comments

**Implemented (2026-10-13).**
- `attendance/domain/matching.ts`: the ladder (pure, unit-tested). GOOGLE_ID (sign-in `sub`) and MEMBER_EMAIL follow the GOOGLE_MEET policy switches (off: review mode, Q-02); NAME_ASSISTED suggests only on an exact, unique normalised Google name; MANUAL is never overwritten; anonymous and phone participants only by hand.
- `ParticipantsService`: the `conference.sync` job (upsert sessions, never delete; rematch; mark the conference synced; recompute), `GET /class-meetings/:id/participants` and `POST …/participants/:pid/match` (`attendance:participant:resolve`; `userId: null` = "not on this course"; `remember`).
- Remembered Meet ids live in `participant_aliases` (attendance), **not** `identities`: a staff member's match must never become a way to sign in. They match automatically in later classes (they are Meet's own ids, so S-01 doesn't gate them).
- `AttendanceService`: Meet conferences and confirmed sessions of enrolled students feed `computeAttendance`; people matched who aren't students (the room laptop) count for nobody. Finalize reads every conference again first, then sets REVIEW_REQUIRED (short call with students lacking roll call, or someone unresolved for over `unmatchedReviewMinutes`) and notifies the Lecturers; a recompute that resolves everything turns it FINAL. Pasted-link meetings behave as in v1.
- Tests: `meet-attendance.itest.ts` (7) through the worker's real handlers and subscribers; authz samples for both endpoints; Appendix C vectors unchanged.
