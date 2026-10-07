CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by" uuid,
	"revoked_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "role_assignments_role_check" CHECK ("role_assignments"."role" IN ('SYSTEM_ADMIN', 'ADMISSIONS_OFFICER', 'REGISTRAR', 'ACADEMIC_ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"csrf_secret" "bytea" NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_tokens_purpose_check" CHECK ("auth_tokens"."purpose" IN ('INVITE', 'PASSWORD_RESET'))
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" "citext",
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "identities_provider_check" CHECK ("identities"."provider" IN ('google', 'local'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'INVITED' NOT NULL,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"timezone" text,
	"email_status" text DEFAULT 'OK' NOT NULL,
	"referral_code" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code"),
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
	CONSTRAINT "users_email_status_check" CHECK ("users"."email_status" IN ('OK', 'BOUNCED', 'COMPLAINED'))
);
--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_assignments_active" ON "role_assignments" USING btree ("user_id","role") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_active" ON "auth_sessions" USING btree ("user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "auth_tokens_user_open" ON "auth_tokens" USING btree ("user_id","purpose") WHERE used_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_subject" ON "identities" USING btree ("provider","subject");