# Building the server, database and storage

**For:** the System Admin.
**When:** setting up staging or production for the first time, or rebuilding a lost VPS (ADR-0004, TRD §22.2, Appendix A.3).
**You need:**
- the Hostinger, Neon and Cloudflare accounts;
- admin access to the GitHub repository;
- access to the domain's DNS;
- a terminal with `ssh`.

Do everything for **staging first**. Production is the same with production names. Where a step says *staging*, use a smaller or cheaper option.

Rebuilding a lost VPS? The database (Neon) and files (R2) are untouched. Do only part C, then part D's first deploy.

## A. Neon (the database)

1. **Create the project.** Name it `glim-production` (or `glim-staging`):
   - Postgres version **18**;
   - region **AWS Europe Central 1 (Frankfurt)**. It can't be changed later.
2. **Set the compute.** Go to **Branches → the default branch → Compute → Edit**:
   - autoscaling from **0.25** to **1** CU;
   - **Scale to zero: off** for production. Staging can leave it on; it just takes a second to wake.
3. **Protect the default branch** (**Settings → Protected branches**). This stops it being deleted or reset by mistake.
4. **Create the roles and the database:**
   1. **Roles → Add role:** `glim_migrator`. Copy the password into your password manager.
   2. **Databases → Add database:** `glim`, owner `glim_migrator`.
   3. In the **SQL Editor**, on database `glim`, create the app's role with SQL. Roles created this way get no extra privileges; the first migration grants what it needs.
      ```sql
      CREATE ROLE glim_app LOGIN PASSWORD '<32+ random characters>';
      GRANT CONNECT ON DATABASE glim TO glim_app;
      ```
      Generate the password with `openssl rand -base64 32 | tr -d '/+='`, and keep it in your password manager.
5. **Build the three connection strings.** Use **Connect**, with database `glim`:

   | GitHub secret | Role | Connection pooling |
   |---|---|---|
   | `DATABASE_URL` | `glim_app` | **on** (the host ends `-pooler…`) |
   | `DATABASE_URL_DIRECT` | `glim_app` | off |
   | `DATABASE_URL_MIGRATOR` | `glim_migrator` | off |

   In each one, replace everything after `?` with `sslmode=verify-full`. The copied string may end `&channel_binding=require`; remove that too. The result looks like:
   `postgresql://glim_app:<password>@ep-…-pooler.eu-central-1.aws.neon.tech/glim?sslmode=verify-full`
6. **IP Allow** (Scale plan only). Once the VPS exists (part C), go to **Settings → Network security → IP Allow**, add the VPS's IP, and tick *protected branches only*.

## B. Cloudflare R2 (files and backups)

1. **Turn on R2.** In the Cloudflare dashboard, open **R2**. Cloudflare needs a payment method; the first 10 GB are free.
2. **Create two buckets**, both with **Location: Specify jurisdiction → European Union**:
   - `glim-files` (staging: `glim-staging-files`);
   - `glim-backups` (staging: `glim-staging-backups`).
3. **Add a CORS rule to the files bucket** (**Settings → CORS policy**). Browsers upload photos and files straight to it:
   ```json
   [{ "AllowedOrigins": ["https://portal.<glim-domain>"], "AllowedMethods": ["GET", "PUT"],
      "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3000 }]
   ```
4. **Add lifecycle rules** (**Settings → Object lifecycle rules**):
   - on `glim-backups`: delete objects **84 days** (12 weeks) after upload;
   - on both buckets: abort incomplete multipart uploads after 1 day.
5. **Create the API token.** Go to **R2 → Manage API tokens → Create**:
   - permission **Object Read & Write**;
   - **apply to specific buckets**: the two buckets above only.

   Copy these into GitHub:
   - the **Access Key ID** → `STORAGE_ACCESS_KEY` (secret);
   - the **Secret Access Key** → `STORAGE_SECRET_KEY` (secret);
   - the **EU jurisdiction endpoint**, `https://<account-id>.eu.r2.cloudflarestorage.com` → `STORAGE_ENDPOINT`;
   - `STORAGE_REGION` = `auto`.

## C. Hostinger (the VPS)

