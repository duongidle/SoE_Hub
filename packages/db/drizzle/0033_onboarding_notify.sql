-- Module 9 (Stage 9C): a checkpoint that turned Đạt is told to the leader once; a checkpoint has a column group on the follow-up page; a week can be a break week.
ALTER TABLE "onb_checkpoints" ADD COLUMN "passed_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onb_checkpoints" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "onb_weeks" ADD COLUMN "is_break" boolean DEFAULT false NOT NULL;
