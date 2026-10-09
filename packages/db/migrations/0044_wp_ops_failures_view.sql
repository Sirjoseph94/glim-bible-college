-- TRD §15.3: the ops read model. One row per thing the System Admin may need to act on. Failed
-- pg-boss jobs live in the pgboss schema, which doesn't exist when migrations run, so the ops
-- service adds them to this view's rows itself.
CREATE VIEW v_ops_failures AS
SELECT 'provider-event'::text AS kind, pe.id::text AS id,
       pe.provider || ': ' || pe.event_type AS label, pe.status, pe.last_error AS detail,
       pe.received_at AS occurred_at
  FROM provider_events pe
 WHERE pe.status = 'FAILED'
UNION ALL
SELECT 'video', v.id::text, v.title, v.status, v.unavailable_reason, v.updated_at
  FROM videos v
 WHERE v.status IN ('UNAVAILABLE', 'FAILED')
UNION ALL
SELECT 'meeting-provision', m.id::text, m.title, m.provider_status, NULL, m.updated_at
  FROM class_meetings m
 WHERE m.provider_status = 'ERROR'
UNION ALL
SELECT 'email', u.id::text, u.email, u.email_status, 'Emails to this address are suppressed', u.updated_at
  FROM users u
 WHERE u.email_status <> 'OK';
--> statement-breakpoint
GRANT SELECT ON v_ops_failures TO glim_app;
