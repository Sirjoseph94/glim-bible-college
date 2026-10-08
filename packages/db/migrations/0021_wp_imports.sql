CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid NOT NULL,
	"file_sha256" text NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_file_id" uuid,
	"rows_done" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "import_jobs_kind_check" CHECK ("import_jobs"."kind" IN ('STUDENTS', 'LECTURERS', 'COURSE_ENROLLMENTS', 'COURSE_RESULTS')),
	CONSTRAINT "import_jobs_status_check" CHECK ("import_jobs"."status" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_error_file_id_files_id_fk" FOREIGN KEY ("error_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;