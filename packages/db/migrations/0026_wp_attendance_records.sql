CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"class_meeting_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"computed_status" text NOT NULL,
	"attendance_mode" text NOT NULL,
	"override_status" text,
	"attended_seconds" integer NOT NULL,
	"effective_seconds" integer NOT NULL,
	"ratio_bp" integer NOT NULL,
	"first_join_at" timestamp with time zone,
	"last_leave_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"join_count" integer DEFAULT 0 NOT NULL,
	"calc_version" integer DEFAULT 1 NOT NULL,
	"policy_version" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"override_by" uuid,
	"override_reason" text,
	"overridden_at" timestamp with time zone,
	CONSTRAINT "attendance_records_computed_status_check" CHECK ("attendance_records"."computed_status" IN ('PRESENT', 'PARTIAL', 'ABSENT')),
	CONSTRAINT "attendance_records_attendance_mode_check" CHECK ("attendance_records"."attendance_mode" IN ('IN_PERSON', 'ONLINE', 'NONE')),
	CONSTRAINT "attendance_records_override_status_check" CHECK ("attendance_records"."override_status" IS NULL OR "attendance_records"."override_status" IN ('PRESENT', 'PARTIAL', 'ABSENT', 'EXCUSED')),
	CONSTRAINT "attendance_records_ratio_check" CHECK ("attendance_records"."ratio_bp" BETWEEN 0 AND 10000),
	CONSTRAINT "attendance_records_override_reason_check" CHECK (("attendance_records"."override_status" IS NULL) = ("attendance_records"."override_reason" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_override_by_users_id_fk" FOREIGN KEY ("override_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_meeting_student" ON "attendance_records" USING btree ("class_meeting_id","student_id");--> statement-breakpoint
CREATE INDEX "attendance_records_student" ON "attendance_records" USING btree ("student_id");