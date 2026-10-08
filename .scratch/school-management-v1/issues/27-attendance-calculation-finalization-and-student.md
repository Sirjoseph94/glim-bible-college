# 27: Attendance calculation, finalization and student view

**What to build:** Attendance records are computed from roll call (in person or online), finalized when the class ends, locked after 7 days, and students can see their own attendance (TRD §12.5–12.6).

**Blocked by:** 26 (Roll call)

**Status:** done

- [x] Pure `computeAttendance` passes every applicable Appendix C vector, including V11–V14 and an online-mark equivalent of V1
- [x] Persistence writes only computed fields and never the virtual `status` column; advisory lock per meeting; idempotent
- [x] Finalize on End or tick; recompute allowed until the lock; `attendance.finalized` event
- [x] Student attendance view per course; Lecturer per-meeting attendance view

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Pure `computeAttendance`** (`attendance/domain/compute.ts`) implements TRD §12.5 in full: window and padding, conference union, the three bases, short-conference flag, clipping, merging and joins, lateness, and roll call combined.
  - Unit tests cover Appendix C.1 V1–V14, an online-mark V1, late online marks and ordering.
  - v1 feeds it roll call only (spec).
- **Schema** (`0026`, `0027`): `attendance_records`, with `status` as a PG18 VIRTUAL generated column added by hand-written SQL and kept out of the Drizzle table, so nothing writes it.
- **Recompute** (`attendance.recompute` job, queued by each roll-call save):
  - Runs under `pg_advisory_xact_lock(hashtext(meetingId))`.
  - Evaluates students enrolled at any time during the class (dropped-before: no record; joined-during: evaluated).
  - Writes only computed fields that changed (`calc_version + 1`), never overrides or `status`. Idempotent.
  - Moves the meeting to PROVISIONAL, and refuses (`LOCKED`) a week after finalization.
- **Finalize:** a `meeting.ended` subscriber queues `class-meeting.finalize` 10 minutes later (finalize delay). The job recomputes, marks the meeting FINAL with `finalized_at` through class-meeting, and emits `attendance.finalized`. It skips meetings that went live again or are already final.
- **Reads:** `GET /class-meetings/:id/attendance` (records with status, computed, override, mode, late; lock time) for the class's Lecturers and staff; `GET /me/attendance` for students, per course with a summary.
- **Web:**
  - Students see an attendance summary and per-class list on My courses, marked "provisional" until final.
  - Lecturers get `/teach/meetings/:id/attendance`, and each offering on their page lists its Class Meetings with Roll call and Attendance links.
- **Tests:** compute unit tests (18); `attendance.itest.ts` (7: who is evaluated, PROVISIONAL, idempotence and calc_version, the virtual column can't be written, an EXCUSED override survives, End → subscriber → finalize queued 10 minutes out, finalize once with the event, recompute until the lock, both reads and who may see them); authz sample; Playwright: after roll call, the attendance page shows the worker's results.

