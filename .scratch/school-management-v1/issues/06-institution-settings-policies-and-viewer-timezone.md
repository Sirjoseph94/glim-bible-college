# 06: Institution settings, policies and viewer timezone

**What to build:** The System Admin edits institution settings and versioned policies, and every user sees times in their own timezone with Lagos time alongside (TRD §5.1, §6.2, C-27).

**Blocked by:** 04 (Authorization framework, user & role admin, audit log)

**Status:** done

- [x] Settings: name, timezone, staff email domains, Statement of Faith URL, YouTube channel URLs (`If-Match` versioning)
- [x] Policies API: append-only versions per type, with Zod schemas in `contracts` (ATTENDANCE, RECORDING, JOIN_WINDOW, NOTIFICATION, ADMISSIONS, GRADING_DEFAULTS)
- [x] `users.timezone` set from the browser on first sign-in and editable on the profile
- [x] A shared UI time component renders the viewer's zone, plus "(HH:mm Lagos)" when it differs; tested with Lagos and London viewers
- [x] Settings and policies screens for the System Admin

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **Settings:** `GET`/`PATCH /settings` use `If-Match`, are audited with a from/to for each changed field, and normalise staff domains and YouTube channel URLs.
- **Policies:** `GET /policies`, `GET`/`PUT /policies/:type`.
  - Saves are append-only: `glim_app` can't UPDATE or DELETE a saved version.
  - Optimistic concurrency uses `If-Match` together with the unique version index.
  - Each config is validated against its Zod schema in `contracts`.
  - Until a version is saved, a policy reads as version 0 with its defaults.
- **Timezone:** `PATCH /me` sets `timezone` (and `displayName`); `/me` gains `user.timezoneSet`. The SPA adopts the browser's zone on first sign-in, and the profile page lets the user change it.
- **Time display:** a `<Time>` component renders the viewer's zone with Lagos alongside when it differs. `shared/time` was rewritten on Intl and is tested with Lagos, London (GMT and BST) and New York viewers.
- **Screens:** the System Admin settings page has an institution form plus a generated form for each policy. Playwright covers it (New York viewer, rename, policy version).
- **Bundle:** the sign-in page now ships in the entry chunk. That keeps requests to the first screen at 8 (budget 12).
