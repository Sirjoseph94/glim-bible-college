# 29: Add YouTube recordings to a course

**What to build:** A Lecturer or the System Admin pastes the link of an unlisted video on GLIM's YouTube channel into a course; the app checks it and lists it for the course (TRD §13.1, §13.3, §13.6, ADR-0003).

**Blocked by:** 06 (Institution settings, policies and viewer timezone); 19 (Open registration: compulsory courses auto-registered)

**Status:** done

- [x] `VideoHost` port with `YouTubeLinkHost` (URL parsing + public oEmbed check) and a scriptable `FakeVideoHost`; a shared contract suite with a URL-parsing table and recorded oEmbed responses
- [x] Rejections: `YOUTUBE_URL_INVALID`, `YOUTUBE_VIDEO_PRIVATE`, `YOUTUBE_VIDEO_NOT_FOUND`, `YOUTUBE_CHANNEL_NOT_ALLOWED` (channel not in settings), `VIDEO_CHECK_UNAVAILABLE`
- [x] Title prefilled from YouTube and editable; optional link to a Class Meeting; publish/unpublish (`Idempotency-Key`), reorder, scheduled `publish_after`
- [x] Course recordings tab lists published videos for entitled users
- [x] Deny tests per D-05 (Lecturers own offerings only)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Port** (`integrations/video-host`): `VideoHost` (`parseUrl`, `checkVideo`, `embed`), with shared YouTube URL parsing, nocookie embeds and channel normalising.
  - `YouTubeLinkHost` checks through public oEmbed with an injectable fetch: 200 is AVAILABLE with title, channel and thumbnail; 401/403 is private; 404/400 is not found; anything else or a network error throws `VideoHostUnavailableError`.
  - `FakeVideoHost` is scriptable and can be "down".
  - The contract suite (46 cases) covers the URL table for both adapters, embeds, and recorded oEmbed responses.
  - Bound through `PlatformModule` (`VIDEO_HOST`): production uses the link host, tests and e2e the fake.
- **Schema** (`0028`): `videos` (origin LINK; youtube id format check; unique per offering unless DELETED).
- **API:**
  - `POST /course-offerings/:id/videos` (Idempotency-Key) parses and checks the link, then requires the channel to be in Settings. Errors: `YOUTUBE_URL_INVALID`, `YOUTUBE_VIDEO_PRIVATE`, `YOUTUBE_VIDEO_NOT_FOUND`, `YOUTUBE_CHANNEL_NOT_ALLOWED`, `VIDEO_CHECK_UNAVAILABLE`, or 409 for a duplicate.
  - The title is prefilled from YouTube and editable. It takes an optional Class Meeting of the course and `publishAfter`, and is published if RECORDING `autoPublish` (default on).
  - `GET` list and one, `PATCH` (If-Match), `POST …/publish` (Idempotency-Key) and `…/unpublish`, and `PUT …/videos/order`. All audited, with `video.added/published/unpublished` events.
  - Students (E/C, via `v_offering_access`) see published, ENROLLED-visibility videos whose release time has passed. Managers see all but deleted.
- **Web:** each offering on the Lecturer's page has Recordings: add by link (with a title override), publish/hide, move up/down. Students see a course's recordings listed on My courses; the player is ticket 30.
- **Tests:** contract suite; `videos.itest.ts` (15: add and prefill, edited title / meeting / release, five refusal kinds, YouTube down, duplicate, empty allow-list, auto-publish off, who may add, student visibility and release time, not-entitled viewers, publish/unpublish idempotent, PATCH with If-Match, reorder); authz samples for all seven endpoints; Playwright: a bad link is refused, a recording is added and hidden.

