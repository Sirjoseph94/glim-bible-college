# GLIM Online Bible College — School Management System: Agent Build Specification

**Version:** 3.0 (GLIM edition) · **Date:** October 2026 · **Supersedes:** Build Spec v2.1 (archived at `docs/archive/TRD-v2.1.md`) and TRD v1.0 · **Audience:** Claude Code agents, and the people reviewing their work.

**Product:** The school management system for **GLIM Online Bible College** (Gospel Light International Ministries). It serves **one institution** and covers:

- **Admissions:** online application form, review, offer and acceptance.
- **Academic records:** programmes, curricula, enrollment and electives.
- **Hybrid teaching:** classes are held in a room and on **Google Meet** at the same time.
- **Attendance:** taken from Meet for online students and by roll call for students in the room.
- **Recordings:** held indefinitely in a **managed video service** and played back in a low-bandwidth player.
- **Assessment and results:** materials, assignments, quizzes, exams and the gradebook, rolling up into NUC 5-point GPA/CGPA, award classes and verifiable transcripts.

It runs on **DigitalOcean App Platform** with Managed PostgreSQL.

> **This file is the single source of truth.** Owner answers are recorded in `docs/decisions.md` and the domain language in `GLOSSARY.md`. Architecture decisions are in `docs/adr/` and §2.2. If something here is ambiguous or contradicts itself, **stop and raise it** (§0.4). Vendor facts that could not be verified are listed as **spikes** (Appendix B): build against the ports and fakes, and don't hard-wire them.

> **Language:** use the terms in `GLOSSARY.md` in code, UI copy, issues and tests. In particular: **Academic Session** means the academic year, **Class Meeting** means a scheduled class, **Lecturer** (not Teacher), **Matric Number** (not student number), and **Level** is Year 1 or Year 2. The word "session" is never used unqualified.

---

## Table of contents

0. Rules of engagement for agents
1. What changed from v2.1
2. Decisions: confirmed choices, ADRs, open items
3. Scope and personas
4. Architecture
5. Cross-cutting engineering standards
6. Data model (DDL)
7. Authorization
8. Identity and sign-in
9. Academic core
10. Admissions
11. Class Meetings (hybrid: room + Google Meet)
12. Attendance
13. Recordings and video
14. Learning, assessment, results, awards and transcripts
15. Notifications, imports, admin operations
16. API catalogue
17. Jobs (pg-boss) and domain events
18. Frontend (low-bandwidth first)
19. Security, privacy, compliance (Nigeria)
20. Observability and SLOs
21. Testing
22. DevOps on DigitalOcean App Platform
23. Delivery plan — work packages

- Appendix A — Provider setup runbook (Google, DigitalOcean, video provider, SendGrid)
- Appendix B — Verification spikes
- Appendix C — Golden vectors (attendance, final percentage, GPA)
- Appendix D — Error codes
- Appendix E — `CLAUDE.md` additions
- Appendix F — Glossary pointer

---

## 0. Rules of engagement for agents

### 0.1 Read order

1. Always read §0, §2 and `GLOSSARY.md`.
2. Read the sections your work package (§23) references.
3. Read §5 (standards) and §6 (data model) before touching code or SQL.

### 0.2 Hard invariants (never violate; if a task seems to require it, stop and ask)

| #      | Invariant |
| ------ | --------- |
| INV-1  | **The server computes entitlement.** The client never asserts roles, enrollment, lecturing rights or application ownership. Every protected route goes through `AuthorizationService` (§7). |
| INV-2  | **One institution (ADR-0001).** There is no tenant key, row-level security or platform admin. Don't reintroduce them. Institution-wide settings live in the single-row `settings` table and in `policies`. |
| INV-3  | **Provider types never leak into domain code.** Only `packages/integrations/google` imports Google SDK types (incl. the YouTube Data API), and only `packages/integrations/video-host/*` knows YouTube URL/oEmbed formats. Domain modules use the `LiveProvider` and `VideoHost` ports. |
| INV-4  | **Correctness lives in PostgreSQL**: constraints, exclusion constraints and unique indexes. In-memory checks or advisory locks alone are never enough. |
| INV-5  | **No work is lost.** Follow-up work is enqueued with pg-boss **in the same transaction** as the change that requires it. External events are written to the durable **inbox** (`provider_events`) before they are acknowledged. |
| INV-6  | **Events are hints, never truth.** Provider events trigger syncs. State converges by reading provider resources, and reconciliation repairs missed events. |
| INV-7  | **Raw provider evidence and roll-call marks are inputs; attendance records are derived.** Attendance and GPA are recomputed idempotently, and overrides survive recomputation. |
| INV-8  | **The join path is database-only.** `POST /class-meetings/:id/join` makes zero provider calls on the happy path. |
| INV-9  | **Never publish an unplayable video.** A video is shown to students only while YouTube reports it available and embeddable from GLIM's channel (checked when added and daily), and, for automatic uploads, after processing succeeded and its duration matches the source within tolerance (§13.3). |
| INV-10 | **The app never serves video bytes.** Videos are embedded from YouTube by id (privacy-enhanced mode), only for entitled viewers. **Accepted exposure (ADR-0003):** unlisted videos can be watched by anyone who has the link, and a shared link can't be revoked. Raw Drive URLs are never exposed. |
| INV-11 | **Audit in the same transaction** for: grade changes, attendance overrides and roll-call edits, result finalization/approval, transcript issue/revoke, award confirmation, admission decisions and acceptances, role changes, video delete/replace/download, and security/integration config changes. |
| INV-12 | **No secrets in the repo, logs, traces, tokens or error responses.** |
| INV-13 | **Low-bandwidth budgets are enforced in CI** (§18.3). A feature that breaks a budget is not done. |
| INV-14 | **Academic records are exact.** Grades, credits, grade points and GPA use integer/decimal arithmetic (never JS floats). Published results and issued transcripts are immutable snapshots. |
| INV-15 | **Sensitive applicant data stays in Admissions.** Spiritual-background answers are readable only with `admissions:application:read-sensitive`, are never copied to the student record, and never appear in logs, exports other than the admissions export, or notifications. |

### 0.3 Definition of Done (every work package)

- `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w deps:check` and `pnpm -w budget:check` (web) pass. TypeScript is strict, with no `any` unless justified.
- There are unit tests for domain rules, and integration tests against real Postgres 18 (Testcontainers) for repositories, transactions, constraints and pg-boss handlers.
- Every new endpoint has **authorization deny-path tests**: wrong role, not entitled, not owner, and unauthenticated (persona fixtures, §7.5).
- Endpoints appear in the generated OpenAPI and use shared Zod contracts from `packages/contracts`.
- Migrations are forward-only, tested on an empty DB and on the previous release's schema, and follow expand/contract (§22.6).
- The audit events and logs specified in the section are emitted.
- There is no TODO/FIXME without an issue reference, and no dead or commented-out code. `docs/` is updated for behaviour, config or ops changes.

### 0.4 When to stop and ask (instead of guessing)

- Your task depends on a §2.3 item marked **OPEN** or **DEFAULT — confirm**, and `docs/decisions.md` has no recorded answer.
- The behaviour is marked **SPIKE** (Appendix B). Implement it behind the port/fake and flag the assumption in the PR.
- A requirement would break an invariant.
- You're not certain of a library API. **Read the installed package's types/docs; never rely on memory.** Pin versions at scaffold and record them in `docs/stack-versions.md`.

### 0.5 Working agreements for parallel agents

- **Contract first:** change `packages/contracts` in its own small PR before implementing against it.
- **Ownership:** each work package (§23) owns paths. Edit other packages' paths only through contract PRs. Cross-module calls go through the module's public `index.ts`.
- **Migrations:** use `drizzle-kit generate` for changes the schema can express, and `drizzle-kit generate --custom --name=wpNN_description` for hand-written SQL (exclusion constraints, triggers, views, virtual columns, functions). Never run `drizzle-kit push` outside a local scratch DB. Each table is owned by exactly one module (§5.3).
- **Branches/PRs:** name branches `wp-NN-short-name`. Keep PRs to about 800 changed lines where feasible, and link the WP ID.
- **Fakes first:** all Google and video-host behaviour is developed against `FakeLiveProvider`, `FakeGoogleServer` and `FakeVideoHost` (§21.3). Real-service smoke tests are manual (Appendix B).

---

## 1. What changed from v2.1

v2.1 was a multi-school LMS sized for 25,000 users. v3.0 is for GLIM alone, sized at ~100–200 students and 10–25 staff, and adds admissions and hybrid teaching. Full owner answers are in `docs/decisions.md`.

| ID   | Change | Where |
| ---- | ------ | ----- |
| Δ3-01 | **Single institution.** Removed `institution_id`, composite tenant FKs, forced RLS, `lms_system` role, platform admin, cross-tenant tests and AC-12. Settings are a single-row table. | ADR-0001, §5.2, §6 |
| Δ3-02 | **Admissions module added.** Online application mirroring the paper form, Google sign-in to apply, review, offer, 21-day acceptance window, Matric Number allocation and referral codes. Fees remain out of scope. | §10 |
| Δ3-03 | **Hybrid teaching.** A Class Meeting runs in a **Room** and on Meet at once. In-room students are counted by **roll call**, and online students from Meet. Each attendance record stores its **attendance mode**. Rooms can't be double-booked. | §11, §12 |
| Δ3-04 | **App Platform hosting.** Replaced droplets/Compose/Caddy, the ffmpeg ladder, Cloudflare R2 and the `media-edge` Worker with App Platform components, DO Spaces for files, and SendGrid for email. Grafana/OTel stack and sops/age removed. Video is hosted on **YouTube, unlisted** (C-43, ADR-0003). | ADR-0002, ADR-0003, §4, §13, §22 |
| Δ3-05 | **Recordings kept indefinitely** on GLIM's YouTube channel as unlisted videos (C-43). The 180-day purge is removed. The System Admin can add, edit, replace and delete videos (YouTube Studio for upload and download). The app shows students the recordings of courses they took **until their programme enrollment ends**. | §13 |
| Δ3-06 | **Six roles**, institution-wide (no scopes): System Admin, Admissions Officer, Registrar, Academic Admin, and the derived Lecturer and Student, plus the derived Applicant. Removed Auditor, org units/departments, scoped role assignments and offering audiences. | §7 |
| Δ3-07 | **Programmes.** A 1-year Certificate and a 2-year Diploma, which are separate programmes. Compulsory courses are auto-registered, and students choose electives available to their Level and semester. NUC 5-point grade points with **award classes** Distinction / Credit / Pass. | §9, §14.4 |
| Δ3-08 | **Calendar.** The Academic Session starts in September with two semesters (Sept–Jan, Feb–June) and exams at the end of each. One intake a year: applications open in November and close in June. | §9.1, §10.1 |
| Δ3-09 | **Exams.** In-room students write on paper and Lecturers enter the scores; online students take a timed online exam. Both feed the same gradebook column. No proctoring. | §14.2 |
| Δ3-10 | **Viewer timezone.** Class Meetings are scheduled in Africa/Lagos; every time is shown in the viewer's own timezone, with Lagos time alongside when they differ. | §5.1, §18 |
| Δ3-11 | **Vocabulary.** Renamed tables and permissions to match `GLOSSARY.md`: `live_sessions` → `class_meetings`, `teachers` → `lecturers`, `teaching_assignments` → `lecturer_assignments`, `student_number` → `matric_number`, `degree_awards` → `awards`. | everywhere |
| Δ3-12 | **Fixed v2.1 contradictions.** Personal Gmail (not "institutional Google") for students. One permission name per action. Drive cleanup on by default. Attendance match methods aligned with the strategies. `unmatchedReviewMinutes` added to policy. Missing `dial_in` and `users.email_status` columns added. The virtual `status` column is never written. Sizing matches the real scale. | §6, §7, §12 |
| Δ3-13 | **Removed for scale/ops burden:** Tier H topology, load tests at 5,000 users, partitioning, monthly audit partitions, ClamAV (now COULD), speech transcripts (now COULD), the provider-capacity enrollment cap (warning only). | — |

---

## 2. Decisions: confirmed choices, ADRs, open items

### 2.1 Confirmed owner choices (still in force)

IDs C-01…C-17 come from v2.1; C-18 onward were added in the October 2026 vetting. Statuses in `docs/decisions.md`.

