CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"code" "citext" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"credits" numeric(4, 1) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "courses_code_unique" UNIQUE("code"),
	CONSTRAINT "courses_status_check" CHECK ("courses"."status" IN ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "courses_credits_check" CHECK ("courses"."credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "curricula" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"programme_id" uuid NOT NULL,
	"curriculum_version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"min_elective_credits" numeric(4, 1) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	CONSTRAINT "curricula_status_check" CHECK ("curricula"."status" IN ('DRAFT', 'ACTIVE', 'RETIRED')),
	CONSTRAINT "curricula_min_elective_credits_check" CHECK ("curricula"."min_elective_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "curriculum_courses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"level_no" smallint NOT NULL,
	"semester_no" smallint NOT NULL,
	"course_type" text NOT NULL,
	"credit_override" numeric(4, 1),
	CONSTRAINT "curriculum_courses_course_type_check" CHECK ("curriculum_courses"."course_type" IN ('COMPULSORY', 'ELECTIVE')),
	CONSTRAINT "curriculum_courses_semester_no_check" CHECK ("curriculum_courses"."semester_no" IN (1, 2)),
	CONSTRAINT "curriculum_courses_level_no_check" CHECK ("curriculum_courses"."level_no" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE "programmes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"award_type" text NOT NULL,
	"duration_semesters" smallint NOT NULL,
	"levels" smallint NOT NULL,
	"grading_scheme_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "programmes_code_unique" UNIQUE("code"),
	CONSTRAINT "programmes_award_type_check" CHECK ("programmes"."award_type" IN ('CERTIFICATE', 'DIPLOMA')),
	CONSTRAINT "programmes_status_check" CHECK ("programmes"."status" IN ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "programmes_duration_semesters_check" CHECK ("programmes"."duration_semesters" > 0),
	CONSTRAINT "programmes_levels_check" CHECK ("programmes"."levels" BETWEEN 1 AND 4)
);
--> statement-breakpoint
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_courses" ADD CONSTRAINT "curriculum_courses_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curricula"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_courses" ADD CONSTRAINT "curriculum_courses_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "curricula_programme_version" ON "curricula" USING btree ("programme_id","curriculum_version");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_curriculum" ON "curricula" USING btree ("programme_id") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_courses_curriculum_course" ON "curriculum_courses" USING btree ("curriculum_id","course_id");