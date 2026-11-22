-- Module 9 (Stage 9B): common column option "tell the people in column X when this column is edited" (design module9 5).
ALTER TABLE "dh_columns" ADD COLUMN "notify_on_change" jsonb;
