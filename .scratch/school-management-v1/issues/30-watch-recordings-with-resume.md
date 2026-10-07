# 30: Watch recordings with resume

**What to build:** A student opens a recording, sees only a thumbnail until tapping play, watches in the embedded YouTube player with a 144p data-saver tip, and resumes where they stopped (TRD §13.4–13.5).

**Blocked by:** 29 (Add YouTube recordings to a course)

**Status:** ready-for-agent

- [ ] `GET /videos/:id/play` returns the embed data only for entitled viewers (404 otherwise); p95 < 300 ms
- [ ] Access rule: ENROLLED or COMPLETED course enrollment while the programme enrollment is ACTIVE; dropped and graduated students get 404 (AC-08)
- [ ] Thumbnail facade; IFrame API loaded only on tap; `youtube-nocookie.com`, `rel=0`, `playsinline`
- [ ] Progress PATCH every 15 s, on pause and on pagehide; server clamps, keeps the max, completes at 90%, rate-limited, stale `seq` ignored; duration learned from the first report (AC-09)
- [ ] CSP allows the YouTube frame, script and thumbnail hosts
- [ ] Playwright with a stubbed YouTube player on a mobile viewport

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
