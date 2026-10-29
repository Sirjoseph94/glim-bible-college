# Secrets inventory

Every secret is a **GitHub environment secret** (`staging` or `production`), never committed. Each deploy writes them to `/opt/glim/app.env` on that environment's VPS (mode 600, owned by `deploy`); see ADR-0004 and `docs/runbooks/deploy.md`. The System Admin owns all of them (TRD §19.1, §22.3).

**To rotate one:** update the secret in GitHub, then redeploy (**Actions → Deploy → Run workflow**).

| Secret | What it is | Rotate | How |
|---|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_DIRECT` | `glim_app` on Neon, through the pooler and directly | 180 days | `ALTER ROLE glim_app PASSWORD '…'` in Neon's SQL Editor, update both secrets, redeploy |
| `DATABASE_URL_MIGRATOR` | `glim_migrator` on Neon, used only by the migrate step | 180 days | Reset the role's password in Neon (**Roles**), update the secret, redeploy |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | R2 token limited to the files and backups buckets | 180 days | Create a new R2 token, update both secrets, redeploy, then delete the old token |
| `SMTP_URL` | Brevo's SMTP relay with an SMTP key: `smtps://<login>:<key>@smtp-relay.brevo.com:465`, with the `@` in the login written `%40`. The VPS's disk alert also uses it. | 180 days | Brevo → **SMTP & API → SMTP → Generate a new SMTP key**, update, redeploy, then delete the old key |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google sign-in client secret | 1 year | Add a new secret in Google Cloud, update, redeploy, then remove the old one |
| `SESSION_SECRET` | Signs the Google sign-in flow cookie | 1 year | Generate 48+ random characters; rotating it cancels sign-ins in progress |
| `CSRF_SECRET` | Reserved for CSRF hardening; sessions carry their own CSRF secrets | 1 year | Generate 48+ random characters |
| `GOOGLE_SA_KEY_JSON_B64` | The `glim-meet` service account's JSON key, base64 (Google integration; domain-wide delegation to the host accounts) | 90 days | New key on the service account, update, redeploy, **Test Google**, delete the old key ([runbook](runbooks/google.md)) |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | The YouTube OAuth client's secret (automatic upload) | 1 year | Add a new secret in Google Cloud, update, redeploy, then remove the old one |
| `TOKEN_ENCRYPTION_KEY` | 32 bytes (base64) that seal the YouTube channel's grant in the database | 1 year | `openssl rand -base64 32`, update, redeploy, then connect the channel again |
| `VPS_SSH_KEY` | The private half of the `deploy` user's SSH key; GitHub deploys with it | 1 year | New key pair (`server.md` C.4), add the public half to `authorized_keys`, update the secret, deploy once, then remove the old public half |

Secret values can't contain a single quote or a line break (`scripts/render-env.sh` refuses them). `openssl rand -base64` output is fine.

**Not secret** (GitHub environment variables):
- the server details: `VPS_HOST`, `VPS_USER`, `VPS_KNOWN_HOSTS`;
- the service settings: `APP_ORIGIN`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, the bucket names, `MAIL_FROM`, `GOOGLE_OAUTH_CLIENT_ID`, `BACKUP_AGE_RECIPIENT` (an age *public* key);
- the Google integration's switches and names: `LIVE_PROVIDER`, `VIDEO_HOST`, `GOOGLE_PROJECT_ID`, `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_SUBSCRIPTION`, `YOUTUBE_OAUTH_CLIENT_ID`, `DRIVE_CLEANUP_MODE`.

**Not stored anywhere:** the container registry needs no long-lived token. Each deploy logs the VPS in with the workflow's own short-lived token and logs out afterwards.

**In the database, sealed:** the YouTube channel's OAuth refresh token. Only Google's consent screen can produce it, so it can't be an environment variable. It is encrypted (AES-256-GCM) under `TOKEN_ENCRYPTION_KEY`, never returned by the API, and never logged.

**Kept offline:** the **age private key** that decrypts the weekly backups. It's held by the System Admin and one other named person, never stored on the VPS, in Neon, in R2 or in GitHub. Generate the pair with `age-keygen -o glim-backup-key.txt`; the printed `age1…` line is `BACKUP_AGE_RECIPIENT`.

**Never** paste a secret into an issue, chat, log or email. If one leaks, rotate it immediately as described above.
