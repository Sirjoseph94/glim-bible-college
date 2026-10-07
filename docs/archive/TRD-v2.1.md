> **ARCHIVED — superseded by docs/TRD.md v3.0 (GLIM edition, Oct 2026). Do not build from this file.** Kept for reference only.

# School LMS — Agent Build Specification

**Version:** 2.1-agent · **Supersedes:** TRD v1.0 (9 Sep 2026) and Build Spec v1.1/v2.0 · **Audience:** Claude Code agents (and humans reviewing their work)
**Product:** Live-first, low-bandwidth LMS for universities and Bible schools in Nigeria. Google Meet (Business Standard) is the live-media provider; recordings are copied out of Google Drive, transcoded into a low-bandwidth adaptive ladder, and served through an authorised edge. Academic results roll up into GPA/CGPA and verifiable transcripts.

> This file is the single source of truth. If it contradicts the TRD, **this file wins**. If something here is ambiguous or self-contradictory, stop and raise it (§0.4). Every external-facing claim was checked against vendor documentation in October 2026; the ones that could not be verified are listed as **spikes** (Appendix B) — build against the ports and fakes, do not hard-wire them.

> **v2.1 changes (owner answers, Oct 2026):** students use personal Gmail (C-10); recordings-only 180-day retention (C-09); NUC 5-point, repeat policy **BEST**, results visible **on teacher finalization** (C-11); serial + QR + hash transcripts (C-12); launch scale **15–30 students × 3–5 concurrent classes** (C-13) — sizing, cost model and load tests rescaled; Cloudflare approved (C-14); legal review of cross-border hosting done (C-15); **Drive cleanup enabled** (C-16); the institution's **system admin** owns Google setup and runs spike S-01 using the no-code procedure in Appendix B.1.

---

## Table of contents

0. Rules of engagement for agents
1. Vetting outcome: what changed from TRD v1.0
2. Decisions: confirmed choices, researched ADRs, and open questions
3. Scope and personas
4. Architecture
5. Cross-cutting engineering standards
6. Data model (DDL)
7. Authorization
8. Identity and sessions
9. Academic core
10. Live classroom (Google Meet)
11. Attendance
12. Recording and VOD (low-bandwidth pipeline)
13. Learning, assessment, results, GPA and transcripts
14. Notifications, imports, admin operations
15. API catalogue
16. Jobs (pg-boss) and domain events
17. Frontend (low-bandwidth first)
18. Security, privacy, compliance (Nigeria)
19. Observability and SLOs
20. Testing
21. DevOps on DigitalOcean: topology, config, CI/CD, backups
22. Delivery plan — work packages

- Appendix A — Provider setup runbook (Google, DigitalOcean, Cloudflare, SES)
- Appendix B — Verification spikes
- Appendix C — Golden vectors (attendance, GPA)
- Appendix D — Error codes
- Appendix E — `CLAUDE.md` template
- Appendix F — Glossary

---

## 0. Rules of engagement for agents

### 0.1 Read order

1. §0, §1, §2 — always. 2. The section(s) for your work package (§22). 3. §5 (standards) and §6 (data model) before touching code or SQL.

### 0.2 Hard invariants (never violate; if a task seems to require it, stop and ask)

| #      | Invariant                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-1  | **Server computes entitlement.** The client never asserts roles, enrollment, or teaching rights. Every protected route resolves `(user, institution)` first.                                                                    |
| INV-2  | **Tenant isolation fails closed.** Every tenant-owned table carries `institution_id`, uses composite FKs, and has forced PostgreSQL RLS. Missing tenant context ⇒ zero rows.                                                    |
| INV-3  | **Provider types never leak into domain code.** Only `packages/integrations/google` imports Google SDK types; domain modules use the `LiveProvider` port.                                                                       |
| INV-4  | **Correctness lives in PostgreSQL** (constraints, exclusion constraints, unique indexes) — never in in-memory checks or advisory locks alone.                                                                                   |
| INV-5  | **No work is lost.** Follow-up work is enqueued with pg-boss **in the same transaction** as the change that requires it; external events are written to the durable **inbox** (`provider_events`) before they are acknowledged. |
| INV-6  | **Events are hints, never truth.** Provider events trigger syncs; state converges from reading provider resources; reconciliation repairs missed events.                                                                        |
| INV-7  | **Raw provider evidence is append-only; academic records are derived.** Attendance and GPA are recomputed idempotently; overrides survive recomputation.                                                                        |
| INV-8  | **The join path is database-only.** `POST /sessions/:id/join` makes zero provider calls on the happy path.                                                                                                                      |
| INV-9  | **Never publish a broken VOD.** Publication requires checksum, size, duration and codec validation.                                                                                                                             |
| INV-10 | **Media never flows through the API or app droplets.** Private storage; playback only via the media edge with a short-lived HMAC token minted after an entitlement check. Raw Drive URLs are never exposed.                     |
| INV-11 | **Audit in the same transaction** for grade changes, attendance overrides, result finalization/approval, transcript issue/revoke, role changes, recording deletion, security/integration config changes.                        |
| INV-12 | **No secrets in the repo, logs, traces, tokens, or error responses.**                                                                                                                                                           |
| INV-13 | **Low-bandwidth budgets are enforced in CI** (§17.3). A feature that breaks a budget is not done.                                                                                                                               |
| INV-14 | **Academic records are exact.** Grades, credits, grade points and GPA use integer/decimal arithmetic (never JS floats) and published results/transcripts are immutable snapshots.                                               |

### 0.3 Definition of Done (every work package)

- `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w deps:check`, `pnpm -w budget:check` (web) pass; strict TS; no `any` without justification.
- Unit tests for domain rules; integration tests against real Postgres 18 (Testcontainers) for repositories, transactions, RLS, pg-boss handlers.
- **Authorization deny-path tests** for every new endpoint (wrong role, wrong scope, wrong tenant, unauthenticated).
- Endpoints appear in generated OpenAPI and use shared Zod contracts from `packages/contracts`.
- Migrations are forward-only, tested on empty DB and on the previous release schema, and follow expand/contract (§21.6).
- Audit events, metrics and logs specified in the section are emitted.
- No TODO/FIXME without an issue ref; no dead or commented-out code; `docs/` updated for behaviour/config/ops changes.

### 0.4 When to stop and ask (instead of guessing)

- A §2 item marked **OPEN** that your task depends on and `docs/decisions.md` has no recorded answer.
- Any behaviour marked **SPIKE** (Appendix B): implement behind the port/fake, flag the assumption in the PR.
- A requirement that would break an invariant.
- A library API you are not certain of: **read the installed package's types/docs; never rely on memory.** Pin versions at scaffold and record them in `docs/stack-versions.md`.

### 0.5 Working agreements for parallel agents

- **Contract first:** change `packages/contracts` in its own small PR before implementing against it.
- **Ownership:** each work package (§22) owns paths; edit others' paths only via contract PRs; cross-module calls go through the module's public `index.ts`.
- **Migrations:** `drizzle-kit generate` for schema-expressible changes; `drizzle-kit generate --custom --name=wpNN_description` for hand-written SQL (RLS functions, triggers, views, exclusion constraints, virtual columns, partitions). Never `drizzle-kit push` outside a local scratch DB. One table is owned by one module (§5.3).
- **Branches/PRs:** `wp-NN-short-name`; ≤ ~800 changed lines where feasible; link the WP ID and requirement IDs.
- **Fakes first:** all Google behaviour is developed against `FakeLiveProvider` and `FakeGoogleServer` (§20.3); real-Google smoke tests are manual (Appendix B).

---

## 1. Vetting outcome: what changed from TRD v1.0

The TRD is a strong baseline. The review found the gaps below; each is resolved in this spec. 🔴 = would cause production defects or break a stated NFR if built literally. Rows Δ-29 onward are **new in v2.0**, driven by your choices and the research.

| ID       | Sev | Gap                                                                                                                                                                                                                                  | Resolution                                                                                                                    |
| -------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Δ-01     | 🔴  | Session state machine mixes conference lifecycle with recording lifecycle (contradicts the TRD's own "independent states" invariant).                                                                                                | Split state machines: session lifecycle, recording asset, VOD asset. §10.4                                                    |
| Δ-02     | 🔴  | "Unauthorized student cannot join" is unenforceable on an open link.                                                                                                                                                                 | `RESTRICTED` spaces + members sync; explicit guarantee boundary. §10.5                                                        |
| Δ-03     | 🔴  | Join path called Google synchronously (violates NFR-003).                                                                                                                                                                            | Pre-provisioned spaces; DB-only join (INV-8). §10.6                                                                           |
| Δ-04     | 🔴  | Google quotas ignored. Verified: `spaces.create` 100/min/project and **10/min/user**; reads 600/min/user; writes 100/min/user.                                                                                                       | Lazy provisioning, host pool, Postgres token-bucket limiter. §10.7                                                            |
| Δ-05     | 🔴  | Organizer undefined; verified: recordings land in the **organizer's** Drive and can be deleted by that user.                                                                                                                         | Institution host accounts, teachers as `COHOST`. §10.2                                                                        |
| Δ-06     | 🔴  | No Google-participant → student mapping.                                                                                                                                                                                             | Matching ladder + review queue; **externals need S-01**. §11.3                                                                |
| Δ-07     | 🔴  | Events carry **names only**; per-event GETs would exhaust quota.                                                                                                                                                                     | Mark-dirty + bulk sync. §10.8                                                                                                 |
| Δ-08     | 🟠  | Scopes under-specified; `drive.readonly` too broad.                                                                                                                                                                                  | `drive.meet.readonly`. §10.3                                                                                                  |
| Δ-09     | 🔴  | Redis-only enqueue loses work in outages.                                                                                                                                                                                            | **No Redis at all**: pg-boss transactional enqueue + Postgres inbox. D-ADR-01/02                                              |
| Δ-10     | 🔴  | `institution_id` missing on most tables.                                                                                                                                                                                             | Everywhere + composite FKs + forced RLS + lint test. §5.2                                                                     |
| Δ-11     | 🟠  | One programme per offering breaks cross-listing.                                                                                                                                                                                     | `section_code` + `offering_audiences`. §6.3                                                                                   |
| Δ-12     | 🟠  | No assessment/gradebook model.                                                                                                                                                                                                       | Gradebook, weights, scales. §13                                                                                               |
| Δ-13     | 🟠  | RBAC had no tables.                                                                                                                                                                                                                  | `role_assignments` + matrix. §7                                                                                               |
| Δ-14     | 🔴  | Attendance: events vs intervals; undefined denominator.                                                                                                                                                                              | Interval store, policy schema, pure algorithm, vectors. §11                                                                   |
| Δ-15     | 🟠  | VOD: seeking, checksum, signed URL vs long playback, SLO vs transcoding.                                                                                                                                                             | HLS fMP4 ladder, progressive publication, edge tokens. §12                                                                    |
| Δ-16     | 🔴  | No frontend spec.                                                                                                                                                                                                                    | §17                                                                                                                           |
| Δ-17     | 🟠  | No onboarding path for 25k users.                                                                                                                                                                                                    | CSV imports. §14.2                                                                                                            |
| Δ-18     | 🟡  | Idempotency/envelope/pagination named, not specified.                                                                                                                                                                                | §5.4                                                                                                                          |
| Δ-19     | 🟠  | Push webhook needs public ingress + JWT verification.                                                                                                                                                                                | Pub/Sub **pull** default. ADR-18                                                                                              |
| Δ-20     | 🟠  | Retention ignored; transcript entries expire 30 days after the conference.                                                                                                                                                           | Ingest immediately; retention sweeps. §12.9                                                                                   |
| Δ-21     | 🟡  | "Rooms" conflict rule meaningless for Meet.                                                                                                                                                                                          | DB exclusion constraint on teacher slots. §9.5                                                                                |
| Δ-22     | 🟡  | "OIDC/SAML" too broad.                                                                                                                                                                                                               | Google OIDC + local; SAML COULD. ADR-11                                                                                       |
| Δ-23     | 🟡  | Meeting codes expire ~365 days after last use.                                                                                                                                                                                       | Lazy provisioning. §10.6                                                                                                      |
| Δ-24     | 🟡  | Notification channel unspecified.                                                                                                                                                                                                    | In-app + SES email. ADR-13                                                                                                    |
| Δ-25     | 🟠  | Post-semester entitlement undefined.                                                                                                                                                                                                 | **180 days** (confirmed). §12.9                                                                                               |
| Δ-26     | 🟠  | Shared GCP project quotas across tenants.                                                                                                                                                                                            | Per-institution integration config. §10.7                                                                                     |
| Δ-27     | 🟡  | 99.9% / HA assumed without tiering.                                                                                                                                                                                                  | Deployment tiers. §21.2                                                                                                       |
| Δ-28     | 🟡  | No ops surface.                                                                                                                                                                                                                      | `/v1/admin/ops/*`, dashboard. §14.3                                                                                           |
| **Δ-29** | 🔴  | **Business Standard constraints.** Business editions are for **1–300 users**; Standard allows **150 participants/meeting**; Meet attendance-tracking UI is Business Plus; Meet Media API is Plus+. 25k students cannot be org users. | Students are **external Google accounts**; capacity cap 150; own attendance engine; sections for larger cohorts. §10.2, §10.5 |
| **Δ-30** | 🔴  | With external students, `TRUSTED` gives **no** join-without-knock benefit (only org members and _invited_ externals skip knocking).                                                                                                  | Default flips to **`RESTRICTED` + member sync**; Google account link required before first live join. §10.5, §8.1             |
| **Δ-31** | 🔴  | Directory API cannot resolve external accounts; participant-id matching for externals is unproven.                                                                                                                                   | S-01 gates Phase 2 attendance; ladder has manual + name-assisted review fallbacks. §11.3                                      |
| **Δ-32** | 🔴  | **Spaces CDN cannot serve private content with caching** (verified: presigned URLs are not cached; no edge auth). Spaces origin has request-rate limits that 5,000 concurrent HLS viewers would stress.                              | **R2 + Cloudflare media-edge Worker** with HMAC tokens; ADR-04. §12.6                                                         |
| **Δ-33** | 🔴  | 1080p MP4 is unusable for low-bandwidth students.                                                                                                                                                                                    | HLS ABR ladder 240–720p + audio-only, lowest rungs published first. §12.4                                                     |
| **Δ-34** | 🟠  | App Platform containers have ~2 GiB ephemeral disk (unsuitable for ffmpeg).                                                                                                                                                          | Droplets + Docker Compose. ADR-07                                                                                             |
| **Δ-35** | 🟠  | Workspace SMTP relay is capped at ≈130 recipients per licence per day.                                                                                                                                                               | SES via SMTP. ADR-13                                                                                                          |
| **Δ-36** | 🟠  | Recordings fill Drive (host pool storage).                                                                                                                                                                                           | Storage monitor **plus** trash-after-ingest (C-16; broad Drive scope accepted). §12.9                                         |
| **Δ-37** | 🟠  | GPA/transcripts were out of scope; they need exact arithmetic, repeat policy, approval workflow, tamper-evident documents.                                                                                                           | §13.4–13.7                                                                                                                    |
| **Δ-38** | 🟠  | Cross-border transfer rules (NDPA ss. 41–43, GAID 2025) apply: DigitalOcean has **no African region**.                                                                                                                               | Legal checklist, DPIA, lawful-basis register. §18.4                                                                           |
| **Δ-39** | 🟡  | Redis-free rate limiting/caching undefined.                                                                                                                                                                                          | In-memory + Postgres token buckets. §5.7                                                                                      |

---

## 2. Decisions: confirmed choices, researched ADRs, and open questions

### 2.1 Your confirmed choices — validated, with the consequences found

| ID   | Choice                                                               | Validation (October 2026)                                                                                                                                                                                                   | Consequence for the build                                                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | **PostgreSQL 18+**                                                   | DigitalOcean Managed PostgreSQL lists versions 14–18 and offers daily backups with PITR and standby nodes.                                                                                                                  | Use native `uuidv7()`, virtual generated columns, and exclusion constraints; run `lms_migrator`/`lms_app` roles; DO provides PgBouncer pools (transaction mode default; **mode cannot be changed after creation**) and **25 connections per GiB RAM** — connection budget in §5.2.                   |
| C-02 | **Drizzle ORM**                                                      | Supports partial indexes (`.where`), composite foreign keys, `pgPolicy`/`.enableRLS()`, `drizzle-kit` generate + custom SQL migrations.                                                                                     | Schema in TypeScript; anything the DSL can't express (RLS helper function, exclusion constraints, triggers, views, virtual columns, partitions) goes in **custom SQL migrations**. See ADR-03.                                                                                                       |
| C-03 | **pg-boss, minimise external deps**                                  | Supports creating jobs inside your own DB transaction, cron scheduling, `sendThrottled`/`sendDebounced`, retry with backoff, dead-letter queues, queue policies; requires PostgreSQL 13+; a dashboard package exists.       | **Redis is removed entirely** (ADR-01/02). Outbox table deleted — transactional enqueue replaces it.                                                                                                                                                                                                 |
| C-04 | **Google Workspace Business Standard**                               | Official Meet edition table: Business editions are **1–300 users**; Standard = **150 participants**, recording and external participants supported; attendance-tracking UI and Meet Media API are Business Plus/Enterprise. | Capacity cap 150 (incl. staff); students are external Google accounts; our own attendance engine; Spike S-08 confirms REST participant data on Standard.                                                                                                                                             |
| C-05 | **Institution host accounts own spaces**                             | Matches Meet semantics: artifacts go to the organizer's Drive.                                                                                                                                                              | HOST_POOL (§10.2); pool size drives API throughput (per-user quotas).                                                                                                                                                                                                                                |
| C-06 | **DigitalOcean hosting**                                             | **No African region** (NYC, AMS, SFO, SGP, LON, FRA, TOR, BLR, SYD, ATL, RIC, MKC). App Platform has ~2 GiB ephemeral disk.                                                                                                 | Region ADR-08, topology ADR-07, cross-border legal work §18.4.                                                                                                                                                                                                                                       |
| C-07 | **Low bandwidth**                                                    | —                                                                                                                                                                                                                           | HLS ABR ladder + audio-only; Meet dial-in info surfaced; web budgets; Preact fallback (§17).                                                                                                                                                                                                         |
| C-08 | **GPA and transcripts**                                              | NUC 5-point scale and class bands confirmed from public sources.                                                                                                                                                            | New `results`/`transcripts` modules (§13.4–13.7); presets `NUC_5` and `US_4`.                                                                                                                                                                                                                        |
| C-09 | **Retention 180 days — recordings only** (confirmed)                 | —                                                                                                                                                                                                                           | **Media** (recordings, VOD renditions, speech transcripts) is playable by students and then purged **180 days after the offering completes**. Academic records (grades, attendance, results, transcripts, audit) use the longer defaults in §18.3. Q-04 (keep for staff vs purge) defaults to purge. |
| C-10 | **Students use personal Gmail for Meet**                             | Consistent with Business Standard's 300-user org cap.                                                                                                                                                                       | External members in `RESTRICTED` spaces; Google link mandatory before first live join; attendance identity depends on S-01.                                                                                                                                                                          |
| C-11 | **NUC 5-point; repeat policy BEST; release on teacher finalization** | NUC bands confirmed (§13.4).                                                                                                                                                                                                | `NUC_5` is the institution default; `repeat_policy='BEST'`; `releaseMode='ON_FINALIZE'` — course results visible when the teacher finalizes; semester GPA/CGPA shown as _provisional_ until registrar approval; **official** transcripts still require approved semesters (§13.5/§13.7).             |
| C-12 | **Transcripts: serial + QR + hash**                                  | —                                                                                                                                                                                                                           | No PAdES/e-signature work in MVP.                                                                                                                                                                                                                                                                    |
| C-13 | **Scale: 15–30 students per class, 3–5 simultaneous classes**        | —                                                                                                                                                                                                                           | Launch = Tier P (§21.2); host pool of **2**; Google quotas are far from limits; cost model and load-test targets rescaled (§12.11, §20.4). Business Standard's 150 cap is never approached.                                                                                                          |
| C-14 | **Cloudflare approved**                                              | —                                                                                                                                                                                                                           | R2 + `media-edge` Worker (ADR-04) is the default; presigned fallback kept behind the port.                                                                                                                                                                                                           |
| C-15 | **Cross-border legal review done**                                   | —                                                                                                                                                                                                                           | Recorded in `docs/decisions.md`; compliance features in §18.4 are still built (register, DSAR, breach runbook).                                                                                                                                                                                      |
| C-16 | **Drive cleanup: yes**                                               | Trashing Meet files requires the broad `https://www.googleapis.com/auth/drive` DWD scope (no narrower scope found; S-10 keeps looking).                                                                                     | `DRIVE_CLEANUP_MODE=TRASH_AFTER_INGEST`: trash the host-Drive recording **7 days after** the R2 copy is MD5-verified and the HLS ladder is complete (§12.9). Drive keeps trashed files ~30 days as a further safety net.                                                                             |
| C-17 | **Google admin = the institution's system admin**                    | —                                                                                                                                                                                                                           | Appendix A is written for them; WP-GOOG-0 is a paired task (agent prepares, system admin executes).                                                                                                                                                                                                  |

### 2.2 Researched decisions (ADRs) — alternatives weighed, one chosen

Each row: options considered → evidence → **choice** → revisit trigger.

| ADR | Decision                               | Options and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Choice                                                                                                             | Revisit when                                                                                       |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 01  | **Job queue**                          | **BullMQ+Redis**: fastest, richest, but adds Redis (violates C-03). **Graphile Worker**: Postgres-only, LISTEN/NOTIFY low latency, transactional `add_job`; no built-in debounce/throttle/queue dashboard; LISTEN needs a direct connection. **pgmq**: extension-based; availability on managed PG not assured; minimal semantics. **Temporal/Inngest/Trigger.dev**: external or heavy. **pg-boss**: transactional send via custom db adapter, cron, throttle/debounce with keys, retry/backoff, DLQ, priorities, dashboard, PG13+.                                                                                                                                                                                   | **pg-boss**                                                                                                        | > ~500 jobs/s sustained or p95 job start latency > 5 s                                             |
| 02  | **Replace Redis uses**                 | _Queue_ → pg-boss. _Rate limits_ → in-process token bucket per API replica (abuse protection; limits × replicas) + Postgres bucket function for Google quotas and auth lockout. _Locks/leader_ → pg-boss cron leader + `pg_advisory_xact_lock`. _Cache_ → in-process LRU (session 5 s); no entitlement cache. _Sessions_ → Postgres. _Realtime_ → client polling (ADR-17).                                                                                                                                                                                                                                                                                                                                            | **Zero Redis**                                                                                                     | Rate-limit accuracy across replicas matters (then add Postgres UNLOGGED counters)                  |
| 03  | **ORM / migrations**                   | **Prisma**: no partial indexes/RLS-native; drift detection fights custom SQL. **Kysely**: excellent SQL control, no schema DSL. **TypeORM/MikroORM**: heavier, decorator-based. **Drizzle** (confirmed): SQL-like typed queries, RLS/partial/composite support, migrations as SQL.                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Drizzle + drizzle-kit (custom SQL where needed)**                                                                | Drizzle gaps block a migration repeatedly                                                          |
| 04  | **Object storage + media delivery**    | (a) **Spaces + presigned, no CDN**: single vendor; Europe-origin only; per-bucket request-rate limits; egress billed after allowance. (b) **Spaces + CDN (Lagos PoP)**: _verified_ presigned URLs bypass cache and the CDN has no edge auth → private media impossible; public-unguessable keys are not revocable. (c) **Spaces + Nginx secure_link cache droplet**: cache only in Europe, adds ops. (d) **Cloudflare R2 + Worker token auth + Cache API**: R2 egress **free**, $0.015/GB-month, Class B $0.36/M; Worker ~$5/mo + request fees; edge cache near users; revocable by token TTL. (e) **Managed video (Stream/Mux/Bunny Stream)**: least ops, per-minute delivery fees explode at target scale (§12.11). | **(d) R2 + `media-edge` Worker.** Spaces not used.                                                                 | Cloudflare terms/Lagos coverage fail S-12 → fall back to (a) behind the same `MediaDelivery` port  |
| 05  | **Video format**                       | MP4 progressive (simple, no adaptation, big files); HLS-TS (≈10 % overhead); **HLS fMP4/CMAF** (smaller, hls.js + native Safari); DASH (no native iOS). Add **audio-only** rendition (~18 MB/h).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **HLS fMP4, 6 s segments, ladder 240/360/480/720p + audio-only**                                                   | Player/browser issues on target devices (S-11)                                                     |
| 06  | **Transcoding**                        | Self-hosted ffmpeg on a CPU droplet vs managed video (Stream ≈ $1 per 1,000 delivered minutes, from memory — verify). At **launch scale** (≈ 225 viewer-hours/day) managed delivery ≈ $400/mo vs ≈ $50–100/mo self-hosted (§12.11); at target scale the gap is 10–30×.                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Self-hosted ffmpeg, media worker role**                                                                          | Viewer-hours fall below ~3,000/month **and** ops time for the media droplet becomes the bottleneck |
| 07  | **Hosting topology**                   | **App Platform**: ephemeral ~2 GiB disk, 15-min-class jobs → ffmpeg unsuitable. **DOKS**: overkill for ≤10 services. **Droplets + Docker Compose (+Caddy)**: full control, media droplets sized freely. **Kamal**: good deployer but adds a Ruby tool; Compose + SSH script suffices.                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Droplets + Docker Compose + Caddy + GitHub Actions**                                                             | > ~6 droplets → consider DOKS                                                                      |
| 08  | **Region**                             | No African region. Candidates LON1, FRA1, AMS3 (all have Managed PG + Spaces/Droplets). Lagos has direct paths to UK/Portugal landings; choose by **measured RTT**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **LON1 default; decide with S-13 (mtr from MTN/Airtel/Glo/fixed ISPs)**                                            | S-13 shows FRA1/AMS3 p50 lower by ≥ 15 ms                                                          |
| 09  | **Space model**                        | Per-session space (clean mapping, per-session artifacts); per-offering space (fewer member syncs, link reuse, ambiguous conference→session mapping); Calendar-event-backed Meet (invite emails, broader scope, per-day invite caps).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **One space per LiveSession** (member-sync cost is fine: ≈150 `members.create` per session vs 100 writes/min/host) | Member-count cap (S-03) makes per-session sync infeasible                                          |
| 10  | **Meet access mode**                   | `OPEN`: anyone with link. `TRUSTED`: org members + _invited_ externals — students are not org members, so no benefit. **`RESTRICTED`**: only invitees skip knocking; everyone else knocks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **`RESTRICTED` + student member sync**; host admits strays                                                         | S-03/S-09 results                                                                                  |
| 11  | **Identity**                           | Auth0/Clerk/Keycloak (extra service or vendor); in-house Google OIDC + local password. SAML adds a large surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **In-house: Google OIDC + local (argon2id); SAML = COULD**                                                         | An institution mandates SAML                                                                       |
| 12  | **Auth sessions**                      | JWT (revocation hard) vs opaque cookie in Postgres (≤5 s revocation).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Opaque cookie, Postgres**                                                                                        | —                                                                                                  |
| 13  | **Email**                              | Workspace relay: ≈130 recipients/licence/day (e.g., 20 licences ⇒ ≈2,600/day) — too small for students. **Amazon SES** (SMTP, cheapest per message), Postmark/Resend (simpler, pricier).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **SES via SMTP behind a `Mailer` port; Mailpit in dev. Workspace relay acceptable only for a pilot**               | Deliverability to Nigerian providers poor in S-14                                                  |
| 14  | **PDF generation**                     | Playwright/Chromium (400 MB image, heavy), PDFKit (manual table pagination), **@react-pdf/renderer** (declarative layout, auto pagination, fixed headers, font embedding).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **@react-pdf/renderer** (verify Unicode names with tonal marks in tests)                                           | Layout fidelity issues                                                                             |
| 15  | **Observability**                      | Datadog/Sentry/Grafana Cloud (vendors) vs self-hosted `grafana/otel-lgtm` container. Uptime via DO Monitoring/Uptime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **OpenTelemetry → self-hosted LGTM on the ops droplet**                                                            | Ops burden > value                                                                                 |
| 16  | **Frontend**                           | Next.js (SSR unnecessary behind login), Svelte/Solid (smaller JS, smaller talent/agent base), **React+Vite** (ecosystem, hls.js, agents proficient) with **bundle budgets** and **Preact-compat** as a measured fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **React + Vite SPA + budgets (+Preact fallback)**                                                                  | Budget breaches (§17.3)                                                                            |
| 17  | **Realtime UI**                        | WebSocket/SSE need cross-replica fan-out (LISTEN/NOTIFY needs direct connections). Polling with ETags is cheap and data-friendly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Polling (15–30 s, only on live-relevant pages)**                                                                 | Teacher live dashboards need seconds-level updates                                                 |
| 18  | **Google event transport**             | Push (public endpoint + JWT) vs **pull** (no ingress, flow control, worker-side).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Pub/Sub pull**; push behind a flag                                                                               | —                                                                                                  |
| 19  | **Tenancy**                            | RLS on shared schema vs schema-per-tenant vs DB-per-tenant (isolated but N× ops; pg-boss per DB).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Shared schema + forced RLS**                                                                                     | A tenant demands physical isolation                                                                |
| 20  | **API style**                          | REST+OpenAPI vs tRPC (TS-only clients) vs GraphQL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **REST + Zod/OpenAPI**                                                                                             | Mobile client team prefers otherwise                                                               |
| 21  | **Secrets**                            | Vault (heavy), Doppler/Infisical (vendor), cloud secrets managers (none first-party on droplets).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **sops + age (encrypted files in repo, key on hosts) + GitHub Actions secrets**                                    | > 3 operators                                                                                      |
| 22  | **Space-level temporal safety (PG18)** | App-level overlap checks race. PG18 temporal constraints (`WITHOUT OVERLAPS`) vs classic **EXCLUDE USING gist** — both enforce in DB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **EXCLUDE USING gist** (works in all PG ≥ 9.x tooling, clear in Drizzle custom SQL)                                | —                                                                                                  |

### 2.3 Questions — status after owner answers (record in `docs/decisions.md`)

| ID   | Question                                                                                                                               | Status / value used                                                                                                                                                                                                                       | Blocks                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Q-01 | Student Google accounts                                                                                                                | **Answered:** personal Gmail (C-10)                                                                                                                                                                                                       | —                          |
| Q-02 | Can S-01 be run?                                                                                                                       | **OPEN → assigned to the system admin** using the no-code procedure in Appendix B.1. Until it passes, attendance runs in review mode (`GOOGLE_ID` strategy off, sessions finalize as `REVIEW_REQUIRED` when participants are unresolved). | WP-ATT-1 (final behaviour) |
| Q-03 | Scope of 180-day retention                                                                                                             | **Answered:** recordings/media only (C-09)                                                                                                                                                                                                | —                          |
| Q-04 | After 180 days: purge or keep for staff                                                                                                | **Default: purge for everyone** (not explicitly answered — confirm)                                                                                                                                                                       | WP-VOD-3                   |
| Q-05 | Grade scale                                                                                                                            | **Answered:** NUC 5-point, institution-wide default (programme override still possible)                                                                                                                                                   | —                          |
| Q-06 | Repeat policy                                                                                                                          | **Answered:** `BEST`                                                                                                                                                                                                                      | —                          |
| Q-07 | Results release                                                                                                                        | **Answered:** on teacher finalization (`ON_FINALIZE`)                                                                                                                                                                                     | —                          |
| Q-08 | Transcript signing                                                                                                                     | **Answered:** serial + QR + hash                                                                                                                                                                                                          | —                          |
| Q-09 | Scale                                                                                                                                  | **Answered:** 15–30 students × 3–5 concurrent classes                                                                                                                                                                                     | —                          |
| Q-10 | Google domain admin                                                                                                                    | **Answered:** the institution's system admin                                                                                                                                                                                              | —                          |
| Q-11 | Knock fallback for unlinked students                                                                                                   | Default: yes (host admits) — confirm                                                                                                                                                                                                      | UX copy                    |
| Q-12 | Languages beyond English                                                                                                               | Default: English only — confirm                                                                                                                                                                                                           | —                          |
| Q-13 | Cloudflare                                                                                                                             | **Answered:** yes                                                                                                                                                                                                                         | —                          |
| Q-14 | Cross-border legal review                                                                                                              | **Answered:** done                                                                                                                                                                                                                        | —                          |
| Q-15 | Any under-18 students                                                                                                                  | Default: no minors — confirm                                                                                                                                                                                                              | §18                        |
| Q-16 | Drive cleanup                                                                                                                          | **Answered:** yes (C-16)                                                                                                                                                                                                                  | —                          |
| Q-17 | **New:** how many live sessions per day in total (not just simultaneously)? Drives storage/transcode sizing.                           | Default: ≤ 15 sessions/day of ≤ 60 min                                                                                                                                                                                                    | §12.11                     |
| Q-18 | **New:** should **official** transcripts wait for registrar approval of the semester even though students see results on finalization? | Default: yes (official = approved; unofficial = finalized)                                                                                                                                                                                | WP-TRN-1                   |

---

## 3. Scope and personas

### 3.1 In scope (MVP)

Institution/org-unit/programme/curriculum/course configuration · academic sessions and semesters · course offerings with sections and audiences · student/teacher profiles and bulk import · programme → semester → course enrollment with status history · teaching assignments (many-to-many, co-teaching) · live sessions (single and recurring) on Google Meet · join authorization · attendance ingestion/projection/override · recording ingestion → **low-bandwidth HLS ladder + audio-only** → protected playback → resume progress · materials, announcements, assignments, quizzes, gradebook · **course results, semester GPA/CGPA, standing, degree classification, verifiable transcripts** · notifications (in-app + email) · RBAC + scoped policy · audit · ops visibility · media retention (180 days).

### 3.2 Out of scope (MVP)

Custom WebRTC/SFU or embedded conferencing · AI tutoring/search/summaries · registrar/finance/HR/ERP beyond results and transcripts · proctoring/biometrics · native offline mobile apps · multi-provider failover · SAML (COULD) · SMS/WhatsApp/push · payments/fees · PAdES e-signatures on transcripts (Q-08) · offline video download.

### 3.3 Personas and primary journeys

| Persona           | Journeys                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student           | Sign in with institutional Google → see enrolled courses and this week's schedule → join live class → rewatch recording and resume → submit assignment / take quiz → see grades |
| Teacher           | See assigned offerings → schedule session(s) → start class (Meet) → review attendance and fix exceptions → publish materials/assignments → grade → finalize results             |
| Registrar         | Review/approve semester results → publish → issue and revoke transcripts → confirm degree awards                                                                                |
| Academic admin    | Configure session/semester/curriculum → create offerings → assign teachers → enroll students (individual/bulk) → monitor ops failures → run attendance reports                  |
| Institution admin | Users, roles, policies (attendance, recording, retention), Google integration setup                                                                                             |
| Auditor/observer  | Read-only access to granted scopes                                                                                                                                              |
| Platform admin    | Tenant provisioning, global ops, queue dashboard                                                                                                                                |

---

## 4. Architecture

### 4.1 Runtime topology (no Redis)

```
 Student / Teacher browsers
   │  HTTPS                                   │ HTTPS (HLS, token in path)
   ▼                                          ▼
┌───────────────────────────┐        ┌──────────────────────────┐
│ Caddy (TLS) on app droplets│        │ Cloudflare: media-edge   │──► R2 (private bucket: vod, files)
│  /        → web (static)   │        │ Worker + Cache API       │      ▲  S3 API
│  /api/*   → api (NestJS)   │        └───────────▲──────────────┘      │ uploads (worker)
└─────────────┬─────────────┘                    │ HMAC token minted by API (secret shared)
              ▼                                  │
      ┌──────────────┐   pg-boss (same DB)  ┌────┴────────────────────────────────┐
      │ apps/api     │──────────────────────►│ PostgreSQL 18 (DO Managed, standby) │
      └──────────────┘                       │  app schema (RLS) · pgboss schema   │
      ┌───────────────────────────────┐      └────▲────────────────────────────────┘
      │ apps/worker (WORKER_ROLE=…)   │───────────┘
      │  general · google · scheduler │◄──► Google: Meet REST, Drive, Workspace Events (Pub/Sub pull), [Directory]
      │  media (ffmpeg, CPU droplet)  │──► downloads recordings from host Drive, uploads HLS to R2
      └───────────────────────────────┘
      Mail: Amazon SES (SMTP) · Observability: otel-lgtm on ops droplet · Secrets: sops+age
```

- **Two images** (`api`, `worker`); the worker image contains `ffmpeg/ffprobe`. `WORKER_ROLE` ∈ `general | google | scheduler | media | all`. Only one role set runs pg-boss maintenance/cron (`scheduler`).
- **Stateless API**, auth sessions in Postgres. **No Redis**: nothing in the system requires a shared in-memory store (§5.7).
- **The web SPA is static files** served by Caddy from the app droplet (or a `web` container); API at `/api` on the same origin (no CORS).
- **Cloudflare is used only for the `media-edge` Worker, the R2 bucket, and DNS/TLS for the media hostname** (Q-13).

### 4.2 Repository layout (pnpm workspace + Turborepo)

```
/
├─ apps/
│  ├─ api/          src/{main.ts, app.module.ts, http/<module>/*.controller.ts, common/{guards,filters,interceptors}}
│  ├─ worker/       src/{main.ts, worker.module.ts, handlers/<queue>/*.handler.ts, schedules.ts}
│  ├─ web/          React SPA (§17)
│  └─ media-edge/   Cloudflare Worker (TypeScript, wrangler) — token verify + R2 + cache (§12.6)
├─ packages/
│  ├─ contracts/    Zod schemas, DTO types, enums, error codes, queue + event names (single source for api/web/worker)
│  ├─ shared/       clock, Result/Err, config loader (Zod env), pagination, errors, tenancy context, money-free decimal helpers
│  ├─ db/           drizzle schema (src/schema/*), migrations/ (generated + custom SQL), TenantDb, boss adapter, idempotency/inbox repos, test helpers
│  ├─ telemetry/    pino logger, OTel setup, metrics helpers
│  ├─ modules/      Nest modules = application layer (no controllers)
│  │   identity/ academic/ enrollment/ teaching/ scheduling/ live-session/ attendance/ vod/ content/
│  │   assessment/ results/ transcripts/ authorization/ audit/ notifications/ imports/ ops/
│  └─ integrations/
│      live-provider/  LiveProvider port + FakeLiveProvider
│      google/         DWD auth, meet, drive, workspace-events, directory(optional), quota limiter, FakeGoogleServer (test)
│      storage/        ObjectStorage port + S3 adapter (R2/MinIO)
│      media-delivery/ MediaDelivery port: token minting (HMAC) + URL building
│      media/          ffprobe/ffmpeg wrappers, ladder builder, faststart check
│      mail/           Mailer port + SMTP adapter
│      pdf/            react-pdf transcript renderer
├─ docker/ · .github/workflows/ · docs/{decisions.md,stack-versions.md,system-role-usage.md,runbooks/,adr/} · CLAUDE.md
```

### 4.3 Dependency rules (enforced by `dependency-cruiser`, `pnpm -w deps:check`)

1. `contracts`, `shared` import nothing internal except each other.
2. `modules/*` may import `contracts`, `shared`, `db`, `telemetry`, other modules' **public `index.ts`**, and **ports** in `integrations/{live-provider,storage,media-delivery,media,mail,pdf}`.
3. `modules/*` **must not** import `integrations/google` (INV-3). Only `apps/*` composition roots bind `GoogleMeetProvider` to the `LIVE_PROVIDER` token.
4. `apps/api` has controllers/guards/filters only — no business rules. `apps/worker` handlers call the **same application services**.
5. A module writes only to tables it owns (§6 lists owners).
6. `apps/media-edge` imports **nothing** from the monorepo except `contracts/media-token.ts` (token claims schema) — it must stay deployable alone.

### 4.4 Technology stack (pin at scaffold; record in `docs/stack-versions.md`)

| Layer     | Choice                                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime   | Node.js current LTS, strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)                                                                                                                                                                 |
| API       | NestJS + Fastify; Zod validation (`nestjs-zod` or equivalent) → OpenAPI                                                                                                                                                                                           |
| DB        | **PostgreSQL 18**; **Drizzle ORM** (`drizzle-orm/node-postgres`) + `drizzle-kit`; `pg` driver; extensions `citext`, `btree_gist`                                                                                                                                  |
| Queue     | **pg-boss** (schema `pgboss`), dashboard `@pg-boss/dashboard` behind admin auth                                                                                                                                                                                   |
| Google    | `google-auth-library` (JWT/DWD), `@googleapis/meet`, `@googleapis/drive`, `@googleapis/workspaceevents`, `@googleapis/admin` (optional Directory), `@google-cloud/pubsub`. If a client lacks a method, call REST via the shared authenticated `GoogleHttpClient`. |
| Storage   | `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` → Cloudflare R2 (S3 API); MinIO in dev/CI                                                                                                                                           |
| Media     | `ffmpeg`/`ffprobe` via `execa`                                                                                                                                                                                                                                    |
| Edge      | Cloudflare Worker (`wrangler`), R2 binding, Cache API                                                                                                                                                                                                             |
| PDF       | `@react-pdf/renderer` + `qrcode`                                                                                                                                                                                                                                  |
| Passwords | `argon2` (argon2id)                                                                                                                                                                                                                                               |
| Mail      | `nodemailer` (SES SMTP); Mailpit in dev                                                                                                                                                                                                                           |
| Telemetry | `pino`, OpenTelemetry SDK (OTLP) → self-hosted `grafana/otel-lgtm`                                                                                                                                                                                                |
| Time      | `luxon`, `rrule`                                                                                                                                                                                                                                                  |
| Testing   | Vitest, Supertest, Testcontainers (Postgres 18, MinIO), Playwright, miniflare/`vitest-pool-workers` for the Worker                                                                                                                                                |
| Frontend  | React, Vite, TanStack Router + Query, Tailwind, shadcn/ui (Radix), react-hook-form, Zod, `hls.js`, `vite-plugin-pwa`                                                                                                                                              |

