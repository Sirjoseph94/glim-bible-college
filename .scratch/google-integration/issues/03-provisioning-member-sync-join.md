# 03: Provisioning, member sync, join, start and end

**What to build:** Class Meetings get a Meet space from the worker, enrolled students and Lecturers are synced as members, and join returns the provisioned link (TRD §11.2, §11.5, §11.6; WP-MEET-4).

**Blocked by:** 01, 02

**Status:** done

- [x] Create/series: with a provider on, insert `provider_status=PENDING` and enqueue `class-meeting.provision` in the same transaction (`singletonKey`, `startAfter = start − provisionLead`); no Google call in the request path (INV-8 test)
- [x] `HostSelector.pick` (fewest overlapping meetings, skips DISABLED/THROTTLED); provision handler per §11.6; permanent failure → `ERROR`, ops failure, notify System Admin (+ Lecturer within 2 h)
- [x] `class-meeting.sync-access`: Lecturers COHOST, ENROLLED students as members by linked Google email; `STUDENT_NO_GOOGLE_ACCOUNT` / `LECTURER_NO_GOOGLE_ACCOUNT` reported; debounced; triggered by provisioning, enrollment and assignment events for meetings within 14 days
- [x] Join: `GOOGLE_ACCOUNT_REQUIRED` for students without a Google identity; `PROVIDER_NOT_READY` + `Retry-After` (priority provision if PENDING and start within 30 min); pasted-link fallback; returns `joinUrl` and `dialIn` (when `FEATURE_PHONE_DIAL_IN`)
- [x] `POST /class-meetings/:id/reprovision`; `/end` enqueues `class-meeting.end` (endActiveConference)
- [x] Reschedule keeps the space; cancel makes no Google call

**Spec:** `.scratch/google-integration/spec.md`

## Comments

**Implemented (2026-10-13).**
- `ProvisioningService` (class-meeting): `queueProvision` in the insert transaction (`MeetingWriter.insert`, so single meetings and series alike), `pickHost` (fewest overlapping meetings per weight), the `class-meeting.provision`, `class-meeting.sync-access` and `class-meeting.end` jobs, `queueSyncForOffering` (worker subscribers on enrollment and assignment events), and `reprovision`.
- Join: `GOOGLE_ACCOUNT_REQUIRED` for students on provider meetings; `PROVIDER_NOT_READY` with `Retry-After: 30` and a priority provision when PENDING within 30 min; a pasted link is used while the space isn't READY; `linkSource` and `dialIn` in the response. Start queues a member sync; End/overrun queue `class-meeting.end`.
- Views carry `providerStatus`, `joinUrl` and `provisionError` (managers only). New notification kinds for staff alerts (provision failed, integration degraded, Drive storage, recording failed, attendance review).
- All queues are now created; a worker only works queues it has handlers for.
- Tests: `google-meet.itest.ts` (15) with `FakeLiveProvider`; reprovision deny paths in authz.
