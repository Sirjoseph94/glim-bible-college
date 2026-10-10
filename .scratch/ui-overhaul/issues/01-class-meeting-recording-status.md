# 01: Recording status on Class Meetings (API change)

**What to build:** Class Meeting responses say whether the meeting's recording is expected, processing or ready to watch. The Class Meeting card (`docs/ui-design-handoff.md` §9.14) can then show "Recording processing" and "Recording ready" with a "Watch recording" link, instead of leaving an ended meeting with no next step.

**Status:** needs-triage

**Why:** Decision UI-Q3 (`docs/decisions.md`, 10 Oct 2026). The handoff's display states `processing` and `available` have no source in today's API. `classMeetingSchema` (`packages/contracts/src/api/meetings.ts`) returns `state` (`SCHEDULED, OPEN, LIVE, ENDED, CANCELLED, NO_SHOW`) and `recordingMode`, but nothing about the recording. The link already exists in the database: `videos.class_meeting_id` (`packages/db/src/schema/video.ts`).

## Proposed contract

Add one nullable field to `classMeetingSchema`, returned by `GET /me/schedule` and the offering's Class Meeting list:

```ts
recording: z
  .object({
    videoId: z.uuid(),
    status: z.enum(["PROCESSING", "PUBLISHED"]),
  })
  .nullable(),
```

- `PUBLISHED` only while the video is shown to students (INV-9: available and embeddable). `videoId` is then the `/recordings/$videoId` target.
- Students see `PROCESSING` or `null` for anything else (`UNPUBLISHED`, `UNAVAILABLE`, `FAILED`, `DELETED`), so nothing unplayable leaks. Staff who manage the meeting may need the full `videos.status`; decide during triage.
- `null` when no video is linked. The UI then shows "Recording expected" for an `ENDED` meeting with `recordingMode` ≠ `OFF`.

## Display mapping (UI side, after this lands)

| API | Card state | Word |
|---|---|---|
| `state = ENDED`, `recording = null`, `recordingMode ≠ OFF` | ended | Ended · "Recording expected" |
| `recording.status = PROCESSING` | processing | Recording processing |
| `recording.status = PUBLISHED` | available | Recording ready + `secondary` "Watch recording" |

## Acceptance

- [ ] Contract change first (`packages/contracts`), then the query (one join, no N+1; list items stay ≤ 2 KB).
- [ ] Authorization: a student sees `recording` only for meetings of offerings they're enrolled in (same rule as the schedule itself).
- [ ] Tests, including the deny path: an unpublished or failed video appears as `null`/`PROCESSING` to a student, never as `PUBLISHED`.
- [ ] The UI work is part of WP-UI-05 (student) and WP-UI-09 (Lecturer) once this merges.

## Comments
