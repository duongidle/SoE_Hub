-- Datahub setup (design module2 sections 3 and Module 0 section 6.2): date helpers for indexes, search index,
-- controlled DDL for automatic indexes, and the SQL export views in schema `dh_views`.
-- The runtime role (soe_app) cannot change the schema, so everything that needs DDL is a SECURITY DEFINER function
-- that builds its SQL only from validated input (key pattern, fixed kinds, ids that exist). Idempotent.

-- ISO dates and timestamps are parsed the same way whatever DateStyle is, so these wrappers are safely IMMUTABLE
-- and can be used in expression indexes over JSONB text values.
CREATE OR REPLACE FUNCTION soe_date(input text) RETURNS date
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT input::date $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION soe_ts(input text) RETURNS timestamptz
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT input::timestamptz $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dh_rows_search_trgm_idx ON dh_rows USING gin (soe_unaccent(lower(search)) gin_trgm_ops);
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS dh_views;
--> statement-breakpoint
REVOKE ALL ON SCHEMA dh_views FROM PUBLIC;
--> statement-breakpoint

-- Name of an automatic index: deterministic, so it can be found again and dropped.
CREATE OR REPLACE FUNCTION soe_dh_index_name(p_table uuid, p_key text, p_kind text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT 'dh_ix_' || substr(replace(p_table::text, '-', ''), 1, 12) || '_' || p_key || '_' || p_kind $$;
--> statement-breakpoint

-- Creates an expression index for one column of one table. `p_kind`: num, text, date, ts, bool, uuid, trgm, uniq.
-- `uniq` makes a unique index (the "unique" column property); the others are plain performance indexes.
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
    ELSE RAISE EXCEPTION 'invalid index kind';
  END CASE;
  IF p_kind = 'trgm' THEN
    v_sql := format('CREATE INDEX IF NOT EXISTS %I ON dh_rows USING gin (soe_unaccent(lower(data->>%L)) gin_trgm_ops) WHERE %s', v_name, p_key, v_pred);
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

-- Drops every automatic index of one column (used when a column is deleted or loses "unique").
CREATE OR REPLACE FUNCTION soe_dh_drop_indexes(p_table uuid, p_key text, p_kinds text[] DEFAULT ARRAY['num','text','date','ts','bool','uuid','trgm','uniq']) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  k text;
  n integer := 0;
BEGIN
  IF p_key !~ '^[a-z][a-z0-9_]{0,29}$' THEN RAISE EXCEPTION 'invalid column key'; END IF;
  FOREACH k IN ARRAY p_kinds LOOP
    IF k = ANY (ARRAY['num','text','date','ts','bool','uuid','trgm','uniq']) AND to_regclass(format('public.%I', soe_dh_index_name(p_table, p_key, k))) IS NOT NULL THEN
      EXECUTE format('DROP INDEX public.%I', soe_dh_index_name(p_table, p_key, k));
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END
$$;
--> statement-breakpoint

-- Cuts a name to 63 bytes (the identifier limit) without splitting a multi-byte character.
CREATE OR REPLACE FUNCTION soe_dh_ident(p_name text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE
  AS $$
DECLARE s text := p_name;
BEGIN
  WHILE octet_length(s) > 63 LOOP s := left(s, char_length(s) - 1); END LOOP;
  RETURN s;
END
$$;
--> statement-breakpoint

-- SQL expression that reads one column from `dh_rows` in human form (select options become their names).
CREATE OR REPLACE FUNCTION soe_dh_view_expr(p_type text, p_key text, p_config jsonb) RETURNS text
  LANGUAGE plpgsql IMMUTABLE
  AS $$
DECLARE
  d text := format('(data->>%L)', p_key);
  opts text := quote_literal(coalesce(p_config->'options', '[]'::jsonb)::text) || '::jsonb';
BEGIN
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
--> statement-breakpoint

-- (Re)builds the export view of one table in schema dh_views (design module2 section 3):
--   SELECT * FROM dh_views."<owner email name> – <datahub> – <table>";
-- Columns carry the names users gave them. A trashed table or datahub has no view.
CREATE OR REPLACE FUNCTION soe_dh_regenerate_view(p_table uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  t dh_tables%ROWTYPE;
  d dh_datahubs%ROWTYPE;
  v_owner text;
  v_name text;
  v_base text;
  v_cols text := 'id, row_no AS ' || quote_ident('row_no');
  v_used text[] := ARRAY['id', 'row_no'];
  c record;
  v_alias text;
  v_i integer;
BEGIN
  SELECT * INTO t FROM dh_tables WHERE id = p_table;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO d FROM dh_datahubs WHERE id = t.datahub_id;
  IF t.sql_view IS NOT NULL THEN EXECUTE format('DROP VIEW IF EXISTS dh_views.%I', t.sql_view); END IF;
  IF t.deleted_at IS NOT NULL OR d.deleted_at IS NOT NULL THEN
    UPDATE dh_tables SET sql_view = NULL WHERE id = p_table;
    RETURN NULL;
  END IF;
  SELECT split_part(coalesce(email, full_name), '@', 1) INTO v_owner FROM users WHERE id = d.owner_id;
  v_base := v_owner || ' – ' || d.name || ' – ' || t.name;
  v_name := soe_dh_ident(v_base);
  -- Two tables that cut down to the same name: the later one gets a short id suffix.
  IF EXISTS (SELECT 1 FROM dh_tables x WHERE x.sql_view = v_name AND x.id <> p_table) THEN
    v_name := soe_dh_ident(left(v_base, 50)) || ' #' || substr(replace(p_table::text, '-', ''), 1, 6);
  END IF;
  FOR c IN SELECT * FROM dh_columns WHERE table_id = p_table AND deleted_at IS NULL ORDER BY position, created_at, id LOOP
    v_alias := soe_dh_ident(c.name);
    v_i := 1;
    WHILE lower(v_alias) = ANY (v_used) LOOP
      v_i := v_i + 1;
      v_alias := soe_dh_ident(left(c.name, 55)) || '_' || v_i;
    END LOOP;
    v_used := v_used || lower(v_alias);
    v_cols := v_cols || ', ' || soe_dh_view_expr(c.type, c.key, c.config) || ' AS ' || quote_ident(v_alias);
  END LOOP;
  EXECUTE format('CREATE VIEW dh_views.%I AS SELECT %s FROM public.dh_rows WHERE table_id = %L AND deleted_at IS NULL', v_name, v_cols, p_table);
  UPDATE dh_tables SET sql_view = v_name WHERE id = p_table;
  RETURN v_name;
END
$$;
--> statement-breakpoint

-- Drops export views that no live table owns any more (purged tables, deleted datahubs). Returns how many.
CREATE OR REPLACE FUNCTION soe_dh_sync_views() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
    WHERE s.nspname = 'dh_views' AND c.relkind = 'v'
      AND NOT EXISTS (SELECT 1 FROM dh_tables t WHERE t.sql_view = c.relname)
  LOOP
    EXECUTE format('DROP VIEW dh_views.%I', r.relname);
    n := n + 1;
  END LOOP;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION soe_dh_ensure_index(uuid, text, text), soe_dh_drop_indexes(uuid, text, text[]), soe_dh_regenerate_view(uuid), soe_dh_sync_views() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION soe_dh_ensure_index(uuid, text, text), soe_dh_drop_indexes(uuid, text, text[]), soe_dh_regenerate_view(uuid), soe_dh_sync_views() TO soe_app;
