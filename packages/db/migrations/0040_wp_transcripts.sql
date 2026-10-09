CREATE TABLE "transcript_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"student_id" uuid NOT NULL,
	"programme_enrollment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"purpose" text,
	"recipient_name" text,
	"recipient_email" "citext",
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	CONSTRAINT "transcript_requests_kind_check" CHECK ("transcript_requests"."kind" IN ('UNOFFICIAL', 'OFFICIAL')),
	CONSTRAINT "transcript_requests_status_check" CHECK ("transcript_requests"."status" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'ISSUED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "transcript_sequences" (
	"year" integer PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"student_id" uuid NOT NULL,
	"programme_enrollment_id" uuid NOT NULL,
	"request_id" uuid,
	"kind" text NOT NULL,
	"serial_no" text NOT NULL,
	"verification_code" text NOT NULL,
	"as_of" date NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"file_id" uuid,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "transcripts_serial_no_unique" UNIQUE("serial_no"),
	CONSTRAINT "transcripts_verification_code_unique" UNIQUE("verification_code"),
	CONSTRAINT "transcripts_kind_check" CHECK ("transcripts"."kind" IN ('UNOFFICIAL', 'OFFICIAL')),
	CONSTRAINT "transcripts_status_check" CHECK ("transcripts"."status" IN ('ISSUED', 'REVOKED', 'SUPERSEDED'))
);
--> statement-breakpoint
ALTER TABLE "transcript_requests" ADD CONSTRAINT "transcript_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_requests" ADD CONSTRAINT "transcript_requests_programme_enrollment_id_programme_enrollments_id_fk" FOREIGN KEY ("programme_enrollment_id") REFERENCES "public"."programme_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_requests" ADD CONSTRAINT "transcript_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_programme_enrollment_id_programme_enrollments_id_fk" FOREIGN KEY ("programme_enrollment_id") REFERENCES "public"."programme_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_request_id_transcript_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."transcript_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcript_requests_student" ON "transcript_requests" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "transcript_requests_status" ON "transcript_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "transcripts_student" ON "transcripts" USING btree ("student_id","issued_at");