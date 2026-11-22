-- Module 8 (Stage 8B): download counter of AI Hub skills.
ALTER TABLE "posts" ADD COLUMN "download_count" integer DEFAULT 0 NOT NULL;
