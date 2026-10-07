# 25: Join, start, end and Class Meeting states

**What to build:** Students get the online link only inside the join window; Lecturers start and end classes; meetings move through their states automatically, including no-shows (TRD §11.4, §11.6, interim).

**Blocked by:** 23 (Schedule a Class Meeting with a Room and online link)

**Status:** ready-for-agent

- [ ] `POST /class-meetings/:id/join` is database-only: authorize, window check, join log, returns `{onlineLink, room, window}` or `ONLINE_LINK_NOT_SET`
- [ ] Pure state machine with exhaustive table tests (interim triggers: Start, End, tick)
- [ ] `meeting-tick` cron: SCHEDULED→OPEN, LIVE→ENDED after max overrun, NO_SHOW when never started and no roll call
- [ ] Start/End endpoints for assigned Lecturers; Start screen shows the room-laptop instruction and the recording notice
- [ ] Unenrolled users never receive a link (AC-04)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
