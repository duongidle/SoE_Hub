CREATE TABLE "dh_merge_rows" (
	"table_id" uuid NOT NULL,
	"ident" text NOT NULL,
	"row_id" uuid NOT NULL,
	"source_table_id" uuid NOT NULL,
	"source_row_id" uuid NOT NULL,
	CONSTRAINT "dh_merge_rows_table_id_ident_pk" PRIMARY KEY("table_id","ident")
);
--> statement-breakpoint
CREATE TABLE "dh_merges" (
	"table_id" uuid PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"source_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" jsonb,
	"diagnostics" jsonb,
	"request_seq" bigint DEFAULT 1 NOT NULL,
	"synced_seq" bigint DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "dh_merges_status_chk" CHECK ("dh_merges"."status" IN ('pending', 'ok', 'error'))
);
--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "kind" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_merge_rows" ADD CONSTRAINT "dh_merge_rows_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_merges" ADD CONSTRAINT "dh_merges_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dh_merge_rows_row_uq" ON "dh_merge_rows" USING btree ("row_id");--> statement-breakpoint
CREATE INDEX "dh_merges_sources_idx" ON "dh_merges" USING gin ("source_ids");--> statement-breakpoint
CREATE INDEX "dh_merges_pending_idx" ON "dh_merges" USING btree ("request_seq") WHERE "dh_merges"."request_seq" > "dh_merges"."synced_seq";--> statement-breakpoint
ALTER TABLE "dh_tables" ADD CONSTRAINT "dh_tables_kind_chk" CHECK ("dh_tables"."kind" IN ('normal', 'merged'));