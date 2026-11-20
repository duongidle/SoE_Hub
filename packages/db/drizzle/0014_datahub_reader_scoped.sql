CREATE TABLE "dh_personal_rows" (
	"row_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "dh_personal_rows_row_id_user_id_pk" PRIMARY KEY("row_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "reader_scoped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_personal_rows" ADD CONSTRAINT "dh_personal_rows_row_id_dh_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."dh_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_personal_rows" ADD CONSTRAINT "dh_personal_rows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_personal_rows" ADD CONSTRAINT "dh_personal_rows_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dh_personal_rows_user_idx" ON "dh_personal_rows" USING btree ("table_id","user_id");