-- WP-00: extensions and least-privilege grants (TRD §5.2, §6.2).
-- Runs as glim_migrator. The roles glim_migrator and glim_app are created outside migrations
-- (DigitalOcean control panel in production; docker/postgres/init.sql locally; the test harness in tests).
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO glim_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO glim_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO glim_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO glim_app;
