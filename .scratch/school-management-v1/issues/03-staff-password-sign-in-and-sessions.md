# 03: Staff password sign-in and sessions

**What to build:** A staff member invited by a seeded System Admin can accept the invite, set a password, sign in, stay signed in, sign out, and reset a forgotten password (TRD §8.1–8.4).

**Blocked by:** 02 (Thin end-to-end skeleton: DB, API, worker, SPA)

**Status:** done

- [x] A CLI bootstraps the first System Admin (user + invite)
- [x] Invite accept, password set (argon2id, ≥ 12 chars, breached-password check), login, logout, forgot/reset flows with single-use hashed tokens
- [x] Opaque session cookie `__Host-glim_sid` with idle and absolute expiry stored as a hash; 5 s in-process lookup cache; token rotation on login; revoke-all on password change
- [x] CSRF header required on non-GET requests; `Origin`/`Sec-Fetch-Site` checked
- [x] Lockout after 5 failures for 15 minutes; uniform error responses
- [x] `GET /me` returns user, institution, roles, csrfToken, and timezone
- [x] Login, invite, forgot and reset screens in the SPA; Playwright happy path

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **Invite and reset tokens:** stored in a new `auth_tokens` table (owner: identity). The TRD defines the tokens but no table for them. Only SHA-256 hashes are stored, and a token is consumed atomically.
- **Breached-password list:** 46k leaked passwords of 12+ characters, taken from SecLists' 1M list (MIT), bundled gzipped, and checked case-insensitively. Nothing is called over the network.
- **Lockout:** unknown emails and wrong passwords answer identically, with timing equalised against a dummy argon2 hash. A locked account answers `ACCOUNT_LOCKED` (429 + Retry-After). That reveals the lock, which the 10/min/IP auth rate limit bounds.
- **Client IP:** the API no longer trusts `X-Forwarded-For`. Set `CLIENT_IP_HEADER=do-connecting-ip` on App Platform for per-client rate limits and session IPs.
- **Account emails:** sent after the transaction commits rather than through a job, because tokens are never stored in plaintext. The bootstrap CLI prints the link if the email fails.
- **Mailer port:** SendGrid (v3 REST via fetch, no SDK), SMTP (Mailpit) and in-memory adapters.
- **Playwright:** the happy path (invite → set password → sign out → sign in → forgot → reset) runs on a Pixel 7 viewport.