---

## 5. Cross-cutting engineering standards

### 5.1 Identifiers, time, numbers

- **IDs:** UUIDv7. Columns default to PostgreSQL 18's native `uuidv7()`. When an id is needed before insert (e.g., to put it in a job payload) generate it in app code with a v7 generator (`shared/ids.ts: newId()`). Never expose sequential ids.
- **Time:** `timestamptz` UTC; API uses RFC 3339 `Z`. Institution timezone (`Africa/Lagos` default) and per-session `timezone` are for **display and recurrence expansion only**. Domain code reads time only through an injected `Clock`.
- **Dates** without time (`date`) for academic calendar boundaries; compare in the institution timezone.
- **Exact numbers (INV-14):** scores/percentages `numeric(7,2)`; credits `numeric(4,1)`; **grade points stored as integer hundredths** (`points_x100`); GPA computed in integer arithmetic and rounded half-up to 2 dp; ratios in **basis points** (integers). Never `number` floating point for stored academic values; use a decimal helper in `shared/decimal.ts`.

### 5.2 Tenancy (INV-2) and database connections

1. Every request resolves `TenantContext {institutionId, userId, requestId}` in a global guard; no tenant ⇒ 401/403.
2. **`TenantDb.withTenant(ctx, fn)`** acquires a `pg` `PoolClient`, runs `BEGIN`, `select set_config('app.institution_id', $1, true)`, constructs `drizzle(client, { schema })` and a **pg-boss db adapter bound to the same client**, and passes `{ db, boss }` to `fn`; commits or rolls back. Because the tenant setting and all statements (including `boss.send`) share one transaction, this is safe behind PgBouncer **transaction** pooling.
3. **Connections (DO Managed PG):** two endpoints — `DATABASE_URL` (the _transaction-mode pool_ `lms-tx`) for API and tenant jobs; `DATABASE_URL_DIRECT` (non-pooled) for migrations, pg-boss workers' polling/maintenance and anything needing session state. Budget: clusters provide 25 connections per GiB RAM (4 GiB ⇒ 100). Default allocation: API 2 replicas × 10 (pool) + worker 1 × 8 (pool) + pg-boss 2 × 6 (direct) + migrator 1 = ~45. Pools are sized by env; a startup check fails if the sum exceeds `DB_CONNECTION_BUDGET`.
4. **Roles:** `lms_migrator` (owner; DDL, drizzle + pg-boss migrations), `lms_app` (no BYPASSRLS; API + tenant jobs), `lms_system` (BYPASSRLS; used **only** by the inbox router, reconciliation candidate scans, retention sweeps, platform-admin routes; every use site is listed in `docs/system-role-usage.md`).
5. **RLS template** (`lms_enable_tenant_rls(tbl regclass)` created in the first custom migration and called for every tenant table; Drizzle `pgPolicy` mirrors it for documentation/tests):

```sql
ALTER TABLE t ENABLE ROW LEVEL SECURITY; ALTER TABLE t FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON t
  USING      (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
  WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid);
```

6. **Composite FK rule:** every FK between tenant tables is `(institution_id, col) → (institution_id, id)`; every tenant table has `UNIQUE (institution_id, id)`. `packages/db/tests/tenant-fk.spec.ts` introspects `pg_catalog` and fails if any tenant→tenant FK is not composite or any tenant table lacks forced RLS.
7. Cross-tenant tests (AC-12) are a permanent CI gate: for every module, reading/writing another tenant's id returns **404** (never 403).

### 5.3 Module and table ownership

Each table in §6 lists an owner; only the owner's repositories write to it. Cross-module side effects use **domain events** (§16) enqueued transactionally — never direct writes.

### 5.4 API conventions

- Base `/v1`; JSON only; `camelCase`; RFC 3339 timestamps; gzip/br enabled; responses never include fields the caller can't use (bandwidth).
- **Pagination:** cursor-based. `?limit` (default 25, max 100), `?cursor`; response `{ items, nextCursor }`; opaque base64url cursor of `(sortKey, id)`.
- **Error envelope:** `{ "error": { "code", "message", "fieldErrors":[{path,code,message}], "requestId" } }`; codes in Appendix D; no stack traces/SQL/provider payloads.
- **Status codes:** 400 validation · 401 unauthenticated · 403 forbidden (existence already known) · 404 not found/not visible · 409 conflict/state · 412 version mismatch · 422 domain-rule · 429 rate limited (`Retry-After`) · 503 dependency unavailable.
- **Optimistic concurrency:** mutable aggregates carry `version`; `PATCH/PUT` need `If-Match: "<version>"`.
- **Idempotency:** `Idempotency-Key` (16–64 chars) **required** on: create session/series, bulk enroll, publish/unpublish VOD, release/finalize/approve results, issue transcript, start import, quiz submit. Implementation: in the same transaction insert `idempotency_keys(…status='IN_PROGRESS')` (unique `(institution_id,user_id,operation,key)`); same key + same `request_hash` + `COMPLETED` ⇒ replay stored response; `IN_PROGRESS` ⇒ 409 `IDEMPOTENCY_IN_PROGRESS`; different hash ⇒ 422 `IDEMPOTENCY_KEY_REUSED`. Keys expire after 48 h (cleanup cron).
- **Rate limiting** (no Redis; §5.7): per-replica token bucket via the Fastify rate-limit plugin with in-memory store; classes — auth 10/min/IP; join 20/min/user; playback authorize 60/min/user; progress 1 write/5 s/user/asset; default 600/min/user. Account-level brute-force lockout is DB-backed (`users.failed_login_count/locked_until`).

### 5.5 Inbox (external events) and transactional enqueue

- **Transactional enqueue (replaces the outbox):** application services call `boss.send(queue, payload, { db: trxAdapter, singletonKey, startAfter, priority, … })` inside `withTenant`. The job row commits **atomically** with the business change; if the transaction rolls back the job never exists (INV-5).
- **Inbox:** `provider_events` (unique `(provider, event_id)`); the Pub/Sub puller inserts, then acks after commit. Router job resolves the tenant (§10.8).
- **Domain events:** published as pg-boss jobs on queue `domain-event` with `name` in the payload (same transaction); a dispatcher handler fans out to in-process subscribers (notifications, entitlement invalidation, member sync). Subscribers are idempotent.

### 5.6 Jobs (pg-boss) — conventions

- Handler contract: `async handle(job)`; **idempotent**; payload carries `institutionId` and runs inside `withTenant`. Scans use `lms_system` only to _find_ candidate ids.
- **At-least-once delivery** ⇒ every handler must tolerate re-execution (upserts, unique keys, state guards).
- Per-queue options (retry limit, `retryBackoff:true`, `retryDelay`, **`expireInSeconds` ≥ 2 × P99 runtime** — pg-boss default is short and would kill long ffmpeg jobs, dead-letter queue, retention) are fixed in §16 and created at boot by `ensureQueues()`.
- **Dedupe/debounce:** use `singletonKey` (+ queue `policy` that permits one queued job per key) for "at most one pending per entity"; `sendDebounced`/`sendThrottled` with a key for `conference.sync`, `session.sync-access`.
- **Priority:** urgent provisioning/sync uses a higher `priority`.
- **Concurrency:** bound per queue using the installed pg-boss version's worker options (names differ across majors — **read the types**), plus a per-queue env cap (`QUEUE_CONCURRENCY_<NAME>`). Media queues: concurrency 1 transcode per droplet (all cores).
- **Schema management:** pg-boss migrations run via its CLI/`migrate` with `lms_migrator` in the deploy step; runtime processes start with migration disabled. Only `scheduler` role runs cron `schedule()` and supervision/maintenance; API uses a send-only instance and the transaction adapter. Archive after 7 days, delete after 30 (limit table growth).
- **Observability:** every handler emits a span, `job_duration_ms`, `job_attempts`, logs with `jobId`, `queue`, `institutionId`; the dashboard is exposed only to `PLATFORM_ADMIN` through the API gateway path `/admin/jobs`.

### 5.7 Redis-free replacements (ADR-02), precisely

| Former Redis use        | Replacement                                                                                                                                                                         | Notes                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Queue                   | pg-boss                                                                                                                                                                             | transactional enqueue                                                     |
| API rate limit          | In-memory per replica (`@fastify/rate-limit`)                                                                                                                                       | effective limit = limit × replicas; documented; auth lockout is DB-backed |
| Google quota limiter    | **Postgres function `rl_acquire(key text, capacity int, refill_per_sec numeric, cost int) returns int`** (returns ms to wait; atomic upsert on UNLOGGED table `rate_limit_buckets`) | low volume (≤ ~2 calls/s); callers delay the job instead of failing       |
| Leader election / locks | pg-boss cron leader; `pg_advisory_xact_lock(hashtext(key))` inside transactions                                                                                                     | works through PgBouncer transaction mode (xact-scoped)                    |
| Session cache           | In-process LRU, 5 s TTL                                                                                                                                                             | revocation ≤ 5 s                                                          |
| Entitlement cache       | none (indexed query < 5 ms)                                                                                                                                                         | correctness over speed                                                    |
| Realtime                | Client polling with ETag/`If-None-Match`                                                                                                                                            | ADR-17                                                                    |

### 5.8 Code quality gates

Strict TS · ESLint (typescript-eslint strict, `no-floating-promises`, `no-misused-promises`) · Prettier · Conventional Commits · no default exports in modules · `Result<T,E>` for expected domain failures, exceptions only for bugs/infrastructure · all external input parsed with Zod at the edge · `process.env` only in `shared/config`.

---

## 6. Data model (DDL)

### 6.1 Notation (expand when writing migrations)

- `@std` = `id uuid PRIMARY KEY DEFAULT uuidv7(), institution_id uuid NOT NULL REFERENCES institutions(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1, UNIQUE (institution_id, id)` (`uuidv7()` is native in PostgreSQL 18).
- `@std_ro` = same but **without** `updated_at`/`version` (append-only or immutable rows).
- `@fk(col → table)` = `FOREIGN KEY (institution_id, col) REFERENCES table (institution_id, id)` (composite tenant FK, §5.2). Add `ON DELETE RESTRICT` unless stated.
- `@rls` = call `lms_enable_tenant_rls('<table>')` after creation.
- Enumerations are `text` + `CHECK`; the allowed values mirror `contracts/enums.ts` (a test asserts they match).
- Trailing `-- owner: <module>` names the only module allowed to write the table.
- In Drizzle, express tables/columns/indexes/composite FKs/`pgPolicy` in `packages/db/src/schema/*`; everything marked _(custom SQL)_ below goes in a hand-written migration.
- Soft delete is used **only** where noted (`deleted_at`); otherwise rows are retained by status.

Migration groups (drizzle-kit; custom SQL where noted): **M01** foundation/identity · **M02** academic · **M03** live/attendance · **M04** recording/VOD · **M05** content/assessment · **M06** platform (idempotency, audit, notifications, imports, rate limits) · **M07** results/transcripts. pg-boss creates its own `pgboss` schema through its migration tooling (§5.6).

### 6.2 M01 — Foundation and identity

```sql
CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE institutions (            -- owner: identity. Global. RLS policy: id = current tenant.
  id uuid PRIMARY KEY DEFAULT uuidv7(), code citext NOT NULL UNIQUE, name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','ARCHIVED')),
  allowed_email_domains text[] NOT NULL DEFAULT '{}',      -- Google `hd` allowlist for SSO
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1);
-- A special institution row with code 'platform' hosts PLATFORM_ADMIN users.

CREATE TABLE users (                   -- owner: identity
  @std, email citext NOT NULL, display_name text NOT NULL,
  status text NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','DEACTIVATED')),
  password_hash text, password_changed_at timestamptz,
  failed_login_count int NOT NULL DEFAULT 0, locked_until timestamptz,
  locale text NOT NULL DEFAULT 'en', last_login_at timestamptz,
  UNIQUE (institution_id, email));

CREATE TABLE identities (              -- owner: identity. Links external accounts (Google user id is the key to attendance matching, §11.3)
  @std_ro, user_id uuid NOT NULL, provider text NOT NULL CHECK (provider IN ('google','oidc','local')),
  subject text NOT NULL, email citext, metadata jsonb NOT NULL DEFAULT '{}', verified_at timestamptz,
  UNIQUE (institution_id, provider, subject),
  @fk(user_id → users));

CREATE TABLE auth_sessions (           -- owner: identity (ADR-12)
  @std_ro, user_id uuid NOT NULL, token_hash bytea NOT NULL UNIQUE,      -- SHA-256 of opaque token; token only ever in cookie
  expires_at timestamptz NOT NULL, idle_expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip inet, user_agent text, revoked_at timestamptz, csrf_secret bytea NOT NULL,
  @fk(user_id → users));
CREATE INDEX ON auth_sessions (institution_id, user_id) WHERE revoked_at IS NULL;

CREATE TABLE role_assignments (        -- owner: authorization. ADMINISTRATIVE roles only.
  @std_ro, user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('PLATFORM_ADMIN','INSTITUTION_ADMIN','ACADEMIC_ADMIN','REGISTRAR','AUDITOR')),
  scope_type text NOT NULL CHECK (scope_type IN ('INSTITUTION','ORG_UNIT','PROGRAMME','COURSE_OFFERING')),
  scope_id uuid, granted_by uuid, revoked_at timestamptz, reason text,
  CHECK ((scope_type = 'INSTITUTION') = (scope_id IS NULL)),
  @fk(user_id → users));
CREATE UNIQUE INDEX role_assignments_active ON role_assignments
  (institution_id, user_id, role, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000')) WHERE revoked_at IS NULL;
-- TEACHER and STUDENT are NOT rows here: they are derived from active `teachers` / `students` profiles and scoped by
-- teaching_assignments / course_enrollments (§7).

CREATE TABLE policies (                -- owner: identity (institution settings). Versioned, append-only.
  @std_ro, policy_type text NOT NULL CHECK (policy_type IN
    ('ATTENDANCE','RECORDING','JOIN_WINDOW','GOOGLE_MEET','RETENTION','GRADING_DEFAULTS','NOTIFICATION')),
  scope_type text NOT NULL DEFAULT 'INSTITUTION' CHECK (scope_type IN ('INSTITUTION','COURSE_OFFERING')), scope_id uuid,
  policy_version int NOT NULL, config jsonb NOT NULL, effective_from timestamptz NOT NULL DEFAULT now(), created_by uuid);
CREATE UNIQUE INDEX policies_version ON policies
  (institution_id, policy_type, scope_type, COALESCE(scope_id,'00000000-0000-0000-0000-000000000000'), policy_version);

CREATE TABLE integration_configs (     -- owner: ops. Non-secret config + a pointer to the secret.
  @std, provider text NOT NULL CHECK (provider IN ('google_workspace')),
  status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN ('UNVERIFIED','VERIFIED','DEGRADED','DISABLED')),
  config jsonb NOT NULL,         -- {primaryDomain, gcpProjectId, pubsubSubscription, accessMode:'RESTRICTED'|'TRUSTED' (default RESTRICTED, ADR-10), hostStrategy:'POOL'}
  secret_ref text,               -- e.g. 'sm://lms/prod/google-sa' — never the secret itself
  verified_at timestamptz, last_error text, UNIQUE (institution_id, provider));

CREATE TABLE provider_host_accounts (  -- owner: live-session (via ops integration setup)
  @std, provider text NOT NULL DEFAULT 'google_meet', email citext NOT NULL, provider_user_id text,   -- Google users/{id}
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','THROTTLED')),
  weight int NOT NULL DEFAULT 1, UNIQUE (institution_id, provider, email));

CREATE TABLE provider_subscriptions (  -- owner: live-session. Workspace Events subscriptions (renewal tracked here)
  @std, host_account_id uuid NOT NULL, target_resource text NOT NULL, event_types text[] NOT NULL,
  remote_name text, expires_at timestamptz, status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','EXPIRING','EXPIRED','SUSPENDED','ERROR')),
  last_renewed_at timestamptz, last_error text, UNIQUE (institution_id, target_resource),
  @fk(host_account_id → provider_host_accounts));
```

`@rls` on every table above except `institutions` (own policy `id = current_setting(...)::uuid`).

### 6.3 M02 — Academic core

```sql
CREATE TABLE org_units (               -- owner: academic. Faculty/School → Department tree
  @std, parent_id uuid, kind text NOT NULL CHECK (kind IN ('FACULTY','DEPARTMENT')), code citext NOT NULL, name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')), UNIQUE (institution_id, code),
  @fk(parent_id → org_units));

CREATE TABLE programmes (              -- owner: academic
  @std, org_unit_id uuid, code citext NOT NULL, name text NOT NULL, award_type text NOT NULL,   -- e.g. 'B.Th','M.Div','Diploma'
  duration_semesters smallint, grading_scheme_id uuid, status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  UNIQUE (institution_id, code), @fk(org_unit_id → org_units));

CREATE TABLE cohorts (                 -- owner: academic
  @std, programme_id uuid NOT NULL, code citext NOT NULL, name text NOT NULL, intake_session_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')), UNIQUE (institution_id, programme_id, code),
  @fk(programme_id → programmes));

CREATE TABLE curricula (               -- owner: academic. Versioned; historical enrollments keep the version they started on.
  @std, programme_id uuid NOT NULL, curriculum_version int NOT NULL, effective_from date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  UNIQUE (institution_id, programme_id, curriculum_version), @fk(programme_id → programmes));

CREATE TABLE courses (                 -- owner: academic. Reusable definition. No teacher/semester here.
  @std, code citext NOT NULL, title text NOT NULL, description text, credits numeric(4,1) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')), UNIQUE (institution_id, code));

CREATE TABLE curriculum_courses (      -- owner: academic. Compulsory/elective lives HERE, not on courses.
  @std, curriculum_id uuid NOT NULL, course_id uuid NOT NULL, level_no smallint NOT NULL, semester_no smallint NOT NULL,
  course_type text NOT NULL CHECK (course_type IN ('COMPULSORY','ELECTIVE')), elective_group text, credit_override numeric(4,1),
  UNIQUE (institution_id, curriculum_id, course_id), @fk(curriculum_id → curricula), @fk(course_id → courses));

CREATE TABLE academic_sessions (       -- owner: academic
  @std, code citext NOT NULL, name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','CLOSED')),
  UNIQUE (institution_id, code), CHECK (ends_on > starts_on));

CREATE TABLE semesters (               -- owner: academic
  @std, academic_session_id uuid NOT NULL, code citext NOT NULL, name text NOT NULL, sequence smallint NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL, registration_opens_on date, registration_closes_on date, add_drop_deadline_on date,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','REGISTRATION','ACTIVE','CLOSED')),
  UNIQUE (institution_id, academic_session_id, sequence), UNIQUE (institution_id, academic_session_id, code),
  CHECK (ends_on > starts_on), @fk(academic_session_id → academic_sessions));

CREATE TABLE students (                -- owner: enrollment
  @std, user_id uuid NOT NULL UNIQUE, student_number text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ADMITTED','ACTIVE','SUSPENDED','GRADUATED','WITHDRAWN')),
  given_name text NOT NULL, family_name text NOT NULL, phone text,                -- data minimisation: add fields only with a requirement
  UNIQUE (institution_id, student_number), @fk(user_id → users));

CREATE TABLE teachers (                -- owner: teaching
  @std, user_id uuid NOT NULL UNIQUE, staff_code text, kind text NOT NULL DEFAULT 'INTERNAL' CHECK (kind IN ('INTERNAL','GUEST')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')), given_name text NOT NULL, family_name text NOT NULL, bio text,
  UNIQUE (institution_id, staff_code), @fk(user_id → users));

CREATE TABLE programme_enrollments (   -- owner: enrollment
  @std, student_id uuid NOT NULL, programme_id uuid NOT NULL, curriculum_id uuid NOT NULL, entry_session_id uuid NOT NULL, cohort_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DEFERRED','WITHDRAWN','COMPLETED')), started_on date NOT NULL, ended_on date,
  @fk(student_id → students), @fk(programme_id → programmes), @fk(curriculum_id → curricula),
  @fk(entry_session_id → academic_sessions), @fk(cohort_id → cohorts));
CREATE UNIQUE INDEX one_active_programme_enrollment ON programme_enrollments (institution_id, student_id, programme_id) WHERE status = 'ACTIVE';

CREATE TABLE semester_enrollments (    -- owner: enrollment
  @std, programme_enrollment_id uuid NOT NULL, semester_id uuid NOT NULL, level_no smallint NOT NULL,
  status text NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED','WITHDRAWN','COMPLETED')),
  UNIQUE (institution_id, programme_enrollment_id, semester_id),
  @fk(programme_enrollment_id → programme_enrollments), @fk(semester_id → semesters));

CREATE TABLE course_offerings (        -- owner: academic
  @std, course_id uuid NOT NULL, semester_id uuid NOT NULL, section_code text NOT NULL DEFAULT '01', title_override text,
  delivery_mode text NOT NULL DEFAULT 'LIVE_ONLINE' CHECK (delivery_mode IN ('LIVE_ONLINE','ASYNC_ONLY')),
  capacity int CHECK (capacity IS NULL OR capacity > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ACTIVE','COMPLETED','CANCELLED')),
  registration_opens_at timestamptz, registration_closes_at timestamptz, completed_at timestamptz,
  policy_overrides jsonb NOT NULL DEFAULT '{}',
  UNIQUE (institution_id, course_id, semester_id, section_code), @fk(course_id → courses), @fk(semester_id → semesters));

CREATE TABLE offering_audiences (      -- owner: academic. Who the offering is FOR (eligibility/display). NOT an entitlement source.
  @std_ro, course_offering_id uuid NOT NULL, programme_id uuid NOT NULL, level_no smallint, cohort_id uuid,
  UNIQUE NULLS NOT DISTINCT (institution_id, course_offering_id, programme_id, level_no, cohort_id),
  @fk(course_offering_id → course_offerings), @fk(programme_id → programmes), @fk(cohort_id → cohorts));

CREATE TABLE course_enrollments (      -- owner: enrollment. THE entitlement source for students.
  @std, semester_enrollment_id uuid NOT NULL, course_offering_id uuid NOT NULL, student_id uuid NOT NULL,   -- student_id denormalised; trigger enforces consistency
  enrollment_type text NOT NULL DEFAULT 'CREDIT' CHECK (enrollment_type IN ('CREDIT','AUDIT')),
  status text NOT NULL DEFAULT 'ENROLLED' CHECK (status IN ('PENDING','ENROLLED','DROPPED','WITHDRAWN','COMPLETED')),
  enrolled_at timestamptz, dropped_at timestamptz,
  @fk(semester_enrollment_id → semester_enrollments), @fk(course_offering_id → course_offerings), @fk(student_id → students));
CREATE UNIQUE INDEX one_live_course_enrollment ON course_enrollments (institution_id, student_id, course_offering_id)
  WHERE status IN ('PENDING','ENROLLED','COMPLETED');
CREATE INDEX ON course_enrollments (institution_id, course_offering_id, status);
-- Trigger: course_enrollments.student_id MUST equal programme_enrollments.student_id reached via semester_enrollment_id; reject otherwise.

CREATE TABLE course_enrollment_events ( -- owner: enrollment. Status history (FR-008)
  @std_ro, course_enrollment_id uuid NOT NULL, from_status text, to_status text NOT NULL, actor_user_id uuid, reason text,
  @fk(course_enrollment_id → course_enrollments));

CREATE TABLE teaching_assignments (    -- owner: teaching
  @std, course_offering_id uuid NOT NULL, teacher_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('PRIMARY','CO_TEACHER','ASSISTANT','GUEST_LECTURER','FACILITATOR')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')), capability_overrides jsonb NOT NULL DEFAULT '{}',
  starts_on date, ends_on date, @fk(course_offering_id → course_offerings), @fk(teacher_id → teachers));
CREATE UNIQUE INDEX one_active_assignment ON teaching_assignments (institution_id, course_offering_id, teacher_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX one_active_primary ON teaching_assignments (institution_id, course_offering_id) WHERE status = 'ACTIVE' AND role = 'PRIMARY';
```

