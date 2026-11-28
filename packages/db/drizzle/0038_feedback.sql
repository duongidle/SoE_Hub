-- Stage 11A: feedback (design module11): one row per message of a person, plus the two-way thread.
CREATE TABLE "feedback" (
  "id" uuid PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "users"("id"),
  "version" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id"),
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "kind" text NOT NULL,
  "body" text NOT NULL,
  "file_ids" uuid[] NOT NULL DEFAULT '{}',
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'new'
);
CREATE INDEX "feedback_inbox_idx" ON "feedback" ("status", "created_at" DESC, "id" DESC);
CREATE INDEX "feedback_author_idx" ON "feedback" ("author_id", "created_at" DESC, "id" DESC);

CREATE TABLE "feedback_messages" (
  "id" uuid PRIMARY KEY,
  "feedback_id" uuid NOT NULL REFERENCES "feedback"("id"),
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "feedback_messages_idx" ON "feedback_messages" ("feedback_id", "created_at", "id");
