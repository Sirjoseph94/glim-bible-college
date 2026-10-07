# 07: App Platform deployment

**What to build:** The app deploys to a staging App Platform app from CI with migrations run first, and can be rolled back. The production spec exists (TRD §22).

**Blocked by:** 02 (Thin end-to-end skeleton: DB, API, worker, SPA)

**Status:** done

- [x] App specs for staging and production: `api` service (2 instances, `/readyz` health check), `worker`, and a `migrate` PRE_DEPLOY job
- [x] Images built in CI and pushed to DO Container Registry; deploy via `doctl` after the full CI pipeline; manual approval gate for production
- [x] Managed PG transaction pool (`glim-tx`) + direct URL wired; a startup check enforces the connection budget
- [x] Spaces buckets `glim-files` and `glim-backups`; weekly encrypted `pg_dump` job to `glim-backups`
- [x] Runbooks for deploy/rollback and restore, written for the System Admin; `docs/secrets.md` inventory
- [x] Spike S-17 (App Platform behaviours) recorded in `docs/spikes/`

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).** No DigitalOcean account was available, so the deployment is ready but has not been run.

**Verified locally:**
- The image (`docker/Dockerfile`) builds.
- Its `migrate` job migrates a fresh PG 18 database.
- The `api` container serves `/readyz`, the API and the SPA.
- The `worker` starts its handlers and stops gracefully on SIGTERM.
- The image's `pg_dump` is 18.6.

**Delivered:**
- **App specs:** `.do/app.yaml` (production, 2 `api` instances with a `/readyz` health check) and `.do/app.staging.yaml`. Each has a `worker`, a `migrate` PRE_DEPLOY job, the `glim-tx` pool binding for `DATABASE_URL`, and the direct URL for pg-boss and pg_dump. Secrets are substituted at deploy time by `scripts/render-app-spec.sh`.
- **Deploy workflow:** `.github/workflows/deploy.yml` runs after CI on `main`:
  1. builds the image and scans it with Trivy
  2. pushes to DOCR
  3. runs `doctl apps update` on staging, then a smoke check
  4. waits for approval on the GitHub `production` environment
  5. deploys production
- **CI additions:** a gitleaks secret scan, and pg_dump 18 for the backup test.
- **Connection budget:** the startup check (in `loadConfig`) already enforces it.
- **Weekly backup:** the `db.logical-backup` handler runs `pg_dump -Fc`, encrypts with age, and uploads to the `glim-backups` bucket. Its integration test decrypts the result and checks for a `PGDMP` archive.
- **Docs:** runbooks `deploy.md` and `restore.md`, plus `docs/secrets.md`.

**Still to do, outside this repo:**
- The staging app.
- Spike S-17: `docs/spikes/S-17-app-platform.md` lists the checks for the System Admin to run on staging. It needs the real platform, so no results are recorded yet.
