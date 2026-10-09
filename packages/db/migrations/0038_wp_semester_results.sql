CREATE TABLE "semester_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"programme_enrollment_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"credits_attempted_x10" integer NOT NULL,
	"credits_earned_x10" integer NOT NULL,
	"quality_points_x1000" bigint NOT NULL,
	"gpa_x100" integer,
	"cum_credits_attempted_x10" integer NOT NULL,
	"cum_credits_earned_x10" integer NOT NULL,
	"cum_quality_points_x1000" bigint NOT NULL,
	"cgpa_x100" integer,
	"standing" text DEFAULT 'UNKNOWN' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"calc_version" integer DEFAULT 1 NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	CONSTRAINT "semester_results_once" UNIQUE("programme_enrollment_id","semester_id"),
	CONSTRAINT "semester_results_standing_check" CHECK ("semester_results"."standing" IN ('GOOD', 'PROBATION', 'WITHDRAW_REQUIRED', 'UNKNOWN')),
	CONSTRAINT "semester_results_status_check" CHECK ("semester_results"."status" IN ('DRAFT', 'APPROVED', 'PUBLISHED'))
);
--> statement-breakpoint
ALTER TABLE "semester_results" ADD CONSTRAINT "semester_results_programme_enrollment_id_programme_enrollments_id_fk" FOREIGN KEY ("programme_enrollment_id") REFERENCES "public"."programme_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_results" ADD CONSTRAINT "semester_results_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_results" ADD CONSTRAINT "semester_results_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "semester_results_semester" ON "semester_results" USING btree ("semester_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "course_results_import_once" ON "course_results" USING btree ("programme_enrollment_id","semester_id","course_id") WHERE source = 'IMPORT';