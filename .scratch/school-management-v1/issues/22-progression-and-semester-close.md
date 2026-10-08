# 22: Progression and semester close

**What to build:** Activating a new Academic Session moves Year 1 Diploma students to Year 2. Closing a semester completes its offerings and enrollments and queues results computation (TRD §9.1, D-03).

**Blocked by:** 19 (Open registration: compulsory courses auto-registered)

**Status:** done

- [x] Session activation runs `academic.progression` idempotently, audited per enrollment
- [x] Semester close marks offerings COMPLETED (`completed_at`) and ENROLLED course enrollments COMPLETED, and emits `academic.semester.closed`
- [x] Completed enrollments keep read-only access to materials and recordings while the programme enrollment is active (test)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Semester close:** `POST /semesters/:id/close` now completes the semester in one transaction. PUBLISHED and ACTIVE offerings become COMPLETED with `completed_at`; DRAFT and CANCELLED ones are untouched. ENROLLED course enrollments become COMPLETED with a `course_enrollment_events` row ("Semester closed"). `academic.semester.closed` is emitted as before.
  - Enrollment owns course enrollments, so it registers a close step with `CalendarService.onSemesterClose` at startup (the same pattern as `CurriculaService.registerUsage`).
  - Results computation is not queued yet: ticket 38 adds the `results.compute-semester` handler and subscribes it to `academic.semester.closed`.
- **Progression:** activating an Academic Session publishes `academic.session.activated`; a worker subscriber enqueues `academic.progression`, which runs `ProgressionService.run`. It moves ACTIVE Level 1 enrollments on programmes with a second Level, from an earlier entry session, to Level 2, with one audit row each (`enrollment.programme-enrollment.progressed`). It does nothing unless the session is ACTIVE and is idempotent.
- **Read-only access after completion:** already provided by `v_offering_access` and the E/C matrix rules; now covered by a test.
- **Tests:** `progression.itest.ts` (close completes offerings and enrollments, leaves draft/cancelled/dropped alone, writes events, emits the event; can't close twice; completed students keep material and recording access but can't join or attempt, and lose it when the programme enrollment ends; progression skips an inactive session, moves only the right students, audits each, and a rerun moves no one). Worker: the subscriber hands activation to `academic.progression`.

