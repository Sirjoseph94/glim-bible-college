-- WP-00: the single settings row (ADR-0001). Defaults come from the column definitions.
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
