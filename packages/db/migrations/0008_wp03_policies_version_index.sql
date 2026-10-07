-- WP-03: one row per (policy, scope, version) (TRD §6.2). An expression index, so hand-written.
CREATE UNIQUE INDEX policies_version ON policies (
  policy_type, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), policy_version
);
--> statement-breakpoint
-- Versions are append-only: nobody edits or removes a saved policy version.
REVOKE UPDATE, DELETE, TRUNCATE ON policies FROM glim_app;
