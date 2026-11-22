-- Module 9 (Stage 9A): onboarding plans, their structure (stages, weeks, items) and the dated occurrences of the items for the assigned person.
CREATE TABLE "onb_plans" (
  "id" uuid PRIMARY KEY,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid REFERENCES "users"("id"),
  "version" integer DEFAULT 1 NOT NULL,
  "owner_id" uuid NOT NULL REFERENCES "users"("id"),
  "tree_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "is_template" boolean DEFAULT false NOT NULL,
  "staff_id" uuid REFERENCES "users"("id"),
  "start_date" date,
  "followers" uuid[] DEFAULT '{}' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "stop_reason" text,
  "ended_at" timestamp with time zone,
  "source_plan_id" uuid,
  CONSTRAINT "onb_plans_status_chk" CHECK ("status" IN ('draft', 'active', 'completed', 'stopped'))
);--> statement-breakpoint
CREATE UNIQUE INDEX "onb_plans_one_active_idx" ON "onb_plans" ("staff_id") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "onb_plans_owner_idx" ON "onb_plans" ("owner_id", "updated_at" DESC);--> statement-breakpoint
CREATE INDEX "onb_plans_staff_idx" ON "onb_plans" ("staff_id");--> statement-breakpoint
CREATE TABLE "onb_stages" (
  "id" uuid PRIMARY KEY,
  "plan_id" uuid NOT NULL REFERENCES "onb_plans"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "position" integer NOT NULL
);--> statement-breakpoint
CREATE INDEX "onb_stages_plan_idx" ON "onb_stages" ("plan_id", "position");--> statement-breakpoint
CREATE TABLE "onb_weeks" (
  "id" uuid PRIMARY KEY,
  "plan_id" uuid NOT NULL REFERENCES "onb_plans"("id") ON DELETE CASCADE,
  "stage_id" uuid REFERENCES "onb_stages"("id") ON DELETE SET NULL,
  "week_no" integer NOT NULL,
  "name" text NOT NULL,
  "goal" text,
  UNIQUE ("plan_id", "week_no")
);--> statement-breakpoint
CREATE TABLE "onb_items" (
  "id" uuid PRIMARY KEY,
  "plan_id" uuid NOT NULL REFERENCES "onb_plans"("id") ON DELETE CASCADE,
  "week_no" integer NOT NULL,
  "position" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "kind" text DEFAULT 'other' NOT NULL,
  "weekday" integer DEFAULT 1 NOT NULL,
  "repeat" text DEFAULT 'once' NOT NULL,
  "until_week_no" integer,
  "due_time" text,
  "remind_before_min" integer,
  "form_id" uuid,
  "need_form" boolean DEFAULT false NOT NULL,
  "share_table" boolean DEFAULT false NOT NULL,
  "filler_column" text,
  "leader_columns" text[] DEFAULT '{}' NOT NULL,
  "link" text,
  CONSTRAINT "onb_items_weekday_chk" CHECK ("weekday" BETWEEN 1 AND 7),
  CONSTRAINT "onb_items_repeat_chk" CHECK ("repeat" IN ('once', 'daily_workdays', 'weekly'))
);--> statement-breakpoint
CREATE INDEX "onb_items_plan_idx" ON "onb_items" ("plan_id", "week_no", "position");--> statement-breakpoint
CREATE TABLE "onb_occurrences" (
  "id" uuid PRIMARY KEY,
  "plan_id" uuid NOT NULL REFERENCES "onb_plans"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "onb_items"("id") ON DELETE CASCADE,
  "on_date" date NOT NULL,
  "due_at" timestamp with time zone,
  "done_at" timestamp with time zone,
  "done_by" uuid REFERENCES "users"("id"),
  UNIQUE ("item_id", "on_date")
);--> statement-breakpoint
CREATE INDEX "onb_occ_plan_idx" ON "onb_occurrences" ("plan_id", "on_date");
