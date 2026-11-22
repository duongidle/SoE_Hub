-- Module 9 (Stage 9B): checkpoints of a plan (conditions as JSON, computed when read), final result of a finished plan.
CREATE TABLE "onb_checkpoints" (
  "id" uuid PRIMARY KEY,
  "plan_id" uuid NOT NULL REFERENCES "onb_plans"("id") ON DELETE CASCADE,
  "week_no" integer,
  "position" integer NOT NULL,
  "name" text NOT NULL,
  "is_final" boolean DEFAULT false NOT NULL,
  "conditions" jsonb DEFAULT '[]' NOT NULL,
  "confirmed_at" timestamp with time zone,
  "confirmed_by" uuid REFERENCES "users"("id")
);--> statement-breakpoint
CREATE INDEX "onb_checkpoints_plan_idx" ON "onb_checkpoints" ("plan_id", "position");--> statement-breakpoint
ALTER TABLE "onb_plans" ADD COLUMN "final_result" text;--> statement-breakpoint
ALTER TABLE "onb_plans" ADD COLUMN "final_note" text;--> statement-breakpoint
ALTER TABLE "onb_plans" ADD COLUMN "finished_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "onb_plans" ADD CONSTRAINT "onb_plans_final_chk" CHECK ("final_result" IS NULL OR "final_result" IN ('passed', 'failed'));
