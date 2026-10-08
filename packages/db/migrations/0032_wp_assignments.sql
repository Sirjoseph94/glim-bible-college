CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"max_score" numeric(7, 2) NOT NULL,
	"weight" numeric(5, 2) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"due_at" timestamp with time zone,
	CONSTRAINT "assessments_kind_check" CHECK ("assessments"."kind" IN ('ASSIGNMENT', 'QUIZ', 'EXAM', 'MANUAL')),
	CONSTRAINT "assessments_status_check" CHECK ("assessments"."status" IN ('DRAFT', 'PUBLISHED', 'CLOSED')),
	CONSTRAINT "assessments_max_score_check" CHECK ("assessments"."max_score" > 0),
	CONSTRAINT "assessments_weight_check" CHECK ("assessments"."weight" >= 0 AND "assessments"."weight" <= 100)
);
--> statement-breakpoint
CREATE TABLE "assignment_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"text_body" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"is_late" boolean DEFAULT false NOT NULL,
	CONSTRAINT "assignment_submissions_attempt" UNIQUE("assignment_id","student_id","attempt_no"),
	CONSTRAINT "assignment_submissions_status_check" CHECK ("assignment_submissions"."status" IN ('DRAFT', 'SUBMITTED', 'RETURNED')),
	CONSTRAINT "assignment_submissions_submitted_at" CHECK (("assignment_submissions"."status" = 'DRAFT') = ("assignment_submissions"."submitted_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"instructions_md" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"cutoff_at" timestamp with time zone,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"late_policy" jsonb DEFAULT '{"allowLate":false}'::jsonb NOT NULL,
	"submission_types" text[] DEFAULT '{FILE,TEXT}' NOT NULL,
	"max_file_mb" integer DEFAULT 20 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	CONSTRAINT "assignments_assessment_id_unique" UNIQUE("assessment_id"),
	CONSTRAINT "assignments_status_check" CHECK ("assignments"."status" IN ('DRAFT', 'PUBLISHED', 'CLOSED')),
	CONSTRAINT "assignments_max_attempts_check" CHECK ("assignments"."max_attempts" BETWEEN 1 AND 10),
	CONSTRAINT "assignments_cutoff_after_due" CHECK ("assignments"."cutoff_at" IS NULL OR "assignments"."cutoff_at" >= "assignments"."due_at"),
	CONSTRAINT "assignments_max_file_mb_check" CHECK ("assignments"."max_file_mb" BETWEEN 1 AND 20),
	CONSTRAINT "assignments_submission_types_check" CHECK (cardinality("assignments"."submission_types") > 0 AND "assignments"."submission_types" <@ ARRAY['FILE','TEXT'])
);
--> statement-breakpoint
CREATE TABLE "grade_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grade_id" uuid NOT NULL,
	"old_score" numeric(7, 2),
	"new_score" numeric(7, 2),
	"old_status" text,
	"new_status" text,
	"old_source" text,
	"new_source" text,
	"changed_by" uuid NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"score" numeric(7, 2),
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"feedback_md" text,
	"graded_by" uuid,
	"graded_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "grades_assessment_student" UNIQUE("assessment_id","student_id"),
	CONSTRAINT "grades_source_check" CHECK ("grades"."source" IN ('MANUAL', 'QUIZ', 'SUBMISSION', 'IMPORT')),
	CONSTRAINT "grades_status_check" CHECK ("grades"."status" IN ('DRAFT', 'RELEASED', 'EXCUSED')),
	CONSTRAINT "grades_score_check" CHECK ("grades"."score" IS NULL OR "grades"."score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "submission_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	CONSTRAINT "submission_files_once" UNIQUE("submission_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_changes" ADD CONSTRAINT "grade_changes_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_changes" ADD CONSTRAINT "grade_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_assignment_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."assignment_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessments_offering" ON "assessments" USING btree ("course_offering_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_submissions_one_draft" ON "assignment_submissions" USING btree ("assignment_id","student_id") WHERE status = 'DRAFT';--> statement-breakpoint
CREATE INDEX "assignments_offering" ON "assignments" USING btree ("course_offering_id");--> statement-breakpoint
CREATE INDEX "grades_offering_student" ON "grades" USING btree ("course_offering_id","student_id");