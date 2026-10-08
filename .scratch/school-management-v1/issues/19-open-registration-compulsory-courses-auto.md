# 19: Open registration: compulsory courses auto-registered

**What to build:** When the Academic Admin opens a semester's registration, every active student is registered for their compulsory courses, and students see their registered courses for the semester (TRD §9.3, AC-03).

**Blocked by:** 10 (Lecturers, Course Offerings and lecturer assignments); 16 (Offer acceptance creates the student)

**Status:** done

- [x] `semester.open-registration` (idempotent, per programme enrollment) creates the semester enrollment and course enrollments (`selection='COMPULSORY'`) for published offerings at the student's Level/semester
- [x] A missing offering produces an ops warning and a notification to the Academic Admin
- [x] Students accepted after registration opened are registered inside the acceptance transaction
- [x] Course-enrollment consistency trigger (student and programme enrollment match the semester enrollment)
- [x] The Student authorization path via `v_offering_access` is implemented with deny tests (ENROLLED vs COMPLETED rules)
- [x] Student `/registration` and `/courses` pages

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Schema (0019, 0020):** `semester_enrollments`, `course_enrollments` (`one_live_course_enrollment`) and `course_enrollment_events`.
  - A `course_enrollment_consistency` trigger requires the student and programme enrollment to match the semester enrollment, and the offering to be in that semester.
  - `v_offering_access` now unions the STUDENT rows: ENROLLED or COMPLETED course enrollments of ACTIVE students on ACTIVE programme enrollments.
- **Opening registration:** `CalendarService.openRegistration` raises `academic.semester.registration-opened`. A worker subscriber enqueues `semester.open-registration`; it gets its own 30-minute expiry, unlike the 2-minute domain-event queue.
- **The job (`RegistrationService.openRegistration`):** covers every ACTIVE programme enrollment whose entry session started on or before the semester's, each in its own transaction, and is idempotent.
  - It creates the semester enrollment at the current Level, then registers each COMPULSORY placement for that Level and semester that has a PUBLISHED or ACTIVE offering (`selection = 'COMPULSORY'`).
  - Each registration writes an event and `course.enrollment.activated`.
  - It returns an outcome per course. Courses with no offering are logged as an ops warning, and each Academic Admin gets an in-app notice, deduplicated per course and semester.
- **Late acceptances:** if the entry session's first semester is already in REGISTRATION or ACTIVE, `AcceptanceService` registers the new student inside the acceptance transaction (§10.4 step 5, so the deferral note is removed).
- **Student authorization path:** `any` means any active student; `E` or `E/C` means a STUDENT row on the resource's offering in the allowed status; `own` checks ownership.
  - The persona world gains `sEnrolled`, `sCompleted`, `sOther` and `sGraduated`, and the generated oracle models the student rules (1,067 cases).
- **API and web:**
  - `GET /me/registration` returns the student's programmes, Level and courses per semester.
  - Students see their offerings through the existing `GET /course-offerings`.
  - The web has `/registration` and `/courses` pages, linked in the nav for students.
- **Tests:**
  - `registration.itest.ts`: registration on open, idempotent re-run, missing-offering notice, late acceptance, the student's visible offerings, and the trigger rejecting mismatches.
  - Worker: the subscriber enqueues the job.
  - Playwright: a new student sees "Registration hasn't opened yet".
