-- Module 6 (Stage 6A2): general announcements (design module6 7, 14).
CREATE TABLE "announcements" (
  "id" uuid PRIMARY KEY,
  "sender_id" uuid NOT NULL REFERENCES "users"("id"),
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "important" boolean NOT NULL DEFAULT false,
  "scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recipient_count" integer NOT NULL DEFAULT 0,
  "recalled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "announcements_title_chk" CHECK (char_length("title") BETWEEN 1 AND 120),
  CONSTRAINT "announcements_body_chk" CHECK (char_length("body") <= 5000)
);--> statement-breakpoint
CREATE INDEX "announcements_sender_idx" ON "announcements" ("sender_id", "created_at" DESC);--> statement-breakpoint
CREATE TABLE "announcement_recipients" (
  "announcement_id" uuid NOT NULL REFERENCES "announcements"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  PRIMARY KEY ("announcement_id", "user_id")
);--> statement-breakpoint
CREATE INDEX "announcement_recipients_user_idx" ON "announcement_recipients" ("user_id");
