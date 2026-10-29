# ADR-0004: Run GLIM on a Hostinger VPS with Neon PostgreSQL and Cloudflare R2

**Status:** Accepted (owner, 27 October 2026). Supersedes the hosting parts of ADR-0002: App Platform, DigitalOcean Managed PostgreSQL and Spaces.
**Date:** 2026-10-27
**Deciders:** GLIM owner, System Admin

## Context

ADR-0002 put GLIM on **DigitalOcean App Platform** with **Managed PostgreSQL** and **Spaces**. Two reasons were given:

1. The self-hosted ffmpeg pipeline needed more disk and longer-running jobs than App Platform allows. App Platform won once video moved to a managed service.
2. GLIM has **one System Admin and no devops staff**, so the database, TLS, patching and failover should be someone else's job.

**Reason 1 no longer applies.** ADR-0003 moved recordings to YouTube. The worker now streams recordings from Drive to YouTube without storing them on disk, so GLIM has no heavy media workload. What GLIM runs is ordinary:

- a Node API that also serves the web app;
- one Node worker running pg-boss queues, Meet event pulling and uploads;
- PostgreSQL 18;
- S3-compatible file storage;
- outside services for email, Google and YouTube.

**Reason 2 still applies**, and it applies most to the **database**. Losing or corrupting it is the worst failure GLIM can have, and recovering a self-run Postgres is the hardest job to ask of one System Admin. Running the stateless API and worker is far less risky.

The owner wants a lower monthly bill than App Platform, without taking on the database.

**Workload** (TRD C-21): about 100–200 students and 10–25 staff, with 3–5 classes at once. The usual load is small. The peaks are registration week, results release and the start of each class.

## Decision

Run the **app** on one **Hostinger KVM VPS in Germany** with Docker Compose. The **database is managed by Neon** in **Frankfurt** (`aws-eu-central-1`). **Files and backups are in Cloudflare R2.** Nothing on the VPS holds college data.

The owner first asked for France, but Neon has no region there. Its European regions are Frankfurt and London, and the VPS must be in the same city as the database, so the owner chose Frankfurt.

| Part | Where it runs |
|---|---|
| `api` (serves the web app), `worker` | Docker containers on the VPS, from the existing image |
| `migrate` | A one-off container run before each deploy |
| HTTPS | Caddy on the VPS, with automatic Let's Encrypt certificates. It's the only thing listening on public ports. |
| PostgreSQL 18 | **Neon**, project in `aws-eu-central-1`. Production branch protected, scale-to-zero **off**, compute autoscaling from 0.25 to 1 CU. On the Scale plan, **IP Allow** restricts it to the VPS's IP. |
| Files (`glim-files`) | A private **Cloudflare R2** bucket, in R2's EU jurisdiction |
| Backups | Neon's point-in-time restore (7 days on Launch, up to 30 on Scale). Plus the existing `pg_dump` + `age` weekly dump in a second private R2 bucket (`glim-backups`): an encrypted copy outside Neon. The app reaches both buckets with one R2 token, so they share an account. |
| Email, Google, YouTube | Unchanged |

