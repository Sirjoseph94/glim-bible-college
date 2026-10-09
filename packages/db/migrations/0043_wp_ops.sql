CREATE TABLE "integration_checks" (
	"provider" text PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	"result" jsonb NOT NULL
);
