# 31: Video administration and availability checks

**What to build:** The System Admin manages every video in one screen: replace a link, delete with 7-day restore and a YouTube Studio reminder, and see videos YouTube no longer serves, which are hidden automatically (TRD §13.3, §13.6, AC-19).

**Blocked by:** 30 (Watch recordings with resume)

**Status:** done

- [x] `/admin/videos` across offerings with filters and YouTube Studio links
- [x] Replace link (`PUT /videos/:id/youtube-link`) re-checks the link; progress resets if the duration differs by more than 5%
- [x] Delete → `DELETED` with `delete_after` +7 d; restore within the window; daily purge reminds the System Admin to delete in YouTube Studio
- [x] Daily `video.availability-check` and manual recheck: unavailable videos become `UNAVAILABLE`, are hidden, and notify the person who added them and the System Admin; a successful recheck restores the prior status

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Schema** (`0030`): `videos.status_before_delete`.
- **API:**
  - `GET /admin/videos` (`video:asset:admin`, paginated): unavailable videos first, then newest. Filters by offering, status and origin. Each row has the course, semester, last check, reason and YouTube Studio link (`studio.youtube.com/video/{id}/edit`).
  - `PUT /videos/:id/youtube-link` runs the add checks, swaps the link in one transaction (audited `video.asset.link-replaced`), keeps position, title and release settings, and clears the duration. Progress more than 5 % off the new length resets when the length is next learned.
  - `DELETE /videos/:id` → `DELETED` with `delete_after` +7 d (audited, `video.deleted` event, idempotent). `POST /videos/:id/restore` puts back the prior status within the window.
  - `POST /videos/:id/recheck` (`video:asset:manage`: admins, Primary and Co-lecturers): a success restores an UNAVAILABLE video; 503 `VIDEO_CHECK_UNAVAILABLE` when YouTube can't be reached.
- **Jobs:**
  - `video.availability-check` (daily 04:00) marks videos `UNAVAILABLE` with a reason, hidden from students and on the ops view. It publishes `video.unavailable`, emails the adder and the System Admins, and throws for retry when YouTube is down.
  - `video.purge-deleted` (daily 03:30) deletes progress and sends the YouTube Studio reminder once.
- **Web:** `/admin/videos` (System Admin nav "Videos"): filters; each row has YouTube Studio, Watch, Recheck, Replace link, Delete (confirm) and Restore, plus the restore deadline or the reminder to delete on YouTube.
- **Tests:**
  - `video-admin.itest.ts` (15): list order, filters and paging; admin-only; replace checks, 409 duplicate, the 5 % rule both ways; delete, idempotence, restore as it was, audit trail, refused restore after a re-add and after 7 days; purge and reminder email; unavailable detection with emails; recheck restore; YouTube down; more than one batch; recheck permissions.
  - Authz samples for all five endpoints.
  - Playwright (AC-19): recheck finds a deleted video, a replaced link brings it back, delete and restore.
