# 02: UI features waiting on data the API doesn't return (future work)

**What this is:** The handoff (`docs/ui-design-handoff.md`) designs several things whose data the API doesn't provide today. Decision UI-Q9 (`docs/decisions.md`, 10 Oct 2026) is to **skip them for now**: build no UI for them and keep them here for later. When the screen work packages (WP-UI-05 to WP-UI-11) meet one of these, they leave it out, and don't fake or approximate it.

**Status:** needs-triage

| Feature | Handoff | Data needed | Notes |
|---|---|---|---|
| "Continue watching" card on Today, with a resume position | §11.2 | The student's most recently watched recording and position | Playback progress is reported every 15 s (`recording.tsx`); a "my recent progress" read is missing. |
| "Recordings watched" progress on course cards | §9.15 | Per-offering count of recordings watched and total | — |
| "Due this week" on Today | §11.2 | Cross-course list of the student's assignments and quizzes due in 7 days, with draft or not-started state | Today only per-offering lists exist. |
| Dial-in numbers and PIN on the live card | §9.14 | Meet dial-in details per Class Meeting | Must be returned only inside the join window, like the link (INV-8: no provider call on join). |
| "18 students are in the Meet lobby" | §11.7 | Live participant or lobby count | Would need a live provider read; conflicts with "events are hints" unless it comes from synced data. |
| "Needs your attention" for Lecturers | §11.7 | Unmatched participants, ungraded submission counts, failed recordings, results awaiting finalization, per Lecturer | Some exists per screen; no aggregate endpoint. |
| Per-recording data estimate ("≈ 92 MB at 240p") | §11.3 | Duration is known; the YouTube size per quality is not | TRD §18.4: measured in spike S-11 and shown as a fixed tip. |
| Results-published notice for 24 h | §11.2 | Publication timestamp on the student's semester result | Check `GET /me/results` before building; may already be derivable. |
| The recording page's course (BackLink "Recordings" and course code) | §11.4 | `courseOfferingId` and course code in `GET /videos/:id/play` | The player goes back to My courses until then. |
| Class of degree on the GPA summary ("Second Class Upper") | §9.17 | The class band for the current CGPA under the programme's grading scheme | `GET /me/results` has GPA/CGPA and standing, not the class; awards carry it only once proposed. |
| Cancellation reason on a cancelled Class Meeting card | §9.14 | The reason given when a meeting is cancelled, in `classMeetingSchema` | Cancel takes no reason today. |
| "Work" tab to-do count | §11.3 | Per-offering count of work the student hasn't submitted | — |
| Retry countdown when the class link is being prepared | §9.14 | The `Retry-After` header on `PROVIDER_NOT_READY` exposed to the client (`ApiError` keeps the body only) | Client-side change; small. |
| Late-submission warning before confirm | §11.5 | Due date vs. cutoff | Probably available on the assignment; confirm in WP-UI-07. |

Rows marked "check" or "confirm" may already be possible. The WP that reaches them verifies against the contracts and builds them if the data exists.

## Comments