**Size:** the VPS runs no database, so 2–4 vCPU and 4–8 GB of RAM is enough (Hostinger's KVM 2 or KVM 4). Two `api` containers fit, which allows deploys with no downtime. Neon: compute autoscaling from 0.25 CU (¼ vCPU, 1 GB) to 1 CU (1 vCPU, 4 GB). It sits at the floor most of the time and grows for registration week and results release. Neon bills per CU-hour, so a fixed 1 CU would cost about three times as much for capacity that's idle most days. If pages feel slow at quiet times, raise the floor.

**Region:** Frankfurt for both. Before buying the VPS, confirm in Hostinger's dashboard that its German data centre is in or near Frankfurt. After setup, measure the round trip from the VPS to Neon; it should be a few milliseconds (docs/runbooks/server.md). S-13 preferred London for latency from Lagos. Frankfurt is somewhat further, which the owner accepted.

**Staging:** a second, smaller Hostinger VPS, a second Neon project in the same region, and separate R2 buckets.

## Consequences

**Gains**
- **Cost.** One VPS replaces App Platform's two API instances and the worker. Only the database and the bucket stay with managed providers. Fill in current quotes before deciding; prices aren't recorded here because they change.
- **The hard part stays managed.** Neon handles database storage, point-in-time restore, minor upgrades and compute restarts. Restores happen in place: connection strings don't change. If the VPS is lost, no data is lost: the System Admin rebuilds the VPS from the runbook and redeploys.
- **Almost no code change.** Configuration is all environment variables. The three database URLs (pooled, direct, migrator) work with Neon. Migrations need only `citext` and `btree_gist`, which Neon supports on Postgres 18, and they grant privileges without creating roles. The one change: the weekly backup now gives `pg_dump` the system CA store (`PGSSLROOTCERT=system`) when the URL asks for certificate checks, because libpq otherwise looks for a CA file that isn't there.

**Configuration the deployment must get right**
- **Database TLS.** Neon's certificate is signed by Let's Encrypt, a public CA. Every database URL uses `sslmode=verify-full`. Node checks it against its built-in CA list, and `pg_dump` against the system's.
- **Client IP.** The API never trusts `X-Forwarded-For`; it reads the client IP from `CLIENT_IP_HEADER` (on App Platform, `do-connecting-ip`). On the VPS:
  - Caddy overwrites `X-Real-IP` with the real client IP (`header_up X-Real-IP {remote_host}`);
  - `CLIENT_IP_HEADER=x-real-ip`;
  - the API port is never published to the internet.

  Otherwise anyone could forge their IP, which would undermine rate limits and audit logs.
- **Connections.** `DATABASE_URL` points at Neon's pooler: the `-pooler` host, PgBouncer in transaction mode. `DATABASE_URL_DIRECT` and `DATABASE_URL_MIGRATOR` use the direct host, because pg-boss, migrations and `pg_dump` need session features the pooler doesn't offer.
- **Latency.** Every request makes several queries, so the database must be in the same city as the VPS. A link between countries would add 10–30 ms to every query.

**Costs, carried by the System Admin**
- **Server upkeep:**
  - operating-system security updates (unattended-upgrades);
  - an SSH key-only login and a firewall allowing ports 22, 80 and 443;
  - Docker updates;
  - disk and memory alerts;
  - watching certificate renewal (Caddy renews automatically).
- **The VPS is a single point of failure for the app.** The data is safe if it fails, but the site is down until the VPS is rebuilt and redeployed (the target is under 2 hours). The 99.5% target is plausible but not guaranteed. If accepted, record that in `docs/decisions.md`.
- **Monitoring.** App Platform's logs and alerts go away. We need:
  - an outside uptime check on `/readyz`;
  - Docker log rotation;
  - alerts for disk and failed backups, alongside the existing Ops failures email.
- **Secrets.** Encrypted App Platform variables are replaced by GitHub environment secrets. Each deploy writes them to `/opt/glim/app.env` on the VPS: mode 600, owned by the deploy user, never committed. `docs/secrets.md` says where each one lives.
- **Neon plan.** IP Allow and an uptime SLA come only with Neon's Scale plan. On the Launch plan, the database can be reached from any IP by anyone with the password, so the passwords must be long and random.
- **Rebuilds must be practised.** At least once a term, rebuild staging from scratch with the runbook, and test a database restore.

**Follow-up work** (done with this ADR unless noted)
1. TRD §22 (environments, production layout, configuration) and Appendix A.3 (provider setup) are rewritten. `docs/decisions.md` row "Operations" is updated.
2. A production `compose.yaml`:
   - `api` ×2, `worker` and `caddy`, with health checks and restart policies;
   - `migrate` as a one-off service;
   - Docker log rotation.

   It's in `deploy/` (`compose.yaml`, `Caddyfile`, `deploy.sh`, and `disk-alert.sh` for the disk alert).
3. A deploy workflow replacing `.do/app.yaml`, `.do/app.staging.yaml` and the App Platform steps in `.github/workflows/deploy.yml`:
   1. build the image and push it to GitHub's container registry;
   2. over SSH: pull, migrate, restart the `api` containers one at a time, then the worker.

   It's `.github/workflows/deploy.yml` and `deploy-vps.yml`, with `scripts/render-env.sh`.
4. Runbooks: building the VPS from scratch (`server.md`), deploying (`deploy.md`), restoring the database (`restore.md`), and rotating secrets (`docs/secrets.md`).
5. Comments that still say "App Platform" are updated (logger, health controller, Dockerfile, storage port, `CLIENT_IP_HEADER` in config).

## Considered options

- **Stay on App Platform (ADR-0002 as is).** It costs the most, but the System Admin runs the least: no servers at all. This is still right if the System Admin's time matters more than the bill.
- **Everything on the VPS, including Postgres.** It's the cheapest option. Rejected because the System Admin would own database recovery, and with daily dumps up to 24 hours of data could be lost. Continuous WAL archiving would reduce that, at the cost of more to set up and watch. That's the wrong risk for one person to carry.
- **Hostinger shared, web or cloud hosting.** Rejected. These plans provide MySQL or MariaDB, not PostgreSQL 18, and can't run a long-running worker.
- **A DigitalOcean Droplet instead of a Hostinger VPS.** The same trade-off, in the same data centre as DigitalOcean Managed PostgreSQL and Spaces. That gives the lowest latency and private networking. The owner chose Hostinger.
- **DigitalOcean Managed PostgreSQL and Spaces, from a Hostinger VPS in the UK.** This would have kept most of the TRD's database and storage steps as they were. The owner preferred Neon and R2.
- **London instead of Frankfurt** (Neon `aws-eu-west-2` with a Hostinger UK VPS). Closer to Lagos (S-13), and equally workable. The owner chose Frankfurt.
- **A Hostinger VPS in France with Neon in Frankfurt or London.** Rejected: the database would be in another country, adding about 10 ms to every query.
