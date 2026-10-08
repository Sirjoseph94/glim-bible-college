CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"email_status" text DEFAULT 'NOT_REQUESTED' NOT NULL,
	"dedupe_key" text,
	CONSTRAINT "notifications_user_dedupe" UNIQUE("user_id","dedupe_key"),
	CONSTRAINT "notifications_email_status_check" CHECK ("notifications"."email_status" IN ('NOT_REQUESTED', 'PENDING', 'SENT', 'FAILED', 'SUPPRESSED'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_user_operation_key" UNIQUE("user_id","operation","key"),
	CONSTRAINT "idempotency_keys_status_check" CHECK ("idempotency_keys"."status" IN ('IN_PROGRESS', 'COMPLETED'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);