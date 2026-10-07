CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"policy_type" text NOT NULL,
	"scope_type" text DEFAULT 'INSTITUTION' NOT NULL,
	"scope_id" uuid,
	"policy_version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "policies_policy_type_check" CHECK ("policies"."policy_type" IN ('ATTENDANCE', 'RECORDING', 'JOIN_WINDOW', 'GOOGLE_MEET', 'RETENTION', 'GRADING_DEFAULTS', 'NOTIFICATION', 'ADMISSIONS')),
	CONSTRAINT "policies_scope_type_check" CHECK ("policies"."scope_type" IN ('INSTITUTION', 'COURSE_OFFERING')),
	CONSTRAINT "policies_scope_check" CHECK (("policies"."scope_type" = 'INSTITUTION') = ("policies"."scope_id" IS NULL))
);
