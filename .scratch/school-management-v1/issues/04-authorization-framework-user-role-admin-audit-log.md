# 04: Authorization framework, user & role admin, audit log

**What to build:** The System Admin can create users, assign or revoke the four staff roles, and read an audit log of those changes. Every endpoint from here on is protected by one authorization service with generated deny tests (TRD §7, INV-1, INV-11).

**Blocked by:** 03 (Staff password sign-in and sessions)

**Status:** ready-for-agent

- [ ] `matrix.json` (TRD §7.3) and `AuthorizationService.authorize` implementing the staff path; Lecturer, Student and Applicant paths stubbed for later tickets
- [ ] Unknown or invisible resources return 404; denied writes are audited (sampled)
- [ ] Persona fixtures (TRD §7.5) plus table-driven deny tests generated from `matrix.json` for every endpoint
- [ ] Users list/create/edit/deactivate; role assign/revoke with a reason; deactivation revokes sessions
- [ ] Append-only `audit_logs` (UPDATE/DELETE revoked + trigger) written in the same transaction as role changes
- [ ] System Admin screens: users, roles, audit log viewer

**Spec:** `.scratch/school-management-v1/spec.md` (wins over the TRD for this slice). Use `GLOSSARY.md` terms.
