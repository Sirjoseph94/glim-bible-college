# 05: Meet attendance: conference sync, matching, review

**What to build:** Online attendance from Meet participant sessions, matched to students and fed to `computeAttendance` (TRD §12.1, §12.4–12.7; WP-ATT-1).

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] `conference.sync`: upsert conferences and `provider_participant_sessions` (never delete), run matching, clear `dirty`; at end, +30 min and in finalize
- [ ] Ladder: GOOGLE_ID and MEMBER_EMAIL behind `GOOGLE_MEET.matching` switches (off: S-01 not run); NAME_ASSISTED → SUGGESTED, never counted; MANUAL via `POST /class-meetings/:id/participants/:pid/match` (optionally remembers the Google id), audited, triggers recompute
- [ ] `GET /class-meetings/:id/participants`; ANONYMOUS/PHONE manual only; several Google accounts unioned; non-students (room laptop) kept but excluded
- [ ] Compute feeds conferences + matched intervals; finalize waits for sync; REVIEW_REQUIRED for short conference or unresolved overlap > `unmatchedReviewMinutes`, with a Lecturer notification
- [ ] Appendix C vectors still pass

**Spec:** `.scratch/google-integration/spec.md`