Entitlement read-model (owner: authorization; `lms_app` read-only) — **the single source for "who may access this offering"**:

```sql
CREATE VIEW v_offering_access AS
SELECT ce.institution_id, s.user_id, ce.course_offering_id, 'STUDENT' AS access_kind, ce.status AS source_status
  FROM course_enrollments ce JOIN students s ON s.institution_id = ce.institution_id AND s.id = ce.student_id
 WHERE ce.status = 'ENROLLED' AND s.status IN ('ACTIVE','ADMITTED')
UNION ALL
SELECT ta.institution_id, t.user_id, ta.course_offering_id, 'STAFF', ta.role
  FROM teaching_assignments ta JOIN teachers t ON t.institution_id = ta.institution_id AND t.id = ta.teacher_id
 WHERE ta.status = 'ACTIVE' AND t.status = 'ACTIVE';
-- The post-completion window (the 180-day post-completion rule (§12.9)) is applied in EntitlementService (needs policy + offering.completed_at), not in the view.
-- Views must be created WITH (security_invoker = true) so RLS of the caller applies.
```

### 6.4 M03 — Live sessions and attendance

```sql
CREATE TABLE live_session_series (     -- owner: scheduling
  @std, course_offering_id uuid NOT NULL, title_template text NOT NULL, rrule text NOT NULL, timezone text NOT NULL,
  starts_on date NOT NULL, until_on date, start_time time NOT NULL, duration_minutes int NOT NULL CHECK (duration_minutes BETWEEN 5 AND 600),
  generated_through date, status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')), created_by uuid,
  @fk(course_offering_id → course_offerings));

CREATE TABLE live_sessions (           -- owner: live-session
  @std, course_offering_id uuid NOT NULL, series_id uuid, title text NOT NULL, description text,
  scheduled_start timestamptz NOT NULL, scheduled_end timestamptz NOT NULL, timezone text NOT NULL,
  state text NOT NULL DEFAULT 'SCHEDULED' CHECK (state IN ('SCHEDULED','OPEN','LIVE','ENDED','CANCELLED','NO_SHOW')),
  provider text NOT NULL DEFAULT 'google_meet',
  provider_status text NOT NULL DEFAULT 'PENDING' CHECK (provider_status IN ('PENDING','PROVISIONING','READY','ERROR')),
  provider_space_id text, provider_meeting_code text, join_url text, host_account_id uuid, provisioned_at timestamptz, provision_error text,
  recording_mode text NOT NULL DEFAULT 'AUTO' CHECK (recording_mode IN ('AUTO','MANUAL','OFF')),
  attendance_state text NOT NULL DEFAULT 'PENDING' CHECK (attendance_state IN ('PENDING','PROVISIONAL','FINAL','REVIEW_REQUIRED')),
  policy_snapshot jsonb NOT NULL,      -- {joinWindow, recording, attendance:{policyVersion}} frozen at creation; attendance policy re-snapshotted at finalization
  first_conference_started_at timestamptz, last_conference_ended_at timestamptz, finalized_at timestamptz,
  cancelled_at timestamptz, cancel_reason text, created_by uuid NOT NULL,
  occurrence_date date, series_exception boolean NOT NULL DEFAULT false, access_synced_at timestamptz,
  CHECK (scheduled_end > scheduled_start),
  @fk(course_offering_id → course_offerings), @fk(series_id → live_session_series), @fk(host_account_id → provider_host_accounts));
CREATE UNIQUE INDEX live_sessions_series_occurrence ON live_sessions (institution_id, series_id, occurrence_date) WHERE series_id IS NOT NULL;
CREATE UNIQUE INDEX live_sessions_provider_space ON live_sessions (provider, provider_space_id) WHERE provider_space_id IS NOT NULL;
CREATE INDEX ON live_sessions (institution_id, course_offering_id, scheduled_start);
CREATE INDEX ON live_sessions (institution_id, state, scheduled_start) WHERE state IN ('SCHEDULED','OPEN','LIVE');
CREATE INDEX ON live_sessions (provider_status, scheduled_start) WHERE provider_status IN ('PENDING','ERROR');

CREATE TABLE session_teacher_slots (   -- owner: scheduling. Maintained transactionally with sessions and teaching assignments (§9.5). DB-level conflict guard (INV-4).
  @std_ro, live_session_id uuid NOT NULL, teacher_id uuid NOT NULL, during tstzrange NOT NULL,
  override boolean NOT NULL DEFAULT false, override_reason text,
  @fk(live_session_id → live_sessions), @fk(teacher_id → teachers),
  CONSTRAINT no_teacher_overlap EXCLUDE USING gist (institution_id WITH =, teacher_id WITH =, during WITH &&) WHERE (NOT override));   -- custom SQL (btree_gist)

CREATE TABLE session_join_log (        -- owner: live-session. High-volume; consider monthly partitioning
  @std_ro, live_session_id uuid NOT NULL, user_id uuid NOT NULL, outcome text NOT NULL CHECK (outcome IN ('AUTHORIZED','DENIED')),
  deny_reason text, device text, authorized_at timestamptz NOT NULL DEFAULT now(), @fk(live_session_id → live_sessions));
CREATE INDEX ON session_join_log (institution_id, live_session_id, authorized_at);

CREATE TABLE conference_records (      -- owner: live-session. A space can host SEVERAL conferences over time.
  @std, live_session_id uuid NOT NULL, provider_conference_id text NOT NULL,       -- 'conferenceRecords/{id}'
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')), started_at timestamptz NOT NULL, ended_at timestamptz,
  dirty boolean NOT NULL DEFAULT true, last_synced_at timestamptz, UNIQUE (provider_conference_id),
  @fk(live_session_id → live_sessions));
CREATE INDEX ON conference_records (institution_id, live_session_id);
CREATE INDEX ON conference_records (dirty, last_synced_at) WHERE dirty;

CREATE TABLE provider_events (         -- owner: live-session. DURABLE INBOX (§5.5). institution_id NULL until routed. Raw payload immutable.
  id uuid PRIMARY KEY, institution_id uuid REFERENCES institutions(id), provider text NOT NULL, event_id text NOT NULL, event_type text NOT NULL,
  subject text, payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','ROUTED','PROCESSED','IGNORED','FAILED')),
  attempts int NOT NULL DEFAULT 0, last_error text, processed_at timestamptz, UNIQUE (provider, event_id));
CREATE INDEX ON provider_events (status, received_at) WHERE status IN ('RECEIVED','ROUTED','FAILED');

CREATE TABLE provider_participant_sessions (  -- owner: attendance. RAW EVIDENCE (INV-7): upserted by provider resource name until finalized, never deleted.
  @std, live_session_id uuid NOT NULL, conference_record_id uuid NOT NULL,
  provider_participant_id text NOT NULL, provider_session_id text NOT NULL,            -- full resource names
  participant_kind text NOT NULL CHECK (participant_kind IN ('SIGNED_IN','ANONYMOUS','PHONE')),
  provider_user_id text, display_name text, started_at timestamptz NOT NULL, ended_at timestamptz,
  matched_user_id uuid, match_method text NOT NULL DEFAULT 'NONE' CHECK (match_method IN ('NONE','OIDC_SUB','DIRECTORY','EMAIL','MANUAL')),
  raw jsonb NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, provider_session_id),
  @fk(live_session_id → live_sessions), @fk(conference_record_id → conference_records), @fk(matched_user_id → users));
CREATE INDEX ON provider_participant_sessions (institution_id, live_session_id, matched_user_id);

CREATE TABLE attendance_records (      -- owner: attendance. DERIVED projection + audited override.
  @std, live_session_id uuid NOT NULL, student_id uuid NOT NULL,
  computed_status text NOT NULL CHECK (computed_status IN ('PRESENT','PARTIAL','ABSENT')),
  override_status text CHECK (override_status IN ('PRESENT','PARTIAL','ABSENT','EXCUSED')),
  status text GENERATED ALWAYS AS (COALESCE(override_status, computed_status)) VIRTUAL,   -- PG18 virtual generated column (custom SQL migration)
  attended_seconds int NOT NULL, effective_seconds int NOT NULL, ratio numeric(6,5) NOT NULL,
  first_join_at timestamptz, last_leave_at timestamptz, late boolean NOT NULL DEFAULT false, join_count int NOT NULL DEFAULT 0,
  calc_version int NOT NULL DEFAULT 1, policy_version int NOT NULL, computed_at timestamptz NOT NULL,
  override_by uuid, override_reason text, overridden_at timestamptz,
  CHECK ((override_status IS NULL) = (override_reason IS NULL)),
  UNIQUE (institution_id, live_session_id, student_id), @fk(live_session_id → live_sessions), @fk(student_id → students));
CREATE INDEX ON attendance_records (institution_id, student_id);
```

### 6.5 M04 — Recording and VOD (HLS ladder)

```sql
CREATE TABLE recording_assets (        -- owner: vod. One row per provider recording (a conference may have several).
  @std, live_session_id uuid NOT NULL, conference_record_id uuid NOT NULL, part_no int NOT NULL DEFAULT 1,
  provider_recording_id text NOT NULL, drive_file_id text,
  status text NOT NULL DEFAULT 'DISCOVERED' CHECK (status IN
    ('DISCOVERED','COPYING','PROBING','TRANSCODING','READY','FAILED','SOURCE_MISSING','PURGED')),
  attempt_count int NOT NULL DEFAULT 0, last_error_code text, last_error text,
  source_size_bytes bigint, source_md5 text, source_mime text, source_duration_ms bigint,        -- Drive metadata
  source_width int, source_height int, source_fps numeric(6,2), source_vcodec text, source_acodec text,   -- ffprobe
  recording_started_at timestamptz, recording_ended_at timestamptz,
  source_key text, stored_size_bytes bigint, stored_md5 text, probed_duration_ms bigint, copied_at timestamptz,
  source_delete_after timestamptz, source_deleted_at timestamptz,                                  -- 14-day safety window, then purge
  drive_cleanup_status text NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (drive_cleanup_status IN ('NOT_REQUESTED','PENDING','TRASHED','FAILED')),
  UNIQUE (institution_id, provider_recording_id), UNIQUE (institution_id, drive_file_id),
  @fk(live_session_id → live_sessions), @fk(conference_record_id → conference_records));
CREATE INDEX ON recording_assets (status, updated_at) WHERE status NOT IN ('READY','PURGED');

CREATE TABLE vod_assets (              -- owner: vod. Learner-facing object.
  @std, course_offering_id uuid NOT NULL, live_session_id uuid, recording_asset_id uuid,
  origin text NOT NULL CHECK (origin IN ('RECORDING','UPLOAD')), title text NOT NULL, description text, position int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING','PUBLISHED','UNPUBLISHED','FAILED','ARCHIVED','PURGED')),
  visibility text NOT NULL DEFAULT 'ENROLLED' CHECK (visibility IN ('ENROLLED','STAFF_ONLY')),
  playable_at timestamptz,                      -- set when the first rung + audio-only are READY (progressive publication)
  ladder_complete boolean NOT NULL DEFAULT false,
  publish_after timestamptz, unpublish_at timestamptz, published_at timestamptz,
  duration_ms bigint, poster_key text, storage_prefix text NOT NULL,          -- 'i/{institutionId}/vod/{id}/'
  legal_hold boolean NOT NULL DEFAULT false, purge_after timestamptz, purged_at timestamptz,
  UNIQUE (institution_id, recording_asset_id),
  @fk(course_offering_id → course_offerings), @fk(live_session_id → live_sessions), @fk(recording_asset_id → recording_assets));
CREATE INDEX ON vod_assets (institution_id, course_offering_id, status, position);
CREATE INDEX ON vod_assets (purge_after) WHERE status <> 'PURGED' AND NOT legal_hold;

CREATE TABLE vod_renditions (          -- owner: vod. One row per HLS rung / audio / source.
  @std, vod_asset_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('SOURCE_MP4','HLS_240','HLS_360','HLS_480','HLS_720','HLS_AUDIO')),
  storage_prefix text NOT NULL, size_bytes bigint, bandwidth_bps int, avg_bandwidth_bps int, width int, height int, fps numeric(5,2),
  codec_video text, codec_audio text, segment_seconds int, segment_count int, playlist_key text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','READY','FAILED')), ready_at timestamptz, last_error text,
  UNIQUE (institution_id, vod_asset_id, kind), @fk(vod_asset_id → vod_assets));

CREATE TABLE playback_progress (       -- owner: vod
  @std, vod_asset_id uuid NOT NULL, user_id uuid NOT NULL, position_ms bigint NOT NULL, max_position_ms bigint NOT NULL,
  duration_ms bigint NOT NULL, percent_complete numeric(5,2) NOT NULL, completed boolean NOT NULL DEFAULT false, completed_at timestamptz,
  UNIQUE (institution_id, vod_asset_id, user_id), @fk(vod_asset_id → vod_assets), @fk(user_id → users));

CREATE TABLE playback_events (         -- owner: vod. Append-only, sampled (PLAY, PAUSE, SEEK, COMPLETE, ERROR, QUALITY, AUDIO_ONLY); partition monthly on occurred_at.
  @std_ro, vod_asset_id uuid NOT NULL, user_id uuid NOT NULL, event_type text NOT NULL, position_ms bigint, occurred_at timestamptz NOT NULL, detail jsonb);

CREATE TABLE transcript_assets (       -- owner: vod. Speech transcript (VOD-008). Meet transcript ENTRIES expire 30 days after the conference — ingest promptly.
  @std, live_session_id uuid NOT NULL, conference_record_id uuid NOT NULL, provider_transcript_id text NOT NULL, drive_file_id text,
  status text NOT NULL DEFAULT 'DISCOVERED' CHECK (status IN ('DISCOVERED','READY','FAILED','UNAVAILABLE','PURGED')), vtt_key text, text_key text,
  UNIQUE (institution_id, provider_transcript_id), @fk(live_session_id → live_sessions), @fk(conference_record_id → conference_records));
```

### 6.6 M05 — Content and assessment

```sql
CREATE TABLE files (                   -- owner: content. Every uploaded learner/teacher file.
  @std, owner_user_id uuid NOT NULL, storage_key text NOT NULL UNIQUE, original_name text NOT NULL, mime text NOT NULL, size_bytes bigint NOT NULL,
  sha256 text, status text NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (status IN ('PENDING_UPLOAD','AVAILABLE','QUARANTINED','DELETED')),
  scan_status text NOT NULL DEFAULT 'NOT_SCANNED' CHECK (scan_status IN ('NOT_SCANNED','CLEAN','INFECTED','ERROR')), @fk(owner_user_id → users));

CREATE TABLE course_materials (        -- owner: content
  @std, course_offering_id uuid NOT NULL, section_label text, title text NOT NULL, kind text NOT NULL CHECK (kind IN ('FILE','LINK','TEXT')),
  file_id uuid, url text, body_md text, visibility text NOT NULL DEFAULT 'ENROLLED' CHECK (visibility IN ('ENROLLED','STAFF_ONLY')),
  publish_at timestamptz, position int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  @fk(course_offering_id → course_offerings), @fk(file_id → files));

CREATE TABLE announcements (           -- owner: content
  @std, course_offering_id uuid NOT NULL, author_user_id uuid NOT NULL, live_session_id uuid, title text NOT NULL, body_md text NOT NULL,
  pinned boolean NOT NULL DEFAULT false, published_at timestamptz, @fk(course_offering_id → course_offerings), @fk(author_user_id → users));

CREATE TABLE assessments (             -- owner: assessment. The GRADEBOOK COLUMN. Assignments/quizzes each own exactly one.
  @std, course_offering_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('ASSIGNMENT','QUIZ','EXAM','MANUAL')), title text NOT NULL,
  max_score numeric(7,2) NOT NULL CHECK (max_score > 0), weight numeric(5,2) NOT NULL CHECK (weight >= 0 AND weight <= 100),
  position int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')), due_at timestamptz,
  @fk(course_offering_id → course_offerings));

CREATE TABLE assignments (             -- owner: assessment
  @std, course_offering_id uuid NOT NULL, assessment_id uuid NOT NULL UNIQUE, instructions_md text NOT NULL, due_at timestamptz NOT NULL, cutoff_at timestamptz,
  max_attempts int NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10), late_policy jsonb NOT NULL DEFAULT '{"allowLate":false}',
  submission_types text[] NOT NULL DEFAULT '{FILE,TEXT}', max_file_mb int NOT NULL DEFAULT 50,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')), @fk(course_offering_id → course_offerings), @fk(assessment_id → assessments));

CREATE TABLE assignment_attachments ( @std_ro, assignment_id uuid NOT NULL, file_id uuid NOT NULL, @fk(assignment_id → assignments), @fk(file_id → files)); -- owner: assessment

CREATE TABLE assignment_submissions (  -- owner: assessment
  @std, assignment_id uuid NOT NULL, student_id uuid NOT NULL, attempt_no int NOT NULL, text_body text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','RETURNED')), submitted_at timestamptz, is_late boolean NOT NULL DEFAULT false,
  UNIQUE (institution_id, assignment_id, student_id, attempt_no), @fk(assignment_id → assignments), @fk(student_id → students));
CREATE TABLE submission_files ( @std_ro, submission_id uuid NOT NULL, file_id uuid NOT NULL, @fk(submission_id → assignment_submissions), @fk(file_id → files)); -- owner: assessment

CREATE TABLE questions (               -- owner: assessment. Course-level bank (reusable across offerings of the same course).
  @std, course_id uuid NOT NULL, author_user_id uuid NOT NULL,
  qtype text NOT NULL CHECK (qtype IN ('MCQ_SINGLE','MCQ_MULTI','TRUE_FALSE','SHORT_TEXT','ESSAY')), prompt_md text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]',     -- [{id,text,correct}] ; SHORT_TEXT: {acceptedAnswers:[...],caseSensitive}
  default_points numeric(6,2) NOT NULL DEFAULT 1, explanation_md text, status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  @fk(course_id → courses), @fk(author_user_id → users));

CREATE TABLE quizzes (                 -- owner: assessment
  @std, course_offering_id uuid NOT NULL, assessment_id uuid NOT NULL UNIQUE, title text NOT NULL, instructions_md text,
  time_limit_minutes int, max_attempts int NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10),
  attempt_scoring text NOT NULL DEFAULT 'HIGHEST' CHECK (attempt_scoring IN ('HIGHEST','LAST','AVERAGE')),
  opens_at timestamptz, closes_at timestamptz, shuffle_questions boolean NOT NULL DEFAULT false,
  show_answers text NOT NULL DEFAULT 'AFTER_CLOSE' CHECK (show_answers IN ('NEVER','AFTER_ATTEMPT','AFTER_CLOSE')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED')), @fk(course_offering_id → course_offerings), @fk(assessment_id → assessments));
CREATE TABLE quiz_questions ( @std_ro, quiz_id uuid NOT NULL, question_id uuid NOT NULL, position int NOT NULL, points numeric(6,2) NOT NULL,
  UNIQUE (institution_id, quiz_id, question_id), @fk(quiz_id → quizzes), @fk(question_id → questions)); -- owner: assessment

CREATE TABLE quiz_attempts (           -- owner: assessment. question_snapshot FREEZES content at start so later edits never alter history.
  @std, quiz_id uuid NOT NULL, student_id uuid NOT NULL, attempt_no int NOT NULL, started_at timestamptz NOT NULL, deadline_at timestamptz, submitted_at timestamptz,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','SUBMITTED','GRADED','EXPIRED')),
  question_snapshot jsonb NOT NULL, auto_score numeric(7,2), manual_score numeric(7,2), score numeric(7,2),
  UNIQUE (institution_id, quiz_id, student_id, attempt_no), @fk(quiz_id → quizzes), @fk(student_id → students));
CREATE TABLE quiz_responses ( @std, attempt_id uuid NOT NULL, question_id uuid NOT NULL, response jsonb, is_correct boolean, points_awarded numeric(6,2), grader_comment text,
  UNIQUE (institution_id, attempt_id, question_id), @fk(attempt_id → quiz_attempts)); -- owner: assessment

CREATE TABLE grades (                  -- owner: assessment. One row per (assessment, student).
  @std, course_offering_id uuid NOT NULL, assessment_id uuid NOT NULL, student_id uuid NOT NULL, score numeric(7,2),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RELEASED','EXCUSED')), feedback_md text, graded_by uuid, graded_at timestamptz, released_at timestamptz,
  UNIQUE (institution_id, assessment_id, student_id), @fk(course_offering_id → course_offerings), @fk(assessment_id → assessments), @fk(student_id → students));
CREATE TABLE grade_changes (           -- owner: assessment. Append-only history (FR-019) in addition to audit_logs.
  @std_ro, grade_id uuid NOT NULL, old_score numeric(7,2), new_score numeric(7,2), old_status text, new_status text, changed_by uuid NOT NULL, reason text, @fk(grade_id → grades));

-- grade scales, course results, GPA and transcripts: see §6.9 (M07).
```

### 6.7 M06 — Platform tables

```sql
CREATE UNLOGGED TABLE rate_limit_buckets (  -- owner: shared platform. Google quota token buckets (§10.7). Loss on crash is harmless.
  key text PRIMARY KEY, tokens double precision NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
-- custom SQL: FUNCTION rl_acquire(p_key text, p_capacity int, p_refill_per_sec numeric, p_cost int DEFAULT 1) RETURNS int
--   1) INSERT … ON CONFLICT DO NOTHING (new bucket starts full);  2) SELECT … FOR UPDATE the row;
--   3) tokens := LEAST(p_capacity, tokens + extract(epoch FROM now() - updated_at) * p_refill_per_sec);
--   4) if tokens >= p_cost: tokens -= p_cost; return 0  else return ceil((p_cost - tokens) / p_refill_per_sec * 1000)  (milliseconds to wait; nothing deducted).
-- There is NO outbox table: follow-up work is enqueued with pg-boss inside the same transaction (§5.5).

CREATE TABLE idempotency_keys (        -- owner: shared platform
  @std_ro, user_id uuid NOT NULL, operation text NOT NULL, key text NOT NULL, request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED')), response_status int, response_body jsonb, expires_at timestamptz NOT NULL,
  UNIQUE (institution_id, user_id, operation, key));

CREATE TABLE audit_logs (              -- owner: audit. APPEND-ONLY: REVOKE UPDATE, DELETE; plus trigger raising on UPDATE/DELETE. Partition monthly.
  id uuid NOT NULL, institution_id uuid REFERENCES institutions(id), actor_user_id uuid, actor_type text NOT NULL CHECK (actor_type IN ('USER','SYSTEM','JOB','PROVIDER')),
  action text NOT NULL, resource_type text NOT NULL, resource_id text, outcome text NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILURE')),
  metadata jsonb NOT NULL DEFAULT '{}', request_id text, ip inet, user_agent text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (id, created_at));
CREATE INDEX ON audit_logs (institution_id, created_at DESC); CREATE INDEX ON audit_logs (institution_id, resource_type, resource_id);

CREATE TABLE notifications (           -- owner: notifications
  @std_ro, user_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL, body text, data jsonb NOT NULL DEFAULT '{}', read_at timestamptz,
  email_status text NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (email_status IN ('NOT_REQUESTED','PENDING','SENT','FAILED')), dedupe_key text,
  UNIQUE (institution_id, user_id, dedupe_key), @fk(user_id → users));
CREATE INDEX ON notifications (institution_id, user_id, created_at DESC);
CREATE TABLE notification_preferences ( @std, user_id uuid NOT NULL, kind text NOT NULL, in_app boolean NOT NULL DEFAULT true, email boolean NOT NULL DEFAULT true,
  UNIQUE (institution_id, user_id, kind), @fk(user_id → users)); -- owner: notifications

CREATE TABLE import_jobs (             -- owner: imports
  @std, kind text NOT NULL CHECK (kind IN ('USERS','STUDENTS','TEACHERS','COURSE_ENROLLMENTS')), file_id uuid NOT NULL, dry_run boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED')), stats jsonb NOT NULL DEFAULT '{}', error_file_id uuid,
  created_by uuid NOT NULL, @fk(file_id → files));
```

**Ops read models** (views, `security_invoker`): `v_ops_failures` unions `provider_events(status='FAILED')`, `recording_assets(status IN ('FAILED','SOURCE_MISSING'))`, `live_sessions(provider_status='ERROR')`, pg-boss jobs in `failed`/`retry` state beyond policy and `pgboss` dead-letter queues, `provider_subscriptions(status<>'ACTIVE')` — consumed by `/v1/admin/ops/failures` (§14.3).

### 6.8 Index and performance requirements

Beyond indexes above, add (justify with `EXPLAIN` in PR): `course_enrollments (institution_id, student_id, status)`; `live_sessions (institution_id, scheduled_start)` for the schedule feed; `vod_assets (institution_id, course_offering_id, status, position)`; `attendance_records (institution_id, live_session_id)`; `grades (institution_id, course_offering_id, student_id)`. The VOD authorization query (§12.7) and the join authorization query (§10.6) must each execute in < 5 ms on the seeded load-test dataset; both are covered by `EXPLAIN (ANALYZE)` assertions in CI (no seq scans on tables > 10k rows).

### 6.9 M07 — Results, GPA and transcripts

```sql
CREATE TABLE grading_schemes (         -- owner: results. IMMUTABLE once used (locked_at set at first result); edits create a new row (supersedes_id).
  @std, name text NOT NULL, kind text NOT NULL CHECK (kind IN ('NUC_5','US_4','CUSTOM')),
  bands jsonb NOT NULL,         -- [{"minX100":7000,"maxX100":10000,"letter":"A","pointsX100":500,"pass":true}, …]  percent×100; contiguous 0–10000
  class_bands jsonb NOT NULL,   -- [{"minCgpaX100":450,"maxCgpaX100":500,"label":"First Class Honours"}, …]
  max_points_x100 int NOT NULL, pass_mark_x100 int NOT NULL,
  repeat_policy text NOT NULL DEFAULT 'BEST' CHECK (repeat_policy IN ('KEEP_ALL','REPLACE_LATEST','BEST')),
  good_standing_cgpa_x100 int NOT NULL DEFAULT 150, probation_cgpa_x100 int,
  is_default boolean NOT NULL DEFAULT false, supersedes_id uuid, locked_at timestamptz, UNIQUE (institution_id, name));
CREATE UNIQUE INDEX one_default_scheme ON grading_schemes (institution_id) WHERE is_default;
-- M07 also adds: ALTER TABLE programmes ADD CONSTRAINT … FOREIGN KEY (institution_id, grading_scheme_id) REFERENCES grading_schemes (institution_id, id);

CREATE TABLE course_results (          -- owner: results. One per course enrollment. Derived from the gradebook; frozen when FINALIZED.
  @std, course_enrollment_id uuid NOT NULL UNIQUE, course_offering_id uuid NOT NULL, course_id uuid NOT NULL, student_id uuid NOT NULL,
  grading_scheme_id uuid NOT NULL, attempt_no int NOT NULL DEFAULT 1,
  credits_x10 int NOT NULL,                       -- 3.0 credits ⇒ 30 (snapshot of the course/curriculum credit at finalization)
  final_pct_x100 int, letter text, points_x100 int,          -- 4.50 ⇒ 450
  quality_points_x1000 bigint,                    -- credits_x10 × points_x100
  result_kind text NOT NULL DEFAULT 'GRADED' CHECK (result_kind IN ('GRADED','INCOMPLETE','WITHDRAWN','EXEMPT','AUDIT')),
  counts_in_gpa boolean NOT NULL DEFAULT true, passed boolean,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','FINALIZED','APPROVED','PUBLISHED')),
  finalized_by uuid, finalized_at timestamptz, approved_by uuid, approved_at timestamptz, published_at timestamptz, reopened_count int NOT NULL DEFAULT 0,
  @fk(course_enrollment_id → course_enrollments), @fk(course_offering_id → course_offerings), @fk(course_id → courses),
  @fk(student_id → students), @fk(grading_scheme_id → grading_schemes));
CREATE INDEX ON course_results (institution_id, student_id, course_id);

CREATE TABLE course_result_revisions ( -- owner: results. Append-only (INV-11).
  @std_ro, course_result_id uuid NOT NULL, change_kind text NOT NULL, old_value jsonb, new_value jsonb, changed_by uuid NOT NULL, reason text NOT NULL, @fk(course_result_id → course_results));

CREATE TABLE semester_results (        -- owner: results. Per programme enrollment per semester; recomputed deterministically.
  @std, programme_enrollment_id uuid NOT NULL, semester_id uuid NOT NULL,
  credits_attempted_x10 int NOT NULL, credits_earned_x10 int NOT NULL, quality_points_x1000 bigint NOT NULL, gpa_x100 int,
  cum_credits_attempted_x10 int NOT NULL, cum_credits_earned_x10 int NOT NULL, cum_quality_points_x1000 bigint NOT NULL, cgpa_x100 int,
  standing text NOT NULL DEFAULT 'UNKNOWN' CHECK (standing IN ('GOOD','PROBATION','WITHDRAW_REQUIRED','UNKNOWN')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','PUBLISHED')),
  computed_at timestamptz NOT NULL, calc_version int NOT NULL DEFAULT 1, approved_by uuid, approved_at timestamptz, published_at timestamptz,
  UNIQUE (institution_id, programme_enrollment_id, semester_id), @fk(programme_enrollment_id → programme_enrollments), @fk(semester_id → semesters));

CREATE TABLE degree_awards (           -- owner: results
  @std, programme_enrollment_id uuid NOT NULL UNIQUE, cgpa_x100 int NOT NULL, class_label text, credits_earned_x10 int NOT NULL, awarded_on date,
  certificate_no text, status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CONFERRED')), approved_by uuid, approved_at timestamptz,
  UNIQUE (institution_id, certificate_no), @fk(programme_enrollment_id → programme_enrollments));

CREATE TABLE transcript_requests (     -- owner: transcripts
  @std, student_id uuid NOT NULL, programme_enrollment_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('UNOFFICIAL','OFFICIAL')),
  purpose text, recipient_name text, recipient_email citext,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','ISSUED','CANCELLED')),
  decided_by uuid, decided_at timestamptz, decision_reason text, @fk(student_id → students), @fk(programme_enrollment_id → programme_enrollments));

CREATE TABLE transcripts (             -- owner: transcripts. IMMUTABLE issued documents (tamper-evident).
  @std_ro, student_id uuid NOT NULL, programme_enrollment_id uuid NOT NULL, request_id uuid, kind text NOT NULL CHECK (kind IN ('UNOFFICIAL','OFFICIAL')),
  serial_no text NOT NULL, verification_code text NOT NULL UNIQUE,          -- globally unique, 16 chars base32, used by the public verify page
  as_of date NOT NULL, issued_by uuid NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL, snapshot_sha256 text NOT NULL, file_id uuid,
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','REVOKED','SUPERSEDED')), revoked_by uuid, revoked_at timestamptz, revoke_reason text,
  UNIQUE (institution_id, serial_no), @fk(student_id → students), @fk(programme_enrollment_id → programme_enrollments), @fk(file_id → files));
-- Public verification uses a SECURITY DEFINER function verify_transcript(code text) returning only {valid,status,issued_at,programme_name,student_initials,snapshot_sha256}; owner lms_migrator, fixed search_path, EXECUTE granted to lms_app. No broad lms_system use.
```