| ID   | Choice | Consequence for the build |
| ---- | ------ | ------------------------- |
| C-01 | **PostgreSQL 18+** (DO Managed) | Native `uuidv7()`, virtual generated columns and exclusion constraints. DO provides PgBouncer pools; **the pool mode can't be changed after creation**. Connection budget in §5.2. |
| C-02 | **Drizzle ORM** | Schema in TypeScript. Exclusion constraints, triggers, views, virtual columns and SQL functions go in custom SQL migrations. |
| C-03 | **pg-boss, minimal external dependencies** | No Redis and no outbox table: transactional enqueue (§5.5). |
| C-04 | **Google Workspace Business Standard** | 150 participants per meeting (never approached at GLIM's scale). Students are external Gmail accounts. Attendance comes from our own engine. S-08 confirms REST participant data on Standard. |
| C-05 | **Institution host accounts own Meet spaces** | HOST_POOL of **2** host accounts (§11.2). |
| C-07 | **Low bandwidth** | YouTube's adaptive player with a click-to-load facade and a 144p data-saver tip (no audio-only in v1, D-09), Meet dial-in shown, web budgets. |
| C-10 | **Students use personal Gmail** | `RESTRICTED` Meet spaces with student member sync. A Google account is required to apply, and therefore before the first live join. |
| C-11 | **NUC 5-point; repeat policy BEST; results visible on Lecturer finalization** | Semester GPA/CGPA shown as *Provisional* until the Registrar approves. Official transcripts require approved semesters. |
| C-12 | **Transcripts: serial + QR + hash** | No PAdES/e-signatures. |
| C-15 | **Cross-border legal review done** (for DigitalOcean hosting) | New processors (SendGrid; YouTube under Google's terms) need DPAs or terms review before launch (C-41). |
| C-16 | **Drive cleanup: yes** (decided before YouTube hosting) | **Under review (D-07):** with YouTube hosting, the recommendation is to keep Drive originals. `DRIVE_CLEANUP_MODE` defaults to `NONE` until the owner reconfirms. Integration slice only. |
| C-17 | **Google admin = the System Admin** | Appendix A is written for them. |
| C-18 | **GLIM only** | ADR-0001. |
| C-19 | **Admissions in scope; fees and payments out** | §10. No application-fee handling. |
| C-20 | **Hybrid delivery**: the same class runs in a room and on Meet at once | Roll call plus Meet attendance, Rooms (§11, §12). |
| C-21 | **Scale: ~100–200 students, 10–25 staff; 15–30 students per class; 3–5 simultaneous classes** | A single App Platform app; load targets in §21.4. |
| C-22 | **DigitalOcean App Platform for the server; Managed PostgreSQL; SendGrid for email; one System Admin operates it** | ADR-0002, §22. |
| C-23 | **Managed video, not self-hosted**; DO Spaces for files; Cloudflare R2/Worker dropped. Provider: see C-43. | §13. |
| C-24 | **Recordings persist** (no time-based purge). The System Admin can upload, edit metadata, replace, download and delete videos. Trimming is out. | §13.6. |
| C-25 | **Student recording access lasts until their programme enrollment ends** (graduated or withdrawn). Staff keep access. | §13.5. |
| C-26 | **In-room roll call + Rooms**, with no double-booking. The room laptop joins Meet as the Lecturer so recording starts. | §11.5, §12.3. |
| C-27 | **Times shown in the viewer's timezone**, with Lagos time alongside | §5.1. |
| C-28 | **Six roles**, institution-wide | §7. |
| C-29 | **Application handling:** Google sign-in to apply with saved drafts; typed-name signature + checkbox + timestamp; Statement of Faith linked; passport photo uploaded and reused as the student photo; spiritual background visible only to Admissions Officers and the System Admin and never copied to the student record; rejected applications deleted after 12 months; personal referral codes for students, alumni and staff, with a referral report | §10. |
| C-30 | **Programmes:** a 1-year Certificate and a 2-year Diploma, separate. Compulsory courses auto-registered; students choose electives available to them. | §9. |
| C-31 | **Grading:** NUC 5-point letter bands for every course. Award classes from final CGPA: **Distinction 4.50–5.00, Credit 3.00–4.49, Pass 1.00–2.99, no award below 1.00**, configured per programme. | §14.4. |
| C-32 | **Calendar:** the Academic Session starts in September; two semesters (Sept–Jan, Feb–June); exams at the end of each; Levels "Year 1"/"Year 2". | §9.1. |
| C-33 | **Admissions:** one intake per year (applications November → June), reviewed on a rolling basis. The offer must be accepted within **21 days** or it lapses; an Admissions Officer can reopen it. | §10. |
| C-34 | **Exams:** paper exams for in-room students (scores entered by the Lecturer) and timed online exams for online students | §14.2. |
| C-35 | **Study Mode** (On-campus/Online) chosen on the application. Actual attendance mode is recorded per Class Meeting. Room capacity is not enforced. | §10, §12. |
| C-36 | **A Google account is required to apply** | §8.1, §10.2. |
| C-37 | **WhatsApp/SMS out of v1**; WhatsApp numbers stored | §15.1. |
| C-38 | **Q-04:** recordings are not purged (see C-24) | — |
| C-39 | **Q-11:** students with no linked Google account must knock, and a host admits them (rare, since applying requires Google). **Q-12:** English only. **Q-15:** no students under 18. **Q-18:** official transcripts require registrar-approved semesters; unofficial transcripts show finalized results marked *Provisional*. | — |
| C-40 | **Recording notice:** notice only. Students are told classes are recorded and Meet announces recording; there's no separate consent step. | §19.5. |
| C-41 | **DPAs / terms review** for DigitalOcean, Google (Workspace and YouTube) and SendGrid are a launch gate | §19.4. |
| C-42 | ~~The video host is Cloudflare Stream~~. **Superseded by C-43** (cost). | ADR-0003 |
| C-43 | **Recordings are hosted on GLIM's YouTube channel as unlisted videos** (owner choice, 7 Oct 2026). Cost $0. Accepted: anyone with a link can watch; ads may appear; YouTube may take videos down; no audio-only in v1. v1 = staff upload in YouTube Studio and paste the link; automatic upload comes with the Google integration. | ADR-0003, §13 |

C-06 (droplets), C-08 (`US_4` preset), C-09 (180-day retention), C-13 (old sizing), C-14 (Cloudflare) and C-42 (Cloudflare Stream) are **superseded** by C-21 to C-24 and C-43.

### 2.2 Architecture decisions

The ADR files in `docs/adr/` take precedence. The rows below are the v2.1 ADR table, re-evaluated.

| ADR | Decision | Choice | Status |
| --- | -------- | ------ | ------ |
| 0001 | Tenancy | **Single institution**: no tenant key, no RLS | **New** (supersedes v2.1 ADR-19) |
| 0002 | Hosting | **App Platform + Managed PG; Spaces; SendGrid**; managed (not self-hosted) video | **New** (supersedes v2.1 ADR-04, 05, 06, 07, 13, 15, 21) |
| 0003 | Video delivery | **YouTube, unlisted, on GLIM's channel** (cost $0; link exposure accepted) | **New** (supersedes C-42 Cloudflare Stream) |
| v2-01 | Job queue | **pg-boss**: transactional send, cron, throttle/debounce, retries, DLQ | Kept |
| v2-02 | Replace Redis uses | Zero Redis: in-process rate limits, Postgres token bucket for Google quotas, in-process LRU for session lookup, client polling | Kept |
| v2-03 | ORM / migrations | **Drizzle + drizzle-kit** (custom SQL where needed) | Kept |
| v2-08 | Region | **LON** by default; decide with S-13 (RTT from Nigerian ISPs); App Platform, Managed PG and Spaces in the same region | Kept (now App Platform) |
| v2-09 | Space model | **One Meet space per Class Meeting** | Kept |
| v2-10 | Meet access mode | **`RESTRICTED` + student member sync**; host admits strays | Kept |
| v2-11 | Identity | **In-house: Google OIDC + local password (staff fallback)**; SAML out | Kept |
| v2-12 | Auth sessions | **Opaque cookie, Postgres** | Kept |
| v2-14 | PDF generation | **@react-pdf/renderer** | Kept |
| v2-16 | Frontend | **React + Vite SPA + budgets** (Preact-compat as a measured fallback) | Kept |
| v2-17 | Realtime UI | **Polling (15–30 s) on live-relevant pages only** | Kept |
| v2-18 | Google event transport | **Pub/Sub pull** (no public ingress) | Kept |
| v2-20 | API style | **REST + Zod/OpenAPI** | Kept |
| v2-22 | Temporal safety | **`EXCLUDE USING gist`** for lecturer and room double-booking | Kept, extended to Rooms |

### 2.3 Open items and defaults applied

Agents may build on these defaults, but must not lock them in irreversibly. Confirm them with the owner through `docs/decisions.md`.

| ID   | Item | Status / value used | Blocks |
| ---- | ---- | ------------------- | ------ |
| Q-02 | Spike S-01 (external Gmail participant ids) | **OPEN**, assigned to the System Admin (Appendix B.1). Until it passes, attendance runs in review mode. | WP-ATT-1 final behaviour |
| D-01 | Matric Number scope | **DEFAULT — confirm:** a new Matric Number per programme admission (`GLIM/{PROG}/{YYYY}/{NNNN}`). A Certificate graduate admitted to the Diploma receives a second one. | WP-ADM-2 |
| D-02 | Good-standing threshold | **DEFAULT — confirm:** CGPA ≥ 1.00 = GOOD; no probation band | WP-RES-1 |
| D-03 | Year 1 → Year 2 progression (Diploma) | **DEFAULT — confirm:** every ACTIVE Diploma enrollment advances to Year 2 when the next Academic Session opens; the Academic Admin handles exceptions manually. Failed compulsory courses are re-registered manually by the Academic Admin. | WP-11 |
| D-04 | Existing students already mid-programme | **DEFAULT — confirm:** a CSV import of students and their past course results (`COURSE_RESULTS`), so CGPA and transcripts are complete | WP-13 |
| D-05 | Lecturer vs System Admin video rights | **DEFAULT — confirm:** Lecturers (PRIMARY/CO_LECTURER) can add YouTube links, publish/unpublish and edit metadata for their own offerings. Delete, restore and replace are System Admin only. | WP-VIDEO-3 |
| D-06 | Draft applications never submitted | **DEFAULT — confirm:** deleted 12 months after last edit (same as rejected) | WP-ADM-3 |
| D-07 | Keep Drive originals (integration slice) | **DEFAULT — confirm (reverses C-16):** YouTube can take videos down, and YouTube Studio download isn't a guaranteed original, so keep the Meet originals in Workspace Drive (`DRIVE_CLEANUP_MODE=NONE`). Pooled Business Standard storage should cover ~0.5–1.5 TB a year; monitor it. | WP-VIDEO-2 |
| D-08 | Recording notice wording | **DEFAULT — confirm:** the notice (C-40) states that recordings are published on GLIM's YouTube channel as **unlisted** videos, which anyone with the link can view. Lecturers keep the camera on themselves and the slides where possible. | WP-MEET-UI, WP-HARD-2 |
| D-09 | Audio-only | **DEFAULT — confirm:** none in v1 (YouTube's embed has no audio-only mode; the 144p tip is the low-data option). The integration slice may add an optional ~18 MB/hour audio file in Spaces, extracted from the Drive original. | WP-VIDEO-2 |
| Q-17 | Total Class Meetings per day | Default ≤ 10 meetings/day of ≤ 90 min (sizing only) | §13.7 |

---

## 3. Scope and personas

### 3.1 In scope (v1)

- Institution settings and academic structure: programmes (Certificate, Diploma), versioned curricula, courses, Academic Sessions, semesters and Rooms.
- Admissions: intakes, the online application form, review, decisions, offers, acceptance, referral codes and the referral report.
- Students, Lecturers and staff; CSV import (including past results).
- Enrollment: programme → semester → course, with compulsory auto-registration and elective selection.
- Lecturer assignments and co-lecturing.
- Class Meetings, single and recurring, on Google Meet with an optional Room.
- Join authorization; attendance from Meet plus in-room roll call; attendance overrides and reports.
- Recordings: hosted on GLIM's YouTube channel as unlisted videos, linked into the app, embedded only for entitled viewers, with resume progress and a low-data tip.
- Video management: upload, edit, replace, download and delete.
- Learning: materials, announcements, assignments, quizzes, exams and the gradebook.
- Results: course results, semester GPA/CGPA, standing, award classes and awards, and verifiable transcripts.
- Platform: notifications (in-app + email), roles and permissions, audit, ops visibility, and data-subject tooling.

### 3.2 Out of scope (v1)

- Fees, payments and invoices; finance, HR and payroll.
- Hostel, library, and ministry practicum / chapel attendance.
- SMS, WhatsApp and push notifications.
- Custom video conferencing.
- Audio-only playback (v1; D-09) and self-hosted video delivery.
- AI features.
- Proctoring and biometrics.
- Native mobile apps and offline video download for students.
- Video trimming and editing.
- SAML.
- Multi-institution use.
- PAdES e-signatures.
- Room-capacity enforcement.
- Speech transcripts and virus scanning (both COULD).

### 3.3 Personas and primary journeys

| Persona | Journeys |
| ------- | -------- |
| Applicant | Sign in with Google → fill in the application (autosaved) → upload photo → declare and consent → submit → track status → accept offer (gets a Matric Number) |
| Student | See this week's Class Meetings in their own timezone → join online, or attend in the room → choose electives at registration → rewatch recordings (resume, 144p data-saver) → submit assignments, take quizzes and online exams → see grades, results and transcripts |
| Lecturer | See assigned offerings → schedule Class Meetings (with a Room) → start the class (room laptop joins Meet) → take roll call → review Meet attendance and resolve unmatched participants → publish materials and assignments → enter paper exam scores → grade → finalize results |
| Admissions Officer | Manage intakes → review applications (including sensitive answers) → admit or reject → reopen lapsed offers → referral and intake reports |
| Academic Admin | Set up sessions, semesters, curricula, courses, Rooms and offerings → assign Lecturers → open registration (auto-registers compulsory courses) → manage enrollments and progression → import data → attendance reports |
| Registrar | Approve and publish semester results → issue and revoke transcripts → confirm awards → manage grading schemes and award classes |
| System Admin | Users and roles; policies and settings; Google integration; video management (upload, edit, replace, download, delete); ops failures and replay; audit log. Holds every permission except those reserved to students and applicants. |

---

## 4. Architecture

### 4.1 Runtime topology (ADR-0002; no Redis, no droplets)

```
 Applicant / Student / Lecturer / Staff browsers
   │ HTTPS (same origin: SPA + /api)                   │ HTTPS (embedded player, unlisted video)
   ▼                                                    ▼
┌──────────────────────────────────────────┐   ┌──────────────────────────────┐
│ DigitalOcean App Platform app "glim"     │   │ YouTube (GLIM channel,       │
│  service  api   (NestJS+Fastify; also    │   │ unlisted videos; C-43)       │
│                  serves the SPA files)   │   │ oEmbed checks (v1) ·         │
│  worker   worker (pg-boss handlers,      │──►│ Data API upload (integration)│
│                  Pub/Sub pull, ingest)   │   └──────────────────────────────┘
│  job      migrate (PRE_DEPLOY)           │   ┌──────────────────────────────┐
└───────┬──────────────────────┬───────────┘──►│ DO Spaces (private bucket):  │
        ▼                      │               │ files, photos,               │
┌──────────────────────────┐   │               │ transcript PDFs, backups     │
│ DO Managed PostgreSQL 18 │   │               └──────────────────────────────┘
│ app schema · pgboss      │   ├──► Google: Meet REST, Drive, Workspace Events (integration slice)
└──────────────────────────┘   └──► SendGrid (email; signed event webhook → api)
```

- **One App Platform app** with three components:
  - `api`: a service. It hosts the REST API at `/api/v1` and also serves the built SPA as static files at `/`, so everything is same-origin with no CORS, and security headers are under our control.
  - `worker`: a worker component, with `WORKER_ROLE=all` at launch.
  - `migrate`: a `PRE_DEPLOY` job that runs Drizzle and pg-boss migrations.
- `WORKER_ROLE` ∈ `general | google | media | scheduler | all`. Splitting the roles into separate worker components is a scaling option, not a launch requirement. Only processes with the `scheduler` role (included in `all`) register cron and run pg-boss maintenance.
- **Stateless API**; auth sessions are stored in Postgres.
- **Video** is hosted on YouTube (unlisted). In v1, staff upload in YouTube Studio and paste the link, and the app checks it via oEmbed. In the integration slice, the worker streams Meet recordings from Drive to YouTube through the Data API. Students watch through the embedded YouTube player (§13).
- **Files** (materials, submissions, passport photos, transcript PDFs) go into a private Spaces bucket through presigned URLs.

### 4.2 Repository layout (pnpm workspace + Turborepo)

```
/
├─ apps/
│  ├─ api/          src/{main.ts, app.module.ts, http/<module>/*.controller.ts, common/{guards,filters,interceptors}, static.ts}
│  ├─ worker/       src/{main.ts, worker.module.ts, handlers/<queue>/*.handler.ts, schedules.ts, subscribers.ts}
│  └─ web/          React SPA (§18), built into apps/api's static directory at deploy
├─ packages/
│  ├─ contracts/    Zod schemas, DTO types, enums, error codes, queue + event names
│  ├─ shared/       clock, Result/Err, config loader (Zod env), pagination, errors, ids, decimal helpers, time-zone helpers
│  ├─ db/           drizzle schema (src/schema/*), migrations/ (generated + custom SQL), Db.withTx + boss adapter, idempotency/inbox repos, test helpers
│  ├─ telemetry/    pino logger, request-id, timing helpers
│  ├─ modules/      Nest modules = application layer (no controllers)
│  │   identity/ academic/ admissions/ enrollment/ lecturing/ scheduling/ class-meeting/ attendance/ video/
│  │   content/ assessment/ results/ transcripts/ authorization/ audit/ notifications/ imports/ ops/
│  └─ integrations/
│      live-provider/  LiveProvider port + FakeLiveProvider
│      google/         DWD auth, meet, drive, workspace-events, quota limiter, FakeGoogleServer (test)
│      video-host/     VideoHost port + FakeVideoHost + youtube-link/ (oEmbed, v1) + youtube-api/ (Data API, integration slice)
│      storage/        ObjectStorage port + S3 adapter (DO Spaces / MinIO)
│      mail/           Mailer port + SendGrid adapter + SMTP adapter (Mailpit in dev)
│      pdf/            react-pdf transcript renderer
├─ .do/app.yaml · docker/ (local compose + Dockerfiles) · .github/workflows/ · docs/{decisions.md,stack-versions.md,runbooks/,adr/,spikes/} · CLAUDE.md · GLOSSARY.md
```

### 4.3 Dependency rules (enforced by `dependency-cruiser`, `pnpm -w deps:check`)

1. `contracts` and `shared` import nothing internal except each other.
2. `modules/*` may import:
   - `contracts`, `shared`, `db` and `telemetry`
   - other modules' **public `index.ts`**
   - the **ports** in `integrations/{live-provider,video-host,storage,mail,pdf}`
3. `modules/*` **must not** import `integrations/google` or `integrations/video-host/youtube-*` (INV-3). Only the `apps/*` composition roots bind adapters to port tokens.
4. `apps/api` has controllers, guards and filters only, with no business rules. `apps/worker` handlers call the **same application services**.
5. A module writes only to the tables it owns (§6 lists owners).

### 4.4 Technology stack (pin at scaffold; record in `docs/stack-versions.md`)

| Layer | Choice |
| ----- | ------ |
| Runtime | Node.js current LTS, strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| API | NestJS + Fastify; Zod validation → OpenAPI; `@fastify/static` for the SPA (precompressed Brotli/gzip) |
| DB | **PostgreSQL 18** (DO Managed); **Drizzle ORM** (`drizzle-orm/node-postgres`) + `drizzle-kit`; `pg`; extensions `citext`, `btree_gist` |
| Queue | **pg-boss** (schema `pgboss`); dashboard `@pg-boss/dashboard` behind System Admin auth |
| Google | `google-auth-library` (JWT/DWD), `@googleapis/meet`, `@googleapis/drive`, `@googleapis/workspaceevents`, `@google-cloud/pubsub`. If a client lacks a method, call REST through the shared authenticated `GoogleHttpClient`. |
| Video | YouTube: public **oEmbed** endpoint for link checks (v1); **YouTube Data API v3** resumable upload (integration slice); **YouTube IFrame Player API** in the browser (lazy, click-to-load) |
| Storage | `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` → DO Spaces; MinIO in dev/CI |
| PDF | `@react-pdf/renderer` + `qrcode` |
| Passwords | `argon2` (argon2id) |
| Mail | SendGrid API (`@sendgrid/mail`) behind `Mailer`; Mailpit via SMTP in dev |
| Logging | `pino` (JSON to stdout → App Platform runtime logs) |
| Time | `luxon`, `rrule` |
| Testing | Vitest, Supertest, Testcontainers (Postgres 18, MinIO), Playwright |
| Frontend | React, Vite, TanStack Router + Query, Tailwind, shadcn/ui (Radix), react-hook-form, Zod, `hls.js` (lazy), `vite-plugin-pwa` |

---

## 5. Cross-cutting engineering standards

### 5.1 Identifiers, time, numbers

- **IDs:** UUIDv7. Columns default to PostgreSQL 18's native `uuidv7()`. When an id is needed before insert (e.g. in a job payload), generate it with `shared/ids.ts: newId()`. Never expose sequential ids. Human-facing numbers (Application Reference No, Matric Number, transcript serial, award certificate number) come from dedicated sequence tables (§6).
- **Time:** store `timestamptz` in UTC; the API uses RFC 3339 `Z`. Class Meetings are scheduled in the institution timezone (`settings.timezone`, default `Africa/Lagos`), and recurrence expands in that zone.
- **Display:** the client renders every instant in the **viewer's timezone** (`users.timezone`, set from the browser on first sign-in and editable on the profile). When it differs from the institution timezone, Lagos time is shown alongside, e.g. "14:00 London (15:00 Lagos)". Emails show both, using the recipient's timezone. Domain code reads time only through an injected `Clock`.
- **Dates** without a time (`date`) are used for academic calendar boundaries and compared in the institution timezone.
- **Exact numbers (INV-14):**
  - scores/percentages: `numeric(7,2)`
  - credits: `numeric(4,1)` in the schema, carried as integer tenths (`credits_x10`) in results
  - **grade points: integer hundredths** (`points_x100`)
  - GPA: integer arithmetic, rounded half-up to 2 dp
  - ratios: **basis points**

  Use `shared/decimal.ts` and never JS floats for stored academic values.

### 5.2 Database access and connections

1. `Db.withTx(ctx, fn)` acquires a `pg` client, runs `BEGIN`, builds `drizzle(client, { schema })` and a **pg-boss adapter bound to the same client**, passes `{ db, boss }` to `fn`, then commits or rolls back. Every write path uses it so that the business change, the audit row and the enqueued jobs commit atomically (INV-5, INV-11).
2. **Connections (DO Managed PG):**
   - `DATABASE_URL` is the **transaction-mode pool** `glim-tx`, used by the API and job handlers.
   - `DATABASE_URL_DIRECT` (no pooler) is used by pg-boss polling/maintenance and the migrate job.

   The budget is 25 connections per GiB RAM, so a 2 GiB cluster has 50. Default allocation: API 2 × 8 (pool) + worker 1 × 6 (pool) + pg-boss 1 × 4 (direct) + migrate 1 = 27. A startup check fails if pools exceed `DB_CONNECTION_BUDGET`.
3. **Roles:**
   - `glim_migrator`: owner. Runs DDL and the drizzle + pg-boss migrations, used only by the `migrate` job.
   - `glim_app`: DML only, used by `api` and `worker`.
4. Transaction-scoped advisory locks (`pg_advisory_xact_lock`) are allowed because they work through the transaction pooler. Session-scoped locks and `LISTEN` are not allowed on the pooled URL.

### 5.3 Module and table ownership

Each table in §6 names an owner, and only the owner's repositories write to it. Cross-module side effects go through **domain events** (§17.3) enqueued in the same transaction, never through direct writes. One exception: the admissions acceptance transaction (§10.4) calls the `enrollment` and `academic` modules' **public application services inside the same transaction**. It passes its `{db, boss}` along, so ownership is kept while the acceptance stays atomic.

### 5.4 API conventions

- Base `/api/v1`. JSON only, `camelCase`, RFC 3339 timestamps, gzip/br. Responses never include fields the caller can't use (bandwidth).
- **Pagination** is cursor-based: `?limit` (default 25, max 100) and `?cursor`; the response is `{ items, nextCursor }`, with an opaque base64url cursor of `(sortKey, id)`.
- **Error envelope:** `{ "error": { "code", "message", "fieldErrors":[{path,code,message}], "requestId" } }`. Codes are in Appendix D. Never include stack traces, SQL or provider payloads.
- **Status codes:**

  | Code | Meaning |
  |---|---|
  | 400 | validation |
  | 401 | unauthenticated |
  | 403 | forbidden (the caller may know the resource exists) |
  | 404 | not found, or not visible to the caller |
  | 409 | conflict or wrong state |
  | 412 | version mismatch |
  | 422 | domain rule |
  | 429 | rate limited (`Retry-After`) |
  | 503 | dependency unavailable |
- **Optimistic concurrency:** mutable aggregates carry `version`, and `PATCH`/`PUT` require `If-Match: "<version>"`.
- **Idempotency:** an `Idempotency-Key` (16–64 chars) is **required** on:
  - creating a Class Meeting or series
  - bulk enroll
  - publishing/unpublishing a video
  - finalizing, approving or publishing results
  - issuing a transcript
  - starting an import
  - submitting a quiz
  - submitting an application
  - deciding an application
  - accepting an offer

  Implementation: in the same transaction, insert `idempotency_keys(…status='IN_PROGRESS')` (unique `(user_id, operation, key)`).
  - Same key + same `request_hash` + `COMPLETED` ⇒ replay the stored response.
  - `IN_PROGRESS` ⇒ 409 `IDEMPOTENCY_IN_PROGRESS`.
  - A different hash ⇒ 422 `IDEMPOTENCY_KEY_REUSED`.

  Keys expire after 48 h.
- **Rate limiting:** an in-memory token bucket per API instance (`@fastify/rate-limit`):

  | Class | Limit |
  |---|---|
  | auth | 10/min/IP |
  | apply (public start) | 10/min/IP |
  | join | 20/min/user |
  | playback authorize | 60/min/user |
  | progress | 1 write / 5 s / user / video |
  | public transcript verify | 30/min/IP |
  | default | 600/min/user |

  Account brute-force lockout is DB-backed (`users.failed_login_count/locked_until`).

### 5.5 Inbox (external events) and transactional enqueue

- **Transactional enqueue:** application services call `boss.send(queue, payload, { db: trxAdapter, singletonKey, startAfter, priority, … })` inside `withTx`. The job row commits atomically with the business change (INV-5).
- **Inbox:** `provider_events` (unique `(provider, event_id)`) receives Google Workspace Events (Pub/Sub pull, integration slice) and SendGrid event webhooks. The receiver inserts the row and then acks or returns 2xx. A `provider-event.process` job handles each one.
- **Domain events:** published as pg-boss jobs on queue `domain-event` (same transaction). A dispatcher fans out to idempotent in-process subscribers.

### 5.6 Jobs (pg-boss) — conventions

- Handlers are **idempotent** (upserts, unique keys, state guards), because delivery is at-least-once.
- Per-queue options are fixed in §17.1 and created at boot by `ensureQueues()`: retry limit, `retryBackoff:true`, `expireInSeconds` ≥ 2 × P99 runtime, a dead-letter queue, and retention. Long ingests must set a long expiry.
- **Dedupe/debounce:**
  - `singletonKey` (plus a queue policy) for "at most one pending per entity"
  - `sendDebounced`/`sendThrottled` with a key for `conference.sync` and `class-meeting.sync-access`
- **Concurrency:** use the installed pg-boss version's worker options (**read the types**) plus `QUEUE_CONCURRENCY_<NAME>`. `recording.ingest` (integration slice) concurrency is 1 per worker instance, since it streams up to ~1.5 GB to YouTube.
- **Schema management:** pg-boss migrations run in the `migrate` job. Runtime processes start with migration disabled. The API uses a send-only instance with the transaction adapter. Archive after 7 days; delete after 30.
- **Deploys restart workers** (App Platform). Handlers must tolerate SIGTERM: stop polling, finish or abandon within the grace period (S-17), and rely on pg-boss expiry for redelivery.
- **Observability:** every handler logs `jobId`, `queue`, duration and attempt. The pg-boss dashboard is mounted at `/admin/jobs` for `SYSTEM_ADMIN` only.

### 5.7 Redis-free replacements

| Need | Replacement |
| ---- | ----------- |
| Queue | pg-boss, transactional enqueue |
| API rate limit | In-memory per instance (effective limit = limit × instances; documented) |
| Google quota limiter | Postgres function `rl_acquire(key, capacity, refill_per_sec, cost)` on UNLOGGED `rate_limit_buckets` (§6.7); callers delay the job instead of failing |
| Locks | pg-boss singleton/cron leader + `pg_advisory_xact_lock` |
| Session lookup cache | In-process LRU, 5 s TTL (revocation ≤ 5 s) |
| Entitlement cache | None (indexed query < 5 ms) |
| Realtime | Client polling with ETag (v2-17) |

### 5.8 Code quality gates

- Strict TS; ESLint (typescript-eslint strict, `no-floating-promises`, `no-misused-promises`); Prettier; Conventional Commits.
- No default exports in modules.
- `Result<T,E>` for expected domain failures; exceptions only for bugs and infrastructure.
- All external input is parsed with Zod at the edge.
- `process.env` is read only in `shared/config`.

---

## 6. Data model (DDL)

### 6.1 Notation (expand when writing migrations)

- `@std` = `id uuid PRIMARY KEY DEFAULT uuidv7(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1`.
- `@std_ro` = the same **without** `updated_at`/`version`, for append-only or immutable rows.
- `@fk(col → table)` = `FOREIGN KEY (col) REFERENCES table (id) ON DELETE RESTRICT`, unless stated otherwise.
- Enumerations are `text` + `CHECK`. The allowed values mirror `contracts/enums.ts`, and a test asserts they match.
- A trailing `-- owner: <module>` names the only module allowed to write the table.
- In Drizzle, express tables, columns, indexes and FKs in `packages/db/src/schema/*`. Anything marked *(custom SQL)* goes in a hand-written migration.
- Soft delete is used **only** where noted. Otherwise rows are retained by status.
- There is **no tenant column and no RLS** (ADR-0001).

Migration groups: **M01** identity/settings · **M02** academic · **M03** Class Meetings/attendance · **M04** recordings/video · **M05** content/assessment · **M06** platform · **M07** results/transcripts · **M08** admissions. pg-boss creates its own `pgboss` schema.

### 6.2 M01 — Settings and identity

```sql
CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE settings (                -- owner: identity. Exactly one row (ADR-0001).
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name text NOT NULL DEFAULT 'GLIM Online Bible College',
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  staff_email_domains text[] NOT NULL DEFAULT '{}',   -- Google `hd` allowlist for STAFF sign-in only
  youtube_channel_urls text[] NOT NULL DEFAULT '{}',  -- GLIM channel(s) whose videos may be linked (§13.3)
  statement_of_faith_url text,                         -- linked from the application declaration
  updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1);

CREATE TABLE users (                   -- owner: identity
  @std, email citext NOT NULL UNIQUE, display_name text NOT NULL,
  status text NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','DEACTIVATED')),
  password_hash text, password_changed_at timestamptz, failed_login_count int NOT NULL DEFAULT 0, locked_until timestamptz,
  timezone text,                                       -- IANA zone for display; NULL ⇒ settings.timezone
  email_status text NOT NULL DEFAULT 'OK' CHECK (email_status IN ('OK','BOUNCED','COMPLAINED')),
  referral_code text UNIQUE,                           -- personal code for students, alumni and staff (§10.6)
  locale text NOT NULL DEFAULT 'en', last_login_at timestamptz);

CREATE TABLE identities (              -- owner: identity. Google `sub` is the key to attendance matching (§12.4)
  @std_ro, user_id uuid NOT NULL, provider text NOT NULL CHECK (provider IN ('google','local')),
  subject text NOT NULL, email citext, metadata jsonb NOT NULL DEFAULT '{}',   -- metadata.googleName captured at link time
  verified_at timestamptz, UNIQUE (provider, subject), @fk(user_id → users));

CREATE TABLE auth_sessions (           -- owner: identity (v2-12)
  @std_ro, user_id uuid NOT NULL, token_hash bytea NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip inet, user_agent text, revoked_at timestamptz, csrf_secret bytea NOT NULL, @fk(user_id → users));
CREATE INDEX ON auth_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE role_assignments (        -- owner: authorization. STAFF roles only, institution-wide (no scopes).
  @std_ro, user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('SYSTEM_ADMIN','ADMISSIONS_OFFICER','REGISTRAR','ACADEMIC_ADMIN')),
  granted_by uuid, revoked_at timestamptz, reason text, @fk(user_id → users));
CREATE UNIQUE INDEX role_assignments_active ON role_assignments (user_id, role) WHERE revoked_at IS NULL;
-- LECTURER, STUDENT and APPLICANT are derived (§7.1), never rows here.

CREATE TABLE policies (                -- owner: identity. Versioned, append-only.
  @std_ro, policy_type text NOT NULL CHECK (policy_type IN
    ('ATTENDANCE','RECORDING','JOIN_WINDOW','GOOGLE_MEET','RETENTION','GRADING_DEFAULTS','NOTIFICATION','ADMISSIONS')),
  scope_type text NOT NULL DEFAULT 'INSTITUTION' CHECK (scope_type IN ('INSTITUTION','COURSE_OFFERING')), scope_id uuid,
  policy_version int NOT NULL, config jsonb NOT NULL, effective_from timestamptz NOT NULL DEFAULT now(), created_by uuid,
  CHECK ((scope_type = 'INSTITUTION') = (scope_id IS NULL)));
CREATE UNIQUE INDEX policies_version ON policies (policy_type, scope_type, COALESCE(scope_id,'00000000-0000-0000-0000-000000000000'), policy_version);

CREATE TABLE integration_configs (     -- owner: ops. Non-secret config; secrets live in App Platform encrypted env vars.
  @std, provider text NOT NULL UNIQUE CHECK (provider IN ('google_workspace','video_host','sendgrid')),
  status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN ('UNVERIFIED','VERIFIED','DEGRADED','DISABLED')),
  config jsonb NOT NULL,         -- google: {primaryDomain, gcpProjectId, pubsubSubscription, accessMode:'RESTRICTED'}; video_host: {provider:'cloudflare_stream', accountId, customerSubdomain}
  verified_at timestamptz, last_error text);

CREATE TABLE provider_host_accounts (  -- owner: class-meeting
  @std, provider text NOT NULL DEFAULT 'google_meet', email citext NOT NULL, provider_user_id text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','THROTTLED')),
  weight int NOT NULL DEFAULT 1, UNIQUE (provider, email));

CREATE TABLE provider_subscriptions (  -- owner: class-meeting. Workspace Events subscriptions (one per host account)
  @std, host_account_id uuid NOT NULL, target_resource text NOT NULL UNIQUE, event_types text[] NOT NULL,
  remote_name text, expires_at timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRING','EXPIRED','SUSPENDED','ERROR')),
  last_renewed_at timestamptz, last_error text, @fk(host_account_id → provider_host_accounts));
```

### 6.3 M02 — Academic core

```sql
CREATE TABLE programmes (              -- owner: academic. GLIM: CERT (1 year) and DIP (2 years).
  @std, code citext NOT NULL UNIQUE, name text NOT NULL,
  award_type text NOT NULL CHECK (award_type IN ('CERTIFICATE','DIPLOMA')),
  duration_semesters smallint NOT NULL CHECK (duration_semesters > 0),    -- CERT 2, DIP 4
  levels smallint NOT NULL CHECK (levels BETWEEN 1 AND 4),                -- CERT 1 (Year 1), DIP 2 (Year 1–2)
  grading_scheme_id uuid,                                                 -- FK added in M07
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')));

CREATE TABLE academic_sessions (       -- owner: academic. One academic year, e.g. code '2027/2028'.
  @std, code citext NOT NULL UNIQUE, name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','CLOSED')), CHECK (ends_on > starts_on));

CREATE TABLE semesters (               -- owner: academic. GLIM: sequence 1 = Sept–Jan, 2 = Feb–June.
  @std, academic_session_id uuid NOT NULL, code citext NOT NULL, name text NOT NULL, sequence smallint NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL, registration_opens_on date, registration_closes_on date, add_drop_deadline_on date,
  exams_start_on date, exams_end_on date,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','REGISTRATION','ACTIVE','CLOSED')),
  UNIQUE (academic_session_id, sequence), UNIQUE (academic_session_id, code), CHECK (ends_on > starts_on),
  @fk(academic_session_id → academic_sessions));

CREATE TABLE intakes (                 -- owner: admissions. One per year: applications open Nov, close June; students start in academic_session.
  @std, code citext NOT NULL UNIQUE,                  -- e.g. '2027' (applications Nov 2026 – Jun 2027, starting the 2027/2028 session)
  academic_session_id uuid NOT NULL UNIQUE, opens_on date NOT NULL, closes_on date NOT NULL,
  offer_acceptance_days int NOT NULL DEFAULT 21 CHECK (offer_acceptance_days > 0),
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','OPEN','CLOSED')),
  CHECK (closes_on > opens_on), @fk(academic_session_id → academic_sessions));

CREATE TABLE cohorts (                 -- owner: academic. Students of one programme starting in one intake (created on first acceptance).
  @std, programme_id uuid NOT NULL, intake_id uuid NOT NULL, code citext NOT NULL, name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  UNIQUE (programme_id, intake_id), UNIQUE (programme_id, code), @fk(programme_id → programmes), @fk(intake_id → intakes));

CREATE TABLE curricula (               -- owner: academic. Versioned; enrollments keep the version they started on.
  @std, programme_id uuid NOT NULL, curriculum_version int NOT NULL, effective_from date NOT NULL,
  min_elective_credits numeric(4,1) NOT NULL DEFAULT 0,  -- award requirement (§14.6)
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  UNIQUE (programme_id, curriculum_version), @fk(programme_id → programmes));
CREATE UNIQUE INDEX one_active_curriculum ON curricula (programme_id) WHERE status = 'ACTIVE';

CREATE TABLE courses (                 -- owner: academic. Reusable subject definition.
  @std, code citext NOT NULL UNIQUE, title text NOT NULL, description text, credits numeric(4,1) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')));

CREATE TABLE curriculum_courses (      -- owner: academic. Compulsory/elective placement per Level and semester.
  @std, curriculum_id uuid NOT NULL, course_id uuid NOT NULL, level_no smallint NOT NULL, semester_no smallint NOT NULL CHECK (semester_no IN (1,2)),
  course_type text NOT NULL CHECK (course_type IN ('COMPULSORY','ELECTIVE')), credit_override numeric(4,1),
  UNIQUE (curriculum_id, course_id), @fk(curriculum_id → curricula), @fk(course_id → courses));

CREATE TABLE rooms (                   -- owner: academic
  @std, code citext NOT NULL UNIQUE, name text NOT NULL, capacity int CHECK (capacity IS NULL OR capacity > 0),  -- informational (C-35)
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')));

CREATE TABLE students (                -- owner: enrollment. One row per person; profile copied from the application on acceptance (§10.4).
  @std, user_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','GRADUATED','WITHDRAWN')),
  title text, given_name text NOT NULL, middle_name text, family_name text NOT NULL,
  gender text CHECK (gender IN ('MALE','FEMALE')), date_of_birth date, nationality text,
  phone_whatsapp text, alt_phone_whatsapp text,
  country text, state_province text, city text, postcode text, address text,
  church_name text, church_address text, pastor_name text, pastor_phone text,
  photo_file_id uuid,                                  -- FK to files added in M05
  @fk(user_id → users));

CREATE TABLE lecturers (               -- owner: lecturing
  @std, user_id uuid NOT NULL UNIQUE, staff_code text UNIQUE, kind text NOT NULL DEFAULT 'INTERNAL' CHECK (kind IN ('INTERNAL','GUEST')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')), title text, given_name text NOT NULL, family_name text NOT NULL, bio text,
  @fk(user_id → users));

CREATE TABLE matric_sequences (        -- owner: enrollment. Gap-free per programme+year; row-locked on allocation.
  programme_id uuid NOT NULL, year int NOT NULL, next_value int NOT NULL DEFAULT 1, PRIMARY KEY (programme_id, year),
  @fk(programme_id → programmes));

CREATE TABLE programme_enrollments (   -- owner: enrollment. One per admission to a programme.
  @std, student_id uuid NOT NULL, programme_id uuid NOT NULL, curriculum_id uuid NOT NULL, intake_id uuid, cohort_id uuid,
  entry_session_id uuid NOT NULL, application_id uuid UNIQUE,          -- NULL only for imported legacy students (D-04)
  matric_number text NOT NULL UNIQUE,                                  -- 'GLIM/DIP/2027/0001' (D-01)
  study_mode text NOT NULL CHECK (study_mode IN ('ON_CAMPUS','ONLINE')),
  current_level smallint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DEFERRED','WITHDRAWN','COMPLETED')),
  started_on date NOT NULL, ended_on date,
  @fk(student_id → students), @fk(programme_id → programmes), @fk(curriculum_id → curricula), @fk(intake_id → intakes),
  @fk(cohort_id → cohorts), @fk(entry_session_id → academic_sessions));   -- application_id FK added in M08
CREATE UNIQUE INDEX one_active_programme_enrollment ON programme_enrollments (student_id, programme_id) WHERE status = 'ACTIVE';

CREATE TABLE semester_enrollments (    -- owner: enrollment. Created when a semester opens registration (§9.3).
  @std, programme_enrollment_id uuid NOT NULL, semester_id uuid NOT NULL, level_no smallint NOT NULL,
  status text NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED','WITHDRAWN','COMPLETED')),
  UNIQUE (programme_enrollment_id, semester_id), @fk(programme_enrollment_id → programme_enrollments), @fk(semester_id → semesters));

CREATE TABLE course_offerings (        -- owner: academic. A course taught in a semester.
  @std, course_id uuid NOT NULL, semester_id uuid NOT NULL, section_code text NOT NULL DEFAULT '01', title_override text,
  capacity int CHECK (capacity IS NULL OR capacity > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ACTIVE','COMPLETED','CANCELLED')),
  completed_at timestamptz, policy_overrides jsonb NOT NULL DEFAULT '{}',
  UNIQUE (course_id, semester_id, section_code), @fk(course_id → courses), @fk(semester_id → semesters));

CREATE TABLE course_enrollments (      -- owner: enrollment. THE entitlement source for students.
  @std, semester_enrollment_id uuid NOT NULL, programme_enrollment_id uuid NOT NULL, course_offering_id uuid NOT NULL,
  student_id uuid NOT NULL,                                        -- denormalised; trigger enforces consistency (custom SQL)
  selection text NOT NULL CHECK (selection IN ('COMPULSORY','ELECTIVE','MANUAL')),   -- how it was registered (§9.3)
  enrollment_type text NOT NULL DEFAULT 'CREDIT' CHECK (enrollment_type IN ('CREDIT','AUDIT')),
  status text NOT NULL DEFAULT 'ENROLLED' CHECK (status IN ('ENROLLED','DROPPED','WITHDRAWN','COMPLETED')),
  enrolled_at timestamptz NOT NULL DEFAULT now(), dropped_at timestamptz,
  @fk(semester_enrollment_id → semester_enrollments), @fk(programme_enrollment_id → programme_enrollments),
  @fk(course_offering_id → course_offerings), @fk(student_id → students));
CREATE UNIQUE INDEX one_live_course_enrollment ON course_enrollments (student_id, course_offering_id) WHERE status IN ('ENROLLED','COMPLETED');
CREATE INDEX ON course_enrollments (course_offering_id, status);
CREATE INDEX ON course_enrollments (student_id, status);
-- Trigger: student_id and programme_enrollment_id MUST match the semester_enrollment's programme enrollment.

CREATE TABLE course_enrollment_events ( -- owner: enrollment. Status history.
  @std_ro, course_enrollment_id uuid NOT NULL, from_status text, to_status text NOT NULL, actor_user_id uuid, reason text,
  @fk(course_enrollment_id → course_enrollments));

CREATE TABLE lecturer_assignments (    -- owner: lecturing
  @std, course_offering_id uuid NOT NULL, lecturer_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('PRIMARY','CO_LECTURER','ASSISTANT','GUEST_LECTURER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')), capability_overrides jsonb NOT NULL DEFAULT '{}',
  starts_on date, ends_on date, @fk(course_offering_id → course_offerings), @fk(lecturer_id → lecturers));
CREATE UNIQUE INDEX one_active_assignment ON lecturer_assignments (course_offering_id, lecturer_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX one_active_primary ON lecturer_assignments (course_offering_id) WHERE status = 'ACTIVE' AND role = 'PRIMARY';
```

Entitlement read model (owner: authorization; read-only). **This is the single source for "who may access this offering"**:

```sql
CREATE VIEW v_offering_access AS
SELECT s.user_id, ce.course_offering_id, 'STUDENT' AS access_kind, ce.status AS source_status
  FROM course_enrollments ce
  JOIN students s              ON s.id  = ce.student_id
  JOIN programme_enrollments pe ON pe.id = ce.programme_enrollment_id
 WHERE ce.status IN ('ENROLLED','COMPLETED') AND s.status = 'ACTIVE' AND pe.status = 'ACTIVE'
UNION ALL
SELECT l.user_id, la.course_offering_id, 'STAFF', la.role
  FROM lecturer_assignments la JOIN lecturers l ON l.id = la.lecturer_id
 WHERE la.status = 'ACTIVE' AND l.status = 'ACTIVE';
-- How each STUDENT row is used:
-- * ENROLLED  → full participation: join, submit, quiz, materials, recordings.
-- * COMPLETED → read-only: materials and recordings remain visible
--               until the programme enrollment ends (C-25).
--               Graduation (pe COMPLETED, student GRADUATED) or withdrawal ends access.
```

### 6.4 M03 — Class Meetings and attendance

```sql
CREATE TABLE class_meeting_series (    -- owner: scheduling
  @std, course_offering_id uuid NOT NULL, title_template text NOT NULL, rrule text NOT NULL, timezone text NOT NULL,
  starts_on date NOT NULL, until_on date, start_time time NOT NULL, duration_minutes int NOT NULL CHECK (duration_minutes BETWEEN 5 AND 600),
  room_id uuid, generated_through date, status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')), created_by uuid,
  @fk(course_offering_id → course_offerings), @fk(room_id → rooms));

CREATE TABLE class_meetings (          -- owner: class-meeting. Hybrid: Meet always; Room optional.
  @std, course_offering_id uuid NOT NULL, series_id uuid, title text NOT NULL, description text,
  scheduled_start timestamptz NOT NULL, scheduled_end timestamptz NOT NULL, timezone text NOT NULL,
  room_id uuid,                                        -- NULL ⇒ online only
  state text NOT NULL DEFAULT 'SCHEDULED' CHECK (state IN ('SCHEDULED','OPEN','LIVE','ENDED','CANCELLED','NO_SHOW')),
  provider text NOT NULL DEFAULT 'google_meet',
  provider_status text NOT NULL DEFAULT 'PENDING' CHECK (provider_status IN ('PENDING','PROVISIONING','READY','ERROR')),
  provider_space_id text, provider_meeting_code text, join_url text, dial_in jsonb, host_account_id uuid,
  provisioned_at timestamptz, provision_error text,
  recording_mode text NOT NULL DEFAULT 'AUTO' CHECK (recording_mode IN ('AUTO','MANUAL','OFF')),
  attendance_state text NOT NULL DEFAULT 'PENDING' CHECK (attendance_state IN ('PENDING','PROVISIONAL','FINAL','REVIEW_REQUIRED')),
  policy_snapshot jsonb NOT NULL,
  first_conference_started_at timestamptz, last_conference_ended_at timestamptz, finalized_at timestamptz,
  cancelled_at timestamptz, cancel_reason text, created_by uuid NOT NULL,
  occurrence_date date, series_exception boolean NOT NULL DEFAULT false, access_synced_at timestamptz,
  CHECK (scheduled_end > scheduled_start),
  CONSTRAINT no_room_double_booking EXCLUDE USING gist (room_id WITH =, tstzrange(scheduled_start, scheduled_end) WITH &&)
    WHERE (room_id IS NOT NULL AND state <> 'CANCELLED'),                                  -- custom SQL (btree_gist)
  @fk(course_offering_id → course_offerings), @fk(series_id → class_meeting_series), @fk(room_id → rooms),
  @fk(host_account_id → provider_host_accounts));
CREATE UNIQUE INDEX class_meetings_series_occurrence ON class_meetings (series_id, occurrence_date) WHERE series_id IS NOT NULL;
CREATE UNIQUE INDEX class_meetings_provider_space ON class_meetings (provider, provider_space_id) WHERE provider_space_id IS NOT NULL;
CREATE INDEX ON class_meetings (course_offering_id, scheduled_start);
CREATE INDEX ON class_meetings (state, scheduled_start) WHERE state IN ('SCHEDULED','OPEN','LIVE');

CREATE TABLE meeting_lecturer_slots (  -- owner: scheduling. DB-level lecturer double-booking guard (INV-4).
  @std_ro, class_meeting_id uuid NOT NULL, lecturer_id uuid NOT NULL, during tstzrange NOT NULL,
  override boolean NOT NULL DEFAULT false, override_reason text,
  @fk(class_meeting_id → class_meetings), @fk(lecturer_id → lecturers),
  CONSTRAINT no_lecturer_overlap EXCLUDE USING gist (lecturer_id WITH =, during WITH &&) WHERE (NOT override));   -- custom SQL

CREATE TABLE meeting_join_log (        -- owner: class-meeting
  @std_ro, class_meeting_id uuid NOT NULL, user_id uuid NOT NULL, outcome text NOT NULL CHECK (outcome IN ('AUTHORIZED','DENIED')),
  deny_reason text, device text, authorized_at timestamptz NOT NULL DEFAULT now(), @fk(class_meeting_id → class_meetings));
CREATE INDEX ON meeting_join_log (class_meeting_id, authorized_at);

CREATE TABLE conference_records (      -- owner: class-meeting. A space can host several conferences over time.
  @std, class_meeting_id uuid NOT NULL, provider_conference_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')), started_at timestamptz NOT NULL, ended_at timestamptz,
  dirty boolean NOT NULL DEFAULT true, last_synced_at timestamptz, @fk(class_meeting_id → class_meetings));
CREATE INDEX ON conference_records (class_meeting_id);
CREATE INDEX ON conference_records (dirty, last_synced_at) WHERE dirty;

CREATE TABLE provider_events (         -- owner: ops. DURABLE INBOX (§5.5). Raw payload immutable.
  @std_ro, provider text NOT NULL CHECK (provider IN ('google_meet','video_host','sendgrid')), event_id text NOT NULL,
  event_type text NOT NULL, subject text, payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PROCESSED','IGNORED','FAILED')),
  attempts int NOT NULL DEFAULT 0, last_error text, processed_at timestamptz, UNIQUE (provider, event_id));
CREATE INDEX ON provider_events (status, received_at) WHERE status IN ('RECEIVED','FAILED');

CREATE TABLE provider_participant_sessions (  -- owner: attendance. RAW EVIDENCE (INV-7): upserted until finalized, never deleted.
  @std, class_meeting_id uuid NOT NULL, conference_record_id uuid NOT NULL,
  provider_participant_id text NOT NULL, provider_session_id text NOT NULL UNIQUE,
  participant_kind text NOT NULL CHECK (participant_kind IN ('SIGNED_IN','ANONYMOUS','PHONE')),
  provider_user_id text, display_name text, started_at timestamptz NOT NULL, ended_at timestamptz,
  matched_user_id uuid,
  match_method text NOT NULL DEFAULT 'NONE' CHECK (match_method IN ('NONE','GOOGLE_ID','MEMBER_EMAIL','NAME_ASSISTED','MANUAL')),
  match_status text NOT NULL DEFAULT 'UNMATCHED' CHECK (match_status IN ('UNMATCHED','SUGGESTED','CONFIRMED')),
  raw jsonb NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  @fk(class_meeting_id → class_meetings), @fk(conference_record_id → conference_records), @fk(matched_user_id → users));
CREATE INDEX ON provider_participant_sessions (class_meeting_id, matched_user_id);

CREATE TABLE roll_call_marks (         -- owner: attendance. In-room evidence (C-26). Editable until lock; every change audited.
  @std, class_meeting_id uuid NOT NULL, student_id uuid NOT NULL, present boolean NOT NULL, late boolean NOT NULL DEFAULT false,
  marked_by uuid NOT NULL, marked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_meeting_id, student_id), @fk(class_meeting_id → class_meetings), @fk(student_id → students));

CREATE TABLE attendance_records (      -- owner: attendance. DERIVED projection + audited override.
  @std, class_meeting_id uuid NOT NULL, student_id uuid NOT NULL,
  computed_status text NOT NULL CHECK (computed_status IN ('PRESENT','PARTIAL','ABSENT')),
  attendance_mode text NOT NULL CHECK (attendance_mode IN ('IN_PERSON','ONLINE','NONE')),
  override_status text CHECK (override_status IN ('PRESENT','PARTIAL','ABSENT','EXCUSED')),
  status text GENERATED ALWAYS AS (COALESCE(override_status, computed_status)) VIRTUAL,   -- PG18 virtual column (custom SQL); NEVER written
  attended_seconds int NOT NULL, effective_seconds int NOT NULL, ratio_bp int NOT NULL CHECK (ratio_bp BETWEEN 0 AND 10000),
  first_join_at timestamptz, last_leave_at timestamptz, late boolean NOT NULL DEFAULT false, join_count int NOT NULL DEFAULT 0,
  calc_version int NOT NULL DEFAULT 1, policy_version int NOT NULL, computed_at timestamptz NOT NULL,
  override_by uuid, override_reason text, overridden_at timestamptz,
  CHECK ((override_status IS NULL) = (override_reason IS NULL)),
  UNIQUE (class_meeting_id, student_id), @fk(class_meeting_id → class_meetings), @fk(student_id → students));
CREATE INDEX ON attendance_records (student_id);
```

### 6.5 M04 — Recordings and video (ADR-0002)

```sql
CREATE TABLE recordings (              -- owner: video. One row per Meet recording file (a conference may have several).
  @std, class_meeting_id uuid NOT NULL, conference_record_id uuid NOT NULL, part_no int NOT NULL DEFAULT 1,
  provider_recording_id text NOT NULL UNIQUE, drive_file_id text UNIQUE,
  status text NOT NULL DEFAULT 'DISCOVERED' CHECK (status IN
    ('DISCOVERED','UPLOADING','PROCESSING','READY','FAILED','SOURCE_MISSING')),
  attempt_count int NOT NULL DEFAULT 0, last_error_code text, last_error text,
  source_size_bytes bigint, source_md5 text, source_mime text, source_duration_ms bigint,   -- Drive metadata
  recording_started_at timestamptz, recording_ended_at timestamptz, uploaded_at timestamptz,
  drive_cleanup_status text NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (drive_cleanup_status IN ('NOT_REQUESTED','PENDING','TRASHED','SKIPPED','FAILED')),
  @fk(class_meeting_id → class_meetings), @fk(conference_record_id → conference_records));
CREATE INDEX ON recordings (status, updated_at) WHERE status NOT IN ('READY');

CREATE TABLE videos (                  -- owner: video. The learner-facing object: an unlisted YouTube video (C-43).
  @std, course_offering_id uuid NOT NULL, class_meeting_id uuid, recording_id uuid UNIQUE,
  origin text NOT NULL CHECK (origin IN ('LINK','RECORDING')),   -- LINK: pasted by staff (v1); RECORDING: auto-uploaded (integration slice)
  title text NOT NULL, description text, position int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'UNPUBLISHED' CHECK (status IN ('PROCESSING','UNPUBLISHED','PUBLISHED','UNAVAILABLE','FAILED','DELETED')),
  status_before_unavailable text,                    -- restored when a recheck succeeds
  visibility text NOT NULL DEFAULT 'ENROLLED' CHECK (visibility IN ('ENROLLED','STAFF_ONLY')),
  youtube_video_id text CHECK (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),   -- NULL only while an automatic upload is PROCESSING/FAILED
  youtube_channel_url text, thumbnail_url text, duration_ms bigint,
  last_checked_at timestamptz, unavailable_reason text,
  audio_key text,                                    -- optional Spaces audio (integration slice, D-09)
  publish_after timestamptz, published_at timestamptz,
  deleted_at timestamptz, delete_after timestamptz, deleted_by uuid, youtube_delete_reminded_at timestamptz,
  added_by uuid,
  CHECK (status IN ('PROCESSING','FAILED') OR youtube_video_id IS NOT NULL),
  @fk(course_offering_id → course_offerings), @fk(class_meeting_id → class_meetings), @fk(recording_id → recordings));
CREATE INDEX ON videos (course_offering_id, status, position);
CREATE UNIQUE INDEX videos_offering_youtube ON videos (course_offering_id, youtube_video_id) WHERE status <> 'DELETED';
CREATE INDEX ON videos (delete_after) WHERE status = 'DELETED';

CREATE TABLE playback_progress (       -- owner: video
  @std, video_id uuid NOT NULL, user_id uuid NOT NULL, position_ms bigint NOT NULL, max_position_ms bigint NOT NULL,
  duration_ms bigint NOT NULL, percent_complete numeric(5,2) NOT NULL, completed boolean NOT NULL DEFAULT false, completed_at timestamptz,
  last_seq bigint NOT NULL DEFAULT 0,
  UNIQUE (video_id, user_id), @fk(video_id → videos), @fk(user_id → users));
```

### 6.6 M05 — Content and assessment

```sql
CREATE TABLE files (                   -- owner: content. Every uploaded file (materials, submissions, passport photos, PDFs).
  @std, owner_user_id uuid NOT NULL, purpose text NOT NULL CHECK (purpose IN ('MATERIAL','SUBMISSION','PASSPORT_PHOTO','TRANSCRIPT_PDF','IMPORT','ASSIGNMENT_ATTACHMENT')),
  storage_key text NOT NULL UNIQUE, original_name text NOT NULL, mime text NOT NULL, size_bytes bigint NOT NULL, sha256 text,
  status text NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (status IN ('PENDING_UPLOAD','AVAILABLE','DELETED')),
  @fk(owner_user_id → users));
-- M05 adds: students.photo_file_id → files(id).

CREATE TABLE course_materials (        -- owner: content
  @std, course_offering_id uuid NOT NULL, section_label text, title text NOT NULL, kind text NOT NULL CHECK (kind IN ('FILE','LINK','TEXT')),
  file_id uuid, url text, body_md text, visibility text NOT NULL DEFAULT 'ENROLLED' CHECK (visibility IN ('ENROLLED','STAFF_ONLY')),
  publish_at timestamptz, position int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  @fk(course_offering_id → course_offerings), @fk(file_id → files));

CREATE TABLE announcements (           -- owner: content
  @std, course_offering_id uuid NOT NULL, author_user_id uuid NOT NULL, class_meeting_id uuid, title text NOT NULL, body_md text NOT NULL,
  pinned boolean NOT NULL DEFAULT false, published_at timestamptz, @fk(course_offering_id → course_offerings), @fk(author_user_id → users));

CREATE TABLE assessments (             -- owner: assessment. The GRADEBOOK COLUMN.
  @std, course_offering_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('ASSIGNMENT','QUIZ','EXAM','MANUAL')), title text NOT NULL,
  max_score numeric(7,2) NOT NULL CHECK (max_score > 0), weight numeric(5,2) NOT NULL CHECK (weight >= 0 AND weight <= 100),
  position int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')), due_at timestamptz,
  @fk(course_offering_id → course_offerings));

CREATE TABLE assignments (             -- owner: assessment. Backs exactly one ASSIGNMENT assessment.
  @std, course_offering_id uuid NOT NULL, assessment_id uuid NOT NULL UNIQUE, instructions_md text NOT NULL, due_at timestamptz NOT NULL, cutoff_at timestamptz,
  max_attempts int NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10), late_policy jsonb NOT NULL DEFAULT '{"allowLate":false}',
  submission_types text[] NOT NULL DEFAULT '{FILE,TEXT}', max_file_mb int NOT NULL DEFAULT 20,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')), @fk(course_offering_id → course_offerings), @fk(assessment_id → assessments));
CREATE TABLE assignment_attachments ( @std_ro, assignment_id uuid NOT NULL, file_id uuid NOT NULL, @fk(assignment_id → assignments), @fk(file_id → files)); -- owner: assessment
CREATE TABLE assignment_submissions (  -- owner: assessment
  @std, assignment_id uuid NOT NULL, student_id uuid NOT NULL, attempt_no int NOT NULL, text_body text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','RETURNED')), submitted_at timestamptz, is_late boolean NOT NULL DEFAULT false,
  UNIQUE (assignment_id, student_id, attempt_no), @fk(assignment_id → assignments), @fk(student_id → students));
CREATE TABLE submission_files ( @std_ro, submission_id uuid NOT NULL, file_id uuid NOT NULL, @fk(submission_id → assignment_submissions), @fk(file_id → files)); -- owner: assessment

CREATE TABLE questions (               -- owner: assessment. Course-level bank.
  @std, course_id uuid NOT NULL, author_user_id uuid NOT NULL,
  qtype text NOT NULL CHECK (qtype IN ('MCQ_SINGLE','MCQ_MULTI','TRUE_FALSE','SHORT_TEXT','ESSAY')), prompt_md text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]', default_points numeric(6,2) NOT NULL DEFAULT 1, explanation_md text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')), @fk(course_id → courses), @fk(author_user_id → users));

CREATE TABLE quizzes (                 -- owner: assessment. Backs one QUIZ or EXAM assessment (online exams, C-34).
  @std, course_offering_id uuid NOT NULL, assessment_id uuid NOT NULL UNIQUE, title text NOT NULL, instructions_md text,
  time_limit_minutes int, max_attempts int NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10),
  attempt_scoring text NOT NULL DEFAULT 'HIGHEST' CHECK (attempt_scoring IN ('HIGHEST','LAST','AVERAGE')),
  opens_at timestamptz, closes_at timestamptz, shuffle_questions boolean NOT NULL DEFAULT false,
  show_answers text NOT NULL DEFAULT 'AFTER_CLOSE' CHECK (show_answers IN ('NEVER','AFTER_ATTEMPT','AFTER_CLOSE')),
  eligible_study_mode text NOT NULL DEFAULT 'ALL' CHECK (eligible_study_mode IN ('ALL','ONLINE')),   -- EXAM default 'ONLINE'
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')), @fk(course_offering_id → course_offerings), @fk(assessment_id → assessments));
-- Trigger/service rule: the backing assessment's kind ∈ ('QUIZ','EXAM').
CREATE TABLE quiz_questions ( @std_ro, quiz_id uuid NOT NULL, question_id uuid NOT NULL, position int NOT NULL, points numeric(6,2) NOT NULL,
  UNIQUE (quiz_id, question_id), @fk(quiz_id → quizzes), @fk(question_id → questions)); -- owner: assessment
CREATE TABLE quiz_attempts (           -- owner: assessment. question_snapshot FREEZES content at start.
  @std, quiz_id uuid NOT NULL, student_id uuid NOT NULL, attempt_no int NOT NULL, started_at timestamptz NOT NULL, deadline_at timestamptz, submitted_at timestamptz,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','SUBMITTED','GRADED','EXPIRED')),
  question_snapshot jsonb NOT NULL, auto_score numeric(7,2), manual_score numeric(7,2), score numeric(7,2), last_seq bigint NOT NULL DEFAULT 0,
  UNIQUE (quiz_id, student_id, attempt_no), @fk(quiz_id → quizzes), @fk(student_id → students));
CREATE TABLE quiz_responses ( @std, attempt_id uuid NOT NULL, question_id uuid NOT NULL, response jsonb, is_correct boolean, points_awarded numeric(6,2), grader_comment text,
  UNIQUE (attempt_id, question_id), @fk(attempt_id → quiz_attempts)); -- owner: assessment

CREATE TABLE grades (                  -- owner: assessment. One row per (assessment, student).
  @std, course_offering_id uuid NOT NULL, assessment_id uuid NOT NULL, student_id uuid NOT NULL, score numeric(7,2),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','QUIZ','SUBMISSION','IMPORT')),   -- paper exam scores = MANUAL
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RELEASED','EXCUSED')), feedback_md text, graded_by uuid, graded_at timestamptz, released_at timestamptz,
  UNIQUE (assessment_id, student_id), @fk(course_offering_id → course_offerings), @fk(assessment_id → assessments), @fk(student_id → students));
CREATE TABLE grade_changes (           -- owner: assessment. Append-only history, in addition to audit_logs.
  @std_ro, grade_id uuid NOT NULL, old_score numeric(7,2), new_score numeric(7,2), old_status text, new_status text, old_source text, new_source text,
  changed_by uuid NOT NULL, reason text, @fk(grade_id → grades));
```

### 6.7 M06 — Platform tables

```sql
CREATE UNLOGGED TABLE rate_limit_buckets (  -- owner: shared platform. Google quota token buckets (§11.7).
  key text PRIMARY KEY, tokens double precision NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
-- custom SQL: FUNCTION rl_acquire(p_key text, p_capacity int, p_refill_per_sec numeric, p_cost int DEFAULT 1) RETURNS int
--   1) INSERT … ON CONFLICT DO NOTHING (new bucket starts full); 2) SELECT … FOR UPDATE;
--   3) tokens := LEAST(p_capacity, tokens + extract(epoch FROM now() - updated_at) * p_refill_per_sec);
--   4) if tokens >= p_cost: tokens -= p_cost; return 0 else return ceil((p_cost - tokens) / p_refill_per_sec * 1000) (ms to wait).

CREATE TABLE idempotency_keys (        -- owner: shared platform
  @std_ro, user_id uuid NOT NULL, operation text NOT NULL, key text NOT NULL, request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')), response_status int, response_body jsonb, expires_at timestamptz NOT NULL,
  UNIQUE (user_id, operation, key));

CREATE TABLE audit_logs (              -- owner: audit. APPEND-ONLY: REVOKE UPDATE, DELETE from glim_app + trigger raising on UPDATE/DELETE.
  @std_ro, actor_user_id uuid, actor_type text NOT NULL CHECK (actor_type IN ('USER','SYSTEM','JOB','PROVIDER')),
  action text NOT NULL, resource_type text NOT NULL, resource_id text, outcome text NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILURE')),
  metadata jsonb NOT NULL DEFAULT '{}',          -- never contains sensitive applicant answers (INV-15)
  request_id text, ip inet, user_agent text);
CREATE INDEX ON audit_logs (created_at DESC); CREATE INDEX ON audit_logs (resource_type, resource_id);

CREATE TABLE notifications (           -- owner: notifications
  @std_ro, user_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL, body text, data jsonb NOT NULL DEFAULT '{}', read_at timestamptz,
  email_status text NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (email_status IN ('NOT_REQUESTED','PENDING','SENT','FAILED','SUPPRESSED')), dedupe_key text,
  UNIQUE (user_id, dedupe_key), @fk(user_id → users));
CREATE INDEX ON notifications (user_id, created_at DESC);
CREATE TABLE notification_preferences ( @std, user_id uuid NOT NULL, kind text NOT NULL, in_app boolean NOT NULL DEFAULT true, email boolean NOT NULL DEFAULT true,
  UNIQUE (user_id, kind), @fk(user_id → users)); -- owner: notifications

CREATE TABLE import_jobs (             -- owner: imports
  @std, kind text NOT NULL CHECK (kind IN ('STUDENTS','LECTURERS','COURSE_ENROLLMENTS','COURSE_RESULTS')), file_id uuid NOT NULL,
  file_sha256 text NOT NULL, dry_run boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED')), stats jsonb NOT NULL DEFAULT '{}',
  error_file_id uuid, rows_done int NOT NULL DEFAULT 0, created_by uuid NOT NULL, @fk(file_id → files));
```

**Ops read model** (view `v_ops_failures`) unions:
- `provider_events(status='FAILED')`
- `recordings(status IN ('FAILED','SOURCE_MISSING'))`
- `videos(status IN ('UNAVAILABLE','FAILED'))`
- `class_meetings(provider_status='ERROR')`
- pg-boss jobs in `failed` state and its dead-letter queues
- `provider_subscriptions(status<>'ACTIVE')`

It's consumed by `/admin/ops/failures` (§15.3).

### 6.8 M07 — Results, awards and transcripts

```sql
CREATE TABLE grading_schemes (         -- owner: results. IMMUTABLE once used (locked_at set at first result); edits create a new row (supersedes_id).
  @std, name text NOT NULL UNIQUE, kind text NOT NULL CHECK (kind IN ('NUC_5','CUSTOM')),
  bands jsonb NOT NULL,         -- [{"minX100":7000,"maxX100":10000,"letter":"A","pointsX100":500,"pass":true}, …] contiguous 0–10000
  class_bands jsonb NOT NULL,   -- award classes: [{"minCgpaX100":450,"maxCgpaX100":500,"label":"Distinction"}, …]
  min_award_cgpa_x100 int NOT NULL DEFAULT 100,   -- below this: no award
  max_points_x100 int NOT NULL, pass_mark_x100 int NOT NULL,
  repeat_policy text NOT NULL DEFAULT 'BEST' CHECK (repeat_policy IN ('KEEP_ALL','REPLACE_LATEST','BEST')),
  good_standing_cgpa_x100 int NOT NULL DEFAULT 100, probation_cgpa_x100 int,    -- D-02
  supersedes_id uuid, locked_at timestamptz);
-- M07 also adds: programmes.grading_scheme_id → grading_schemes(id) NOT VALID then VALIDATE; seeds 'GLIM Certificate' and 'GLIM Diploma' schemes (§14.4).

CREATE TABLE course_results (          -- owner: results. One per course enrollment (or per imported legacy result). Frozen when FINALIZED.
  @std, course_enrollment_id uuid UNIQUE, programme_enrollment_id uuid NOT NULL, semester_id uuid NOT NULL,
  course_offering_id uuid, course_id uuid NOT NULL, student_id uuid NOT NULL, grading_scheme_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'GRADEBOOK' CHECK (source IN ('GRADEBOOK','IMPORT')),
  attempt_no int NOT NULL DEFAULT 1, credits_x10 int NOT NULL,
  final_pct_x100 int, letter text, points_x100 int, quality_points_x1000 bigint,
  result_kind text NOT NULL DEFAULT 'GRADED' CHECK (result_kind IN ('GRADED','INCOMPLETE','WITHDRAWN','EXEMPT','AUDIT')),
  counts_in_gpa boolean NOT NULL DEFAULT true, passed boolean,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINALIZED','APPROVED','PUBLISHED')),
  finalized_by uuid, finalized_at timestamptz, approved_by uuid, approved_at timestamptz, published_at timestamptz, reopened_count int NOT NULL DEFAULT 0,
  CHECK ((source = 'IMPORT') OR (course_enrollment_id IS NOT NULL AND course_offering_id IS NOT NULL)),
  @fk(course_enrollment_id → course_enrollments), @fk(programme_enrollment_id → programme_enrollments), @fk(semester_id → semesters),
  @fk(course_offering_id → course_offerings), @fk(course_id → courses), @fk(student_id → students), @fk(grading_scheme_id → grading_schemes));
CREATE INDEX ON course_results (programme_enrollment_id, semester_id);
CREATE INDEX ON course_results (student_id, course_id);

CREATE TABLE course_result_revisions ( -- owner: results. Append-only.
  @std_ro, course_result_id uuid NOT NULL, change_kind text NOT NULL, old_value jsonb, new_value jsonb, changed_by uuid NOT NULL, reason text NOT NULL,
  @fk(course_result_id → course_results));

CREATE TABLE semester_results (        -- owner: results. Per programme enrollment per semester; recomputed deterministically.
  @std, programme_enrollment_id uuid NOT NULL, semester_id uuid NOT NULL,
  credits_attempted_x10 int NOT NULL, credits_earned_x10 int NOT NULL, quality_points_x1000 bigint NOT NULL, gpa_x100 int,
  cum_credits_attempted_x10 int NOT NULL, cum_credits_earned_x10 int NOT NULL, cum_quality_points_x1000 bigint NOT NULL, cgpa_x100 int,
  standing text NOT NULL DEFAULT 'UNKNOWN' CHECK (standing IN ('GOOD','PROBATION','WITHDRAW_REQUIRED','UNKNOWN')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','PUBLISHED')),
  computed_at timestamptz NOT NULL, calc_version int NOT NULL DEFAULT 1, approved_by uuid, approved_at timestamptz, published_at timestamptz,
  UNIQUE (programme_enrollment_id, semester_id), @fk(programme_enrollment_id → programme_enrollments), @fk(semester_id → semesters));

CREATE TABLE award_sequences ( award_type text NOT NULL, year int NOT NULL, next_value int NOT NULL DEFAULT 1, PRIMARY KEY (award_type, year) ); -- owner: results

CREATE TABLE awards (                  -- owner: results. The Certificate or Diploma conferred on completing a programme.
  @std, programme_enrollment_id uuid NOT NULL UNIQUE, cgpa_x100 int NOT NULL, award_class text,   -- 'Distinction' | 'Credit' | 'Pass'
  credits_earned_x10 int NOT NULL, awarded_on date, certificate_no text UNIQUE,                     -- 'GLIM/DIP/AWD/2029/0001'
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CONFERRED')), approved_by uuid, approved_at timestamptz,
  @fk(programme_enrollment_id → programme_enrollments));

CREATE TABLE transcript_sequences ( year int PRIMARY KEY, next_value int NOT NULL DEFAULT 1 ); -- owner: transcripts

CREATE TABLE transcript_requests (     -- owner: transcripts
  @std, student_id uuid NOT NULL, programme_enrollment_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('UNOFFICIAL','OFFICIAL')),
  purpose text, recipient_name text, recipient_email citext,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','ISSUED','CANCELLED')),
  decided_by uuid, decided_at timestamptz, decision_reason text, @fk(student_id → students), @fk(programme_enrollment_id → programme_enrollments));

CREATE TABLE transcripts (             -- owner: transcripts. IMMUTABLE issued documents (tamper-evident).
  @std_ro, student_id uuid NOT NULL, programme_enrollment_id uuid NOT NULL, request_id uuid, kind text NOT NULL CHECK (kind IN ('UNOFFICIAL','OFFICIAL')),
  serial_no text NOT NULL UNIQUE, verification_code text NOT NULL UNIQUE,   -- 16 chars base32, used by the public verify page
  as_of date NOT NULL, issued_by uuid NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL, snapshot_sha256 text NOT NULL, file_id uuid,
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','REVOKED','SUPERSEDED')), revoked_by uuid, revoked_at timestamptz, revoke_reason text,
  @fk(student_id → students), @fk(programme_enrollment_id → programme_enrollments), @fk(file_id → files));
-- transcripts.status is the only mutable column: a trigger rejects any other UPDATE.
-- Public verification uses a SQL function verify_transcript(code text) returning only
-- {valid, status, issued_at, programme_name, student_initials, as_of, snapshot_sha256}.
```

**Results pipeline:** gradebook (§14.2) → `course_results` (finalize) → `semester_results` (approve → publish) → `awards` → `transcripts` snapshot.

### 6.9 M08 — Admissions

```sql
CREATE TABLE application_sequences ( intake_id uuid PRIMARY KEY REFERENCES intakes(id), next_value int NOT NULL DEFAULT 1 ); -- owner: admissions

CREATE TABLE applications (            -- owner: admissions. Mirrors the paper application form section by section.
  @std, intake_id uuid NOT NULL, programme_id uuid NOT NULL, applicant_user_id uuid NOT NULL,
  reference_no text UNIQUE,                                  -- 'GLIM-APP-2027-00001', allocated at SUBMIT
  study_mode text CHECK (study_mode IN ('ON_CAMPUS','ONLINE')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN
    ('DRAFT','SUBMITTED','UNDER_REVIEW','ADMITTED','ACCEPTED','REJECTED','LAPSED','WITHDRAWN')),
  -- 1. Personal information
  first_name text, middle_name text, last_name text,
  title text CHECK (title IN ('MR','MRS','PASTOR','REV','DR','OTHER')), title_other text,
  gender text CHECK (gender IN ('MALE','FEMALE')), date_of_birth date,
  marital_status text CHECK (marital_status IN ('SINGLE','MARRIED','SINGLE_PARENT','WIDOWED','SEPARATED','DIVORCED')),
  nationality text, occupation text,
  -- 2. Contact information (email defaults to the Google account email)
  email citext, phone_whatsapp text, alt_phone_whatsapp text,
  -- 3. Address information
  country text, state_province text, city text, postcode text, address text,
  -- 4. Church information
  church_name text, church_address text, pastor_name text, pastor_phone text,
  -- 5. Spiritual background — SENSITIVE (INV-15). {bornAgain:bool, bornAgainWhen:text, waterBaptism:text, holySpiritBaptism:bool, holySpiritSince:text}
  spiritual_background jsonb,
  -- 6. Feedback information
  heard_via text[] NOT NULL DEFAULT '{}',   -- subset of FACEBOOK, INSTAGRAM, EMAIL, SMS, BILLBOARD, FLYER, FRIEND, STUDENT, ALUMNI, STAFF, BABIC_CONFERENCE, NCGC_MEMBER, OTHER
  heard_via_other text, referral_code_entered text, referrer_user_id uuid,
  -- 7. Declaration & affirmation (typed-name signature)
  declaration_full_name text, statement_of_faith_read boolean NOT NULL DEFAULT false, declared_at timestamptz,
  -- 8. Data processing consent
  data_consent_at timestamptz,
  photo_file_id uuid,
  -- workflow
  submitted_at timestamptz, review_started_at timestamptz, reviewed_by uuid,
  decided_by uuid, decided_at timestamptz, decision_note text,          -- internal note; never shown to the applicant
  offer_expires_at timestamptz, accepted_at timestamptz, withdrawn_at timestamptz,
  purge_after timestamptz,
  CHECK (status = 'DRAFT' OR (reference_no IS NOT NULL AND submitted_at IS NOT NULL AND declared_at IS NOT NULL
         AND data_consent_at IS NOT NULL AND statement_of_faith_read AND photo_file_id IS NOT NULL AND study_mode IS NOT NULL)),
  CHECK (status <> 'ADMITTED' OR offer_expires_at IS NOT NULL),
  @fk(intake_id → intakes), @fk(programme_id → programmes), @fk(applicant_user_id → users), @fk(referrer_user_id → users),
  @fk(photo_file_id → files));
CREATE UNIQUE INDEX one_open_application ON applications (applicant_user_id, intake_id)
  WHERE status NOT IN ('REJECTED','LAPSED','WITHDRAWN');
CREATE INDEX ON applications (intake_id, status, submitted_at);
CREATE INDEX ON applications (purge_after) WHERE purge_after IS NOT NULL;
-- M08 also adds: programme_enrollments.application_id → applications(id).

CREATE TABLE application_events (      -- owner: admissions. Status history (never contains sensitive answers).
  @std_ro, application_id uuid NOT NULL, from_status text, to_status text NOT NULL, actor_user_id uuid, note text,
  @fk(application_id → applications) ON DELETE CASCADE);
```

### 6.10 Index and performance requirements

Beyond the indexes above, justify each addition with `EXPLAIN` in the PR. Two queries must each execute in **< 5 ms** on the seeded test dataset (500 students, 3 years of data): the join authorization query (§11.6) and the video playback authorization query (§13.5).

---

## 7. Authorization

### 7.1 Model

The model is RBAC (role-based access control) for coarse capabilities, plus **resource checks** for offering context and ownership. Access is denied by default. Permissions are named `<domain>:<resource>:<action>`.

- **Staff roles** (rows in `role_assignments`, institution-wide, with no scopes): `SYSTEM_ADMIN`, `ADMISSIONS_OFFICER`, `REGISTRAR`, `ACADEMIC_ADMIN`. One person may hold several.
- **Derived roles:**
  - **Lecturer**: an `ACTIVE` `lecturers` row. Rights per offering come from `lecturer_assignments` (§7.4).
  - **Student**: an `ACTIVE` `students` row. Rights per offering come from `v_offering_access` (§6.3).
  - **Applicant**: any user who owns an `applications` row. Applicants can only act on their own applications.

### 7.2 Decision algorithm (`AuthorizationService.authorize(ctx, permission, resourceRef?)`)

1. Load the `ResourceContext {offeringId?, ownerUserId?, applicationId?}` through the owning module's `ResourceContextLoader`. If the resource doesn't exist, return **404**.
2. **Staff path:** if any active role assignment grants the permission (§7.3), allow.
3. **Lecturer path:** if there is an active `lecturer_assignment` on `resource.offeringId` whose role (plus `capability_overrides`) grants the capability (§7.4), allow.
4. **Student path:** allow if the permission is in the student set, the user has a `v_offering_access` row for the offering, and the row's `source_status` satisfies the permission's rule. Participation needs `ENROLLED`; read-only content and recordings accept `COMPLETED`. Self-owned resources (own submission, own progress, own results) additionally require `ownerUserId === ctx.userId`.
5. **Applicant path:** the permission is `admissions:application:own-*` and `application.applicant_user_id === ctx.userId`.
6. Otherwise, deny. A resource the caller can't see returns **404**, never 403. Denied **write** attempts are audited (`outcome=DENIED`), sampled at most once per minute per (user, permission).

Rules: memoize only per request. List endpoints filter **in SQL** through a `VisibleOfferings` helper and never authorize items one by one.

### 7.3 Permission catalogue and role matrix

Legend:
- **●** granted
- **T** requires an active lecturer assignment with the capability (§7.4)
- **S** requires student entitlement (`E` = ENROLLED only; `E/C` = ENROLLED or COMPLETED); "own" means ownership is also required
- **A** applicant, own application only
- **–** never

| Permission | SYSTEM_ADMIN | ADMISSIONS_OFFICER | REGISTRAR | ACADEMIC_ADMIN | LECTURER | STUDENT | APPLICANT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `identity:user:read` | ● | ● | ● | ● | – | – | – |
| `identity:user:manage` | ● | – | – | – | – | – | – |
| `identity:role:manage` | ● | – | – | – | – | – | – |
| `identity:policy:manage` | ● | – | – | – | – | – | – |
| `identity:import:run` | ● | – | – | ● | – | – | – |
| `admissions:intake:manage` | ● | ● | – | – | – | – | – |
| `admissions:application:read` | ● | ● | – | – | – | – | – |
| `admissions:application:read-sensitive` | ● | ● | – | – | – | – | – |
| `admissions:application:decide` | ● | ● | – | – | – | – | – |
| `admissions:application:own-edit` (draft, submit, withdraw) | – | – | – | – | – | – | A |
| `admissions:application:own-accept` | – | – | – | – | – | – | A |
| `admissions:report:read` | ● | ● | – | – | – | – | – |
| `academic:structure:read` | ● | ● | ● | ● | ● | ● | – |
| `academic:structure:manage` (programmes, curricula, courses, sessions, semesters, rooms) | ● | – | – | ● | – | – | – |
| `academic:course-offering:read` | ● | – | ● | ● | T | S E/C | – |
| `academic:course-offering:manage` | ● | – | – | ● | – | – | – |
| `lecturing:assignment:read` | ● | – | ● | ● | T | S E/C | – |
| `lecturing:assignment:manage` | ● | – | – | ● | – | – | – |
| `enrollment:student:read` | ● | ● | ● | ● | T (roster) | – | – |
| `enrollment:student:manage` | ● | – | – | ● | – | – | – |
| `enrollment:course-enrollment:read` | ● | – | ● | ● | T (roster) | S own | – |
| `enrollment:course-enrollment:manage` | ● | – | – | ● | – | – | – |
| `enrollment:elective:select` | – | – | – | – | – | S own, window open | – |
| `meeting:class-meeting:read` | ● | – | ● | ● | T | S E | – |
| `meeting:class-meeting:manage` (create/reschedule/cancel) | ● | – | – | ● | T | – | – |
| `meeting:class-meeting:start` / `:end` | ● | – | – | ● | T | – | – |
| `meeting:class-meeting:join` | ● | – | – | ● | T | S E | – |
| `attendance:record:read` | ● | – | ● | ● | T | S own | – |
| `attendance:roll-call:mark` | ● | – | – | ● | T | – | – |
| `attendance:record:override` | ● | – | – | ● | T | – | – |
| `attendance:participant:resolve` | ● | – | – | ● | T | – | – |
| `attendance:report:read` | ● | – | ● | ● | T (own offerings) | – | – |
| `video:asset:read` / `:play` | ● | – | – | ● | T | S E/C | – |
| `video:asset:manage` (add YouTube link, publish/unpublish, edit metadata, reorder, recheck) | ● | – | – | ● | T | – | – |
| `video:asset:admin` (delete, restore, replace link, retry ingest) | ● | – | – | – | – | – | – |
| `video:progress:write` | – | – | – | – | – | S own, E/C | – |
| `content:material:read` | ● | – | ● | ● | T | S E/C | – |
| `content:material:manage` / `content:announcement:manage` | ● | – | – | ● | T | – | – |
| `assessment:assignment:manage` / `assessment:quiz:manage` | ● | – | – | ● | T | – | – |
| `assessment:submission:create` / `assessment:quiz:attempt` | – | – | – | – | – | S own, E | – |
| `assessment:submission:read` | ● | – | – | ● | T | S own | – |
| `assessment:grade:read` | ● | – | ● | ● | T | S own, released | – |
| `assessment:grade:update` / `:release` | ● | – | – | ● | T | – | – |
| `results:course-result:finalize` | ● | – | – | ● | T (PRIMARY) | – | – |
| `results:course-result:reopen` | ● | – | ● | – | – | – | – |
| `results:semester:compute` | ● | – | ● | ● | – | – | – |
| `results:semester:approve` / `:publish` | ● | – | ● | – | – | – | – |
| `results:record:read` | ● | – | ● | ● | T (own offerings) | S own, finalized (C-11) | – |
| `results:award:confirm` | ● | – | ● | – | – | – | – |
| `results:scheme:manage` | ● | – | ● | – | – | – | – |
| `transcript:request:create` | – | – | – | – | – | S own | – |
| `transcript:request:manage` / `transcript:document:issue` / `:revoke` | ● | – | ● | – | – | – | – |
| `transcript:document:read` | ● | – | ● | – | – | S own, issued | – |
| `audit:log:read` | ● | – | – | – | – | – | – |
| `ops:integration:manage` / `ops:failures:read` / `ops:failures:replay` | ● | – | – | – | – | – | – |

`transcript:verify:public` is unauthenticated and rate-limited (§14.7). The machine-readable twin of this table lives at `packages/modules/authorization/src/matrix.json`, and **tests are generated from it**. If the doc and the JSON disagree, the JSON wins and the doc has a bug.

### 7.4 Lecturer-assignment capabilities (default; overridable per assignment through `capability_overrides`)

| Capability | PRIMARY | CO_LECTURER | ASSISTANT | GUEST_LECTURER |
| ---------- | ------- | ----------- | --------- | -------------- |
| manage Class Meetings | ✔ | ✔ | – | – |
| start / co-host / end / join | ✔ | ✔ | ✔ | ✔ |
| roster, attendance read, roll call, participant resolve | ✔ | ✔ | ✔ | ✔ |
| attendance override | ✔ | ✔ | – | – |
| materials, announcements | ✔ | ✔ | ✔ | – |
| video manage (add YouTube link, publish/unpublish, edit) | ✔ | ✔ | – | – |
| assignments/quizzes/exams manage | ✔ | ✔ | – | – |
| grade update (incl. paper exam scores) | ✔ | ✔ | ✔ | – |
| grade release | ✔ | ✔ | – | – |
| finalize course results | ✔ | – | – | – |

### 7.5 Test personas (`packages/db/test/fixtures/personas.ts`)

| Persona | Who they are |
|---|---|
| `sysAdmin` | System Admin |
| `admOfficer` | Admissions Officer |
| `registrar` | Registrar |
| `acadAdmin` | Academic Admin |
| `l1Primary`, `l2Co`, `l3Assistant` | Lecturers on offering O1 (PRIMARY, CO_LECTURER, ASSISTANT) |
| `l4Other` | Lecturer on offering O2 only |
| `s1` | enrolled in O1 |
| `s2` | enrolled in O2 |
| `s3` | dropped from O1 |
| `s4` | enrolled in O1, suspended |
| `s5` | completed O1, still ACTIVE in the programme |
| `s6` | completed O1, graduated |
| `app1` | applicant with a draft |
| `app2` | applicant who has been admitted |
| `app3` | another applicant |

Every endpoint gets a table-driven deny test over these personas.

---

## 8. Identity and sign-in

### 8.1 Sign-in methods (v2-11)

1. **Google OIDC** (authorization code + PKCE; scopes `openid email profile`). Verify the ID token and require `email_verified === true`.
   - **Staff** sign-in may be restricted to `settings.staff_email_domains` through the `hd` claim.
   - **Students and applicants sign in with any Google account** (personal Gmail, C-10). There's no `hd` check for them.
   - Match a sign-in to an existing user by `identities(provider='google', subject=sub)`, and otherwise by verified email. Then link the identity.
2. **Self-registration happens only through `/apply`** (C-36). A Google sign-in started from the apply page with no matching user creates a `users` row with status `ACTIVE` and no roles. That makes them an applicant once they start an application. Every other unmatched sign-in is refused (`ACCOUNT_NOT_FOUND`); staff and imported students are created by admins and invited.
3. **Local email + password** is a fallback for **staff and imported legacy students only**:
   - argon2id with current OWASP parameters, minimum length 12, checked against a breached-password list when set
   - lockout after 5 failures for 15 minutes
   - uniform errors (no account enumeration) and timing-safe comparison
4. **Invites and resets:** single-use tokens (32 random bytes, stored as SHA-256). An invite is valid for 7 days and a reset for 30 minutes. Using one successfully revokes all sessions.
5. **A Google account link is mandatory before a student's first live join** (`GOOGLE_ACCOUNT_REQUIRED`). Students admitted through `/apply` already have one. Imported students link theirs from the invite or the profile page.
6. MFA is out of scope; Google sign-in inherits the user's Google 2-step verification.

### 8.2 Account lifecycle

`INVITED → ACTIVE → SUSPENDED ↔ ACTIVE → DEACTIVATED`. Suspending or deactivating revokes all sessions immediately and stops notifications; data is retained. A deactivated Lecturer's active assignments must be reassigned; the admin sees a warning rather than a silent block.

### 8.3 Sessions (v2-12)

- An opaque 32-byte random token goes in the cookie `__Host-glim_sid` (`HttpOnly; Secure; SameSite=Lax; Path=/`). The server stores only `SHA-256(token)`.
- Lifetimes: idle 2 h, absolute 12 h. Applicants get idle 24 h, because the long form is saved as a draft. The sliding idle expiry is updated at most once per minute.
- Each request looks the session up by `token_hash` through a 5 s in-process LRU, so revocation takes effect within ~5 s.
- **CSRF:** non-GET requests require the header `X-CSRF-Token` = `HMAC(csrf_secret, sessionId)`, returned by `GET /me`. Also verify `Origin`/`Sec-Fetch-Site`. The API and SPA are same-origin.
- Always rotate the token on sign-in and revoke sessions on password change.

### 8.4 `GET /api/v1/me`

Returns:

```
{
  user: { id, displayName, email, timezone },
  institution: { name, timezone },
  roles: { staff: [...], isLecturer, isStudent, isApplicant },
  csrfToken,
  featureFlags
}
```

The UI uses it for navigation only; every action is re-authorized on the server (INV-1).

---

## 9. Academic core

### 9.1 Calendar and lifecycle rules (C-32)

- An **Academic Session** runs from September to the following June, and its code looks like `2027/2028`. It has **two semesters**: sequence 1 (Sept–Jan) and sequence 2 (Feb–June). Each semester has an exam period (`exams_start_on`/`exams_end_on`) at its end.
- **Levels:** the Certificate has Year 1 only; the Diploma has Year 1 and Year 2.

| Aggregate | Allowed transitions | Invariants |
| --------- | ------------------- | ---------- |
| AcademicSession | `PLANNED → ACTIVE → CLOSED` | At most one `ACTIVE`. Semesters lie within the session and don't overlap. Activating a session runs **progression** (D-03): every ACTIVE Diploma enrollment at Year 1 that started in an earlier session advances to Year 2 (`current_level=2`), audited. |
| Semester | `PLANNED → REGISTRATION → ACTIVE → CLOSED` | **Opening registration** enqueues `semester.open-registration` (§9.3). **Closing** marks the semester's offerings `COMPLETED` (sets `completed_at`), moves `ENROLLED` course enrollments to `COMPLETED`, and emits `academic.semester.closed`, which enqueues `results.compute-semester`. |
| Curriculum | `DRAFT → ACTIVE → RETIRED` | Activation requires at least one placement, and only one ACTIVE curriculum per programme is allowed. An ACTIVE curriculum that has enrollments can't be edited; **clone it to a new version** instead. |
| CourseOffering | `DRAFT → PUBLISHED → ACTIVE → COMPLETED`; `* → CANCELLED` | Publishing requires at least one active `PRIMARY` Lecturer. Cancelling cancels future Class Meetings and notifies enrollees. |

### 9.2 Offering creation (one transaction)

1. Validate course/semester/section uniqueness.
2. Insert the offering.
3. Insert lecturer assignments (at least one PRIMARY before publishing).
4. Write the audit row and enqueue `course.offering.created`.

### 9.3 Registration and enrollment (C-30)

- **Chain:** `ProgrammeEnrollment → SemesterEnrollment → CourseEnrollment`. A course enrollment requires an `ACTIVE` programme enrollment and a `REGISTERED` semester enrollment for the offering's semester.
- **`semester.open-registration`** is idempotent and runs per programme enrollment. For every ACTIVE programme enrollment whose programme has placements in this semester, it:
  1. creates the semester enrollment (`level_no = current_level`)
  2. **auto-registers every `COMPULSORY` placement** for that Level and semester that has a published offering (`selection='COMPULSORY'`)
  3. returns a per-course outcome; a missing offering produces an ops warning and a notification to the Academic Admin

  Students accepted after registration opens are processed the same way during acceptance (§10.4).
- **Elective selection** (`enrollment:elective:select`): while the semester is `REGISTRATION` or `ACTIVE` and before `add_drop_deadline_on`, a student may add or drop `ELECTIVE` placements for their Level and semester that have a published offering (`selection='ELECTIVE'`). There are no other self-service registrations.
- **Manual registration** (`selection='MANUAL'`, Academic Admin, `reason` required) covers retakes of failed compulsory courses (D-03) and exceptions.
- **Capacity:** if `capacity` is set, lock the offering (`SELECT … FOR UPDATE`), count `ENROLLED`, and reject with `OFFERING_FULL` (422). The partial unique index blocks duplicates (409 `ALREADY_ENROLLED`).
- **Drop/withdraw:**
  - Electives may be dropped until `add_drop_deadline_on` → `DROPPED` (student or admin).
  - After the deadline, or for compulsory courses, the change is `WITHDRAWN` (Academic Admin, with reason).
  - Both write `course_enrollment_events` and emit `course.enrollment.ended`, which triggers Meet member removal and a notification. Attendance and grades are retained.
- **Credit-load limits:** none in v1.

### 9.4 Lecturer assignments

- Exactly one active `PRIMARY` per offering (partial unique index).
- Adding or ending an assignment updates `meeting_lecturer_slots` for **future** Class Meetings in the same transaction, and emits `lecturing.assignment.created|ended`, which triggers `class-meeting.sync-access`.
- Reassigning the PRIMARY is a single transactional swap.
- Ending the last PRIMARY of a `PUBLISHED/ACTIVE` offering that has future Class Meetings is rejected (`PRIMARY_REQUIRED`).

### 9.5 Schedule conflict rules (v2-22)

On Class Meeting create, reschedule or series generation, **in the same transaction**:

- **Lecturer conflict (blocking, DB-enforced):** `meeting_lecturer_slots` rows for every assigned Lecturer, enforced by the exclusion constraint `no_lecturer_overlap`. A violation returns 409 `LECTURER_SCHEDULE_CONFLICT` with the conflicting meetings. An Academic Admin may resubmit with `overrideConflicts=true` + `reason`; those rows are written with `override=true` and audited.
- **Room conflict (blocking, DB-enforced):** the exclusion constraint `no_room_double_booking` on `class_meetings`. A violation returns 409 `ROOM_CONFLICT`, and there is no override; pick another Room.
- **Student clash (warning only):** returns `warnings:[{code:'STUDENT_SCHEDULE_CLASH', count, sampleMeetingIds}]`.

---

## 10. Admissions

### 10.1 Intakes (C-33)

- There is one intake per year. Intake `2027` takes applications from November 2026 to June 2027 (`opens_on`/`closes_on`), and its students start in the `2027/2028` Academic Session. The Admissions Officer creates it, linked to its Academic Session.
- The intake status is `PLANNED → OPEN → CLOSED`. A daily cron opens and closes it from its dates, and an officer can also do this manually.
- **Applicants can start or submit an application only while the intake is `OPEN`** (`INTAKE_CLOSED`). Review, decisions and acceptance may continue after the intake closes.

### 10.2 Application form (mirrors the paper form; C-29, C-36)

Applicants start at `/apply`:

1. They sign in with Google. A Google account is required, and the page links to Google's account sign-up.
2. They choose the **programme** (Certificate or Diploma) and **study mode** (On-campus or Online).
3. They fill in a section wizard that is autosaved every 5–10 s and works on flaky connections.

| § | Section | Fields (required unless marked) |
| - | ------- | ------------------------------- |
| 1 | Personal information | first name, middle name (optional), last name; title (Mr/Mrs/Pastor/Rev/Dr/Other + text); gender (Male/Female); date of birth (age ≥ 18 at intake start, Q-15); marital status (Single/Married/Single Parent/Widowed/Separated/Divorced); nationality; present occupation |
| 2 | Contact information | email (prefilled from Google, editable for correspondence); mobile phone (WhatsApp); alternative phone (WhatsApp, optional) |
| 3 | Address information | country of residence; state/province; city; post code (optional); address |
| 4 | Church information | church name; church address; pastor's name; pastor's phone |
| 5 | Spiritual background (**sensitive**, INV-15) | born again? (yes/no) + when; baptised in water by immersion? (text); baptised in the Holy Spirit with evidence of speaking in tongues? (yes/no) + since when |
| 6 | Feedback | how did you hear about us? (multi-select: Facebook, Instagram, Email, SMS, Billboard, Flyer, Friend, Student, Alumni, Staff, BABIC Conference, NCGC Member, Other + text); referral code (optional) |
| 7 | Declaration & affirmation | typed full name; tick "I have read the GLIM Online Bible College Statement of Faith in its entirety" (links to `settings.statement_of_faith_url`); tick the declaration text; date set by the server |
| 8 | Data processing consent | tick the consent text; date set by the server |
| — | Passport photo | JPEG/PNG upload, downscaled client-side to ≤ 600 px / ≤ 300 KB; server cap 2 MB |

- **Submit** (`Idempotency-Key`) validates every required field with the shared Zod contract. It then allocates `reference_no = GLIM-APP-{intake.code}-{NNNNN}` from `application_sequences` (row lock), sets `SUBMITTED`, records the event, and emails a receipt with the reference number.
- After submitting, the applicant can view the application (read-only) and **withdraw** it.
- The declaration and consent texts are versioned in `policies(ADMISSIONS)`, and the version shown is stored with the application.

### 10.3 Review and decision

| From | To | Who | Effect |
| ---- | -- | --- | ------ |
| DRAFT | SUBMITTED | applicant | reference no, receipt email |
| SUBMITTED | UNDER_REVIEW | officer (opening the review, or explicitly) | `review_started_at`, `reviewed_by` |
| UNDER_REVIEW | ADMITTED | officer (`decide`, Idempotency-Key) | `offer_expires_at = decided_at + intake.offer_acceptance_days` (21); offer email + in-app |
| UNDER_REVIEW | REJECTED | officer (`decide`) | rejection email (neutral wording; the internal note is never sent); `purge_after = decided_at + 12 months` |
| ADMITTED | ACCEPTED | applicant (`accept`, before expiry) | §10.4 |
| ADMITTED | LAPSED | cron `admissions.offer-sweep` when `now > offer_expires_at` | lapse email; `purge_after = now + 12 months` |
| LAPSED | ADMITTED | officer (`reopen-offer`, reason) | new `offer_expires_at`; `purge_after` cleared |
| DRAFT, SUBMITTED, UNDER_REVIEW, ADMITTED | WITHDRAWN | applicant | `purge_after = now + 12 months` |

- Every transition writes `application_events` and an audit row (INV-11), with no sensitive answers in either.
- Reminder emails go out 7 days and 2 days before an offer expires.
- An interview, if held, is recorded as a note. There are no interview or waitlist states (owner choice).
- The officer queue is `GET /admissions/applications?intakeId=&status=&programmeId=&q=`. It shows the reference number, name, programme, study mode, submission date and status. The detail view shows every section; section 5 is visible only with `read-sensitive`, which officers and the System Admin both hold.

### 10.4 Acceptance → student (one transaction)

`POST /applications/:id/accept` (applicant, Idempotency-Key):

1. Lock the application `FOR UPDATE`. Require `ADMITTED` and `now ≤ offer_expires_at` (`OFFER_EXPIRED`).
2. **Student record:**
   - If the user has no `students` row, create one, copying **name, title, gender, date of birth, nationality, phone numbers, address, church details and the passport photo** from the application.
   - If they already have one (e.g. a Certificate graduate admitted to the Diploma), update those fields and set the status to `ACTIVE`.
   - **Never copy** spiritual background, marital status or occupation (INV-15).
3. **Matric Number:** lock `matric_sequences(programme, intake year)` and allocate `GLIM/{programme.code}/{YYYY}/{NNNN}` (D-01).
4. Get or create the **cohort** for (programme, intake). Insert the `programme_enrollments` row with:
   - the active curriculum
   - `entry_session_id` = the intake's session
   - `study_mode` from the application
   - `current_level=1`, `status=ACTIVE`
   - `application_id`
5. If the entry session's semester 1 is already `REGISTRATION`/`ACTIVE`, run the open-registration logic (§9.3) for this enrollment inside the same transaction.
6. Ensure the user has a `referral_code`.
7. Set the application to `ACCEPTED` (`accepted_at`), audit, and emit `admissions.application.accepted`. That event triggers a welcome email with the Matric Number and first steps, and a notification to Academic Admins.

Calls into `enrollment`/`academic` go through their public services, using the same `{db, boss}` (§5.3).

### 10.5 Data protection for applications (C-29, INV-15)

- The `spiritual_background` field is returned only to holders of `admissions:application:read-sensitive`, and only on the detail endpoint. It's excluded from list endpoints, notifications, logs, audit metadata and every export except `GET /admissions/applications/export?includeSensitive=true` (System Admin and Admissions Officer only, audited).
- **Retention:** the cron `admissions.purge` (daily) hard-deletes applications whose `purge_after ≤ now` (REJECTED, LAPSED, WITHDRAWN), plus DRAFT applications not edited for 12 months (D-06). It deletes the application row, its events and its passport photo file. The audit log keeps only `{referenceNo, finalStatus}`. `ACCEPTED` applications are kept with the student file under the academic-record retention (§19.3).
- Applicant users with no remaining application and no other role are deactivated by the same sweep.

### 10.6 Referral codes and reports

- Every student, graduate ("alumnus") and staff member gets a personal `referral_code`: 7 characters of uppercase base32 with no ambiguous characters. It's created on acceptance, import or staff creation, and shown on their profile.
- On submit, the code the applicant entered is matched case-insensitively. If it matches, `referrer_user_id` is set. An unmatched code is stored as entered and flagged for the officer; it never blocks submission.
- **Reports** (`admissions:report:read`):
  - `GET /reports/admissions?intakeId=` gives counts by status, programme, study mode, country and `heard_via`.
  - `GET /reports/referrals?intakeId=` gives each referrer with their applications and outcomes.

  Both are available as CSV or JSON.

---

## 11. Class Meetings (hybrid: Room + Google Meet)

### 11.1 `LiveProvider` port

The port lives in `packages/integrations/live-provider` and uses domain-neutral types only (INV-3). Video ingest needs artifact streaming from it, so it's on the port.

```ts
export interface LiveProvider {
  readonly name: "google_meet" | "fake";
  provisionSpace(input: ProvisionInput): Promise<ProvisionedSpace>;           // {spaceRef, joinUrl, meetingCode, dialIn?, hostAccountId}
  syncAccess(input: SyncAccessInput): Promise<SyncAccessResult>;              // co-hosts (lecturers) + members (students)
  getSpaceStatus(ref: ProviderSpaceRef): Promise<ProviderSpaceStatus>;        // {activeConferenceRef?}
  endActiveConference(ref: ProviderSpaceRef): Promise<void>;
  listConferences(ref: ProviderSpaceRef): Promise<ProviderConference[]>;
  listParticipantSessions(conf: ProviderConferenceRef): AsyncIterable<ProviderParticipantSession>;
  listRecordings(conf: ProviderConferenceRef): Promise<ProviderRecording[]>;  // {recordingRef, state, startedAt, endedAt, artifactRef?}
  describeArtifact(ref: ProviderArtifactRef): Promise<ArtifactMetadata>;      // {sizeBytes, md5?, mime, durationMs?, exists}
  openArtifactStream(ref: ProviderArtifactRef, opts?: { rangeStart?: number }): Promise<ArtifactStream>;
  trashArtifact(ref: ProviderArtifactRef): Promise<void>;                     // Drive cleanup (C-16; off by default, D-07)
  parseEvent(envelope: RawProviderEnvelope): ProviderEvent | null;
  health(): Promise<ProviderHealth>;
}
```

The implementations are `GoogleMeetProvider` (`integrations/google`) and `FakeLiveProvider` (in-memory, scriptable). Provider references are opaque strings, persisted as-is.

### 11.2 Host accounts (C-05)

- **Licensing (Business Standard):** licensed users are the host accounts plus the Lecturers. Students are external Gmail accounts.
- **HOST_POOL of 2** Workspace users (`provider_host_accounts`), in a dedicated OU `LMS Hosts` that is excluded from Drive auto-deletion. They're never used by humans for ad-hoc classes.
- `HostSelector.pick(start, end)` chooses the account with the fewest overlapping Class Meetings. The choice is stored and never changes after provisioning.
- Host accounts own the spaces, and therefore **own the recordings in their Drive** until cleanup (C-16).
- The LMS monitors Drive storage hourly (`about`) and alerts at 70% and 85%.
- At GLIM's scale (≤ 5 concurrent meetings × ~35 participants), quotas are far from their limits.
- Lecturers are added as `COHOST` members so they can start, admit, mute, present and record.

### 11.3 Google authentication and scopes

Domain-wide delegation (DWD): a service account impersonates a **host account**.

| Capability | Scope |
|---|---|
| Create/configure spaces, members, end conference | `https://www.googleapis.com/auth/meetings.space.created` |
| Read conference records, participants, recordings | `https://www.googleapis.com/auth/meetings.space.readonly` (drop it if S-04 shows `space.created` suffices) |
| Download recording files from host Drive | `https://www.googleapis.com/auth/drive.meet.readonly` (S-05) |
| Trash ingested recordings (C-16) | `https://www.googleapis.com/auth/drive` (host accounts only; S-10 looks for a narrower scope) |
| Pub/Sub pull | IAM `roles/pubsub.subscriber` for the worker's service account (not DWD) |

- Use `google-auth-library` `JWT({ email, key, scopes, subject: hostEmail })`. Tokens are cached in memory per `(hostEmail, scopeSet)` until 5 minutes before expiry.
- The service-account key is an **App Platform encrypted env var** (`GOOGLE_SA_KEY_JSON_B64`). Rotate it at least every 90 days, and **never log tokens**.

### 11.4 Class Meeting state machine

`class_meetings.state` models **only the conference lifecycle**. Recording and video have their own state machines (§13), and provisioning is tracked in `provider_status`.

| From | To | Trigger | Notes |
| ---- | -- | ------- | ----- |
| SCHEDULED | OPEN | The join window starts (`meeting-tick`), or staff call `/start` | Join authorization computes the window from time and never trusts this flag alone |
| SCHEDULED, OPEN | CANCELLED | Lecturer/admin cancels | Terminal. Frees the Room. The space is left unused. |
| OPEN, SCHEDULED | LIVE | `conference.started` event, or a sync sees `activeConference` | Sets `first_conference_started_at` |
| LIVE | ENDED | The conference ended and there is no active conference | Schedules `class-meeting.finalize` |
| ENDED | LIVE | A new conference starts in the same space while `now ≤ scheduled_end + maxOverrunMinutes` (default 180) and the meeting isn't finalized | Reconnect after a crash or accidental end |
| SCHEDULED, OPEN | NO_SHOW | `now > scheduled_end + joinAfter`, no conference ever started, **and no roll-call marks exist** | Terminal. If roll call was taken but Meet never started (e.g. internet failure in the room), the state goes to ENDED via `/end` or the tick, and attendance is computed from roll call only. |
| LIVE | CANCELLED | **Forbidden** (409 `MEETING_IN_PROGRESS`) | |

Implement this as a pure `ClassMeetingStateMachine.transition(state, event, ctx)` with exhaustive table tests.

**Display state** (computed in the read model, not stored):

| Display | Shown when |
|---|---|
| `CANCELLED` | the meeting is cancelled |
| `FAILED` | `provider_status=ERROR` and the start is ≤ 2 h away or past |
| `LIVE` / `OPEN` / `SCHEDULED` | the matching state |
| `RECORDING_AVAILABLE` | the meeting has ended and a video is `PUBLISHED` |
| `PROCESSING_RECORDING` | the meeting has ended, no video is published yet, and either a recording is in flight or `recording_mode≠OFF` and it's less than 12 h since the end |
| `ENDED` | the meeting has ended and neither of the above applies |

### 11.5 Space configuration, access and the room (C-26)

At provisioning, the space is created from `policies[GOOGLE_MEET]`:
- `accessType: RESTRICTED`
- `entryPointAccess: ALL`
- `moderation: ON`
- `presentRestriction: HOSTS_ONLY`
- `attendanceReportGenerationType: DO_NOT_GENERATE`. Editions without Meet attendance tracking (e.g. Business Standard) refuse this field even to turn reports off ("…is not available to the user"). They make no reports, so the space is then created again without it.
- auto-recording `ON` if `recording_mode=AUTO`
- transcription `OFF`
- smart notes `OFF`

Semantics to design around:
- **Auto-recording starts only when someone with recording privilege joins.** In a hybrid class, the **room laptop joins Meet signed in as the Lecturer**, which starts recording and lets online students see and hear the room. The Lecturer's "Start class" screen says: "Open this on the room computer, signed in as you. Recording starts when you join."
- **Guarantee boundary:** the LMS controls *who is shown the link* and audits every authorization; Google controls *admission*. In `RESTRICTED` mode, only members skip knocking.
- **Members:** Lecturers get `COHOST`. Each `ENROLLED` student gets a role-less member entry using their linked Google email. Students with no linked account are skipped and reported (`STUDENT_NO_GOOGLE_ACCOUNT`), and must knock (C-39).
- **On-campus students are synced as members too**, so they can join online on a day they can't attend in person.
- **Member sync:** about one `members.create` per student per meeting, run asynchronously by `class-meeting.sync-access`. It's debounced, and triggered on provisioning, enrollment add/drop and assignment changes for meetings starting within 14 days. S-03 confirms member limits and no-knock for external members; S-09 confirms anonymous joiners are blocked.
- **Phone dial-in** (low bandwidth): provisioning stores `dial_in` (regional numbers + PIN) when Google provides it. `/join` returns it. Dial-in participants appear as `PHONE` and need manual matching.

### 11.6 Provisioning and join (INV-8)

**Creation** (`POST /course-offerings/:id/class-meetings`, Idempotency-Key):
1. Authorize.
2. Run the conflict checks (§9.5).
3. In **one transaction**:
   - insert `class_meetings` (`state=SCHEDULED`, `provider_status=PENDING`, `policy_snapshot`, `room_id`)
   - insert `meeting_lecturer_slots`
   - `boss.send('class-meeting.provision', {meetingId}, { db: trx, singletonKey: 'meeting:{id}:provision', startAfter: max(now, scheduled_start − provisionLead[default 24 h]) })`
   - write the audit row
4. Commit. The response is immediate; **Google is never called in the request path.**

**`class-meeting.provision` handler** (role `google`):
1. Lock the row and skip it if it's CANCELLED, NO_SHOW or already READY.
2. Set `PROVISIONING`.
3. `HostSelector.pick`, then `rl_acquire(create)`, then `provider.provisionSpace`.
4. In the **same transaction**, persist the space fields, `dial_in` and `provider_status=READY`, and enqueue `class-meeting.sync-access`.

Retries: 6, exponential with jitter. A permanent failure sets `provider_status=ERROR`, adds an ops failure, and notifies the System Admin (and the Lecturer if the start is within 2 h). `POST /class-meetings/:id/reprovision` re-enqueues it.

**Join** (`POST /class-meetings/:id/join`) is **database only**:
1. Load the meeting and run `authorize(meeting:class-meeting:join)`.
2. Reject if the state is `CANCELLED` or `NO_SHOW`.
3. Check the window:
   - students: `[start − 15 min, end + 60 min]`, or any time while `LIVE`
   - staff: `[start − 60 min, end + maxOverrun]`
4. **Students must have a linked Google account**, else `409 GOOGLE_ACCOUNT_REQUIRED` with the link URL.
5. Require `provider_status=READY`, else `503 PROVIDER_NOT_READY` + `Retry-After`. If it's `PENDING` and the start is within 30 minutes, enqueue a priority provision.
6. Insert into `meeting_join_log`.
7. Return:

```json
{ "meetingId": "…", "state": "LIVE", "joinUrl": "https://meet.google.com/abc-mnop-xyz", "role": "STUDENT",
  "window": { "opensAt": "…", "closesAt": "…" }, "room": { "code": "R1", "name": "Main Hall" },
  "dialIn": { "numbers": [{ "region": "NG", "phone": "+234…", "pin": "…" }] }, "lowDataTip": true }
```

The other endpoints:
- `POST /class-meetings/:id/start` (staff): same checks with the staff window. It may open early without a provider call, and enqueues a priority `sync-access` if access has never been synced.
- `POST /class-meetings/:id/end` (staff): enqueues `class-meeting.end`.

### 11.7 Quota-aware Google client

- `GoogleRateLimiter` uses Postgres `rl_acquire`, with buckets set at 80% of the per-user and per-project quotas: create 8/80 per min, write 80/800, read 480/4800. If the wait would exceed `maxWaitMs`, the handler **re-schedules itself** instead of failing.
- **Retry taxonomy** (`withGoogleRetry`):

  | Response | Handling |
  |---|---|
  | 429, 5xx, network error | full-jitter backoff (base 1 s, cap 60 s, ≤ 5 tries), honouring `Retry-After` |
  | 401 | refresh the token once |
  | 403 | **permanent**: `integration_configs.status=DEGRADED` + alert |
  | 404 on a Drive file | `SOURCE_MISSING` |
- **Circuit breaker** per host account: opens after 5 consecutive failures within 30 s, with a half-open probe every 30 s. Its state is shown in `GET /admin/integrations/google/status`.

### 11.8 Events, sync, reconciliation (INV-6)

- **Transport (v2-18):** the worker runs a Pub/Sub **pull** subscriber. For each message: build the envelope, `INSERT INTO provider_events … ON CONFLICT DO NOTHING`, and **ack only after the insert commits**. Events carry **resource names only**.
- **Routing and processing** (`provider-event.process`): resolve the Class Meeting by space id (or by `conferenceRecords.get`). Unroutable events become `IGNORED`; their payload is kept.

| Event | Action |
|---|---|
| `conference.v2.started` | upsert `conference_records` (ACTIVE, dirty); state → LIVE |
| `conference.v2.ended` | `GET` the conference for `endTime`; mark it ENDED; state → ENDED; delayed `class-meeting.finalize` at `ended_at + finalizeDelay` |
| `participant.v2.joined/left` | **only** set `conference_records.dirty=true` |
| `recording.v2.fileGenerated` | enqueue `recording.discover` (same transaction) |
| subscription lifecycle | enqueue `subscription.renew` |

- **`conference.sync`:** `GET` the conference, list participants and their participant sessions, upsert `provider_participant_sessions` (never delete), run matching (§12.4), and clear `dirty`. It runs at conference end, again 30 minutes later, and during finalize.
- **Subscriptions:** one per **host account** (user target). Renew them before `expires_at − max(24h, 50% of lifetime)`. S-04 confirms the details.
- **Cron:** `meeting-tick` (1 min), `meeting-reconciliation` (3 min), `recording-reconciliation` (10 min), `subscription-renewal` (15 min).

### 11.9 Reschedule, cancel, recurrence

- **Reschedule** (`PATCH /class-meetings/:id`, `If-Match`, states SCHEDULED/OPEN): re-runs the Lecturer and Room conflict checks, keeps the provisioned space, and notifies enrollees. Past, LIVE and ENDED meetings are immutable except for their title and description.
- **Cancel** (`POST /class-meetings/:id/cancel`, reason required): allowed in SCHEDULED/OPEN only. It notifies enrollees and makes no Google call.
- **Series** (`POST /course-offerings/:id/class-meeting-series`, Idempotency-Key):
  - stores `rrule`, `timezone` (the institution zone), `start_time`, `duration` and an optional `room_id`
  - expands occurrences with luxon and creates rows idempotently by `(series_id, occurrence_date)`
  - has an 8-week horizon, extended daily
  - runs the room/lecturer conflict check per occurrence; any conflict rejects the whole request and lists the conflicting dates
  - edit scopes: `THIS_ONLY` and `ALL_FUTURE`

### 11.10 Failure behaviour

| Failure | Behaviour |
| ------- | --------- |
| Google API down at provisioning | Retry/backoff. The meeting shows "link being prepared". Ops failure if the start is within 2 h. |
| Google API down at join time | Join still works if READY (it's DB-only); otherwise 503 with a retry hint |
| Room internet down | The Lecturer still takes roll call (it's offline-tolerant, §18.4). Online students can't attend; Meet attendance is empty and the meeting ends via `/end` or the tick. |
| Events delayed/lost | Reconciliation converges within ≤ 5 min. Attendance sync at end/finalize doesn't depend on events. |
| Worker restart mid-job (deploy) | The job is idempotent and redelivered |
| Host account suspended | 403 ⇒ host `DISABLED`, integration `DEGRADED`, alert; `HostSelector` skips it |

---

## 12. Attendance

### 12.1 Pipeline

There are two input streams:
- **online evidence:** `provider_participant_sessions`, plus matching
- **in-room evidence:** `roll_call_marks`

Both go into `computeAttendance()` (pure), which writes `attendance_records` (a derived projection with audited overrides). Raw rows are never deleted. Only `matched_user_id`/`match_method`/`match_status` change, through manual resolution, which is audited.

### 12.2 Policy (`policies(ATTENDANCE)`; Zod schema in `contracts`)

```json
{
  "policyVersion": 1,
  "basis": "ACTUAL_CAPPED",          // SCHEDULED | ACTUAL | ACTUAL_CAPPED
  "presentThresholdBp": 7500,
  "partialThresholdBp": 2500,
  "lateGraceMinutes": 15,
  "windowPaddingMinutes": { "before": 0, "after": 0 },
  "minSegmentSeconds": 0,
  "shortConferenceReviewBp": 3000,
  "unmatchedReviewMinutes": 10,
  "finalizeDelayMinutes": 10,
  "lockAfterDays": 7,
  "rollCallOpensBeforeMinutes": 15
}
```

Per-offering overrides go through `policies(scope_type='COURSE_OFFERING')`. The version used is stored on each record.

### 12.3 Roll call (in-room; C-26)

- From `scheduled_start − rollCallOpensBeforeMinutes` until `finalized_at + lockAfterDays`, an assigned Lecturer (`attendance:roll-call:mark`) opens `/teach/meetings/:id/roll-call`. It lists the offering's `ENROLLED` students, with **On-campus students first**, each with a photo.
- The Lecturer ticks each student **Present** (optionally **Late**) or **Absent**. "Mark all on-campus present" is a bulk action.
- `PUT /class-meetings/:id/roll-call` sends `{marks:[{studentId, present, late}]}`, a batch upsert with `If-Match` on the meeting's roll-call version. It's audited, and enqueues `attendance.recompute`.
- The screen works on a phone. Marks are queued locally and retried on a flaky connection, and the UI shows "Saved / Will retry".
- **Roll call is not required.** A meeting without a Room, or with no marks, is computed from Meet evidence alone.

### 12.4 Participant → student matching ladder (S-01 gates this)

The strategies are pluggable and evaluated in order for each `SIGNED_IN` participant session:

1. **`GOOGLE_ID`:** `identities(provider='google', subject = provider_user_id)` ⇒ user. This is enabled only if S-01 proves the OIDC `sub` equals the Meet `signedinUser.user` id for external accounts.
2. **`MEMBER_EMAIL`:** an identifier exposed by Meet equals a student's linked Google email (if S-01 shows Meet exposes one).
3. **`NAME_ASSISTED`:** review only. A normalised `displayName` equals exactly one enrolled student's `identities.metadata.googleName` ⇒ `match_status=SUGGESTED`. It is never counted until a staff member confirms it.
4. **`MANUAL`:** staff with `attendance:participant:resolve` link the participant session, optionally persisting the Google id for future meetings. This is audited and triggers a recompute.

Also:
- `ANONYMOUS` and `PHONE` participants can only be matched manually.
- A student's several Google accounts are unioned.
- Matched users who aren't enrolled students of the offering, including the **Lecturer's room laptop**, are kept as evidence but excluded from student attendance.
- An unresolved overlap longer than `unmatchedReviewMinutes` sets `attendance_state=REVIEW_REQUIRED` and creates a Lecturer task.

### 12.5 Algorithm — `computeAttendance(input): AttendanceResult[]` (pure; `modules/attendance/domain`)

**Inputs:**
- the meeting `{scheduledStart, scheduledEnd}`
- conferences `[{start, end|null}]`
- `capAt`
- the policy
- `enrolledStudentIds` (ENROLLED at any instant of the window)
- per student: online intervals `[{start, end|null}]` from matched participant sessions, and an optional roll-call mark `{present, late}`

**Steps:**
1. **Window:** `W = [scheduledStart − pad.before, scheduledEnd + pad.after]`.
2. **Conference union:** `C' = (∪ conferences) ∩ W`. Open ends are capped at `capAt` or the conference end.
3. `scheduledSeconds = |W|` and `actualSeconds = |C'|`. The **denominator** is:
   - `SCHEDULED` → `scheduledSeconds`
   - `ACTUAL` → `actualSeconds`
   - `ACTUAL_CAPPED` → `min(scheduledSeconds, actualSeconds)`
4. **Short conference:** if `actualSeconds × 10000 < shortConferenceReviewBp × scheduledSeconds` **and any student has no roll-call mark**, flag `REVIEW_REQUIRED`.
5. **Online part, per student:**
   - clip intervals to `C'` and drop segments shorter than `minSegmentSeconds`
   - **merge overlaps**; `attendedSeconds = |union ∩ C'|`
   - `ratioBp = denominator > 0 ? min(10000, floor(attendedSeconds × 10000 / denominator)) : 0`
   - `PRESENT` if ≥ present threshold, `PARTIAL` if ≥ partial threshold, else `ABSENT`
   - `late` = the first clipped segment starts after `scheduledStart + lateGrace`
6. **Combine with roll call (C-26):**
   - roll call `present=true` ⇒ `computed_status=PRESENT`, `attendance_mode=IN_PERSON`, `ratio_bp=10000`, `late` from the mark (online evidence is kept in the record's minutes for information)
   - otherwise, any online evidence ⇒ the online status, with `attendance_mode=ONLINE`
   - otherwise ⇒ `ABSENT`, `attendance_mode=NONE`
   - When the denominator is 0 (no conference), only roll call can produce PRESENT.
7. Output is sorted by `studentId`.

**Persistence:** under `pg_advisory_xact_lock(hashtext(meetingId))`, UPSERT on `(class_meeting_id, student_id)`. Write **only the computed fields**, and only if they changed (`calc_version++`). **Never write `status` (a virtual column) or the override fields during recompute.**

### 12.6 Finalization (`class-meeting.finalize`)

- **Preconditions:** the conference ended at least `finalizeDelay` ago, and `conference.sync` ran after the end. For a meeting ended manually with no conference, the preconditions are immediate.
- **Steps:**
  1. Run a final sync.
  2. Compute attendance.
  3. Set `REVIEW_REQUIRED` and notify the Lecturer if any unresolved overlap exceeds `unmatchedReviewMinutes` or the short-conference flag is set. Otherwise set `FINAL`.
  4. Set `finalized_at` and emit `attendance.finalized`.
- Later evidence and roll-call edits trigger a recompute until `finalized_at + lockAfterDays`. After that, only overrides change records.

### 12.7 Overrides and reports

- `POST /class-meetings/:id/attendance/:studentId/override` `{status, reason ≥ 5 chars}` writes the override, an audit row and an event in one transaction. `DELETE` clears it (audited).
- `GET /class-meetings/:id/attendance` returns the computed and effective status, mode, ratio, minutes, late flag, join count and override metadata.
- `GET /class-meetings/:id/participants` returns the raw timeline. `POST /class-meetings/:id/participants/:pid/match` resolves a participant.
- `GET /reports/attendance?offeringId=&format=json|csv` returns a student × meeting matrix, with the mode per cell and the policy version in the header.

---

## 13. Recordings and video (ADR-0003: YouTube unlisted)

Recordings are hosted on **GLIM's own YouTube channel as _unlisted_ videos** (C-43). The app holds each video's metadata, decides who sees the embed, and tracks resume progress. YouTube stores, transcodes and delivers the video at no cost.

**Accepted exposure (ADR-0003):** an unlisted video can be watched by **anyone who has its link**. The app shows the embed only to entitled viewers, but it can't stop a viewer from copying the link, and it can't revoke a link that has been shared. Access rules in this section (e.g. "until the programme ends") control **what the app shows**, not what YouTube serves.

The work is delivered in two stages:
- **v1 (link-based, no Google API):** staff upload to the channel in YouTube Studio and paste the link into the app.
- **Google integration slice:** the worker uploads Meet recordings to YouTube automatically through the YouTube Data API.

### 13.1 `VideoHost` port

The port lives in `packages/integrations/video-host`, with domain-neutral types only. There are three adapters:
- `YouTubeLinkHost` (v1): validates and checks links through YouTube's public **oEmbed** endpoint (no API key, no Google account).
- `YouTubeApiHost` (integration slice): the YouTube Data API v3, authorised as the channel.
- `FakeVideoHost`: for development and tests.

```ts
export interface VideoHost {
  readonly name: "youtube_link" | "youtube_api" | "fake";
  parseUrl(url: string): { videoId: string } | null;                 // youtube.com/watch?v=, youtu.be/, /live/, /embed/; rejects playlists/shorts
  checkVideo(videoId: string): Promise<{ status: "AVAILABLE" | "PRIVATE_OR_RESTRICTED" | "NOT_FOUND";
    title?: string; channelUrl?: string; thumbnailUrl?: string }>;    // v1: oEmbed (works for public + unlisted)
  embed(videoId: string, opts: { startSeconds?: number }): { embedUrl: string; thumbnailUrl: string };   // pure; youtube-nocookie.com
  // integration slice only (YouTubeApiHost):
  upload?(input: { title: string; description: string; body: Readable; sizeBytes: number }): Promise<{ videoId: string }>;  // privacyStatus=unlisted
  getProcessing?(videoId: string): Promise<{ state: "PROCESSING" | "SUCCEEDED" | "FAILED"; durationMs?: number }>;
  updateMetadata?(videoId: string, input: { title: string; description?: string }): Promise<void>;
  deleteVideo?(videoId: string): Promise<void>;
}
```

S-Y1 (Appendix B) verifies the oEmbed behaviour for unlisted, private, deleted and embedding-disabled videos, the channel identity returned, and IFrame-player behaviour on target phones.

### 13.2 State

- **Video (`videos.status`):** `PROCESSING` (automatic upload in progress; integration slice only) → `UNPUBLISHED ⇄ PUBLISHED`. The other states are:
  - `UNAVAILABLE`: YouTube no longer serves it (made private, deleted, or removed after a copyright or policy action).
  - `FAILED`: an automatic upload failed.
  - `DELETED`: removed from the app, with a 7-day undo.
- **Recording (`recordings.status`, integration slice):** `DISCOVERED → UPLOADING → PROCESSING → READY`, plus `FAILED` and `SOURCE_MISSING`.

### 13.3 Adding videos

**v1, link-based** (`origin='LINK'`):
1. A Lecturer (own offerings) or the System Admin uploads the video in **YouTube Studio** to GLIM's channel. The channel defaults are: visibility **Unlisted**, audience "not made for kids", comments off (Appendix A.4).
2. They choose **Add recording** in the app and paste the URL, optionally linking it to a Class Meeting.
3. The app runs `parseUrl`, then `checkVideo`, and requires all of:
   - `AVAILABLE` (`YOUTUBE_VIDEO_PRIVATE` / `YOUTUBE_VIDEO_NOT_FOUND` otherwise)
   - a `channelUrl` in `settings.youtube_channel_urls` (`YOUTUBE_CHANNEL_NOT_ALLOWED` otherwise). This stops links to arbitrary or personal channels.
4. The title is prefilled from YouTube and editable in the app. The video is created `UNPUBLISHED`, or `PUBLISHED` if policy `autoPublish` is true (the default).

The app can't tell unlisted from public through oEmbed. The channel's default visibility and the runbook keep uploads unlisted, and S-Y1 confirms the behaviour.

**Integration slice, automatic** (`origin='RECORDING'`):
1. `recording.discover` (TRD §11.8 events) creates the `recordings` row and a `PROCESSING` video.
2. `recording.ingest` streams the Meet recording from Drive with `openArtifactStream` into `YouTubeApiHost.upload` (resumable upload, `privacyStatus=unlisted`, `selfDeclaredMadeForKids=false`).
3. `video.youtube-processing-sync` polls until processing `SUCCEEDED`.
4. It then checks `|YouTube duration − Drive duration| ≤ max(2 s, 2 %)` **(INV-9)**, stores `youtube_video_id` and publishes per policy.
5. The API project must pass the **YouTube API Services audit** first: uploads from unaudited projects are locked to private. The upload quota must cover ~5 uploads a day (S-Y1).

**Availability check** (`video.availability-check`, daily, and `POST /videos/:id/recheck`):
- calls `checkVideo` for every `PUBLISHED`/`UNPUBLISHED` video
- `PRIVATE_OR_RESTRICTED` or `NOT_FOUND` ⇒ `UNAVAILABLE` (hidden from students), an ops failure, and a notification to whoever added it and to the System Admin
- a recheck that succeeds restores the previous status

**Drive originals:** in the integration slice, Drive cleanup (C-16) is **not recommended** with YouTube hosting. YouTube can take a video down (e.g. a copyright claim on worship music), and the Drive file is then the only original (D-07). Until the owner decides, `DRIVE_CLEANUP_MODE` defaults to `NONE`.

### 13.4 Playback (low bandwidth, C-07)

`GET /videos/:id/play` (p95 < 300 ms) authorizes with a single query:
- the video is `PUBLISHED` and `publish_after ≤ now`
- the visibility check passes
- an `EXISTS` against `v_offering_access` (students `ENROLLED` or `COMPLETED`, §13.5; staff with an active assignment), **or** a staff role with `video:asset:read`

A denial returns 404. On success it returns, with `Cache-Control: no-store`:

```json
{ "videoId": "…", "title": "…", "youtubeVideoId": "dQw4w9WgXcQ",
  "embedUrl": "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&enablejsapi=1&start=123",
  "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg", "durationMs": 3600000, "resumeMs": 123000 }
```

**Player rules:**
- **Click-to-load facade:** the page first shows only the thumbnail (~10 KB) and a play button. The YouTube IFrame API and player load **only when the student taps play**, because the player itself is a large download (measured in S-11).
- **Privacy-enhanced mode:** use `youtube-nocookie.com`, with `rel=0` (end-screen suggestions limited to GLIM's channel) and `playsinline=1`.
- **Quality:** YouTube adapts the quality automatically, and the app can't force a starting quality. A **data-saver tip** under the player says: "On mobile data, tap ⚙ → Quality → 144p (≈ 40 MB/hour) or 240p (≈ 70 MB/hour)." Data-saver mode shows this tip first.
- **No audio-only option in v1** (D-09). YouTube's embedded player has none; 144p is the lowest-data option. The integration slice may add an optional Spaces audio file (~18 MB/hour) extracted from the Drive original.
- **Resume:** start at `resumeMs` (the `start` parameter, then `seekTo`). While playing, read `getCurrentTime()` every 15 s, and on pause and `pagehide` (with `keepalive`), and send it to `PATCH /videos/:id/progress {positionMs, durationMs, seq}`. The server:
  - upserts the progress and clamps it to the duration
  - keeps `max_position_ms`
  - sets `completed` at ≥ 90%
  - rate-limits to one write per 5 s
  - ignores a stale `seq`
  - sets `videos.duration_ms` from the first report if it was unknown
- **No autoplay, and no prefetch** of other videos.

### 13.5 Who the app shows recordings to (C-25)

- **Students:** recordings of offerings where their course enrollment is `ENROLLED` or `COMPLETED`, **while the programme enrollment it belongs to is `ACTIVE`** and the student is `ACTIVE`. Graduating or withdrawing removes the recordings from the app; **a link the student already copied keeps working** (accepted exposure).
- **Lecturers:** recordings for their active assignments, with no time limit.
- **Academic Admin and System Admin:** all recordings.
- **There is no time-based purge** (C-24).

### 13.6 Video management (C-24, D-05)

| Action | Who | Behaviour |
| ------ | --- | --------- |
| Add (upload) | System Admin; Lecturer (own offerings) | Upload to the channel in YouTube Studio (unlisted), then **Add recording** with the link (§13.3) |
| Edit title, description, order; publish/unpublish; schedule `publish_after` | System Admin; Lecturer (own offerings) | App-side metadata. The YouTube title is unchanged in v1; the integration slice syncs it with `updateMetadata`. |
| Replace | System Admin | `PUT /videos/:id/youtube-link` with a new link: the same checks, then swap in one transaction. Progress resets if the duration differs by > 5%. The old YouTube video is left alone unless deleted in Studio. |
| Download original | System Admin | Not an app function. The app links to the video's **YouTube Studio** page (`studio.youtube.com/video/{id}/edit`), where channel owners/managers can download it. The Drive original also stays available (§13.3). |
| Delete | System Admin | `DELETED` immediately (hidden) with `delete_after = now + 7 d`; `POST /videos/:id/restore` works within the window. The app then **reminds the System Admin to delete it in YouTube Studio** (v1) or deletes it through the API (integration slice). Audited. |
| Recheck availability | System Admin; Lecturer (own offerings) | `POST /videos/:id/recheck` |
| Retry ingest | System Admin (integration slice) | Re-enqueues `recording.ingest` from `FAILED` |

The admin screen `/admin/videos` lists every video, with filters by offering, status and origin. It shows unavailable videos first, with Studio links.

### 13.7 Cost

YouTube hosting and delivery cost **$0**, kept indefinitely. The trade-offs accepted for that price are listed in ADR-0003: the link exposure, possible ads, YouTube's control over takedowns, no audio-only option, and the API audit for automatic uploads.

### 13.8 Failure behaviour

| Failure | Behaviour |
| ------- | --------- |
| Link invalid, private, deleted or from another channel | Rejected when added, with a specific error code |
| Video later made private, deleted or taken down | Daily check ⇒ `UNAVAILABLE`, hidden from students, ops failure, and notifications. Restore from the Drive original or a re-upload, then **Replace**. |
| YouTube unreachable from the server (oEmbed) | Adding a link fails with `VIDEO_CHECK_UNAVAILABLE` (retry later); the daily check skips and retries; playback is unaffected (the browser loads YouTube directly) |
| YouTube blocked or slow on a student's network | Playback fails in the browser. The player shows "Can't reach YouTube — try another network or Wi-Fi". (No fallback host in v1.) |
| Automatic upload failure (integration slice) | Retry ≤ 5 with backoff, then `FAILED` + ops failure; Drive original kept |


---

## 14. Learning, assessment, results, awards and transcripts

### 14.1 Course space, materials, announcements, files

- Each offering has a learner space with: overview, schedule (in the viewer's timezone, with the Room), lecturers, materials, Class Meetings, recordings, assignments, quizzes and exams, released grades, and announcements.
- **Materials:** FILE/LINK/TEXT, `publish_at`, `section_label`. Markdown is **sanitized** with an allow-list.
- **Files:** the upload flow is:
  1. `POST /files/uploads {name, mime, sizeBytes, purpose}` returns a presigned **PUT/multipart URL to Spaces**. There's a MIME allow-list and per-purpose caps: materials 100 MB, submissions 20 MB, passport photo 2 MB, import 10 MB.
  2. `POST /files/:id/complete` (HEAD verifies size).
  3. `GET /files/:id/download` (authorize, then a **302 to a 5-minute presigned GET** with `Content-Disposition: attachment`).

  Low bandwidth: client-side image downscaling, and resumable multipart above 8 MB. Virus scanning is a COULD.

### 14.2 Assessments, exams and gradebook (C-34)

- **An assessment is a gradebook column** (`max_score`, `weight` in percent). Creating an assignment or quiz creates its assessment atomically.
- **Assignments:**
  - due date and optional `cutoff_at`
  - `late_policy`; attempts ≤ 10; file/text submissions
  - the late flag is computed on the server, and penalties are *suggested* to the grader
- **Quizzes:**
  - a question bank per **course**
  - starting an attempt **freezes** the question content
  - a server-enforced timer; autosave via `PATCH /quiz-attempts/:id` (idempotent by `seq`); idempotent submit
  - `quiz.expire` auto-submits at `deadline_at + 30 s`
  - auto-grading for MCQ/TF/short text; essays are graded manually
- **Exams (hybrid):** an `EXAM` assessment has two score paths into the **same** column:
  - **On-campus students** sit the paper exam in the Room. The Lecturer enters scores as **manual grades** (`source='MANUAL'`), individually or by CSV (`POST /course-offerings/:id/grades/import`).
  - **Online students** take a timed online exam: a `quizzes` row backing the EXAM assessment, with `eligible_study_mode='ONLINE'`. Their attempt score is scaled to `max_score` and written as `source='QUIZ'`.
  - If both exist for a student, the Lecturer chooses; changing the source requires a `reason` (audited).
  - Eligibility follows the student's **Study Mode**. The Lecturer can make individual exceptions (e.g. an On-campus student who must sit online) by granting an attempt.
- **Grades:**
  - `PUT /assessments/:id/grades/:studentId {score, feedbackMd}` with `If-Match`.
  - Every change writes `grade_changes` + `audit_logs` in the same transaction.
  - `POST /assessments/:id/release` moves grades from `DRAFT` to `RELEASED`. Students see only released grades.
- **Weights:** at finalization, the weights of non-excused assessments must total exactly 100.00 (`WEIGHTS_NOT_100`).

### 14.3 Course result finalization

`POST /course-offerings/:id/results/finalize` (PRIMARY Lecturer or Academic Admin; Idempotency-Key):

- It computes the final percentage for every `ENROLLED/COMPLETED` student, upserts `course_results` as `FINALIZED`, and locks the gradebook (`GRADEBOOK_LOCKED`).
- **Included:** `PUBLISHED/CLOSED` assessments. A missing grade counts as **0** once the assessment is `CLOSED` (`missingGradeAsZero`, default true). `EXCUSED` grades are removed and the remaining weights renormalised.
- **Exact arithmetic:** `final_pct_x100 = roundHalfUp( Σ score_x100 × weight_x100 / max_x100 × 10000 / Σ weight_x100 )`. `roundBeforeBanding` ∈ `NONE | INTEGER` (default `INTEGER`).
- **Frozen at finalization:**
  - the scheme
  - `credits_x10` (the curriculum override, else the course credits)
  - letter and points
  - `quality_points_x1000 = credits_x10 × points_x100`
  - `passed`
  - `counts_in_gpa`
  - `result_kind` (`AUDIT` ⇒ not counted)
  - `programme_enrollment_id` and `semester_id`
- `attempt_no` = the number of earlier results for the same (student, course) + 1.
- **Reopen** (Registrar/System Admin, `reason`):
  - writes `course_result_revisions` and sets the status back to `DRAFT`
  - moves dependent `semester_results` back to `DRAFT`
  - marks issued transcripts that include the result `SUPERSEDED`
  - notifies the student

### 14.4 Grading scheme, GPA arithmetic and award classes (C-11, C-31)

- **Letter bands (NUC 5-point, every course):** A 70–100 ⇒ 5.00 · B 60–69 ⇒ 4.00 · C 50–59 ⇒ 3.00 · D 45–49 ⇒ 2.00 · E 40–44 ⇒ 1.00 · F 0–39 ⇒ 0.00. The pass mark is 40.
- **Award classes (final CGPA)**, seeded as two schemes, `GLIM Certificate` and `GLIM Diploma`, which are identical at launch and can diverge per programme:

  | Class | CGPA |
  |---|---|
  | **Distinction** | 4.50–5.00 |
  | **Credit** | 3.00–4.49 |
  | **Pass** | 1.00–2.99 |
  | no award | below 1.00 |

  The repeat policy is **BEST**, and good standing is CGPA ≥ 1.00 (D-02).
- A scheme becomes **immutable once used** (`locked_at`). Edits create a new scheme row.
- **Semester GPA:** `gpa_x100 = roundHalfUp( Σ quality_points_x1000 / Σ credits_x10 )` over results where `result_kind='GRADED' AND counts_in_gpa`, with `roundHalfUp(n, d) = floor((2n + d) / (2d))`.
- **CGPA:** over the programme enrollment's results up to and including the semester, applying the **repeat policy**:
  - `KEEP_ALL`: every attempt counts
  - `REPLACE_LATEST`: only the latest attempt per course counts
  - `BEST`: only the highest-points attempt counts

  Earlier attempts stay visible on transcripts, marked "repeated". Historic semester GPAs are **never rewritten**.
- **CGPA belongs to a programme enrollment.** A student's Certificate results don't count toward their Diploma CGPA, because the programmes are separate (C-30).
- **Credits earned:** `Σ credits_x10` of counting results with `passed=true`, plus `EXEMPT` credits. `INCOMPLETE`/`WITHDRAWN` results earn nothing.
- **Standing:** `GOOD` if CGPA ≥ good standing; else `PROBATION` if a probation band is configured and met; else `WITHDRAW_REQUIRED`. With no counting credits, `UNKNOWN`. Standing is advisory only.
- These are implemented as pure functions in `modules/results/domain`, with property tests and the Appendix C vectors.

### 14.5 Semester results workflow

1. **Compute** (`results.compute-semester`, run on `academic.semester.closed` and on demand) upserts `semester_results` (`DRAFT`). It's idempotent.
2. **Approve** (Registrar; Idempotency-Key) runs in bulk by programme, cohort or semester. It sets `semester_results` and its course results to `APPROVED`, and is audited.
3. **Release (C-11, `ON_FINALIZE`):**
   - Students see each **course result** as soon as the Lecturer finalizes it.
   - Semester GPA/CGPA are labelled **Provisional** until the Registrar approves and **publishes** them.
   - Publishing is required for official transcripts and awards.
4. Changes after publication follow §14.3 *Reopen*.

The broadsheet export is `GET /reports/results?semesterId=&programmeId=&format=csv|json`.

### 14.6 Awards

`POST /programme-enrollments/:id/award/propose` computes:
- the final CGPA
- credits earned against the requirement: all `COMPULSORY` placements earned, plus `curricula.min_elective_credits`
- the **award class** from the programme's scheme

The Registrar then **confirms** (`results:award:confirm`). Confirmation sets:
- `awards.status='CONFERRED'`, `awarded_on`, and `certificate_no = GLIM/{CERT|DIP}/AWD/{YYYY}/{NNNN}`
- the programme enrollment to `COMPLETED`
- the student to `GRADUATED`, unless they have another ACTIVE programme enrollment

The student keeps a `referral_code`, as an alumnus. Missing requirements come back as a checklist (`REQUIREMENTS_NOT_MET`); they don't block the *proposal*. A CGPA below `min_award_cgpa_x100` ⇒ `NO_AWARD` (the Registrar is informed).

### 14.7 Transcripts (tamper-evident, verifiable; C-12)

- **Request:** a student creates `transcript_requests`. An OFFICIAL request needs a purpose and recipient. UNOFFICIAL requests are auto-issued (policy, default true) and rate-limited to 5 a day. OFFICIAL requests need Registrar approval.
- **Issue** (Registrar; Idempotency-Key), in one transaction:
  1. Build the **snapshot JSON**: institution, programme, student legal name + **Matric Number**, per-semester course lines, GPA/CGPA/standing, totals, award + award class if conferred, the grading legend and award-class table, and `as_of`.
  2. Canonicalise it and compute `snapshot_sha256`.
  3. Allocate `serial_no = GLIM/TR/{YYYY}/{NNNNN}` and a 16-character base32 `verification_code`.
  4. Insert `transcripts` and enqueue `transcript.generate`.

  OFFICIAL transcripts include only `APPROVED/PUBLISHED` semesters (`TRANSCRIPT_NOT_ISSUABLE` otherwise). UNOFFICIAL transcripts include `FINALIZED` results and print *Provisional* beside unapproved semesters (C-39).
- **PDF** (`@react-pdf/renderer`): rendered **from the snapshot only**.
  - A4, with a header and footer on every page and "page n of N"
  - embedded Unicode fonts (test Yoruba/Igbo tonal marks)
  - a QR code to `https://<app>/verify/<code>`, plus the serial and a short hash in the footer
  - UNOFFICIAL carries a watermark

  The PDF is stored via `files` in Spaces. Integrity is anchored on `snapshot_sha256`.
- **Verify (public):** `GET /api/v1/public/transcripts/:code` (rate-limited) returns `{valid, status, issuedAt, institutionName, programmeName, studentInitials, asOf, snapshotSha256}`. `/verify/:code` displays it.
- **Revoke/supersede:** revoking (with a reason, audited) sets `REVOKED`. A reopen sets `SUPERSEDED` automatically. A re-issue gets a new serial.
- **Delivery:** the student downloads it. The Registrar may email the PDF to the recipient through SendGrid (attachment ≤ 5 MB, or an authenticated expiring link).

---

## 15. Notifications, imports, admin operations

### 15.1 Notifications

- **Channels:** in-app (`notifications`) and email (`Mailer` port → **SendGrid** API). No SMS or WhatsApp in v1 (C-37); WhatsApp numbers are stored for later.
- **Email by default** goes only to **critical** kinds:
  - invite, password reset
  - application receipt, decision, offer reminder, offer lapse, acceptance welcome (with Matric Number)
  - Class Meeting cancelled or rescheduled
  - results published
  - transcript issued or revoked
  - ops alerts to the System Admin

  Everything else (new recording, announcement, reminders) is in-app plus a **daily digest email** (`notify.digest`, 06:00 Lagos). Users can turn kinds on or off per user.
- **Timezone:** emails render times in the recipient's timezone, with Lagos time alongside.
- **Reminders:** in-app, 15 minutes before a Class Meeting.
- **Delivery:** the `notify.send` queue (retry 5, backoff). The unique `(user_id, dedupe_key)` prevents duplicates.
- **Bounces:** SendGrid **signed Event Webhook** → `POST /api/v1/integrations/sendgrid/events` (verify the ECDSA signature, then insert into the inbox). A `bounce`, `dropped` or `spamreport` event sets `users.email_status`, and the system stops emailing that address (`SUPPRESSED`).
- **Content:** plain text plus minimal HTML (< 20 KB, no remote images); deep links into the SPA. No non-critical emails 21:00–06:00 in the recipient's timezone.

### 15.2 Imports (onboarding existing GLIM data; D-04)

`POST /imports {kind, fileId, dryRun}` (Idempotency-Key) starts an `import.run` job. It streams the CSV from Spaces, validates every row with Zod, and works in batches of 200 inside transactions.

- **Kinds:**

  | Kind | Contents | Notes |
  |---|---|---|
  | `STUDENTS` | user + student + programme enrollment, with an existing Matric Number, Study Mode and Level | creates an invite |
  | `LECTURERS` | | |
  | `COURSE_ENROLLMENTS` | | |
  | `COURSE_RESULTS` | legacy results: Matric Number, course code, semester code, credits, percentage or letter | creates `course_results(source='IMPORT', status='APPROVED')`; requires the historical sessions/semesters to exist (create them `CLOSED`) |

  Templates are served from `/imports/templates/:kind.csv`.
- A **dry run** is the default. The commit run requires the file hash to be unchanged (`IMPORT_FILE_CHANGED`).
- **Idempotent upsert** by natural key: `email`, `matric_number`, `staff_code`, `(matric_number, offering)`, `(matric_number, course code, semester code)`. Row-level errors go to an error CSV, and runs are resumable by row offset.
- After a `COURSE_RESULTS` import, `results.compute-semester` is enqueued for the affected enrollments.

### 15.3 Admin operations (System Admin)

- `GET /admin/ops/failures` gives a unified view over `v_ops_failures`.
- `POST /admin/ops/replay/:kind/:id` replays one of `provider-event`, `recording`, `video`, `meeting-provision` or `job` (dead letter). Audited.
- `GET /admin/integrations/google/status` (+ `POST …/test`) shows, per host account:
  - token mint, `spaces.get` and Drive `about`
  - subscription state
  - circuit-breaker state
  - the DWD scope diff (granted vs required)
- `GET /admin/integrations/youtube/status` (+ test) checks that oEmbed is reachable and that each configured channel URL resolves; in the integration slice it also checks the channel OAuth connection and upload quota.
- The **pg-boss dashboard** is at `/admin/jobs` (System Admin).
- The **Google integration wizard** shows the service-account Client ID and the exact scope list for the Admin Console (Appendix A), then runs the test.
- **Settings** UI: institution name, timezone, staff email domains, Statement of Faith URL, and the policies.

---

## 16. API catalogue

Base `/api/v1`. Auth is the session cookie plus the CSRF header unless noted. **Idem** = `Idempotency-Key` required. All list endpoints are cursor-paginated, and every endpoint has deny-path tests.

| Area | Method & path | Permission | Idem |
| ---- | ------------- | ---------- | ---- |
| Auth | `POST /auth/login` · `POST /auth/logout` · `GET /auth/google/start?intent=signin\|apply\|link` · `GET /auth/google/callback` | public/own | – |
| Auth | `POST /auth/password/forgot` · `POST /auth/password/reset` · `POST /auth/invite/accept` | public | – |
| Me | `GET /me` · `PATCH /me` (incl. `timezone`) · `GET /me/schedule` · `GET /me/enrollments` · `GET /me/grades` · `GET /me/results` · `GET /me/notifications` · `POST /me/notifications/:id/read` · `GET /me/data-export` | own | – |
| Users | `GET/POST /users` · `GET/PATCH /users/:id` · `POST /users/:id/deactivate` · `POST /users/:id/roles` · `DELETE /users/:id/roles/:assignmentId` | `identity:user:*`, `identity:role:manage` | – |
| Settings | `GET/PATCH /settings` · `GET/PUT /policies/:type` | `identity:policy:manage` | – |
| Imports | `POST /imports` · `GET /imports/:id` · `GET /imports/templates/:kind.csv` | `identity:import:run` | ✔ |
| Admissions (public) | `GET /public/intakes/current` (programmes, dates, Statement of Faith URL) | none | – |
| Admissions (applicant) | `POST /applications` (start draft) · `GET /applications/mine` · `GET/PATCH /applications/:id` (draft autosave, `If-Match`) · `POST /applications/:id/submit` · `POST /applications/:id/withdraw` · `POST /applications/:id/accept` | `admissions:application:own-*` | ✔ (submit, accept) |
| Admissions (staff) | `GET/POST /intakes` · `PATCH /intakes/:id` · `GET /admissions/applications` · `GET /admissions/applications/:id` · `POST /admissions/applications/:id/review` · `POST …/decide {decision, note}` · `POST …/reopen-offer` · `GET /admissions/applications/export` | `admissions:*` | ✔ (decide) |
| Admissions reports | `GET /reports/admissions` · `GET /reports/referrals` | `admissions:report:read` | – |
| Academic | `GET/POST /programmes` · `PATCH /programmes/:id` · `GET/POST /courses` · `PATCH /courses/:id` · `GET/POST /rooms` · `PATCH /rooms/:id` | `academic:structure:*` | – |
| Academic | `GET/POST /curricula` · `POST /curricula/:id/activate` · `POST /curricula/:id/clone` · `PUT /curricula/:id/courses` | `academic:structure:manage` | – |
| Calendar | `GET/POST /academic-sessions` · `POST /academic-sessions/:id/activate` · `POST /academic-sessions/:id/close` · `GET /semesters?sessionId=` · `POST /semesters` · `PATCH /semesters/:id` · `POST /semesters/:id/open-registration` · `POST /semesters/:id/activate` · `POST /semesters/:id/close` | `academic:structure:*` | – |
| Offerings | `GET/POST /course-offerings` · `GET/PATCH /course-offerings/:id` · `POST …/publish` · `POST …/cancel` | `academic:course-offering:*` | – |
| Lecturing | `GET/POST /course-offerings/:id/lecturers` · `DELETE /course-offerings/:id/lecturers/:assignmentId` | `lecturing:assignment:*` | – |
| People | `GET/POST /students` · `GET/PATCH /students/:id` · `GET/POST /lecturers` · `GET/PATCH /lecturers/:id` | `enrollment:student:*`, `identity:user:manage` | – |
| Enrollment | `GET /programme-enrollments?studentId=` · `PATCH /programme-enrollments/:id` (status, level) · `GET /semester-enrollments/:id/registration` (compulsory + available electives) · `POST /semester-enrollments/:id/electives` · `DELETE /semester-enrollments/:id/electives/:courseEnrollmentId` | `enrollment:*`, `enrollment:elective:select` | – |
| Enrollment | `GET/POST /course-offerings/:id/enrollments` (manual/bulk) · `PATCH /course-enrollments/:id` | `enrollment:course-enrollment:*` | ✔ (bulk) |
| Class Meetings | `GET/POST /course-offerings/:id/class-meetings` · `POST /course-offerings/:id/class-meeting-series` | `meeting:class-meeting:read\|manage` | ✔ |
| Class Meetings | `GET/PATCH /class-meetings/:id` · `POST /class-meetings/:id/cancel` · `…/reprovision` · `…/start` · `…/join` · `…/end` | per §7 | – |
| Attendance | `GET/PUT /class-meetings/:id/roll-call` · `GET /class-meetings/:id/attendance` · `GET /class-meetings/:id/participants` · `POST /class-meetings/:id/participants/:pid/match` · `POST /class-meetings/:id/attendance/:studentId/override` · `DELETE …/override` · `POST /class-meetings/:id/attendance/recompute` · `GET /reports/attendance` | `attendance:*` | – |
| Video | `GET /course-offerings/:id/videos` · `GET /videos/:id` · `GET /videos/:id/play` · `PATCH /videos/:id/progress` | `video:asset:read\|play`, `video:progress:write` | – |
| Video | `POST /course-offerings/:id/videos {youtubeUrl, title?, description?, classMeetingId?}` · `PATCH /videos/:id` · `POST /videos/:id/publish\|unpublish` · `POST /videos/:id/recheck` | `video:asset:manage` | ✔ (publish) |
| Video admin | `GET /admin/videos` · `PUT /videos/:id/youtube-link` · `DELETE /videos/:id` · `POST /videos/:id/restore` · `POST /videos/:id/retry-ingest` (integration slice) | `video:asset:admin` | – |
| Content | `GET/POST/PATCH/DELETE /course-offerings/:id/materials` · `…/announcements` | `content:*` | – |
| Files | `POST /files/uploads` · `POST /files/:id/complete` · `GET /files/:id/download` | own/authz | – |
| Assessment | `GET/POST /course-offerings/:id/assignments` · `PATCH /assignments/:id` · `POST /assignments/:id/publish` · `POST /assignments/:id/submissions` · `GET /assignments/:id/submissions` | `assessment:*` | – |
| Assessment | `GET/POST /courses/:id/questions` · `GET/POST /course-offerings/:id/quizzes` (incl. online exams) · `PATCH /quizzes/:id` · `POST /quizzes/:id/publish` · `POST /quizzes/:id/attempts` · `PATCH /quiz-attempts/:id` · `POST /quiz-attempts/:id/submit` | `assessment:quiz:*` | ✔ (submit) |
| Gradebook | `GET /course-offerings/:id/gradebook` · `PUT /assessments/:id/grades/:studentId` · `POST /assessments/:id/release` · `POST /course-offerings/:id/grades/import` | `assessment:grade:*` | ✔ (release) |
| Results | `POST /course-offerings/:id/results/finalize` · `POST /course-results/:id/reopen` · `GET /course-offerings/:id/results` | `results:course-result:*` | ✔ (finalize) |
| Results | `POST /results/semesters/compute` · `POST /results/semesters/approve` · `POST /results/semesters/publish` · `GET /results/semesters` · `GET /reports/results` | `results:semester:*` | ✔ |
| Results | `GET/POST /grading-schemes` · `POST /programme-enrollments/:id/award/propose` · `POST /awards/:id/confirm` | `results:scheme:manage`, `results:award:confirm` | – |
| Transcripts | `POST /transcript-requests` · `GET /transcript-requests` · `POST /transcript-requests/:id/approve\|reject\|issue` · `GET /transcripts/:id` · `GET /transcripts/:id/download` · `POST /transcripts/:id/revoke` | `transcript:*` | ✔ (issue) |
| Public | `GET /public/transcripts/:code` | none (rate-limited) | – |
| Admin | `GET /admin/ops/failures` · `POST /admin/ops/replay/:kind/:id` · `GET/POST /admin/integrations/google` · `POST /admin/integrations/google/test` · `GET /admin/integrations/youtube/status` · `GET /audit-logs` | `ops:*`, `audit:log:read` | – |
| Webhooks | `POST /integrations/sendgrid/events` · `POST /integrations/google/workspace-events` (push mode only, off by default) | provider-verified | – |
| Health | `GET /healthz` · `GET /readyz` (DB + pg-boss) | none | – |

---

## 17. Jobs (pg-boss) and domain events

### 17.1 Queue catalogue

Defaults: `retryBackoff:true`, DLQ `<queue>.dlq`, archive after 7 days, delete after 30. `expire` = pg-boss job expiration. "Role" is the `WORKER_ROLE` that processes the queue; all roles run in the single `worker` component at launch.

| Queue | Role | Producer | Retry / expire | Dedupe / notes |
| ----- | ---- | -------- | -------------- | -------------- |
| `class-meeting.provision` | google | create, reprovision, `/join` priority | 6 / 5 min | `meeting:{id}:provision` |
| `class-meeting.sync-access` | google | provision, enrollment/lecturing events | 6 / 10 min | debounced 30 s per meeting |
| `class-meeting.end` | google | `/end` | 3 / 2 min | |
| `class-meeting.finalize` | general | conference ended (delayed), manual end | 5 / 10 min | `meeting:{id}:finalize` |
| `conference.sync` | google | ended/finalize/reconcile | 6 / 15 min | debounced per conference |
| `provider-event.process` | general | inbox insert | 5 / 2 min | inbox row id |
| `attendance.recompute` | general | roll call, override, match, manual | 3 / 2 min | per meeting, advisory lock |
| `recording.discover` | general | event/reconcile/admin | 6 / 5 min | `recording:{provId}` |
| `recording.ingest` | media | discover, retry (integration slice) | 5 / **2 h** | `recording:{id}`; streams Drive → YouTube; concurrency 1 |
| `video.youtube-processing-sync` | general | after upload (integration slice) | 20 / 2 min | `video:{id}:processing`; re-schedules itself with backoff |
| `video.availability-check` | general | cron daily; `/recheck` | 3 / 30 min | batches of 50; oEmbed (§13.3) |
| `drive.cleanup` | google | integration slice; only if `DRIVE_CLEANUP_MODE=TRASH_AFTER_INGEST` (default `NONE`, D-07) | 5 / 5 min | re-checks conditions |
| `video.purge-deleted` | general | cron daily | 3 / 30 min | after the 7-day undo: finalize deletion, remind the System Admin to delete in YouTube Studio (v1) or delete via API (integration slice) |
| `quiz.expire` | general | attempt start (`startAfter`) | 3 / 2 min | per attempt |
| `import.run` | general | `POST /imports` | 2 / 1 h | resumable by offset |
| `semester.open-registration` | general | semester → REGISTRATION; acceptance | 3 / 30 min | per programme enrollment batch |
| `academic.progression` | general | session activation | 3 / 30 min | idempotent |
| `results.compute-semester` | general | semester closed, import, manual | 3 / 30 min | per programme enrollment batch |
| `transcript.generate` · `transcript.send` | general | issue | 3 / 10 min | |
| `admissions.offer-sweep` | general | cron hourly | 3 / 10 min | reminders + lapse |
| `admissions.intake-status` | general | cron daily | 3 / 5 min | open/close by dates |
| `admissions.purge` | general | cron daily | 2 / 30 min | §10.5 |
| `notify.send` · `notify.digest` | general | domain events / cron | 5 / 2 min | |
| `domain-event` | general | any service | 5 / 2 min | dispatcher → subscribers |
| `subscription.renew` | google | cron/lifecycle | 6 / 5 min | per subscription |
| `db.logical-backup` | scheduler | cron weekly | 2 / 1 h | §22.7 |
| `idempotency.cleanup` · `auth.session-cleanup` | scheduler | cron | 2 / 10 min | |

### 17.2 Cron schedules (`scheduler` role; UTC unless noted)

| Job | Schedule |
|---|---|
| `meeting-tick` | every 1 min |
| `meeting-reconciliation` | every 3 min |
| `recording-reconciliation` | every 10 min |
| `video-status-reconciliation` | every 10 min |
| `subscription-renewal` | every 15 min |
| `recurrence-extender` | daily 02:00 |
| `admissions.intake-status` | daily 00:05 Lagos |
| `admissions.purge` | daily 03:00 |
| `video.purge-deleted` | daily 03:30 |
| `video.availability-check` | daily 04:00 |
| `notify.digest` | 06:00 Lagos |
| `admissions.offer-sweep` | hourly |
| `drive-storage-monitor` | hourly |
| `idempotency.cleanup` | hourly |
| `auth.session-cleanup` | hourly |
| `db.logical-backup` | weekly, Sunday 01:00 |

### 17.3 Domain events (enqueued on `domain-event`, in the same transaction)

| Area | Events |
|---|---|
| Admissions | `admissions.application.submitted`, `.admitted`, `.rejected`, `.lapsed`, `.withdrawn`, `.accepted` |
| Academic | `academic.session.activated`, `academic.semester.registration-opened`, `academic.semester.closed` |
| Offerings | `course.offering.created`, `.published`, `.cancelled` |
| Enrollment | `course.enrollment.activated`, `course.enrollment.ended` |
| Lecturing | `lecturing.assignment.created`, `lecturing.assignment.ended` |
| Class Meetings | `meeting.scheduled`, `.provisioned`, `.started`, `.ended`, `.cancelled`, `.rescheduled` |
| Attendance | `attendance.roll-call.updated`, `attendance.finalized` |
| Recordings and video | `recording.discovered`, `video.added`, `video.published`, `video.unpublished`, `video.unavailable`, `video.deleted` |
| Assessment | `assessment.grade.released` |
| Results | `results.course.finalized`, `results.course.reopened`, `results.semester.approved`, `results.semester.published`, `results.award.conferred` |
| Transcripts | `transcript.issued`, `transcript.revoked`, `transcript.superseded` |

Subscribers are idempotent and registered in `apps/worker/src/subscribers.ts`.

---

## 18. Frontend (low-bandwidth first)

### 18.1 Stack and structure (v2-16)

- React + Vite + TypeScript SPA in `apps/web`, built into the `api` image and served same-origin.
- TanStack Router (code-split per route) + TanStack Query; Tailwind + shadcn/ui; react-hook-form + Zod (shared contracts).
- `hls.js` is loaded **lazily** on the player route only.
- `vite-plugin-pwa` precaches the app shell; there is **no offline data**, except the queued roll-call and draft writes (§18.4).
- A typed API client is generated from OpenAPI.
- System font stack and an inline SVG sprite.
- Strings are externalised (English only).
- All times are formatted with `shared/time-zone` helpers in the viewer's zone, with Lagos time alongside when they differ (C-27).

### 18.2 Routes and screens

| Role | Routes |
| ---- | ------ |
| Public | `/login` · `/apply` (programme info, intake dates, "Continue with Google") · `/invite/:token` · `/forgot` · `/reset/:token` · `/verify/:code` |
| Applicant | `/application` (status, view, withdraw) · `/application/edit` (section wizard 1–8 + photo, autosave, review & submit) · `/application/offer` (accept before the expiry countdown) |
| Student | `/` (today: next Class Meetings with Room and join, continue watching) · `/registration` (compulsory courses + elective choice) · `/courses` · `/courses/:offeringId` (Overview, Schedule, Materials, Recordings, Assignments, Quizzes & Exams, Grades, Announcements) · `/watch/:videoId` · `/results` · `/transcripts` · `/profile` (Google link, timezone, notification prefs, referral code) |
| Lecturer | `/teach` · `/teach/:offeringId` (Schedule, Roster, Attendance, Recordings, Materials, Assignments, Quizzes & Exams, Gradebook, Results) · `/teach/meetings/:id` (start/join, room instructions, participants timeline, unresolved participants) · `/teach/meetings/:id/roll-call` |
| Admissions Officer | `/admissions` (queue) · `/admissions/applications/:id` (all sections; sensitive section gated) · `/admissions/intakes` · `/admissions/reports` (intake, referrals) |
| Academic Admin | `/admin/academic` (sessions, semesters, programmes, curricula, courses, rooms, offerings) · `/admin/enrollment` · `/admin/people` · `/admin/imports` |
| Registrar | `/registrar/results` · `/registrar/transcripts` · `/registrar/awards` · `/registrar/schemes` |
| System Admin | `/admin/users` · `/admin/settings` (incl. policies, YouTube channel URLs) · `/admin/videos` · `/admin/integrations/google` · `/admin/integrations/youtube` · `/admin/ops` · `/admin/audit` · `/admin/jobs` |

### 18.3 Low-bandwidth budgets (INV-13; `pnpm -w budget:check` in CI)

| Budget | Limit |
| ------ | ----- |
| Initial JS (login + shell), compressed | **≤ 170 KB** (hard fail > 200 KB) |
| Any route chunk | ≤ 60 KB; player route (excl. `hls.js`) ≤ 40 KB; application wizard ≤ 60 KB |
| Initial CSS | ≤ 30 KB |
| Requests to first interactive screen | ≤ 12 |
| LCP on simulated slow 4G (1.6 Mbps, 150 ms RTT, 4× CPU) | ≤ 4.0 s (Lighthouse CI, mobile) |
| API payloads | list items ≤ 2 KB each; no list > 50 KB uncompressed; ETag on GET lists |
| Images | AVIF/WebP ≤ 40 KB, lazy; uploads downscaled client-side (photo ≤ 300 KB) |

Practices:
- Hashed assets are served `immutable`.
- There's no polling on background tabs.
- Show skeletons, not spinners.
- Data-saver mode (`Save-Data` or a user toggle) disables non-essential images and shows the 144p tip before the YouTube player loads.

### 18.4 Key interactions

- **Apply:**
  - Google sign-in, then programme and study mode, then the section wizard with a progress bar and **autosave** (debounced 5–10 s, "Saved / Offline — will retry").
  - A review page lists missing required fields before submit.
  - The photo is cropped client-side to the passport ratio.
  - After submit: the reference number and a status timeline.
  - Offer page: an expiry countdown and an "Accept offer" button; on success it shows the Matric Number and next steps.
- **Join a Class Meeting (student):**
  - The card shows the time (own zone + Lagos) and the **Room** if there is one ("On campus: Main Hall · Online: Join").
  - "Join" calls `/join`. On `GOOGLE_ACCOUNT_REQUIRED`, show the link step. On success, open `joinUrl` and show a **low-data tip** (camera off, or dial in).
  - Knock state: "Wait in the lobby — your Lecturer will admit you."
- **Lecturer start (hybrid):** "Start class" shows the room-laptop instruction ("Open this on the room computer, signed in as you — recording starts when you join"), with links to **roll call** and the Meet link.
- **Roll call:**
  - A phone-first list (on-campus students first, with photos), with Present / Late / Absent toggles and a bulk "mark all on-campus present".
  - Queued locally and retried; works on flaky Wi-Fi.
  - Editable until the attendance lock.
- **Registration:** compulsory courses are shown as already registered. Available electives are listed with credits; add or drop until the deadline.
- **Player (`/watch/:id`):** §13.4 rules. Thumbnail facade → tap to load the YouTube player; resume prompt; the data-saver tip (144p ≈ 40 MB/hour); "Can't reach YouTube" message. The YouTube player is third-party and excluded from the bundle budget, but its download size is measured in S-11 and shown in the tip.
- **Forms:** assignment and quiz drafts autosave with retry. Error codes map to friendly copy, with the `requestId` shown on unexpected errors.

### 18.5 Accessibility and quality

- WCAG 2.1 AA baseline; a keyboard-operable player; contrast tokens; reduced motion respected.
- axe checks in Playwright.
- Mobile-first: students and applicants use phones, and Lecturers use phones for roll call and laptops for everything else.

---

## 19. Security, privacy, compliance (Nigeria)

### 19.1 Security baseline

- **Transport:** TLS by App Platform; HSTS.
- **Content Security Policy:**
  - `default-src 'self'`
  - `frame-src https://www.youtube-nocookie.com`; `script-src 'self'` plus the YouTube IFrame API host(s) (`https://www.youtube.com`; confirm in S-Y1); `img-src` adds `https://i.ytimg.com`; `connect-src` adds the Spaces endpoint
  - `frame-ancestors 'none'`
  - no inline scripts
- **Headers and cookies:** `Referrer-Policy: no-referrer`; `nosniff`; cookies per §8.3; CSRF header; same-origin API.
- **Input and data access:** Zod at every edge; parameterized SQL only.
- **Abuse protection:** rate limits (§5.4).
- **Uploads:** MIME allow-list, size caps, `Content-Disposition: attachment`; markdown sanitisation.
- **SSRF:** the server never fetches URLs supplied by users.
- **Secrets:** stored as App Platform **encrypted env vars**, never in the repo or logs. The inventory is in `docs/secrets.md`, with rotation periods: Google SA key ≤ 90 days, SendGrid key ≤ 180 days, Spaces keys ≤ 180 days. The YouTube channel OAuth refresh token (integration slice) is stored encrypted at rest with `TOKEN_ENCRYPTION_KEY`.
- **Dependencies:** `pnpm audit`, Renovate, gitleaks, container scanning (Trivy) in CI.
- **Database:** Managed PG **trusted sources** = the App Platform app only.
- **Least privilege:** Spaces keys scoped to the bucket; YouTube OAuth scopes limited to `youtube.upload` + `youtube` for the channel (integration slice); Google DWD scopes per §11.3.

### 19.2 Webhook/event authenticity

| Source | Verification |
|---|---|
| Pub/Sub | pull, so no public endpoint |
| SendGrid Event Webhook | ECDSA signature |

All inbound events are deduplicated by id in the inbox.

### 19.3 Data classification and retention

| Data | Classification | Default retention |
| ---- | -------------- | ----------------- |
| Applications: accepted | Personal + **sensitive** (religious belief) | With the student file: programme end + 10 years |
| Applications: rejected/lapsed/withdrawn/stale drafts | Personal + **sensitive** | **12 months** after decision/withdrawal/last edit, then hard-deleted (C-29) |
| Student profile, passport photo | Personal | Programme end + 10 years |
| Attendance, grades, course/semester results, awards | Academic record | 10 years after programme end (configurable) |
| Issued transcripts (snapshots) | Academic record, tamper-evident | 10 years; PDFs can be regenerated from the snapshot |
| Recordings and videos | Confidential (student voice/video), **but hosted as unlisted YouTube videos**: anyone with a link can view (ADR-0003) | **Indefinite** (C-24); deleted only by the System Admin (in the app and in YouTube Studio) |
| Audit logs | Security | 7 years |
| Join logs | Operational | 12 months |
| Auth sessions, idempotency keys | Operational | 30 days / 48 h |

### 19.4 Nigeria data protection (NDPA 2023, GAID 2025)

- **Cross-border transfers:** DigitalOcean (LON), Google (Workspace and **YouTube**) and SendGrid all process data outside Nigeria. The DigitalOcean review is done (C-15). **DPAs or terms review for all processors are a launch gate** (C-41). YouTube is a consumer service under Google's standard terms, not the Workspace DPA, so the DPIA must cover publishing class recordings there (ADR-0003, D-08).
- **Sensitive data:** the application's spiritual-background answers reveal religious belief, which is sensitive personal data. The rules:
  - collect them only with the explicit section-8 consent
  - restrict access (INV-15)
  - minimise them: they're not copied to the student record
  - delete them on schedule (§10.5)
  - record them in the processing register
- **Engineering support (built, not legal advice):**
  - a processing-register export (`docs/compliance/ropa.md`)
  - a privacy notice on `/apply`, and a **recording notice** before the first live join and on recorded meetings (C-40)
  - versioned consent text
  - **data subject requests:** `GET /me/data-export` (JSON of the user's own data), and an admin erasure/anonymisation workflow that preserves academic records required by law
  - a breach runbook (72-hour NDPC timeline) in `docs/runbooks/breach.md`
  - a DPIA for recordings and admissions data
  - NDPC registration status tracked as a launch gate
- **Minimise:** collect only the fields in §6 and the application form, with no analytics trackers. Logs redact PII; emails are hashed in logs.

### 19.5 Recording notice (C-40)

The policy is notice only:
- The LMS shows "This class is recorded" on the Class Meeting card and before joining.
- Meet announces recording.
- Lecturers see "Recording starts when you join".

There's no separate consent step.

---

## 20. Observability and SLOs

### 20.1 Telemetry (ADR-0002: no self-hosted stack)

- `pino` JSON logs go to stdout and are collected as **App Platform runtime logs**. Every request and job carries `requestId`/`jobId`; the job payload carries the originating `requestId`. Optionally, logs can be forwarded to a managed log service later.
- **App Platform insights and alert policies** cover CPU, memory, restart count, deployment failure and domain/TLS issues. **DO Managed PG alerts** cover CPU, disk and connections. **DO Uptime** checks `/readyz`, the login page and the public apply page. Alerts go by email to the System Admin.
- **In-app ops page** (§15.3): failures, queue depth/age (from pg-boss), Google and YouTube status, unavailable videos, Drive storage, and email bounces. This is the System Admin's primary dashboard.

### 20.2 SLOs and alerts (best effort; single region)

| Service | Target | Alert |
| ------- | ------ | ----- |
| Core API availability | 99.5 % monthly | DO Uptime on `/readyz` (2 consecutive failures) |
| Read/write API p95 | < 300 ms / < 500 ms | measured in logs; reviewed monthly |
| Join authorization | p95 < 1.5 s end-to-end (server < 100 ms) | — |
| Video authorization | p95 < 300 ms | — |
| Recording playable | v1: as soon as the link is added. Integration slice: 95 % within 2 h of the Drive file being available (YouTube processing, measured in S-Y1) | ops page: recordings `PROCESSING` > 6 h |
| Critical job start latency | 99 % < 60 s | ops page: queue age > 120 s |
| Event subscription | never within 12 h of expiry | ops page + email |
| Drive quota | < 70 % warn, 85 % alert | email |
| DB | connections < 80 % of budget | DO alert |

Runbooks (`docs/runbooks/*.md`), written for the System Admin:
- provider outage
- stuck recording
- `SOURCE_MISSING`
- subscription renewal failure
- DB restore
- deploy rollback
- breach response

---

## 21. Testing

### 21.1 Pyramid and gates

| Layer | What it covers |
|---|---|
| Unit | domain rules, state machines, pure functions |
| Integration | real Postgres 18 via Testcontainers: repositories, constraints (incl. the **room and lecturer exclusion constraints**), transactions, pg-boss handlers incl. transactional enqueue; MinIO for storage |
| Contract | OpenAPI/Zod, event/queue payloads, `VideoHost` and `LiveProvider` adapter contract suites run against fakes |
| End-to-end | Playwright against the compose stack with `FakeGoogleServer`, `FakeVideoHost` and Mailpit |
| Load | k6 |

Everything runs in CI except the real-service smoke tests (manual, Appendix B).

### 21.2 Mandatory automated scenarios

- **Authorization:**
  - table-driven deny tests over the personas (§7.5), generated from `matrix.json`
  - a non-visible resource returns 404
  - `s6` (graduated) cannot play O1 recordings, while `s5` (completed, still active) can
  - the sensitive application section is hidden from every role without `read-sensitive`, and is never present in list payloads, audit metadata or notifications (INV-15)
- **Admissions:**
  - draft autosave with `If-Match`
  - submit rejected while the intake is closed or required fields are missing; the reference number is gap-free under concurrent submits
  - only one open application per intake
  - decide → offer expiry set; reminder emails at 7 and 2 days
  - lapse at expiry, then reopen-offer
  - accept after expiry ⇒ `OFFER_EXPIRED`
  - acceptance creates the student/programme enrollment/Matric Number atomically, with Matric Numbers gap-free under concurrency, and copies only the allowed fields
  - a Certificate graduate's second admission reuses the student row with a new Matric Number
  - late acceptance auto-registers compulsory courses
  - referral code matching (valid, invalid, case-insensitive)
  - the purge sweep deletes rejected applications at 12 months, together with their photo files
- **Academic:**
  - open-registration auto-registers compulsory courses idempotently
  - elective add/drop within the window only, and only from the student's own Level/semester placements
  - progression Year 1 → Year 2
  - manual retake registration
- **Class Meetings and attendance:**
  - duplicate/out-of-order events converge
  - one Idempotency-Key ⇒ one meeting
  - **concurrent bookings of the same Room ⇒ the exclusion constraint rejects the second (`ROOM_CONFLICT`)**; same for the same Lecturer
  - join window, `GOOGLE_ACCOUNT_REQUIRED`, unenrolled ⇒ no URL
  - zero provider calls on join (INV-8)
  - state-machine table tests, including roll call with no conference ⇒ ENDED, not NO_SHOW
  - **all Appendix C attendance vectors, including the roll-call combinations**
  - overrides survive recompute; roll-call edits are audited and trigger recompute
  - the Lecturer's room-laptop participant is excluded from student attendance
- **Video:**
  - adding a link: invalid URL, playlist, private, deleted and other-channel links rejected with specific codes (FakeVideoHost scenarios); title prefilled
  - the availability check marks `UNAVAILABLE`, hides it from students, notifies, and a successful recheck restores the prior status
  - `/play` returns the embed only to entitled viewers (dropped/graduated ⇒ 404; completed-but-active ⇒ OK)
  - replace re-checks the link and resets progress on a duration change
  - delete → restore within 7 days → purge with a YouTube Studio reminder
  - progress monotonicity, stale `seq` ignored, rate limit, and duration learned from the first report
  - (integration slice) upload is idempotent, processing sync, duration check (INV-9), and Drive cleanup never runs in `NONE` mode
- **Results:**
  - golden GPA and award-class vectors (App. C)
  - property tests for `roundHalfUp`, banding boundaries and zero-credit semesters
  - repeat policies
  - exam with mixed sources (manual paper scores + online exam) in one column
  - reopen cascades
  - CGPA is per programme enrollment (Certificate results excluded from the Diploma)
  - imported legacy results count in CGPA and transcripts
  - transcript hash stability; Unicode PDF; verify-endpoint minimal fields and revocation
- **Platform:**
  - kill the worker mid-job ⇒ redelivered and completes
  - stop Postgres briefly ⇒ API 503, then recovery with no lost jobs
  - idempotency replay/conflict semantics
  - SIGTERM during ingest ⇒ safe redelivery
- **Security:** CSRF; session fixation/rotation; login lockout; upload MIME/size enforcement; markdown XSS corpus; gitleaks.
- **Frontend:**
  - budget check and Lighthouse CI; axe
  - Playwright flows: apply (Google fake) → submit → admit → accept; sign in; registration with electives; join (fake provider); roll call on a mobile viewport with offline retry; watch (thumbnail facade → stubbed YouTube player → resume) on a mobile viewport; assignment submit; online exam timer expiry; results; transcript request → issue → verify
  - viewer-timezone rendering (Lagos and London viewers)

### 21.3 Fakes

- **`FakeLiveProvider`:** in-memory and scriptable (conferences, participant sessions, recordings, failure injection).
- **`FakeGoogleServer`:** HTTP. Implements a subset of Meet v2, Drive `files.get`/`alt=media` with Range and `md5Checksum`, Workspace Events subscriptions, and Pub/Sub emulator wiring. Scenarios: reconnect, duplicate/out-of-order events, 429 + `Retry-After`, 403 scope error, 404 file, subscription expiry.
- **`FakeVideoHost`:** in-memory. `parseUrl` per real YouTube URL rules. `checkVideo` is scriptable per id (`AVAILABLE` with a channel URL, `PRIVATE_OR_RESTRICTED`, `NOT_FOUND`, unreachable). Optional upload/processing/delete for the integration slice. Playwright uses a stub page in place of the YouTube IFrame player.
- **Media fixtures:** short test videos generated with ffmpeg (`testsrc2` + sine).

### 21.4 Load tests (staging, before launch)

k6 targets at GLIM scale with ~5× headroom (C-21):

| Scenario | Target |
|---|---|
| Concurrent authenticated users | 250 |
| Video authorization burst | 20 req/s (p95 < 300 ms) |
| Join storm | 150 requests in 60 s (p95 < 1.5 s, zero provider calls) |
| Playback progress | 10 writes/s |
| Event burst through the Pub/Sub emulator | 100 events in 60 s (queue age < 60 s) |
| Ingests | 3 concurrent |
| Application autosave | 50 applicants concurrently |

Failure injection: Google 429/5xx storms, oEmbed unreachable, worker kill, Postgres restart. **The pass criteria are the SLOs in §20.2.**

---

## 22. DevOps on DigitalOcean App Platform (ADR-0002)

### 22.1 Environments

| Env | Purpose | Notes |
| --- | ------- | ----- |
| Local | `docker compose`: `postgres:18`, MinIO, Mailpit, FakeGoogleServer, FakeVideoHost | `pnpm dev` runs api, worker and web with hot reload. Seeds: synthetic GLIM programmes (CERT, DIP), curricula, 200 students, an intake with applications, meetings with Rooms. |
| CI | Ephemeral containers (Postgres 18, MinIO) | No external network except package registries |
| Staging | A separate App Platform app `glim-staging` + a small Managed PG + a separate Spaces bucket | Fakes by default. Real YouTube checks use a test channel. Real Google smoke tests use a dedicated staging host account in a test OU. |
| Production | App Platform app `glim` | §22.2 |

### 22.2 Production topology (check current App Platform sizes/prices at build time)

| Component | Spec (launch) |
| --------- | ------------- |
| Region | **LON** by default (S-13). App, Managed PG and Spaces in the same region. |
| `api` service | 2 instances (zero-downtime deploys), ≥ 1 vCPU / 1 GiB each; health check `/readyz`; serves the SPA |
| `worker` worker | 1 instance, ≥ 1 vCPU / 2 GiB (integration slice: streaming Drive → YouTube uploads); `WORKER_ROLE=all`. The image includes `pg_dump`. |
| `migrate` job | `PRE_DEPLOY`; runs Drizzle + pg-boss migrations as `glim_migrator` |
| PostgreSQL 18 (DO Managed) | 1 vCPU / 2 GiB with **1 standby** (recommended); pool `glim-tx` (transaction mode) + direct connection; trusted source = the app |
| Spaces | Private bucket `glim-files` (files, photos, PDFs; optional audio later) + `glim-backups` (logical dumps, lifecycle 12 weeks) |
| Video | **YouTube channel** owned by GLIM (Brand Account), with the System Admin and one other person as owner/manager; uploads unlisted (Appendix A.4) |
| Email | SendGrid (domain authenticated: SPF/DKIM; DMARC `p=quarantine` after warm-up) |
| DNS/TLS | App Platform custom domain (e.g. `portal.<glim-domain>`) with managed TLS |

The 99.5% target assumes two API instances and a PG standby. Running without a standby is cheaper, with an RPO of up to 24 h; the System Admin decides, and the choice is recorded in `docs/decisions.md`.

### 22.3 Configuration (validated by Zod in `shared/config`; secrets as App Platform encrypted env vars)

| Variable | Purpose |
| -------- | ------- |
| `NODE_ENV`, `APP_ORIGIN`, `INSTITUTION_DEFAULT_TZ` | basics |
| `DATABASE_URL` (pooled/tx), `DATABASE_URL_DIRECT`, `DATABASE_URL_MIGRATOR`, `DB_CONNECTION_BUDGET`, `DB_POOL_API`, `DB_POOL_WORKER` | database (§5.2) |
| `WORKER_ROLE` (`general\|google\|media\|scheduler\|all`), `QUEUE_CONCURRENCY_<NAME>` | workers/queues |
| `GOOGLE_PROJECT_ID`, `GOOGLE_SA_KEY_JSON_B64` (secret), `GOOGLE_PUBSUB_SUBSCRIPTION`, `GOOGLE_EVENTS_MODE` (`pull\|push`), `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (secret) | Google |
| `VIDEO_HOST` (`youtube_link\|youtube_api\|fake`), `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET` (secret), `TOKEN_ENCRYPTION_KEY` (secret) — the last three for the integration slice only. Channel URLs live in `settings`. | video (C-43) |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_BACKUP_BUCKET`, `STORAGE_ACCESS_KEY` (secret), `STORAGE_SECRET_KEY` (secret) | Spaces / MinIO |
| `MAIL_PROVIDER` (`sendgrid\|smtp`), `SENDGRID_API_KEY` (secret), `SENDGRID_WEBHOOK_PUBLIC_KEY`, `MAIL_FROM`, `SMTP_URL` (dev) | email |
| `SESSION_SECRET`, `CSRF_SECRET` (secrets) | auth |
| `BACKUP_AGE_RECIPIENT` | public key for encrypting logical backups |
| `DRIVE_CLEANUP_MODE` (`NONE\|TRASH_AFTER_INGEST`, default **`NONE`** pending D-07) | safety switch (integration slice) |
| `LOG_LEVEL`, `FEATURE_*` (`FEATURE_DIRECT_UPLOAD`, `FEATURE_PHONE_DIAL_IN`) | misc |

`docs/secrets.md` lists every secret, its owner (the System Admin) and its rotation period.

### 22.4 Images

- `docker/Dockerfile.api`: multi-stage, non-root Node image. It builds `apps/web` and copies `dist` into the static directory.
- `docker/Dockerfile.worker`: Node + `ffmpeg`/`ffprobe` + `postgresql-client`.
- Both are built by GitHub Actions and pushed to the **DigitalOcean Container Registry**. The App Platform components reference the image tags.
- **Graceful shutdown:** on SIGTERM, stop pg-boss polling and the Pub/Sub subscriber, finish in-flight jobs within the grace period (S-17), and close pools.

### 22.5 CI/CD (GitHub Actions → App Platform)

1. Install with lockfile verification.
2. Lint + format + typecheck + `deps:check`.
3. Unit and domain tests.
4. Integration tests (Testcontainers), including migrations on an empty DB and on the previous release's schema.
5. Contract/OpenAPI diff.
6. Web build + `budget:check` + Lighthouse CI + axe.
7. Container build + Trivy + gitleaks.
8. Playwright e2e on compose.
9. Push images to DOCR.
10. **Deploy staging:** `doctl apps update glim-staging --spec .do/app.staging.yaml`, which updates the image tags, runs `migrate` as `PRE_DEPLOY`, then does a rolling replace.
11. Smoke checks.
12. Manual approval.
13. **Deploy production** the same way.

**Rollback:** App Platform "rollback to previous deployment" (documented in `docs/runbooks/deploy.md`). Because migrations are expand/contract, the previous image always runs on the new schema.

### 22.6 Migration discipline (expand/contract)

- Migrations are forward-only.
- Release N may only **add**: nullable columns, new tables, indexes `CONCURRENTLY` (custom SQL). N+1 stops using the old structures; N+2 drops them.
- Never rename or drop in the same release as the code change.
- Backfills run as pg-boss jobs.
- Every migration PR includes a rollback note and a lock analysis.

### 22.7 Backups and disaster recovery

- **Postgres:** DO Managed daily backups with PITR (within DO's retention window). In addition, a **weekly logical dump** (`db.logical-backup`): `pg_dump -Fc` over the direct connection, encrypted with `age` to `BACKUP_AGE_RECIPIENT`, uploaded to `glim-backups`, and kept for 12 weeks. The age private key is held offline by the System Admin and one other named person.
- **Videos:** hosted on YouTube (C-43). In the integration slice, Meet originals stay in Workspace Drive (D-07). For v1 link-based uploads, the uploader keeps their source file. YouTube Studio offers the channel owner a download. There's no other backup (accepted).
- **Spaces files:** versioning/lifecycle where supported; academic records live in Postgres.
- **RPO/RTO:** RPO ≤ 5 min with PITR (≤ 7 days with the weekly dump as a last resort); RTO ≤ 4 h. Run a **restore drill** twice a year following `docs/runbooks/restore.md`, written step by step for the System Admin.

---

## 23. Delivery plan — work packages

Each WP is a branch (`wp-NN-name`), owns paths, lists its dependencies and has acceptance criteria. Sizes: S ≈ ≤ 2 days of agent work, M ≈ 3–6, L ≈ 1–2 weeks. Contract changes ship first (§0.5).

**Critical path:** WP-00 → 01 → 02 → 03/04 → 06/07 → 10–12 → ADM-1/2 → MEET-1…4 → ATT-1/2 → VIDEO-1/2 → RES/TRN → HARD.

### Phase 0 — Foundations

| WP | Name (size) | Owns | Depends | Acceptance |
| -- | ----------- | ---- | ------- | ---------- |
| WP-00 | Monorepo, tooling, CI skeleton, compose, `.do/app.yaml` (S) | root configs, `docker/`, `.github/`, `.do/` | — | build/typecheck/lint/test green on empty modules; dep-cruiser rules enforced; compose starts Postgres 18/MinIO/Mailpit |
| WP-01 | `shared` + `contracts` base (S) | `packages/shared`, `packages/contracts` | 00 | ids, clock, config, errors/Result, pagination, decimal + time-zone helpers (+ property tests), enums, error codes (App. D), queue/event names |
| WP-02 | `db` package (M) | `packages/db` | 01 | Drizzle schema for M01 + M06; custom SQL (roles, `rl_acquire`, audit append-only trigger, `uuidv7` defaults); `Db.withTx` + pg-boss adapter; idempotency & inbox repos; Testcontainers helper |
| WP-03 | Identity & sign-in (L) | `modules/identity`, `http/auth,users,me,settings` | 02, 06 | §8 complete: Google OIDC (signin/apply/link intents), local login (staff), invites/reset, sessions, CSRF, lockout, `/me` with timezone, settings + policies API |
| WP-04 | Authorization (M) | `modules/authorization` | 02 | `matrix.json` (§7.3), `AuthorizationService`, guards, `VisibleOfferings`, personas, generated deny tests, `v_offering_access` |
| WP-05 | Audit + logging (S) | `modules/audit`, `packages/telemetry` | 02 | append-only audit API, pino with request-id, `/healthz`, `/readyz` |
| WP-06 | API shell (M) | `apps/api/src/{main,app.module,common,static}` | 01, 02 | Nest+Fastify, Zod pipe, OpenAPI, error filter, idempotency interceptor, rate limits, SPA static serving + security headers |
| WP-07 | Worker shell (M) | `apps/worker` | 02 | pg-boss start (roles), `ensureQueues` per §17, cron, domain-event dispatcher, graceful SIGTERM, dashboard mount; kill-and-redeliver test |

### Phase 1 — Academic core and admissions

| WP | Name | Owns | Depends | Acceptance |
| -- | ---- | ---- | ------- | ---------- |
| WP-10 | Academic structure (M) | `modules/academic` (structure), M02 tables | 02, 04, 06 | AC-01; programmes CERT/DIP; calendar lifecycle §9.1; curricula versioning/clone; Rooms |
| WP-11 | People, enrollment, registration, progression (L) | `modules/enrollment`, `modules/lecturing` (profiles) | 10 | AC-03; chain rules; open-registration auto-registers compulsory courses; elective selection; manual registration; progression (D-03); drop/withdraw events |
| WP-12 | Offerings + lecturer assignments + slots (M) | `modules/academic` (offerings), `modules/lecturing`, `modules/scheduling` | 10, 11 | AC-02, AC-05; `meeting_lecturer_slots` maintenance |
| WP-13 | Imports incl. legacy results (M) | `modules/imports` | 11, RES-1 | dry-run/commit, error CSV, resumable; `STUDENTS`, `LECTURERS`, `COURSE_ENROLLMENTS`, `COURSE_RESULTS` (D-04) |
| WP-14 | Web foundation + admin academic UI (L) | `apps/web` | 03, 10–12 | shell, auth screens, typed client, PWA, **budgets in CI**, timezone rendering, admin screens for §9 |
| WP-ADM-1 | Intakes + application form + submit (L) | `modules/admissions`, M08 | 03, 10, CONT-1 (files) | §10.1–10.2; autosave with `If-Match`; reference sequence; receipt email; Zod contract mirrors the form |
| WP-ADM-2 | Review, decision, offer, acceptance (M) | `modules/admissions` | ADM-1, 11 | §10.3–10.4; offer sweep; acceptance transaction (Matric Number, programme enrollment, late registration); AC-16 |
| WP-ADM-3 | Data protection, purge, referrals, reports (S) | `modules/admissions` | ADM-2 | §10.5–10.6; INV-15 tests; purge sweep; referral codes + reports |
| WP-ADM-UI | Applicant + admissions UI (L) | `apps/web` apply/admissions routes | 14, ADM-1/2 | Playwright: apply → submit → decide → accept on a mobile viewport; wizard chunk budget |

### Phase 2 — Class Meetings and attendance

| WP | Name | Owns | Depends | Acceptance |
| -- | ---- | ---- | ------- | ---------- |
| WP-GOOG-0 | Google setup + spikes S-01/02/03/04/05/08/09 (M, human-assisted) | `docs/runbooks/google.md`, `docs/spikes/*.md` | — | Appendix A.1–A.2 done; spike reports recorded |
| WP-MEET-1 | `LiveProvider` port, `FakeLiveProvider`, `FakeGoogleServer` (M) | `integrations/live-provider`, `integrations/google/test` | 01 | contract tests shared by the fake and Google adapters |
| WP-MEET-2 | Google adapter (L) | `integrations/google` | MEET-1, GOOG-0 | DWD auth, Meet/Drive/Events clients, `rl_acquire` limiter, retry taxonomy, breaker; passes the adapter contract suite |
| WP-MEET-3 | Class Meetings, series, Rooms, state machine (L) | `modules/class-meeting`, `modules/scheduling` | 12, 05 | §11.4 table tests; lecturer + room exclusion tests; recurrence; reschedule/cancel; `meeting-tick` |
| WP-MEET-4 | Provisioning, member sync, join/start/end (L) | `modules/class-meeting` | MEET-2, 3 | INV-8 test; AC-04; RESTRICTED member sync; `GOOGLE_ACCOUNT_REQUIRED`; dial-in |
| WP-MEET-5 | Events, inbox, reconciliation, subscriptions (L) | `modules/class-meeting` (events), worker google handlers | MEET-2, 3 | duplicate/out-of-order scenarios; renewal; reconciliation repairs a dropped event |
| WP-ATT-1 | Raw store, matching ladder, `conference.sync` (M) | `modules/attendance` (ingest) | MEET-5, GOOG-0 (S-01) | pluggable strategies; unresolved queue; manual match; room-laptop exclusion |
| WP-ATT-2 | Roll call, attendance engine, finalize, overrides, reports (M) | `modules/attendance` (domain) | ATT-1 | **all Appendix C attendance vectors pass**; roll-call API + audit; AC-06, AC-11; CSV report with mode |
| WP-MEET-UI | Class Meeting + roll-call screens (M) | `apps/web` | 14, MEET-4, ATT-2 | Playwright: join flow; hybrid start instructions; roll call on mobile with offline retry |

### Phase 3 — Recordings and video

| WP | Name | Owns | Depends | Acceptance |
| -- | ---- | ---- | ------- | ---------- |
| WP-VIDEO-0 | **S-Y1 YouTube verification** (S, human-assisted) | `docs/spikes/S-Y1.md` | — | oEmbed behaviour per visibility; channel URL format; embed on target phones; ads observed; Studio permissions for Lecturers; API audit + quota path documented |
| WP-VIDEO-1 | `VideoHost` port, `FakeVideoHost`, `YouTubeLinkHost` (S) | `integrations/video-host` | 01, VIDEO-0 | URL parsing table tests; contract suite shared by the fake and the oEmbed adapter |
| WP-VIDEO-2 | **Integration slice:** Meet recording → YouTube upload, processing sync, optional audio, Drive retention (L) | `modules/video` (pipeline), `integrations/video-host/youtube-api` | VIDEO-1, MEET-5 | AC-07, AC-10; streamed upload; INV-9 duration check; API audit passed; quota adequate |
| WP-VIDEO-3 | Add link, availability check, playback, progress, access rule, management (M) | `modules/video` | VIDEO-1, 04 | AC-08, AC-09; p95 < 300 ms; add/edit/replace/delete/restore/recheck (§13.6); D-05 permissions |
| WP-VIDEO-4 | Player UI (facade + IFrame API + resume) + `/admin/videos` (M) | `apps/web` | 14, VIDEO-3 | thumbnail facade; resume; data-saver tip; mobile Playwright with stubbed player; admin screens with Studio links |

### Phase 4 — Learning, results, transcripts, comms

| WP | Name | Owns | Depends | Acceptance |
| -- | ---- | ---- | ------- | ---------- |
| WP-CONT-1 | Files (Spaces), materials, announcements (M) | `modules/content`, `integrations/storage` | 04 | presigned flows; per-purpose caps; sanitised markdown |
| WP-ASM-1 | Assignments & submissions (M) | `modules/assessment` | CONT-1 | late rules; resubmission; deny tests |
| WP-ASM-2 | Question bank, quizzes, online exams (L) | `modules/assessment` | ASM-1 | snapshot immutability; timer + auto-expire; autosave idempotency; `eligible_study_mode` |
| WP-ASM-3 | Gradebook, paper-exam entry, grade release (M) | `modules/assessment` | ASM-1/2 | AC-11; `If-Match`; audit + `grade_changes`; mixed-source exam column; weights validation; CSV grade import |
| WP-RES-1 | Grading schemes, award classes, pure GPA functions (M) | `modules/results` (domain) | 01 | **Appendix C vectors pass**; property tests; seeded GLIM Certificate/Diploma schemes |
| WP-RES-2 | Course results + semester workflow (L) | `modules/results` | ASM-3, RES-1 | finalize/reopen/approve/publish; cascades; broadsheet export; imported results |
| WP-RES-3 | Awards (S) | `modules/results` | RES-2 | requirements checklist; award class; certificate numbers; graduation status |
| WP-TRN-1 | Transcripts: snapshot, issue, PDF, verify, revoke (L) | `modules/transcripts`, `integrations/pdf` | RES-2 | hash determinism; Unicode PDF; public verify minimal; supersede on reopen |
| WP-NOTIF-1 | Notifications + SendGrid + digest (M) | `modules/notifications`, `integrations/mail` | 07 | §15.1 volume policy; recipient-timezone rendering; signed event webhook → suppression |
| WP-OPS-1 | Ops/admin screens, integration wizards, settings (M) | `modules/ops`, `apps/web` admin | MEET-5, VIDEO-3 | failures list/replay; DWD scope diff; YouTube status; unavailable videos |
| WP-UI-2 | Student/Lecturer/Registrar UI for registration, content, assessments, results, transcripts (L) | `apps/web` | the above | Playwright flows §21.2 |

### Phase 5 — Hardening and launch

| WP | Name | Owns | Depends | Acceptance |
| -- | ---- | ---- | ------- | ---------- |
| WP-DEVOPS-1 | App Platform specs (staging/prod), DOCR, deploy workflow, Spaces buckets, backups job, runbooks (M) | `.do/`, `.github/workflows/`, `docs/runbooks` | 00 | staging reproducible from the spec; rollback tested; restore drill documented |
| WP-HARD-1 | Load/failure tests, budgets (M) | `tests/load` | all | §21.4 pass criteria |
| WP-HARD-2 | Privacy & security hardening, DSAR export/erasure, DPAs, runbooks (M) | `modules/identity` (privacy), `docs/` | all | §19 checklist; INV-15 audit; breach runbook; C-41 DPAs recorded |

### Definition of Done — v1

| Area | Done when |
| ---- | --------- |
| Admissions | Apply → submit → review → admit/reject → accept/lapse → student with a Matric Number; sensitive data protected; purge; referrals (AC-16, AC-17) |
| Academic | Sessions/semesters/programmes/curricula/offerings/Rooms; registration with compulsory auto-registration and electives; progression; imports (AC-01–03) |
| Class Meetings | Lecturers schedule hybrid meetings with Rooms (no double-booking); students join when entitled and linked; DB-only join; reconciliation proven (AC-04, AC-05) |
| Attendance | Meet evidence + roll call converge to attendance per policy with mode; unresolved review; audited overrides; reports (AC-06, AC-11, AC-18) |
| Video | YouTube-hosted recordings linked, checked and embedded for entitled viewers with resume; unavailable videos detected; System Admin management (AC-07–10, AC-19) |
| Results | Gradebook (incl. hybrid exams) → course results → GPA/CGPA → approved → published; award classes; transcripts issued, verified, revoked/superseded (AC-13–15) |
| Security/privacy | Authorization deny tests, secrets in App Platform, audit, NDPA checklist, DPAs |
| Reliability | pg-boss redelivery, reconciliation, restore drill |
| Low bandwidth | Budgets pass; thumbnail facade; 144p tip; 3G playback measured in S-11 |

### Acceptance scenarios

| ID | Scenario |
|---|---|
| AC-01 | Academic setup |
| AC-02 | Offering with two Lecturers |
| AC-03 | Enrollment chain and compulsory auto-registration |
| AC-04 | Class Meeting create/join (unenrolled gets no link) |
| AC-05 | Co-lecturer privileges |
| AC-06 | Online attendance with reconnect/overlap |
| AC-07 | YouTube link (v1) or Meet recording (integration slice) → published video |
| AC-08 | Playback authorization (dropped denied; graduated denied; completed-but-active allowed) |
| AC-09 | Resume progress |
| AC-10 | Transient ingest failure without duplicates |
| AC-11 | Grade and attendance override audit |
| AC-13 | Finalize → approve → publish; GPA/CGPA match vectors |
| AC-14 | Transcript issue → verify page matches snapshot hash; revoke shows status |
| AC-15 | Reopen supersedes the transcript |
| **AC-16** | Application → acceptance creates the student, Matric Number and programme enrollment atomically |
| **AC-17** | Sensitive application data is never visible to unauthorized roles or in any list/log/notification |
| **AC-18** | Hybrid meeting: roll call + Meet evidence produce correct mode/status; Room double-booking rejected |
| **AC-19** | System Admin adds a YouTube link (wrong-channel link rejected), replaces it, deletes and restores it; an unavailable video is detected and hidden |

(AC-12, tenant isolation, was removed by ADR-0001.)

---

## Appendix A — Provider setup runbook (for the System Admin; C-17)

Do every step in **staging first**. Record the outcomes in `docs/runbooks/` and tick the launch checklist (A.6).

### A.1 Google Workspace (Business Standard)

1. Confirm the **Business Standard** licences. Licence the 2 host accounts and every Lecturer who must record.
2. Create the OU **LMS Hosts** with `lms-host-01@…` and `lms-host-02@…`. Store their strong credentials in the password manager. **No human classes** are run on these accounts.
3. Admin Console → Apps → Google Workspace → **Google Meet**, for the OUs *LMS Hosts* and *Lecturers*:
   - turn recording **on**
   - allow external participants
   - turn host management **on**
   - block participants who aren't signed in (**S-09**)
4. **Drive:** exempt *LMS Hosts* from retention/auto-delete rules, and note the pooled storage.
5. Create the Lecturer accounts in the OU *Lecturers*, with recording privilege (**S-08**).

### A.2 Google Cloud project

1. Create the project `glim-lms`. Enable the **Meet REST API**, **Drive API**, **Workspace Events API** and **Cloud Pub/Sub API**.
2. Set up the **OAuth consent screen**:
   - user type **External**; scopes `openid email profile` only
   - app name, logo, and privacy policy/terms URLs
   - **publish to Production**

   Then create an OAuth **Web client** with the redirect URI `https://<app>/api/v1/auth/google/callback`.
3. Create the **service account** `glim-meet` and enable domain-wide delegation. Create a JSON key and paste it, base64-encoded, into the App Platform encrypted env var `GOOGLE_SA_KEY_JSON_B64`. Rotate it at least every 90 days.
4. Admin Console → Security → API controls → **Domain-wide delegation**: add the Client ID with these scopes:
   - `https://www.googleapis.com/auth/meetings.space.created`
   - `https://www.googleapis.com/auth/meetings.space.readonly`
   - `https://www.googleapis.com/auth/drive.meet.readonly`
   - `https://www.googleapis.com/auth/drive` (Drive cleanup, C-16)
5. **Pub/Sub:**
   1. Create the topic `glim-meet-events`.
   2. Grant `roles/pubsub.publisher` on it to `meet-api-event-push@system.gserviceaccount.com`.
   3. Create the **pull** subscription `glim-meet-events-pull` (ack deadline 60 s, retention 7 d, dead-letter after 10 attempts).
   4. Grant the service account `roles/pubsub.subscriber`.
6. The admin wizard (§15.3) creates one Workspace Events subscription per host account and runs the connection test.

### A.3 DigitalOcean

1. Choose the region (**LON**, or the S-13 result). Create the **Managed PostgreSQL 18** cluster:
   - 1 vCPU / 2 GiB, with a standby recommended
   - database `glim`
   - users `glim_migrator` and `glim_app`
   - connection pool **`glim-tx`** in **transaction** mode for `glim_app` (the mode can't be changed later)
   - trusted source = the App Platform app
2. Create the **Spaces** buckets `glim-files` and `glim-backups` (private). Create a Spaces access key and add a lifecycle rule that aborts incomplete multipart uploads after 1 day and expires backups after 12 weeks.
3. Create the **Container Registry**.
4. **App Platform:**
   1. Create the app from `.do/app.yaml` (components `api`, `worker`, and `migrate` (PRE_DEPLOY)).
   2. Attach the database.
   3. Set the env vars from §22.3, marking secrets as encrypted.
   4. Add the custom domain.
   5. Set up alert policies (CPU, memory, restarts, deploy failed) to the System Admin's email.
5. Set up **DO Uptime** checks for `/readyz`, `/login` and `/apply`.

### A.4 YouTube channel (C-43)

1. Create GLIM's channel on a **Brand Account** owned by the institution, not by a person. Add the System Admin and one other named person as **Owner/Manager**.
2. In YouTube Studio, set the **upload defaults**:
   - visibility **Unlisted**
   - audience **No, it's not made for kids**
   - comments **off**
   - category Education
   - no subscriber notifications
3. Give Lecturers channel access with a role that allows uploading (S-Y1 confirms the least-privileged role), or have them send files to the System Admin.
4. Copy the channel URL(s) into the app's settings (`youtube_channel_urls`).
5. (Integration slice) Create an OAuth client in the Google Cloud project with scopes `youtube.upload` and `youtube`. Apply for the **YouTube API Services audit** and a quota extension early, because the audit can take weeks. Connect the channel in the app's YouTube integration screen.
6. Review YouTube's terms with the DPIA (C-41, D-08), and update the recording notice.

### A.5 SendGrid

1. Create the account. **Authenticate the sending domain** (SPF/DKIM CNAMEs), add DMARC `p=none`, and move to `p=quarantine` after warm-up.
2. Create an API key with Mail Send only.
3. Enable the **Signed Event Webhook** for bounce, dropped and spamreport events, pointing at `/api/v1/integrations/sendgrid/events`, and store the public key.
4. Warm up: start with at most 200 a day and double weekly (**S-14**). Sign the DPA.

### A.6 Launch checklist

- Spikes S-01…S-17 and S-Y1 closed or accepted.
- DPAs/terms reviewed: DigitalOcean, Google (Workspace + YouTube), SendGrid (C-41). Recording notice mentions YouTube (D-08).
- NDPC registration status recorded.
- Privacy notice, recording notice and Statement of Faith URL live.
- Backups and restore drill done.
- Budgets green; load tests green.
- `docs/decisions.md` defaults D-01…D-09 confirmed.
- Runbooks written for the System Admin.

---

## Appendix B — Verification spikes (against real services)

Each spike produces `docs/spikes/S-xx.md` (what was tried, the evidence, the decision). Until a spike is closed, code runs behind the port/fake and the PR notes the assumption.

| ID | Question | Pass criterion | Fallback if it fails | Gates |
| -- | -------- | -------------- | -------------------- | ----- |
| S-01 | For **external** Gmail participants, does Meet expose `signedinUser.user`, and does it equal the OIDC `sub`? What do anonymous and phone participants look like? | Deterministic id match | Disable `GOOGLE_ID`; use `MEMBER_EMAIL` if exposed, else `NAME_ASSISTED` + manual review (review mode by default) | WP-ATT-1 |
| S-02 | Can one host account own many spaces with different co-hosts and concurrent conferences? Does auto-recording start when the co-host Lecturer (room laptop) joins? | All behave; recordings land in host Drive | Tune the pool | WP-MEET-4 |
| S-03 | In `RESTRICTED` mode, do **external** members join without knocking? Member limits? | No knock for members; ≥ 60 members per space | Staff-only sync + host admits | WP-MEET-4 |
| S-04 | Do user-target Workspace Events subscriptions fire for API-created spaces? Lifetime and renewal? Envelope attributes? Minimal scopes? | Events arrive; routing is possible | Per-space subscriptions; reconciliation-only mode | WP-MEET-5 |
| S-05 | Recording file facts: container/codecs, MB per hour, `md5Checksum` present, `drive.meet.readonly` allows `alt=media` under DWD, download speed to App Platform (LON) | Download + MD5 verification works | Broaden the Drive scope; adjust timeouts | WP-VIDEO-2 |
| S-08 | Business Standard: REST participant and recording data available; co-host recording privilege; Drive quota | All available | Upgrade the host licences or accept manual attendance | WP-MEET, ATT |
| S-09 | An admin setting to block anonymous joiners | Anonymous blocked | Manual matching for anonymous participants | WP-ATT |
| S-10 | A narrower scope for trashing Meet recordings | A narrower scope works | Keep the broad scope or make cleanup manual | WP-VIDEO-2 |
| S-11 | YouTube embed on target devices (Android Chrome, Samsung Internet, iOS Safari ≥ 15, low-end 2 GB Android): player download size, startup on 3G from Lagos ISPs, 144p availability and MB/hour, resume via `start`/`seekTo`, `getCurrentTime` reliability | Plays and resumes; 144p available; numbers recorded for the tip | Adjust the tip; link to the YouTube app as a fallback | WP-VIDEO-4 |
| S-13 | RTT from Lagos (MTN, Airtel, Glo, fixed) to App Platform LON vs FRA vs AMS | Lowest p50/p95 chosen | Keep LON | WP-DEVOPS-1 |
| S-14 | SendGrid deliverability to Gmail, Yahoo and Nigerian providers; bounce handling | > 98 % inbox for transactional mail | Switch provider behind `Mailer` | WP-NOTIF-1 |
| S-15 | PG18 + Drizzle: exclusion constraints (room + lecturer), virtual generated column, custom SQL round-trip; pg-boss over the direct connection; advisory locks through the `glim-tx` pool | All migrate and behave | Direct connections for affected paths | WP-02/07 |
| S-16 | `@react-pdf/renderer`: Unicode names, 4-semester pagination, render time | Correct glyphs; < 3 s | Switch the PDF adapter | WP-TRN-1 |
| S-17 | App Platform: SIGTERM grace period for workers; worker memory/CPU for a 1.5 GB streamed upload (integration slice); path routing of `/api` + SPA in one service; `PRE_DEPLOY` job behaviour on failure | All confirmed with numbers | Adjust job expiry, instance size, or split worker roles | WP-DEVOPS-1, VIDEO-2 |
| **S-Y1** | **YouTube** (C-43): oEmbed responses for public, unlisted, private, deleted and embedding-disabled videos, and the `author_url` format for the channel check; whether ads appear on GLIM's non-monetised channel; the least-privileged Studio role that can upload; privacy-enhanced embed + IFrame API script hosts for the CSP. Integration slice: API audit process/timeline, `videos.insert` quota cost vs ~5 uploads/day, unaudited-upload privacy lock, `processingDetails`/duration availability | All behaviours documented | Adjust error mapping; manual upload continues if the audit is pending | WP-VIDEO-* |

### B.1 S-01 for the System Admin — no code required (≈ 45 minutes)

**Why it matters:** students join Meet with personal Gmail accounts. To mark online attendance automatically, the system must recognise *which Gmail account* was in the meeting. This test shows whether Google's API reports a stable account ID for outside (Gmail) participants that matches the ID Google gives the system when the same student signs in with Google.

**You need:** one host account (`lms-host-01@…`), two personal Gmail accounts you control (Student A and Student B), and one phone.

1. **Get each student's Google ID.**
   1. In a private browser window, open Google's **OAuth 2.0 Playground**.
   2. In *Step 1*, enter the scopes `openid email profile`, then click *Authorize APIs* and sign in as Student A.
   3. Click *Exchange authorization code for tokens*.
   4. Paste the `id_token` into `https://oauth2.googleapis.com/tokeninfo?id_token=…` and note the **`sub`** number and the email.

   Repeat for Student B.
2. **Hold a test meeting.**
   1. Signed in as the host account, start a meeting at `meet.new` and note the meeting code.
   2. Student A joins **signed in**.
   3. Student B joins signed in, leaves after 2 minutes, and rejoins.
   4. From a private window with no Google sign-in, try to join as a guest, and note whether it's allowed (this is S-09).
   5. Optionally, dial in by phone.
   6. Stay 5 minutes.
3. **Read what the API reports.** Wait about 10 minutes. Then, signed in as the host account, use the *Try this method* panel on the **Google Meet REST API reference** pages:
   1. `conferenceRecords.list` with the filter `space.meeting_code="…"`
   2. `conferenceRecords.participants.list`
   3. `…participantSessions.list` for each participant
4. **Record the results** in `docs/spikes/S-01.md` (screenshots are fine). For each participant:
   - Is there a `signedinUser.user` value?
   - Does the number after `users/` **equal** that student's `sub`?
   - What do the guest and phone participants look like?
   - Did Student B show **two** participant sessions?
5. **Interpretation:** *Equal* ⇒ PASS (automatic matching). *Different or missing* ⇒ FAIL (review mode: Lecturers confirm name-based suggestions). Either way, send the file to the build team.

---

## Appendix C — Golden vectors

### C.1 Attendance (default policy: `ACTUAL_CAPPED`, present 7500 bp, partial 2500 bp, late grace 15 min, pads 0)

The Class Meeting is scheduled **10:00–11:00** (3600 s) unless stated otherwise. `ratioBp = floor(attended × 10000 / denominator)`.

| # | Setup | Denominator | Attended (s) | ratioBp | Status | Mode | Late | Joins |
|---|---|---|---|---|---|---|---|---|
| V1 | Conference 10:02–11:00 (actual 3480); A online 10:05→11:00 | 3480 | 3300 | 9482 | PRESENT | ONLINE | no | 1 |
| V2 | Same; B online 10:02–10:30 + 10:40–11:00 | 3480 | 2880 | 8275 | PRESENT | ONLINE | no | 2 |
| V3 | Same; C on two devices, 10:02–10:40 and 10:30–11:00 (overlap) | 3480 | 3480 | 10000 | PRESENT | ONLINE | no | 2 |
| V4 | Same; D online 10:20–10:50 | 3480 | 1800 | 5172 | PARTIAL | ONLINE | **yes** | 1 |
| V5 | Same; E online 10:50–11:00 | 3480 | 600 | 1724 | ABSENT | ONLINE | yes | 1 |
| V6 | Same; F no evidence, no roll-call mark | 3480 | 0 | 0 | ABSENT | NONE | no | 0 |
| V7 | Same; G online from 10:30, **no end recorded**; conference ended 11:00 | 3480 | 1800 | 5172 | PARTIAL | ONLINE | yes | 1 |
| V8 | Conference 09:50–11:00; H online 09:50–10:30 (window clips to 10:00) | 3600 | 1800 | 5000 | PARTIAL | ONLINE | no | 1 |
| V9 | Conference 10:00–10:10 only; I online 10:00–10:10; I has no roll-call mark | 600 | 600 | 10000 | PRESENT (provisional) | ONLINE | no | 1 → meeting `REVIEW_REQUIRED` |
| V10 | Boundary: denominator 3600, attended 2700 / 2699 | 3600 | 2700 / 2699 | 7500 / 7497 | PRESENT / PARTIAL | ONLINE | — | — |
| V11 | Conference 10:02–11:00; J **roll call present**, no Meet evidence | 3480 | 0 | 10000 | PRESENT | **IN_PERSON** | no | 0 |
| V12 | Same; K roll call **absent**, online 10:05–11:00 | 3480 | 3300 | 9482 | PRESENT | ONLINE | no | 1 |
| V13 | Same; L roll call present **late=true**, also online 10:30–11:00 | 3480 | 1800 | 10000 | PRESENT | IN_PERSON | **yes** | 1 |
| V14 | **No conference** (room internet failed); M roll call present; N no mark | 0 | 0 | M 10000 / N 0 | M PRESENT / N ABSENT | IN_PERSON / NONE | no | 0 → meeting state ENDED (not NO_SHOW), `REVIEW_REQUIRED` |

Also:
- An override to EXCUSED survives recompute.
- A student dropped before the start has no record.
- A student enrolled after the start is evaluated.
- The Lecturer's room-laptop participant is never a student record.

### C.2 Final percentage (INV-14)

Assessments: Quiz (max 20, weight 20, score 15); Assignment (max 50, weight 30, score 40); Exam (max 100, weight 50, score 66, **paper, source MANUAL**).

- `final_pct_x100 = 1500 + 2400 + 3300 = 7200` (72.00 ⇒ **A**).
- If the Assignment is **EXCUSED**: `(1500 + 3300) × 10000 / 7000 = 6857.14 → 6857` (68.57) → `INTEGER` rounding ⇒ 69 ⇒ **B**.
- Rounding rule check: 69.50 with `roundBeforeBanding=INTEGER` ⇒ 70 ⇒ **A**; with `NONE` ⇒ **B**.
- An online student's exam is the same assessment, scored by quiz: 33/50 quiz points scaled to max 100 ⇒ 66.00 ⇒ the same result.

### C.3 GPA / CGPA and award class (GLIM Diploma scheme, credits ×10, points ×100)

**Semester 1:**

| Course | Credits | % | Letter | Quality points |
|---|---|---|---|---|
| DIP101 | 3 | 72 | A | 30×500 = 15000 |
| DIP103 | 2 | 65 | B | 20×400 = 8000 |
| DIP105 | 3 | 48 | D | 30×200 = 6000 |
| DIP107 | 2 | 38 | F | 0 |

Σqp = 29000 over 100 credits attempted ⇒ **GPA 2.90**. Credits earned: 80.

**Semester 2:**

| Course | Credits | % | Letter | Quality points |
|---|---|---|---|---|
| DIP102 | 3 | 80 | A | 15000 |
| DIP104 | 3 | 55 | C | 9000 |
| DIP106 | 2 | 61 | B | 8000 |

Σqp = 32000 over 80 credits ⇒ **GPA 4.00**.

**CGPA after S2 (KEEP_ALL):** 61000 / 180 = 338.89 ⇒ **3.39** ⇒ **Credit**. Standing GOOD (≥ 1.00).

**Semester 3:**

| Course | Credits | % | Letter | Quality points |
|---|---|---|---|---|
| DIP107 (**repeat**) | 2 | 52 | C | 6000 |
| DIP201 | 3 | 70 | A | 15000 |

Σqp = 21000 over 50 credits ⇒ **GPA 4.20**.

**CGPA after S3:**
- `KEEP_ALL`: 82000 / 230 = 356.52 ⇒ **3.57**
- `REPLACE_LATEST`: 82000 / 210 = 390.48 ⇒ **3.90**
- `BEST` (**default**): **3.90** ⇒ **Credit**

**Award-class boundaries:**

| Final CGPA | Award class |
|---|---|
| 4.50 | **Distinction** |
| 4.49 | **Credit** |
| 3.00 | **Credit** |
| 2.99 | **Pass** |
| 1.00 | **Pass** |
| 0.99 | **No award** |

`roundHalfUp(n,d) = floor((2n + d) / (2d))`. Property tests must cover exact ties.

**Programme separation:** a student with these Certificate results who is later admitted to the Diploma starts the Diploma with CGPA *undefined* (no counting credits ⇒ standing UNKNOWN).

---

## Appendix D — Error codes

| Group | Codes |
|---|---|
| General | `UNAUTHENTICATED` · `FORBIDDEN` · `NOT_FOUND` · `VALIDATION_FAILED` · `RATE_LIMITED` · `VERSION_MISMATCH` |
| Idempotency and CSRF | `IDEMPOTENCY_IN_PROGRESS` · `IDEMPOTENCY_KEY_REUSED` · `CSRF_INVALID` |
| Sign-in | `INVALID_CREDENTIALS` · `ACCOUNT_LOCKED` · `ACCOUNT_NOT_FOUND` · `GOOGLE_ACCOUNT_REQUIRED` |
| Admissions | `INTAKE_CLOSED` · `APPLICATION_ALREADY_OPEN` · `APPLICATION_INCOMPLETE` · `APPLICATION_STATE_INVALID` · `OFFER_EXPIRED` · `APPLICANT_UNDER_AGE` |
| Academic and enrollment | `ALREADY_ENROLLED` · `OFFERING_FULL` · `ENROLLMENT_NOT_ACTIVE` · `REGISTRATION_CLOSED` · `ELECTIVE_NOT_AVAILABLE` · `PRIMARY_REQUIRED` · `CURRICULUM_LOCKED` · `SEMESTER_STATE_INVALID` |
| Class Meetings | `MEETING_STATE_INVALID` · `MEETING_IN_PROGRESS` · `JOIN_WINDOW_CLOSED` · `PROVIDER_NOT_READY` · `PROVIDER_UNAVAILABLE` · `LECTURER_SCHEDULE_CONFLICT` · `ROOM_CONFLICT` |
| Attendance | `ROLL_CALL_CLOSED` · `OVERRIDE_REASON_REQUIRED` · `PARTICIPANT_ALREADY_MATCHED` |
| Video | `VIDEO_NOT_AVAILABLE` · `YOUTUBE_URL_INVALID` · `YOUTUBE_VIDEO_PRIVATE` · `YOUTUBE_VIDEO_NOT_FOUND` · `YOUTUBE_CHANNEL_NOT_ALLOWED` · `VIDEO_CHECK_UNAVAILABLE` · `SOURCE_MISSING` |
| Assessment | `WEIGHTS_NOT_100` · `ATTEMPT_LIMIT_REACHED` · `ATTEMPT_EXPIRED` · `SUBMISSION_CLOSED` · `NOT_ELIGIBLE_FOR_ONLINE_EXAM` · `GRADEBOOK_LOCKED` |
| Results and transcripts | `RESULT_NOT_FINALIZED` · `RESULT_LOCKED` · `SCHEME_LOCKED` · `REQUIREMENTS_NOT_MET` · `NO_AWARD` · `TRANSCRIPT_NOT_ISSUABLE` |
| Imports | `IMPORT_FILE_CHANGED` · `IMPORT_ROW_INVALID` |
| Warnings (non-blocking) | `STUDENT_NO_GOOGLE_ACCOUNT` · `LECTURER_NO_GOOGLE_ACCOUNT` · `STUDENT_SCHEDULE_CLASH` · `REFERRAL_CODE_UNKNOWN` |

---

## Appendix E — `CLAUDE.md` additions (merged into the existing root `CLAUDE.md` by WP-00)

```markdown
# GLIM school management system — agent instructions

Source of truth: docs/TRD.md (v3.0). Domain language: GLOSSARY.md. Decisions: docs/decisions.md and docs/adr/.
If anything conflicts, the TRD wins; if the TRD is ambiguous, stop and ask.

## Commands
pnpm install · pnpm -w dev · pnpm -w typecheck · pnpm -w lint · pnpm -w deps:check · pnpm -w test · pnpm -w test:integration · pnpm -w test:e2e · pnpm -w budget:check · pnpm -w db:migrate · pnpm -w db:generate

## Non-negotiables (TRD §0.2)
Single institution (no tenant key/RLS) · server-side entitlement · no Google/video-provider types outside integrations · correctness in Postgres (incl. room + lecturer exclusion constraints) · enqueue pg-boss jobs in the SAME transaction (no Redis, no outbox) · events are hints · join path DB-only · never publish an unverified video · video bytes never through the API · audit in-transaction · no secrets in repo/logs · exact integer arithmetic for grades/GPA · web budgets in CI · sensitive applicant answers stay in Admissions.

## Workflow
1. Read your WP in §23 + referenced sections + GLOSSARY.md. 2. Contract change first. 3. Tests with the code (incl. deny paths). 4. Custom SQL via `drizzle-kit generate --custom`. 5. Verify library APIs from installed types. 6. Update docs/ if behaviour/config changes.

## Do not
Use drizzle-kit push outside scratch DBs · add Redis or multi-tenancy · call Google or YouTube in the request path (except the link check when a video is added) · return Drive URLs · put business rules in controllers or jobs · use floats for grades · log tokens or spiritual-background answers · say "session" unqualified, "teacher", or "student number" · weaken a budget or invariant to make a test pass.
```

---

## Appendix F — Glossary

The canonical domain language is **`GLOSSARY.md`** at the repo root. Technical terms used in this spec:

| Term | Meaning |
|---|---|
| **Host account** | an institution-owned Workspace user that owns Meet spaces and recordings |
| **Space** | a Meet meeting space (one per Class Meeting) |
| **Conference record** | one occurrence of a call in a space |
| **Participant session** | a continuous join→leave interval |
| **Roll call** | the Lecturer's in-room attendance marks |
| **Attendance mode** | IN_PERSON / ONLINE / NONE on an attendance record |
| **Inbox** | the durable table for inbound provider events |
| **Video host** | where recordings live: GLIM's YouTube channel, unlisted (C-43) |
| **Rendition / rung** | one quality level of a video |
| **Quality points** | credits × grade points |
| **DWD** | Google domain-wide delegation |
| **Spike** | a time-boxed check against a real service (Appendix B) |
