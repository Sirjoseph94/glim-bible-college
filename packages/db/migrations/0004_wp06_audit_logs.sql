CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"outcome" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "audit_logs_actor_type_check" CHECK ("audit_logs"."actor_type" IN ('USER', 'SYSTEM', 'JOB', 'PROVIDER')),
	CONSTRAINT "audit_logs_outcome_check" CHECK ("audit_logs"."outcome" IN ('SUCCESS', 'DENIED', 'FAILURE'))
);
--> statement-breakpoint
CREATE INDEX "audit_logs_created_at" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_resource" ON "audit_logs" USING btree ("resource_type","resource_id");