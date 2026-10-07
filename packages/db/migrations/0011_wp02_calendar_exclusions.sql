-- WP-02: calendar invariants in the database (TRD §9.1, INV-4).
-- Academic Sessions never overlap each other.
ALTER TABLE academic_sessions ADD CONSTRAINT academic_sessions_no_overlap
  EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&);
--> statement-breakpoint
-- Semesters of one session never overlap.
ALTER TABLE semesters ADD CONSTRAINT semesters_no_overlap
  EXCLUDE USING gist (academic_session_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&);
--> statement-breakpoint
-- At most one ACTIVE session.
CREATE UNIQUE INDEX one_active_session ON academic_sessions ((true)) WHERE status = 'ACTIVE';
