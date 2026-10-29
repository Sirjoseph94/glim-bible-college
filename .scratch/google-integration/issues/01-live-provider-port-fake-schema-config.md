# 01: LiveProvider port, fake, schema and config

**What to build:** The `LiveProvider` port (TRD §11.1) with domain-neutral types, a scriptable `FakeLiveProvider`, the shared contract suite; the integration-slice tables and config, all dark behind `LIVE_PROVIDER=none` (WP-MEET-1).

**Blocked by:** —

**Status:** done

- [x] `packages/integrations/src/live-provider/{port,fake}.ts` + contract suite (`contract.ts`) runnable against any adapter
- [x] Tables: `provider_host_accounts`, `provider_subscriptions`, `conference_records`, `provider_participant_sessions`, `recordings`, `integration_configs` (+ `secret_ciphertext`); FK `class_meetings.host_account_id`; `videos.recording_id` FK
- [x] Config: `LIVE_PROVIDER`, `GOOGLE_PROJECT_ID`, `GOOGLE_SA_KEY_JSON_B64`, `GOOGLE_PUBSUB_SUBSCRIPTION`, `GOOGLE_EVENTS_MODE`, `YOUTUBE_OAUTH_CLIENT_ID/SECRET`, `TOKEN_ENCRYPTION_KEY` (required in production only when the matching switch is on)
- [x] `GOOGLE_MEET` policy schema (space config, provisionLead, matching switches) with defaults
- [x] `LIVE_PROVIDER` bound through `PlatformModule`

**Spec:** `.scratch/google-integration/spec.md`