1. **Buy the VPS.** KVM 2 or larger for production; the smallest KVM is enough for staging.
   - **Location: Germany.** Before paying, check with Hostinger that its German data centre is in or near Frankfurt.
   - **Operating system:** plain **Ubuntu 24.04 LTS**, with no control panel.
   - **Add your own SSH public key** during setup.
2. **DNS.** Add an `A` record `portal` (production) or `staging` pointing at the VPS's IP, with a TTL of 300.
3. **Set the server up.** SSH in as `root` (`ssh root@<ip>`) and run:
   ```sh
   apt update && apt -y upgrade
   apt -y install unattended-upgrades ufw curl
   dpkg-reconfigure -f noninteractive unattended-upgrades

   # Docker Engine and Compose, from Docker's own repository
   install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
   apt update && apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

   # The user GitHub deploys as. Membership of "docker" is root-equivalent: guard its key.
   adduser --disabled-password --gecos "" deploy
   usermod -aG docker deploy
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   install -d -m 750 -o deploy -g deploy /opt/glim

   # Firewall: SSH and the web only
   ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
   ufw --force enable

   # SSH keys only, no passwords
   printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/00-glim.conf
   systemctl reload ssh
   ```
   Docker publishes ports past `ufw`. That's fine here: only Caddy publishes any (80 and 443), and the API containers publish none.
4. **Create the deploy key.** On your own computer:
   ```sh
   ssh-keygen -t ed25519 -N "" -C glim-deploy -f glim-deploy
   ```
   1. Copy `glim-deploy.pub` into `/home/deploy/.ssh/authorized_keys` on the VPS. Make it owned by `deploy`, mode 600.
   2. Put the private key, `glim-deploy`, into the GitHub environment secret `VPS_SSH_KEY`. Then delete both files from your computer.
   3. Run `ssh-keyscan -t ed25519 <ip>`. Check that its fingerprint matches the one from `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VPS, then put the line into the GitHub variable `VPS_KNOWN_HOSTS`.
   4. Set `VPS_HOST` (the IP or host name) and `VPS_USER` (`deploy`).
5. **Set up the disk alert** (as root). It emails you when the disk is over 85% full:
   ```sh
   echo '0 7 * * * root /opt/glim/disk-alert.sh <your email>' > /etc/cron.d/glim-disk-alert
   ```
   It uses `disk-alert.sh` and the SendGrid key, both of which the first deploy puts in `/opt/glim`.

## D. First deploy and checks

1. Set every GitHub variable and secret listed in [`deploy.md`](deploy.md), then run **Actions → Deploy → Run workflow** on `main`. The first deploy runs every migration on the empty database.
2. **Check the database round trip.** On the VPS, as `deploy`:
   ```sh
   cd /opt/glim
   docker compose run --rm --no-deps -e PGSSLROOTCERT=system worker \
     sh -c 'psql "$DATABASE_URL_DIRECT" -qAt -c "\timing on" -c "select 1" -c "select 1" -c "select 1"'
   ```
   Each `Time:` should be a few milliseconds. Tens of milliseconds means the VPS and Neon aren't in the same city; every page will be slow. This also checks the TLS settings the weekly backup uses.
3. **Check the site.** Open `https://<domain>/readyz`; it should say `{"status":"ok",...}`. Then sign in and upload a passport photo, which checks R2 and CORS.
4. **Set up uptime checks.** In any external uptime service (UptimeRobot and Better Stack have free plans), check `https://<domain>/readyz`, `/login` and `/apply` every few minutes, alerting the System Admin by email after 2 failures.
5. **Neon IP Allow** (Scale plan): now that the VPS's IP is known, do part A step 6.
6. Record the date and anything that differed from this runbook in `docs/spikes/S-17-app-platform.md`.

## Looking after the server

- **Security updates** install themselves. Reboot monthly, or when `/var/run/reboot-required` exists: `sudo reboot`. The containers start again on their own.
- **Logs:** `cd /opt/glim && docker compose logs --tail 200 api1 worker`. Each container keeps 5 × 10 MB.
- **Disk:** `df -h /`. To free space, run `docker system prune`. It removes stopped containers and unused images, but keeps the running ones.
- **What's running:** `docker compose ps`. Every service should be `running`; `api1` and `api2` should be `healthy`.
- **Practise a rebuild** once a term: build a fresh staging VPS with part C, deploy to it, and time it. The target is under 2 hours.
