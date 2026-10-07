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
3. Create an empty database `glim` on the target cluster, owned by `glim_migrator`.
4. Restore as the migrator:
   `pg_restore --no-owner --role=glim_migrator --dbname="<migrator connection string>" glim.dump`
5. Run the migrations once, which also restores the app role's permissions: run the `migrate` job (redeploy), or `pnpm --filter @glim/db migrate` with `DATABASE_URL_MIGRATOR` set.
6. Point the app at it as in A.4, and check as in A.5.

The dump holds the `public` (college data), `pgboss` (background jobs) and `drizzle` (migration history) schemas. Uploaded files (photos, documents) live in the `glim-files` Space and aren't in the dump.

## Where the backups come from

- The worker runs `db.logical-backup` every Sunday at 01:00 UTC. If it fails, it appears on the ops page (ticket 44) and in the worker logs.
- The `glim-backups` Space has a lifecycle rule that deletes dumps after 12 weeks.
