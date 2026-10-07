# 03: Staff password sign-in and sessions

**What to build:** A staff member invited by a seeded System Admin can accept the invite, set a password, sign in, stay signed in, sign out, and reset a forgotten password (TRD §8.1–8.4).

**Blocked by:** 02 (Thin end-to-end skeleton: DB, API, worker, SPA)

**Status:** ready-for-agent

- [ ] A CLI bootstraps the first System Admin (user + invite)
- [ ] Invite accept, password set (argon2id, ≥ 12 chars, breached-password check), login, logout, forgot/reset flows with single-use hashed tokens
- [ ] Opaque session cookie `__Host-glim_sid` with idle and absolute expiry stored as a hash; 5 s in-process lookup cache; token rotation on login; revoke-all on password change
- [ ] CSRF header required on non-GET requests; `Origin`/`Sec-Fetch-Site` checked
- [ ] Lockout after 5 failures for 15 minutes; uniform error responses
- [ ] `GET /me` returns user, institution, roles, csrfToken, and timezone
- [ ] Login, invite, forgot and reset screens in the SPA; Playwright happy path

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
