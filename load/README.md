# Load tests (k6)

The TRD §21.4 load scenarios, with the TRD §20.2 SLOs as pass criteria. **Run them against staging only**, never production, before launch and after any change that could affect speed.

## What runs

`scenarios.js` runs these together, after signing every test account in once:

| Scenario | Load (TRD §21.4) | Pass criterion (TRD §20.2) |
|---|---|---|
| `browsing` | 250 signed-in students reading `/me`, their schedule, notifications and results every 5–15 s for 5 minutes | read p95 < 300 ms |
| `play` | 20 video authorizations a second for 2 minutes | p95 < 300 ms |
| `join` | 150 joins in 60 s, by different students | server p95 < 100 ms (the 1.5 s end-to-end budget includes the phone's network) |
| `progress` | 10 playback-progress writes a second for 3 minutes | write p95 < 500 ms |
| `autosave` | 50 applicants autosaving every 3 s for 3 minutes | write p95 < 500 ms |
| all | | under 0.5 % failed requests, over 99.5 % of checks pass |

k6 exits non-zero if any threshold fails.

Not covered here:
- Event bursts through the Pub/Sub emulator and concurrent ingests belong to the Google integration slice.
- Failure injection (YouTube unreachable, a worker dying mid-job, Postgres dropping its connections) is tested on every integration run in `apps/api/test/resilience.itest.ts`.
- The join storm's "zero provider calls" holds by construction: the join path reads only the database (TRD §0.2).

## Before you run it

1. **Seed staging.** Create about 250 test students (never real people) enrolled in one published Course Offering. Give that offering:
   - a published video;
   - a Class Meeting whose join window is open for the whole run.

   Create 50 test applicants, each with a draft application.
2. **List the accounts** in two files, one `email,password` per line: `students.csv` and `applicants.csv`. Keep them out of the repository: they hold passwords. `*.csv` under `load/` is ignored by git.
3. **Allow time for signing in.** Sign-ins are limited to 10 a minute per address (TRD §5.4), and the run comes from one machine. `setup()` therefore signs accounts in at 9 a minute. 300 accounts take about 33 minutes before the load starts. Each session lasts 2 hours idle, which is longer than the run.
4. **Watch staging while it runs.** Keep the ops page (`/admin/jobs`, queue age) and DigitalOcean's database graphs open. The connection count must stay under 80 % of the budget.

## Running it

With [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) installed:

```sh
cd load
k6 run \
  -e BASE_URL=https://staging.glim.example \
  -e STUDENTS=./students.csv -e APPLICANTS=./applicants.csv \
  -e VIDEO_ID=<published video id> -e MEETING_ID=<class meeting id> \
  scenarios.js
```

Or with Docker (`ORIGIN` is needed only when the address k6 uses differs from the app's own origin):

```sh
docker run --rm -v "$PWD/load:/load" -w /load grafana/k6 run \
  -e BASE_URL=https://staging.glim.example -e STUDENTS=./students.csv … scenarios.js
```

Check the inputs first with `-e SMOKE=1`. In that mode one student signs in and browses once, against the same thresholds. This was run against the local e2e stack in ticket 46:

```sh
docker run --rm -v "$PWD/load:/load" -w /load grafana/k6 run -e SMOKE=1 \
  -e BASE_URL=http://host.docker.internal:4173 -e ORIGIN=http://localhost:4173 scenarios.js
```

## Recording the result

Add a row to the table below with k6's summary: the p95 for each tagged metric and the failure rate. Tick "load tests green" in `docs/launch-checklist.md` only when every threshold passes on staging.

| Date | Environment | Result | Notes |
|---|---|---|---|
| 2026-10-09 | Local e2e stack, `SMOKE=1` | Passed (6 requests, read p95 12 ms) | Checks the script, sign-in, cookies and CSRF; not a load result |
