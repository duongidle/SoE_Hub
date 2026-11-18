import type { ActorRef } from "@soe/shared";
import type { Executor } from "../client";
import { rowHistory } from "../schema/history";

export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

export type HistoryOp = "create" | "update" | "delete" | "restore";

function normalize(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  return JSON.stringify(v === undefined ? null : v);
}

/** Field-level diff between two row objects. Compares by JSON value; Dates by instant. */
export function diffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  opts: { ignore?: string[] } = {},
): FieldChange[] {
  const ignore = new Set(opts.ignore ?? ["updatedAt", "updatedBy", "version"]);
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: FieldChange[] = [];
  for (const field of [...keys].sort()) {
    if (ignore.has(field)) continue;
    const o = before?.[field] ?? null;
    const n = after?.[field] ?? null;
    if (normalize(o) !== normalize(n)) changes.push({ field, old: o, new: n });
  }
  return changes;
}

export interface RowHistoryEntry {
  tableId: string;
  rowId: string;
  version: number;
  op: HistoryOp;
  changes: FieldChange[];
  actor?: ActorRef | null;
}

/** Appends one history row. Call it in the same transaction as the row change. */
export async function recordRowHistory(ex: Executor, e: RowHistoryEntry): Promise<void> {
  await ex.insert(rowHistory).values({
    tableId: e.tableId,
    rowId: e.rowId,
    version: e.version,
    op: e.op,
    changes: e.changes,
    actor: e.actor ?? null,
  });
}
