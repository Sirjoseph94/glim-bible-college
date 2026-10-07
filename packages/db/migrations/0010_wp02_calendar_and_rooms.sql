CREATE TABLE "academic_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	CONSTRAINT "academic_sessions_code_unique" UNIQUE("code"),
	CONSTRAINT "academic_sessions_status_check" CHECK ("academic_sessions"."status" IN ('PLANNED', 'ACTIVE', 'CLOSED')),
	CONSTRAINT "academic_sessions_dates_check" CHECK ("academic_sessions"."ends_on" > "academic_sessions"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "rooms_code_unique" UNIQUE("code"),
	CONSTRAINT "rooms_status_check" CHECK ("rooms"."status" IN ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "rooms_capacity_check" CHECK ("rooms"."capacity" IS NULL OR "rooms"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "semesters" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"academic_session_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"name" text NOT NULL,
	"sequence" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"registration_opens_on" date,
	"registration_closes_on" date,
	"add_drop_deadline_on" date,
	"exams_start_on" date,
	"exams_end_on" date,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	CONSTRAINT "semesters_status_check" CHECK ("semesters"."status" IN ('PLANNED', 'REGISTRATION', 'ACTIVE', 'CLOSED')),
	CONSTRAINT "semesters_dates_check" CHECK ("semesters"."ends_on" > "semesters"."starts_on"),
	CONSTRAINT "semesters_registration_check" CHECK ("semesters"."registration_opens_on" IS NULL OR "semesters"."registration_closes_on" IS NULL OR "semesters"."registration_closes_on" >= "semesters"."registration_opens_on"),
	CONSTRAINT "semesters_exams_check" CHECK (("semesters"."exams_start_on" IS NULL) = ("semesters"."exams_end_on" IS NULL) AND ("semesters"."exams_start_on" IS NULL OR ("semesters"."exams_end_on" >= "semesters"."exams_start_on" AND "semesters"."exams_start_on" >= "semesters"."starts_on" AND "semesters"."exams_end_on" <= "semesters"."ends_on"))),
	CONSTRAINT "semesters_add_drop_check" CHECK ("semesters"."add_drop_deadline_on" IS NULL OR "semesters"."add_drop_deadline_on" BETWEEN "semesters"."starts_on" AND "semesters"."ends_on")
);
--> statement-breakpoint
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "semesters_session_sequence" ON "semesters" USING btree ("academic_session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "semesters_session_code" ON "semesters" USING btree ("academic_session_id","code");