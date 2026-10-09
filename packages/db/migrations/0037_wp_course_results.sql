CREATE TABLE "gradebook_locks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	CONSTRAINT "gradebook_locks_once" UNIQUE("course_offering_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "course_result_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"course_result_id" uuid NOT NULL,
	"change_kind" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_by" uuid NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_enrollment_id" uuid,
	"programme_enrollment_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"course_offering_id" uuid,
	"course_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"grading_scheme_id" uuid NOT NULL,
	"source" text DEFAULT 'GRADEBOOK' NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"credits_x10" integer NOT NULL,
	"final_pct_x100" integer,
	"letter" text,
	"points_x100" integer,
	"quality_points_x1000" bigint,
	"result_kind" text DEFAULT 'GRADED' NOT NULL,
	"counts_in_gpa" boolean DEFAULT true NOT NULL,
	"passed" boolean,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"finalized_by" uuid,
	"finalized_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"reopened_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "course_results_course_enrollment_id_unique" UNIQUE("course_enrollment_id"),
	CONSTRAINT "course_results_source_check" CHECK ("course_results"."source" IN ('GRADEBOOK', 'IMPORT')),
	CONSTRAINT "course_results_result_kind_check" CHECK ("course_results"."result_kind" IN ('GRADED', 'INCOMPLETE', 'WITHDRAWN', 'EXEMPT', 'AUDIT')),
	CONSTRAINT "course_results_status_check" CHECK ("course_results"."status" IN ('DRAFT', 'FINALIZED', 'APPROVED', 'PUBLISHED')),
	CONSTRAINT "course_results_gradebook_link" CHECK ("course_results"."source" = 'IMPORT' OR ("course_results"."course_enrollment_id" IS NOT NULL AND "course_results"."course_offering_id" IS NOT NULL)),
	CONSTRAINT "course_results_credits_check" CHECK ("course_results"."credits_x10" >= 0),
	CONSTRAINT "course_results_pct_check" CHECK ("course_results"."final_pct_x100" IS NULL OR "course_results"."final_pct_x100" BETWEEN 0 AND 10000),
	CONSTRAINT "course_results_finalized_check" CHECK ("course_results"."status" = 'DRAFT' OR ("course_results"."finalized_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "gradebook_locks" ADD CONSTRAINT "gradebook_locks_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradebook_locks" ADD CONSTRAINT "gradebook_locks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_result_revisions" ADD CONSTRAINT "course_result_revisions_course_result_id_course_results_id_fk" FOREIGN KEY ("course_result_id") REFERENCES "public"."course_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_result_revisions" ADD CONSTRAINT "course_result_revisions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_results" ADD CONSTRAINT "course_results_course_enrollment_id_course_enrollments_id_fk" FOREIGN KEY ("course_enrollment_id") REFERENCES "public"."course_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_results" ADD CONSTRAINT "course_results_programme_enrollment_id_programme_enrollments_id_fk" FOREIGN KEY ("programme_enrollment_id") REFERENCES "public"."programme_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_results" ADD CONSTRAINT "course_results_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_results" ADD CONSTRAINT "course_results_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_results" ADD CONSTRAINT "course_results_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_results" ADD CONSTRAINT "course_results_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_results" ADD CONSTRAINT "course_results_grading_scheme_id_grading_schemes_id_fk" FOREIGN KEY ("grading_scheme_id") REFERENCES "public"."grading_schemes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_results" ADD CONSTRAINT "course_results_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_results" ADD CONSTRAINT "course_results_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_results_enrollment_semester" ON "course_results" USING btree ("programme_enrollment_id","semester_id");--> statement-breakpoint
CREATE INDEX "course_results_student_course" ON "course_results" USING btree ("student_id","course_id");--> statement-breakpoint
CREATE INDEX "course_results_offering" ON "course_results" USING btree ("course_offering_id");