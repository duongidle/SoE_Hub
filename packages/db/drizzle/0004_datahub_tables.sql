CREATE TABLE "dh_columns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"table_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"name_norm" text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	"default_value" jsonb,
	"description" text,
	"display" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "dh_columns_name_chk" CHECK (char_length(btrim("dh_columns"."name")) BETWEEN 1 AND 100 AND "dh_columns"."name" !~ '[\[\]]'),
	CONSTRAINT "dh_columns_key_chk" CHECK ("dh_columns"."key" ~ '^[a-z][a-z0-9_]{0,40}$')
);
--> statement-breakpoint
CREATE TABLE "dh_datahubs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_norm" text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
	"description" text,
	CONSTRAINT "dh_datahubs_name_chk" CHECK (char_length(btrim("dh_datahubs"."name")) BETWEEN 1 AND 100 AND "dh_datahubs"."name" !~ '[\[\]]')
);
--> statement-breakpoint
CREATE TABLE "dh_index_requests" (
	"table_id" uuid NOT NULL,
	"column_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"note" text,
	"rows_at_request" bigint,
	CONSTRAINT "dh_index_requests_table_id_column_key_kind_pk" PRIMARY KEY("table_id","column_key","kind")
);
--> statement-breakpoint
CREATE TABLE "dh_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"table_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dh_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"datahub_id" uuid NOT NULL,
	"table_id" uuid,
	"grantee_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dh_shares_permission_chk" CHECK ("dh_shares"."permission" IN ('view', 'edit_data'))
);
--> statement-breakpoint
CREATE TABLE "dh_table_state" (
	"table_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_view_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dh_table_state_table_id_user_id_pk" PRIMARY KEY("table_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "dh_tables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"datahub_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_norm" text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"next_row_no" integer DEFAULT 1 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"sql_view" text,
	CONSTRAINT "dh_tables_name_chk" CHECK (char_length(btrim("dh_tables"."name")) BETWEEN 1 AND 100 AND "dh_tables"."name" !~ '[\[\]]')
);
--> statement-breakpoint
CREATE TABLE "dh_user_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"max_datahubs" integer,
	"max_tables" integer,
	"max_columns" integer,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dh_view_overrides" (
	"view_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dh_view_overrides_view_id_user_id_pk" PRIMARY KEY("view_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "dh_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"table_id" uuid NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"kind" text DEFAULT 'grid' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dh_columns" ADD CONSTRAINT "dh_columns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD CONSTRAINT "dh_columns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD CONSTRAINT "dh_columns_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD CONSTRAINT "dh_columns_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_datahubs" ADD CONSTRAINT "dh_datahubs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_datahubs" ADD CONSTRAINT "dh_datahubs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_datahubs" ADD CONSTRAINT "dh_datahubs_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_datahubs" ADD CONSTRAINT "dh_datahubs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_index_requests" ADD CONSTRAINT "dh_index_requests_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_rows" ADD CONSTRAINT "dh_rows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_rows" ADD CONSTRAINT "dh_rows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_rows" ADD CONSTRAINT "dh_rows_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_rows" ADD CONSTRAINT "dh_rows_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_shares" ADD CONSTRAINT "dh_shares_datahub_id_dh_datahubs_id_fk" FOREIGN KEY ("datahub_id") REFERENCES "public"."dh_datahubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_shares" ADD CONSTRAINT "dh_shares_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_shares" ADD CONSTRAINT "dh_shares_grantee_id_users_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_shares" ADD CONSTRAINT "dh_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_table_state" ADD CONSTRAINT "dh_table_state_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_table_state" ADD CONSTRAINT "dh_table_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_table_state" ADD CONSTRAINT "dh_table_state_last_view_id_dh_views_id_fk" FOREIGN KEY ("last_view_id") REFERENCES "public"."dh_views"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD CONSTRAINT "dh_tables_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD CONSTRAINT "dh_tables_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD CONSTRAINT "dh_tables_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD CONSTRAINT "dh_tables_datahub_id_dh_datahubs_id_fk" FOREIGN KEY ("datahub_id") REFERENCES "public"."dh_datahubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_user_limits" ADD CONSTRAINT "dh_user_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_user_limits" ADD CONSTRAINT "dh_user_limits_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_view_overrides" ADD CONSTRAINT "dh_view_overrides_view_id_dh_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."dh_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_view_overrides" ADD CONSTRAINT "dh_view_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_views" ADD CONSTRAINT "dh_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_views" ADD CONSTRAINT "dh_views_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_views" ADD CONSTRAINT "dh_views_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_views" ADD CONSTRAINT "dh_views_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_views" ADD CONSTRAINT "dh_views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dh_columns_key_uq" ON "dh_columns" USING btree ("table_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "dh_columns_name_uq" ON "dh_columns" USING btree ("table_id","name_norm") WHERE "dh_columns"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "dh_columns_table_idx" ON "dh_columns" USING btree ("table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dh_datahubs_owner_name_uq" ON "dh_datahubs" USING btree ("owner_id","name_norm") WHERE "dh_datahubs"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "dh_datahubs_owner_idx" ON "dh_datahubs" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dh_rows_table_row_no_uq" ON "dh_rows" USING btree ("table_id","row_no");--> statement-breakpoint
CREATE INDEX "dh_rows_deleted_idx" ON "dh_rows" USING btree ("table_id","deleted_at") WHERE "dh_rows"."deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dh_shares_datahub_uq" ON "dh_shares" USING btree ("datahub_id","grantee_id") WHERE "dh_shares"."table_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dh_shares_table_uq" ON "dh_shares" USING btree ("table_id","grantee_id") WHERE "dh_shares"."table_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dh_shares_grantee_idx" ON "dh_shares" USING btree ("grantee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dh_tables_name_uq" ON "dh_tables" USING btree ("datahub_id","name_norm") WHERE "dh_tables"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "dh_tables_datahub_idx" ON "dh_tables" USING btree ("datahub_id");--> statement-breakpoint
CREATE INDEX "dh_views_table_idx" ON "dh_views" USING btree ("table_id");