# 07: Admin integrations and ops

**What to build:** The System Admin's Google and YouTube integration screens' API and the ops view of the new failures (TRD §15.3, §6.7).

**Blocked by:** 03, 04, 06

**Status:** done

- [x] `GET/POST /admin/integrations/google` (config: primary domain, project, subscription), host accounts CRUD, `POST …/test` (token mint, `spaces.get` probe, Drive `about`, subscriptions, breaker, scope diff), wizard data (SA client id + scope list)
- [x] YouTube: `GET /admin/integrations/youtube/status` adds the OAuth connection and quota; `GET …/youtube/connect` + callback store the channel token
- [x] `v_ops_failures` adds recordings, provider-ERROR meetings, non-ACTIVE subscriptions; replay kinds `recording`, `meeting-provision`
- [x] `drive-storage-monitor` hourly: alerts at 70 % / 85 %

**Spec:** `.scratch/google-integration/spec.md`

## Comments

**Implemented (2026-10-13).**
- `GoogleIntegrationService` (class-meeting): `GET/POST /admin/integrations/google` (mode, status, primary domain, service-account client id and email, the delegated scopes from the provider, Pub/Sub names, host accounts with subscription and breaker state, last test); host accounts `POST …/host-accounts` (on the primary domain, once each) and `PATCH …/:id` (Google user id, weight, ACTIVE/DISABLED); `POST …/test` queues `ops.google-check` (health, scope diff via `checkPermissions`, Drive storage, subscription sweep → VERIFIED or DEGRADED); `drive.storage-monitor` hourly (70 % weekly, 85 % daily alerts).
- YouTube: `GET …/youtube/status` adds the channel connection; `GET …/youtube/connect` → consent with a state cookie; `GET …/youtube/callback` stores the sealed grant; `POST …/youtube/disconnect`.
- Port: `requiredPermissions`, `checkPermissions`, `circuitStates`. A 403 at provisioning marks the Google integration DEGRADED.
- Ops: `v_ops_failures` adds recordings (FAILED/SOURCE_MISSING) and non-ACTIVE subscriptions; failed RECORDING videos show as their recording. Replay for `meeting-provision`, `recording`, `subscription`.
- Tests: `integrations.itest.ts` (9), `ops.itest.ts` updated, authz samples for the nine endpoints.
