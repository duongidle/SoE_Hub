-- Platform setup: extensions, search helper, app role, grants, append-only triggers.
-- Idempotent: safe to run more than once.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
-- unaccent() is only STABLE, so it cannot be used in an index. This wrapper is declared IMMUTABLE
-- (the dictionary does not change at runtime) so search columns can have trigram indexes.
CREATE OR REPLACE FUNCTION soe_unaccent(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent', input) $$;
--> statement-breakpoint
-- Runtime role used by api and worker. It owns nothing and cannot change the schema.
-- The password is set by the migrate script from APP_DB_PASSWORD (never stored in git).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'soe_app') THEN
    CREATE ROLE soe_app LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO soe_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO soe_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO soe_app;
--> statement-breakpoint
-- Tables added by later migrations get the same default grants. Append-only tables must revoke explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO soe_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO soe_app;
--> statement-breakpoint
-- Append-only enforcement, layer 1: privileges.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, row_history, snapshots, snapshot_rows FROM soe_app;
--> statement-breakpoint
-- Append-only enforcement, layer 2: a trigger that rejects change for every role, owner included.
-- Retention clean-up after the legal period must be done by a DBA who disables the trigger on purpose.
CREATE OR REPLACE FUNCTION soe_forbid_modification() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log', 'row_history', 'snapshots', 'snapshot_rows']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION soe_forbid_modification()',
      t || '_append_only', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION soe_forbid_modification()',
      t || '_no_truncate', t);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Trigram index for Vietnamese-friendly search on audit commands (example of the search convention).
CREATE INDEX IF NOT EXISTS audit_log_command_trgm_idx ON audit_log USING gin (soe_unaccent(lower(command)) gin_trgm_ops);
