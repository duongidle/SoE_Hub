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
}

/** Appends one audit row. Works on a transaction (same commit as the data) or on the db. */
export async function writeAudit(ex: Executor, e: AuditEntry): Promise<void> {
  const row: NewAuditLogRow = {
    command: e.command,
    result: e.result,
    requestId: e.requestId ?? null,
    actorUserId: e.actor?.userId ?? null,
    via: e.actor?.via ?? null,
    connectionId: e.actor?.connectionId ?? null,
    automationId: e.actor?.automationId ?? null,
    ip: e.actor?.ip ?? null,
    userAgent: e.actor?.userAgent?.slice(0, 500) ?? null,
    errorCode: e.errorCode ?? null,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    details: e.details === undefined ? null : e.details,
  };
  await ex.insert(auditLog).values(row);
}
