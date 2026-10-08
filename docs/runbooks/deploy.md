# Deploying and rolling back

**For:** the System Admin.
**You need:** access to the GitHub repository and the DigitalOcean team.

## How a release reaches production

1. A change is merged to `main`. GitHub Actions runs **CI** (lint, types, tests, budgets, secret scan).
2. When CI passes, the **Deploy** workflow runs:
   1. It builds one container image, tagged with the commit, scans it for vulnerabilities, and pushes it to the DigitalOcean Container Registry (`registry.digitalocean.com/glim/glim:<commit>`).
   2. It updates the **staging** app (`glim-staging`) to that image. App Platform first runs the **`migrate`** job (database migrations). If migrations fail, the deploy stops and the old version keeps running.
   3. It checks `https://<staging>/readyz`.
   4. It waits for approval. In GitHub, open **Actions → Deploy → the run → Review deployments**, tick **production**, and approve.
   5. It updates the **production** app (`glim`) the same way, then checks `/readyz`.
3. App Platform replaces the two API instances one at a time, so users keep working during a deploy. The worker restarts; jobs that were running are retried automatically.

## Checking a deploy

- **DigitalOcean → Apps → glim → Activity** shows each deployment, including the `migrate` job's log.
- **Runtime Logs** show the API and worker logs (JSON lines).
- `https://<your domain>/readyz` should answer `{"status":"ok",...}`.

## Rolling back

Use this when a deploy causes a problem.

1. **DigitalOcean → Apps → glim → Activity**, find the last good deployment, and choose **Rollback**.
2. Confirm. App Platform switches back to the previous image within a few minutes.

Rollback is safe because database changes are made in two releases (**expand**, then **contract**, TRD §22.6): the previous version always works with the newer database.

Rolling back doesn't undo the database migration. If a migration itself is wrong, a developer fixes it forward in a new release.

## Things to set up once

- **GitHub environments:**
  - `staging` and `production`, each with these variables: `APP_ID`, `APP_ORIGIN`, `STORAGE_BUCKET`, `STORAGE_BACKUP_BUCKET`, `MAIL_FROM`, `SENDGRID_WEBHOOK_PUBLIC_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `BACKUP_AGE_RECIPIENT`.
  - The secrets are listed in `docs/secrets.md`.
  - `production` has **required reviewers** (the System Admin and one other person).
- **Repository secret:** `DIGITALOCEAN_ACCESS_TOKEN`, a token with access to Apps and the Container Registry.
- **Creating the apps for the first time:** run `scripts/render-app-spec.sh .do/app.staging.yaml > app.yaml` with the variables set, then `doctl apps create --spec app.yaml`. Note the app's ID for `APP_ID`. Do the same with `.do/app.yaml` for production.
- **Spaces buckets:** create the files bucket (`STORAGE_BUCKET`, private) and the backups bucket (`STORAGE_BACKUP_BUCKET`, private, with a lifecycle rule expiring objects after 12 weeks).
  - Browsers upload files (such as passport photos) straight to the files bucket and load them from it, so the files bucket needs a **CORS rule**: in **Spaces → the bucket → Settings → CORS**, allow the origin `APP_ORIGIN`, the methods `GET` and `PUT`, the header `content-type`, and a max age of 3000 seconds. Without it, uploads fail in the browser with a network error.
