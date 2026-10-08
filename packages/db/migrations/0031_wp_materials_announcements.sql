CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"class_meeting_id" uuid,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "course_materials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"section_label" text,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid,
	"url" text,
	"body_md" text,
	"visibility" text DEFAULT 'ENROLLED' NOT NULL,
	"publish_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid,
	CONSTRAINT "course_materials_kind_check" CHECK ("course_materials"."kind" IN ('FILE', 'LINK', 'TEXT')),
	CONSTRAINT "course_materials_visibility_check" CHECK ("course_materials"."visibility" IN ('ENROLLED', 'STAFF_ONLY')),
	CONSTRAINT "course_materials_status_check" CHECK ("course_materials"."status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
	CONSTRAINT "course_materials_kind_fields" CHECK (("course_materials"."kind" = 'FILE' AND "course_materials"."file_id" IS NOT NULL)
        OR ("course_materials"."kind" = 'LINK' AND "course_materials"."url" IS NOT NULL)
        OR ("course_materials"."kind" = 'TEXT' AND "course_materials"."body_md" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "upload_id" text;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_class_meeting_id_class_meetings_id_fk" FOREIGN KEY ("class_meeting_id") REFERENCES "public"."class_meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_offering" ON "announcements" USING btree ("course_offering_id","published_at");--> statement-breakpoint
CREATE INDEX "course_materials_offering" ON "course_materials" USING btree ("course_offering_id","status","position");