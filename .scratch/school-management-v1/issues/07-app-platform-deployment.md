# 07: App Platform deployment

**What to build:** The app deploys to a staging App Platform app from CI with migrations run first, and can be rolled back. The production spec exists (TRD §22).

**Blocked by:** 02 (Thin end-to-end skeleton: DB, API, worker, SPA)

**Status:** ready-for-agent

- [ ] App specs for staging and production: `api` service (2 instances, `/readyz` health check), `worker`, and a `migrate` PRE_DEPLOY job
- [ ] Images built in CI and pushed to DO Container Registry; deploy via `doctl` after the full CI pipeline; manual approval gate for production
- [ ] Managed PG transaction pool (`glim-tx`) + direct URL wired; a startup check enforces the connection budget
- [ ] Spaces buckets `glim-files` and `glim-backups`; weekly encrypted `pg_dump` job to `glim-backups`
- [ ] Runbooks for deploy/rollback and restore, written for the System Admin; `docs/secrets.md` inventory
- [ ] Spike S-17 (App Platform behaviours) recorded in `docs/spikes/`

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
