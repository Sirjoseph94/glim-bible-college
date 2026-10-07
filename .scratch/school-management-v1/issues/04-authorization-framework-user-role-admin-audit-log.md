# 04: Authorization framework, user & role admin, audit log

**What to build:** The System Admin can create users, assign or revoke the four staff roles, and read an audit log of those changes. Every endpoint from here on is protected by one authorization service with generated deny tests (TRD §7, INV-1, INV-11).

**Blocked by:** 03 (Staff password sign-in and sessions)

**Status:** done

- [x] `matrix.json` (TRD §7.3) and `AuthorizationService.authorize` implementing the staff path; Lecturer, Student and Applicant paths stubbed for later tickets
- [x] Unknown or invisible resources return 404; denied writes are audited (sampled)
- [x] Persona fixtures (TRD §7.5) plus table-driven deny tests generated from `matrix.json` for every endpoint
- [x] Users list/create/edit/deactivate; role assign/revoke with a reason; deactivation revokes sessions
- [x] Append-only `audit_logs` (UPDATE/DELETE revoked + trigger) written in the same transaction as role changes
- [x] System Admin screens: users, roles, audit log viewer

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.

## Comments

**Implemented (2026-10-07).**
- **Permission matrix:** `matrix.json` transcribes TRD §7.3 and §7.4. It is validated at load against `PERMISSIONS` in the contracts.
- **Endpoint permissions:** endpoints declare `permission` (and `resource` where one applies), and the global guard decides.
  - A denied call on a resource answers 404; a denied call on a collection answers 403.
  - Denied writes are audited, at most once a minute per (user, permission).
- **Authorization paths:** the staff path is complete. The lecturer, student and applicant paths are marked for tickets 10, 19 and 12.
- **Deny tests:** generated from the matrix for every protected endpoint, covering staff personas, a no-role user and unauthenticated callers. A guard test fails if a new endpoint has no sample request.
- **Lockout protection (beyond the ticket):** the last active System Admin can't be suspended, deactivated or lose the role. These checks are serialised by an advisory lock.
- **Invite resend:** `POST /users/:id/invite` re-sends an invite. It isn't in the TRD catalogue, but an emailed invite that fails or expires needs it.
- **Playwright:** invite a staff member → grant a role → see it in the audit log.
