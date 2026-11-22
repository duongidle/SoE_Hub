-- Module 9 (Stage 9C): the sample plan the system builds for each Manager and Leader (one per owner).
ALTER TABLE "onb_plans" ADD COLUMN "builtin" text;--> statement-breakpoint
CREATE UNIQUE INDEX "onb_plans_builtin_uq" ON "onb_plans" ("owner_id", "builtin") WHERE "builtin" IS NOT NULL;
