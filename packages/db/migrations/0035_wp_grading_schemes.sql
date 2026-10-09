CREATE TABLE "grading_schemes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'NUC_5' NOT NULL,
	"bands" jsonb NOT NULL,
	"class_bands" jsonb NOT NULL,
	"min_award_cgpa_x100" integer DEFAULT 100 NOT NULL,
	"max_points_x100" integer NOT NULL,
	"pass_mark_x100" integer NOT NULL,
	"repeat_policy" text DEFAULT 'BEST' NOT NULL,
	"good_standing_cgpa_x100" integer DEFAULT 100 NOT NULL,
	"probation_cgpa_x100" integer,
	"supersedes_id" uuid,
	"locked_at" timestamp with time zone,
	CONSTRAINT "grading_schemes_name_unique" UNIQUE("name"),
	CONSTRAINT "grading_schemes_kind_check" CHECK ("grading_schemes"."kind" IN ('NUC_5', 'CUSTOM')),
	CONSTRAINT "grading_schemes_repeat_policy_check" CHECK ("grading_schemes"."repeat_policy" IN ('KEEP_ALL', 'REPLACE_LATEST', 'BEST')),
	CONSTRAINT "grading_schemes_max_points_check" CHECK ("grading_schemes"."max_points_x100" BETWEEN 1 AND 1000),
	CONSTRAINT "grading_schemes_pass_mark_check" CHECK ("grading_schemes"."pass_mark_x100" BETWEEN 0 AND 10000),
	CONSTRAINT "grading_schemes_standing_check" CHECK ("grading_schemes"."good_standing_cgpa_x100" >= 0 AND ("grading_schemes"."probation_cgpa_x100" IS NULL OR "grading_schemes"."probation_cgpa_x100" < "grading_schemes"."good_standing_cgpa_x100"))
);
--> statement-breakpoint
ALTER TABLE "grading_schemes" ADD CONSTRAINT "grading_schemes_supersedes_id_grading_schemes_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."grading_schemes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_grading_scheme_id_grading_schemes_id_fk" FOREIGN KEY ("grading_scheme_id") REFERENCES "public"."grading_schemes"("id") ON DELETE restrict ON UPDATE no action;