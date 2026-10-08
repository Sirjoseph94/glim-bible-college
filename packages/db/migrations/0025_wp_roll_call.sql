CREATE TABLE "roll_call_marks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"class_meeting_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"present" boolean NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'IN_PERSON' NOT NULL,
	"marked_by" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roll_call_marks_mode_check" CHECK ("roll_call_marks"."mode" IN ('IN_PERSON', 'ONLINE')),
	CONSTRAINT "roll_call_marks_late_check" CHECK ("roll_call_marks"."present" OR NOT "roll_call_marks"."late")
);
--> statement-breakpoint
CREATE TABLE "roll_calls" (
	"class_meeting_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "roll_call_marks" ADD CONSTRAINT "roll_call_marks_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_call_marks" ADD CONSTRAINT "roll_call_marks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_call_marks" ADD CONSTRAINT "roll_call_marks_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_calls" ADD CONSTRAINT "roll_calls_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_calls" ADD CONSTRAINT "roll_calls_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roll_call_marks_meeting_student" ON "roll_call_marks" USING btree ("class_meeting_id","student_id");