# Restoring the database

**For:** the System Admin.
**Practise this twice a year** (a restore drill, TRD §22.7) on a scratch cluster, never on production.

There are two kinds of backup:

| Backup | Kept for | Use it when |
|---|---|---|
| DigitalOcean's daily backups with point-in-time recovery (PITR) | DigitalOcean's retention window | Almost always: you can restore to any minute in the window. |
| GLIM's weekly encrypted logical dump in the `glim-backups` Space | 12 weeks | The cluster's own backups are unavailable, or you need data from further back. |

## A. Point-in-time restore (preferred)

1. **DigitalOcean → Databases → glim-db → Backups → Restore from backup**, and choose the time just before the problem.
2. DigitalOcean creates a **new** cluster from the backup. Wait until it's online.
3. In the new cluster, recreate the connection pool **`glim-tx`** in **transaction** mode for `glim_app`, and add the app as a trusted source.
4. Point the app at the new cluster: **Apps → glim → Settings → Database**, attach the new cluster, and redeploy. Update the `DATABASE_URL_MIGRATOR` secret if its host changed.
5. Check `/readyz`, sign in, and look at recent records.
6. Keep the old cluster until you're sure, then delete it.

## B. Restore from the weekly logical dump

You need:
- the **age private key**, kept offline by the System Admin and one other named person
- `age` and PostgreSQL 18's `pg_restore` on your computer

Then:

1. In **Spaces → glim-backups → postgres/**, download the dump you want (`glim-<date>.dump.age`).
2. Decrypt it: `age --decrypt -i glim-backup-key.txt glim-<date>.dump.age > glim.dump`
3. Create an empty database `glim` on the target cluster, owned by `glim_migrator`. The roles `glim_migrator` and `glim_app` must already exist on that cluster.
4. Restore as the migrator:
   `pg_restore --no-owner --clean --if-exists --role=glim_migrator --dbname="<migrator connection string>" glim.dump`
   It should print nothing. (`--clean --if-exists` replaces the empty `public` schema the new database starts with; without it pg_restore reports `schema "public" already exists`.) The dump carries the `citext` and `btree_gist` extensions and the app role's permissions, including the audit log's missing UPDATE and DELETE.
5. Run the migrations once (they find nothing to do unless the dump is older than the code, and they re-grant the job queue): run the `migrate` job (redeploy), or `pnpm --filter @glim/db migrate` with `DATABASE_URL_MIGRATOR` set.
6. Point the app at it as in A.4, and check as in A.5.

The dump holds the `public` (college data), `pgboss` (background jobs) and `drizzle` (migration history) schemas. Uploaded files (photos, documents) live in the `glim-files` Space and aren't in the dump.

## Where the backups come from

- The worker runs `db.logical-backup` every Sunday at 01:00 UTC. If it fails, it appears on the ops page (ticket 44) and in the worker logs.
- The `glim-backups` Space has a lifecycle rule that deletes dumps after 12 weeks.

## Drill record

| Date | Where | What | Result | Time |
|---|---|---|---|---|
| 2026-10-09 | Local (Postgres 18.6, MacBook), ticket 46 | Section B without `age`: `pg_dump` as `glim_app` with the backup job's flags, of the e2e stack's database (14 users, 37 audit rows, 45 migrations, 320 KB); restore as `glim_migrator` into an empty database; migrate | Row counts identical; `glim_app` reads and writes the data and the job queue; `glim_app` still can't change `audit_logs` | dump 0.1 s, restore 0.4 s, migrate 1.3 s: **1.9 s** |
| — | Staging (DigitalOcean), before launch | Section A (point-in-time restore to a new cluster) and section B with a real weekly dump and the `age` key | To do (System Admin) | Record the time from "decide to restore" to "`/readyz` green" |

The first local attempt found two faults in the weekly dump, both fixed in ticket 46 and covered by `apps/worker/test/backup.itest.ts`, which restores a dump this way on every integration run:
1. `--schema` leaves extensions out of a dump, so restoring into an empty database failed on every `citext` column. The dump now includes `citext` and `btree_gist`.
2. The dump was taken with `--no-privileges`, and the app role's permissions on the college data come from the first migration, which doesn't run again on a restored database. The app would have been unable to read anything. The dump now keeps privileges.
