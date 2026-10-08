CREATE TABLE "cohorts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"programme_id" uuid NOT NULL,
	"intake_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "cohorts_programme_intake" UNIQUE("programme_id","intake_id"),
	CONSTRAINT "cohorts_programme_code" UNIQUE("programme_id","code"),
	CONSTRAINT "cohorts_status_check" CHECK ("cohorts"."status" IN ('ACTIVE', 'CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "matric_sequences" (
	"programme_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "matric_sequences_programme_id_year_pk" PRIMARY KEY("programme_id","year")
);
--> statement-breakpoint
CREATE TABLE "programme_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"student_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"intake_id" uuid,
	"cohort_id" uuid,
	"entry_session_id" uuid NOT NULL,
	"application_id" uuid,
	"matric_number" text NOT NULL,
	"study_mode" text NOT NULL,
	"current_level" smallint DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	CONSTRAINT "programme_enrollments_application_id_unique" UNIQUE("application_id"),
	CONSTRAINT "programme_enrollments_matric_number_unique" UNIQUE("matric_number"),
	CONSTRAINT "programme_enrollments_study_mode_check" CHECK ("programme_enrollments"."study_mode" IN ('ON_CAMPUS', 'ONLINE')),
	CONSTRAINT "programme_enrollments_status_check" CHECK ("programme_enrollments"."status" IN ('ACTIVE', 'DEFERRED', 'WITHDRAWN', 'COMPLETED'))
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"title" text,
	"given_name" text NOT NULL,
	"middle_name" text,
	"family_name" text NOT NULL,
	"gender" text,
	"date_of_birth" date,
	"nationality" text,
	"phone_whatsapp" text,
	"alt_phone_whatsapp" text,
	"country" text,
	"state_province" text,
	"city" text,
	"postcode" text,
	"address" text,
	"church_name" text,
	"church_address" text,
	"pastor_name" text,
	"pastor_phone" text,
	"photo_file_id" uuid,
	CONSTRAINT "students_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "students_status_check" CHECK ("students"."status" IN ('ACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN')),
	CONSTRAINT "students_gender_check" CHECK ("students"."gender" IN ('MALE', 'FEMALE'))
);
--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matric_sequences" ADD CONSTRAINT "matric_sequences_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_enrollments" ADD CONSTRAINT "programme_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_enrollments" ADD CONSTRAINT "programme_enrollments_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_enrollments" ADD CONSTRAINT "programme_enrollments_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_enrollments" ADD CONSTRAINT "programme_enrollments_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_enrollments" ADD CONSTRAINT "programme_enrollments_cohort_id_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_enrollments" ADD CONSTRAINT "programme_enrollments_entry_session_id_academic_sessions_id_fk" FOREIGN KEY ("entry_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_enrollments" ADD CONSTRAINT "programme_enrollments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_programme_enrollment" ON "programme_enrollments" USING btree ("student_id","programme_id") WHERE "programme_enrollments"."status" = 'ACTIVE';