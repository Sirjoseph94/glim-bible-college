# 25: Join, start, end and Class Meeting states

**What to build:** Students get the online link only inside the join window; Lecturers start and end classes; meetings move through their states automatically, including no-shows (TRD §11.4, §11.6, interim).

**Blocked by:** 23 (Schedule a Class Meeting with a Room and online link)

**Status:** done

- [x] `POST /class-meetings/:id/join` is database-only: authorize, window check, join log, returns `{onlineLink, room, window}` or `ONLINE_LINK_NOT_SET`
- [x] Pure state machine with exhaustive table tests (interim triggers: Start, End, tick)
- [x] `meeting-tick` cron: SCHEDULED→OPEN, LIVE→ENDED after max overrun, NO_SHOW when never started and no roll call
- [x] Start/End endpoints for assigned Lecturers; Start screen shows the room-laptop instruction and the recording notice
- [x] Unenrolled users never receive a link (AC-04)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **State machine:** `class-meeting/state-machine.ts` holds `transition(state, event, ctx)` and `tickEvent(...)`. It covers every state × event in table tests (44), plus the context cases: roll call without going online, a restart within the overrun, and LIVE cancel → `MEETING_IN_PROGRESS`. Cancel now goes through it too.
- **Join:** `POST /class-meetings/:id/join` (rate class `join`) is database-only.
  - It authorizes `meeting:class-meeting:join` (students must be ENROLLED) and refuses CANCELLED/NO_SHOW.
  - Window: students from 15 minutes before to 60 after, or any time while LIVE; staff from 60 before to the maximum overrun. Values come from the meeting's policy snapshot.
  - Every attempt is logged in `meeting_join_log`. It returns `{meetingId, state, onlineLink, role, window, room}` or `ONLINE_LINK_NOT_SET`.
  - Anyone not entitled gets 404 and never a link (AC-04).
- **Start/End:** `POST …/start` (from 60 minutes before) returns the meeting, the link and the RECORDING notice; `POST …/end`. Each is audited and publishes `meeting.started`/`meeting.ended`. An accidental end can be restarted within the overrun.
- **Tick:** the `meeting.tick` handler (cron every minute) opens classes as the join window starts, ends LIVE classes after the maximum overrun, and closes classes an hour after their end: NO_SHOW if never started and no roll call, otherwise ENDED. Attendance registers the roll-call check (`registerRollCallCheck`) in ticket 26.
- **Web:** students get "Join online" on their home cards. Lecturers get "Start class", which shows the room-laptop instruction, the recording notice, "Open Google Meet" and "End class".
- **Tests:** state-machine table tests; `lifecycle.itest.ts` (window edges and the join log, AC-04 for six non-entitled personas and anonymous, staff window, link not set, start window and who may start, start twice, joining a LIVE class late, end and restart, cancelled meetings, the tick's open, no-show and overrun); authz samples for the three endpoints; Playwright: start a class, see the instructions, end it.

