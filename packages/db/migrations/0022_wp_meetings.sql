CREATE TABLE "class_meeting_series" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"title_template" text NOT NULL,
	"rrule" text NOT NULL,
	"timezone" text NOT NULL,
	"starts_on" date NOT NULL,
	"until_on" date,
	"start_time" time NOT NULL,
	"duration_minutes" integer NOT NULL,
	"room_id" uuid,
	"online_link" text,
	"generated_through" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" uuid,
	CONSTRAINT "class_meeting_series_status_check" CHECK ("class_meeting_series"."status" IN ('ACTIVE', 'ENDED')),
	CONSTRAINT "class_meeting_series_duration_check" CHECK ("class_meeting_series"."duration_minutes" BETWEEN 5 AND 600)
);
--> statement-breakpoint
CREATE TABLE "class_meetings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"series_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"scheduled_start" timestamp with time zone NOT NULL,
	"scheduled_end" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"room_id" uuid,
	"online_link" text,
	"state" text DEFAULT 'SCHEDULED' NOT NULL,
	"provider" text,
	"provider_status" text,
	"provider_space_id" text,
	"provider_meeting_code" text,
	"join_url" text,
	"dial_in" jsonb,
	"host_account_id" uuid,
	"provisioned_at" timestamp with time zone,
	"provision_error" text,
	"recording_mode" text DEFAULT 'AUTO' NOT NULL,
	"attendance_state" text DEFAULT 'PENDING' NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"first_conference_started_at" timestamp with time zone,
	"last_conference_ended_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"occurrence_date" date,
	"series_exception" boolean DEFAULT false NOT NULL,
	"access_synced_at" timestamp with time zone,
	CONSTRAINT "class_meetings_state_check" CHECK ("class_meetings"."state" IN ('SCHEDULED', 'OPEN', 'LIVE', 'ENDED', 'CANCELLED', 'NO_SHOW')),
	CONSTRAINT "class_meetings_provider_status_check" CHECK ("class_meetings"."provider_status" IS NULL OR "class_meetings"."provider_status" IN ('PENDING', 'PROVISIONING', 'READY', 'ERROR')),
	CONSTRAINT "class_meetings_recording_mode_check" CHECK ("class_meetings"."recording_mode" IN ('AUTO', 'MANUAL', 'OFF')),
	CONSTRAINT "class_meetings_attendance_state_check" CHECK ("class_meetings"."attendance_state" IN ('PENDING', 'PROVISIONAL', 'FINAL', 'REVIEW_REQUIRED')),
	CONSTRAINT "class_meetings_times_check" CHECK ("class_meetings"."scheduled_end" > "class_meetings"."scheduled_start")
);
--> statement-breakpoint
CREATE TABLE "meeting_lecturer_slots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"class_meeting_id" uuid NOT NULL,
	"lecturer_id" uuid NOT NULL,
	"during" "tstzrange" NOT NULL,
	"override" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	CONSTRAINT "meeting_lecturer_slots_override_reason_check" CHECK (NOT "meeting_lecturer_slots"."override" OR "meeting_lecturer_slots"."override_reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "class_meeting_series" ADD CONSTRAINT "class_meeting_series_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_meeting_series" ADD CONSTRAINT "class_meeting_series_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_meeting_series" ADD CONSTRAINT "class_meeting_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_series_id_class_meeting_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."class_meeting_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_meetings" ADD CONSTRAINT "class_meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_lecturer_slots" ADD CONSTRAINT "meeting_lecturer_slots_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_lecturer_slots" ADD CONSTRAINT "meeting_lecturer_slots_lecturer_id_lecturers_id_fk" FOREIGN KEY ("lecturer_id") REFERENCES "public"."lecturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_meetings_series_occurrence" ON "class_meetings" USING btree ("series_id","occurrence_date") WHERE series_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "class_meetings_provider_space" ON "class_meetings" USING btree ("provider","provider_space_id") WHERE provider_space_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "class_meetings_offering_start" ON "class_meetings" USING btree ("course_offering_id","scheduled_start");--> statement-breakpoint
CREATE INDEX "class_meetings_open_by_start" ON "class_meetings" USING btree ("state","scheduled_start") WHERE state IN ('SCHEDULED', 'OPEN', 'LIVE');--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_lecturer_slots_meeting_lecturer" ON "meeting_lecturer_slots" USING btree ("class_meeting_id","lecturer_id");