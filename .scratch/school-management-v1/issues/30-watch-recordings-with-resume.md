# 30: Watch recordings with resume

**What to build:** A student opens a recording, sees only a thumbnail until tapping play, watches in the embedded YouTube player with a 144p data-saver tip, and resumes where they stopped (TRD §13.4–13.5).

**Blocked by:** 29 (Add YouTube recordings to a course)

**Status:** done

- [x] `GET /videos/:id/play` returns the embed data only for entitled viewers (404 otherwise); p95 < 300 ms
- [x] Access rule: ENROLLED or COMPLETED course enrollment while the programme enrollment is ACTIVE; dropped and graduated students get 404 (AC-08)
- [x] Thumbnail facade; IFrame API loaded only on tap; `youtube-nocookie.com`, `rel=0`, `playsinline`
- [x] Progress PATCH every 15 s, on pause and on pagehide; server clamps, keeps the max, completes at 90%, rate-limited, stale `seq` ignored; duration learned from the first report (AC-09)
- [x] CSP allows the YouTube frame, script and thumbnail hosts
- [x] Playwright with a stubbed YouTube player on a mobile viewport

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Schema** (`0029`): `playback_progress` (one row per viewer and video; `position ≤ max ≤ duration` check; `percent_complete numeric(5,2)` computed with integers).
- **API:**
  - `GET /videos/:id/play` (`video:asset:play`, rate class `playback`, `Cache-Control: no-store`) returns the youtube-nocookie embed (`rel=0`, `playsinline=1`, `enablejsapi=1`, `start` at the resume point), the `mqdefault` thumbnail, the duration, `resumeMs` and `tracksProgress`.
  - Access comes from `v_offering_access`: ENROLLED or COMPLETED while the student and programme enrollment are ACTIVE. Dropped, graduated and other students get 404. Students need a published, released video; managers may preview.
  - `PATCH /videos/:id/progress` (`video:progress:write`, rate class `progress`) clamps to the duration, keeps the max, completes at 90 %, ignores stale `seq` and reports within 5 s, and learns `videos.duration_ms` from the first report.
- **Web:** `/recordings/$videoId` shows a thumbnail facade ("Play recording" / "Resume from m:ss"). The IFrame API script is added only on tap and attached to our own iframe, which sets a referrer policy YouTube accepts. Progress is sent every 15 s while playing, on pause or end, on leaving the route, and on `pagehide` with `keepalive`. If YouTube can't load, it says "Can't reach YouTube — try another network or Wi-Fi". The data-saver tip includes a MB estimate. Course recordings on My courses link to the player, and Lecturers get a Watch link.
- **CSP:** already allowed the frame (`youtube-nocookie.com`), script (`www.youtube.com`) and thumbnail (`i.ytimg.com`) hosts; `platform.itest.ts` checks them.
- **Tests:** `playback.itest.ts` (13: embed and headers; E/C and denial (AC-08); unpublished and preview; release time; learned duration and resume; duration kept; 5 s and stale seq; seek back and clamp; 90 % completion and restart; staff and non-entitled 404; dropped enrollment; per-user rate limit). Authz samples for both endpoints. Playwright on a Pixel 7 viewport with a stubbed IFrame API: no YouTube request before the tap, the embed parameters, progress saved on pause, and resume after reload.
