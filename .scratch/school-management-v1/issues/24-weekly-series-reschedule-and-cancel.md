# 24: Weekly series, reschedule and cancel

**What to build:** A Lecturer creates a weekly series once, edits one occurrence or all future ones, reschedules or cancels with a reason, and enrolled students are notified (TRD §11.9).

**Blocked by:** 23 (Schedule a Class Meeting with a Room and online link)

**Status:** ready-for-agent

- [ ] Series with an rrule expanded in the institution timezone, idempotent by occurrence date, 8-week horizon extended daily
- [ ] Conflict check per occurrence; any conflict rejects the request and lists the dates
- [ ] `THIS_ONLY` and `ALL_FUTURE` edits; the default online link copied to occurrences
- [ ] Reschedule (`If-Match`) re-checks conflicts; cancel frees the Room; both notify enrollees by email (critical) and in-app

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
