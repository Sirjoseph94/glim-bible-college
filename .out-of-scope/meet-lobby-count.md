# Live Meet lobby count

**Decision:** Not built. The Lecturer's screen doesn't show how many people are waiting in the Google Meet lobby.

**Reason:** It needs a live read from Google while the page is open. That goes against "no Google calls in the request path" and "events are hints" (CLAUDE.md, TRD §0.2). Meet's events don't report the lobby either, so it can't come from synced data. Lecturers see the lobby in Meet itself.

**Prior requests:**
- `.scratch/ui-overhaul/issues/11-meet-lobby-count.md` (from the handoff §11.7, via #02)
