# Runbook: personal data breach

**When:** you suspect personal data was lost, exposed, changed or accessed without permission. Examples: a leaked database backup or secret, a staff account used by someone else, files or transcripts sent to the wrong person, or a provider reporting a breach.

**Clock:** the NDPA 2023 requires notifying the **Nigeria Data Protection Commission (NDPC) within 72 hours** of becoming aware of a breach likely to risk people's rights. When the risk is high, the people affected must also be told without undue delay. Start the clock when you become aware: write the time down first.

## 1. Record (first 15 minutes)

1. Open an incident note (date, time you became aware, who reported it, what is known). Keep adding to it with timestamps; it becomes the breach record.
2. Tell the college's Data Protection Officer (DPO) and the System Admin.

## 2. Contain (first hour)

Do whatever applies:

- **A staff or student account misused:** suspend the account (Admin → Users → Suspend). Suspending ends its sessions at once. Revoke its staff roles.
- **A secret leaked** (`SESSION_SECRET`, `CSRF_SECRET`, database, Spaces or SendGrid keys, backup age key): rotate it in App Platform, then redeploy. See `docs/secrets.md` for where each one lives.
- **Sessions may be compromised** (for example a database copy leaked): sessions are random tokens stored only as hashes, so rotating secrets doesn't end them. Sign everyone out from a database console with `UPDATE auth_sessions SET revoked_at = now() WHERE revoked_at IS NULL;` (it takes effect within 5 seconds), then ask staff to change their passwords.
- **A file shared wrongly:** download links expire after 5 minutes. A transcript sent to the wrong recipient can be revoked (Transcript → Revoke, with the reason), and the verify page then shows it as not valid.
- **A recording published wrongly:** unpublish or delete it in Admin → Videos, and set it to private in YouTube Studio.
- **A provider breach** (DigitalOcean, Google, SendGrid): follow their notice, rotate the keys we hold for them, and record what of ours they hold (see `docs/compliance/ropa.md`).

## 3. Assess (within 24 hours)

From the audit log (Admin → Audit log; filter by actor, action and time) and the ops page, work out:

- what data and how many people, especially **sensitive data** (applicants' spiritual-background answers) and **children** (none: applicants must be 18 or over);
- whether the data was encrypted (backups are age-encrypted) or is otherwise unintelligible;
- the likely consequences for the people affected.

## 4. Notify (within 72 hours of awareness)

- **NDPC:** the DPO notifies through the NDPC's breach portal or contact, with the nature of the breach, the categories and approximate numbers of people and records, the likely consequences, what was done to contain it, and a contact point. If something isn't known yet, notify anyway and follow up.
- **The people affected** (when the risk is high): plain language, what happened, what it means for them, what we did and what they should do (for example, watch for phishing). Send it from the college's address; a bulk email can go through SendGrid.
- **Processors and partners** as their contracts require.

## 5. Recover and learn

1. Fix the cause; add a test for it if it was a defect.
2. Restore from backup if data was lost (`docs/runbooks/restore.md`).
3. Finish the breach record (timeline, decisions and who made them, notifications sent and when). Keep it, even for breaches that didn't need notifying.
4. Review within two weeks: what would have caught it sooner?
