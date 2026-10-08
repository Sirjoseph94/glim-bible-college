CREATE TABLE "meeting_join_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"class_meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"deny_reason" text,
	"device" text,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_join_log_outcome_check" CHECK ("meeting_join_log"."outcome" IN ('AUTHORIZED', 'DENIED'))
);
--> statement-breakpoint
ALTER TABLE "meeting_join_log" ADD CONSTRAINT "meeting_join_log_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_join_log" ADD CONSTRAINT "meeting_join_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_join_log_meeting" ON "meeting_join_log" USING btree ("class_meeting_id","authorized_at");