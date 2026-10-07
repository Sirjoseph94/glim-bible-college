CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT 'GLIM Online Bible College' NOT NULL,
	"timezone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"staff_email_domains" text[] DEFAULT '{}' NOT NULL,
	"youtube_channel_urls" text[] DEFAULT '{}' NOT NULL,
	"statement_of_faith_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
