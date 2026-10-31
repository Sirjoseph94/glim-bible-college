# Spec: block teaching replaces semesters

Status: ready-for-agent

Source: ADR-0005, `docs/decisions.md` BT-1 to BT-8 (30 October 2026), `GLOSSARY.md`. Where this spec and the TRD differ, **this spec wins** until the TRD is updated (ticket 10).

## Problem

The system assumes GLIM teaches every course side by side within two semesters a year, with Year 1/Year 2 Levels, electives, a yearly November–June intake, and the Certificate and Diploma as separate programmes. GLIM teaches **one course at a time**. A cohort works through the curriculum's courses one after another, and the Certificate is earned halfway through the Diploma.

## Model

- **Programme:** one programme, the Diploma. `programmes` drops `duration_semesters`, `levels` and `award_type`.
- **Curriculum:** the courses, with credits and a **position** (default order). Placements lose `level_no`, `semester_no` and `course_type`, and `curricula` loses `min_elective_credits`. Positions are unique per curriculum (deferrable, so reordering works in one statement).
- **Intake:** `opens_on`, `closes_on`, and a new **`starts_on`** (the cohort's start), with no Academic Session. Application windows of intakes may not overlap (exclusion constraint). The Admissions Officer still manages intakes.
- **Cohort Schedule:** a cohort's offerings, ordered by start date. `course_offerings` loses `semester_id` and `section_code`, and gains `cohort_id`, `starts_on`, `ends_on` and `exam_on` (`starts_on ≤ exam_on ≤ ends_on`).
  - A cohort has at most one live (non-CANCELLED) offering per course.
  - Live offerings of one cohort may not overlap in dates (exclusion constraint).
  - An offering may not start before its intake's `starts_on`. This is checked in the service (422 `BEFORE_INTAKE_START`).
  - **Plan a schedule:** `POST /cohorts/:id/schedule` creates DRAFT offerings for every curriculum course the cohort has no live offering for. The Academic Admin supplies a first start date and a length in weeks, and the offerings are laid end to end in curriculum order, with the exam on the last day. The Academic Admin then edits dates one offering at a time. Reordering means changing dates.
- **Registration:** publishing an offering registers every ACTIVE programme enrollment in its cohort (`selection='COHORT'`) in the same transaction.
  - Accepting an offer registers the new student for their cohort's PUBLISHED and ACTIVE offerings.
  - Manual registration (`selection='MANUAL'`, Academic Admin, with a reason) covers retakes, late joiners' missed courses and transfers, into any offering.
  - Withdraw (Academic Admin, with a reason) → `WITHDRAWN`. There is no `DROPPED` and no add/drop.
  - The `ProgrammeEnrollment → SemesterEnrollment → CourseEnrollment` chain becomes `ProgrammeEnrollment → CourseEnrollment`.
- **Lifecycle:** a daily job (`academic.offering-lifecycle`, 00:10 Lagos) moves PUBLISHED offerings to ACTIVE on or after `starts_on`. The day after `ends_on`, it moves PUBLISHED/ACTIVE offerings to COMPLETED (`completed_at`) and their ENROLLED course enrollments to COMPLETED (with an event row). It is idempotent. Removed: the Academic Session/semester lifecycle, progression, and `semester.open-registration`.
- **Class Meetings:** a meeting's Lagos date must lie within its offering's `starts_on..ends_on` (422 `OUTSIDE_OFFERING_DATES`). Weekly series stop at `ends_on`.
- **Exams:** `exam_on` is the offering's exam date. `exam_makeups (course_offering_id, student_id, makeup_on, reason, set_by)` holds one makeup per student per offering, and is set or changed by a Lecturer on the offering (or an Academic Admin), with a reason and audited. A makeup date must be on or after `exam_on`. While a student has a makeup and no EXAM grade, finalization **skips** them: their result stays unfinalized (shown as *Incomplete — makeup exam on D*) and their grades stay unlocked. Finalizing again later picks them up.
- **Results:**
  - `course_results` loses `semester_id`, `published_at` and status `PUBLISHED`, and gains `completed_on` (the offering's `ends_on`, or the imported date). Statuses: `DRAFT → FINALIZED → APPROVED`.
  - The Registrar approves FINALIZED results for an offering, or for a whole cohort (`POST /results/approve {offeringId | cohortId}`).
  - A CGPA is computed on the fly (repeat policy BEST, exact integers) and is **Provisional** while any result it counts is not APPROVED.
  - `semester_results` and the semester GPA are removed. Standing is computed on the fly.
  - The broadsheet is per cohort: `GET /reports/results?cohortId=&format=csv|json`, one row per student with each course's letter, then credits earned and CGPA.
- **Awards:** `awards` gains `award_type` (`CERTIFICATE`/`DIPLOMA`), unique per programme enrollment and type. Proposing needs every counted result APPROVED.
  - **Certificate:** passed credits ≥ half the curriculum's total credits.
  - **Diploma:** every curriculum course passed. Conferring the Diploma completes the programme enrollment.
  - Both carry the award class from the CGPA at the time. Certificate numbers stay `GLIM/{CERT|DIP}/AWD/{YYYY}/{NNNN}`.
- **Transcripts:** courses in the order completed (`completed_on`, then course code), each with its date. An OFFICIAL transcript needs every counted result APPROVED.
- **Admissions:** applicants no longer choose a programme. An application is for the one ACTIVE programme. Matric Numbers use the intake's start year.
- **Imports:**
  - Students CSV loses `level` and gains `cohort_code`.
  - Course enrollments CSV is `matric_number, course_code, cohort_code` (the offering of that course for that cohort).
  - Legacy results CSV replaces `session_code, semester_code` with `completed_on` (YYYY-MM-DD).
- **Migration:** destructive and forward-only (BT-8). It drops `academic_sessions`, `semesters`, `semester_enrollments` and `semester_results`, plus the columns named above. Production has no academic rows, so the migration refuses to run (rather than deleting anything) if any offering, programme enrollment, course result or award exists; intake start dates and curriculum positions are backfilled from the old sessions and Level/semester order.

## Out of scope

Offerings shared by several cohorts; limits on makeup dates; a per-student online exam window other than the makeup day.

## Testing

Each ticket carries its integration tests, including deny paths. Pure functions (award eligibility, schedule layout, CGPA provisional flag) get unit tests. The constraint tests cover overlapping offerings in a cohort, an exam date outside the offering, and overlapping intake windows.
