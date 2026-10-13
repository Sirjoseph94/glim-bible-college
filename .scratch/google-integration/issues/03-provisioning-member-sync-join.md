# 03: Provisioning, member sync, join, start and end

**What to build:** Class Meetings get a Meet space from the worker, enrolled students and Lecturers are synced as members, and join returns the provisioned link (TRD §11.2, §11.5, §11.6; WP-MEET-4).

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] Create/series: with a provider on, insert `provider_status=PENDING` and enqueue `class-meeting.provision` in the same transaction (`singletonKey`, `startAfter = start − provisionLead`); no Google call in the request path (INV-8 test)
- [ ] `HostSelector.pick` (fewest overlapping meetings, skips DISABLED/THROTTLED); provision handler per §11.6; permanent failure → `ERROR`, ops failure, notify System Admin (+ Lecturer within 2 h)
- [ ] `class-meeting.sync-access`: Lecturers COHOST, ENROLLED students as members by linked Google email; `STUDENT_NO_GOOGLE_ACCOUNT` / `LECTURER_NO_GOOGLE_ACCOUNT` reported; debounced; triggered by provisioning, enrollment and assignment events for meetings within 14 days
- [ ] Join: `GOOGLE_ACCOUNT_REQUIRED` for students without a Google identity; `PROVIDER_NOT_READY` + `Retry-After` (priority provision if PENDING and start within 30 min); pasted-link fallback; returns `joinUrl` and `dialIn` (when `FEATURE_PHONE_DIAL_IN`)
- [ ] `POST /class-meetings/:id/reprovision`; `/end` enqueues `class-meeting.end` (endActiveConference)
- [ ] Reschedule keeps the space; cancel makes no Google call

**Spec:** `.scratch/google-integration/spec.md`
