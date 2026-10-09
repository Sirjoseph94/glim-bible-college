CREATE TABLE "award_sequences" (
	"award_type" text NOT NULL,
	"year" integer NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "award_sequences_award_type_year_pk" PRIMARY KEY("award_type","year")
);
--> statement-breakpoint
CREATE TABLE "awards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"programme_enrollment_id" uuid NOT NULL,
	"cgpa_x100" integer NOT NULL,
	"award_class" text,
	"credits_earned_x10" integer NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"awarded_on" date,
	"certificate_no" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"proposed_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "awards_programme_enrollment_id_unique" UNIQUE("programme_enrollment_id"),
	CONSTRAINT "awards_certificate_no_unique" UNIQUE("certificate_no"),
	CONSTRAINT "awards_status_check" CHECK ("awards"."status" IN ('DRAFT', 'APPROVED', 'CONFERRED')),
	CONSTRAINT "awards_conferred_check" CHECK ("awards"."status" <> 'CONFERRED' OR ("awards"."certificate_no" IS NOT NULL AND "awards"."awarded_on" IS NOT NULL AND "awards"."award_class" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_programme_enrollment_id_programme_enrollments_id_fk" FOREIGN KEY ("programme_enrollment_id") REFERENCES "public"."programme_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awards" ADD CONSTRAINT "awards_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;