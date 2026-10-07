# 05: Google sign-in for staff and account linking

**What to build:** Staff can sign in with Google (restricted to staff email domains), and any signed-in user can link a Google account to their profile (TRD §8.1).

**Blocked by:** 03 (Staff password sign-in and sessions)

**Status:** done

- [x] OIDC authorization code + PKCE; ID token verified; `email_verified` required
- [x] Intents `signin` and `link` (the `apply` intent comes in ticket 12); unmatched staff sign-in returns `ACCOUNT_NOT_FOUND`
- [x] `hd` check against `settings.staff_email_domains` for staff
- [x] Identities stored with `provider='google'`, `subject`, email and `metadata.googleName`
- [x] Profile page "Link Google account"; the login page offers "Continue with Google"
- [x] Integration tests against a fake OIDC provider

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **OIDC client:** openid-client 6 behind an `IdentityProvider` port in `integrations/oidc`. It runs authorization code + PKCE (S256), with state and nonce, and verifies the ID token.
- **Flow state:** kept in a 10-minute, HMAC-signed `__Host-glim_oidc` cookie (`SESSION_SECRET`), along with the intent and `returnTo` (same-site paths only).
- **Matching:** sign-in matches users by Google `sub`, then by verified email, linking the identity on first use. An INVITED user who signs in with Google becomes ACTIVE, because Google has verified the invited address.
- **Staff domains:** staff (users with any staff role) must have an `hd` in `settings.staff_email_domains` when that list isn't empty.
- **Callback outcome:** always a redirect into the SPA. Failures arrive as `?error=` on `/login` or `/profile`.
- **API flags:** `/me` gains `user.googleLinked`, and `/public/institution` gains `googleSignIn`.
- **Tests:** API tests and Playwright both run against `FakeOidcIssuer`, a real HTTP issuer with JWKS, PKCE checks and RS256 ID tokens.
- **Deferred:** the `apply` intent comes with ticket 12.
