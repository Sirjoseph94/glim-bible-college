# 07: Admin integrations and ops

**What to build:** The System Admin's Google and YouTube integration screens' API and the ops view of the new failures (TRD §15.3, §6.7).

**Blocked by:** 03, 04, 06

**Status:** ready-for-agent

- [ ] `GET/POST /admin/integrations/google` (config: primary domain, project, subscription), host accounts CRUD, `POST …/test` (token mint, `spaces.get` probe, Drive `about`, subscriptions, breaker, scope diff), wizard data (SA client id + scope list)
- [ ] YouTube: `GET /admin/integrations/youtube/status` adds the OAuth connection and quota; `GET …/youtube/connect` + callback store the channel token
- [ ] `v_ops_failures` adds recordings, provider-ERROR meetings, non-ACTIVE subscriptions; replay kinds `recording`, `meeting-provision`
- [ ] `drive-storage-monitor` hourly: alerts at 70 % / 85 %

**Spec:** `.scratch/google-integration/spec.md`
