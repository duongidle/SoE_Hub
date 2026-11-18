CREATE TABLE "dh_formula_deps" (
	"column_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"src_table_id" uuid NOT NULL,
	"src_key" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "dh_formula_deps_column_id_src_table_id_src_key_kind_pk" PRIMARY KEY("column_id","src_table_id","src_key","kind"),
	CONSTRAINT "dh_formula_deps_kind_chk" CHECK ("dh_formula_deps"."kind" IN ('cell', 'range'))
);
--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "calc_status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "calc_total" integer;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "calc_done" integer;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "calc_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "calc_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "calc_volatile" text;--> statement-breakpoint
ALTER TABLE "dh_formula_deps" ADD CONSTRAINT "dh_formula_deps_column_id_dh_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."dh_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dh_formula_deps" ADD CONSTRAINT "dh_formula_deps_table_id_dh_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."dh_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dh_formula_deps_src_idx" ON "dh_formula_deps" USING btree ("src_table_id","src_key");--> statement-breakpoint
CREATE INDEX "dh_formula_deps_table_idx" ON "dh_formula_deps" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "dh_columns_calc_idx" ON "dh_columns" USING btree ("calc_status") WHERE "dh_columns"."calc_status" <> 'ready';--> statement-breakpoint
ALTER TABLE "dh_columns" ADD CONSTRAINT "dh_columns_calc_status_chk" CHECK ("dh_columns"."calc_status" IN ('ready', 'pending', 'running'));
--> statement-breakpoint

-- The SQL export view reads a formula, lookup or rollup column by the type of its result.
CREATE OR REPLACE FUNCTION soe_dh_view_expr(p_type text, p_key text, p_config jsonb) RETURNS text
  LANGUAGE plpgsql IMMUTABLE
  AS $$
DECLARE
  d text := format('(data->>%L)', p_key);
  opts text := quote_literal(coalesce(p_config->'options', '[]'::jsonb)::text) || '::jsonb';
BEGIN
  -- Computed columns (stage 2B) are shown like the plain type of their result (`config.result_type`).
  IF p_type IN ('formula', 'lookup', 'rollup') THEN
    p_type := coalesce(p_config->>'result_type', 'text');
  END IF;
  RETURN CASE p_type
    WHEN 'text' THEN d
    WHEN 'long_text' THEN d
    WHEN 'email' THEN d
    WHEN 'phone' THEN d
    WHEN 'url' THEN d
    WHEN 'number' THEN d || '::numeric'
    WHEN 'percent' THEN d || '::numeric'
    WHEN 'currency' THEN d || '::bigint'
    WHEN 'rating' THEN d || '::integer'
    WHEN 'auto_number' THEN d || '::bigint'
    WHEN 'date' THEN format('soe_date(data->>%L)', p_key)
    WHEN 'datetime' THEN format('soe_ts(data->>%L)', p_key)
    WHEN 'checkbox' THEN d || '::boolean'
    WHEN 'single_select' THEN format('(SELECT o->>''name'' FROM jsonb_array_elements(%s) o WHERE o->>''id'' = data->>%L)', opts, p_key)
    WHEN 'multi_select' THEN format('(SELECT string_agg(o->>''name'', '', '') FROM jsonb_array_elements_text(data->%L) e JOIN jsonb_array_elements(%s) o ON o->>''id'' = e)', p_key, opts)
    WHEN 'user' THEN format('(SELECT full_name FROM users WHERE id = (data->>%L)::uuid)', p_key)
    WHEN 'row_id' THEN 'id'
    WHEN 'created_time' THEN 'created_at'
    WHEN 'created_by' THEN '(SELECT full_name FROM users WHERE id = created_by)'
    WHEN 'modified_time' THEN 'updated_at'
    WHEN 'modified_by' THEN '(SELECT full_name FROM users WHERE id = updated_by)'
    ELSE format('data->%L', p_key)
  END;
END
$$;
