# GLIM Bible College — school management system

The school management system for GLIM Online Bible College (Gospel Light International Ministries). It covers:
- admissions;
- academic records;
- hybrid teaching (in a Room and on Google Meet at once);
- recorded lectures on YouTube;
- assignments, quizzes and exams;
- results, awards and transcripts.

It serves **one institution** of about 100–200 students and 10–25 staff. It runs on DigitalOcean App Platform with Managed PostgreSQL, and sends email through SendGrid.

This README has two parts:
- [**Using the system**](#using-the-system): what each kind of user does, and where in the app they do it.
- [**Developer onboarding**](#developer-onboarding): running it locally, how the code is organised, the rules, and how to ship a change.

Words like *Class Meeting*, *Course Offering*, *Matric Number* and *Academic Session* have precise meanings, defined in [`GLOSSARY.md`](GLOSSARY.md). Use them in code, UI text and docs. Never write "teacher", "student number", or "session" on its own.

---

## Using the system

### Who uses it

| Role | Who | What they do |
|---|---|---|
| **Applicant** | Anyone applying | Fills in and submits the application form, then accepts an Offer |
| **Student** | An admitted applicant, with a Matric Number | Registers for courses, attends and joins Class Meetings, watches recordings, submits work, sees results, requests transcripts |
| **Lecturer** | Staff assigned to a Course Offering | Runs Class Meetings and Roll Call, shares materials, sets and grades work, keeps the gradebook |
| **Admissions Officer** | Staff role | Reviews applications and decides admission |
| **Academic Admin** | Staff role | Sets up Academic Sessions, semesters, curricula, Course Offerings, Lecturers and imports |
| **Registrar** | Staff role | Finalizes and publishes results, confers Awards, issues transcripts, keeps grading schemes |
| **System Admin** | Staff role (usually one person) | Manages users and roles, settings, videos, the audit log and the ops page |

A person can hold several staff roles. The navigation bar shows only the pages each person's roles allow, and the server checks every request again: hiding a link is never the protection.

### Signing in

- **Staff** are invited by the System Admin. The email holds a link, valid for 7 days, to set a password (at least 12 characters).
- **Applicants and students** sign in with Google ("Continue with Google") or an email and password.
- **Forgotten password:** use "Forgot password" on the sign-in page. The reset link lasts 30 minutes and signs you out everywhere else.
- **Lockout:** 5 wrong passwords lock the account for 15 minutes.
- **Signing out automatically:** after 2 hours without activity, or after 12 hours in total. Applicants filling in the long form get 24 hours.

Times are shown in your own timezone, with Lagos time alongside when it differs. Set your timezone on **Profile**.

### Applicants

1. Go to **/apply** and start an application for the open Intake. The form is the online version of the college's paper Diploma form.
2. Fill it in at your own pace. Every section **autosaves**, so you can leave and come back. Upload a passport photo (JPEG or PNG, up to 2 MB).
3. **Submit.** The Admissions Officer reviews it, and you're emailed when there's a decision.
4. If you're offered a place, **accept the Offer within 21 days**, or it lapses. Accepting makes you a student with a **Matric Number** (for example `GLIM/DIP/2027/0001`).

Drafts never submitted are deleted 12 months after their last edit. Answers about your spiritual background stay with Admissions and are never shown elsewhere.

### Students

| To… | Go to |
|---|---|
| Choose Elective Courses for the semester (Compulsory Courses are added for you) | **Registration** |
| See your courses: materials, announcements, assignments, quizzes and recordings | **Courses** |
| Join an online Class Meeting | The meeting, inside its join window. Joining reads the link from GLIM, not from Google. |
| Watch a recorded lecture | The course page under **Courses**. Playback resumes where you stopped. On slow data, choose 144p in the player. |
| Submit an assignment, or take a quiz or online exam | The course page. Exams are timed and submit themselves when time runs out. |
| See grades, semester GPA, CGPA and standing | **Results**. Results appear only once the Registrar publishes them. |
| Request an official transcript | **Transcripts** |
| Manage email and in-app notifications | **Notifications** → "What you get" |
| Download everything held about you | **Profile** → "Download my data" |

**Graduates** keep their account: they can still sign in for their results and transcripts.

### Lecturers

Open **My offerings** (`/teach`). For each Course Offering you teach:
- **Class Meetings:** start the online meeting, or take **Roll Call** on a phone in the Room. Roll Call works offline and retries until it's saved. Attendance combines Roll Call with who joined online.
- **Materials and announcements:** post text (Markdown), links and files. Pin important announcements.
- **Recordings:** add a YouTube link (unlisted), check its title, and publish it. GLIM checks that the link is on GLIM's channel.
- **Assignments, quizzes and online exams:** create them, then grade the submissions.
- **Gradebook:** the columns' weights must add up to 100 %. Enter or import scores, then release them to students. Exams can mix paper scores with online-exam scores.

### Admissions Officer

**Admissions** (`/admissions`):
- the application queue;
- reviewing an application, with notes;
- decisions (admit or reject);
- reopening a lapsed Offer;
- **Intakes** (the yearly cycle: applications open in November and close in June);
- **Reports**, including a CSV export.

### Academic Admin

| Page | Purpose |
|---|---|
| **Academic** | Academic Sessions, semesters, Programmes (Certificate, Diploma), Courses, Rooms |
| **Calendar** | The semester calendar |
| Curricula (from **Academic**) | Which courses each Programme takes, by Level and semester, compulsory or elective |
| **Offerings** | Course Offerings each semester: their Lecturers, Class Meetings and capacity. The database refuses a Room or a Lecturer booked twice at once. |
| **Lecturers** | Internal and visiting Lecturers |
| **Imports** | CSV imports, including existing students with their past results |

### Registrar

Results move through these stages, all under **Results**:
1. **Course results:** finalize a Course Offering's results from its gradebook (reopen it if a correction is needed).
2. **Semester results:** compute GPA and CGPA, approve, then **publish**, at which point students see them. Includes the broadsheet.
3. **Awards:** confirm the proposed Award and Award Class for each finishing student.
4. **Transcripts:**
   - issue transcripts from a frozen snapshot, as a PDF with a QR code;
   - email them;
   - revoke or supersede them when needed.

   Anyone can check a transcript at **/verify/&lt;code&gt;**.

**Grading schemes** set the grade bands, points and Award Classes for each Programme. All grade arithmetic is exact: no rounding drift.

### System Admin

| Page | Purpose |
|---|---|
| **Users** | Invite staff, assign and revoke roles, and erase a person's personal data on request (their academic record is kept under a pseudonym) |
| **Videos** | Every recording. Restore deleted ones within 7 days, replace links, recheck availability. |
| **Audit** | Who did what, and when. The audit log can't be edited. |
| **Ops** | Failures with a **Replay** button, the YouTube check, and suppressed email addresses |
| **Jobs** | Background job queues. You're emailed when a queue falls behind by more than 2 minutes. |
| **Integrations** | Google Meet (host accounts, the Admin Console values, a background test) and GLIM's YouTube channel connection. Both are off until switched on: until then Lecturers paste Meet links and recordings are added by link. |
| **Settings** | Institution details, YouTube channel URLs, and the privacy-notice, recording-notice and Statement of Faith URLs |

The System Admin's runbooks, written in plain steps, are in [`docs/runbooks/`](docs/runbooks):
- [deploying and rolling back](docs/runbooks/deploy.md);
- [restoring the database](docs/runbooks/restore.md);
- [a provider being down](docs/runbooks/provider-outage.md);
- [switching on Google Meet and automatic recording upload](docs/runbooks/google.md);
- [a data breach](docs/runbooks/breach.md).

---

## Developer onboarding

### Prerequisites

- **Node 24** (see `.nvmrc`) and **pnpm 12** (`corepack enable`, or `npm i -g pnpm@12.8.1`).
- **Docker**, for Postgres 18, MinIO (S3-compatible storage) and Mailpit (a local mail catcher).

### First run

```sh
pnpm install
docker compose -f docker/compose.yaml up -d --wait   # Postgres :5432, MinIO :9000 (console :9001), Mailpit :1025 (UI :8025)
pnpm db:migrate
pnpm dev                                             # API :3000, worker, web (Vite) :5173, with /api proxied to the API
```

Then create the first System Admin. The invite email arrives in Mailpit at http://localhost:8025:

```sh
pnpm --filter @glim/api admin:bootstrap --email you@example.org --name "Your Name"
```

Open http://localhost:5173, set your password from the invite link, and invite everyone else from **Users**.

You don't need a `.env`: every setting defaults to the compose stack. To override, copy `.env.example` to `.env`. If port 5432 is taken, start compose with `GLIM_PG_PORT=5434` and point the `DATABASE_URL*` variables at that port. There is more in [`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md), including Google sign-in.

### How the code is organised

```
apps/
  api/        NestJS on Fastify: the HTTP API, plus the built SPA it serves at /
  worker/     pg-boss job handlers and cron (email, checks, results, backups…)
  web/        React SPA (TanStack Router + Query, Tailwind), built mobile-first
packages/
  contracts/  Zod endpoint contracts, enums, queues, authorization matrix (the web imports types only)
  db/         Drizzle schema, migrations, the Db wrapper (one transaction shared with pg-boss)
  modules/    Business logic, by domain (admissions, academic, teaching, results, transcripts, …)
  integrations/  Ports and adapters: mail, storage, OIDC, YouTube, PDF; plus fakes for tests
  shared/     Config, clock, Result types, time formatting
  telemetry/  Logging
docs/         TRD (the source of truth), ADRs, decisions, runbooks, compliance, spikes
load/         k6 load tests (staging only)
.scratch/     Specs and tickets (local markdown issue tracker)
```

The flow of a request:
1. A **contract** in `packages/contracts` defines the endpoint: method, path, body, response, permission and rate limit.
2. A thin **controller** in `apps/api` routes it.
3. A **service** in `packages/modules` holds the business rules.
4. **Postgres** enforces correctness with constraints, including the Room and Lecturer double-booking exclusions.

Background work is enqueued as a pg-boss job in the **same transaction** as the change that caused it, so a job is never lost and never orphaned.

### Where the truth lives

| Question | Read |
|---|---|
| What should the system do? | [`docs/TRD.md`](docs/TRD.md) (v3.0). For the v1 slice, [`.scratch/school-management-v1/spec.md`](.scratch/school-management-v1/spec.md) wins over the TRD. |
| What does this word mean? | [`GLOSSARY.md`](GLOSSARY.md) |
| Why was it decided this way? | [`docs/decisions.md`](docs/decisions.md), [`docs/adr/`](docs/adr) |
| Where does the code differ from the TRD, and why? | [`docs/implementation-notes.md`](docs/implementation-notes.md) |
| What's being worked on? | [`.scratch/school-management-v1/issues/`](.scratch/school-management-v1/issues) (see [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)) |
| Are we ready to launch? | [`docs/launch-checklist.md`](docs/launch-checklist.md), [`docs/security-checklist.md`](docs/security-checklist.md) |

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API, worker and web in watch mode |
| `pnpm typecheck` · `pnpm lint` · `pnpm format:check` | Types, ESLint, Prettier |
| `pnpm deps:check` | Dependency rules between apps and packages |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests against real Postgres 18 and MinIO, with a fresh database per file |
| `pnpm test:e2e` | Playwright on a phone viewport, against the built SPA and a throwaway database |
| `pnpm budget:check` | Web bundle-size budgets |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply migrations |

Integration and e2e tests start Postgres and MinIO with Testcontainers. To reuse servers you already run, set `TEST_POSTGRES_URL` and `TEST_S3_ENDPOINT` in `.env`. On a laptop, keep it awake during long runs (macOS: prefix with `caffeinate -dims`).

### The rules

These come from the TRD (§0.2) and are enforced in review and, where possible, in tests:

- **One institution.** No tenant keys and no multi-tenancy.
- **Authorization is on the server**, from `packages/contracts` (`matrix.json`). Every endpoint with a permission needs an allow and a deny sample in `apps/api/test/authz.itest.ts`, or that test fails. Staff denied access to a specific resource get 404; otherwise they get 403.
- **Correctness lives in Postgres**: constraints, exclusion constraints and triggers. Write custom SQL with `drizzle-kit generate --custom`. Never use `drizzle-kit push` outside a scratch database.
- **Jobs and audit go in the same transaction** as the change. No Redis, and no outbox.
- **Business rules live in `packages/modules`**, never in controllers or job handlers.
- **Grades and GPA use exact integer arithmetic** (scaled integers, `roundHalfUp`). Never floats.
- **No Google or YouTube calls in a request**, except the link check when a video is added. The join path reads only the database. Never return Drive URLs. Video bytes never pass through the API.
- **Secrets stay out of the repository and the logs**, and so do tokens and spiritual-background answers. Sensitive applicant answers stay in Admissions.
- **Budgets and invariants are never weakened** to make a test pass.

### Making a change

1. Find or write the ticket under `.scratch/`, and read the TRD sections it points to.
2. Change the **contract** first, if the API changes.
3. Write the tests with the code: unit tests, integration tests including the deny paths, an authz sample for any new endpoint, and a Playwright flow for UI changes.
4. If the change departs from the TRD, add a row to `docs/implementation-notes.md`. Update the docs whenever behaviour or configuration changes.
5. Run the full gate locally:

   ```sh
   pnpm format:check && pnpm lint && pnpm typecheck && pnpm deps:check && pnpm budget:check \
     && pnpm test && pnpm test:integration && pnpm test:e2e
   ```

6. Commit using Conventional Commits, lower case after the type (`feat: transcript requests (ticket 41)`); a commit-msg hook checks this.

**CI** (`.github/workflows/ci.yml`) runs:
- the same checks;
- a gitleaks secret scan;
- a Trivy scan of the image and the lockfile;
- Lighthouse CI (LCP ≤ 4 s on slow 4G).

**Deploys** go to staging first, then to production after manual approval (see [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md)).
