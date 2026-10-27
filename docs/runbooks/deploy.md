# Deploying and rolling back

**For:** the System Admin.
**You need:** access to the GitHub repository, and SSH access to the VPS for rollbacks.

GLIM runs on a Hostinger VPS with Docker Compose. Its database is in Neon and its files are in Cloudflare R2 (ADR-0004). Building a server from scratch is in [`server.md`](server.md).

## How a release reaches production

1. A change is merged to `main`. GitHub Actions runs **CI** (lint, types, tests, budgets, secret scan).
2. When CI passes, the **Deploy** workflow runs:
   1. It builds one container image, tagged with the commit, scans it for vulnerabilities, and pushes it to GitHub's container registry (`ghcr.io/<owner>/glim:<commit>`).
   2. **Staging:**
      - it copies `deploy/` to `/opt/glim` on the staging VPS;
      - it writes `/opt/glim/app.env` from the `staging` environment's variables and secrets;
      - it runs `deploy.sh`.

      `deploy.sh` runs the database migrations first. If they fail, the deploy stops and the old version keeps running.
   3. It checks `https://<staging>/readyz`.
   4. It waits for approval. In GitHub, open **Actions → Deploy → the run → Review deployments**, tick **production**, and approve.
   5. It deploys **production** the same way, then checks `/readyz`.
3. `deploy.sh` replaces the two API containers one at a time. It waits for each to be healthy, and Caddy sends requests to the other meanwhile, so users keep working. The worker then restarts; jobs that were running are retried automatically.

## Redeploying without a code change

After changing a GitHub variable or secret, for example rotating a key or switching on the Google integration:

1. Open **Actions → Deploy → Run workflow**, choose `main`, and run it.
2. It rebuilds the current commit and deploys it to staging, then to production after approval, with the new `app.env`.

## Checking a deploy

- **GitHub → Actions → Deploy** shows each run, including the `migrate` output in the *Deploy* step.
- On the VPS: `cd /opt/glim && docker compose ps` (all `running`, both APIs `healthy`) and `docker compose logs --tail 100 api1 worker` (JSON lines).
- `https://<your domain>/readyz` should answer `{"status":"ok",...}`.

## Rolling back

Use this when a deploy causes a problem.

1. SSH to the VPS as `deploy`: `ssh deploy@<vps>`.
2. Run `/opt/glim/deploy.sh --rollback`. It switches the API containers and the worker back to the image before the last deploy, one at a time, without migrating. Running it again switches forward again.

Rollback is safe because database changes are made in two releases (**expand**, then **contract**, TRD §22.6): the previous version always works with the newer database.

Rolling back doesn't undo the database migration. If a migration itself is wrong, a developer fixes it forward in a new release.

The next merge to `main` deploys as usual. If the bad change is still on `main`, revert it first.

## Things to set up once

Create two **GitHub environments** in **Settings → Environments**: `staging` and `production`. Give `production` **required reviewers** (the System Admin and one other person).

**Variables**, in each environment:

| Variable | Value |
|---|---|
| `VPS_HOST`, `VPS_USER`, `VPS_KNOWN_HOSTS` | The VPS's IP, `deploy`, and its `ssh-keyscan` line (`server.md` C.4) |
| `APP_ORIGIN` | `https://portal.<glim-domain>` (staging: its own host name) |
| `DB_CONNECTION_BUDGET` | `50` |
| `STORAGE_ENDPOINT`, `STORAGE_REGION` | `https://<account-id>.eu.r2.cloudflarestorage.com`, `auto` |
| `STORAGE_BUCKET`, `STORAGE_BACKUP_BUCKET` | `glim-files`, `glim-backups` (staging: `glim-staging-…`) |
| `MAIL_FROM`, `SENDGRID_WEBHOOK_PUBLIC_KEY` | The sender, e.g. `GLIM Bible College <no-reply@<glim-domain>>`, and SendGrid's webhook key |
| `GOOGLE_OAUTH_CLIENT_ID` | The Google sign-in client |
| `BACKUP_AGE_RECIPIENT` | The age **public** key (`age1…`) |
| `LIVE_PROVIDER`, `VIDEO_HOST`, `GOOGLE_PROJECT_ID`, `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_SUBSCRIPTION`, `GOOGLE_EVENTS_MODE`, `YOUTUBE_OAUTH_CLIENT_ID`, `DRIVE_CLEANUP_MODE`, `FEATURE_*` | Only when switching on the Google integration ([`google.md`](google.md)); leave them out otherwise |

**Secrets**, in each environment: `VPS_SSH_KEY`, and the app's secrets listed in [`docs/secrets.md`](../secrets.md).

A value can't contain a single quote (`'`) or a line break. The deploy refuses it and names the variable, without printing its value.

No repository-wide secret is needed: the workflow pushes and pulls images with its own short-lived token.
