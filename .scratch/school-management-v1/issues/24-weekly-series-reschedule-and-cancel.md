# 24: Weekly series, reschedule and cancel

**What to build:** A Lecturer creates a weekly series once, edits one occurrence or all future ones, reschedules or cancels with a reason, and enrolled students are notified (TRD §11.9).

**Blocked by:** 23 (Schedule a Class Meeting with a Room and online link)

**Status:** done

- [x] Series with an rrule expanded in the institution timezone, idempotent by occurrence date, 8-week horizon extended daily
- [x] Conflict check per occurrence; any conflict rejects the request and lists the dates
- [x] `THIS_ONLY` and `ALL_FUTURE` edits; the default online link copied to occurrences
- [x] Reschedule (`If-Match`) re-checks conflicts; cancel frees the Room; both notify enrollees by email (critical) and in-app

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Series:** `POST /course-offerings/:id/class-meeting-series` (Idempotency-Key) takes `{titleTemplate ("Week {n}"), weekdays, interval?, startsOn, untilOn?, startTime, durationMinutes, roomId?, onlineLink?}` in the institution's timezone.
  - It generates occurrences eight weeks ahead, numbered and idempotent by `(series_id, occurrence_date)`, with the series' online link copied to each.
  - Every date is conflict-checked: any clash refuses the whole series, naming the dates and the meetings in the way. An Academic Admin may override Lecturer clashes with a reason.
  - Expansion is a small weekly-rule expander in scheduling (no RRULE library), with unit tests.
- **Horizon:** the daily `class-meeting.series-extend` job (00:15 Lagos) adds occurrences as they come into range, skipping and auditing any that would clash, and ends a series after its last date.
- **Reschedule:** `PATCH /class-meetings/:id` (If-Match) now also takes `scheduledStart`, `scheduledEnd`, `roomId`, `scope` (`THIS_ONLY`/`ALL_FUTURE`) and an override. It returns `{meeting, warnings, changed}`.
  - Only upcoming SCHEDULED/OPEN meetings move. Once a meeting has started only its title and description change; the link and recording mode can change until it ends.
  - A move re-checks the Room and Lecturers and moves the Lecturer slots.
  - ALL_FUTURE moves the series' later occurrences to the new time of day on their own dates, skips ones changed on their own, and updates the series.
- **Cancel:** `POST /class-meetings/:id/cancel {reason, scope?}` works on SCHEDULED/OPEN only (LIVE is `MEETING_IN_PROGRESS`). It frees the Room and deletes the Lecturer slots. ALL_FUTURE cancels the rest of the series and ends it.
- **Notices:** each reschedule or cancel tells ENROLLED students in-app and by email (critical; templates `meeting.rescheduled` and `meeting.cancelled`), once per change, with times in the student's zone and Lagos alongside. It also emits `meeting.rescheduled` or `meeting.cancelled`, and is audited.
- **Web:** the schedule form has "Repeat weekly" (weekdays, until). The Lecturer's schedule cards have Reschedule and Cancel class, with "just this one" or "this and later" for series.
- **Tests:**
  - `series.itest.ts` (12): creation, numbering and slots; whole-series refusal listing dates; bad weekdays and past start; daily extension, idempotent and skipping a clash; THIS_ONLY reschedule with notification and email in London time; Room clash and stale version; ALL_FUTURE time change; no day change for ALL_FUTURE; cancel freeing Room and Lecturer with notices and state rules; no cancelling a LIVE meeting; ALL_FUTURE cancel ending the series.
  - Weekly-rule unit tests and authz samples for the two new endpoints.
  - Playwright: reschedule then cancel, and a weekly series.

