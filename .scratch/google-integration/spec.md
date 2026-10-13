# Spec: the Google integration slice (Meet, Meet attendance, recording ingest to YouTube)

Status: ready-for-agent

Source documents: `docs/TRD.md` (v3.0) §11, §12.4–12.6, §13.1–13.3, §13.8, §15.3, §17, §19.2, §22.3, Appendix A.1–A.2, A.4.5 and Appendix B; `GLOSSARY.md`; `docs/decisions.md` (C-05, C-16, C-26, C-39, C-43, D-07, D-09, Q-02); ADR-0003. This slice is the follow-up named in `.scratch/school-management-v1/spec.md` → "Follow-up slice: Google Meet integration". **The TRD is the spec here**; this file records only scope, ordering and the decisions the TRD leaves open.

## Problem

v1 ships with the Lecturer pasting a Meet link, online attendance marked by hand at roll call, and recordings uploaded by hand in YouTube Studio. The college wants the LMS to create the Meet space, let enrolled students in without knocking, count online attendance from Meet, and put the recording on YouTube by itself.

## Scope

Everything the v1 spec deferred:

- **WP-MEET-1** `LiveProvider` port, `FakeLiveProvider`, the shared contract suite.
- **WP-MEET-2** the Google adapter: DWD auth, Meet / Drive / Workspace Events / Pub/Sub clients, the `rl_acquire` limiter, the retry taxonomy and the per-host circuit breaker.
- **WP-MEET-4** host accounts, provisioning, member sync, join with the provider link, `GOOGLE_ACCOUNT_REQUIRED`, `PROVIDER_NOT_READY`, reprovision, dial-in, `class-meeting.end`.
- **WP-MEET-5** the Pub/Sub pull subscriber, `provider-event.process` routing, event-driven LIVE/ENDED, reconciliation, Workspace Events subscriptions and renewal.
- **WP-ATT-1** `conference.sync`, raw participant sessions, the matching ladder, the participants API and manual match, and finalize with the review flags turned on.
- **WP-VIDEO-2** `YouTubeApiHost` (channel OAuth, resumable upload, processing, metadata, delete), `recordings`, `recording.discover` / `recording.ingest` / `video.youtube-processing-sync`, the INV-9 duration check, recording reconciliation, `drive.cleanup` (off by default) and `POST /videos/:id/retry-ingest`.
- **§15.3 admin**: the Google integration status, test and wizard; the YouTube channel connection; ops failures and replay for the new kinds.
- The web screens these need.

Out of scope: running the spikes or the Google Cloud / Workspace setup (WP-GOOG-0 and WP-VIDEO-0 are human-assisted; see below), audio-only (D-09), and push-mode Workspace Events (`GOOGLE_EVENTS_MODE=push`, off by default in the TRD).

## Decisions this spec makes

1. **Switch, default off.** A new env var `LIVE_PROVIDER` (`none | google_meet | fake`, default `none`). With `none` the app behaves exactly as v1: pasted links, no provisioning, no `GOOGLE_ACCOUNT_REQUIRED`. With `google_meet` new Class Meetings get `provider='google_meet'`, `provider_status='PENDING'` and a provision job. Existing meetings keep `provider IS NULL` and their pasted link. The integration ships dark, and the System Admin turns it on after Appendix A and the spikes. The same applies to `VIDEO_HOST=youtube_api`: link-based adding keeps working under it.
2. **The pasted link stays as a manual fallback.** When a provider meeting isn't `READY` and the Lecturer has pasted an `online_link`, join returns the pasted link instead of `PROVIDER_NOT_READY`. TRD §11.10 leaves the "link being prepared" state with no way out; this gives one.
3. **Spikes are not run.** As Appendix B allows, code runs behind the port with the fake and records its assumptions. Matching is in **review mode** by default (Q-02): `GOOGLE_ID` and `MEMBER_EMAIL` are switched by the `GOOGLE_MEET` policy (`matching.googleId`, `matching.memberEmail`, both `false`), and `NAME_ASSISTED` + `MANUAL` are always on. The System Admin turns `googleId` on once S-01 passes.
4. **No Google SDKs.** The adapter calls the REST APIs over `fetch`, as the SendGrid adapter does. The DWD JWT-bearer assertion is signed with `jose` (already a dependency) instead of `google-auth-library`, and Pub/Sub uses REST synchronous pull. Recorded in `docs/implementation-notes.md`.
5. **Channel OAuth token.** The YouTube channel's refresh token is the one secret that can't be an env var (it comes from a consent screen). It is stored AES-256-GCM-encrypted under `TOKEN_ENCRYPTION_KEY` in `integration_configs.secret_ciphertext`, and is never returned or logged.
6. **Host accounts are managed in the app** (`GET/POST /admin/integrations/google/host-accounts`, `PATCH …/:id`), behind `ops:integration:manage`. The TRD lists the table but no endpoint.
7. **The state machine gains provider events** `CONFERENCE_STARTED` and `CONFERENCE_ENDED` (§11.4 rows). Start/End/tick stay as they are; `/end` on a provider meeting also enqueues `class-meeting.end`.

## Ordering (tickets)

01 port + fake + schema + config → 02 Google adapter → 03 provisioning, member sync, join → 04 events, reconciliation, subscriptions → 05 Meet attendance → 06 recording ingest to YouTube → 07 admin integration screens and ops → 08 web screens → 09 docs and runbook.

## Human prerequisites (not code)

- WP-GOOG-0: Appendix A.1–A.2 and spikes S-01/02/03/04/05/08/09, recorded in `docs/spikes/`.
- WP-VIDEO-0: S-Y1, the YouTube API Services audit and quota (A.4.5). Until the audit passes, uploads are locked to private, so `VIDEO_HOST` stays `youtube_link`.

## Testing

- One contract suite runs against `FakeLiveProvider` and against `GoogleMeetProvider` pointed at an in-process `FakeGoogleServer` (HTTP), so the fake can't drift from the adapter's wire behaviour. The same holds for `YouTubeApiHost`.
- Integration tests (Testcontainers / local PG 18) with `LIVE_PROVIDER=fake`: INV-8 (no Google call in the request path), provisioning retry → ERROR → reprovision, member sync, `GOOGLE_ACCOUNT_REQUIRED`, `PROVIDER_NOT_READY` and the fallback, duplicate and out-of-order events, reconciliation repairing a dropped event, conference sync, each matching strategy, room-laptop exclusion, finalize → REVIEW_REQUIRED, recording discover → ingest → processing → publish, the INV-9 mismatch, `SOURCE_MISSING`, and deny paths on every new endpoint.
- No test calls Google.
