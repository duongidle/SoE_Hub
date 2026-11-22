-- Module 5: a personal token becomes a connection with menus and levels (`{menu: "read"|"write"|"full"}`) instead of string scopes.
-- `scopes` stays for service-account tokens only. Existing personal tokens (dev data only) get the default menus and go back to `pending`.
ALTER TABLE "api_tokens" ADD COLUMN "menus" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
UPDATE "api_tokens" SET "menus" = '{"deal":"write","datahub":"write","notify":"write","form":"read","knowledge":"read","aihub":"read","workspace":"read","feedback":"read"}'::jsonb, "status" = CASE WHEN "status" = 'active' THEN 'pending' ELSE "status" END, "scopes" = '{}'::text[] WHERE "kind" = 'personal';
