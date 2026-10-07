# The system serves GLIM only; multi-tenancy is removed

The original build spec was written as a multi-school product: `institution_id` on every table, composite tenant foreign keys, forced row-level security, a platform-admin role, per-institution Google configuration and cross-tenant CI tests. GLIM has no plan to offer the system to other schools, so we build for one institution. This removes a whole class of schema rules, tests and roles from every module.

## Consequences

- Institution-wide settings (timezone, grading scheme, Google integration) are single configuration, not rows keyed by institution.
- Reintroducing multi-tenancy later means adding a tenant key to every table and policy. Treat that as a rebuild, not a feature.
