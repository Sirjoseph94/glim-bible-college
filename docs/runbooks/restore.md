# Restoring the database

**For:** the System Admin.
**Practise this twice a year** (a restore drill, TRD §22.7) on staging, never on production.

The database is in **Neon** (Frankfurt) and the backups are in **Cloudflare R2** (ADR-0004). The VPS holds no data; if it's lost, see [`server.md`](server.md).

There are two kinds of backup:

| Backup | Kept for | Use it when |
|---|---|---|
| Neon's **instant restore** (point in time) | 7 days on the Launch plan, up to 30 on Scale | Almost always: you can restore to any moment in the window. |
| GLIM's weekly encrypted logical dump in the `glim-backups` R2 bucket | 12 weeks | Neon's history doesn't reach back far enough, or Neon itself is unavailable. |

## A. Point-in-time restore (preferred)

1. **Stop new writes.** On the VPS, run `cd /opt/glim && docker compose stop worker`. Tell staff the system is briefly down.
2. In **Neon → the project → Backup & Restore**, choose **Restore from history** on the default branch, and pick the time just before the problem.
3. Neon restores the branch **in place**, usually within seconds:
   - connection strings don't change, so the app needs no reconfiguring;
   - the state from just before the restore is kept as a branch named `…_old_<timestamp>`.

   Open connections drop briefly. The API reconnects by itself.
4. On the VPS, run `docker compose start worker`.
5. Check `/readyz`, sign in, and look at recent records.
6. When you're sure, delete the `…_old_…` branch. Until then it holds the data from before the restore, in case you need to copy something back.

## B. Restore from the weekly logical dump

You need:
- the **age private key**, kept offline by the System Admin and one other named person
- `age` and PostgreSQL 18's `pg_restore` on your computer

Then:

1. In **Cloudflare → R2 → glim-backups → postgres/**, download the dump you want (`glim-<date>.dump.age`).
2. Decrypt it: `age --decrypt -i glim-backup-key.txt glim-<date>.dump.age > glim.dump`
3. Prepare an empty target: a new Neon project, or a new branch of the existing one, with an empty database `glim` owned by `glim_migrator` and the role `glim_app`. Follow [`server.md`](server.md) A.4. Take its direct (not pooled) connection strings.
4. Restore as the migrator:
   `pg_restore --no-owner --clean --if-exists --role=glim_migrator --dbname="<migrator connection string>" glim.dump`
   It should print nothing. (`--clean --if-exists` replaces the empty `public` schema the new database starts with; without it pg_restore reports `schema "public" already exists`.) The dump carries the `citext` and `btree_gist` extensions and the app role's permissions, including the audit log's missing UPDATE and DELETE.
5. Point the app at it: update the `DATABASE_URL`, `DATABASE_URL_DIRECT` and `DATABASE_URL_MIGRATOR` secrets in GitHub and redeploy (**Actions → Deploy → Run workflow**). The deploy runs the migrations once. They find nothing to do unless the dump is older than the code, and they re-grant the job queue.
6. Check as in A.5.

The dump holds the `public` (college data), `pgboss` (background jobs) and `drizzle` (migration history) schemas. Uploaded files (photos, documents) live in the `glim-files` R2 bucket and aren't in the dump.

## Where the backups come from

- The worker runs `db.logical-backup` every Sunday at 01:00 UTC. If it fails, it appears on the ops page (ticket 44) and in the worker logs.
- The `glim-backups` R2 bucket has a lifecycle rule that deletes dumps after 12 weeks (84 days).

## Drill record

| Date | Where | What | Result | Time |
|---|---|---|---|---|
| 2026-10-09 | Local (Postgres 18.6, MacBook), ticket 46 | Section B without `age`: `pg_dump` as `glim_app` with the backup job's flags, of the e2e stack's database (14 users, 37 audit rows, 45 migrations, 320 KB); restore as `glim_migrator` into an empty database; migrate | Row counts identical; `glim_app` reads and writes the data and the job queue; `glim_app` still can't change `audit_logs` | dump 0.1 s, restore 0.4 s, migrate 1.3 s: **1.9 s** |
| — | Staging (Neon), before launch | Section A (Neon instant restore) and section B with a real weekly dump from R2 and the `age` key | To do (System Admin) | Record the time from "decide to restore" to "`/readyz` green" |

The first local attempt found two faults in the weekly dump, both fixed in ticket 46 and covered by `apps/worker/test/backup.itest.ts`, which restores a dump this way on every integration run:
1. `--schema` leaves extensions out of a dump, so restoring into an empty database failed on every `citext` column. The dump now includes `citext` and `btree_gist`.
2. The dump was taken with `--no-privileges`, and the app role's permissions on the college data come from the first migration, which doesn't run again on a restored database. The app would have been unable to read anything. The dump now keeps privileges.
