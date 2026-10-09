-- TRD §6.8, §14.7: an issued transcript is immutable. Only its status (with the revocation
-- details) may change, and the rendered PDF may be attached once (ticket 42). Rows are never
-- deleted.
CREATE FUNCTION transcripts_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transcripts are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.programme_enrollment_id IS DISTINCT FROM OLD.programme_enrollment_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.serial_no IS DISTINCT FROM OLD.serial_no
     OR NEW.verification_code IS DISTINCT FROM OLD.verification_code
     OR NEW.as_of IS DISTINCT FROM OLD.as_of
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256
     OR (OLD.file_id IS NOT NULL AND NEW.file_id IS DISTINCT FROM OLD.file_id) THEN
    RAISE EXCEPTION 'an issued transcript can''t change, only its status' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transcripts_immutable BEFORE UPDATE OR DELETE ON transcripts
  FOR EACH ROW EXECUTE FUNCTION transcripts_immutable();
--> statement-breakpoint
-- Public verification (§14.7) reads only these fields: no grades, no names beyond initials.
CREATE FUNCTION verify_transcript(code text)
RETURNS TABLE (
  valid boolean,
  status text,
  issued_at timestamptz,
  institution_name text,
  programme_name text,
  student_initials text,
  as_of date,
  snapshot_sha256 text
)
LANGUAGE sql STABLE AS $$
  SELECT t.status = 'ISSUED',
         t.status,
         t.issued_at,
         (SELECT s.name FROM settings s LIMIT 1),
         p.name,
         upper(left(st.given_name, 1)) || '. ' || upper(left(st.family_name, 1)) || '.',
         t.as_of,
         t.snapshot_sha256
    FROM transcripts t
    JOIN programme_enrollments pe ON pe.id = t.programme_enrollment_id
    JOIN programmes p ON p.id = pe.programme_id
    JOIN students st ON st.id = t.student_id
   WHERE t.verification_code = upper(verify_transcript.code);
$$;
