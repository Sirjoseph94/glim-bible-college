# 20: Electives, manual registration and drop/withdraw

**What to build:** Students add or drop electives available to their Level and semester until the add/drop deadline. The Academic Admin registers students manually (e.g. retakes) and withdraws them after the deadline, with reasons (TRD §9.3).

**Blocked by:** 19 (Open registration: compulsory courses auto-registered)

**Status:** done

- [x] Elective add/drop within the window only; `ELECTIVE_NOT_AVAILABLE`, `REGISTRATION_CLOSED`
- [x] Optional offering capacity enforced under a row lock (`OFFERING_FULL`); duplicates return `ALREADY_ENROLLED`
- [x] Manual registration (`selection='MANUAL'`) with a reason; withdraw after the deadline with a reason
- [x] Status history in `course_enrollment_events`; a `course.enrollment.ended` event
- [x] Registration UI shows electives with credits and the deadline

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Student electives:** each uses `enrollment:elective:select` on the student's own semester enrollment; the new `semester-enrollment` resource loader supplies the owner.
  - `GET /semester-enrollments/:id/registration` lists the registered courses and the electives (ELECTIVE placements for the Level and semester with a published offering), with credits, capacity, places left and the add/drop deadline.
  - `POST …/electives` adds one; `DELETE …/electives/:courseEnrollmentId` drops one, which becomes DROPPED.
  - The window is open while the semester is REGISTRATION or ACTIVE and today, in Lagos, is on or before `add_drop_deadline_on`; otherwise `REGISTRATION_CLOSED`.
  - Anything that isn't an available elective gives `ELECTIVE_NOT_AVAILABLE`; this covers compulsory courses, which can't be dropped.
- **Capacity:** the offering row is locked `FOR UPDATE` and ENROLLED students are counted (`OFFERING_FULL`). Duplicates are checked first (`ALREADY_ENROLLED`), and the partial unique index still backs it up.
- **Academic Admin** (`enrollment:course-enrollment:read/manage`):
  - `GET /course-offerings/:id/enrollments` is the roster; Lecturers with the roster capability see it too.
  - `POST /course-offerings/:id/enrollments {matricNumber, reason}` registers manually (`selection='MANUAL'`) and creates the semester enrollment if needed.
  - `POST /course-enrollments/:id/withdraw {reason}` sets WITHDRAWN.
  - Both are audited with the reason.
- **History:** every change writes `course_enrollment_events`, with reasons. Adds emit `course.enrollment.activated`; drops and withdrawals emit `course.enrollment.ended`. Attendance and grades are kept.
- **Web:**
  - The student's Registration page lists the electives with credits, places left and the deadline, and Add/Drop buttons; once the window closes, it says to ask the Academic Admin.
  - The admin offering page has a Students section: roster, "Register student" (Matric Number and reason) and Withdraw with a reason.
- **Tests:**
  - `electives.itest.ts`: the offer list, add until full, duplicate, not an elective, drop frees the place, compulsory can't be dropped, owner only, roster, manual registration (case-insensitive Matric, full, unknown), withdraw and a repeat refused, events and ended events, a student can't register manually, and closed after the deadline.
  - Authz samples for all six endpoints (1,157 cases).
  - Playwright: the roster shows on a published offering.
