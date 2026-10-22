CREATE TABLE "provider_participant_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"class_meeting_id" uuid NOT NULL,
	"conference_record_id" uuid NOT NULL,
	"provider_participant_id" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"participant_kind" text NOT NULL,
	"provider_user_id" text,
	"display_name" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"matched_user_id" uuid,
	"match_method" text DEFAULT 'NONE' NOT NULL,
	"match_status" text DEFAULT 'UNMATCHED' NOT NULL,
	"raw" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_participant_sessions_provider_session_id_unique" UNIQUE("provider_session_id"),
	CONSTRAINT "provider_participant_sessions_participant_kind_check" CHECK ("provider_participant_sessions"."participant_kind" IN ('SIGNED_IN', 'ANONYMOUS', 'PHONE')),
	CONSTRAINT "provider_participant_sessions_match_method_check" CHECK ("provider_participant_sessions"."match_method" IN ('NONE', 'GOOGLE_ID', 'MEMBER_EMAIL', 'NAME_ASSISTED', 'MANUAL')),
	CONSTRAINT "provider_participant_sessions_match_status_check" CHECK ("provider_participant_sessions"."match_status" IN ('UNMATCHED', 'SUGGESTED', 'CONFIRMED'))
);
--> statement-breakpoint
CREATE TABLE "conference_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"class_meeting_id" uuid NOT NULL,
	"provider_conference_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"dirty" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "conference_records_provider_conference_id_unique" UNIQUE("provider_conference_id"),
	CONSTRAINT "conference_records_status_check" CHECK ("conference_records"."status" IN ('ACTIVE', 'ENDED'))
);
--> statement-breakpoint
CREATE TABLE "provider_host_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"provider" text DEFAULT 'google_meet' NOT NULL,
	"email" "citext" NOT NULL,
	"provider_user_id" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "provider_host_accounts_status_check" CHECK ("provider_host_accounts"."status" IN ('ACTIVE', 'DISABLED', 'THROTTLED'))
);
--> statement-breakpoint
CREATE TABLE "provider_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"host_account_id" uuid NOT NULL,
	"target_resource" text NOT NULL,
	"event_types" text[] NOT NULL,
	"remote_name" text,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"last_renewed_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "provider_subscriptions_target_resource_unique" UNIQUE("target_resource"),
	CONSTRAINT "provider_subscriptions_status_check" CHECK ("provider_subscriptions"."status" IN ('ACTIVE', 'EXPIRING', 'EXPIRED', 'SUSPENDED', 'ERROR'))
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"class_meeting_id" uuid NOT NULL,
	"conference_record_id" uuid NOT NULL,
	"part_no" integer DEFAULT 1 NOT NULL,
	"provider_recording_id" text NOT NULL,
	"drive_file_id" text,
	"status" text DEFAULT 'DISCOVERED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error" text,
	"source_size_bytes" bigint,
	"source_md5" text,
	"source_mime" text,
	"source_duration_ms" bigint,
	"recording_started_at" timestamp with time zone,
	"recording_ended_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone,
	"drive_cleanup_status" text DEFAULT 'NOT_REQUESTED' NOT NULL,
	CONSTRAINT "recordings_provider_recording_id_unique" UNIQUE("provider_recording_id"),
	CONSTRAINT "recordings_drive_file_id_unique" UNIQUE("drive_file_id"),
	CONSTRAINT "recordings_status_check" CHECK ("recordings"."status" IN ('DISCOVERED', 'UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'SOURCE_MISSING')),
	CONSTRAINT "recordings_drive_cleanup_status_check" CHECK ("recordings"."drive_cleanup_status" IN ('NOT_REQUESTED', 'PENDING', 'TRASHED', 'SKIPPED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "integration_configs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'UNVERIFIED' NOT NULL,
	"config" jsonb NOT NULL,
	"secret_ciphertext" text,
	"verified_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "integration_configs_provider_unique" UNIQUE("provider"),
	CONSTRAINT "integration_configs_provider_check" CHECK ("integration_configs"."provider" IN ('google_workspace', 'video_host', 'sendgrid')),
	CONSTRAINT "integration_configs_status_check" CHECK ("integration_configs"."status" IN ('UNVERIFIED', 'VERIFIED', 'DEGRADED', 'DISABLED'))
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "recording_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_participant_sessions" ADD CONSTRAINT "provider_participant_sessions_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_participant_sessions" ADD CONSTRAINT "provider_participant_sessions_conference_record_id_conference_records_id_fk" FOREIGN KEY ("conference_record_id") REFERENCES "public"."conference_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_participant_sessions" ADD CONSTRAINT "provider_participant_sessions_matched_user_id_users_id_fk" FOREIGN KEY ("matched_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_records" ADD CONSTRAINT "conference_records_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_subscriptions" ADD CONSTRAINT "provider_subscriptions_host_account_id_provider_host_accounts_id_fk" FOREIGN KEY ("host_account_id") REFERENCES "public"."provider_host_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_conference_record_id_conference_records_id_fk" FOREIGN KEY ("conference_record_id") REFERENCES "public"."conference_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_participant_sessions_meeting_user" ON "provider_participant_sessions" USING btree ("class_meeting_id","matched_user_id");--> statement-breakpoint
CREATE INDEX "conference_records_meeting" ON "conference_records" USING btree ("class_meeting_id");--> statement-breakpoint
CREATE INDEX "conference_records_dirty" ON "conference_records" USING btree ("dirty","last_synced_at") WHERE dirty;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_host_accounts_email" ON "provider_host_accounts" USING btree ("provider","email");--> statement-breakpoint
CREATE INDEX "recordings_open" ON "recordings" USING btree ("status","updated_at") WHERE status <> 'READY';--> statement-breakpoint
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_host_account_id_provider_host_accounts_id_fk" FOREIGN KEY ("host_account_id") REFERENCES "public"."provider_host_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_recording_id_unique" UNIQUE("recording_id");