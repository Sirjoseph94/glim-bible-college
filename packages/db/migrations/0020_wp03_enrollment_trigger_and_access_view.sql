-- WP-03 (TRD §6.3, §9.3): a course enrollment must agree with its semester enrollment. The
-- student and programme enrollment are denormalised onto course_enrollments for fast entitlement
-- checks, so this trigger keeps them honest, and the offering must be in that semester.
CREATE FUNCTION course_enrollment_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  se_programme_enrollment uuid;
  se_semester uuid;
  pe_student uuid;
  offering_semester uuid;
BEGIN
  SELECT se.programme_enrollment_id, se.semester_id, pe.student_id
    INTO se_programme_enrollment, se_semester, pe_student
    FROM semester_enrollments se
    JOIN programme_enrollments pe ON pe.id = se.programme_enrollment_id
   WHERE se.id = NEW.semester_enrollment_id;
  SELECT co.semester_id INTO offering_semester FROM course_offerings co WHERE co.id = NEW.course_offering_id;
  IF se_programme_enrollment IS DISTINCT FROM NEW.programme_enrollment_id
     OR pe_student IS DISTINCT FROM NEW.student_id
     OR offering_semester IS DISTINCT FROM se_semester THEN
    RAISE EXCEPTION 'course enrollment does not match its semester enrollment'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'course_enrollment_consistency';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER course_enrollment_consistency
  BEFORE INSERT OR UPDATE OF semester_enrollment_id, programme_enrollment_id, student_id, course_offering_id
  ON course_enrollments
  FOR EACH ROW EXECUTE FUNCTION course_enrollment_consistency();
--> statement-breakpoint
-- The entitlement read model now has its STUDENT rows (§6.3). ENROLLED means full participation;
-- COMPLETED is read-only access until the programme enrollment ends (C-25).
CREATE OR REPLACE VIEW v_offering_access AS
SELECT l.user_id, la.course_offering_id, 'STAFF'::text AS access_kind, la.role AS source_status,
       la.capability_overrides
  FROM lecturer_assignments la
  JOIN lecturers l ON l.id = la.lecturer_id
 WHERE la.status = 'ACTIVE' AND l.status = 'ACTIVE'
UNION ALL
SELECT s.user_id, ce.course_offering_id, 'STUDENT'::text, ce.status, '{}'::jsonb
  FROM course_enrollments ce
  JOIN students s ON s.id = ce.student_id
  JOIN programme_enrollments pe ON pe.id = ce.programme_enrollment_id
 WHERE ce.status IN ('ENROLLED', 'COMPLETED') AND s.status = 'ACTIVE' AND pe.status = 'ACTIVE';
