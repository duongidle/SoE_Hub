-- Module 7 (Stage 7A2): the score of a quiz response (design module7 6.4).
CREATE TABLE "form_scores" (
  "response_id" uuid PRIMARY KEY REFERENCES "form_responses"("id") ON DELETE CASCADE,
  "form_id" uuid NOT NULL REFERENCES "forms"("id") ON DELETE CASCADE,
  "form_version" integer NOT NULL,
  "row_id" uuid,
  "user_id" uuid REFERENCES "users"("id"),
  "attempt_no" integer DEFAULT 1 NOT NULL,
  "score" double precision DEFAULT 0 NOT NULL,
  "max_score" double precision DEFAULT 0 NOT NULL,
  "result" text DEFAULT 'none' NOT NULL,
  "floor_failed" boolean DEFAULT false NOT NULL,
  "details" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "comment" text,
  "graded_by" uuid REFERENCES "users"("id"),
  "graded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "form_scores_result_chk" CHECK ("result" IN ('pass', 'fail', 'pending', 'none'))
);--> statement-breakpoint
CREATE INDEX "form_scores_form_idx" ON "form_scores" ("form_id", "result");--> statement-breakpoint
CREATE INDEX "form_scores_user_idx" ON "form_scores" ("form_id", "user_id");
--> statement-breakpoint
-- A table purged from the trash must not be blocked by a form that wrote to it: the form stays, paused ("table deleted"), its responses stay (design module7 1.3).
ALTER TABLE "forms" DROP CONSTRAINT IF EXISTS "forms_table_id_fkey";
