CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"class_meeting_id" uuid,
	"origin" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'UNPUBLISHED' NOT NULL,
	"status_before_unavailable" text,
	"visibility" text DEFAULT 'ENROLLED' NOT NULL,
	"youtube_video_id" text,
	"youtube_channel_url" text,
	"thumbnail_url" text,
	"duration_ms" bigint,
	"last_checked_at" timestamp with time zone,
	"unavailable_reason" text,
	"audio_key" text,
	"publish_after" timestamp with time zone,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"deleted_by" uuid,
	"youtube_delete_reminded_at" timestamp with time zone,
	"added_by" uuid,
	CONSTRAINT "videos_origin_check" CHECK ("videos"."origin" IN ('LINK', 'RECORDING')),
	CONSTRAINT "videos_status_check" CHECK ("videos"."status" IN ('PROCESSING', 'UNPUBLISHED', 'PUBLISHED', 'UNAVAILABLE', 'FAILED', 'DELETED')),
	CONSTRAINT "videos_visibility_check" CHECK ("videos"."visibility" IN ('ENROLLED', 'STAFF_ONLY')),
	CONSTRAINT "videos_youtube_video_id_check" CHECK ("videos"."youtube_video_id" ~ '^[A-Za-z0-9_-]{11}$'),
	CONSTRAINT "videos_youtube_id_required" CHECK ("videos"."status" IN ('PROCESSING', 'FAILED') OR "videos"."youtube_video_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "videos_offering_status_position" ON "videos" USING btree ("course_offering_id","status","position");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_offering_youtube" ON "videos" USING btree ("course_offering_id","youtube_video_id") WHERE status <> 'DELETED';--> statement-breakpoint
CREATE INDEX "videos_delete_after" ON "videos" USING btree ("delete_after") WHERE status = 'DELETED';