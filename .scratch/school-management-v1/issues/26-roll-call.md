# 26: Roll call

**What to build:** In the room, a Lecturer opens roll call on a phone, sees enrolled students (On-campus first, with photos), marks each Present in the room, Present online, Late or Absent, and keeps working through flaky Wi-Fi (TRD §12.3, interim modes).

**Blocked by:** 25 (Join, start, end and Class Meeting states)

**Status:** ready-for-agent

- [ ] `GET/PUT /class-meetings/:id/roll-call` with `{studentId, present, late, mode}` marks; batch upsert with `If-Match`; audited
- [ ] Window: from 15 minutes before the start until finalization + 7 days (`ROLL_CALL_CLOSED`)
- [ ] "Mark all on-campus present" bulk action
- [ ] Marks queued locally and retried; "Saved / Will retry" indicator; Playwright on a mobile viewport with offline simulation
- [ ] Each save enqueues `attendance.recompute`

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
