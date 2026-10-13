# 06: Recording ingest to YouTube

**What to build:** Meet recordings are found, streamed from the host's Drive to GLIM's YouTube channel as unlisted videos, checked and published (TRD §13.1–13.3, §13.8, INV-9; WP-VIDEO-2).

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] `YouTubeApiHost`: channel OAuth (refresh token encrypted at rest), resumable upload (`privacyStatus=unlisted`, `selfDeclaredMadeForKids=false`), `getProcessing`, `updateMetadata`, `deleteVideo`; oEmbed methods shared with the link host
- [ ] `recording.discover` → `recordings` row + PROCESSING video (`origin=RECORDING`); `recording.ingest` streams `openArtifactStream` → upload (never through the API, no temp file); `video.youtube-processing-sync` with backoff; duration check `≤ max(2 s, 2 %)`; publish per RECORDING policy
- [ ] Failures: `SOURCE_MISSING`, FAILED with ops failure; `POST /videos/:id/retry-ingest`
- [ ] `recording-reconciliation` (10 min) lists recordings of ended meetings' conferences; `drive.cleanup` only if `DRIVE_CLEANUP_MODE=TRASH_AFTER_INGEST`
- [ ] Purge after the 7-day undo deletes on YouTube when the API host is on; metadata edits sync title

**Spec:** `.scratch/google-integration/spec.md`
