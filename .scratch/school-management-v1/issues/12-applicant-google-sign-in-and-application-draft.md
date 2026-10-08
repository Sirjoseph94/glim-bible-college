# 12: Applicant Google sign-in and application draft

**What to build:** An applicant signs in with Google from `/apply`, chooses Certificate or Diploma and On-campus or Online, and fills in sections 1–8 of the application with autosave, coming back later to finish (TRD §10.2, C-29, C-36).

**Blocked by:** 05 (Google sign-in for staff and account linking); 11 (Intakes and the public apply page)

**Status:** done

- [x] The `apply` OIDC intent creates a role-less user only from `/apply`; that user becomes an Applicant on starting an application
- [x] Applicant authorization path (own application only) with deny tests; applicant sessions idle 24 h
- [x] One open application per applicant per intake (DB index); `INTAKE_CLOSED` when the intake isn't open
- [x] Draft PATCH with `If-Match` per section; Zod contract mirrors the paper form (title options, marital status, heard-via list, etc.)
- [x] Wizard UI: section progress, autosave every 5–10 s with "Saved / Offline — will retry", resume where left off
- [x] Spiritual-background answers are stored but never echoed in logs or audit (INV-15 test)
- [x] Applicants under 18 at intake start are blocked with `APPLICANT_UNDER_AGE`

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-08).**
- **Sign-up from `/apply`:** the Google `apply` intent is the only way an unknown Google account gets a user: active, with no roles, audited as `identity.user.self-registered`. Other sign-ins still refuse unknown accounts (`ACCOUNT_NOT_FOUND`). Apply sessions of non-staff users idle out after 24 h. Failures return to `/apply?error=…`.
- **Schema:** `applications` mirrors the paper form (TRD §6.9), with the `one_open_application` partial unique index, the submitted and admitted checks, and a CHECK that `heard_via` uses only the listed options. `application_sequences` and `application_events` are added too. `admissions_policy_version` records the declaration and consent texts shown.
- **Starting an application:** `POST /applications` works in the open intake only (`INTAKE_CLOSED`), once per intake (`APPLICATION_ALREADY_OPEN`). The email is prefilled from Google. Starting is audited and recorded in `application_events`, and it makes the user an Applicant (`/me` reports `isApplicant`).
- **Saving the draft:** `PATCH /applications/:id` takes one or more sections with `If-Match`. The Zod contract mirrors the paper form. Declaration and consent times come from the server. Every response lists the required fields still missing, per section.
- **Minimum age:** checked against the date the Academic Session starts, using `minimumAgeYears` from the ADMISSIONS policy; too young gives `APPLICANT_UNDER_AGE`, and the answer isn't saved.
- **Authorization:** the applicant path (own application only) uses the `application` resource. Anyone else, staff included, gets a 404 on the applicant endpoints. The generated deny tests include an `applicant` persona who owns an application.
- **INV-15:** the test plants a sentinel answer and checks that audit rows, application events and every captured log line (logged at trace level) are free of it. The logger also redacts the `spiritual` key.
- **Wizard (`/application/edit`, 6.1 KB gzip):** choose the programme and study mode, then sections 1–8 with progress ticks. Autosave runs every 5 s, showing "Saved", "Saving…" or "Offline — will retry". A conflict or a refused answer stops autosaving until the next edit. On return, the wizard opens at the first unfinished section. `/apply` offers "Apply with Google" while the intake is open.
- **Playwright:** an applicant signs up with Google, starts, is refused when under age, sees autosave and the prefilled email, and resumes after a reload, all inside the admissions journey.
- **Deviations:** recorded in `docs/implementation-notes.md` (starting needs only a session; applicants see their own section 5; the policy-version column; autosaves aren't audited; the photo FK waits for ticket 13).
