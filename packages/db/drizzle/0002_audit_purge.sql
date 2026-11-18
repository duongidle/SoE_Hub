-- Controlled purge of the audit log (design module0 section 9.3: keep at least 2 years).
-- audit_log stays append-only for everyone. The only way to remove rows is soe_purge_audit_before(), which:
--   * runs as the schema owner (SECURITY DEFINER), because the runtime role has no DELETE on audit_log;
--   * refuses any cutoff newer than the minimum retention: setting `audit.retention_days`, never below 730 days;
--   * lifts the append-only trigger only for its own DELETE, through a transaction-local flag.
-- row_history and snapshots are never purged.
-- Idempotent: safe to run more than once.

CREATE OR REPLACE FUNCTION soe_forbid_modification() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  -- The flag is set only inside soe_purge_audit_before(). The runtime role cannot use it on its own:
  -- it has no DELETE privilege on audit_log (layer 1), so the trigger is never reached for it.
  IF TG_TABLE_NAME = 'audit_log' AND TG_OP = 'DELETE' AND current_setting('soe.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION soe_audit_min_retention_days() RETURNS integer
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v jsonb;
  days integer := 730;
BEGIN
  SELECT value INTO v FROM system_settings WHERE key = 'audit.retention_days' AND deleted_at IS NULL;
  IF v IS NOT NULL AND jsonb_typeof(v) = 'number' THEN
    days := floor((v #>> '{}')::numeric)::integer;
  END IF;
  -- Hard floor: the design requires at least 2 years, whatever the setting says.
  RETURN greatest(days, 730);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION soe_purge_audit_before(cutoff timestamptz) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  min_days integer := soe_audit_min_retention_days();
  n bigint;
BEGIN
  IF cutoff IS NULL OR cutoff > now() - make_interval(days => min_days) THEN
    RAISE EXCEPTION 'audit purge refused: cutoff % is newer than the minimum retention of % days', cutoff, min_days
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('soe.audit_purge', 'on', true);
  DELETE FROM audit_log WHERE at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('soe.audit_purge', 'off', true);
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION soe_purge_audit_before(timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION soe_audit_min_retention_days() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION soe_purge_audit_before(timestamptz) TO soe_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION soe_audit_min_retention_days() TO soe_app;
