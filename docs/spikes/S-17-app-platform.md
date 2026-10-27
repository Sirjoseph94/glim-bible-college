# Spike S-17: the VPS deploy (Hostinger, Neon, R2)

**Status:** to run on staging. It can't be done from CI.
**Owner:** the System Admin, with a developer.
**Why:** this spike first checked App Platform's behaviours. ADR-0004 replaced App Platform, so it now checks the things the VPS deploy (`deploy/`) assumes and documentation couldn't confirm. The file name is kept so earlier links still work. Record what you observe here, with the date.

| # | Check | How | Expected | Observed |
|---|---|---|---|---|
| 1 | The worker's graceful stop | `docker compose logs -f worker` on the VPS during a deploy: "shutting down", then "worker stopped" | Stopped well within the 120 s `stop_grace_period` | |
| 2 | Rolling replace of `api1` and `api2` | `while true; do curl -s -o /dev/null -w "%{http_code}\n" https://<staging>/readyz; sleep 0.5; done` during a deploy | No 5xx | |
| 3 | A failed migration stops the deploy | Deploy an image whose migration fails (a scratch branch) | `deploy.sh` exits with "migrations failed"; the previous version keeps serving | |
| 4 | Client IP | Log `req.clientIp` for a request from a known IP, and send a forged `X-Real-IP` header | It equals your public IP, not the forged one | |
| 5 | Latency to Neon | The round-trip check in `docs/runbooks/server.md` | A few milliseconds per `select 1` | |
| 6 | `pg_dump` 18 against Neon with `sslmode=verify-full` | Trigger `db.logical-backup` on staging (enqueue it from the ops page, or wait for Sunday) | An object appears in the staging backups bucket and decrypts with the staging key. This proves `PGSSLROOTCERT=system` works. | |
| 7 | First migration on a new Neon database | The first deploy to staging | `migrate` creates `citext` and `btree_gist` as `glim_migrator` with no permission errors | |
| 8 | Browser uploads to R2 | Upload a passport photo and a course material on staging | Both upload and download. If the browser reports a CORS or signature error, the SDK's checksum headers may need allowing in the CORS rule. | |
| 9 | Worker memory for a 1.5 GB streamed upload (integration slice) | `docker stats` during a large recording upload | Stays well under the VPS's memory | |
| 10 | Costs | Hostinger's invoice and Neon's first monthly bill | Recorded in `docs/decisions.md` | |
