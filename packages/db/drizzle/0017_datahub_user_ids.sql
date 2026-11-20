-- Module 4.2: a "Người dùng" cell may hold one person (a uuid string, as before) or a list of people with attributes
-- ([{"id": "...", "attrs": {...}}]). `soe_dh_ids` reads the ids of either shape, so the split lock (`soe_dh_ids(cell) && ARRAY[ids]`)
-- and its index work for both. The index kind `ids` is a partial GIN index (array overlap), replacing the btree `uuid` index for key columns.
CREATE OR REPLACE FUNCTION soe_dh_ids(v jsonb) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
  SELECT CASE jsonb_typeof(v)
    WHEN 'string' THEN ARRAY[v #>> '{}']
    WHEN 'array' THEN coalesce((SELECT array_agg(CASE WHEN jsonb_typeof(e) = 'object' THEN e->>'id' ELSE e #>> '{}' END) FROM jsonb_array_elements(v) e), '{}'::text[])
    ELSE '{}'::text[]
  END
$$;
--> statement-breakpoint
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
    WHEN 'ids'  THEN v_expr := format('soe_dh_ids(data->%L)', p_key);
    ELSE RAISE EXCEPTION 'invalid index kind';
  END CASE;
  IF p_kind = 'trgm' THEN
    v_sql := format('CREATE INDEX IF NOT EXISTS %I ON dh_rows USING gin (soe_unaccent(lower(data->>%L)) gin_trgm_ops) WHERE %s', v_name, p_key, v_pred);
  ELSIF p_kind IN ('rel', 'ids') THEN
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
CREATE OR REPLACE FUNCTION soe_dh_drop_indexes(p_table uuid, p_key text, p_kinds text[] DEFAULT ARRAY['num','text','date','ts','bool','uuid','trgm','uniq','rel','eqk','ids']) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  k text;
  n integer := 0;
BEGIN
  IF p_key !~ '^[a-z][a-z0-9_]{0,29}$' THEN RAISE EXCEPTION 'invalid column key'; END IF;
  FOREACH k IN ARRAY p_kinds LOOP
    IF k = ANY (ARRAY['num','text','date','ts','bool','uuid','trgm','uniq','rel','eqk','ids']) AND to_regclass(format('public.%I', soe_dh_index_name(p_table, p_key, k))) IS NOT NULL THEN
      EXECUTE format('DROP INDEX public.%I', soe_dh_index_name(p_table, p_key, k));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END
$$;
--> statement-breakpoint
-- Key columns of tables that already have the split lock get the new index (the old btree `uuid` index stays when somebody asked for it).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT t.id, unnest(t.key_columns) AS key FROM dh_tables t WHERE t.key_split AND t.deleted_at IS NULL LOOP
    PERFORM soe_dh_ensure_index(r.id, r.key, 'ids');
    IF NOT EXISTS (SELECT 1 FROM dh_index_requests q WHERE q.table_id = r.id AND q.column_key = r.key AND q.kind = 'uuid') THEN
      PERFORM soe_dh_drop_indexes(r.id, r.key, ARRAY['uuid']);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
-- "Gửi xuống" (module4 4.5): a person-stored column the system fills from the attributes of the people in a user column of the row.
ALTER TABLE "dh_columns" ADD COLUMN "autofill" jsonb;
