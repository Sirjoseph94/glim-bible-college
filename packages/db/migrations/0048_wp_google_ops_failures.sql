-- TRD §6.7, §15.3: the ops read model gains the Google integration's failures: recordings that
-- couldn't be uploaded, and event subscriptions that aren't active.
CREATE OR REPLACE VIEW v_ops_failures AS
SELECT 'provider-event'::text AS kind, pe.id::text AS id,
       pe.provider || ': ' || pe.event_type AS label, pe.status, pe.last_error AS detail,
       pe.received_at AS occurred_at
  FROM provider_events pe
 WHERE pe.status = 'FAILED'
UNION ALL
SELECT 'video', v.id::text, v.title, v.status, v.unavailable_reason, v.updated_at
  FROM videos v
 -- A failed upload shows as its recording, which is what can be replayed.
 WHERE v.status = 'UNAVAILABLE' OR (v.status = 'FAILED' AND v.origin <> 'RECORDING')
UNION ALL
SELECT 'meeting-provision', m.id::text, m.title, m.provider_status, m.provision_error, m.updated_at
  FROM class_meetings m
 WHERE m.provider_status = 'ERROR'
UNION ALL
SELECT 'recording', r.id::text, m.title || ' (part ' || r.part_no || ')', r.status,
       coalesce(r.last_error_code || ': ', '') || coalesce(r.last_error, ''), r.updated_at
  FROM recordings r
  JOIN class_meetings m ON m.id = r.class_meeting_id
 WHERE r.status IN ('FAILED', 'SOURCE_MISSING')
UNION ALL
SELECT 'subscription', s.id::text, h.email::text, s.status, s.last_error, s.updated_at
  FROM provider_subscriptions s
  JOIN provider_host_accounts h ON h.id = s.host_account_id
 WHERE s.status <> 'ACTIVE'
UNION ALL
SELECT 'email', u.id::text, u.email, u.email_status, 'Emails to this address are suppressed', u.updated_at
  FROM users u
 WHERE u.email_status <> 'OK';
