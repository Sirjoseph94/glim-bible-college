-- Block teaching invariants in the database (ADR-0005, INV-4).
-- A cohort takes one course at a time: its live offerings never overlap.
ALTER TABLE course_offerings ADD CONSTRAINT course_offerings_no_cohort_overlap
  EXCLUDE USING gist (cohort_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
  WHERE (status <> 'CANCELLED');
--> statement-breakpoint
-- An application belongs to one intake: intakes' application windows never overlap.
ALTER TABLE intakes ADD CONSTRAINT intakes_no_overlap
  EXCLUDE USING gist (daterange(opens_on, closes_on, '[]') WITH &&);
--> statement-breakpoint
-- One course per place in a curriculum's order. Deferrable, so a reorder can swap positions
-- inside one transaction.
ALTER TABLE curriculum_courses ADD CONSTRAINT curriculum_courses_position_unique
  UNIQUE (curriculum_id, position) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- `student_id` is denormalised onto course_enrollments for fast entitlement checks (§6.3): it must
-- be the programme enrollment's student.
CREATE FUNCTION course_enrollment_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pe_student uuid;
BEGIN
  SELECT pe.student_id INTO pe_student
    FROM programme_enrollments pe
   WHERE pe.id = NEW.programme_enrollment_id;
  IF pe_student IS DISTINCT FROM NEW.student_id THEN
    RAISE EXCEPTION 'course enrollment does not match its programme enrollment'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'course_enrollment_consistency';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER course_enrollment_consistency
  BEFORE INSERT OR UPDATE OF programme_enrollment_id, student_id
  ON course_enrollments
  FOR EACH ROW EXECUTE FUNCTION course_enrollment_consistency();
