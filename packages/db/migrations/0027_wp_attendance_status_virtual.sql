-- The effective attendance status (TRD §6.4): the override if any, else the computed status.
-- A PostgreSQL 18 VIRTUAL generated column, so it can never be written or drift (INV-7).
ALTER TABLE attendance_records ADD COLUMN status text
  GENERATED ALWAYS AS (COALESCE(override_status, computed_status)) VIRTUAL;
