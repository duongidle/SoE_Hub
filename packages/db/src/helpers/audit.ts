import { sql } from "drizzle-orm";
import type { Actor } from "@soe/shared";
import type { Executor } from "../client";
import { auditLog, type NewAuditLogRow } from "../schema/audit";

export interface AuditEntry {
  command: string;
  result: "success" | "denied" | "error";
  actor?: Actor | null;
  requestId?: string | null;
  errorCode?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: unknown;
  /** Channel, IP and user agent of the request. Used when there is no actor (login, codes), so the channel is never empty. */
  client?: { via?: string | null; ip?: string | null; userAgent?: string | null } | null;
}

/** Appends one audit row. Works on a transaction (same commit as the data) or on the db. */
export async function writeAudit(ex: Executor, e: AuditEntry): Promise<void> {
  const row: NewAuditLogRow = {
    command: e.command,
    result: e.result,
    requestId: e.requestId ?? null,
    actorUserId: e.actor?.userId ?? null,
    via: e.actor?.via ?? e.client?.via ?? null,
    connectionId: e.actor?.connectionId ?? null,
    automationId: e.actor?.automationId ?? null,
    ip: e.actor?.ip ?? e.client?.ip ?? null,
    userAgent: (e.actor?.userAgent ?? e.client?.userAgent)?.slice(0, 500) ?? null,
    errorCode: e.errorCode ?? null,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    details: e.details === undefined ? null : e.details,
  };
  await ex.insert(auditLog).values(row);
}

/** Minimum audit retention in days: setting `audit.retention_days`, never below 730 (2 years). Computed in SQL. */
export async function auditMinRetentionDays(ex: Executor): Promise<number> {
  const res = await ex.execute(sql`SELECT soe_audit_min_retention_days() AS days`);
  return Number((res.rows[0] as { days: number }).days);
}

/**
 * Deletes audit rows older than `cutoff` through the SECURITY DEFINER function `soe_purge_audit_before`
 * (migration 0002). The database refuses a cutoff newer than the minimum retention. Returns the row count.
 */
export async function purgeAuditBefore(ex: Executor, cutoff: Date): Promise<number> {
  try {
    const res = await ex.execute(sql`SELECT soe_purge_audit_before(${cutoff.toISOString()}::timestamptz) AS n`);
    return Number((res.rows[0] as { n: string | number }).n);
  } catch (e) {
    // Surface the database message ("audit purge refused: ...") instead of Drizzle's query wrapper.
    throw (e as { cause?: unknown }).cause ?? e;
  }
}
