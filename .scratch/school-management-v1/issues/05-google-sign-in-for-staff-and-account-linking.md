# 05: Google sign-in for staff and account linking

**What to build:** Staff can sign in with Google (restricted to staff email domains), and any signed-in user can link a Google account to their profile (TRD §8.1).

**Blocked by:** 03 (Staff password sign-in and sessions)

**Status:** ready-for-agent

- [ ] OIDC authorization code + PKCE; ID token verified; `email_verified` required
- [ ] Intents `signin` and `link` (the `apply` intent comes in ticket 12); unmatched staff sign-in returns `ACCOUNT_NOT_FOUND`
- [ ] `hd` check against `settings.staff_email_domains` for staff
- [ ] Identities stored with `provider='google'`, `subject`, email and `metadata.googleName`
- [ ] Profile page "Link Google account"; the login page offers "Continue with Google"
- [ ] Integration tests against a fake OIDC provider

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
