CREATE SEQUENCE "public"."dh_change_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "dh_change_queue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"column_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"mode" text NOT NULL,
	"row_ids" uuid[],
	"keys" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dh_change_queue_mode_chk" CHECK ("dh_change_queue"."mode" IN ('rows', 'linked', 'keys', 'full'))
);
--> statement-breakpoint
ALTER TABLE "dh_columns" ADD COLUMN "calc_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dh_change_queue" ADD CONSTRAINT "dh_change_queue_column_id_dh_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."dh_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dh_change_queue_col_idx" ON "dh_change_queue" USING btree ("column_id","id");--> statement-breakpoint
CREATE INDEX "dh_change_queue_seq_idx" ON "dh_change_queue" USING btree ("seq");
--> statement-breakpoint
-- Partial recalculation (design module2 section 6.7).
-- 1. `soe_numtext` / `soe_eqk`: the SQL twin of the formula engine's `equalityKey` (numbers and numeric text share a key,
--    text is case-insensitive, TRUE/FALSE text is a boolean, blank is `b:`). Used to find the rows of a group (rows whose
--    key equals a changed key) with an index. Both sides of a comparison go through the same function, so a number is
--    never compared as text of a different format. The result is only used to pick CANDIDATE rows: recomputing a candidate
--    that turns out not to match is harmless, so the functions may be a little wider than `equalityKey`, never narrower.
CREATE OR REPLACE FUNCTION soe_numtext(t text) RETURNS float8
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
DECLARE s text;
BEGIN
  IF t IS NULL OR length(t) > 60 THEN RETURN NULL; END IF;
  s := regexp_replace(t, '^\s+|\s+$', '', 'g');
  IF s = '' THEN RETURN NULL; END IF;
  IF s ~* '^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d{1,2})?$' THEN RETURN s::float8; END IF;
  IF s ~ '^[+-]?(\d+\.?\d*|\.\d+)\s*%$' THEN RETURN regexp_replace(s, '\s*%$', '')::float8 / 100; END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION soe_eqk(v jsonb) RETURNS text
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  AS $$
DECLARE
  t text;
  n float8;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) = 'null' THEN RETURN 'b:'; END IF;
  CASE jsonb_typeof(v)
    WHEN 'number' THEN RETURN 'n:' || ((v #>> '{}')::float8)::text;
    WHEN 'boolean' THEN RETURN 't:' || (v #>> '{}');
    WHEN 'string' THEN
      t := v #>> '{}';
      n := public.soe_numtext(t);  -- schema-qualified: an index build runs with a minimal search_path
      IF n IS NOT NULL THEN RETURN 'n:' || n::text; END IF;
      IF upper(t) IN ('TRUE', 'FALSE') THEN RETURN 't:' || lower(t); END IF;
      RETURN 's:' || lower(t);
    ELSE RETURN 'x:' || v::text;
  END CASE;
END
$$;
--> statement-breakpoint

-- 2. Two more automatic index kinds: `rel` = GIN on a Relation column (reverse lookup "which rows link to row X",
--    jsonb `?|`), `eqk` = btree on the equality key (finds the rows of a group). Same rules as the others: partial index
--    on one table's live rows, created by this SECURITY DEFINER function from validated input only.
CREATE OR REPLACE FUNCTION soe_dh_ensure_index(p_table uuid, p_key text, p_kind text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  v_name text;
  v_expr text;
  v_sql text;
  v_pred text;
BEGIN
  IF p_key !~ '^[a-z][a-z0-9_]{0,29}$' THEN RAISE EXCEPTION 'invalid column key'; END IF;
  IF NOT EXISTS (SELECT 1 FROM dh_tables WHERE id = p_table) THEN RAISE EXCEPTION 'table not found'; END IF;
  v_name := soe_dh_index_name(p_table, p_key, p_kind);
  v_pred := format('table_id = %L AND deleted_at IS NULL', p_table);
  CASE p_kind
    WHEN 'num'  THEN v_expr := format('((data->>%L)::numeric)', p_key);
    WHEN 'text' THEN v_expr := format('(data->>%L)', p_key);
    WHEN 'date' THEN v_expr := format('soe_date(data->>%L)', p_key);
    WHEN 'ts'   THEN v_expr := format('soe_ts(data->>%L)', p_key);
    WHEN 'bool' THEN v_expr := format('((data->>%L)::boolean)', p_key);
    WHEN 'uuid' THEN v_expr := format('((data->>%L)::uuid)', p_key);
    WHEN 'trgm' THEN v_expr := NULL;
    WHEN 'uniq' THEN v_expr := format('(data->>%L)', p_key);
    WHEN 'rel'  THEN v_expr := format('(data->%L)', p_key);
    WHEN 'eqk'  THEN v_expr := format('soe_eqk(data->%L)', p_key);
    ELSE RAISE EXCEPTION 'invalid index kind';
  END CASE;
  IF p_kind = 'trgm' THEN
    v_sql := format('CREATE INDEX IF NOT EXISTS %I ON dh_rows USING gin (soe_unaccent(lower(data->>%L)) gin_trgm_ops) WHERE %s', v_name, p_key, v_pred);
  ELSIF p_kind = 'rel' THEN
    v_sql := format('CREATE INDEX IF NOT EXISTS %I ON dh_rows USING gin (%s) WHERE %s', v_name, v_expr, v_pred);
  ELSIF p_kind = 'uniq' THEN
    v_sql := format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON dh_rows (%s) WHERE %s', v_name, v_expr, v_pred);
  ELSE
    v_sql := format('CREATE INDEX IF NOT EXISTS %I ON dh_rows (%s) WHERE %s', v_name, v_expr, v_pred);
  END IF;
  EXECUTE v_sql;
  RETURN v_name;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION soe_dh_drop_indexes(p_table uuid, p_key text, p_kinds text[] DEFAULT ARRAY['num','text','date','ts','bool','uuid','trgm','uniq','rel','eqk']) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  k text;
  n integer := 0;
BEGIN
  IF p_key !~ '^[a-z][a-z0-9_]{0,29}$' THEN RAISE EXCEPTION 'invalid column key'; END IF;
  FOREACH k IN ARRAY p_kinds LOOP
    IF k = ANY (ARRAY['num','text','date','ts','bool','uuid','trgm','uniq','rel','eqk']) AND to_regclass(format('public.%I', soe_dh_index_name(p_table, p_key, k))) IS NOT NULL THEN
      EXECUTE format('DROP INDEX public.%I', soe_dh_index_name(p_table, p_key, k));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END
$$;
--> statement-breakpoint
-- Relation columns that already exist get their reverse-lookup index now (new ones get it when created).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_id, key FROM dh_columns WHERE type = 'relation' AND deleted_at IS NULL LOOP
    PERFORM soe_dh_ensure_index(r.table_id, r.key, 'rel');
  END LOOP;
END
$$;
