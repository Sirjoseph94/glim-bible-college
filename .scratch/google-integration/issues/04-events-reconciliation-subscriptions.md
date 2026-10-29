# 04: Events, inbox, reconciliation and subscriptions

**What to build:** Meet events arrive through Pub/Sub into the inbox and drive LIVE/ENDED; reconciliation repairs anything missed (TRD §11.8, INV-6; WP-MEET-5).

**Blocked by:** 03

**Status:** done

- [x] Pub/Sub pull loop in the worker (`google` role): insert `provider_events ON CONFLICT DO NOTHING` + `provider-event.process` in one transaction, ack only after commit
- [x] Routing per §11.8: conference started/ended → `conference_records` + state machine `CONFERENCE_STARTED`/`CONFERENCE_ENDED`; participant events → `dirty`; recording fileGenerated → `recording.discover`; lifecycle → `subscription.renew`; unroutable → IGNORED
- [x] `meeting-reconciliation` (3 min): provider meetings near/in their window read `getSpaceStatus`/`listConferences` and apply the same transitions
- [x] Subscriptions: one per host account; created by the admin wizard/test; `subscription-renewal` (15 min) renews before `expires_at − max(24h, 50%)`
- [x] Tests: duplicate and out-of-order events; reconciliation repairs a dropped `ended`; renewal

**Spec:** `.scratch/google-integration/spec.md`

## Comments

**Implemented (2026-10-13).**
- Worker `event-puller.ts`: Pub/Sub pull → `InboxService.receive("google_meet", …)` (one transaction, `ON CONFLICT DO NOTHING`, `provider-event.process` enqueued) → ack. Runs on the google/all role with `GOOGLE_EVENTS_MODE=pull`.
- `InboxService` takes a processor per provider; failures mark the row FAILED (ops page) and retry. `MeetEventsService` (class-meeting) routes by space, then known conference, then `getConference` as each host; upserts `conference_records`; drives LIVE/ENDED through new state-machine events `CONFERENCE_STARTED`/`CONFERENCE_ENDED` (restart within the overrun); participant events only mark `dirty`; recordings queue `recording.discover`; lifecycle events queue `subscription.renew`.
- `meeting.reconcile` (cron every 3 min) repairs lost events, ignoring classes a Lecturer started by hand with no call yet, and restarts after a reconnect. `SubscriptionsService` (cron every 15 min): one per ACTIVE host account with a user id; renews within max(24 h, 50 %); recreates expired/lost ones; records errors.
- Google handlers are registered only when a provider is configured, so their crons are removed otherwise.
- Tests: `meet-events.itest.ts` (9): in order, duplicate, out of order, participant/recording/stray events, reconciliation (start, end, restart, manual start), subscriptions (create, renew, recreate, lifecycle). Unit: puller acks only after storing.