**Results pipeline:** gradebook (§13.2) → `course_results` (finalize) → `semester_results` (approve) → publish → `transcripts` snapshot. Rules in §13.4–13.7; golden vectors in Appendix C.

---

## 7. Authorization

### 7.1 Model

RBAC for coarse capability + **scoped policy** for resource context. Deny by default. Namespace `<domain>:<resource>:<action>`.

**Base roles are derived, not stored:** a user is a _teacher_ if an `ACTIVE` `teachers` row exists, a _student_ if an `ACTIVE/ADMITTED` `students` row exists (a person can be both). **Administrative roles** (`PLATFORM_ADMIN, INSTITUTION_ADMIN, ACADEMIC_ADMIN, REGISTRAR, AUDITOR`) are rows in `role_assignments` with a scope (`INSTITUTION`, `ORG_UNIT`, `PROGRAMME`, `COURSE_OFFERING`). Resource-level rights come from `v_offering_access` (§6.3): enrolled students and actively assigned staff.

### 7.2 Decision algorithm (`AuthorizationService.authorize(ctx, permission, resourceRef?)`)

1. Tenant: `resource.institutionId === ctx.institutionId`, else **404**-style deny (never reveal existence).
2. Load `ResourceContext {offeringId?, programmeIds[], orgUnitId?, ownerUserId?}` through the owning module's `ResourceContextLoader`.
3. **Admin path:** any active `role_assignment` whose role grants the permission **and** whose scope covers the resource (`INSTITUTION` ⇒ all; `ORG_UNIT` ⇒ offering's programmes' org unit within the subtree; `PROGRAMME` ⇒ offering has an audience in that programme or the resource is that programme's; `COURSE_OFFERING` ⇒ equal) ⇒ allow.
4. **Staff path:** active `teaching_assignment` on `resource.offeringId` whose role (plus `capability_overrides`) grants the permission (§7.4) ⇒ allow.
5. **Student path:** permission is in the student set (§7.3) and the user has an entitlement for `resource.offeringId` (EntitlementService, which applies the 180-day post-completion window (C-09, §12.9)) ⇒ allow. Self-owned resources (own submission, own progress) additionally require `ownerUserId === ctx.userId`.
6. **Auditor path:** read-only permissions only (`*:read`), scope-covered ⇒ allow.
7. Otherwise deny. Denials of **write** permissions are audited (`outcome=DENIED`), sampled at most 1/min per (user, permission).

Rules: per-request memoization only (no cross-request caching in MVP); list endpoints apply scope filtering **in SQL** via a `VisibleOfferings` subquery helper — never authorize N items one by one.

### 7.3 Permission catalogue and role matrix

Legend: **●** unconditional within the granted scope · **T** requires active teaching assignment with the capability (§7.4) · **S** requires student entitlement (and ownership where noted) · **–** never.

| Permission                                               | PLATFORM_ADMIN | INSTITUTION_ADMIN | ACADEMIC_ADMIN | TEACHER           | STUDENT              | AUDITOR     |
| -------------------------------------------------------- | -------------- | ----------------- | -------------- | ----------------- | -------------------- | ----------- |
| `platform:tenant:manage`                                 | ●              | –                 | –              | –                 | –                    | –           |
| `identity:user:read`                                     | ●              | ●                 | ●              | –                 | –                    | ●           |
| `identity:user:manage`                                   | ●              | ●                 | –              | –                 | –                    | –           |
| `identity:role:manage`                                   | ●              | ●                 | –              | –                 | –                    | –           |
| `identity:policy:manage`                                 | ●              | ●                 | –              | –                 | –                    | –           |
| `identity:import:run`                                    | ●              | ●                 | ●              | –                 | –                    | –           |
| `academic:structure:read`                                | ●              | ●                 | ●              | ●                 | ●                    | ●           |
| `academic:structure:manage`                              | ●              | ●                 | ●              | –                 | –                    | –           |
| `academic:course-offering:read`                          | ●              | ●                 | ●              | T                 | S                    | ●           |
| `academic:course-offering:manage`                        | ●              | ●                 | ●              | –                 | –                    | –           |
| `teaching:assignment:read`                               | ●              | ●                 | ●              | T                 | S                    | ●           |
| `teaching:assignment:manage`                             | ●              | ●                 | ●              | –                 | –                    | –           |
| `enrollment:student:read`                                | ●              | ●                 | ●              | T (roster)        | –                    | ●           |
| `enrollment:student:manage`                              | ●              | ●                 | ●              | –                 | –                    | –           |
| `enrollment:course-enrollment:read`                      | ●              | ●                 | ●              | T (roster)        | S (own)              | ●           |
| `enrollment:course-enrollment:manage`                    | ●              | ●                 | ●              | –                 | –                    | –           |
| `enrollment:course-enrollment:self-register`             | –              | –                 | –              | –                 | S (own, window open) | –           |
| `session:live-session:read`                              | ●              | ●                 | ●              | T                 | S                    | ●           |
| `session:live-session:manage` (create/reschedule/cancel) | ●              | ●                 | ●              | T                 | –                    | –           |
| `session:live-session:start`                             | ●              | ●                 | ●              | T                 | –                    | –           |
| `session:live-session:end`                               | ●              | ●                 | ●              | T                 | –                    | –           |
| `session:live-session:join`                              | ●              | ●                 | ●              | T                 | S                    | ● (observe) |
| `attendance:record:read`                                 | ●              | ●                 | ●              | T                 | S (own)              | ●           |
| `attendance:record:override`                             | ●              | ●                 | ●              | T                 | –                    | –           |
| `attendance:participant:resolve`                         | ●              | ●                 | ●              | T                 | –                    | –           |
| `attendance:report:read`                                 | ●              | ●                 | ●              | T (own offerings) | –                    | ●           |
| `vod:asset:read` (metadata)                              | ●              | ●                 | ●              | T                 | S                    | ●           |
| `vod:asset:play`                                         | ●              | ●                 | ●              | T                 | S                    | ●           |
| `vod:asset:manage`                                       | ●              | ●                 | ●              | T                 | –                    | –           |
| `vod:asset:retry-ingestion`                              | ●              | ●                 | ●              | –                 | –                    | –           |
| `vod:progress:write`                                     | –              | –                 | –              | –                 | S (own)              | –           |
| `content:material:read`                                  | ●              | ●                 | ●              | T                 | S                    | ●           |
| `content:material:manage`                                | ●              | ●                 | ●              | T                 | –                    | –           |
| `content:announcement:manage`                            | ●              | ●                 | ●              | T                 | –                    | –           |
| `assessment:assignment:manage`                           | ●              | ●                 | ●              | T                 | –                    | –           |
| `assessment:submission:create`                           | –              | –                 | –              | –                 | S (own)              | –           |
| `assessment:submission:read`                             | ●              | ●                 | ●              | T                 | S (own)              | ●           |
| `assessment:quiz:manage`                                 | ●              | ●                 | ●              | T                 | –                    | –           |
| `assessment:quiz:attempt`                                | –              | –                 | –              | –                 | S (own)              | –           |
| `assessment:grade:read`                                  | ●              | ●                 | ●              | T                 | S (own, released)    | ●           |
| `assessment:grade:update`                                | ●              | ●                 | ●              | T                 | –                    | –           |
| `assessment:grade:release`                               | ●              | ●                 | ●              | T                 | –                    | –           |
| `assessment:result:finalize`                             | ●              | ●                 | ●              | T (PRIMARY only)  | –                    | –           |
| `assessment:result:reopen`                               | ●              | ●                 | ●              | –                 | –                    | –           |
| `audit:log:read`                                         | ●              | ●                 | –              | –                 | –                    | ●           |
| `ops:integration:manage`                                 | ●              | ●                 | –              | –                 | –                    | –           |
| `ops:failures:read`                                      | ●              | ●                 | ●              | –                 | –                    | –           |
| `ops:failures:replay`                                    | ●              | ●                 | –              | –                 | –                    | –           |

Admin sub-roles: `ACADEMIC_ADMIN` scoped to an org unit/programme only affects offerings/resources within that scope. `INSTITUTION_ADMIN` cannot act on other tenants. `PLATFORM_ADMIN` actions on a tenant always go through an explicit `X-Acting-Institution` header and are audited.

The machine-readable twin of this table lives at `packages/modules/authorization/src/matrix.json`; **tests are generated from it** (every permission × every persona fixture) — if the doc and JSON disagree, the JSON wins and the doc is a bug.

### 7.3.1 Results and transcript permissions (new in v2.0)

`REGISTRAR` = read access of `ACADEMIC_ADMIN` on structure/enrollment plus the rows below; it cannot edit academic structure. Teachers only act on **their own offerings'** course results.
| Permission | PLATFORM_ADMIN | INSTITUTION_ADMIN | ACADEMIC_ADMIN | REGISTRAR | TEACHER | STUDENT | AUDITOR |
|---|---|---|---|---|---|---|---|
| `results:course-result:finalize` | ● | ● | ● | – | T (PRIMARY) | – | – |
| `results:course-result:reopen` | ● | ● | ● | ● | – | – | – |
| `results:semester:compute` | ● | ● | ● | ● | – | – | – |
| `results:semester:approve` | ● | ● | – | ● | – | – | – |
| `results:semester:publish` | ● | ● | – | ● | – | – | – |
| `results:record:read` | ● | ● | ● | ● | T (own offerings) | S (own, finalized — C-11) | ● |
| `results:degree:confirm` | ● | ● | – | ● | – | – | – |
| `results:scheme:manage` | ● | ● | – | ● | – | – | – |
| `transcript:request:create` | – | – | – | – | – | S (own) | – |
| `transcript:request:manage` | ● | ● | – | ● | – | – | – |
| `transcript:document:issue` | ● | ● | – | ● | – | – | – |
| `transcript:document:revoke` | ● | ● | – | ● | – | – | – |
| `transcript:document:read` | ● | ● | – | ● | – | S (own, issued) | ● |
`transcript:verify:public` is unauthenticated (rate-limited), §13.7. Machine-readable twin: `matrix.json` includes these rows.

### 7.4 Teaching-assignment capabilities (default; overridable per assignment via `capability_overrides`)

| Capability (maps to permission)                           | PRIMARY | CO_TEACHER | ASSISTANT | GUEST_LECTURER | FACILITATOR |
| --------------------------------------------------------- | ------- | ---------- | --------- | -------------- | ----------- |
| manage sessions (`session:live-session:manage`)           | ✔       | ✔          | –         | –              | –           |
| start / co-host / end live (`…:start`, `…:end`, `…:join`) | ✔       | ✔          | ✔         | ✔              | ✔           |
| roster, attendance read, participant resolve              | ✔       | ✔          | ✔         | –              | ✔           |
| attendance override                                       | ✔       | ✔          | –         | –              | –           |
| materials, announcements                                  | ✔       | ✔          | ✔         | –              | –           |
| VOD manage (publish/unpublish/edit)                       | ✔       | ✔          | –         | –              | –           |
| assignments/quizzes manage                                | ✔       | ✔          | –         | –              | –           |
| grade update                                              | ✔       | ✔          | ✔         | –              | –           |
| grade release                                             | ✔       | ✔          | –         | –              | –           |
| finalize course results                                   | ✔       | –          | –         | –              | –           |

### 7.5 Test personas (shared fixtures, `packages/db/test/fixtures/personas.ts`)

`adminA` (institution admin, tenant A) · `acadP1` (academic admin scoped to programme P1) · `t1Primary` (O1) · `t2Co` (O1) · `t3Assistant` (O1) · `t4Other` (O2 only) · `s1` (enrolled O1) · `s2` (enrolled O2) · `s3` (DROPPED from O1) · `s4` (enrolled O1, SUSPENDED) · `audO1` (auditor scope O1) · `registrar` · `adminB` (tenant B). Every endpoint has a table-driven deny test over these personas.

---

## 8. Identity and sessions

### 8.1 Login methods (ADR-11)

1. **Google OIDC** (authorization code + PKCE; scopes `openid email profile`). Verify the ID token with `google-auth-library`; require `email_verified === true`. **Staff** logins may be restricted to `institutions.allowed_email_domains` via the `hd` claim; **students sign in with any Google account** (they are external to the Workspace org, Δ-29), so no `hd` check for them. Match to an **existing** user by verified email, or — for an already-signed-in user — **link** the Google account (`identities(provider='google', subject=<sub>, email=<gmail>)`). Never auto-create users (no `autoProvision` in MVP).
2. **Local email + password** fallback: argon2id (OWASP-current parameters), min length 12, check against a breached-password list at set time, lockout after 5 failures for 15 min, uniform errors (no enumeration), timing-safe comparison.
3. **Invites / reset:** single-use tokens (32 random bytes, stored SHA-256), invite valid 7 days, reset 30 min; successful use revokes all sessions.
4. **Google account link is mandatory before a student's first live join** (`GOOGLE_ACCOUNT_REQUIRED`, §10.6): it supplies the email for Meet member sync and the account id for attendance matching. The invite flow offers "Continue with Google" (links on accept) and the profile page offers "Link Google account".
5. MFA: OUT for MVP; Google sign-in inherits the user's Google 2-step verification. Document in the admin guide.

### 8.2 Account lifecycle

`INVITED → ACTIVE → SUSPENDED ↔ ACTIVE → DEACTIVATED`. Suspend/deactivate: revoke all sessions immediately, stop notifications, retain data. A deactivated teacher's active assignments must be reassigned (admin warning, not a silent block).

### 8.3 Sessions (ADR-12)

- Opaque 32-byte random token → cookie `__Host-lms_sid` (`HttpOnly; Secure; SameSite=Lax; Path=/`). Server stores only `SHA-256(token)` in `auth_sessions`.
- Lifetimes (institution-configurable): idle 2 h, absolute 12 h. Sliding `idle_expires_at` update at most once/minute per session.
- Per-request lookup by `token_hash` (indexed) with a 5 s in-process LRU (no shared cache); revocation therefore takes effect within ~5 s (documented SLO).
- **CSRF:** non-GET requests require header `X-CSRF-Token` = `HMAC(csrf_secret, sessionId)` returned by `GET /v1/me`; also verify `Origin`/`Sec-Fetch-Site`. Serve the SPA and API from the **same origin** (`/api` path via reverse proxy) so no CORS is needed; if split origins are required, strict allowlist, `credentials: true`, no wildcards.
- Session fixation: always rotate token on login; revoke on password change.

### 8.3.1 `GET /v1/me`

Returns `{ user, institution:{id,name,timezone}, roles:{admin:[…scopes], isTeacher, isStudent}, csrfToken, featureFlags }`. UI uses it for navigation only; every action is re-authorized server-side (INV-1).

### 8.4 Provisioning and import

Users/students/teachers are created by admins or by CSV import (§14.2). A `students`/`teachers` row requires a `users` row. Creating a student sends an invite (or "Sign in with Google" instruction if their Workspace email matches).

---

## 9. Academic core

### 9.1 Lifecycle rules

| Aggregate       | Allowed transitions                                       | Invariants                                                                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AcademicSession | `PLANNED → ACTIVE → CLOSED`                               | At most one `ACTIVE` per institution; semesters must lie within `[starts_on, ends_on]` and not overlap each other                                                                                                                                              |
| Semester        | `PLANNED → REGISTRATION → ACTIVE → CLOSED`                | Closing a semester marks its offerings `COMPLETED` (sets `completed_at`, which starts the 180-day media clock, §12.9) and moves `ENROLLED → COMPLETED` course enrollments; emits `academic.semester.closed`, which enqueues `results.compute-semester` (§13.5) |
| Curriculum      | `DRAFT → ACTIVE → RETIRED`                                | Activation requires ≥ 1 placement. Editing an `ACTIVE` curriculum that has programme enrollments is forbidden — **clone to a new version** (`POST /curricula/:id/clone`)                                                                                       |
| CourseOffering  | `DRAFT → PUBLISHED → ACTIVE → COMPLETED`; `* → CANCELLED` | Publishing requires ≥ 1 active `PRIMARY` teacher. Cancel cancels future sessions (§10.4) and notifies enrollees                                                                                                                                                |

### 9.2 Offering creation (one transaction)

Validate course/semester/section uniqueness → insert offering → insert audiences (optional) → insert teaching assignments (≥ 1 PRIMARY before publish) → write audit and enqueue domain event `course.offering.created` (same transaction). Audiences are **eligibility/display metadata**; they **never** grant access (INV-1, Δ-11).

### 9.3 Enrollment rules

- **Chain:** `ProgrammeEnrollment → SemesterEnrollment → CourseEnrollment`. A course enrollment requires an `ACTIVE` programme enrollment and a `REGISTERED` semester enrollment for the offering's semester.
- **Self-registration** (`enrollment:course-enrollment:self-register`): allowed when semester status is `REGISTRATION` or `ACTIVE`, now is within the offering's registration window (or ≤ `add_drop_deadline_on`), offering is `PUBLISHED/ACTIVE`, and the course is in the student's curriculum placement for their level/semester (otherwise admin-only with `reason`).
- **Provider cap:** for `LIVE_ONLINE` offerings the effective capacity is `min(capacity, policies.GOOGLE_MEET.maxParticipants − activeStaffCount)` (Business Standard ⇒ 150 total participants). Over-cap enrollments are rejected with `OFFERING_FULL`; admins split into sections.
- **Capacity:** inside the enrollment transaction `SELECT … FROM course_offerings WHERE id=$1 FOR UPDATE`, count `ENROLLED+PENDING`, reject with `OFFERING_FULL` (422). The partial unique index blocks duplicates (→ 409 `ALREADY_ENROLLED`).
- **Auto-register compulsory:** `POST /v1/semester-enrollments/:id/auto-register` enrolls the student in the `COMPULSORY` curriculum courses for their level/semester that have a published offering; idempotent; returns per-course outcome.
- **Drop/withdraw:** until `add_drop_deadline_on` → `DROPPED` (student or admin); after → `WITHDRAWN` (admin, with reason). Both write `course_enrollment_events` and emit `course.enrollment.ended`, which triggers: entitlement invalidation, Meet member removal if `RESTRICTED` mode (§10.5), notification. Attendance and grades are retained.
- **Credit load limits:** none in MVP (policy hook reserved).

### 9.4 Teaching assignments

Exactly one active `PRIMARY` per offering (partial unique index). Ending an assignment emits `teaching.assignment.ended` → `sync-space-members` for the offering's future sessions. Reassigning the PRIMARY is a single transactional swap. Ending the last PRIMARY of a `PUBLISHED/ACTIVE` offering with future sessions is rejected (`PRIMARY_REQUIRED`).

### 9.5 Schedule conflict rules (ADR-22)

On session create/reschedule/series generation, inside the **same transaction** that writes the session:

- **Teacher conflict (blocking, enforced by the database):** the scheduling module maintains `session_teacher_slots(teacher_id, during)` for every assigned teacher with role ∈ {PRIMARY, CO_TEACHER, GUEST_LECTURER, FACILITATOR}; the exclusion constraint `no_teacher_overlap` rejects overlapping non-override rows — this closes the concurrent-create race (INV-4). On violation return 409 `TEACHER_SCHEDULE_CONFLICT` with the conflicting sessions. An admin may resubmit with `overrideConflicts=true` + `reason`; those rows are written with `override=true` (excluded from the constraint) and audited. Teaching-assignment add/end and reschedule/cancel update slots for **future** sessions in the same transaction.
- **Student clash (warning):** compute enrolled students with overlapping sessions; return `warnings:[{code:'STUDENT_SCHEDULE_CLASH', count, sampleSessionIds}]`; never blocks.
- **Provider capacity:** warn if enrolled + staff > `maxParticipants` (150) — recommend splitting into sections.

---

## 10. Live classroom (Google Meet MVP)

### 10.1 `LiveProvider` port (supersedes TRD §6.2)

Lives in `packages/integrations/live-provider`. Domain-neutral types only (INV-3). The TRD's interface lacked artifact streaming and user resolution; the VOD module needs both without importing Google types.

```ts
export interface LiveProvider {
  readonly name: "google_meet" | "livekit" | "fake";

  /** Idempotent per input.requestKey where the provider allows; callers also guard via live_sessions.provider_space_id. */
  provisionSession(input: ProvisionInput): Promise<ProvisionedSession>; // -> {spaceRef, joinUrl, meetingCode, hostAccountId}
  syncAccess(input: SyncAccessInput): Promise<SyncAccessResult>; // cohosts; optional invited students
  getSessionStatus(ref: ProviderSpaceRef): Promise<ProviderSessionStatus>; // {activeConferenceRef?}
  endActiveConference(ref: ProviderSpaceRef): Promise<void>;

  listConferences(ref: ProviderSpaceRef): Promise<ProviderConference[]>; // {conferenceRef, startedAt, endedAt?}
  listParticipantSessions(
    conf: ProviderConferenceRef,
  ): AsyncIterable<ProviderParticipantSession>;
  listRecordings(conf: ProviderConferenceRef): Promise<ProviderRecording[]>; // {recordingRef, state, startedAt, endedAt, artifactRef?}
  listTranscripts(conf: ProviderConferenceRef): Promise<ProviderTranscript[]>;

  describeArtifact(ref: ProviderArtifactRef): Promise<ArtifactMetadata>; // {sizeBytes, md5?, mime, durationMs?, exists}
  openArtifactStream(
    ref: ProviderArtifactRef,
    opts?: { rangeStart?: number },
  ): Promise<ArtifactStream>; // {stream, sizeBytes, md5?}
  resolveUser(providerUserId: string): Promise<ProviderUserInfo | null>; // email/displayName for identity matching (optional capability)

  parseEvent(envelope: RawProviderEnvelope): ProviderEvent | null; // normalised, domain-neutral
  health(): Promise<ProviderHealth>;
}
```

Implementations: `GoogleMeetProvider` (`integrations/google`), `FakeLiveProvider` (`integrations/live-provider`, in-memory, scriptable), future `LiveKitProvider`. Provider references are **opaque strings** persisted as-is.

### 10.2 Host-account strategy (C-05, Δ-05, Δ-29)

- `HostStrategy` interface; **HOST_POOL** implemented, `TEACHER_OWNED` left as a documented extension point (not built).
- **Licensing reality (Business Standard, verified):** a Business org is limited to **300 users**; each host account and each teacher who must **record** needs a licence; recording is available on Standard; **attendance tracking (Meet UI) and Meet Media API are not** (S-08 verifies the REST participants data on Standard). Therefore: licensed users = host accounts + teachers; **students are external Google accounts** (Δ-29).
- **HOST_POOL:** the institution provides 1..N Workspace users (`provider_host_accounts`). `HostSelector.pick(institutionId, start, end)` chooses the account with the fewest sessions overlapping the interval, tie-broken by fewest `spaces.create` calls in the last hour; the choice is stored on the session and never changes after provisioning.
- Host accounts own spaces and therefore **own recordings/transcripts in their Drive**. They must be licensed for recording, never used by humans for ad-hoc classes, sit in a dedicated OU (e.g., `LMS Hosts`) excluded from Drive auto-deletion, and have pooled storage headroom.
- **Drive storage (Δ-36, C-16):** Business Standard advertises pooled per-user storage (verify the current figure). One recording-hour is ≈ 0.5–1.5 GB. The LMS **monitors** host storage (Drive `about`; alert at 70 %/85 %) **and**, with `DRIVE_CLEANUP_MODE=TRASH_AFTER_INGEST` (default, owner-approved), trashes each ingested recording 7 days after its R2 copy is verified and its ladder is complete (job `drive.cleanup`, §12.9). This needs the broad `https://www.googleapis.com/auth/drive` scope on host accounts — accepted by the owner; S-10 keeps looking for a narrower scope.
- **Sizing (derived from per-user quotas):** one host gives 600 read calls/min and 10 space creations/min. A full attendance sync costs ≈ `2 + participants` reads per conference. Recommended pool size ≥ `ceil(peakConcurrentSessions / 10)` and ≥ 2 for resilience (Business Standard class cap 150 ⇒ ≈ 150 reads per session). Expose pool utilisation metrics (§19). **Launch (C-13): 2 host accounts** — 5 concurrent sessions × ≈ 35 participants use < 10 % of one host's read quota.
- Teachers are added as `COHOST` **members** (by email) so they can start, admit, mute, present and record without owning the space.

### 10.3 Google authentication and scopes (AUTH-003)

Domain-wide delegation (DWD): a service account impersonates a **host account** (`subject`). Verified: Meet REST accepts only user authentication; DWD counts as user authentication.
| Capability | Scope | Notes |
|---|---|---|
| Create/configure spaces, members, end conference | `https://www.googleapis.com/auth/meetings.space.created` | Principal-scoped: only spaces created by the impersonated host — exactly what HOST_POOL needs |
| Read conference records, participants, recordings, transcripts | `https://www.googleapis.com/auth/meetings.space.readonly` | **SPIKE S-04:** drop it if `…space.created` alone is sufficient (prefer narrowest) |
| Download recording/transcript files from the host's Drive | `https://www.googleapis.com/auth/drive.meet.readonly` | Preferred over `drive.readonly`; **SPIKE S-05** confirms `files.get?alt=media` works with it under DWD |
| Create/renew Workspace Events subscriptions | per Events "choose scopes" guide (same Meet scopes) | **SPIKE S-04** |
| Trash ingested recordings in host Drive (C-16) | `https://www.googleapis.com/auth/drive` | Broad (full Drive of the **host accounts only** — they hold nothing but Meet artifacts); used only by `drive.cleanup`; S-10 seeks a narrower scope |
| Resolve Google user id → email (optional) | `https://www.googleapis.com/auth/admin.directory.user.readonly` (impersonating an admin) | Only if S-01 shows OIDC `sub` ≠ Meet `users/{id}`; institutions may resist granting it |
| Pub/Sub pull | IAM `roles/pubsub.subscriber` on the subscription for the worker's runtime identity | Not DWD |
Implementation: `google-auth-library` `JWT({ email, key, scopes, subject: hostEmail })`; tokens cached in memory per `(hostEmail, scopeSet)` until 5 min before expiry. Service-account key comes from the secrets manager (`integration_configs.secret_ref`), never from env files in production; prefer workload-identity/keyless signing where the host platform supports it. Rotate keys ≤ 90 days. **Never log tokens.**

### 10.4 Session state machine (supersedes TRD §6.5; Δ-01)

`live_sessions.state` models **only the conference lifecycle**. Recording and VOD have their own machines (§12). Provider provisioning is a separate column (`provider_status`).

| From            | To        | Trigger                                                                                                                  | Notes                                                                                                                                         |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| SCHEDULED       | OPEN      | Join window starts (`session-tick`, or explicit staff `/start`)                                                          | Persisted for display/queries; join authorization computes the window from time, never trusting this flag alone                               |
| SCHEDULED, OPEN | CANCELLED | Teacher/admin cancel                                                                                                     | Terminal. Join denied. Provisioned space is left unused (Meet has no delete API)                                                              |
| OPEN            | LIVE      | `conference.started` event or sync sees `activeConference`                                                               | Sets `first_conference_started_at`                                                                                                            |
| SCHEDULED       | LIVE      | Same, if a staff member entered before the tick ran                                                                      |                                                                                                                                               |
| LIVE            | ENDED     | Conference ended and no active conference                                                                                | Sets `last_conference_ended_at`; schedules `session.finalize`                                                                                 |
| ENDED           | LIVE      | New conference in the same space while `now ≤ scheduled_end + maxOverrunMinutes` (policy, default 180) and not finalized | Reconnect after a crash/accidental end                                                                                                        |
| OPEN            | NO_SHOW   | `now > scheduled_end + joinAfter` and no conference ever started                                                         | Terminal. No attendance records created                                                                                                       |
| LIVE            | CANCELLED | **Forbidden** (409 `SESSION_IN_PROGRESS`). End it first                                                                  |
| any             | —         | `finalized_at` set                                                                                                       | After finalization, later conferences in the space are stored as raw evidence and flagged `attendance_state=REVIEW_REQUIRED`, state unchanged |

Implement as a pure `LiveSessionStateMachine.transition(state, event, ctx)` with exhaustive table tests, including illegal-transition rejections.
**Composite display state (maps to TRD LIVE-005 labels), computed in the read model, not stored:**
`CANCELLED` ← cancelled · `FAILED` ← `provider_status=ERROR` and start ≤ 2 h away or already past · `LIVE`/`OPEN`/`SCHEDULED` ← state · for `ENDED`: `AVAILABLE` if any VOD `PUBLISHED`; else `PROCESSING_RECORDING` if any recording asset in-flight **or** `recording_mode≠OFF` and within the recording-expectation window (default 12 h from end); else `ENDED`. `ARCHIVED` when all its VODs are `ARCHIVED`.

### 10.5 Space configuration and access control (Δ-02, Δ-30, ADR-10)

At provisioning, create the space with values from `policies[GOOGLE_MEET]`:

```
accessType:        RESTRICTED                 // default; students are external accounts (Δ-30)
entryPointAccess:  ALL
moderation:        ON                         // enables co-host management
moderationRestrictions: { chatRestriction: NO_RESTRICTION, reactionRestriction: NO_RESTRICTION,
                          presentRestriction: HOSTS_ONLY, defaultJoinAsViewerType: OFF }   // policy-driven
attendanceReportGenerationType: DO_NOT_GENERATE    // not available on Business Standard UI; LMS computes its own
artifactConfig.recordingConfig.autoRecordingGeneration:    ON if recording_mode=AUTO else OFF
artifactConfig.transcriptionConfig.autoTranscriptionGeneration: per policy (default OFF)
artifactConfig.smartNotesConfig.autoSmartNotesGeneration:  OFF
```

Verified semantics to design around:

- **Auto-recording starts only when someone _with the privilege to record_ joins.** Students joining first do not start it; it begins when a co-host/host joins. The teacher UI says "Recording starts when you join". `recording_mode=MANUAL` leaves it to the teacher.
- **Guarantee boundary:** the LMS guarantees _who is shown the link_ and _audits every authorization_; Google guarantees _admission_. With `RESTRICTED`, only members (invitees) skip knocking; everyone else must **knock** and a host admits or denies. AC-04 is verified as: _an unenrolled user receives no join URL (404/403) and is not a space member_.
- **Members (`spaces.members`)** are keyed by **email**, role `COHOST` or unspecified. Staff (`PRIMARY, CO_TEACHER, ASSISTANT, GUEST_LECTURER, FACILITATOR`) get `COHOST`; each `ENROLLED` student gets a **role-less member** using their **linked Google account email** (`identities(provider='google').email`). Students with no linked Google account are skipped and reported (`STUDENT_NO_GOOGLE_ACCOUNT`); they see the link-account prompt (§8.1) and, if they join anyway, must knock (Q-11).
- **Member sync cost:** ≈ one `members.create` per student per session; write quota is 100/min/host ⇒ a 140-student session ≈ 1.4 min of one host's write budget, executed asynchronously at provisioning and kept in sync by `session.sync-access` (debounced per session) on enrollment add/drop and assignment changes for sessions starting within 14 days. **SPIKE S-03:** confirm any member-count limit and that external invitees skip knocking; **S-09:** confirm the Workspace admin setting that blocks anonymous (not-signed-in) joiners so every participant is a signed-in Google account.
- **Capacity (Business Standard = 150 participants incl. staff):** `policies.GOOGLE_MEET.maxParticipants` defaults to 150. Effective offering capacity = `maxParticipants − activeStaffCount`; larger cohorts must be split into **sections** (`section_code`). Session creation warns/blocks per §9.5.
- **Phone dial-in (low bandwidth, SHOULD):** provisioning stores `space.phoneAccess` (regional numbers + PIN) when present; `/join` returns it as `dialIn`. Dial-in participants appear as `PHONE` and need manual attendance matching.

### 10.6 Provisioning and join (INV-8)

**Creation** `POST /v1/course-offerings/:id/sessions` (Idempotency-Key): authorize → conflict checks (§9.5) → in **one transaction**: insert `live_sessions` (`state=SCHEDULED`, `provider_status=PENDING`, `policy_snapshot`), insert `session_teacher_slots`, `boss.send('session.provision', {sessionId}, { db: trx, singletonKey: 'session:{id}:provision', startAfter: max(now, scheduled_start − provisionLead) })`, audit → commit. Response is immediate; the Meet link is created later. **Never call Google in the request path.**

**`session.provision` handler** (queue `session.provision`, role `google`): lock the row `FOR UPDATE SKIP LOCKED`; skip if CANCELLED/NO_SHOW or `provider_status=READY` → `PROVISIONING` → `HostSelector.pick` → `rl_acquire(create)` → `provider.provisionSession` → **same transaction** persist `provider_space_id, join_url, meeting_code, host_account_id, provisioned_at, dial_in`, `provider_status=READY`, enqueue `session.sync-access` and emit domain event `live.session.provisioned`. A crash between Google's response and the commit can orphan one unused space (harmless; log `space_created_unlinked`). Retries: 6, exponential with jitter (1 min → ~2 h); permanent failure ⇒ `provider_status=ERROR`, ops failure, notify admins (and the teacher if start < 2 h). `POST /v1/sessions/:id/reprovision` re-enqueues.

**Join** `POST /v1/sessions/:id/join` — **database only**:

1. Load session (tenant-scoped). 2. `authorize(session:live-session:join)` (§7). 3. State not `CANCELLED/NO_SHOW`. 4. Window: students `[start − joinBefore, end + joinAfter]` or any time while `LIVE` (defaults 15 / 60 min); staff `[start − 60 min, end + maxOverrun]`. 5. **Students must have a linked Google account** (`identities.provider='google'`), else `409 GOOGLE_ACCOUNT_REQUIRED` with the link URL (INV: attendance and member sync depend on it). 6. `provider_status=READY`, else `503 PROVIDER_NOT_READY` + `Retry-After` (if `PENDING` and start within 30 min enqueue a high-priority provision). 7. Insert `session_join_log` (denials audited). 8. Return:

```json
{
  "sessionId": "…",
  "state": "LIVE",
  "provider": "google_meet",
  "joinUrl": "https://meet.google.com/abc-mnop-xyz",
  "role": "STUDENT",
  "window": { "opensAt": "…", "closesAt": "…" },
  "cohostSynced": true,
  "dialIn": { "numbers": [{ "region": "NG", "phone": "+234…", "pin": "…" }] },
  "lowDataTip": true
}
```

(`expiresAt` from the TRD is dropped: a Meet link has no expiry; `window.closesAt` is the LMS-side limit.)
`POST /v1/sessions/:id/start` (staff): same checks with the staff window; may open early (`SCHEDULED→OPEN`) without a provider call; if `access_synced_at` is null it enqueues a priority `session.sync-access` and returns `cohostSynced:false`.
`POST /v1/sessions/:id/end` (staff, SHOULD): enqueues `session.end` (calls `endActiveConference`); never blocks the request.

### 10.7 Quota-aware Google client (Δ-04)

**Verified quotas** (Meet REST): reads 6000/min/project and 600/min/user; writes 1000/min/project and 100/min/user; **`spaces.create` 100/min/project and 10/min/user**. Quotas apply per _impersonated user_ under DWD.
`GoogleRateLimiter` (Postgres `rl_acquire`, §5.7) with buckets at 80 % of quota:
| Bucket | Key | Capacity/min |
|---|---|---|
| create | `g:meet:create:{project}:{host}` / `…:{project}` | 8 / 80 |
| write | `g:meet:write:{project}:{host}` / `…:{project}` | 80 / 800 |
| read | `g:meet:read:{project}:{host}` / `…:{project}` | 480 / 4800 |
| drive, events | configurable | — |
`acquire(bucket, cost, {maxWaitMs})` returns when tokens are available; if the needed wait exceeds `maxWaitMs`, the handler **re-schedules itself** (`startAfter`) instead of failing — it does not consume a retry attempt.
**Retry/error taxonomy** (`withGoogleRetry`): 429/500/502/503/504/network ⇒ full-jitter exponential backoff (base 1 s, cap 60 s, ≤ 5 tries per call) honouring `Retry-After`; 401 ⇒ refresh token once; 403 permission/scope ⇒ **permanent**, set `integration_configs.status=DEGRADED`, alert; 404 on a Meet resource ⇒ permanent for that resource; 404 on a Drive file ⇒ `SOURCE_MISSING`.
**Circuit breaker** per `(provider, host)`: opens after 5 consecutive failures within 30 s; half-open probe every 30 s; state is persisted in `provider_host_accounts.status`/in-process and exposed via `GET /v1/admin/integrations/google/status` and `providerStatus` on session responses (LIVE-008 banner).

### 10.8 Events, sync, reconciliation (INV-6, Δ-07)

**Transport (ADR-18):** the worker (role `google`) runs a Pub/Sub **pull** subscriber (role `google`) with flow control (`maxMessages` ≈ 200). For each message: build the envelope from attributes (`ce-type`, `ce-id`, `ce-source`, `ce-subject`, `ce-time`, plus any subscription identifier) + data → `INSERT INTO provider_events … ON CONFLICT (provider,event_id) DO NOTHING` → **ack only after the insert commits**. Optional push mode (`GOOGLE_EVENTS_MODE=push`): `POST /v1/integrations/google/workspace-events` verifies the Pub/Sub OIDC JWT (audience + service-account email), then calls the same ingest function. Events carry **names only** (Verified) — never expect participant data in them.
**Tenant routing (job `provider-event.route`, `lms_system`)**, in order: subscription → `provider_subscriptions` → institution; else space id → `live_sessions.provider_space_id`; else `conferenceRecords.get` to learn the space. Unroutable events ⇒ `IGNORED` + metric (never dropped silently: payload kept). **SPIKE S-04** confirms which envelope attributes are available.
**Processing (job `provider-event.process`, tenant context), per event type:**
| Event | Action |
|---|---|
| `conference.v2.started` | upsert `conference_records` (ACTIVE, `dirty=true`); state→LIVE; |
| `conference.v2.ended` | `GET` conference for `endTime`; mark ENDED; state→ENDED; delayed `session.finalize` at `ended_at + finalizeDelay` (dedupe key `session:{id}:finalize`) |
| `participant.v2.joined/left` | **only** set `conference_records.dirty=true` (no API call); optionally schedule a debounced sync if `liveAttendanceSync` policy is on (default **off**) |
| `recording.v2.started/ended` | mark "recording expected/in-progress" (no state machine on session) |
| `recording.v2.fileGenerated` | enqueue `recording.discover` (pg-boss, same transaction) |
| `transcript.v2.fileGenerated` | enqueue `transcript.discover` (pg-boss, same transaction) |
| lifecycle (subscription expiring/expired/suspended) | enqueue `subscription.renew` (pg-boss, same transaction) / reactivate |
**`conference.sync` job:** `GET` conference → list participants → for each participant list participant sessions (**cost ≈ participants + 2 read calls**; see sizing rule §10.2) → upsert `provider_participant_sessions` (never delete) → run matching for new provider user ids (§11.3) → clear `dirty`. Default schedule: **once at conference end**, again at `+30 min`, and during `session.finalize`; not during the class (quota). Ordering is irrelevant: it reads current provider truth, so duplicates and out-of-order events converge.
**Subscriptions:** one subscription per **host account** targeting the Meet _user_ (`//cloudidentity.googleapis.com/users/{id}`) receives events for every space the host owns — far fewer subscriptions than one per space. Store `remote_name`, `expires_at` from the API response; renew when `now > expires_at − max(24h, 50% of lifetime)`; handle lifecycle events; **SPIKE S-04** confirms lifetime limits and that user-target subscriptions fire for API-created spaces.
**Scheduled jobs (pg-boss cron, §16):** `session-tick` (1 min), `session-reconciliation` (3 min), `recording-reconciliation` (10 min), `subscription-renewal` (15 min), `stuck-asset-sweeper` (10 min), `vod-integrity-check` (daily), `recurrence-extender` (daily), `idempotency-cleanup` (hourly). Reconciliation scans use `lms_system` to _select candidate ids only_, then enqueue per-session handlers under tenant context; each run respects a provider-call budget.

### 10.9 Reschedule, cancel, recurrence

- **Reschedule** `PATCH /v1/sessions/:id` (states SCHEDULED/OPEN; `If-Match`): re-runs conflict checks; keeps the provisioned space; if `scheduled_start` moves beyond the provision lead, no re-provision needed (space already exists); notifies enrollees. Past or LIVE/ENDED sessions are immutable except title/description.
- **Cancel** `POST /v1/sessions/:id/cancel` (reason required): SCHEDULED/OPEN only; notifies; join denied. Never calls Google (no space deletion API).
- **Series** `POST /v1/course-offerings/:id/session-series` (Idempotency-Key): stores `rrule`, `timezone`, `start_time`, `duration`; the generator expands occurrences **in the series timezone using luxon** (DST-safe even though `Africa/Lagos` has none), writes UTC instants, creates `live_sessions` rows idempotently keyed by `(series_id, occurrence_date)`, horizon 8 weeks, extended daily by `recurrence-extender`. Spaces are **not** created at generation; each instance provisions lazily (§10.6). Edit scopes: `THIS_ONLY` (instance marked `series_exception=true`) and `ALL_FUTURE` (regenerates only future, unprovisioned, non-exception instances; touched/provisioned/past ones are untouched).

### 10.10 Failure behaviour (supersedes TRD §18.2 for live)

| Failure                                       | Behaviour                                                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google API down at provisioning               | Retry/backoff; `provider_status` stays PENDING/ERROR; session visible with "link being prepared"; admin ops failure when start < 2 h                  |
| Google API down at join time                  | Join still works if `READY` (DB-only). If not READY ⇒ 503 `PROVIDER_NOT_READY` + retry hint                                                           |
| Workspace Events delayed/lost                 | Reconciliation converges within ≤ 5 min (`session-reconciliation`); attendance sync at end/finalize does not depend on events                         |
| Subscription expired                          | Renewal job + lifecycle events + reconciliation; metric `subscription_expiring_soon` alert                                                            |
| Worker crash mid-job                          | Job is idempotent and re-delivered; DB uniqueness prevents duplicates                                                                                 |
| Postgres failover (managed standby promotion) | API/worker reconnect with retry; in-flight transactions roll back; pg-boss resumes polling; the Pub/Sub puller keeps un-acked messages (nothing lost) |
| Quota exhaustion                              | Limiter delays jobs; no retry storms; metric `google_quota_wait_ms`                                                                                   |
| Host account suspended/licence lost           | `403` ⇒ host `status=DISABLED`, integration `DEGRADED`, alert; `HostSelector` skips it                                                                |

---

## 11. Attendance

### 11.1 Pipeline

`provider_participant_sessions` (raw, append/upsert evidence) → **matching** → `computeAttendance()` (pure) → `attendance_records` (derived projection + audited override). Raw rows are never deleted or edited except `matched_user_id`/`match_method` (manual resolution, audited).

### 11.2 Policy (versioned `policies` row, `policy_type='ATTENDANCE'`; Zod schema in `contracts`)

```json
{
  "policyVersion": 1,
  "basis": "ACTUAL_CAPPED", // SCHEDULED | ACTUAL | ACTUAL_CAPPED  (default ACTUAL_CAPPED)
  "presentThresholdBp": 7500, // basis points; avoids float comparisons
  "partialThresholdBp": 2500,
  "lateGraceMinutes": 15,
  "windowPaddingMinutes": { "before": 0, "after": 0 },
  "minSegmentSeconds": 0,
  "shortConferenceReviewBp": 3000, // actual < 30% of scheduled ⇒ REVIEW_REQUIRED
  "finalizeDelayMinutes": 10,
  "lockAfterDays": 7, // recompute allowed until finalized_at + 7d
  "liveAttendanceSync": false
}
```

Per-offering overrides via `policies(scope_type='COURSE_OFFERING')`. The policy version used is stored on each record (`policy_version`) and snapshotted at finalization.

### 11.3 Participant → student matching ladder (Δ-06, Δ-31; **SPIKE S-01 gates this**)

Students are **external** Google accounts (Δ-29), so the Admin Directory API cannot resolve them. Strategies are pluggable (`MatchStrategy[]`), evaluated in order for each `SIGNED_IN` participant session:

1. **`GOOGLE_ID`** — `identities(provider='google', subject = provider_user_id)` ⇒ user. Valid only if S-01 proves the OIDC `sub` equals the Meet `signedinUser.user` id **for external accounts**; otherwise this strategy is disabled by config and step 2 becomes primary.
2. **`MEMBER_EMAIL`** — if Meet returns an email/identifier that equals a linked Google email of an enrolled student (verify what the API exposes for externals, S-01).
3. **`NAME_ASSISTED`** (review-only, never auto-final): normalised `displayName` equals exactly one enrolled student's `identities.metadata.googleName` (captured at link time) **and** that student has no other evidence ⇒ create a **suggested** match flagged `NEEDS_REVIEW`; a staff member confirms. Never counted automatically.
4. **`MANUAL`** — staff with `attendance:participant:resolve` links a participant session (optionally persisting the Google id → identity for future sessions). Audited; triggers recompute.
   `ANONYMOUS`/`PHONE` participants are manual-only (S-09 aims to block anonymous joins; dial-in is phone). A student with several Google accounts has several identities; all intervals are unioned (ATT-001). Matched users who are not enrolled students of this offering are kept as evidence but excluded from student attendance. **Unresolved overlap > `unmatchedReviewMinutes` ⇒ session `attendance_state=REVIEW_REQUIRED`** and a teacher task.

### 11.4 Algorithm — `computeAttendance(input): AttendanceResult[]` (pure, no I/O; `modules/attendance/domain`)

Inputs: session `{scheduledStart, scheduledEnd}`, conferences `[{start, end|null}]`, `capAt` (= `now` while live, else null), policy, `enrolledStudentIds` (students `ENROLLED` at any instant of the scheduled window; dropped-before-start excluded), and per-student raw intervals `[{start, end|null}]` from matched participant sessions.

1. **Window** `W = [scheduledStart − pad.before, scheduledEnd + pad.after]` (defaults: exactly the scheduled slot).
2. **Conference union** `C` = union of conference intervals (open end ⇒ `capAt` or conference end), then `C' = C ∩ W`. Participants can never earn time when no conference was active (robust to clock skew).
3. `scheduledSeconds = |W|`, `actualSeconds = |C'|`. **Denominator:** `SCHEDULED → scheduledSeconds`; `ACTUAL → actualSeconds`; `ACTUAL_CAPPED → min(scheduledSeconds, actualSeconds)`. If denominator = 0 ⇒ no attendance (session handled as NO_SHOW).
4. If `actualSeconds × 10000 < shortConferenceReviewBp × scheduledSeconds` ⇒ result flag `REVIEW_REQUIRED` (still compute provisional values).
5. **Per student:** open interval ends ⇒ clip to `C'`; drop segments `< minSegmentSeconds`; **merge overlapping intervals** (same student on two devices or reconnect overlap counts once); `attendedSeconds = |union ∩ C'|`.
6. **Ratio/status (integer math):** `ratioBp = min(10000, floor(attendedSeconds × 10000 / denominator))`; `PRESENT` if `ratioBp ≥ presentThresholdBp`; else `PARTIAL` if `≥ partialThresholdBp`; else `ABSENT`. `late` = first clipped segment start `> scheduledStart + lateGrace`. `joinCount` = number of raw participant sessions (reconnects) for the student.
7. Students with no evidence ⇒ `ABSENT`, `attended=0`. Output sorted by `studentId` (deterministic).
   **Persistence:** under `pg_advisory_xact_lock(hashtext(liveSessionId))`, UPSERT on `(live_session_id, student_id)`; update **only if computed values changed** (`calc_version++`); set `status = COALESCE(override_status, computed_status)`; **never write override fields during recompute**. Idempotent by construction (ATT-003).

### 11.5 Finalization (`session.finalize`)

Preconditions: conference ended ≥ `finalizeDelay` ago (or reconciliation proves no active conference) and `conference.sync` ran after `ended_at`. Steps: final sync if dirty → compute → if any `SIGNED_IN` unmatched participant overlapped ≥ `unmatchedReviewMinutes` (default 10) or the short-conference flag is set ⇒ `attendance_state=REVIEW_REQUIRED` and notify the teacher; else `FINAL`; set `finalized_at`; emit `attendance.finalized`. Late-arriving evidence triggers a recompute until `finalized_at + lockAfterDays`, after which only overrides change records.

### 11.6 Overrides and reports

- `POST /v1/sessions/:id/attendance/:studentId/override` `{status, reason}` (reason ≥ 5 chars; permission `attendance:record:override`): sets override fields + audit + event in one transaction. `DELETE` on the same path clears the override (audited).
- `GET /v1/sessions/:id/attendance` returns computed + effective status, ratio, minutes, late flag, join count, override metadata. `GET /v1/sessions/:id/participants` returns the raw join/leave timeline (ATT-005). `POST /v1/sessions/:id/participants/:pid/match` resolves an unmatched participant.
- `GET /v1/reports/attendance?offeringId=&format=json|csv`: student × session matrix with the policy version in the header.
- `POST /v1/sessions/:id/attendance/recompute` (admin/teacher): enqueue a recompute (idempotent).

---

## 12. Recording and VOD (low-bandwidth pipeline)

### 12.1 Pipeline overview

```
Meet recording ──(fileGenerated event | reconciliation)──► recording.discover
   └► recording.ingest   Drive ► R2 source/original.mp4 (streamed, MD5+size verified)         [media role, I/O bound]
      └► media.probe      ffprobe: codec/size/duration sanity, faststart not required (HLS)    [media role]
         └► media.transcode-fast   240p + 360p + audio-only  ──► vod_assets.playable_at, PUBLISHED (policy)   [CPU]
            └► media.transcode-full   480p + 720p (≤ source height) ──► master.m3u8 regenerated, ladder_complete   [CPU]
               └► media.finalize      poster, integrity check, notifications
```

Each stage is a pg-boss queue (§16), **idempotent** (deterministic R2 keys, overwrite-on-retry), writes its outcome to `recording_assets`/`vod_renditions`, and enqueues the next stage **in the same transaction** as its own completion (INV-5). A stage failure does not erase earlier-stage output: students can already watch the lowest rungs while later rungs retry.

**Recording asset machine:** `DISCOVERED → COPYING → PROBING → TRANSCODING → READY`; `FAILED` (retryable by admin), `SOURCE_MISSING` (Drive file deleted/unreachable), `PURGED` (retention).
**VOD asset machine:** `PROCESSING → PUBLISHED ⇄ UNPUBLISHED → ARCHIVED → PURGED`; `FAILED`. `playable_at` is set when the first rung **and** audio-only are `READY`.

### 12.2 Discovery (`recording.discover`)

Triggered by `recording.v2.fileGenerated` (via the router), by `recording-reconciliation` (cron), or by admin retry. Steps: resolve the conference record → `provider.listRecordings(conference)` → for each recording with state `FILE_GENERATED` and an `artifactRef`: upsert `recording_assets` keyed `(institution_id, provider_recording_id)`, assign `part_no` by `recording_started_at`, create the `vod_assets` row (`PROCESSING`, `storage_prefix='i/{iid}/vod/{vodId}/'`, title "{Session title} — Part N"), enqueue `recording.ingest` with `singletonKey=recording:{id}`. Never assume a recording exists because a conference ended (LIVE-006). Mark the session `NOT_RECORDED` display after the expectation window (default 12 h) with no recording.

### 12.3 Ingest (`recording.ingest`, role `media`, `expireInSeconds` 4 h)

1. `provider.describeArtifact` ⇒ size, md5 (Drive `md5Checksum`), mime, duration (`videoMediaMetadata`, may lag); if missing/404 ⇒ `SOURCE_MISSING` (alert; the host may have deleted it).
2. Stream `provider.openArtifactStream` ⇒ R2 multipart upload (`@aws-sdk/lib-storage` `Upload`, `partSize` 16 MiB, `queueSize` 4) to `source/original.mp4`, computing MD5 on the fly via a passthrough. **No local disk copy.** Concurrency per media droplet: 2 ingests.
3. Compare size and MD5 with Drive's; mismatch ⇒ delete object, retry (max 5, backoff). On failure the multipart upload is aborted (no orphan parts); retries restart the copy (documented; resumable copy is a COULD).
4. Persist `stored_size_bytes, stored_md5, copied_at, source_delete_after = now + sourceRetentionDays (14)` and enqueue `media.probe`.
   Throughput expectation is measured in **S-05/S-06**; the SLO "playable within 15 min for 95 % of ≤ 60-min recordings" is checked in staging with real recordings.

### 12.4 Probe and transcode (`media.probe`, `media.transcode-*`)

- **Probe:** `ffprobe -v error -print_format json -show_streams -show_format` on a presigned source URL. Reject (FAILED, code `UNPLAYABLE_SOURCE`) if no video **and** no audio stream, duration ≤ 0, or `|probed − Drive duration| > max(2 s, 2 %)`. Store codec/size/fps/duration.
- **Ladder (no upscaling; only rungs ≤ source height):**
  | Rung | Height | FPS cap | Video (CRF, maxrate) | Audio | ≈ MB/h (video+audio) |
  |---|---|---|---|---|---|
  | HLS_240 | 240 | 15 | crf 30, 180 kbps | AAC 32 kbps mono 24 kHz | ~95 |
  | HLS_360 | 360 | 15 | crf 29, 330 kbps | AAC 48 kbps mono | ~170 |
  | HLS_480 | 480 | 15 | crf 28, 560 kbps | AAC 64 kbps mono | ~280 |
  | HLS_720 | 720 | 24 | crf 27, 1000 kbps | AAC 64 kbps mono | ~480 |
  | HLS_AUDIO | — | — | — | AAC-LC 40 kbps mono 24 kHz | ~18 |
  Lecture content (slides, talking head) tolerates 15 fps and tight maxrate; tune CRF/maxrate against real Meet recordings (S-06) with a visual check of slide text at 480p/720p. `audioChannels` is a policy (`mono` default; `stereo` for music-heavy programmes).
- **Encoding rules:** H.264 Main/High, `yuv420p` (maximum device compatibility on low-end Android), `-preset veryfast`, constrained-quality (`-crf` + `-maxrate/-bufsize` = 2 × maxrate), **segment duration 6 s with keyframes forced on a 6 s grid** (`-force_key_frames "expr:gte(t,n_forced*6)"`, `-sc_threshold 0`) so rungs switch cleanly; HLS fMP4 (`-hls_segment_type fmp4 -hls_flags independent_segments -hls_playlist_type vod`), `init.mp4` + `seg_%05d.m4s` per rung under `hls/v{height}/`; audio-only under `hls/audio/`. Build commands in `integrations/media/ladder.ts` (pure function returning argv, snapshot-tested); run with `execa`, `-nostdin`, a timeout (`3 × duration`), progress parsed from `-progress pipe:1` and persisted every 30 s.
- **Stage split:** `transcode-fast` = HLS_240 + HLS_360 + HLS_AUDIO in **one** multi-output ffmpeg process (decode once); `transcode-full` = HLS_480 + HLS_720 in one process. Source is read through a presigned URL (ffmpeg HTTP input) — or downloaded to scratch if `MEDIA_SCRATCH_GB` allows — never through the API.
- **Output:** upload each rung's files to R2 (`PutObject`, concurrency 8; playlists last), write `vod_renditions` row (`READY`, bandwidth from measured `-maxrate`/actual avg, segment count), regenerate `hls/master.m3u8` listing only `READY` rungs (`#EXT-X-VERSION:7`, `#EXT-X-INDEPENDENT-SEGMENTS`, `BANDWIDTH`, `AVERAGE-BANDWIDTH`, `RESOLUTION`, `FRAME-RATE`, `CODECS`), set `Cache-Control`: segments/init `public, max-age=31536000, immutable`; playlists `max-age=30`.
- **Resource model:** `transcode-fast`/`full` run **one per media droplet** using all cores; ffmpeg `nice 10`; scratch ≥ 2 × largest source; `expireInSeconds` 6 h. Scale by adding media droplets (queue is the coordinator).
- **Quality gate (INV-9):** after each stage verify with `ffprobe` that every rung's duration is within 1 % of the source, segment count matches `ceil(duration/6)`, and a sampled segment decodes (`ffmpeg -v error -i … -f null -`). Failure ⇒ rung `FAILED`, retry; the asset is never marked playable with a failed rung in the master.

### 12.5 Publication and state rules

- `vod_assets.status` becomes `PUBLISHED` when `playable_at` is set **and** the recording policy `autoPublish` is true (default; C-09); otherwise stays `PROCESSING` until a teacher publishes (`POST /v1/vod-assets/:id/publish`, Idempotency-Key). Publication emits `vod.asset.published` (notifications, §14.1) once.
- Teachers/admins may `unpublish` (hides immediately; tokens already minted still work until expiry — §12.7), edit title/description, reorder, schedule `publish_after`/`unpublish_at`.
- Multiple recordings per conference become multiple VOD assets ("Part N"); merging is a COULD.
- A session whose recording is `FAILED` shows "Recording could not be processed" to staff and an ops failure; students see "Recording not available".

### 12.6 Media edge (`apps/media-edge`, Cloudflare Worker + R2) — ADR-04, INV-10

**Purpose:** serve private HLS/poster/caption objects from R2 at the edge near students, cached, with revocation by short token lifetime, **without** the API or droplets carrying video bytes.

- **Bucket:** R2 `lms-media` (location hint `weur`), **private** (no public bucket access, no `r2.dev`); keys `i/{institutionId}/vod/{assetId}/…` and `i/{institutionId}/files/…`. Droplet workers write via the S3 API (access key scoped to the bucket).
- **Hostname:** `media.<domain>` routed to the Worker; `APP_ORIGIN` env for CORS.
- **Token** (minted by `MediaDelivery.mintToken` in the API, verified by the Worker; claims schema in `contracts/media-token.ts`): `v1.<base64url(JSON)>.<base64url(HMAC-SHA256)>` with payload `{ "v":1, "iid":"…", "aid":"…", "exp":<unix>, "kid":"k1", "scope":"hls" }`; HMAC over `v1.<payload>` using the secret for `kid` (`MEDIA_TOKEN_SECRETS` JSON, supports rotation: API signs with the newest, Worker accepts all non-retired); constant-time compare; ±60 s leeway.
- **URL shape:** `https://media.<domain>/t/<token>/<assetId>/<path>`; playlists use **relative URIs**, so every segment request inherits the token prefix (no playlist rewriting).
- **Worker algorithm:** parse → verify signature/`exp`/`aid == path assetId` → allow-list the path (`^(hls/master\.m3u8|hls/audio/(index\.m3u8|init\.mp4|seg_\d{5}\.m4s)|hls/v(240|360|480|720)/(index\.m3u8|init\.mp4|seg_\d{5}\.m4s)|poster\.jpg|captions/[a-z]{2,3}(-[A-Za-z]+)?\.vtt)$`; **`source/**`is never served**; reject`..`/encoded slashes) → derive cache key `https://cache.invalid/{iid}/{aid}/{path}` (**token excluded**, so all students share cache entries) → `caches.default.match` → on miss `env.VOD_BUCKET.get(key)` (support `Range` for poster/captions), `cache.put` with `s-maxage` (segments 1 day edge, playlists 30 s) → respond with `Cache-Control: private, max-age=3600` (playlists `no-store`), `Access-Control-Allow-Origin: APP_ORIGIN`, `Vary: Origin`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. Errors: 401 `TOKEN_INVALID|TOKEN_EXPIRED`, 403 `PATH_FORBIDDEN`, 404 `NOT_FOUND`; **never log the URL** (tokens are bearer credentials).
- **Token lifetime** `ttl = clamp(ceil(duration_s × 1.5) + 1800, 7200, 28800)` seconds so a long lecture never needs a refresh. **Residual exposure after withdrawal/unpublish = remaining ttl** (≤ 8 h, typically ≈ 2–3 h); stated in the admin guide. Revocation of a whole asset: rotate `kid` or purge the cache key and delete the objects.
- **Fallback (S-12 fail):** `S3PresignedDelivery` adapter — the API renders per-request media playlists with presigned segment URLs directly against R2/S3 (no CDN cache). Same `MediaDelivery` port; selected by `MEDIA_DELIVERY=edge|presigned`.
- **Tests (miniflare):** valid; expired; tampered; wrong asset; traversal; source key denied; Range; cache hit does not re-read R2; CORS preflight; token not in logs.

### 12.7 Playback authorization API (`GET /v1/vod-assets/:id/play`, NFR-004 p95 < 300 ms)

Single authorization query: asset `PUBLISHED`, `publish_after/unpublish_at` window satisfied, `visibility` check, and an `EXISTS` against `v_offering_access` (students: `ENROLLED`, **or** the offering `COMPLETED` and `now < completed_at + studentAccessDaysAfterCompletion` (180); staff: active assignment; admins by scope). Denial ⇒ 404 (not 403). On success mint the token and respond (`Cache-Control: no-store`):

```json
{
  "assetId": "…",
  "title": "…",
  "durationMs": 3600000,
  "posterUrl": "https://media…/t/<tok>/<aid>/poster.jpg",
  "hls": {
    "masterUrl": "https://media…/t/<tok>/<aid>/hls/master.m3u8",
    "audioOnlyUrl": "https://media…/t/<tok>/<aid>/hls/audio/index.m3u8"
  },
  "ladder": [
    { "height": 240, "bandwidthBps": 212000 },
    { "height": 360, "bandwidthBps": 378000 }
  ],
  "ladderComplete": false,
  "expiresAt": "…",
  "resumeMs": 123000,
  "captions": [{ "lang": "en", "url": "…" }]
}
```

Emit `vod.playback.authorized` (metric + sampled `playback_events`), not an audit row. **Player rules (low bandwidth, C-07):** use native HLS where `canPlayType('application/vnd.apple.mpegurl')` else `hls.js`; start on the lowest suitable rung (240p when `navigator.connection.saveData` or `effectiveType ≤ '3g'`, else 360p) with a conservative initial bandwidth estimate (≈ 500 kbps); cap **auto** quality at 480p on cellular/saveData unless the user picks higher; always-visible **Audio only** toggle (loads `audioOnlyUrl`; remembers the choice); buffer ahead ≈ 30 s; **no autoplay/prefetch** of the next video; show data-use hint ("≈ 70 MB/hour at 240p"); resume from `resumeMs`; on `TOKEN_EXPIRED` re-call `/play` and continue at the current position.

### 12.8 Playback progress

`PATCH /v1/vod-assets/:id/progress {positionMs, durationMs, seq}` — client checkpoints every 15 s while playing, on pause/seek-end, and on `visibilitychange`/`pagehide` via `fetch(..., {keepalive:true})`; failed writes retry with backoff and are coalesced (latest wins). Server: UPSERT, clamp `position ≤ duration`, `max_position_ms = GREATEST(...)`, `completed=true` once `percent ≥ 90` (policy), rate-limited 1 write / 5 s / user / asset; ignores stale `seq`. Throughput: 5,000 viewers ÷ 15 s ≈ 333 writes/s — acceptable for Postgres; verified in load tests.

### 12.9 Retention, purge and legal hold (C-09, Q-03, Q-04)

Policy `RECORDING` (institution default, per-offering override): `{ autoPublish:true, studentAccessDaysAfterCompletion:180, purgeDaysAfterCompletion:180, sourceRetentionDays:14, purgeWarningDays:14, audioChannels:'mono', maxHeight:720, transcriptsEnabled:false, driveCleanup:'TRASH_AFTER_INGEST', driveTrashDelayDays:7 }`.

- **Drive cleanup (C-16):** when a recording asset is `READY`, its R2 source MD5 matches Drive's, and the VOD ladder is complete, enqueue `drive.cleanup` with `startAfter = now + driveTrashDelayDays`; the handler re-checks those conditions, calls Drive `files.update {trashed:true}` as the host account, sets `drive_cleanup_status=TRASHED`, and audits `recording.drive.trashed`. It **never** permanently deletes (Drive trash gives a further ~30-day recovery window) and never touches files it did not ingest.
- When an offering becomes `COMPLETED`, set `vod_assets.purge_after = completed_at + purgeDaysAfterCompletion` for its assets (and for assets created later).
- `vod.retention-warning` (daily): notify teachers/admins `purgeWarningDays` ahead (digest, §14.1).
- `vod.retention-sweep` (daily, `lms_system` to list; tenant context to act): for `purge_after <= now AND NOT legal_hold AND status<>'PURGED'`: set `PURGED`, delete the R2 prefix in batches (list + `DeleteObjects`), delete transcript objects, set `purged_at`, audit `vod.asset.purged {assetId, objects, bytes}`; idempotent; global `RETENTION_DRY_RUN=true` logs without deleting (required for the first production run).
- `media.source-sweep` (daily): delete `source/original.mp4` where `source_delete_after <= now` and renditions are `READY` (safety window for re-transcodes).
- **Legal hold:** admin flag on an asset/offering blocks purge; audited.
- **Academic records are not purged by this job** (grades, attendance, results, transcripts, audit follow §18.3).
- Manual delete by teacher/admin: `DELETE /v1/vod-assets/:id` ⇒ `UNPUBLISHED` immediately, `PURGED` after 7 days (undo window), audited.

### 12.10 Direct upload (SHOULD)

Teachers upload lecture videos: `POST /v1/course-offerings/:id/vod-assets` (init, returns multipart presigned URLs into `uploads/` in R2) → client uploads → `POST …/complete` → pipeline starts at `media.probe`. Limits: ≤ 4 GB, MP4/MOV/WebM, size/duration policy; same ladder and edge delivery.

### 12.11 Capacity and cost model (back-of-envelope; verify prices at build time)

**Launch scale (C-13, Q-17 default):** ≤ 15 sessions/day × 60 min; 25 students/session; 30 % watch ×2 ⇒ ≈ 225 viewer-hours/day.
| Item | Formula | Result |
|---|---|---|
| New renditions/month | 15 × 30 × ≈ 1.0 GB | ≈ 450 GB |
| R2 storage steady state (180 d) | ≈ 2.7 TB × $0.015 | ≈ $40/mo |
| Source storage (14 d) | 15 GB/day × 14 × $0.015 | ≈ $3/mo |
| R2 writes (Class A) | 3,000 objects × 450 lectures ≈ 1.35 M (1 M free) | ≈ $2/mo |
| Worker requests | 225 viewer-h/day × 600 × 30 ≈ 4 M (10 M included) | $5/mo plan |
| Transcode compute | 15 h/day × ≈ 0.25 CPU-h | ≈ 4 CPU-h/day ⇒ **one 2–4 vCPU CPU-optimized droplet, mostly idle** |
| Managed alternative (unverified price) | 225 h × 60 × 30 ≈ 405 k min | ≈ $400/mo |
**Target/growth scale** (TRD §18.1 certification numbers), kept for headroom planning:
Assumptions (Target tier from TRD §18.1): 100 sessions/day × 60 min; 80 students/session; 30 % watch the recording at least once, ×2 rewatch ⇒ ≈ 4,800 viewer-hours/day; average 360–480p ≈ 0.2 GB/viewer-hour.
| Item | Formula | Result |
|---|---|---|
| New renditions/month | 100 × 30 lectures × 1 h × ≈ 1.0 GB (ladder total) | ≈ 3 TB |
| R2 storage steady state (180 d) | 18 TB × $0.015 | ≈ $270/mo |
| Source storage (14 d) | 100 GB/day × 14 × $0.015 | ≈ $21/mo |
| R2 egress | free | $0 |
| R2 writes (Class A) | ≈ 3,000 objects/lecture × 3,000 lectures | ≈ 9 M ⇒ ≈ $36/mo |
| Worker requests | 4,800 viewer-h/day × ~600 segs/h × 30 | ≈ 86 M ⇒ ≈ $5 + $0.30 × (86 − 10) ≈ $28/mo |
| Transcode compute | 100 h/day × ≈ 0.25 CPU-h per media-h (to be measured, S-06) | ≈ 25 CPU-h/day ⇒ **2 CPU-optimized droplets** |
| Managed alternative (from memory, unverified): per-minute delivery ≈ $1/1000 min | 4,800 h × 60 × 30 = 8.6 M min | ≈ $8.6k/mo |
For the **Pilot tier** (5 concurrent sessions) storage is ≈ $15/mo and one media droplet is idle most of the day (consider a smaller CPU droplet).
**Droplet transfer note:** workers upload ≈ 3 TB/month to R2 from DigitalOcean; confirm the account's included outbound transfer allowance and overage ($/GB) before launch.

### 12.12 Failure behaviour

| Failure                        | Behaviour                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| Drive file deleted/unreachable | `SOURCE_MISSING`, alert; admin can re-request only if the host restores it               |
| MD5/size mismatch              | retry ≤ 5, then `FAILED` + ops failure                                                   |
| R2 unavailable                 | stage retries with backoff; nothing published; earlier rungs remain                      |
| ffmpeg crash/timeouts          | stage retries (≤ 3) with lower `-preset` fallback `faster` ⇒ `FAILED`                    |
| Worker killed mid-stage        | pg-boss expiry re-delivers; deterministic keys make re-run safe                          |
| Master regeneration race       | single-writer via `singletonKey asset:{id}:master`; last write wins with all READY rungs |
| Token secret leak              | rotate `kid`; old tokens die within ttl; purge cache if needed                           |

---

## 13. Learning, assessment, results, GPA and transcripts

### 13.1 Course space, materials, announcements, files

Each offering has a learner space: overview, schedule, teachers, materials, live sessions, recordings, assignments, quizzes, grades (released only), announcements. Content is visible only through §7 entitlements.

- **Materials** (`course_materials`): FILE/LINK/TEXT; `publish_at`; `section_label` (e.g., "Week 4"); markdown bodies are **sanitized** (allow-list) on render.
- **Announcements:** offering-level; optionally linked to a live session; digest email (§14.1).
- **Files (`files`):** upload flow `POST /v1/files/uploads {name, mime, sizeBytes, purpose}` → presigned **PUT/multipart to R2** (`uploads/{iid}/…`) with MIME allow-list and per-purpose size caps (materials 100 MB, submissions 50 MB, avatars 1 MB) → `POST /v1/files/:id/complete` (HEAD verifies size/etag) → optional `file.scan` job (ClamAV container, `scan_status`; `INFECTED` ⇒ quarantine) → download via `GET /v1/files/:id/download` (authz → **302 to a 5-minute presigned GET**, `Content-Disposition: attachment`). Low-bandwidth: client-side image downscale, resumable multipart for > 8 MB.

### 13.2 Assessments and gradebook

- **Assessment = gradebook column** (`assessments`: `max_score`, `weight` in percent, `status`). Creating an assignment or quiz creates its assessment atomically.
- **Assignments:** due date, optional `cutoff_at`, `late_policy {allowLate, penaltyPctPerDay, maxDays}`, attempts ≤ 10, file/text submissions; a student may resubmit until cutoff; late flag computed server-side; penalties are _suggested_ to the grader (teacher can override).
- **Quizzes:** question bank per **course** (reusable). Starting an attempt **freezes** the question content into `quiz_attempts.question_snapshot` (later edits never alter history). Server-enforced timer: `deadline_at = started_at + time_limit`; autosave `PATCH /v1/quiz-attempts/:id` (small deltas, tolerant of flaky links, idempotent by `seq`); `submit` is idempotent (Idempotency-Key); a delayed pg-boss job (`quiz.expire`, `startAfter = deadline_at + 30 s`) auto-submits expired attempts. Auto-grading for `MCQ_SINGLE/MCQ_MULTI/TRUE_FALSE/SHORT_TEXT`; `ESSAY` is manual; `attempt_scoring` HIGHEST/LAST/AVERAGE feeds the gradebook.
- **Grades:** `PUT /v1/assessments/:id/grades/:studentId {score, feedbackMd}` with `If-Match`; every change writes `grade_changes` + `audit_logs` in the same transaction (INV-11); `DRAFT → RELEASED` per assessment via `POST /v1/assessments/:id/release` (Idempotency-Key); students see only `RELEASED` grades. CSV grade import (SHOULD) uses the same service.
- **Weights:** at finalization, weights of non-excused assessments must total exactly 100.00 (`WEIGHTS_NOT_100`).

### 13.3 Course result finalization

`POST /v1/course-offerings/:id/results/finalize` (PRIMARY teacher or admin; Idempotency-Key) computes **final percentage** for every `ENROLLED/COMPLETED` student and upserts `course_results` as `FINALIZED` (locks the gradebook for that offering: further grade edits require `results:course-result:reopen`).

- Included assessments: `PUBLISHED/CLOSED`; a missing grade counts as **0** once the assessment is `CLOSED` (policy `missingGradeAsZero`, default true); `EXCUSED` grades are removed and the remaining weights renormalised.
- **Exact arithmetic (INV-14):** with `score_x100`, `max_x100`, `weight_x100` integers: `final_pct_x100 = roundHalfUp( Σ score_x100 × weight_x100 / max_x100  ×  10000 / Σ weight_x100(included) )`. Rounding before banding: policy `roundBeforeBanding` ∈ `NONE | INTEGER` (default `INTEGER`, common in Nigerian institutions) — implemented before the band lookup, and the displayed percentage is the rounded one.
- Result fields are frozen at finalization: `grading_scheme_id`, `credits_x10` (curriculum credit override else course credits), `letter`, `points_x100`, `quality_points_x1000 = credits_x10 × points_x100`, `passed = final ≥ scheme.pass_mark`, `counts_in_gpa`, `result_kind` (`AUDIT` enrollments ⇒ `AUDIT`, `counts_in_gpa=false`).
- `attempt_no` = number of earlier results for the same `(student, course)` + 1 (retakes are new enrollments in a later offering).
- Reopen (`POST …/results/reopen`, admin/registrar, `reason` required): writes `course_result_revisions`, sets status back to `DRAFT`, `reopened_count++`, recomputes dependent `semester_results` to `DRAFT`, marks issued transcripts that include the course as `SUPERSEDED`, notifies the student if previously published.

### 13.4 Grading schemes and GPA arithmetic

- **Presets** (seeded per institution, editable only by creating a new locked-on-use scheme):
  - `NUC_5`: A 70–100 ⇒ 5.00; B 60–69 ⇒ 4.00; C 50–59 ⇒ 3.00; D 45–49 ⇒ 2.00; E 40–44 ⇒ 1.00; F 0–39 ⇒ 0.00; pass mark 40; **class bands** First 4.50–5.00, Second Class Upper 3.50–4.49, Second Class Lower 2.40–3.49, Third 1.50–2.39, Pass 1.00–1.49; good standing CGPA ≥ 1.50.
  - `US_4`: A 90–100 ⇒ 4.00 … F < 60 ⇒ 0.00 (editable); class bands optional.
    **Confirmed (C-11): `NUC_5` is the institution default with repeat policy `BEST`**; per-programme overrides remain possible; the code only reads the scheme.
- **Semester GPA** (integer math): `gpa_x100 = roundHalfUp( Σ quality_points_x1000 / Σ credits_x10 )` over results where `result_kind='GRADED' AND counts_in_gpa` for that semester. (Units: `credits_x10 × points_x100 / credits_x10 = points_x100`.) `roundHalfUp(n, d) = floor((2n + d) / (2d))`.
- **Cumulative (CGPA)** over all published/approved results of the programme enrollment up to and including the semester, applying the scheme's **repeat policy** (Q-06): `KEEP_ALL` counts every attempt; `REPLACE_LATEST` counts only the latest attempt per course; `BEST` counts the highest-points attempt. Earlier attempts remain visible on transcripts marked "repeated". Historic semester GPAs are **never rewritten**; only cumulative values reflect the policy.
- **Credits earned:** `Σ credits_x10` of counting results with `passed=true`, plus `EXEMPT` credits (policy `exemptCountsAsEarned`, default true). `INCOMPLETE`/`WITHDRAWN` earn nothing and are excluded from GPA.
- **Standing:** `CGPA ≥ good_standing` ⇒ `GOOD`; else if `probation_cgpa` configured and `CGPA ≥ probation_cgpa` ⇒ `PROBATION`; else `WITHDRAW_REQUIRED`; no counting credits ⇒ `UNKNOWN`. Standing is advisory and displayed to registrars; no automatic enrollment changes.
- Implementation: pure functions in `modules/results/domain` (`computeFinalPercent`, `bandFor`, `computeSemesterResult`, `classify`) with property tests (rounding, ties, zero credits) and the golden vectors in Appendix C.

### 13.5 Semester results workflow

1. **Compute** (`results.compute-semester`, enqueued on `academic.semester.closed` and on demand): for each programme enrollment with `FINALIZED` course results in the semester, upsert `semester_results` (`DRAFT`), idempotent, `calc_version++` only on change.
2. **Approve** (`results:semester:approve`, registrar/admin; Idempotency-Key): bulk by programme/cohort/semester; locks inputs; sets `semester_results` and the underlying `course_results` to `APPROVED`; audit with counts.
3. **Release (C-11, `releaseMode='ON_FINALIZE'`, default):** a student sees each **course result** as soon as the teacher finalizes it (`course.result.finalized` ⇒ in-app notification), and sees semester GPA/CGPA labelled **Provisional** (recomputed automatically on every finalize/reopen). Registrar **approve** + **publish** (`results:semester:publish`) removes the _Provisional_ label and is required for official transcripts and degree awards. `releaseMode='AFTER_APPROVAL'` remains available per institution.
4. Changes after publication follow §13.3 _Reopen_.
   **Exports:** `GET /v1/reports/results?semesterId=&programmeId=&format=csv|json` (registrar) — broadsheet with credits, GPA, CGPA, standing.

### 13.6 Degree classification and awards

`POST /v1/programme-enrollments/:id/degree-award/propose` computes final CGPA, credits earned vs programme requirement (from the active curriculum placements: all `COMPULSORY` earned + elective credit minimum), and the class label from `class_bands`; registrar `confirm`s (`results:degree:confirm`) ⇒ `degree_awards.status='CONFERRED'`, `awarded_on`, `certificate_no` (institution-prefixed sequence), programme enrollment `COMPLETED`, student `GRADUATED`. Missing requirements are returned as a checklist (`REQUIREMENTS_NOT_MET`) rather than blocking _proposal_.

### 13.7 Transcripts (tamper-evident, verifiable)

- **Request:** students create `transcript_requests` (OFFICIAL: purpose, recipient name/email; UNOFFICIAL: policy `unofficialAutoIssue` default true, rate-limited 5/day). OFFICIAL needs registrar `approve` (or reject with reason).
- **Issue** (`POST /v1/transcript-requests/:id/issue`, Idempotency-Key; registrar): in one transaction build the **snapshot JSON** (institution, programme, student legal name + matric number, per-semester course lines [code, title, credits, letter, points, repeated flag], semester GPA/CGPA/standing, cumulative totals, degree award if conferred, grading-scheme legend, `as_of`), canonicalise (sorted keys, no whitespace), compute `snapshot_sha256`, allocate `serial_no` (institution-prefixed monotonic) and a 16-character base32 `verification_code`, insert `transcripts` (immutable) and enqueue `transcript.generate`. Inclusion rule (Q-18 default): **OFFICIAL** transcripts include only semesters whose results are `APPROVED/PUBLISHED` (issuance is blocked with `TRANSCRIPT_NOT_ISSUABLE` while a requested semester is provisional); **UNOFFICIAL** transcripts include `FINALIZED` results and print _Provisional_ beside unapproved semesters.
- **PDF** (`transcript.generate`, role `general`, `@react-pdf/renderer`): renders **from the snapshot only** (never live data), A4, fixed header/footer on every page, page "n of N", embedded fonts with full Unicode coverage (test names with Yoruba/Igbo tonal marks), a QR code to `https://<app>/verify/<code>`, the serial and a short hash (first 12 hex chars) in the footer; UNOFFICIAL carries a diagonal watermark. The PDF is stored via `files`; PDFs are not byte-deterministic, so **integrity is anchored on `snapshot_sha256`**, not on the file hash.
- **Verify (public):** `GET /v1/public/transcripts/:code` (unauthenticated, rate-limited 30/min/IP, no PII beyond what is needed) returns `{valid, status, issuedAt, institutionName, programmeName, studentInitials, asOf, snapshotSha256}` via the SECURITY DEFINER function; the SPA route `/verify/:code` displays it and lets the verifier paste the hash printed on the PDF to confirm a match. Revoked/superseded documents show their status explicitly.
- **Revoke/supersede:** `POST /v1/transcripts/:id/revoke {reason}` (registrar, audited) ⇒ `REVOKED`; automatic `SUPERSEDED` on reopen (§13.3); a re-issue creates a **new** serial.
- **Delivery:** student downloads own issued transcripts (authz); registrar may email the PDF to the recipient via SES (`transcript.send`, attachment ≤ 5 MB or expiring authenticated link). PAdES signatures are out of scope (Q-08).

---

## 14. Notifications, imports, admin operations

### 14.1 Notifications (ADR-13)

- **Channels:** in-app (`notifications`) + email (`Mailer` port → SES SMTP). No SMS/WhatsApp/push (C-07/Q-12).
- **Volume discipline (data cost + SES cost):** email only for **critical** kinds by default — invite, password reset, session **cancelled/rescheduled** (to enrolled students), results published, transcript issued/revoked, ops alerts. Everything else (new recording, announcement, reminders, purge warnings) is **in-app + a daily digest email** (cron `notify.digest`, 06:00 institution time), per-user preferences (`notification_preferences`) can turn kinds on/off.
- **Reminders:** `live.session.reminder` in-app 15 min before start (and an optional email if the user opted in).
- **Delivery:** `notify.send` queue (retry 5, backoff); unique `(institution_id, user_id, dedupe_key)` prevents duplicates; bounces/complaints from SES are consumed via an SNS→HTTPS webhook (`POST /v1/integrations/ses/events`, signature-verified) and mark `users.email_status` so the system stops mailing hard-bouncing addresses.
- **Content:** plain-text + minimal HTML (< 20 KB, no remote images) for low-bandwidth readers; links deep-link to the SPA.
- **Quiet hours:** no non-critical emails 21:00–06:00 institution time.

### 14.2 Imports (onboarding 25,000 users — Δ-17)

`POST /v1/imports {kind, fileId, dryRun}` (Idempotency-Key) → `import.run` job streams the CSV from R2, validates every row with Zod, and runs in batches of 500 inside transactions.

- **Kinds:** `USERS`, `STUDENTS`, `TEACHERS`, `COURSE_ENROLLMENTS`. Templates are served from `/v1/imports/templates/:kind.csv`.
- **Dry run (default):** returns per-row errors/warnings without writing; the **commit** run requires an unchanged file hash.
- **Idempotent upsert** by natural keys (`email`, `student_number`, `staff_code`, `(student_number, offering code)`); row-level error CSV written to R2 (`error_file_id`); partial failure never leaves a half-applied batch (per-batch transaction, resumable by row offset).
- **Invites:** `USERS/STUDENTS/TEACHERS` can enqueue invite emails with a rate cap (default 20/min) to protect sender reputation.

### 14.3 Admin operations (Δ-28, FR-020)

- `GET /v1/admin/ops/failures` — unified view over `v_ops_failures`: Google/event failures, recording failures (`FAILED`, `SOURCE_MISSING`), sessions with `provider_status=ERROR`, pg-boss failed/dead-letter jobs, expiring subscriptions, storage warnings (Drive quota ≥ 70 %).
- `POST /v1/admin/ops/replay/:kind/:id` — replay: `provider-event`, `recording`, `session-provision`, `job` (re-queues a dead-letter job); audited.
- `GET /v1/admin/integrations/google/status` (+ `POST …/test`): per-host health (token mint, `spaces.get`, Drive `about`), subscription state, quota-wait metrics, circuit-breaker state, DWD scope diff (granted vs required).
- **pg-boss dashboard** (`@pg-boss/dashboard`) mounted behind `/admin/jobs` for `PLATFORM_ADMIN` only.
- **Google integration wizard (UI):** shows the service-account **Client ID** and the exact scope list for the domain admin to paste into Admin Console (§Appendix A), then runs the test.

---

## 15. API catalogue

Base `/v1`. Auth: session cookie + CSRF header unless noted. **Idem** = `Idempotency-Key` required. Permission names from §7. All list endpoints are cursor-paginated (§5.4). Every endpoint has deny-path tests (§0.3).

| Area        | Method & path                                                                                                                                                                                                                                                        | Permission                                                                                                                       | Idem                                                                                         | Notes                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------- | ------ | ------------------------------ | ---------------------- |
| Auth        | `POST /auth/login` · `POST /auth/logout` · `GET /auth/google/start` · `GET /auth/google/callback` · `POST /auth/google/link`                                                                                                                                         | public/own                                                                                                                       | –                                                                                            | rate-limited; link requires a session |
| Auth        | `POST /auth/password/forgot` · `POST /auth/password/reset` · `POST /auth/invite/accept`                                                                                                                                                                              | public                                                                                                                           | –                                                                                            | uniform responses                     |
| Me          | `GET /me` · `PATCH /me` · `GET /me/schedule` · `GET /me/enrollments` · `GET /me/grades` · `GET /me/results` · `GET /me/notifications` · `POST /me/notifications/:id/read`                                                                                            | own                                                                                                                              | –                                                                                            | `GET /me` returns csrf token + flags  |
| Users       | `GET/POST /users` · `GET/PATCH /users/:id` · `POST /users/:id/deactivate` · `POST /users/:id/roles` · `DELETE /users/:id/roles/:assignmentId`                                                                                                                        | `identity:user:*`, `identity:role:manage`                                                                                        | –                                                                                            | role changes audited                  |
| Imports     | `POST /imports` · `GET /imports/:id` · `GET /imports/templates/:kind.csv`                                                                                                                                                                                            | `identity:import:run`                                                                                                            | ✔                                                                                            |                                       |
| Policies    | `GET/PUT /policies/:type` (ATTENDANCE, RECORDING, JOIN_WINDOW, GOOGLE_MEET, RETENTION, NOTIFICATION, GRADING_DEFAULTS)                                                                                                                                               | `identity:policy:manage`                                                                                                         | –                                                                                            | append-only versions                  |
| Academic    | `GET/POST /org-units` · `GET/POST/PATCH /programmes` · `GET/POST /cohorts` · `GET/POST /courses`, `PATCH /courses/:id`                                                                                                                                               | `academic:structure:*`                                                                                                           | –                                                                                            |                                       |
| Academic    | `GET/POST /curricula` · `POST /curricula/:id/activate` · `POST /curricula/:id/clone` · `PUT /curricula/:id/courses`                                                                                                                                                  | `academic:structure:manage`                                                                                                      | –                                                                                            |                                       |
| Academic    | `GET/POST /academic-sessions` · `POST /academic-sessions/:id/activate                                                                                                                                                                                                | close`·`GET /semesters?sessionId=`·`POST /semesters`·`PATCH /semesters/:id`·`POST /semesters/:id/open-registration               | activate                                                                                     | close`                                | `academic:structure:*` | –      | close enqueues results compute |
| Offerings   | `GET/POST /course-offerings` · `GET/PATCH /course-offerings/:id` · `POST …/publish` · `POST …/cancel`                                                                                                                                                                | `academic:course-offering:*`                                                                                                     | –                                                                                            | `If-Match` on PATCH                   |
| Teaching    | `GET/POST /course-offerings/:id/teachers` · `DELETE /course-offerings/:id/teachers/:assignmentId`                                                                                                                                                                    | `teaching:assignment:*`                                                                                                          | –                                                                                            | updates `session_teacher_slots`       |
| People      | `GET/POST /students` · `GET/PATCH /students/:id` · `GET/POST /teachers` · `GET/PATCH /teachers/:id`                                                                                                                                                                  | `enrollment:student:*`                                                                                                           | –                                                                                            |                                       |
| Enrollment  | `POST /students/:id/programme-enrollments` · `POST /programme-enrollments/:id/semester-enrollments` · `POST /semester-enrollments/:id/course-enrollments` · `POST /semester-enrollments/:id/auto-register`                                                           | `enrollment:*` / self-register                                                                                                   | –                                                                                            | auto-register idempotent              |
| Enrollment  | `GET/POST /course-offerings/:id/enrollments` (bulk) · `PATCH /course-enrollments/:id`                                                                                                                                                                                | `enrollment:course-enrollment:*`                                                                                                 | ✔ (bulk)                                                                                     | drop/withdraw emits event             |
| Sessions    | `GET/POST /course-offerings/:id/sessions` · `POST /course-offerings/:id/session-series`                                                                                                                                                                              | `session:live-session:read                                                                                                       | manage`                                                                                      | ✔                                     | conflict checks        |
| Sessions    | `GET/PATCH /sessions/:id` · `POST /sessions/:id/cancel                                                                                                                                                                                                               | reprovision                                                                                                                      | start                                                                                        | join                                  | end`                   | per §7 | –                              | `join` DB-only (INV-8) |
| Attendance  | `GET /sessions/:id/attendance` · `GET /sessions/:id/participants` · `POST /sessions/:id/participants/:pid/match` · `POST /sessions/:id/attendance/:studentId/override` · `DELETE …/override` · `POST /sessions/:id/attendance/recompute` · `GET /reports/attendance` | `attendance:*`                                                                                                                   | –                                                                                            | reason required on override           |
| VOD         | `GET /course-offerings/:id/vod-assets` · `GET /vod-assets/:id` · `GET /vod-assets/:id/play` · `PATCH /vod-assets/:id/progress`                                                                                                                                       | `vod:asset:read                                                                                                                  | play`, `vod:progress:write`                                                                  | –                                     | `play` p95 < 300 ms    |
| VOD         | `PATCH /vod-assets/:id` · `POST /vod-assets/:id/publish                                                                                                                                                                                                              | unpublish`·`DELETE /vod-assets/:id`·`POST /vod-assets/:id/retry-ingestion`·`POST /course-offerings/:id/vod-assets`(+`/complete`) | `vod:asset:manage                                                                            | retry-ingestion`                      | ✔ (publish)            |        |
| Content     | `GET/POST/PATCH/DELETE /course-offerings/:id/materials` · `…/announcements`                                                                                                                                                                                          | `content:*`                                                                                                                      | –                                                                                            |                                       |
| Files       | `POST /files/uploads` · `POST /files/:id/complete` · `GET /files/:id/download`                                                                                                                                                                                       | own/authz                                                                                                                        | –                                                                                            | presigned R2                          |
| Assessment  | `GET/POST /course-offerings/:id/assignments` · `PATCH /assignments/:id` · `POST /assignments/:id/publish` · `POST /assignments/:id/submissions` · `GET /assignments/:id/submissions`                                                                                 | `assessment:assignment:manage`, `assessment:submission:*`                                                                        | –                                                                                            |                                       |
| Assessment  | `GET/POST /courses/:id/questions` · `GET/POST /course-offerings/:id/quizzes` · `PATCH /quizzes/:id` · `POST /quizzes/:id/publish` · `POST /quizzes/:id/attempts` · `PATCH /quiz-attempts/:id` · `POST /quiz-attempts/:id/submit`                                     | `assessment:quiz:*`                                                                                                              | ✔ (submit)                                                                                   | server timer                          |
| Gradebook   | `GET /course-offerings/:id/gradebook` · `PUT /assessments/:id/grades/:studentId` · `POST /assessments/:id/release` · `POST /course-offerings/:id/grades/import`                                                                                                      | `assessment:grade:*`                                                                                                             | ✔ (release)                                                                                  | `If-Match`, audit                     |
| Results     | `POST /course-offerings/:id/results/finalize` · `POST …/results/reopen` · `GET /course-offerings/:id/results`                                                                                                                                                        | `results:course-result:*`                                                                                                        | ✔ (finalize)                                                                                 |                                       |
| Results     | `POST /results/semesters/compute` · `POST /results/semesters/approve` · `POST /results/semesters/publish` · `GET /results/semesters` · `GET /reports/results`                                                                                                        | `results:semester:*`                                                                                                             | ✔                                                                                            | bulk by programme/cohort              |
| Results     | `GET/POST /grading-schemes` · `POST /programme-enrollments/:id/degree-award/propose                                                                                                                                                                                  | confirm`                                                                                                                         | `results:scheme:manage`, `results:degree:confirm`                                            | –                                     |                        |
| Transcripts | `POST /transcript-requests` · `GET /transcript-requests` · `POST /transcript-requests/:id/approve                                                                                                                                                                    | reject                                                                                                                           | issue`·`GET /transcripts/:id`·`GET /transcripts/:id/download`·`POST /transcripts/:id/revoke` | `transcript:*`                        | ✔ (issue)              |        |
| Public      | `GET /public/transcripts/:code`                                                                                                                                                                                                                                      | none                                                                                                                             | –                                                                                            | rate-limited                          |
| Admin       | `GET /admin/ops/failures` · `POST /admin/ops/replay/:kind/:id` · `GET/POST /admin/integrations/google` · `POST /admin/integrations/google/test` · `GET /audit-logs`                                                                                                  | `ops:*`, `audit:log:read`                                                                                                        | –                                                                                            |                                       |
| Webhooks    | `POST /integrations/google/workspace-events` (push mode only) · `POST /integrations/ses/events`                                                                                                                                                                      | provider-verified                                                                                                                | –                                                                                            | inbox before ack                      |
| Health      | `GET /healthz` · `GET /readyz` · `GET /metrics` (internal)                                                                                                                                                                                                           | none/internal                                                                                                                    | –                                                                                            | readiness = DB + pg-boss              |

---

## 16. Jobs (pg-boss) and domain events

### 16.1 Queue catalogue

Defaults: `retryBackoff:true`, DLQ `<queue>.dlq`, archive 7 d / delete 30 d. `expire` = pg-boss job expiration (set ≥ 2 × P99). Role = `WORKER_ROLE` that processes it.
| Queue | Role | Producer | Retry / expire | Dedupe / notes |
|---|---|---|---|---|
| `session.provision` | google | create session, reprovision, `/join` priority | 6 / 5 min | `session:{id}:provision` |
| `session.sync-access` | google | provision, enrollment/teaching events | 6 / 10 min | debounced 30 s per session |
| `session.end` | google | `/sessions/:id/end` | 3 / 2 min | |
| `session.finalize` | general | `conference.ended` (delayed) | 5 / 10 min | `session:{id}:finalize` |
| `conference.sync` | google | ended/finalize/reconcile | 6 / 15 min | debounced per conference; cost ≈ participants reads |
| `provider-event.route` / `.process` | general | Pub/Sub puller / push | 5 / 2 min | inbox row id |
| `attendance.recompute` | general | override/match/manual | 3 / 2 min | per session, advisory lock |
| `recording.discover` | general | event/reconcile/admin | 6 / 5 min | `recording:{provId}` |
| `recording.ingest` | media | discover | 5 / **4 h** | `recording:{id}`; concurrency 2/droplet |
| `media.probe` | media | ingest | 3 / 15 min | |
| `media.transcode-fast` | media | probe | 3 / **4 h** | concurrency 1/droplet |
| `media.transcode-full` | media | fast | 3 / **6 h** | concurrency 1/droplet |
| `media.finalize` | media | full/fast | 3 / 30 min | `asset:{id}:master` |
| `media.source-sweep` · `vod.retention-warning` · `vod.retention-sweep` | media/general | cron daily | 2 / 1 h | dry-run flag |
| `drive.cleanup` | google | ladder complete (`startAfter` +7 d) | 5 / 5 min | `recording:{id}:drive-cleanup`; re-checks conditions |
| `transcript.discover` | general | event | 6 / 5 min | speech transcript (optional) |
| `upload.process` | media | teacher upload complete | 3 / **4 h** | enters at probe |
| `file.scan` | general | file complete | 3 / 5 min | optional ClamAV |
| `quiz.expire` | general | attempt start (`startAfter`) | 3 / 2 min | per attempt |
| `import.run` | general | `POST /imports` | 2 / 2 h | resumable by offset |
| `results.compute-semester` | general | semester closed/manual | 3 / 30 min | per programme enrollment batch |
| `transcript.generate` · `transcript.send` | general | issue | 3 / 10 min | |
| `notify.send` · `notify.digest` | general | domain events/cron | 5 / 2 min | |
| `domain-event` | general | any service | 5 / 2 min | dispatcher → subscribers |
| `subscription.renew` | google | cron/lifecycle | 6 / 5 min | per subscription |
| `idempotency.cleanup` · `auth.session-cleanup` · `audit.partition-maintenance` | scheduler | cron | 2 / 10 min | |

### 16.2 Cron schedules (`scheduler` role, `boss.schedule`, `tz='UTC'` unless noted)

`session-tick` every 1 min · `session-reconciliation` every 3 min · `recording-reconciliation` every 10 min · `subscription-renewal` every 15 min · `stuck-asset-sweeper` every 10 min · `recurrence-extender` daily 02:00 · `vod-integrity-check` daily 03:00 · `media.source-sweep` daily 03:30 · `vod.retention-warning`/`sweep` daily 04:00 · `notify.digest` 06:00 `Africa/Lagos` · `idempotency.cleanup` hourly · `auth.session-cleanup` hourly · `drive-storage-monitor` hourly · `audit.partition-maintenance` monthly.

### 16.3 Domain events (enqueued on `domain-event`, same transaction)

`academic.session.created`, `academic.semester.opened|closed`, `course.offering.created|published|cancelled`, `course.enrollment.activated|ended`, `teaching.assignment.created|ended`, `live.session.scheduled|provisioned|opened|started|ended|cancelled|resumed`, `attendance.provider.event.received`, `attendance.projection.updated`, `attendance.finalized`, `recording.discovered`, `recording.ingestion.started|completed|failed`, `vod.asset.playable|published|unpublished|purged`, `vod.progress.updated`, `assessment.submission.created`, `assessment.grade.updated|released`, `results.course.finalized|reopened`, `results.semester.approved|published`, `transcript.requested|issued|revoked|superseded`. Subscribers: notifications, `session.sync-access` (enrollment/teaching), results compute, audit enrichment. Subscribers are idempotent and registered in `apps/worker/src/subscribers.ts`.

---

## 17. Frontend (low-bandwidth first)

### 17.1 Stack and structure (ADR-16)

React + Vite + TypeScript SPA in `apps/web`; TanStack Router (file-based, code-split per route) + TanStack Query; Tailwind + shadcn/ui (Radix primitives); react-hook-form + Zod (contracts shared with the API); `hls.js` loaded **lazily** only on the player route; `vite-plugin-pwa` (precache the app shell and static assets; **no offline data**). Typed API client generated from OpenAPI. System font stack (no web fonts). Icons via inline SVG sprite (tree-shaken). i18n: strings externalised (English only; Q-12).

### 17.2 Routes and screens

| Role              | Routes                                                                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public            | `/login`, `/invite/:token`, `/forgot`, `/reset/:token`, `/verify/:code` (transcript verification)                                                                                                                                                                                         |
| Student           | `/` (today: next sessions, continue watching) · `/courses` · `/courses/:offeringId` (tabs: Overview, Schedule, Materials, Recordings, Assignments, Quizzes, Grades, Announcements) · `/watch/:vodId` · `/results` · `/transcripts` · `/profile` (link Google account, notification prefs) |
| Teacher           | `/teach` · `/teach/:offeringId` (Schedule, Roster, Attendance, Recordings, Materials, Assignments, Quizzes, Gradebook, Results) · `/teach/sessions/:id` (start/join, participants timeline, unresolved participants)                                                                      |
| Academic admin    | `/admin/academic` (sessions, semesters, programmes, curricula, courses, offerings, sections, audiences) · `/admin/enrollment` · `/admin/people` · `/admin/imports`                                                                                                                        |
| Registrar         | `/registrar/results` (compute/approve/publish, broadsheets) · `/registrar/transcripts` (requests, issue, revoke) · `/registrar/awards` · `/registrar/schemes`                                                                                                                             |
| Institution admin | `/admin/policies` · `/admin/integrations/google` (wizard + status) · `/admin/ops` (failures, replay) · `/admin/audit`                                                                                                                                                                     |
| Platform admin    | `/platform/tenants` · `/admin/jobs` (pg-boss dashboard link)                                                                                                                                                                                                                              |

### 17.3 Low-bandwidth budgets (INV-13; enforced by `pnpm -w budget:check` in CI)

| Budget                                                             | Limit                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Initial JS (login + shell), gzip/brotli                            | **≤ 170 KB** (hard fail > 200 KB)                                                              |
| Any route chunk                                                    | ≤ 60 KB; player route (excl. `hls.js`) ≤ 40 KB; `hls.js` chunk lazy only                       |
| Initial CSS                                                        | ≤ 30 KB                                                                                        |
| Requests to first interactive screen                               | ≤ 12                                                                                           |
| LCP on simulated _slow 4G_ (1.6 Mbps, 150 ms RTT, 4× CPU slowdown) | ≤ 4.0 s (Lighthouse CI, mobile)                                                                |
| API payloads                                                       | list items ≤ 2 KB each; no list > 50 KB uncompressed; ETag on GET lists                        |
| Images                                                             | AVIF/WebP, ≤ 40 KB each, lazy-loaded; avatars ≤ 1 MB upload, client-side downscale to ≤ 256 px |

Practices: `Cache-Control: public, max-age=31536000, immutable` on hashed assets; Brotli at Caddy; request coalescing and `staleTime` tuned (lists 30 s); **no polling on background tabs** (pause on `visibilitychange`); skeletons not spinners; optimistic UI for progress writes; data-saver mode (`Save-Data` or user toggle) disables non-essential images/prefetch and sets video to audio-only by default. If the budget cannot be met, evaluate **Preact via `preact/compat` aliasing** (measure before adopting; verify Radix/TanStack/hls.js integration in a spike) rather than weakening the budget.

### 17.4 Key interactions

- **Join live class (student):** Course page shows next session card → "Join" calls `POST /sessions/:id/join` → on `GOOGLE_ACCOUNT_REQUIRED` show the link-account step; on success open `joinUrl` (opens the Meet app on mobile) and show a **low-data tip** (join with camera off, or dial in using `dialIn`); if the user must knock, show "Wait in the lobby — your teacher will admit you".
- **Session state:** polling `GET /sessions/:id` every 30 s only on the session/course page (ADR-17), with ETag (304 responses are tiny). Composite display states per §10.4.
- **Teacher start:** "Start class" (joins as co-host), shows "Recording starts when you join" and unresolved participants banner post-class.
- **Player (`/watch/:id`):** `VodPlayer` wrapper implementing §12.7 rules; quality menu (Auto, 240p…720p, **Audio only**), data-use estimate, resume prompt, captions if present; progress checkpoint logic §12.8.
- **Results/transcripts:** read-only tables; "Request transcript" wizard; downloads authenticated.
- **Forms:** autosave drafts (assignments/quiz answers) with debounce 5–10 s and retry on reconnect; clear "Saved/Offline — will retry" indicator.
- **Errors:** map API error codes to friendly copy; show `requestId` on unexpected errors for support.

### 17.5 Accessibility and quality

WCAG 2.1 AA baseline; keyboard operable player; captions where available; contrast tokens; reduced-motion respected; axe checks in Playwright; responsive (mobile-first; teachers on laptops). RTL not required.

---

## 18. Security, privacy, compliance (Nigeria)

### 18.1 Security baseline

TLS everywhere (Caddy auto-TLS; media hostname TLS by Cloudflare) · HSTS · strict CSP (`default-src 'self'`; `media-src https://media.<domain>`; `connect-src 'self' https://media.<domain>`; `img-src 'self' data: https://media.<domain>`; no inline scripts) · `Referrer-Policy: no-referrer` · `X-Content-Type-Options: nosniff` · cookies per §8.3 · CSRF header · same-origin API (no CORS) · input validation with Zod at every edge · parameterized SQL only (Drizzle) · rate limits (§5.4) · uploads: MIME allow-list, size caps, optional ClamAV, `Content-Disposition: attachment` · markdown sanitisation · SSRF: server never fetches user-supplied URLs · secrets via sops+age (no secrets in env files committed; no secrets in logs) · dependency scanning (`pnpm audit`, Renovate), SBOM (CycloneDX), container scan (Trivy) · DO Cloud Firewall: only 80/443 (via LB), SSH from a bastion/VPN allow-list, Managed PG **trusted sources** = droplets in the VPC only · least-privilege API tokens (Cloudflare scoped to the Worker + bucket; Google DWD scopes per §10.3).

### 18.2 Webhook/event authenticity

Pub/Sub **pull** needs no public endpoint; in push mode verify the Pub/Sub OIDC JWT (audience + service account); SES/SNS webhook verifies the SNS signature and subscription confirmation; all inbound events are deduplicated by id (INV-5).

### 18.3 Data classification and retention (C-09, Q-03)

| Data                                                       | Classification                                | Default retention                                  | Notes                                                       |
| ---------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Recordings, VOD renditions, speech transcripts             | Confidential, may contain student voice/video | **180 days after offering completion** then purged | legal hold available; Drive source stays until host cleanup |
| Attendance, grades, course/semester results, degree awards | Academic record                               | 10 years (configurable)                            | Q-03 confirms                                               |
| Issued transcripts (snapshots)                             | Academic record, tamper-evident               | 10 years; PDFs regenerable from snapshot           |                                                             |
| Audit logs                                                 | Security                                      | 7 years                                            | append-only, partitioned                                    |
| Join logs, playback events                                 | Operational                                   | 12 months / 6 months                               | aggregated afterwards                                       |
| Auth sessions, idempotency keys                            | Operational                                   | 30 days / 48 h                                     |                                                             |

All periods are policy-driven (`RETENTION` policy); deletion is audited and cascades media safely without destroying academic evidence.

### 18.4 Nigeria data protection and cross-border transfer (Δ-38; **cross-border legal review completed — C-15**)

- The **NDPA 2023** and the **GAID 2025** (in force 19 Sep 2025) regulate processing; **cross-border transfer** (sending to, **storing in, or accessing from** another country) is governed by NDPA ss. 41–43 and GAID Schedule 5: adequacy decision, an NDPC-approved transfer instrument, or another s. 43 lawful basis. **DigitalOcean has no African region**, so hosting in London/Frankfurt/Amsterdam **is** a cross-border transfer; Google (Meet/Drive), Cloudflare (R2/Worker) and SES are also processors outside Nigeria.
- **Engineering support for compliance (built, not legal advice):** processing register export (data categories, purposes, processors, regions, retention) from `docs/compliance/ropa.md`; privacy notice + **recording notice** shown before the first live join and on recorded sessions (Meet also notifies participants); consent/lawful-basis fields in policies; **data subject requests**: `GET /v1/me/data-export` (JSON of the user's data) and an admin **erasure/anonymisation workflow** that preserves academic records required by law (anonymise profile, retain results with a pseudonymous id); breach runbook (72-hour NDPC notification timeline) in `docs/runbooks/breach.md`; DPIA template for recordings; data-processing agreements tracked for DO, Cloudflare, Google, AWS (SES); NDPC registration status tracked as a launch gate.
- Minimise: only collect fields in §6 (no DOB/national ID/address in MVP); no analytics trackers; logs redact PII (emails hashed in logs).

### 18.5 Recording consent

Institution policy chooses: notice-only (default; Meet announces recording and the LMS shows a notice) or explicit acceptance at enrollment; teachers see "This class is recorded" before starting.

---

## 19. Observability and SLOs

### 19.1 Telemetry (ADR-15)

OpenTelemetry SDK in `api` and `worker` → OTLP → **self-hosted `grafana/otel-lgtm`** on the ops droplet (Grafana, Loki, Tempo, Prometheus/Mimir); `pino` JSON logs to stdout collected by the container logging driver/Promtail. DO Monitoring + **DO Uptime** checks (`/readyz`, media-edge health, login page) alert via email. Trace path: HTTP → authorization → DB → pg-boss enqueue → job handler → Google/R2 → publish; the job payload carries `traceparent`.

### 19.2 Metrics (names are contracts)

API: `http_request_duration_ms{route,status}`, `http_requests_total`. DB: `db_pool_in_use`, `db_tx_duration_ms`. Queue: `boss_queue_depth{queue}`, `boss_job_age_seconds{queue}`, `boss_job_duration_ms`, `boss_job_failures_total`. Google: `google_api_calls_total{api,method,status}`, `google_quota_wait_ms{bucket}`, `google_circuit_state{host}`, `google_subscription_expires_in_seconds`, `host_pool_utilization`. Live: `session_join_total{outcome}`, `attendance_lag_seconds`, `unresolved_participants_total`. Media: `recording_lag_seconds`, `transcode_realtime_factor`, `ingest_throughput_mbps`, `vod_playable_after_seconds`. Edge: Worker analytics (requests, 4xx by code, cache hit ratio), R2 ops. Results: `results_compute_duration_ms`. Storage: `drive_quota_used_ratio{host}`. Email: `mail_sent_total`, `mail_bounce_total`.

### 19.3 SLOs and alerts

| Service                    | Target                                                                 | Alert                                  |
| -------------------------- | ---------------------------------------------------------------------- | -------------------------------------- |
| Core API availability      | 99.9 % monthly (tier H; tier P best-effort 99.5 %)                     | burn-rate 2 %/1 h                      |
| Read/write API p95         | < 300 ms / < 500 ms                                                    | p95 > target 10 min                    |
| Join authorization p95     | < 1.5 s (server < 100 ms)                                              | > 1 s 5 min                            |
| VOD authorization p95      | < 300 ms                                                               | > 250 ms 10 min                        |
| First rung playable        | 95 % within 15 min of provider file availability (≤ 60-min recordings) | `vod_playable_after_seconds` p95 > 900 |
| Critical job start latency | 99 % < 60 s                                                            | `boss_job_age_seconds` > 120           |
| Event subscription         | never within 12 h of expiry                                            | `expires_in < 12h`                     |
| Drive quota                | < 70 % warn, 85 % page                                                 | thresholds                             |
| DB                         | connections < 80 % budget; replication lag < 5 s                       | thresholds                             |

Runbooks (`docs/runbooks/*.md`): provider outage, quota exhaustion, stuck transcode, SOURCE_MISSING, subscription renewal failure, DB failover, restore drill, breach response.

---

## 20. Testing

### 20.1 Pyramid and gates

Unit (domain rules, state machines, pure functions) → integration (real Postgres 18 via Testcontainers: repositories, RLS, exclusion constraint, transactions, **pg-boss handlers incl. transactional enqueue**, MinIO for storage) → contract (OpenAPI/Zod schemas, event/queue payloads, `media-token` claims) → end-to-end (Playwright against compose stack with `FakeGoogleServer` and miniflare media-edge) → load (k6) → failure injection. All run in CI except real-Google smoke (manual, Appendix B).

### 20.2 Mandatory automated scenarios

**Tenancy/authz:** cross-tenant read/write on every module ⇒ 404; table-driven deny tests over personas (§7.5) generated from `matrix.json`; RLS fails closed with no tenant setting; tenant-FK lint (§5.2); `lms_app` cannot bypass RLS.
**Live/attendance:** duplicate Workspace event delivery ⇒ no duplicate rows; out-of-order participant events converge after `conference.sync`; two concurrent session creations with one Idempotency-Key ⇒ one session; **two concurrent sessions for the same teacher ⇒ exclusion constraint rejects the second**; join before window ⇒ 409; join with no linked Google account ⇒ 409 `GOOGLE_ACCOUNT_REQUIRED`; unenrolled user never receives a join URL; withdrawn student cannot join/play; provision handler crash between Google call and commit ⇒ orphan tolerated, retry does not create a second linked space; quota exhaustion ⇒ job re-scheduled, no retry storm; Google 5xx ⇒ bounded retries; state-machine table tests incl. ENDED→LIVE within overrun; attendance golden vectors (App. C); override survives recompute; unresolved-participant review flow.
**VOD:** ingest idempotent (re-run does not duplicate assets); MD5 mismatch ⇒ retry then FAILED; asset never `PUBLISHED` while a rung in the master is `FAILED`; master lists only READY rungs; segment durations align across rungs (±0.1 s); `source/**` never served by the edge; token tests (expired/tampered/wrong asset/traversal); purge sweep dry-run vs real; legal hold blocks purge; playback denied after completion + 180 days; progress monotonicity and rate limit.
**Results:** golden GPA vectors (App. C); property tests for `roundHalfUp`, banding boundaries, zero-credit semesters; repeat policies (`KEEP_ALL`, `REPLACE_LATEST`, `BEST`); reopen cascades (semester to DRAFT, transcripts SUPERSEDED); published results immutable without reopen; transcript snapshot hash stable for identical input and changes if any field changes; PDF renders Unicode names (Yoruba/Igbo diacritics) and multi-page pagination; verify endpoint returns only minimal fields and respects revocation.
**Platform:** outbox-free durability — kill the worker mid-job ⇒ job redelivered and completes; stop Postgres briefly ⇒ API 503 then recovery, no lost jobs; idempotency replay/conflict semantics; pg-boss `expireInSeconds` long-job test (no premature redelivery while ffmpeg runs).
**Security:** CSRF enforcement; session fixation/rotation; login lockout; SSRF none; upload MIME/size enforcement; markdown XSS corpus; secret scanning (gitleaks) in CI.
**Frontend:** budget check (§17.3) and Lighthouse CI; axe a11y smoke; Playwright flows — login (Google fake + local), enroll, join (fake provider), watch with simulated 3G (throttling) including audio-only toggle and resume, assignment submit, quiz timer expiry, results view, transcript request→issue→verify.

### 20.3 Fakes

- **`FakeLiveProvider`** (in-memory, scriptable: conferences, participant sessions, recordings, failure injection, latency).
- **`FakeGoogleServer`** (HTTP; implements the subset of Meet v2, Drive `files.get`/`alt=media` with Range and `md5Checksum`, Workspace Events subscriptions, a Pub/Sub emulator wiring) used for adapter contract tests of `integrations/google`; scenarios: reconnect, duplicate/out-of-order events, 429 with `Retry-After`, 403 scope error, 404 file, subscription expiry. Real-Google parity is checked manually per Appendix B.
- **Media fixtures:** short test videos generated with ffmpeg (`testsrc2` + sine) at 1080p/720p/480p; golden ladder tests assert playlists/segments, not pixel equality.
- **Edge:** miniflare/`vitest-pool-workers` with an in-memory R2.

### 20.4 Load and failure tests (Phase 5; run in staging)

k6 scenarios at **launch scale × 5 headroom** (C-13): 750 concurrent authenticated users; 50 req/s VOD authorization burst (p95 < 300 ms); 300 join/leave events in 60 s through the Pub/Sub emulator (queue age < 60 s); join storm of 750 requests/60 s (p95 < 1.5 s, zero provider calls); playback-progress at 50 writes/s; 25 concurrent viewers per asset through miniflare; transcode of a 60-min 1080p fixture meeting §19.3; 3 concurrent ingests. The TRD certification targets (5,000 users, 500 req/s, 2,000 events/min) are an **optional growth test** run before scaling beyond Tier P. Failure injection: Google 429/5xx storms, R2 outage, worker kill, Postgres failover, token-secret rotation. **Pass criteria are the SLOs in §19.3.**

---

## 21. DevOps on DigitalOcean: topology, config, CI/CD, backups

### 21.1 Environments

| Env        | Purpose                                                                                                                           | Notes                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Local      | `docker compose`: `postgres:18`, MinIO, Mailpit, FakeGoogleServer, `wrangler dev`/miniflare, optional LGTM                        | `pnpm dev` runs api/worker/web with hot reload; seeds from `packages/db/seed` (synthetic institution, programmes, 200 students, sessions) |
| CI         | Ephemeral containers (Postgres 18, MinIO)                                                                                         | no external network except package registries                                                                                             |
| Staging    | Production-like (tier H topology scaled down), real Google **test Workspace** + Pub/Sub test topic, separate R2 bucket and Worker | recording pipeline validated with real recordings                                                                                         |
| Production | Tier P then H                                                                                                                     | §21.2                                                                                                                                     |

### 21.2 Topology tiers (ADR-07; check current DigitalOcean plan sizes/prices at build time)

**Launch (C-13: 3–5 concurrent classes of 15–30) = Tier P.** Lowest-cost variant if budget is tight: run `worker-media` on the app droplet with a Compose CPU limit (`cpus: 2`, `nice`) instead of a separate media droplet — acceptable at ≈ 4 CPU-h/day, but recordings then compete with API latency; move to a dedicated media droplet if API p95 degrades during transcodes.

| Component                                                                   | Tier P (launch; ≤ ~20 concurrent sessions)                                                           | Tier H (target, ≤ ~100 concurrent sessions, HA)                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Region                                                                      | **LON1** by default (decide with S-13) — Droplets, VPC, Managed PG, Container Registry in one region | same                                                                               |
| App droplets (api + worker `general,google,scheduler` + Caddy + static web) | 1 × 2 vCPU / 4 GB                                                                                    | 2 × 2–4 vCPU / 8 GB behind a DO Load Balancer                                      |
| Media droplets (worker `media`, ffmpeg)                                     | 1 × CPU-Optimized 2–4 vCPU (or co-located, see above)                                                | 2+ × CPU-Optimized 4–8 vCPU (scale with queue age)                                 |
| PostgreSQL 18 (DO Managed)                                                  | 2 vCPU / 4 GB, 1 standby recommended (HA)                                                            | 4 vCPU / 8–16 GB, 2 standbys; pools: `lms-tx` (transaction mode) + direct endpoint |
| Ops droplet (otel-lgtm, bastion/VPN)                                        | small 2 vCPU / 4 GB                                                                                  | same, larger disk                                                                  |
| Object storage                                                              | Cloudflare R2 `lms-media` + Worker `media-edge`                                                      | same (+ separate buckets per env)                                                  |
| Mail                                                                        | SES                                                                                                  | SES                                                                                |
| DNS/TLS                                                                     | Cloudflare DNS (media host) / any DNS for app host; Caddy auto-TLS on app                            | same                                                                               |
| Firewalls                                                                   | DO Cloud Firewall: LB/app 80/443; SSH only from bastion; PG trusted sources = VPC droplets           | same                                                                               |

**Uptime reality:** the 99.9 % SLO assumes Tier H (2 app droplets + LB + HA Postgres). Tier P is explicitly best-effort (documented to the institution). Droplet outbound-transfer allowances must be checked against the ≈ 3 TB/month of R2 uploads at target scale (§12.11).

### 21.3 Configuration (validated by Zod in `shared/config`; secrets via sops+age)

| Variable                                                                                                                            | Purpose                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------- | ----- | -------------------------------------------------- | -------------- |
| `NODE_ENV`, `APP_ORIGIN`, `MEDIA_ORIGIN`, `INSTITUTION_DEFAULT_TZ`                                                                  | basics                                                                       |
| `DATABASE_URL` (pooled/tx), `DATABASE_URL_DIRECT`, `DATABASE_URL_MIGRATOR`, `DB_CONNECTION_BUDGET`, `DB_POOL_API`, `DB_POOL_WORKER` | database (§5.2)                                                              |
| `WORKER_ROLE` (`general                                                                                                             | google                                                                       | scheduler              | media | all`), `QUEUE*CONCURRENCY*<NAME>`, `PGBOSS_SCHEMA` | workers/queues |
| `GOOGLE_PROJECT_ID`, `GOOGLE_SA_KEY_REF` (sops path), `GOOGLE_PUBSUB_SUBSCRIPTION`, `GOOGLE_EVENTS_MODE` (`pull                     | push`), `GOOGLE_HOST_ACCOUNTS` (bootstrap only; real list in DB)             | Google                 |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_REF`, `STORAGE_SECRET_KEY_REF`                          | R2 (S3 API) / MinIO                                                          |
| `MEDIA_DELIVERY` (`edge                                                                                                             | presigned`), `MEDIA_TOKEN_SECRETS`(JSON kid→secret),`MEDIA_TOKEN_ACTIVE_KID` | media delivery (§12.6) |
| `MEDIA_SCRATCH_DIR`, `MEDIA_SCRATCH_GB`, `FFMPEG_PATH`, `FFPROBE_PATH`                                                              | media worker                                                                 |
| `SMTP_HOST/PORT/USER_REF/PASS_REF`, `MAIL_FROM`                                                                                     | SES SMTP                                                                     |
| `SESSION_SECRET_REF`, `CSRF_SECRET_REF`, `PASSWORD_PEPPER_REF`                                                                      | auth                                                                         |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL`                                                                                          | telemetry                                                                    |
| `RETENTION_DRY_RUN`, `DRIVE_CLEANUP_MODE` (`NONE                                                                                    | TRASH_AFTER_INGEST`, default `TRASH_AFTER_INGEST` per C-16)                  | safety switches        |
| `FEATURE_*` flags                                                                                                                   | `FEATURE_TRANSCRIPTS`, `FEATURE_DIRECT_UPLOAD`, `FEATURE_PHONE_DIAL_IN`      |

A secrets inventory (`docs/secrets.md`) lists every `*_REF`, owner, rotation period (Google SA key ≤ 90 d; media token secrets ≤ 180 d with overlap; SES creds ≤ 180 d).

### 21.4 Images and runtime

`docker/Dockerfile.api` (multi-stage, non-root, distroless-ish Node image), `docker/Dockerfile.worker` (Node + `ffmpeg`/`ffprobe` + optional `clamav` client), `docker/Dockerfile.web` (static build served by Caddy), `docker/compose.prod.yml` (services: `caddy`, `api` (replicas via compose `deploy` or two named services), `worker-core` (`general,google,scheduler`), `worker-media`, `web`; healthchecks on `/readyz`; `stop_grace_period` 60 s so in-flight handlers finish; restart `unless-stopped`; log driver json-file with rotation). Graceful shutdown: stop polling, finish in-flight pg-boss jobs within the grace period, close pools. Caddy: auto-TLS, Brotli/gzip, security headers (§18.1), health-based upstreams.

### 21.5 CI/CD (GitHub Actions)

1. install with lockfile verify → 2. lint + format + typecheck + `deps:check` → 3. unit + domain tests → 4. integration tests (Testcontainers Postgres 18/MinIO) incl. migrations up on empty DB and on previous-release schema → 5. contract/OpenAPI diff (breaking-change detector) → 6. web build + `budget:check` + Lighthouse CI + axe → 7. Worker (media-edge) tests → 8. container build + Trivy scan + SBOM + gitleaks → 9. Playwright e2e on compose → 10. push images to **DigitalOcean Container Registry** → 11. **deploy staging**: SSH (restricted deploy user, key in GH secret) runs `scripts/deploy.sh`: decrypt sops, run migrator (drizzle + pg-boss) as a one-off container, then rolling restart (app replicas one by one with health wait; workers after drain) → 12. smoke + synthetic checks → 13. manual approval → **deploy production** the same way, automatic rollback to the previous image tag if `/readyz` fails or SLO burn alert fires within 10 minutes. `media-edge` deploys with `wrangler deploy` (token scoped to that Worker + bucket) in the same pipeline.

### 21.6 Migration discipline (expand/contract)

Migrations are forward-only. Release N may only **add** (nullable columns/new tables/indexes `CONCURRENTLY` via custom SQL); code in N+1 stops using old structures; N+2 drops them. Never rename/drop in the same release as the code change. Backfills run as pg-boss jobs, not inside migration transactions. Every migration PR includes: rollback note, lock analysis (`ACCESS EXCLUSIVE` avoided), and a test on a seeded large-ish dataset. pg-boss schema changes follow its own migration plan during dependency upgrades (run in staging first).

### 21.7 Backups and disaster recovery

- **Postgres:** DO Managed daily backups with PITR; plus **weekly logical dump** (`pg_dump -Fc` via the direct endpoint from the ops droplet) encrypted with `age`, uploaded to a separate R2 bucket with object lock/lifecycle; keep 12 weeks.
- **R2 media:** not backed up (retention-limited, re-creatable from Drive within the source window only); R2 **object versioning/lifecycle** protects against accidental deletes for 7 days where supported; academic records live in Postgres.
- **RPO/RTO:** Tier H — RPO ≤ 5 min (PITR), RTO ≤ 1 h; Tier P — RPO ≤ 24 h unless a standby is enabled, RTO ≤ 4 h. **Restore drill** quarterly (document timings in `docs/runbooks/restore.md`); DB failover drill before go-live.
- **Secrets:** age private keys stored offline by two operators; sops files in repo; rotation runbook.

---

## 22. Delivery plan — work packages

Each WP is a branch (`wp-NN-name`), owns paths, lists dependencies and acceptance criteria. Complexity: S ≈ ≤ 2 days of agent work, M ≈ 3–6, L ≈ 1–2 weeks. Contract changes ship first (§0.5). **Critical path:** WP-00 → 01 → 02 → 03/04 → 06/07 → 10–12 → LIVE-1/2/3/4/5 → ATT-1/2 → VOD-1/2 + EDGE-1 → VOD-3/4 → RES/TRN → HARD. WPs on different lines run in parallel.

### Phase 0 — Foundations

| WP    | Name (size)                                              | Owns                                         | Depends | Acceptance                                                                                                                                                                                                                                                         |
| ----- | -------------------------------------------------------- | -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WP-00 | Monorepo, tooling, CI skeleton, `CLAUDE.md`, compose (S) | root configs, `docker/`, `.github/`, `docs/` | —       | `pnpm -w build/typecheck/lint/test` green on empty modules; dep-cruiser rules (§4.3) enforced; compose starts Postgres 18/MinIO/Mailpit                                                                                                                            |
| WP-01 | `shared` + `contracts` base (S)                          | `packages/shared`, `packages/contracts`      | 00      | ids, clock, config loader, errors/Result, pagination, decimal helpers (+ property tests), enums, error codes (App. D), queue/event names                                                                                                                           |
| WP-02 | `db` package (L)                                         | `packages/db`                                | 01      | Drizzle schema for M01+M06; custom SQL migrations (roles, `lms_enable_tenant_rls`, `rl_acquire`, audit append-only trigger, `uuidv7` defaults); `TenantDb.withTenant` + pg-boss adapter; idempotency & inbox repos; tenant-FK/RLS lint test; Testcontainers helper |
| WP-03 | Identity & sessions (L)                                  | `modules/identity`, `http/auth,users,me`     | 02,06   | §8 complete: local login, Google OIDC + link, invites/reset, sessions, CSRF, lockout, `/me`, policies API; deny tests                                                                                                                                              |
| WP-04 | Authorization (M)                                        | `modules/authorization`                      | 02      | `matrix.json`, `AuthorizationService`, guards/decorators, `VisibleOfferings` helper, persona fixtures, generated deny tests; `v_offering_access` view                                                                                                              |
| WP-05 | Audit + telemetry (S)                                    | `modules/audit`, `packages/telemetry`        | 02      | append-only audit API, OTel + pino wiring, `/healthz`,`/readyz`,`/metrics`                                                                                                                                                                                         |
| WP-06 | API shell (M)                                            | `apps/api/src/{main,app.module,common}`      | 01,02   | Nest+Fastify, Zod pipe, OpenAPI, error filter, idempotency interceptor, pagination helper, rate limit (in-memory), request-id/tenancy guard                                                                                                                        |
| WP-07 | Worker shell (M)                                         | `apps/worker`                                | 02      | pg-boss start (roles), `ensureQueues` per §16, cron registrations, domain-event dispatcher, graceful shutdown, dashboard mount, test: kill-and-redeliver                                                                                                           |

### Phase 1 — Academic core

| WP    | Name                                                     | Owns                                                                                           | Depends  | Acceptance                                                                                      |
| ----- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| WP-10 | Academic structure (M)                                   | `modules/academic` (structure part), M02 tables                                                | 02,04,06 | AC-01; lifecycle rules §9.1; curriculum versioning/clone                                        |
| WP-11 | People & enrollment (L)                                  | `modules/enrollment`, `modules/teaching` (profiles)                                            | 10       | AC-03; chain rules, status history, capacity incl. 150 cap, auto-register, drop/withdraw events |
| WP-12 | Offerings, sections, audiences, teaching assignments (M) | `modules/academic` (offerings), `modules/teaching` (assignments), `modules/scheduling` (slots) | 10,11    | AC-02, AC-05; `session_teacher_slots` maintenance                                               |
| WP-13 | Imports (M)                                              | `modules/imports`                                                                              | 11       | dry-run/commit, error CSV, resumable; 5k-row test < 60 s                                        |
| WP-14 | Web foundation + admin academic UI (L)                   | `apps/web`                                                                                     | 03,10–12 | shell, auth screens, API client, PWA, **budgets in CI**, admin screens for §9                   |

### Phase 2 — Live classroom

| WP         | Name                                                             | Owns                                                           | Depends              | Acceptance                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP-GOOG-0  | Google setup + spikes S-01/02/03/04/08/09 (M, human-assisted)    | `docs/runbooks/google.md`, `docs/spikes/*.md`                  | Q-10                 | Appendix A done in staging tenant; spike reports with pass/fail and fallbacks; decisions recorded                                                                    |
| WP-LIVE-1  | `live-provider` port, `FakeLiveProvider`, `FakeGoogleServer` (M) | `integrations/live-provider`, `integrations/google/test`       | 01                   | contract tests shared by Fake and Google adapters                                                                                                                    |
| WP-LIVE-2  | Google adapter (L)                                               | `integrations/google`                                          | LIVE-1, GOOG-0       | DWD auth, Meet/Drive/Events/Directory clients, `GoogleRateLimiter` (`rl_acquire`), retry taxonomy, breaker; passes adapter contract suite against `FakeGoogleServer` |
| WP-LIVE-3  | Sessions, series, state machine (L)                              | `modules/live-session`, `modules/scheduling`                   | 12,05                | §10.4 table tests; conflict constraint tests; recurrence (DST-safe) ; reschedule/cancel; `session-tick`                                                              |
| WP-LIVE-4  | Provisioning, member sync, join/start/end (L)                    | `modules/live-session` (provision)                             | LIVE-2,3             | INV-8 test (zero provider calls on join); AC-04, AC-05; RESTRICTED member sync; GOOGLE_ACCOUNT_REQUIRED; dial-in; capacity                                           |
| WP-LIVE-5  | Events, inbox, routing, reconciliation, subscriptions (L)        | `modules/live-session` (events), `apps/worker/handlers/google` | LIVE-2,3             | duplicate/out-of-order scenarios; subscription renewal; reconciliation repairs a dropped event                                                                       |
| WP-ATT-1   | Raw store, matching ladder, `conference.sync` (M)                | `modules/attendance` (ingest)                                  | LIVE-5, GOOG-0(S-01) | strategies pluggable; unresolved queue; manual match                                                                                                                 |
| WP-ATT-2   | Attendance engine, finalize, overrides, reports (M)              | `modules/attendance` (domain)                                  | ATT-1                | **all Appendix C vectors pass**; AC-06, AC-11 (attendance); CSV report                                                                                               |
| WP-LIVE-UI | Live screens student/teacher/admin (M)                           | `apps/web` live routes                                         | 14, LIVE-4, ATT-2    | Playwright: join flow with fake provider; low-data tip; unresolved participants UI                                                                                   |

### Phase 3 — Recording and VOD

| WP        | Name                                                                               | Owns                                               | Depends           | Acceptance                                                                         |
| --------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| WP-VOD-1  | Discovery + ingest + storage port (M)                                              | `modules/vod` (ingest), `integrations/storage`     | LIVE-5, 02        | AC-07 (ingest part), AC-10; MD5 verified; no local copy; idempotent                |
| WP-VOD-2  | Media package: probe, ladder, transcode stages, master playlist, quality gates (L) | `integrations/media`, `apps/worker/handlers/media` | VOD-1             | golden ladder tests; progressive publication; S-06 benchmark report; INV-9         |
| WP-EDGE-1 | `media-edge` Worker + `MediaDelivery` (M)                                          | `apps/media-edge`, `integrations/media-delivery`   | 01                | §12.6 tests; wrangler deploy to staging; S-12 results; presigned fallback adapter  |
| WP-VOD-3  | Publication, `/play`, progress, retention, legal hold (M)                          | `modules/vod`                                      | VOD-2, EDGE-1, 04 | AC-07, AC-08, AC-09; p95 < 300 ms; purge dry-run; 180-day rule                     |
| WP-VOD-4  | Player UI + low-data features (M)                                                  | `apps/web` player                                  | 14, VOD-3         | quality menu, **audio-only**, resume, throttled-3G Playwright; player chunk budget |
| WP-VOD-5  | Teacher direct upload (S, SHOULD)                                                  | `modules/vod` (upload)                             | VOD-2             | presigned multipart → pipeline from probe                                          |
| WP-VOD-6  | Drive storage monitor + optional cleanup (S)                                       | `modules/vod`                                      | LIVE-2            | quota metric + alerts; cleanup behind explicit opt-in                              |

### Phase 4 — Learning, results, transcripts, comms

| WP         | Name                                                                            | Owns                                         | Depends       | Acceptance                                                                |
| ---------- | ------------------------------------------------------------------------------- | -------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| WP-CONT-1  | Files, materials, announcements (M)                                             | `modules/content`                            | 04, storage   | presigned flows; sanitised markdown; scan hook                            |
| WP-ASM-1   | Assignments & submissions (M)                                                   | `modules/assessment`                         | CONT-1        | late rules; resubmission; deny tests                                      |
| WP-ASM-2   | Question bank & quizzes (L)                                                     | `modules/assessment`                         | ASM-1         | snapshot immutability; timer + auto-expire; autosave idempotency          |
| WP-ASM-3   | Gradebook & grade release (M)                                                   | `modules/assessment`                         | ASM-1/2       | AC-11 (grade); `If-Match`; audit + `grade_changes`; weights validation    |
| WP-RES-1   | Grading schemes + pure GPA functions (M)                                        | `modules/results` (domain)                   | 01            | **Appendix C GPA vectors pass**; property tests; presets `NUC_5`,`US_4`   |
| WP-RES-2   | Course results + semester workflow (L)                                          | `modules/results`                            | ASM-3, RES-1  | finalize/reopen/approve/publish; cascades; broadsheet export              |
| WP-RES-3   | Degree awards (S)                                                               | `modules/results`                            | RES-2         | requirements checklist; certificate numbers                               |
| WP-TRN-1   | Transcripts: snapshot, issue, PDF, verify, revoke (L)                           | `modules/transcripts`, `integrations/pdf`    | RES-2         | hash determinism; Unicode PDF; public verify minimal; supersede on reopen |
| WP-NOTIF-1 | Notifications + SES + digest (M)                                                | `modules/notifications`, `integrations/mail` | 07            | volume policy §14.1; bounce webhook                                       |
| WP-OPS-1   | Ops/admin screens + Google wizard + dashboard (M)                               | `modules/ops`, `apps/web` admin              | LIVE-5, VOD-3 | failures list/replay; DWD scope diff                                      |
| WP-UI-2    | Student/teacher/registrar UI for content, assessments, results, transcripts (L) | `apps/web`                                   | the above     | Playwright flows §20.2                                                    |

### Phase 5 — Hardening and launch

| WP          | Name                                                                                        | Owns                                   | Depends | Acceptance                                                  |
| ----------- | ------------------------------------------------------------------------------------------- | -------------------------------------- | ------- | ----------------------------------------------------------- |
| WP-DEVOPS-1 | DigitalOcean provisioning scripts, Compose prod, Caddy, sops, LGTM stack, deploy script (L) | `docker/`, `scripts/`, `docs/runbooks` | 00      | staging reproducible from scratch in < 1 h; rollback tested |
| WP-HARD-1   | Load/failure tests, budgets, SLO dashboards/alerts (M)                                      | `tests/load`, dashboards               | all     | §20.4 pass criteria                                         |
| WP-HARD-2   | Privacy & security hardening, DSAR export/erasure, runbooks, restore + failover drills (M)  | `modules/identity` (privacy), `docs/`  | all     | §18 checklist ticked; breach runbook; Q-14 recorded         |

### Definition of Done — MVP

| Area             | Done when                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Academic         | Session/semester/programme/curriculum/offering/section/enrollment implemented with constraints, import and admin UX (AC-01–03)                      |
| Live             | Teachers schedule and conduct Meet-backed sessions; students join only when entitled and linked; DB-only join; reconciliation proven (AC-04–06)     |
| Attendance       | Provider evidence converges to attendance per policy; unresolved review; overrides audited; reports (AC-06, AC-11)                                  |
| Recording/VOD    | Recording → ladder + audio-only → protected playback via edge; resume; 180-day retention sweep (dry-run + real); AC-07–10                           |
| Results          | Gradebook → course results → semester GPA/CGPA → approved → published; class of degree; transcripts issued, verified, revoked/superseded (AC-13–15) |
| Security/privacy | RLS + tenant tests, token tests, secrets management, audit, NDPA checklist, Q-14 counsel sign-off                                                   |
| Reliability      | pg-boss redelivery, reconciliation, failover drill, restore drill                                                                                   |
| Observability    | Dashboards + alerts for §19.3 SLOs                                                                                                                  |
| Low bandwidth    | Budgets pass; 3G playback test passes; audio-only works                                                                                             |
| QA               | Acceptance scenarios (App. C/§20) pass in staging under representative load                                                                         |

### Acceptance scenarios (extends TRD §20.2)

AC-01 Academic setup · AC-02 Offering with two teachers · AC-03 Enrollment isolation · AC-04 Session create/join (unenrolled gets no link) · AC-05 Co-teacher privileges · AC-06 Attendance reconnect/overlap · AC-07 Recording → published ladder · AC-08 Replay authorization (withdrawn denied; ≥ 180 days after completion denied) · AC-09 Resume progress · AC-10 Transient ingest failure without duplicates · AC-11 Grade and attendance override audit · AC-12 Tenant isolation · **AC-13** Finalize → approve → publish results; GPA/CGPA match vectors · **AC-14** Transcript issue → verify page matches snapshot hash; revoke shows status · **AC-15** Reopen result supersedes issued transcript.

---

## Appendix A — Provider setup runbook (Google, DigitalOcean, Cloudflare, SES)

Do these in **staging first**. Record outcomes in `docs/runbooks/` and tick the launch checklist.

### A.1 Google Workspace (the institution's system admin — C-17)

1. Confirm **Business Standard** on the organization; remember the 300-user cap and 150-participant meeting cap. Licence the host accounts and teachers who must record.
2. Create OU **LMS Hosts**; create ≥ 2 users (`lms-host-01@…`, `lms-host-02@…`), strong credentials stored in the password manager, **no human classes** on them.
3. Admin Console → Apps → Google Workspace → **Google Meet**: for OU _LMS Hosts_ and _Teachers_: recording **on**; external participants **allowed**; host management **on**; Gemini notes off (optional). For anonymous joiners find the setting that blocks users who are not signed in (**S-09**) and enable the block.
4. **Drive:** exempt _LMS Hosts_ from retention/auto-delete rules; note the pooled storage quota; set an alert threshold.
5. Create teacher accounts in OU _Teachers_ with recording privilege (verify **S-08**).

### A.2 Google Cloud project

1. Create project `lms-<institution>`; enable APIs: **Google Meet REST API**, **Google Drive API**, **Google Workspace Events API**, **Cloud Pub/Sub API** (+ Admin SDK API only if Directory resolution is needed).
2. **OAuth consent screen** for _Sign in with Google_: user type **External**, scopes `openid email profile` only; fill app name/logo/privacy policy/terms URLs; **publish to Production** (basic scopes need no sensitive-scope verification — confirm in the console; keep a test-users list only while in Testing mode). Create an OAuth **Web client** with redirect `https://<app>/api/v1/auth/google/callback`.
3. **Service account** `lms-meet` → enable domain-wide delegation → copy the **Client ID**. Key handling: prefer workload identity/keyless signing where available; otherwise a JSON key stored with sops+age, rotated ≤ 90 days.
4. **Admin Console → Security → API controls → Domain-wide delegation:** add the Client ID with scopes: `https://www.googleapis.com/auth/meetings.space.created`, `https://www.googleapis.com/auth/meetings.space.readonly` (drop later if S-04 shows it is unnecessary), `https://www.googleapis.com/auth/drive.meet.readonly`, and `https://www.googleapis.com/auth/drive` (**required for Drive cleanup, C-16** — used only against host accounts); optional `…/auth/admin.directory.user.readonly` only for in-org resolution (not needed for Gmail students).
5. **Pub/Sub:** create topic `lms-meet-events`; grant `roles/pubsub.publisher` on it to `meet-api-event-push@system.gserviceaccount.com`; create **pull** subscription `lms-meet-events-pull` (ack deadline 60 s, retention 7 d, dead-letter topic after 10 attempts); grant the worker runtime identity `roles/pubsub.subscriber`.
6. Review Meet API **quotas** in the console; request increases before launch if the host-pool sizing (§10.2) needs them.
7. The LMS admin wizard (§14.3) then creates one Workspace Events subscription per host account and runs the connection test.

### A.3 DigitalOcean

1. Region **LON1** (or the region chosen in S-13). Create a **VPC**.
2. **Managed PostgreSQL 18** (Tier P: 1 standby recommended; Tier H: 2). Create database `lms`; users `lms_migrator`, `lms_app`, `lms_system`; run the first custom migration (roles/grants, RLS helper). Create connection pool **`lms-tx`** in **transaction** mode for `lms_app` (pool mode cannot be changed later; size from the §5.2 budget). Keep the **direct** endpoint for migrator/pg-boss/ops. Trusted sources: VPC droplets only; enable alerts on connections, CPU, disk.
3. Droplets (Ubuntu LTS): `app-1[,2]`, `media-1[,2]` (CPU-Optimized), `ops-1`; Docker + Compose; unattended upgrades; non-root deploy user; **Cloud Firewall** (80/443 to LB/app; SSH from bastion only).
4. **Container Registry**, **Load Balancer** (Tier H; health check `/readyz`), **Reserved IP** (SMTP allow-lists if ever needed), DO **Monitoring** alerts and **Uptime** checks.
5. Install `sops`+`age` on droplets; place age keys; clone the deploy repo; first deploy via `scripts/deploy.sh`.

### A.4 Cloudflare

1. Create the account; add the media hostname's zone (or delegate a subdomain). Create R2 bucket **`lms-media`** (+ `lms-media-staging`), location hint **WEUR**, public access **off**.
2. Create an **R2 S3 API token** scoped to the bucket (object read/write); store with sops. Add a lifecycle rule to abort incomplete multipart uploads after 1 day.
3. Deploy `apps/media-edge` with `wrangler`: bind `VOD_BUCKET`, set var `APP_ORIGIN`, set secret `MEDIA_TOKEN_SECRETS`; route `media.<domain>/*`. Verify with a signed test token; run **S-12**.
4. Optional WAF/rate-limiting rules on the media hostname; review current Cloudflare service terms for serving video from R2 behind a custom domain before launch.

### A.5 Amazon SES

Choose the region nearest the app (e.g., London); verify the sending domain (SPF, DKIM, DMARC `p=quarantine` after warm-up); request **production access**; configure an SNS topic for bounces/complaints → `POST /v1/integrations/ses/events`; create SMTP credentials (sops). Warm-up plan: start ≤ 500/day, double weekly (**S-14**).

### A.6 Launch checklist

Spikes S-01…S-16 closed or accepted · Q-14 counsel sign-off recorded · DPAs in place (DO, Cloudflare, Google, AWS) · privacy notice + recording notice live · backups + restore drill done · failover drill done · retention sweep dry-run reviewed · budgets green · load tests green · on-call + runbooks ready.

---

## Appendix B — Verification spikes (do these against real services)

Each spike produces `docs/spikes/S-xx.md` (what was tried, evidence, decision). Until closed, code runs behind the port/fake and the PR notes the assumption.
| ID | Question | Method | Pass criterion | Fallback if it fails | Gates |
|---|---|---|---|---|---|
| S-01 | For **external** Gmail participants, does `participants`/`participantSessions` expose `signedinUser.user`? Is it equal to the OIDC `sub`? What do anonymous/phone participants look like? | Host a test conference with 3 external Gmail users + 1 anonymous + 1 dial-in; read API; compare to `sub` captured via Google sign-in | Deterministic id match for signed-in externals | Disable `GOOGLE_ID` strategy; rely on `MEMBER_EMAIL` if exposed, else `NAME_ASSISTED` + manual review (set `attendance_state=REVIEW_REQUIRED` by default) | WP-ATT-1 |
| S-02 | Can one host account own many spaces with different co-hosts and concurrent conferences? Does auto-recording start when a co-host (non-owner) joins? Who is "organizer" for Drive? | 3 concurrent spaces, different co-hosts | All behave; recordings land in host Drive | `TEACHER_OWNED` strategy (extension) or pool tuning | WP-LIVE-4 |
| S-03 | In `RESTRICTED`, do members using **external** emails join without knocking? Member-count limits? `members.create` latency; removal effect | Add 150 external members to a space; test join | No knock for members; ≥ 150 supported | Reduce member sync to staff only + host admits (knock) or split sections | WP-LIVE-4 |
| S-04 | User-target Workspace Events subscription for API-created spaces: fires? lifetime/renewal limits? envelope attributes for routing? lifecycle event names? Minimal scopes (does `meetings.space.created` suffice for reading records)? | Create subscription; run conferences; inspect Pub/Sub messages | Events arrive; routing possible; lifetime known | Per-space subscriptions; reconciliation-only mode | WP-LIVE-5 |
| S-05 | Recording file facts: container/codecs/resolution/bitrate, MB per hour, `md5Checksum` present, `drive.meet.readonly` allows `alt=media` under DWD, download Mbps to DO LON1 | Record 15-min sessions; pull via API from a droplet | Download + MD5 verify works; numbers recorded | Broaden Drive scope; adjust ingest timeouts | WP-VOD-1/2 |
| S-06 | Transcode benchmarks on CPU droplets (stage fast/full realtime factors) and visual quality at 240–720p for slides + talking head | Real 1080p/720p recordings; ffprobe + visual review + file sizes | Fast stage ≥ 4× realtime; first rung playable ≤ 15 min for 60-min recording; slide text legible at 480p/720p | Adjust CRF/maxrate/fps, bigger droplet, `-preset faster` | WP-VOD-2 |
| S-07 | Pub/Sub pull latency/flow-control from LON1 | Burst 2,000 events | p95 < 5 s to inbox | Increase workers / push mode | WP-LIVE-5 |
| S-08 | Business Standard: REST participants/recordings available? co-host recording privilege? Drive quota per licence | Exercise on a Standard tenant | All available | Upgrade edition for hosts (Plus) or accept manual attendance | WP-LIVE-\*, ATT |
| S-09 | Admin setting to block anonymous (not-signed-in) joiners; external participant knock behaviour | Admin Console + tests | Anonymous blocked | Manual attendance match for anonymous | WP-ATT |
| S-10 | Narrower scope for trashing Meet recordings in Drive | Try `drive.file`/Meet-specific scopes | A narrower scope works | Keep cleanup manual | WP-VOD-6 |
| S-11 | HLS fMP4 playback on target devices (Android Chrome ≥ 8, Samsung Internet, iOS Safari ≥ 15, low-end Android 2 GB) and measured data use | Device lab / BrowserStack + real phones | Plays, ABR adapts, audio-only works | HLS-TS fallback ladder; MP4 360p fallback | WP-VOD-4 |
| S-12 | Cloudflare: Nigeria edge presence, cache hit behaviour for Worker+Cache API, R2-behind-custom-domain terms, latency vs direct R2 and vs DO Spaces | Probes from Lagos ISPs; read terms | Edge < Europe-origin latency; terms OK | `MEDIA_DELIVERY=presigned` on R2/Spaces | WP-EDGE-1 |
| S-13 | RTT Lagos → LON1 vs FRA1 vs AMS3 | `mtr`/`ping` from MTN, Airtel, Glo, fixed ISPs | Choose lowest p50/p95 | Keep LON1 | WP-DEVOPS-1 |
| S-14 | SES deliverability to Nigerian providers and Gmail; bounce handling | Seed lists, DKIM/SPF alignment | > 98 % inbox for transactional | Provider swap behind `Mailer` | WP-NOTIF-1 |
| S-15 | PG18 + Drizzle: RLS, exclusion constraint, virtual generated column, custom SQL round-trip; pg-boss on DO (direct vs session pool), advisory locks | Local + staging | All migrate and behave; no PgBouncer incompatibility | Use direct connections for pg-boss | WP-02/07 |
| S-16 | `@react-pdf/renderer`: Unicode names, 8-semester pagination, render time | Fixture student | Correct glyphs; < 3 s | Switch to PDFKit/Playwright adapter | WP-TRN-1 |

### B.1 S-01 for the system admin — no code required (≈ 45 minutes)

**Why it matters:** students join Meet with personal Gmail accounts. To mark attendance automatically, the LMS must recognise _which Gmail account_ was in the meeting. This test shows whether Google's API reports a stable account ID for outside (Gmail) participants that matches the ID Google gives the LMS when the same student signs in with Google.
**You need:** one host account (`lms-host-01@…`), two personal Gmail accounts you control (Student A, Student B), one phone.

1. **Get each student's Google ID.** In a private browser window open Google's **OAuth 2.0 Playground** (search "OAuth Playground"). In _Step 1_ enter scopes `openid email profile`, click _Authorize APIs_, sign in as Student A, click _Exchange authorization code for tokens_. Copy the `id_token` and paste it into Google's token-info endpoint (`https://oauth2.googleapis.com/tokeninfo?id_token=…`). Note the **`sub`** number and email. Repeat for Student B.
2. **Hold a test meeting.** Signed in as the host account, start a meeting at `meet.new` and note the meeting code (e.g., `abc-defg-hij`). Student A joins **signed in to Gmail**; Student B joins **signed in**, leaves after 2 minutes and rejoins; from a private window with no Google sign-in, try to join as a guest (note whether it is allowed — this is S-09); optionally dial in by phone. Stay 5 minutes, then everyone leaves.
3. **Read what the API reports.** Wait ~10 minutes. Signed in as the host account, open the **Google Meet REST API reference** page for `conferenceRecords.list` and use the _Try this method_ panel with filter `space.meeting_code="abc-defg-hij"`; copy the record `name`. Then use `conferenceRecords.participants.list` with that name as `parent`, and `conferenceRecords.participants.participantSessions.list` for each participant.
4. **Record results** in `docs/spikes/S-01.md` (screenshots are fine): for each participant, is there a `signedinUser.user` value (looks like `users/123…`)? Does the number after `users/` **equal** that student's `sub` from step 1? What do the guest and phone participants look like? Did Student B show **two** participant sessions?
5. **Interpretation:** _Equal_ ⇒ PASS: the LMS enables automatic matching (`GOOGLE_ID`). _Present but different / missing_ ⇒ FAIL: the LMS keeps review mode (name-assisted suggestions confirmed by teachers). Either way, send the file to the build team; nothing else is needed.

---

## Appendix C — Golden vectors

### C.1 Attendance (default policy: `ACTUAL_CAPPED`, present 7500 bp, partial 2500 bp, late grace 15 min, pads 0)

Session scheduled **10:00–11:00** (3600 s) unless stated. `ratioBp = floor(attended × 10000 / denominator)`.
| # | Setup | Denominator | Attended (s) | ratioBp | Status | Late | Joins |
|---|---|---|---|---|---|---|---|
| V1 | Conference 10:02–11:00 (actual 3480); A joins 10:05→11:00 | 3480 | 3300 | 9482 | PRESENT | no | 1 |
| V2 | Same; B: 10:02–10:30 + 10:40–11:00 | 3480 | 1680+1200 = 2880 | 8275 | PRESENT | no | 2 |
| V3 | Same; C on two devices 10:02–10:40 and 10:30–11:00 (overlap) | 3480 | 3480 (union) | 10000 | PRESENT | no | 2 |
| V4 | Same; D 10:20–10:50 | 3480 | 1800 | 5172 | PARTIAL | **yes** | 1 |
| V5 | Same; E 10:50–11:00 | 3480 | 600 | 1724 | ABSENT | yes | 1 |
| V6 | Same; F no evidence | 3480 | 0 | 0 | ABSENT | no | 0 |
| V7 | Same; G joined 10:30, **no end recorded**, conference ended 11:00 | 3480 | 1800 | 5172 | PARTIAL | yes | 1 |
| V8 | Conference 09:50–11:00; H 09:50–10:30 (window clips to 10:00) | 3600 | 1800 | 5000 | PARTIAL | no | 1 |
| V9 | Conference 10:00–10:10 only (600 s < 30 % of 3600) | 600 | 600 | 10000 | PRESENT (provisional) | no | 1 → session `REVIEW_REQUIRED` |
| V10 | Boundary: denominator 3600, attended 2700 / 2699 | 3600 | 2700 / 2699 | 7500 / 7497 | PRESENT / PARTIAL | — | — |
Also: override to EXCUSED survives recompute; student dropped before start has no record; student enrolled after start is evaluated.

### C.2 Final percentage (INV-14)

Assessments: Quiz max 20 weight 20 score 15; Assignment max 50 weight 30 score 40; Exam max 100 weight 50 score 66 → `final_pct_x100 = 1500 + 2400 + 3300 = 7200` (72.00 ⇒ **A**). If A2 is **EXCUSED**: `(1500 + 3300) × 10000 / 7000 = 6857.14 → 6857` (68.57) → `INTEGER` rounding ⇒ 69 ⇒ **B**. Rounding rule check: 69.50 with `roundBeforeBanding=INTEGER` ⇒ 70 ⇒ **A**; with `NONE` ⇒ **B**.

### C.3 GPA / CGPA (`NUC_5`, credits ×10, points ×100)

**Semester 1:** BTH101 3 cr 72 % A (30×500=15000) · BTH103 2 cr 65 % B (20×400=8000) · BTH105 3 cr 48 % D (30×200=6000) · BTH107 2 cr 38 % F (0). Σqp = 29000, credits attempted = 100 ⇒ **GPA 2.90**; earned 80 (8.0).
**Semester 2:** BTH201 3 cr 80 % A (15000) · BTH203 3 cr 55 % C (9000) · BTH205 2 cr 61 % B (8000). Σqp = 32000, credits 80 ⇒ **GPA 4.00**.
**CGPA after S2 (KEEP_ALL):** 61000 / 180 = 338.89 ⇒ **3.39** ⇒ _Second Class Lower_; standing GOOD (≥ 1.50).
**Semester 3:** BTH107 **repeat** 2 cr 52 % C (6000) · BTH301 3 cr 70 % A (15000). Σqp = 21000, credits 50 ⇒ **GPA 4.20**.
**CGPA after S3:** `KEEP_ALL` 82000 / 230 = 356.52 ⇒ **3.57** (Second Class Upper) · `REPLACE_LATEST` (earlier F removed) 82000 / 210 = 390.48 ⇒ **3.90** · `BEST` (**institution default, C-11**) ⇒ **3.90** (Second Class Upper).
`roundHalfUp(n,d) = floor((2n + d) / (2d))` — property tests must cover exact ties.

---

## Appendix D — Error codes

`UNAUTHENTICATED` · `FORBIDDEN` · `NOT_FOUND` · `VALIDATION_FAILED` · `RATE_LIMITED` · `VERSION_MISMATCH` · `IDEMPOTENCY_IN_PROGRESS` · `IDEMPOTENCY_KEY_REUSED` · `CSRF_INVALID` · `INVALID_CREDENTIALS` · `ACCOUNT_LOCKED` · `GOOGLE_ACCOUNT_REQUIRED` · `STUDENT_NO_GOOGLE_ACCOUNT` (warning) · `TEACHER_NO_GOOGLE_ACCOUNT` (warning) · `ALREADY_ENROLLED` · `OFFERING_FULL` · `ENROLLMENT_NOT_ACTIVE` · `REGISTRATION_CLOSED` · `PRIMARY_REQUIRED` · `CURRICULUM_LOCKED` · `SEMESTER_STATE_INVALID` · `SESSION_STATE_INVALID` · `SESSION_IN_PROGRESS` · `JOIN_WINDOW_CLOSED` · `PROVIDER_NOT_READY` · `PROVIDER_UNAVAILABLE` · `TEACHER_SCHEDULE_CONFLICT` · `OVER_PROVIDER_CAPACITY` · `OVERRIDE_REASON_REQUIRED` · `PARTICIPANT_ALREADY_MATCHED` · `VOD_NOT_AVAILABLE` · `VOD_PURGED` · `UNPLAYABLE_SOURCE` · `SOURCE_MISSING` · `UPLOAD_TOO_LARGE` · `WEIGHTS_NOT_100` · `ATTEMPT_LIMIT_REACHED` · `ATTEMPT_EXPIRED` · `SUBMISSION_CLOSED` · `GRADEBOOK_LOCKED` · `RESULT_NOT_FINALIZED` · `RESULT_LOCKED` · `SCHEME_LOCKED` · `REQUIREMENTS_NOT_MET` · `TRANSCRIPT_NOT_ISSUABLE` · `IMPORT_FILE_CHANGED` · `IMPORT_ROW_INVALID` · edge-only: `TOKEN_INVALID` · `TOKEN_EXPIRED` · `PATH_FORBIDDEN`.

---

## Appendix E — `CLAUDE.md` template (repo root)

```markdown
# School LMS — agent instructions

Source of truth: docs/SPEC.md (copy of SCHOOL_LMS_BUILD_SPEC.md). If anything conflicts, the spec wins; if the spec is ambiguous, stop and ask.

## Commands

pnpm install · pnpm -w dev · pnpm -w typecheck · pnpm -w lint · pnpm -w deps:check · pnpm -w test · pnpm -w test:integration · pnpm -w test:e2e · pnpm -w budget:check · pnpm -w db:migrate · pnpm -w db:generate

## Non-negotiables (see spec §0.2)

Tenant isolation (institution_id + composite FKs + forced RLS) · server-side entitlement · no Google types outside integrations/google · correctness in Postgres · enqueue pg-boss jobs in the SAME transaction (no Redis, no outbox) · events are hints · join path DB-only · never publish broken VOD · media only via media-edge tokens · audit in-transaction · no secrets in repo/logs · exact integer arithmetic for grades/GPA · web budgets in CI.

## Workflow

1. Read your WP in §22 + the sections it references. 2. Contract change first (packages/contracts). 3. Write tests (incl. deny-path) with the code. 4. Custom SQL via `drizzle-kit generate --custom`. 5. Verify library APIs from installed types — never from memory. 6. Update docs/ if behaviour/config changes. 7. Open a PR named `wp-NN-…` linking requirement IDs.

## Do not

Use drizzle-kit push outside scratch DBs · add Redis · call Google in the request path · return Drive URLs · put business rules in controllers or jobs · use floats for grades · log tokens/URLs of media-edge · weaken a budget or invariant to make a test pass.
```

---

## Appendix F — Glossary

**Offering** — a course taught in a semester (with section); **Section** — split of an offering; **Audience** — programme/level an offering is intended for (not an entitlement); **Entitlement** — server-computed right to access an offering (enrollment or teaching assignment); **Host account** — institution-owned Workspace user that owns Meet spaces and recordings; **Space** — Meet meeting space (one per session); **Conference record** — one occurrence of a call in a space; **Participant session** — a continuous join→leave interval; **Inbox** — durable table for inbound provider events; **Rung** — one HLS rendition (240/360/480/720p); **Media edge** — Cloudflare Worker serving R2 media with HMAC tokens; **Course result** — final grade per enrollment; **GPA/CGPA** — credit-weighted average (semester/cumulative); **Quality points** — credits × grade points; **NUC 5-point** — Nigerian national grading scheme (A=5 … F=0); **DWD** — Google domain-wide delegation; **ADR** — architecture decision record (§2.2); **Spike** — time-boxed real-service verification (Appendix B).
