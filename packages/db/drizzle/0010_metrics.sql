CREATE TABLE "mt_charts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"dashboard_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mt_dashboards" (
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
	"position" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "mt_dashboards_name_chk" CHECK (char_length(btrim("mt_dashboards"."name")) BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "mt_metrics" (
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
	"config" jsonb NOT NULL,
	"table_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "mt_metrics_name_chk" CHECK (char_length(btrim("mt_metrics"."name")) BETWEEN 1 AND 100 AND "mt_metrics"."name" !~ '[\[\]]')
);
--> statement-breakpoint
CREATE TABLE "mt_sources" (
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
	"config" jsonb NOT NULL,
	"table_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "mt_sources_name_chk" CHECK (char_length(btrim("mt_sources"."name")) BETWEEN 1 AND 100 AND "mt_sources"."name" !~ '[\[\]]')
);
--> statement-breakpoint
ALTER TABLE "mt_charts" ADD CONSTRAINT "mt_charts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_charts" ADD CONSTRAINT "mt_charts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_charts" ADD CONSTRAINT "mt_charts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_charts" ADD CONSTRAINT "mt_charts_dashboard_id_mt_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."mt_dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_dashboards" ADD CONSTRAINT "mt_dashboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_dashboards" ADD CONSTRAINT "mt_dashboards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_dashboards" ADD CONSTRAINT "mt_dashboards_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_dashboards" ADD CONSTRAINT "mt_dashboards_datahub_id_dh_datahubs_id_fk" FOREIGN KEY ("datahub_id") REFERENCES "public"."dh_datahubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_metrics" ADD CONSTRAINT "mt_metrics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_metrics" ADD CONSTRAINT "mt_metrics_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_metrics" ADD CONSTRAINT "mt_metrics_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_metrics" ADD CONSTRAINT "mt_metrics_datahub_id_dh_datahubs_id_fk" FOREIGN KEY ("datahub_id") REFERENCES "public"."dh_datahubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_sources" ADD CONSTRAINT "mt_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_sources" ADD CONSTRAINT "mt_sources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_sources" ADD CONSTRAINT "mt_sources_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt_sources" ADD CONSTRAINT "mt_sources_datahub_id_dh_datahubs_id_fk" FOREIGN KEY ("datahub_id") REFERENCES "public"."dh_datahubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mt_charts_dashboard_idx" ON "mt_charts" USING btree ("dashboard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mt_dashboards_name_uq" ON "mt_dashboards" USING btree ("datahub_id","name_norm") WHERE "mt_dashboards"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mt_dashboards_datahub_idx" ON "mt_dashboards" USING btree ("datahub_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mt_metrics_name_uq" ON "mt_metrics" USING btree ("datahub_id","name_norm") WHERE "mt_metrics"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mt_metrics_datahub_idx" ON "mt_metrics" USING btree ("datahub_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mt_sources_name_uq" ON "mt_sources" USING btree ("datahub_id","name_norm") WHERE "mt_sources"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mt_sources_datahub_idx" ON "mt_sources" USING btree ("datahub_id");