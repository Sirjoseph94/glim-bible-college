-- WP-04: the entitlement read model (TRD §6.3, owner: authorization), the single source for
-- "who may access this offering". Staff rows now; ticket 19 adds the STUDENT rows when course
-- enrollments exist (CREATE OR REPLACE VIEW).
CREATE VIEW v_offering_access AS
SELECT l.user_id, la.course_offering_id, 'STAFF'::text AS access_kind, la.role AS source_status,
       la.capability_overrides
  FROM lecturer_assignments la
  JOIN lecturers l ON l.id = la.lecturer_id
 WHERE la.status = 'ACTIVE' AND l.status = 'ACTIVE';
--> statement-breakpoint
GRANT SELECT ON v_offering_access TO glim_app;
