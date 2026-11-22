-- Module 7 (Stage 7A1): forms, published versions, fill drafts, responses (design module7 1, 2.2, 3, 4, 5).
INSERT INTO "users" ("id", "kind", "email", "full_name", "roles", "status")
VALUES ('00000000-0000-7000-8000-000000000f01', 'system', NULL, 'Form công khai', '{}', 'active')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
CREATE TABLE "forms" (
  "id" uuid PRIMARY KEY,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid REFERENCES "users"("id"),
  "version" integer DEFAULT 1 NOT NULL,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid REFERENCES "users"("id"),
  "owner_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "table_id" uuid REFERENCES "dh_tables"("id"),
  "status" text DEFAULT 'draft' NOT NULL,
  "code" text NOT NULL,
  "access" text DEFAULT 'all_accounts' NOT NULL,
  "audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "options" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "notify_new_response" boolean DEFAULT false NOT NULL,
  "draft" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "published_version" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "forms_status_chk" CHECK ("status" IN ('draft', 'open', 'paused', 'closed')),
  CONSTRAINT "forms_access_chk" CHECK ("access" IN ('public', 'all_accounts', 'selected')),
  CONSTRAINT "forms_name_chk" CHECK (char_length("name") BETWEEN 1 AND 200)
);--> statement-breakpoint
CREATE UNIQUE INDEX "forms_code_uq" ON "forms" ("code");--> statement-breakpoint
CREATE INDEX "forms_owner_idx" ON "forms" ("owner_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "forms_table_idx" ON "forms" ("table_id");--> statement-breakpoint
CREATE TABLE "form_versions" (
  "form_id" uuid NOT NULL REFERENCES "forms"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "config" jsonb NOT NULL,
  "published_by" uuid NOT NULL REFERENCES "users"("id"),
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("form_id", "version")
);--> statement-breakpoint
CREATE TABLE "form_drafts" (
  "form_id" uuid NOT NULL REFERENCES "forms"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "form_version" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("form_id", "user_id")
);--> statement-breakpoint
CREATE TABLE "form_responses" (
  "id" uuid PRIMARY KEY,
  "form_id" uuid NOT NULL REFERENCES "forms"("id") ON DELETE CASCADE,
  "form_version" integer NOT NULL,
  "table_id" uuid,
  "row_id" uuid,
  "user_id" uuid REFERENCES "users"("id"),
  "attempt_id" text NOT NULL,
  "ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "form_responses_attempt_uq" ON "form_responses" ("form_id", "attempt_id");--> statement-breakpoint
CREATE INDEX "form_responses_form_idx" ON "form_responses" ("form_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "form_responses_user_idx" ON "form_responses" ("form_id", "user_id");
--> statement-breakpoint
CREATE TABLE "form_uploads" (
  "file_id" uuid PRIMARY KEY REFERENCES "files"("id"),
  "form_id" uuid NOT NULL REFERENCES "forms"("id") ON DELETE CASCADE,
  "attempt_id" text NOT NULL,
  "question_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "form_uploads_attempt_idx" ON "form_uploads" ("form_id", "attempt_id", "question_id");
