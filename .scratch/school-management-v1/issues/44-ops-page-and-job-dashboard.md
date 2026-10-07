# 44: Ops page and job dashboard

**What to build:** The System Admin sees failed jobs, unavailable videos and email bounces in one place, replays failures, and opens the pg-boss dashboard (TRD §15.3, §20.1).

**Blocked by:** 14 (Application submit and receipt email)

**Status:** ready-for-agent

- [ ] `v_ops_failures` view and `GET /admin/ops/failures`
- [ ] Replay for provider events, videos and dead-letter jobs; audited
- [ ] pg-boss dashboard at `/admin/jobs`, System Admin only
- [ ] YouTube link-check status (oEmbed reachability, channel URLs resolve)
- [ ] Queue depth/age shown; email to the System Admin when queue age exceeds 120 s

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
