ALTER TABLE "auth_tokens" DROP CONSTRAINT "auth_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;