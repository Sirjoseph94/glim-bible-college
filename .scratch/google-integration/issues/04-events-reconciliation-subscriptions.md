# 04: Events, inbox, reconciliation and subscriptions

**What to build:** Meet events arrive through Pub/Sub into the inbox and drive LIVE/ENDED; reconciliation repairs anything missed (TRD §11.8, INV-6; WP-MEET-5).

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Pub/Sub pull loop in the worker (`google` role): insert `provider_events ON CONFLICT DO NOTHING` + `provider-event.process` in one transaction, ack only after commit
- [ ] Routing per §11.8: conference started/ended → `conference_records` + state machine `CONFERENCE_STARTED`/`CONFERENCE_ENDED`; participant events → `dirty`; recording fileGenerated → `recording.discover`; lifecycle → `subscription.renew`; unroutable → IGNORED
- [ ] `meeting-reconciliation` (3 min): provider meetings near/in their window read `getSpaceStatus`/`listConferences` and apply the same transitions
- [ ] Subscriptions: one per host account; created by the admin wizard/test; `subscription-renewal` (15 min) renews before `expires_at − max(24h, 50%)`
- [ ] Tests: duplicate and out-of-order events; reconciliation repairs a dropped `ended`; renewal

**Spec:** `.scratch/google-integration/spec.md`
