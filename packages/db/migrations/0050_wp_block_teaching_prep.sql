-- Block teaching replaces semesters (ADR-0005, BT-8). Destructive by decision: production held
-- no academic records, so nothing is converted. Refuse to run if that's no longer true.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM course_offerings) OR EXISTS (SELECT 1 FROM programme_enrollments)
     OR EXISTS (SELECT 1 FROM course_results) OR EXISTS (SELECT 1 FROM awards) THEN
    RAISE EXCEPTION 'block teaching migration (0050) expects no offerings, programme enrollments, results or awards';
  END IF;
END $$;
--> statement-breakpoint
-- One programme now (BT-2): a Certificate programme is retired; the Certificate is an award.
UPDATE "programmes" SET "status" = 'ARCHIVED' WHERE "award_type" = 'CERTIFICATE';--> statement-breakpoint
-- Replaced in 0052: course enrollments no longer hang off semester enrollments.
DROP TRIGGER "course_enrollment_consistency" ON "course_enrollments";--> statement-breakpoint
DROP FUNCTION "course_enrollment_consistency"();--> statement-breakpoint
