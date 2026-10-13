# 06: Recording ingest to YouTube

**What to build:** Meet recordings are found, streamed from the host's Drive to GLIM's YouTube channel as unlisted videos, checked and published (TRD §13.1–13.3, §13.8, INV-9; WP-VIDEO-2).

**Blocked by:** 04

**Status:** done

- [x] `YouTubeApiHost`: channel OAuth (refresh token encrypted at rest), resumable upload (`privacyStatus=unlisted`, `selfDeclaredMadeForKids=false`), `getProcessing`, `updateMetadata`, `deleteVideo`; oEmbed methods shared with the link host
- [x] `recording.discover` → `recordings` row + PROCESSING video (`origin=RECORDING`); `recording.ingest` streams `openArtifactStream` → upload (never through the API, no temp file); `video.youtube-processing-sync` with backoff; duration check `≤ max(2 s, 2 %)`; publish per RECORDING policy
- [x] Failures: `SOURCE_MISSING`, FAILED with ops failure; `POST /videos/:id/retry-ingest`
- [x] `recording-reconciliation` (10 min) lists recordings of ended meetings' conferences; `drive.cleanup` only if `DRIVE_CLEANUP_MODE=TRASH_AFTER_INGEST`
- [x] Purge after the 7-day undo deletes on YouTube when the API host is on; metadata edits sync title

**Spec:** `.scratch/google-integration/spec.md`

## Comments

**Implemented (2026-10-13).**
- `VideoHost.channelApi` (port): consent URL, code exchange, channel, upload, processing, metadata, delete; `ChannelAuthError`, `ChannelQuotaError`. `YouTubeApiHost` (YouTube Data API v3 over `fetch`: resumable upload streamed in one request, unlisted, not made for kids, Education) wraps the oEmbed link host. `FakeChannel` on `FakeVideoHost`. `createVideoHost(config)` honours `VIDEO_HOST`.
- The channel's refresh token is sealed (AES-256-GCM, `@glim/shared/secrets`) in `integration_configs.secret_ciphertext` by `IntegrationsService` (ops), which also marks integrations DEGRADED and alerts System Admins.
- `RecordingsService` (video): `recording.discover` → recording + PROCESSING video (link mode only notes the recording); `recording.ingest` streams Drive → YouTube (SOURCE_MISSING; quota waits 6 h; revoked grant degrades; last attempt FAILED); `video.youtube-processing-sync` polls with backoff, then INV-9 (`max(2 s, 2 %)`, against Drive's duration or Meet's times) before publishing per RECORDING policy; `recording.reconcile` (10 min) finds recordings whose event was lost and stuck uploads; `drive.cleanup` only with `TRASH_AFTER_INGEST`; `video.youtube-metadata` copies title edits; purge deletes on YouTube when connected (reminder otherwise). `POST /videos/:id/retry-ingest`; `AdminVideo.ingest`.
- Tests: `recordings.itest.ts` (10); `youtube-api.test.ts` (scripted fetch); sealed-secret tests; authz sample.
