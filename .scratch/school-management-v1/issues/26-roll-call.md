# 26: Roll call

**What to build:** In the room, a Lecturer opens roll call on a phone, sees enrolled students (On-campus first, with photos), marks each Present in the room, Present online, Late or Absent, and keeps working through flaky Wi-Fi (TRD §12.3, interim modes).

**Blocked by:** 25 (Join, start, end and Class Meeting states)

**Status:** done

- [x] `GET/PUT /class-meetings/:id/roll-call` with `{studentId, present, late, mode}` marks; batch upsert with `If-Match`; audited
- [x] Window: from 15 minutes before the start until finalization + 7 days (`ROLL_CALL_CLOSED`)
- [x] "Mark all on-campus present" bulk action
- [x] Marks queued locally and retried; "Saved / Will retry" indicator; Playwright on a mobile viewport with offline simulation
- [x] Each save enqueues `attendance.recompute`

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Schema** (`0025`): `roll_call_marks` (with the v1 `mode`; late needs present) and `roll_calls` (per-meeting version for `If-Match`).
- **API** (`attendance:roll-call:mark`: assigned Lecturers with the roster capability, Academic and System Admin):
  - `GET /class-meetings/:id/roll-call` returns the version, whether it's open, the window, and the ENROLLED students (on-campus first, then by name). Each has their Matric Number, study mode, a short-lived photo link and their mark.
  - `PUT` saves a batch `{marks:[{studentId, present, late, mode}]}` with `If-Match`. It upserts only what changed, audits with the before/after, publishes `attendance.roll-call.updated` and queues `attendance.recompute`. Students not on the course, late-without-present and stale versions are refused.
- **Window:** from `rollCallOpensBeforeMinutes` (15) before the start until `lockAfterDays` (7) after finalization; otherwise `ROLL_CALL_CLOSED`.
- **Lifecycle:** attendance registers the roll-call check, so a class with marks that never went online becomes ENDED, not NO_SHOW (tick and End).
- **Web:** `/teach/meetings/:id/roll-call` is phone-first. It has photos, In room / Online / Absent and Late, and "Mark all on-campus present". Taps are queued in memory and local storage and sent in batches. On a dropped connection the header says "Offline — will retry", and it retries on a timer and when the browser comes back online. A 412 reloads the roll call and resends. Links to it sit on the Lecturer's meeting cards and the Start screen.
- **Not yet:** the `attendance.recompute` handler comes with ticket 27, so those jobs wait in the queue until then.
- **Tests:** `roll-call.itest.ts` (9: closed before the window, listing order, batch save with audit and recompute job, stale version / stranger / completed student / late-without-present, idempotent resend, who may use it, photo links, ENDED-not-NO_SHOW, lock a week after finalization); authz samples for both endpoints; Playwright on the mobile viewport: bulk on-campus, then a mark while offline, "will retry", back online, "Saved", and the marks survive a reload.

