# Secrets inventory

Every secret is an **encrypted App Platform environment variable**, supplied at deploy time from a GitHub Actions **environment secret** (never committed). The System Admin owns all of them (TRD §19.1, §22.3).

| Secret (GitHub name) | App variable | What it is | Rotate | How |
|---|---|---|---|---|
| `DATABASE_URL_MIGRATOR` | `DATABASE_URL_MIGRATOR` | Connection string for `glim_migrator`, used only by the `migrate` job | 180 days | Reset the user's password in DO Databases, update the secret, redeploy |
| (bound by App Platform) | `DATABASE_URL`, `DATABASE_URL_DIRECT` | `glim_app` via the `glim-tx` pool and directly | 180 days | Reset `glim_app`'s password; App Platform rebinds on redeploy |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | same | Spaces key limited to `glim-files` and `glim-backups` | 180 days | Create a new key, update both secrets, redeploy, then delete the old key |
| `SENDGRID_API_KEY` | same | SendGrid key with Mail Send only | 180 days | Create a new key, update, redeploy, delete the old one |
| `GOOGLE_OAUTH_CLIENT_SECRET` | same | Google sign-in client secret | 1 year | Add a new secret in Google Cloud, update, redeploy, then remove the old one |
| `SESSION_SECRET` | same | Signs the Google sign-in flow cookie | 1 year | Generate 48+ random characters; rotating it cancels sign-ins in progress |
| `CSRF_SECRET` | same | Reserved for CSRF hardening; sessions carry their own CSRF secrets | 1 year | Generate 48+ random characters |
| `DIGITALOCEAN_ACCESS_TOKEN` | (GitHub only) | Deploys and pushes images | 90 days | New token in DO API settings, update the repository secret |

**Not secret** (GitHub environment variables): `GOOGLE_OAUTH_CLIENT_ID`, `SENDGRID_WEBHOOK_PUBLIC_KEY`, and `BACKUP_AGE_RECIPIENT` (an age *public* key).

**Kept offline:** the **age private key** that decrypts the weekly backups. It's held by the System Admin and one other named person, never stored in DigitalOcean or GitHub. Generate the pair with `age-keygen -o glim-backup-key.txt`; the printed `age1…` line is `BACKUP_AGE_RECIPIENT`.

**Never** paste a secret into an issue, chat, log or email. If one leaks, rotate it immediately as described above.
