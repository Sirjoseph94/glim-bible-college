CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"code" "citext" NOT NULL,
	"academic_session_id" uuid NOT NULL,
	"opens_on" date NOT NULL,
	"closes_on" date NOT NULL,
	"offer_acceptance_days" integer DEFAULT 21 NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	CONSTRAINT "intakes_code_unique" UNIQUE("code"),
	CONSTRAINT "intakes_academic_session_id_unique" UNIQUE("academic_session_id"),
	CONSTRAINT "intakes_status_check" CHECK ("intakes"."status" IN ('PLANNED', 'OPEN', 'CLOSED')),
	CONSTRAINT "intakes_dates_check" CHECK ("intakes"."closes_on" > "intakes"."opens_on"),
	CONSTRAINT "intakes_offer_acceptance_days_check" CHECK ("intakes"."offer_acceptance_days" > 0)
);
--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_academic_session_id_academic_sessions_id_fk" FOREIGN KEY ("academic_session_id") REFERENCES "public"."academic_sessions"("id") ON DELETE restrict ON UPDATE no action;