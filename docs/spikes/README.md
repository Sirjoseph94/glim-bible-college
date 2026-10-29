# Spikes

Each spike checks an assumption against a real service (TRD Appendix B) and is recorded here as `S-xx.md`: what was tried, the evidence, and the decision. Until a spike is closed, the code runs on the assumption below, behind the port and its fake.

## The Google integration's open spikes

The integration slice (`.scratch/google-integration/`) was built without a real Workspace. When a spike's result differs from its assumption, change the code it names.

| Spike | Assumption in the code | Where | If it fails |
|---|---|---|---|
| **S-01** Meet's participant ID for Gmail accounts | Unknown, so matching runs in **review mode**: `GOOGLE_MEET.matching.googleId` and `memberEmail` are off. Name matches are only suggestions; Lecturers confirm. Meet IDs a Lecturer confirmed are remembered (`participant_aliases`) | `packages/modules/src/attendance/domain/matching.ts` | Keep review mode (the default). If it passes, switch `googleId` on in **Settings → Google Meet**. |
| **S-02** One host account owns many spaces; auto-recording starts when the co-host Lecturer joins; dial-in | Yes to both. Meet's REST API returns no dial-in numbers, so "Join by phone" says it isn't available | `packages/integrations/src/google/meet-provider.ts` (`provisionSpace`) | Change the host pool size. If Meet does give numbers, map them in `provisionSpace`. |
| **S-03** In `RESTRICTED` spaces, members join without knocking; the members API | Members are managed at `v2/spaces/{id}/members` with `{ email, role }` (`COHOST` for Lecturers) | `meet-provider.ts` (`syncAccess`) | Sync staff only; the host admits students from the lobby (TRD Appendix B). |
| **S-04** User-target Workspace Events subscriptions for API-created spaces | One subscription per host account on `//cloudidentity.googleapis.com/users/{id}`, which needs the host's numeric user ID; CloudEvents attributes on Pub/Sub messages; renewal with `ttl: 0s` | `packages/integrations/src/google/events.ts`, `meet-provider.ts` (`subscribe`) | Run on reconciliation alone (every 3 minutes); events are hints. |
| **S-05** Downloading recordings with `drive.meet.readonly` under delegation | `alt=media` works with a `Range` header; Drive reports `videoMediaMetadata.durationMillis` | `meet-provider.ts` (`describeArtifact`, `openArtifactStream`) | Broaden the Drive scope. Without a duration, the INV-9 check falls back to Meet's recording times. |
| **S-08** Business Standard has the REST participant and recording data | Yes | — | Upgrade the host licences, or keep online attendance manual. |
| **S-09** Anonymous joiners can be blocked | Not relied on: anonymous participants are kept and need a Lecturer's decision | `matching.ts` | — |
| **S-10** A narrower scope for trashing recordings | Not needed while `DRIVE_CLEANUP_MODE=NONE` (D-07) | `meet-provider.ts` (`trashArtifact`) | — |
| **S-Y1** YouTube API: audit, quota, processing details | Uploads are `unlisted` with `selfDeclaredMadeForKids=false`; `processingDetails.processingStatus` and `contentDetails.duration` tell when it's ready and how long it is | `packages/integrations/src/video-host/youtube-api.ts` | Until the audit passes, keep `VIDEO_HOST=youtube_link`. |

[`docs/runbooks/google.md`](../runbooks/google.md) is how the System Admin switches the integration on.
