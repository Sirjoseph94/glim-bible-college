# 44: Ops page and job dashboard

**What to build:** The System Admin sees failed jobs, unavailable videos and email bounces in one place, replays failures, and opens the pg-boss dashboard (TRD §15.3, §20.1).

**Blocked by:** 14 (Application submit and receipt email)

**Status:** done

- [x] `v_ops_failures` view and `GET /admin/ops/failures`
- [x] Replay for provider events, videos and dead-letter jobs; audited
- [x] pg-boss dashboard at `/admin/jobs`, System Admin only
- [x] YouTube link-check status (oEmbed reachability, channel URLs resolve)
- [x] Queue depth/age shown; email to the System Admin when queue age exceeds 120 s

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-09).**
- **Schema:** `integration_checks` (`0043`); `v_ops_failures` (`0044`, custom).
- **Queues:** `ops.queue-health` (cron every minute) and `ops.youtube-check`.
- **Ops module:** `OpsService` (failures with failed pg-boss jobs, replay, queue stats, the queue-age alert, the YouTube check).
- **Video host:** `checkService` on the port, implemented by the oEmbed adapter and the fake.
- **API:**
  - `GET /admin/ops/failures`.
  - `POST /admin/ops/replay/:kind/:id`.
  - `GET /admin/jobs`.
  - `GET /admin/integrations/youtube/status` and `POST /admin/integrations/youtube/test`.
- **Worker:** handlers for both new queues; `video.availability-check` also takes one video.
- **Web:** `/admin/ops` and `/admin/jobs` for the System Admin.
- **Tests:**
  - `ops.itest.ts` (6):
    - every failure kind listed (System Admin only);
    - replay of each kind with audit, the unsupported kind and an unknown job;
    - a replayed video rechecked by the job;
    - queue depth and age with a 5-minute-old job marked behind, and the alert email once an hour;
    - the YouTube check through its job, with one channel resolving and one not.
  - Authz samples for the five endpoints.
  - Playwright (Pixel 7): the System Admin checks YouTube from the ops page and sees the job queues. The e2e server seeds "Opal Ops" for it.
