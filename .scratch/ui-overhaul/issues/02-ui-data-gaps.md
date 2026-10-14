# 02: UI features waiting on data the API doesn't return (future work)

**What this is:** The handoff (`docs/ui-design-handoff.md`) designs several things whose data the API doesn't provide today. Decision UI-Q9 (`docs/decisions.md`, 10 Oct 2026) is to **skip them for now**: build no UI for them and keep them here for later. When the screen work packages (WP-UI-05 to WP-UI-11) meet one of these, they leave it out, and don't fake or approximate it.

**Status:** done (split into 03–12)

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
| Cancellation reason on a cancelled Class Meeting card | §9.14 | The reason given when a meeting is cancelled, in `classMeetingSchema` | `POST /class-meetings/:id/cancel` takes a reason; no read returns it. |
| "Work" tab to-do count | §11.3 | Per-offering count of work the student hasn't submitted | — |
| Retry countdown when the class link is being prepared | §9.14 | The `Retry-After` header on `PROVIDER_NOT_READY` exposed to the client (`ApiError` keeps the body only) | Client-side change; small. |
| Participants who couldn't be matched ("2 people could not be matched", Confirm match / Not this student) | §9.18, §11.8 | Unmatched Meet participants with a suggested student, and endpoints to confirm or reject a match | v1 attendance is roll call plus the `mode` mark (TRD §12.3); there is no participant data yet. Arrives with the Google integration slice. |
| The attendance policy's thresholds in the explanation ("at least 75% of the time it ran") and "class ran 58 min" | §11.8 | The policy snapshot's thresholds and the meeting's actual duration in `GET /class-meetings/:id/attendance` | The page says only that a reason is required; the thresholds must not be hard-coded. |
| Gradebook running total and attendance % columns | §11.9 | Per-student running total over graded work and attendance percentage in `GET /course-offerings/:id/gradebook` | Computing a weighted total in the browser would duplicate the grading rules (exact integer arithmetic belongs on the server). |
| "Finalize unlocks once the exam is graded." | §11.9 | Whether the offering can be finalized, and why not | The course results page already refuses with the server's reason. |
| "26 students · you are the primary Lecturer" | §11.9 | The viewer's own role on the offering (`lecturers[].lecturerId` is a Lecturer id, not the user id in `/me`) | The gradebook footer counts the students it shows. |
| "To grade" in gradebook cells | §11.9 | Which students submitted work that has no score yet | Empty cells show "–". |
| Cohort level and "Courses finalized 8 of 8" on the Registrar's cohorts table | §11.10 | Per programme and level in a semester: the cohort's level, and how many of its Course Offerings have finalized results | Cohorts are grouped by programme from `GET /results/semesters` rows. |
| The reopened course behind a waiting cohort ("Waiting on GRK 301") | §11.10 | The course codes of a student's reopened course results, not only `draftCourseResults` (a count) | The cohort row says how many students wait. |
| Verification code on the Registrar's request list | §11.10 | `verificationCode` in the transcript summary on `GET /transcript-requests` | The code is on the transcript's own page. |
| Late-submission warning before confirm | §11.5 | Due date vs. cutoff | Probably available on the assignment; confirm in WP-UI-07. |

Rows marked "check" or "confirm" may already be possible. The WP that reaches them verifies against the contracts and builds them if the data exists.

## Comments

> *This was generated by AI during triage.*

**Triage (2026-10-14):** split into separate tickets, each triaged on its own:

- Already built, so they have no ticket: the late-submission warning (the "Submitting late" banner on the assignment page, from WP-UI-07), the unmatched Meet participants (the roll-call participants review, from the Google integration), and dial-in (`/join` returns `dialIn` and the card has "Join by phone"; Google gives no numbers yet, see spike S-02).
- 03 The recording page's course (ready-for-agent)
- 04 Cancellation reason and retry countdown (ready-for-agent)
- 05 Attendance explanation (ready-for-agent)
- 06 Registrar cohort details and verification codes (ready-for-agent)
- 07 Student progress reads (needs-triage)
- 08 Lecturer Needs your attention (needs-triage)
- 09 Gradebook data (needs-triage)
- 10 Student results extras (needs-triage)
- 11 Meet lobby count (wontfix, `.out-of-scope/meet-lobby-count.md`)
- 12 Data estimate per recording (ready-for-human, spike S-11)

