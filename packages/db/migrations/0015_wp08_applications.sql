CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"application_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "application_sequences" (
	"intake_id" uuid PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"intake_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"applicant_user_id" uuid NOT NULL,
	"reference_no" text,
	"study_mode" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"first_name" text,
	"middle_name" text,
	"last_name" text,
	"title" text,
	"title_other" text,
	"gender" text,
	"date_of_birth" date,
	"marital_status" text,
	"nationality" text,
	"occupation" text,
	"email" "citext",
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
	"spiritual_background" jsonb,
	"heard_via" text[] DEFAULT '{}'::text[] NOT NULL,
	"heard_via_other" text,
	"referral_code_entered" text,
	"referrer_user_id" uuid,
	"declaration_full_name" text,
	"statement_of_faith_read" boolean DEFAULT false NOT NULL,
	"declared_at" timestamp with time zone,
	"data_consent_at" timestamp with time zone,
	"admissions_policy_version" integer,
	"photo_file_id" uuid,
	"submitted_at" timestamp with time zone,
	"review_started_at" timestamp with time zone,
	"reviewed_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"offer_expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	CONSTRAINT "applications_reference_no_unique" UNIQUE("reference_no"),
	CONSTRAINT "applications_study_mode_check" CHECK ("applications"."study_mode" IN ('ON_CAMPUS', 'ONLINE')),
	CONSTRAINT "applications_status_check" CHECK ("applications"."status" IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ADMITTED', 'ACCEPTED', 'REJECTED', 'LAPSED', 'WITHDRAWN')),
	CONSTRAINT "applications_title_check" CHECK ("applications"."title" IN ('MR', 'MRS', 'PASTOR', 'REV', 'DR', 'OTHER')),
	CONSTRAINT "applications_gender_check" CHECK ("applications"."gender" IN ('MALE', 'FEMALE')),
	CONSTRAINT "applications_marital_status_check" CHECK ("applications"."marital_status" IN ('SINGLE', 'MARRIED', 'SINGLE_PARENT', 'WIDOWED', 'SEPARATED', 'DIVORCED')),
	CONSTRAINT "applications_heard_via_check" CHECK ("applications"."heard_via" <@ ARRAY['FACEBOOK', 'INSTAGRAM', 'EMAIL', 'SMS', 'BILLBOARD', 'FLYER', 'FRIEND', 'STUDENT', 'ALUMNI', 'STAFF', 'BABIC_CONFERENCE', 'NCGC_MEMBER', 'OTHER']),
	CONSTRAINT "applications_submitted_check" CHECK ("applications"."status" = 'DRAFT' OR ("applications"."reference_no" IS NOT NULL AND "applications"."submitted_at" IS NOT NULL AND "applications"."declared_at" IS NOT NULL AND "applications"."data_consent_at" IS NOT NULL AND "applications"."statement_of_faith_read" AND "applications"."photo_file_id" IS NOT NULL AND "applications"."study_mode" IS NOT NULL)),
	CONSTRAINT "applications_offer_check" CHECK ("applications"."status" <> 'ADMITTED' OR "applications"."offer_expires_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_sequences" ADD CONSTRAINT "application_sequences_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_user_id_users_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_application_idx" ON "application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_application" ON "applications" USING btree ("applicant_user_id","intake_id") WHERE "applications"."status" NOT IN ('REJECTED', 'LAPSED', 'WITHDRAWN');--> statement-breakpoint
CREATE INDEX "applications_intake_status_idx" ON "applications" USING btree ("intake_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "applications_purge_after_idx" ON "applications" USING btree ("purge_after") WHERE "applications"."purge_after" IS NOT NULL;