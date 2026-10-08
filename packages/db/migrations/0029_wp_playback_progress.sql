CREATE TABLE "playback_progress" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"video_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position_ms" bigint NOT NULL,
	"max_position_ms" bigint NOT NULL,
	"duration_ms" bigint NOT NULL,
	"percent_complete" numeric(5, 2) NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "playback_progress_positions" CHECK ("playback_progress"."position_ms" >= 0 AND "playback_progress"."position_ms" <= "playback_progress"."max_position_ms" AND "playback_progress"."max_position_ms" <= "playback_progress"."duration_ms")
);
--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "playback_progress_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "playback_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playback_progress_video_user" ON "playback_progress" USING btree ("video_id","user_id");--> statement-breakpoint
CREATE INDEX "playback_progress_user" ON "playback_progress" USING btree ("user_id");