CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"qtype" text NOT NULL,
	"prompt_md" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_points" numeric(6, 2) DEFAULT '1' NOT NULL,
	"explanation_md" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "questions_qtype_check" CHECK ("questions"."qtype" IN ('MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'SHORT_TEXT', 'ESSAY')),
	CONSTRAINT "questions_status_check" CHECK ("questions"."status" IN ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "questions_default_points_check" CHECK ("questions"."default_points" > 0)
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"quiz_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"question_snapshot" jsonb NOT NULL,
	"auto_score" numeric(7, 2),
	"manual_score" numeric(7, 2),
	"score" numeric(7, 2),
	"last_seq" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "quiz_attempts_attempt" UNIQUE("quiz_id","student_id","attempt_no"),
	CONSTRAINT "quiz_attempts_status_check" CHECK ("quiz_attempts"."status" IN ('IN_PROGRESS', 'SUBMITTED', 'GRADED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"quiz_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"points" numeric(6, 2) NOT NULL,
	CONSTRAINT "quiz_questions_once" UNIQUE("quiz_id","question_id"),
	CONSTRAINT "quiz_questions_points_check" CHECK ("quiz_questions"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "quiz_responses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"attempt_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"response" jsonb,
	"is_correct" boolean,
	"points_awarded" numeric(6, 2),
	"grader_comment" text,
	CONSTRAINT "quiz_responses_once" UNIQUE("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions_md" text,
	"time_limit_minutes" integer,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"attempt_scoring" text DEFAULT 'HIGHEST' NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"shuffle_questions" boolean DEFAULT false NOT NULL,
	"show_answers" text DEFAULT 'AFTER_CLOSE' NOT NULL,
	"eligible_study_mode" text DEFAULT 'ALL' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	CONSTRAINT "quizzes_assessment_id_unique" UNIQUE("assessment_id"),
	CONSTRAINT "quizzes_attempt_scoring_check" CHECK ("quizzes"."attempt_scoring" IN ('HIGHEST', 'LAST', 'AVERAGE')),
	CONSTRAINT "quizzes_show_answers_check" CHECK ("quizzes"."show_answers" IN ('NEVER', 'AFTER_ATTEMPT', 'AFTER_CLOSE')),
	CONSTRAINT "quizzes_eligible_study_mode_check" CHECK ("quizzes"."eligible_study_mode" IN ('ALL', 'ONLINE')),
	CONSTRAINT "quizzes_status_check" CHECK ("quizzes"."status" IN ('DRAFT', 'PUBLISHED', 'CLOSED')),
	CONSTRAINT "quizzes_max_attempts_check" CHECK ("quizzes"."max_attempts" BETWEEN 1 AND 10),
	CONSTRAINT "quizzes_time_limit_check" CHECK ("quizzes"."time_limit_minutes" IS NULL OR "quizzes"."time_limit_minutes" BETWEEN 1 AND 600),
	CONSTRAINT "quizzes_window_check" CHECK ("quizzes"."opens_at" IS NULL OR "quizzes"."closes_at" IS NULL OR "quizzes"."closes_at" > "quizzes"."opens_at")
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_responses" ADD CONSTRAINT "quiz_responses_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_course_offering_id_course_offerings_id_fk" FOREIGN KEY ("course_offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "questions_course" ON "questions" USING btree ("course_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_attempts_one_in_progress" ON "quiz_attempts" USING btree ("quiz_id","student_id") WHERE status = 'IN_PROGRESS';--> statement-breakpoint
CREATE INDEX "quizzes_offering" ON "quizzes" USING btree ("course_offering_id");