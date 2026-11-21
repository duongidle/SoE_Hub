DROP INDEX "dh_columns_role_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "dh_columns_role_uq" ON "dh_columns" USING btree ("table_id","role") WHERE "dh_columns"."deleted_at" IS NULL AND "dh_columns"."role" IS NOT NULL AND "dh_columns"."role" <> 'nguoi_tham_gia';
