CREATE TABLE "course_enrollment_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"course_enrollment_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "course_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"semester_enrollment_id" uuid NOT NULL,
	"programme_enrollment_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"selection" text NOT NULL,
	"enrollment_type" text DEFAULT 'CREDIT' NOT NULL,
	"status" text DEFAULT 'ENROLLED' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dropped_at" timestamp with time zone,
	CONSTRAINT "course_enrollments_selection_check" CHECK ("course_enrollments"."selection" IN ('COMPULSORY', 'ELECTIVE', 'MANUAL')),
	CONSTRAINT "course_enrollments_enrollment_type_check" CHECK ("course_enrollments"."enrollment_type" IN ('CREDIT', 'AUDIT')),
	CONSTRAINT "course_enrollments_status_check" CHECK ("course_enrollments"."status" IN ('ENROLLED', 'DROPPED', 'WITHDRAWN', 'COMPLETED'))
);
--> statement-breakpoint
CREATE TABLE "semester_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"programme_enrollment_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"level_no" smallint NOT NULL,
	"status" text DEFAULT 'REGISTERED' NOT NULL,
	CONSTRAINT "semester_enrollments_once" UNIQUE("programme_enrollment_id","semester_id"),
	CONSTRAINT "semester_enrollments_status_check" CHECK ("semester_enrollments"."status" IN ('REGISTERED', 'WITHDRAWN', 'COMPLETED'))
);
--> statement-breakpoint
ALTER TABLE "course_enrollment_events" ADD CONSTRAINT "course_enrollment_events_course_enrollment_id_course_enrollments_id_fk" FOREIGN KEY ("course_enrollment_id") REFERENCES "public"."course_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollment_events" ADD CONSTRAINT "course_enrollment_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_semester_enrollment_id_semester_enrollments_id_fk" FOREIGN KEY ("semester_enrollment_id") REFERENCES "public"."semester_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_programme_enrollment_id_programme_enrollments_id_fk" FOREIGN KEY ("programme_enrollment_id") REFERENCES "public"."programme_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_enrollments" ADD CONSTRAINT "semester_enrollments_programme_enrollment_id_programme_enrollments_id_fk" FOREIGN KEY ("programme_enrollment_id") REFERENCES "public"."programme_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_enrollments" ADD CONSTRAINT "semester_enrollments_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_enrollment_events_enrollment_idx" ON "course_enrollment_events" USING btree ("course_enrollment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_course_enrollment" ON "course_enrollments" USING btree ("student_id","course_offering_id") WHERE "course_enrollments"."status" IN ('ENROLLED', 'COMPLETED');--> statement-breakpoint
CREATE INDEX "course_enrollments_offering_status_idx" ON "course_enrollments" USING btree ("course_offering_id","status");--> statement-breakpoint
CREATE INDEX "course_enrollments_student_status_idx" ON "course_enrollments" USING btree ("student_id","status");