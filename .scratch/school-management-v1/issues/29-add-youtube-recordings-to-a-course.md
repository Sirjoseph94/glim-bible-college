# 29: Add YouTube recordings to a course

**What to build:** A Lecturer or the System Admin pastes the link of an unlisted video on GLIM's YouTube channel into a course; the app checks it and lists it for the course (TRD §13.1, §13.3, §13.6, ADR-0003).

**Blocked by:** 06 (Institution settings, policies and viewer timezone); 19 (Open registration: compulsory courses auto-registered)

**Status:** ready-for-agent

- [ ] `VideoHost` port with `YouTubeLinkHost` (URL parsing + public oEmbed check) and a scriptable `FakeVideoHost`; a shared contract suite with a URL-parsing table and recorded oEmbed responses
- [ ] Rejections: `YOUTUBE_URL_INVALID`, `YOUTUBE_VIDEO_PRIVATE`, `YOUTUBE_VIDEO_NOT_FOUND`, `YOUTUBE_CHANNEL_NOT_ALLOWED` (channel not in settings), `VIDEO_CHECK_UNAVAILABLE`
- [ ] Title prefilled from YouTube and editable; optional link to a Class Meeting; publish/unpublish (`Idempotency-Key`), reorder, scheduled `publish_after`
- [ ] Course recordings tab lists published videos for entitled users
- [ ] Deny tests per D-05 (Lecturers own offerings only)

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
