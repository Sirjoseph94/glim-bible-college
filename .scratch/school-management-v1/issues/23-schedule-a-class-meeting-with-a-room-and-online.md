# 23: Schedule a Class Meeting with a Room and online link

**What to build:** A Lecturer schedules a Class Meeting with a Room and a pasted Meet link. The system blocks double-booking of the Lecturer or the Room, warns about student clashes, and students see it on their schedule in their own timezone (TRD §9.5, §11, interim online link).

**Blocked by:** 10 (Lecturers, Course Offerings and lecturer assignments); 19 (Open registration: compulsory courses auto-registered)

**Status:** ready-for-agent

- [ ] Class Meeting create (`Idempotency-Key`) with an optional Room and an optional `online_link` (must be `https://meet.google.com/...`, else `ONLINE_LINK_INVALID`)
- [ ] `meeting_lecturer_slots` with the `no_lecturer_overlap` exclusion constraint; admin override with a reason
- [ ] `no_room_double_booking` exclusion constraint; concurrent creates for the same Room or Lecturer: the second fails (`ROOM_CONFLICT` / `LECTURER_SCHEDULE_CONFLICT`)
- [ ] Student-clash warnings returned (non-blocking)
- [ ] Student home/schedule shows upcoming meetings with the Room and "(Lagos time)" when the zone differs; Lecturer schedule screen

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
