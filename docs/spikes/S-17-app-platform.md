# Spike S-17: App Platform behaviours

**Status:** to run. It needs the staging app, so it can't be done from CI.
**Owner:** the System Admin, with a developer.
**Why:** the deployment assumes some App Platform behaviours (TRD §5.6, §22.2, §22.4) that change between platform versions. Record what you observe here, with the date.

| # | Check | How | Expected | Observed |
|---|---|---|---|---|
| 1 | SIGTERM grace period for the worker on deploy | Watch the worker logs during a deploy: "shutting down", then "worker stopped" | At least 25 s between SIGTERM and kill; the worker's graceful stop waits 25 s | |
| 2 | Rolling replace of 2 `api` instances | `while true; do curl -s -o /dev/null -w "%{http_code}\n" https://<staging>/readyz; sleep 0.5; done` during a deploy | No 5xx | |
| 3 | PRE_DEPLOY failure stops the deploy | Deploy an image whose migration fails (a scratch branch) | Deployment fails; the previous version keeps serving | |
| 4 | Bindable variables | Check the rendered env in **Settings → Components** | `${db.glim-tx.DATABASE_URL}` resolves to the pool on port 25061, and `${db.DATABASE_URL}` to the direct port 25060 | |
| 5 | `DO-Connecting-IP` header | Log `req.clientIp` for a request from a known IP | It equals your public IP (so `CLIENT_IP_HEADER=do-connecting-ip` is right) | |
| 6 | Instance sizes and prices | Compare `.do/app.yaml` slugs with the current list | Slugs exist; costs recorded in `docs/decisions.md` | |
| 7 | `pg_dump` 18 in the image against Managed PG 18 | Trigger `db.logical-backup` on staging (enqueue it from the ops page, or wait for Sunday) | An object appears in the staging backups bucket and decrypts with the staging key | |
| 8 | Region | Check that LON hosts the app, the database and Spaces (S-13) | All three in LON | |
