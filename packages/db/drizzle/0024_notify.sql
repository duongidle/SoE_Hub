-- Module 6 (Stage 6A1): one door for notifications, user settings, reminders.
ALTER TABLE "notifications" ADD COLUMN "category" text NOT NULL DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "priority" text NOT NULL DEFAULT 'normal';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "object_type" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "object_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "actor_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "via" text;--> statement-breakpoint
CREATE INDEX "notifications_category_idx" ON "notifications" ("user_id", "category", "created_at" DESC);--> statement-breakpoint
CREATE TABLE "notification_settings" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id"),
  "disabled_types" text[] NOT NULL DEFAULT '{}'::text[],
  "morning_digest" boolean NOT NULL DEFAULT true,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE "reminders" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "content" text NOT NULL,
  "due_at" timestamptz NOT NULL,
  "repeat" text NOT NULL DEFAULT 'none',
  "weekdays" integer[] NOT NULL DEFAULT '{}'::integer[],
  "anchor_day" integer NOT NULL DEFAULT 1,
  "until_date" date,
  "object_type" text,
  "object_id" text,
  "status" text NOT NULL DEFAULT 'pending',
  "last_fired_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reminders_repeat_chk" CHECK ("repeat" IN ('none', 'daily', 'weekly', 'monthly')),
  CONSTRAINT "reminders_status_chk" CHECK ("status" IN ('pending', 'fired', 'done'))
);--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" ("due_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" ("user_id", "status", "due_at");
