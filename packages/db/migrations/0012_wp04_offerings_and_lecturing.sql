CREATE TABLE "course_offerings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"section_code" text DEFAULT '01' NOT NULL,
	"title_override" text,
	"capacity" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"completed_at" timestamp with time zone,
	"policy_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "course_offerings_status_check" CHECK ("course_offerings"."status" IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "course_offerings_capacity_check" CHECK ("course_offerings"."capacity" IS NULL OR "course_offerings"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "lecturer_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"lecturer_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"capability_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"starts_on" date,
	"ends_on" date,
	CONSTRAINT "lecturer_assignments_role_check" CHECK ("lecturer_assignments"."role" IN ('PRIMARY', 'CO_LECTURER', 'ASSISTANT', 'GUEST_LECTURER')),
	CONSTRAINT "lecturer_assignments_status_check" CHECK ("lecturer_assignments"."status" IN ('ACTIVE', 'ENDED'))
);
--> statement-breakpoint
CREATE TABLE "lecturers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"staff_code" text,
	"kind" text DEFAULT 'INTERNAL' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"title" text,
	"given_name" text NOT NULL,
	"family_name" text NOT NULL,
	"bio" text,
	CONSTRAINT "lecturers_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "lecturers_staff_code_unique" UNIQUE("staff_code"),
	CONSTRAINT "lecturers_kind_check" CHECK ("lecturers"."kind" IN ('INTERNAL', 'GUEST')),
	CONSTRAINT "lecturers_status_check" CHECK ("lecturers"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturer_assignments" ADD CONSTRAINT "lecturer_assignments_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturer_assignments" ADD CONSTRAINT "lecturer_assignments_lecturer_id_lecturers_id_fk" FOREIGN KEY ("lecturer_id") REFERENCES "public"."lecturers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturers" ADD CONSTRAINT "lecturers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_offerings_course_semester_section" ON "course_offerings" USING btree ("course_id","semester_id","section_code");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_assignment" ON "lecturer_assignments" USING btree ("course_offering_id","lecturer_id") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_primary" ON "lecturer_assignments" USING btree ("course_offering_id") WHERE status = 'ACTIVE' AND role = 'PRIMARY';