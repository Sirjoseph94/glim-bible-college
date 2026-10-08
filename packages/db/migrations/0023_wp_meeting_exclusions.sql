-- Class Meeting double-booking guards in the database (TRD §9.5, INV-4).
-- A Room holds one Class Meeting at a time; cancelled meetings free it. No override.
ALTER TABLE class_meetings ADD CONSTRAINT no_room_double_booking
  EXCLUDE USING gist (room_id WITH =, tstzrange(scheduled_start, scheduled_end) WITH &&)
  WHERE (room_id IS NOT NULL AND state <> 'CANCELLED');
--> statement-breakpoint
-- A Lecturer is in one Class Meeting at a time, unless an Academic Admin overrode it with a reason.
ALTER TABLE meeting_lecturer_slots ADD CONSTRAINT no_lecturer_overlap
  EXCLUDE USING gist (lecturer_id WITH =, during WITH &&) WHERE (NOT override);
