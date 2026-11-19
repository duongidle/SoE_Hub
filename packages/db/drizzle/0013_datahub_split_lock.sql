CREATE TABLE "dh_user_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"leader_can_edit" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "allow_edit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "key_split" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "key_columns" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "key_primary" text;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD COLUMN "members_bulk_create" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_user_prefs" ADD CONSTRAINT "dh_user_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_tables" ADD CONSTRAINT "dh_tables_key_cols_chk" CHECK (cardinality("dh_tables"."key_columns") <= 5);