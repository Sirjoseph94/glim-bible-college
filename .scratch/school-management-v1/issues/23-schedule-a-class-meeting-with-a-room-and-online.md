# 23: Schedule a Class Meeting with a Room and online link

**What to build:** A Lecturer schedules a Class Meeting with a Room and a pasted Meet link. The system blocks double-booking of the Lecturer or the Room, warns about student clashes, and students see it on their schedule in their own timezone (TRD §9.5, §11, interim online link).

**Blocked by:** 10 (Lecturers, Course Offerings and lecturer assignments); 19 (Open registration: compulsory courses auto-registered)

**Status:** done

- [x] Class Meeting create (`Idempotency-Key`) with an optional Room and an optional `online_link` (must be `https://meet.google.com/...`, else `ONLINE_LINK_INVALID`)
- [x] `meeting_lecturer_slots` with the `no_lecturer_overlap` exclusion constraint; admin override with a reason
- [x] `no_room_double_booking` exclusion constraint; concurrent creates for the same Room or Lecturer: the second fails (`ROOM_CONFLICT` / `LECTURER_SCHEDULE_CONFLICT`)
- [x] Student-clash warnings returned (non-blocking)
- [x] Student home/schedule shows upcoming meetings with the Room and "(Lagos time)" when the zone differs; Lecturer schedule screen

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Schema** (`0022`, `0023`): `class_meeting_series` and `class_meetings` (with `online_link`; provider columns nullable and unused), and `meeting_lecturer_slots`. Hand-written exclusion constraints `no_room_double_booking` (ignores CANCELLED) and `no_lecturer_overlap` (ignores overrides).
- **Modules:**
  - `scheduling` books every active Lecturer of the offering into `meeting_lecturer_slots`, finds the meetings in the way, and computes the student-clash warning. It also keeps slots in step with assignments (§9.4) through a listener `AssignmentsService.onAssignmentChange`.
  - `class-meeting` creates, reads and updates meetings and builds `/me/schedule`. It registers the `class-meeting` resource loader.
- **API:**
  - `POST /course-offerings/:id/class-meetings` (Idempotency-Key) returns `{meeting, warnings}`. It checks the Room and Lecturers up front and lists conflicts in the error envelope's new `conflicts` field; the constraints catch races.
  - Links must be `https://meet.google.com/…` (`ONLINE_LINK_INVALID`); an empty link clears it.
  - An Academic Admin may pass `overrideConflicts` with a `reason`; the slots are written with `override=true` and the reason is audited.
  - `GET /course-offerings/:id/class-meetings`, `GET`/`PATCH /class-meetings/:id` (If-Match), `GET /me/schedule`. Students see `hasOnlineLink` but not the link.
  - Each create publishes `meeting.scheduled` and is audited.
- **Web:** home lists the next two weeks' Class Meetings with the Room, and times in the viewer's zone with Lagos alongside. The Lecturer's page shows "My teaching schedule" and a "Schedule a Class Meeting" form per offering (times typed in the institution's zone, via the new `zonedToInstant`), which shows conflicts and student-clash warnings.
- **Bug avoided:** `ON CONFLICT DO NOTHING` also swallows exclusion violations, so adding a busy Lecturer would have silently double-booked them. Existing slots are skipped with `NOT EXISTS` instead.
- **For ticket 24:** cancelling must delete the meeting's Lecturer slots, because `no_lecturer_overlap` doesn't look at meeting state.
- **Tests:** `meetings.itest.ts` (16: create, slots, events, audit, link rules, time rules, who may schedule, Room conflict with listing and back-to-back, Lecturer conflict and override rules, concurrent Room and Lecturer bookings, student-clash warning, schedules for students and Lecturers, list visibility, PATCH with If-Match, assignment add/end updating slots); authz samples for four endpoints; `zonedToInstant` unit tests; Playwright: a Lecturer schedules a meeting in a Room and sees it on their schedule and home.

