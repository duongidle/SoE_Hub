import { and, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import { AppError, type ActorRef } from "@soe/shared";
import type { Executor } from "../client";
import { diffRows, recordRowHistory, type HistoryOp } from "./history";
import { systemSettings } from "../schema/settings";

/** A Drizzle table that has the standard columns (design section 5). */
export type StandardTable = AnyPgTable &
  Record<"id" | "version" | "updatedAt" | "updatedBy" | "deletedAt" | "deletedBy", AnyPgColumn>;

export interface UpdateOptions {
  id: string;
  /** Version the caller last saw. A different current version fails with `conflict` (409). */
  expectedVersion: number;
  set: Record<string, unknown>;
  actor: ActorRef | null;
  /** When set, a row_history entry is written in the same transaction. */
  historyTableId?: string;
  /**
   * Extra condition applied to every query on the row: the data-scope condition for tables with an owner
   * (Module 1 requires every query on owned data to carry it).
   */
  where?: SQL;
}

type Row = Record<string, unknown> & { id: string; version: number };

async function currentState(ex: Executor, table: StandardTable, id: string, extra?: SQL) {
  const rows = await ex
    .select({ id: table.id, version: table.version, deletedAt: table.deletedAt })
    .from(table)
    .where(and(eq(table.id, id), extra) as SQL)
    .limit(1);
  return rows[0] as { id: string; version: number; deletedAt: Date | null } | undefined;
}

async function applyUpdate(
  ex: Executor,
  table: StandardTable,
  o: UpdateOptions & { deleted: "exclude" | "only"; op: HistoryOp },
): Promise<Row> {
  const deletedFilter = o.deleted === "exclude" ? isNull(table.deletedAt) : isNotNull(table.deletedAt);
  const before = o.historyTableId
    ? ((await ex.select().from(table).where(and(eq(table.id, o.id), o.where) as SQL).limit(1))[0] as Row | undefined)
    : undefined;

  const updated = (await ex
    .update(table)
    .set({
      ...o.set,
      version: sql`${table.version} + 1`,
      updatedAt: sql`now()`,
      updatedBy: o.actor?.userId ?? null,
    } as never)
    .where(and(eq(table.id, o.id), eq(table.version, o.expectedVersion), deletedFilter, o.where) as SQL)
    .returning()) as Row[];

  const row = updated[0];
  if (!row) {
    const cur = await currentState(ex, table, o.id, o.where);
    const wrongDeletedState = cur && (o.deleted === "exclude" ? cur.deletedAt !== null : cur.deletedAt === null);
    if (!cur || wrongDeletedState) throw new AppError("not_found");
    throw new AppError("conflict", undefined, { current_version: cur.version, sent_version: o.expectedVersion });
  }

  if (o.historyTableId) {
    await recordRowHistory(ex, {
      tableId: o.historyTableId,
      rowId: row.id,
      version: row.version,
      op: o.op,
      changes: diffRows(before ?? null, row),
      actor: o.actor,
    });
  }
  return row;
}

/**
 * Optimistic update: `UPDATE ... WHERE id AND version = expected AND deleted_at IS NULL`.
 * Bumps `version`, `updated_at`, `updated_by`. Throws `not_found` or `conflict`.
 */
export function versionedUpdate(ex: Executor, table: StandardTable, o: UpdateOptions): Promise<Row> {
  return applyUpdate(ex, table, { ...o, deleted: "exclude", op: "update" });
}

/** Soft delete: marks `deleted_at`/`deleted_by`; the row moves to the trash. */
export function softDelete(ex: Executor, table: StandardTable, o: Omit<UpdateOptions, "set">): Promise<Row> {
  return applyUpdate(ex, table, {
    ...o,
    set: { deletedAt: new Date(), deletedBy: o.actor?.userId ?? null },
    deleted: "exclude",
    op: "delete",
  });
}

/** Restores a row from the trash. */
export function restoreRow(ex: Executor, table: StandardTable, o: Omit<UpdateOptions, "set">): Promise<Row> {
  return applyUpdate(ex, table, {
    ...o,
    set: { deletedAt: null, deletedBy: null },
    deleted: "only",
    op: "restore",
  });
}

// ---------------------------------------------------------------------------------------------
// Trash registry and purge job (design section 12)
// ---------------------------------------------------------------------------------------------

export interface TrashTable {
  /** Physical table name. */
  name: string;
  /** If true, rows are never hard-deleted (for example deals: only marked as cancelled). */
  neverHardDelete?: boolean;
  /** SQL condition (trusted text, never user input) of rows that are never purged even from the trash, for example archived template columns (module4 3.1). */
  keepWhere?: string;
  /** Runs before rows older than `cutoff` are removed, for example to delete files in object storage. */
  beforePurge?: (ex: Executor, cutoff: Date) => Promise<void>;
}

const trashTables = new Map<string, TrashTable>();

export function registerTrashTable(t: TrashTable): void {
  trashTables.set(t.name, t);
}

export function listTrashTables(): TrashTable[] {
  return [...trashTables.values()];
}

const SETTING_TRASH_DAYS = "trash.retention_days";

export async function getTrashRetentionDays(ex: Executor, fallback = 7): Promise<number> {
  const rows = await ex.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, SETTING_TRASH_DAYS)).limit(1);
  const v = rows[0]?.value;
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback;
}

export interface PurgeResult {
  table: string;
  purged: number;
}

/** Hard-deletes rows that have been in the trash longer than the retention period. Skips `neverHardDelete`. */
export async function purgeTrash(ex: Executor, retentionDays: number, now = new Date()): Promise<PurgeResult[]> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const results: PurgeResult[] = [];
  for (const t of trashTables.values()) {
    if (t.neverHardDelete) continue;
    if (t.beforePurge) await t.beforePurge(ex, cutoff);
    const res = await ex.execute(
      // `/*scope:system*/`: a deliberate system-wide delete (see the query guard in apps/api/src/auth/query-guard.ts).
      sql`DELETE FROM ${sql.identifier(t.name)} WHERE /*scope:system*/ deleted_at IS NOT NULL AND deleted_at < ${cutoff}${t.keepWhere ? sql` AND NOT (${sql.raw(t.keepWhere)})` : sql``}`,
    );
    results.push({ table: t.name, purged: res.rowCount ?? 0 });
  }
  return results;
}


