# Runbook: a provider is down (YouTube, SendGrid, the database)

**For:** the System Admin.
**When:** the ops page (`/admin/ops`, `/admin/jobs`) shows failures, you're emailed that a job queue is falling behind, or people report that something isn't working.

GLIM is built so that an outside service being down delays background work but never loses it. Work is queued in the database in the same step that records it, and failed jobs are retried with backoff. All of this is tested on every build (`apps/api/test/resilience.itest.ts`).

## YouTube is unreachable

**What still works:** students watching. The player loads straight from YouTube in their browser, and GLIM doesn't need YouTube to decide who may watch.

**What waits:**
- adding or replacing a video link (the link check fails with "YouTube couldn't be checked just now");
- the daily availability check at 04:00 UTC, which stops and is retried later. It never marks a video unavailable because YouTube didn't answer.

**What to do:**
1. On **Ops → YouTube**, choose **Check now**. If it says oEmbed is unreachable, look at Google's status page.
2. Nothing else is needed. When YouTube is back, the retried check finishes on its own. Lecturers can add links again.
3. If the check is still failing after a day, open **Jobs** and look at `video.availability-check`. Replay it from **Ops** once YouTube answers.

## SendGrid is down, or email is bouncing

**What still works:** everything in the app. In-app notifications appear as usual.

**What waits:** email. Each message is retried up to 5 times with backoff. After that it appears under **Ops → failures** as a failed `notify.send` job.

**What to do:**
1. Check SendGrid's status page.
2. When it's back, replay the failed `notify.send` jobs from **Ops**.
3. If one person's address bounces, they're marked suppressed (shown on Ops). Once they've corrected their address, **Replay** clears the suppression.

## The database restarts or fails over

DigitalOcean restarts the database for maintenance, and fails over if a node dies.

**What people see:** for a few seconds requests fail, and `/readyz` reports not ready. The app and the worker reconnect on their own; they don't need a restart.

**What to do:**
1. Wait 2 minutes, then check `/readyz` and sign in.
2. On **Jobs**, the queues should drain. A queue that is still behind after 10 minutes means the worker isn't running: restart the worker component in **Apps → glim**.
3. If the database doesn't come back, follow `restore.md`.

## A worker stops mid-job

A job that was running when the worker died is picked up again once its expiry passes (2–30 minutes, depending on the job). Nothing needs doing unless the job then fails every retry. In that case it shows on **Ops**: fix the cause, then **Replay** it.
