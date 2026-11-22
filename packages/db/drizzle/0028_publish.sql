-- Module 8 (Stage 8A): the shared "post" engine (Knowledge articles now, AI Hub skills in 8B): posts, versions, search.
-- Text search config: `simple` + `unaccent`, so a query without accents finds accented text and headlines keep the original text.
CREATE TEXT SEARCH CONFIGURATION soe_simple (COPY = simple);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION soe_simple ALTER MAPPING FOR hword, hword_part, word WITH public.unaccent, simple;--> statement-breakpoint
CREATE TABLE "posts" (
  "id" uuid PRIMARY KEY,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid REFERENCES "users"("id"),
  "version" integer DEFAULT 1 NOT NULL,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid REFERENCES "users"("id"),
  "kind" text NOT NULL,
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "status" text DEFAULT 'draft' NOT NULL,
  "archived_at" timestamp with time zone,
  "published_version" integer,
  "last_version" integer DEFAULT 1 NOT NULL,
  "view_count" integer DEFAULT 0 NOT NULL,
  "first_published_at" timestamp with time zone,
  "live_at" timestamp with time zone,
  "live_title" text,
  "live_summary" text,
  "live_tags" text[] DEFAULT '{}' NOT NULL,
  "live_text" text,
  "live_facets" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "tsv" tsvector,
  CONSTRAINT "posts_status_chk" CHECK ("status" IN ('draft', 'pending', 'returned', 'published'))
);--> statement-breakpoint
CREATE INDEX "posts_author_idx" ON "posts" ("author_id", "kind", "updated_at" DESC);--> statement-breakpoint
CREATE INDEX "posts_kind_status_idx" ON "posts" ("kind", "status", "archived_at");--> statement-breakpoint
CREATE INDEX "posts_tsv_idx" ON "posts" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "posts_live_title_trgm_idx" ON "posts" USING gin (soe_unaccent(lower("live_title")) gin_trgm_ops);--> statement-breakpoint
CREATE TABLE "post_versions" (
  "post_id" uuid NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "status" text NOT NULL,
  "content" jsonb NOT NULL,
  "title" text NOT NULL DEFAULT '',
  "summary" text NOT NULL DEFAULT '',
  "text_content" text NOT NULL DEFAULT '',
  "check_result" jsonb NOT NULL DEFAULT '{"errors":[],"warnings":[]}'::jsonb,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "submitted_at" timestamp with time zone,
  "decided_by" uuid REFERENCES "users"("id"),
  "decided_at" timestamp with time zone,
  "decided_via" text,
  "return_reason" text,
  "published_at" timestamp with time zone,
  "self_published" boolean DEFAULT false NOT NULL,
  PRIMARY KEY ("post_id", "version"),
  CONSTRAINT "post_versions_status_chk" CHECK ("status" IN ('draft', 'pending', 'returned', 'published', 'superseded', 'withdrawn'))
);--> statement-breakpoint
CREATE INDEX "post_versions_pending_idx" ON "post_versions" ("status", "submitted_at") WHERE "status" = 'pending';
