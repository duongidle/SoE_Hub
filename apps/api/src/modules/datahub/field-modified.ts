import { sql } from "drizzle-orm";
import { AppError } from "@soe/shared";
import type { Executor } from "@soe/db";
import type { TableAccess } from "./access";
import { isComputedType } from "./cell-values";
import { MAX_WATCH } from "./column-types";
import type { TableSchema } from "./table-schema";
import { dependentsOf } from "./pushdown";
import { markPending } from "./recalc";
import { assertColumnKey, type DhColumn, type Stored } from "./types";

/**
 * "Ngày sửa của cột…" (design module2 section 4, module4 19c). The tracking column keeps the moment a person, the API, a form or a command last changed
 * one of the columns it watches. A change made by a formula recalculation or by the system is not a change here (same rule as the row history).
 */

/** Types whose value people or the API write: only those can be watched (a computed or system value changes without anyone editing). */
const NOT_WATCHABLE = new Set(["auto_number", "row_id", "created_time", "created_by", "modified_time", "modified_by", "field_modified"]);

/** The watched column keys of a `watch` list given by name or key. Refuses columns that are gone, computed or system-made, or the column itself. */
export function resolveWatch(schema: TableSchema, refs: string[], selfKey?: string): string[] {
  const keys: string[] = [];
  for (const ref of refs) {
    const col = schema.tryResolve(ref);
    if (!col || col.deletedAt) throw new AppError("validation_error", `Không tìm thấy cột "${ref}" để theo dõi.`, { reason: "watch_column" });
    if (col.key === selfKey) throw new AppError("validation_error", "Cột không theo dõi chính nó.", { reason: "watch_column" });
    if (isComputedType(col.type) || NOT_WATCHABLE.has(col.type)) throw new AppError("validation_error", `Cột "${col.name}" do hệ thống hoặc công thức điền, không theo dõi được. Chọn cột người dùng nhập.`, { reason: "watch_column", column: col.name });
    if (!keys.includes(col.key)) keys.push(col.key);
  }
  if (keys.length === 0 || keys.length > MAX_WATCH) throw new AppError("validation_error", `Chọn từ 1 đến ${MAX_WATCH} cột để theo dõi.`, { reason: "watch_column" });
  return keys;
}

export interface Tracker {
  key: string;
  watch: Set<string>;
}

export function trackers(columns: DhColumn[]): Tracker[] {
  return columns.filter((c) => c.type === "field_modified" && !c.deletedAt).map((c) => ({ key: c.key, watch: new Set(((c.config.watch as string[] | undefined) ?? []).map(String)) }));
}

/** Sets the tracking cells of `data` whose watched columns are among `changed`. Returns the tracking keys it set. */
export function touchTrackers(list: Tracker[], data: Record<string, Stored>, changed: Iterable<string>, at: Date): string[] {
  if (list.length === 0) return [];
  const set = new Set(changed);
  const out: string[] = [];
  for (const t of list) {
    for (const k of t.watch) {
      if (set.has(k)) {
        data[t.key] = at.toISOString();
        out.push(t.key);
        break;
      }
    }
  }
  return out;
}

/**
 * Fills the tracking column of a table that already has rows from the row history: the latest history entry that changed a watched column
 * (create, update or restore). A row nobody changed in a watched column stays empty. System fill: no history, no audit, no version change.
 */
export async function backfillTracker(db: Executor, acc: TableAccess, key: string, watch: string[]): Promise<number> {
  assertColumnKey(key);
  const fields = `{${watch.map((k) => assertColumnKey(k)).join(",")}}`;
  await db.execute(sql`UPDATE dh_rows r SET data = r.data - ${key}::text WHERE ${acc.rows("r")} AND r.data ? ${key}::text`);
  const res = await db.execute(sql`UPDATE dh_rows r SET data = r.data || jsonb_build_object(${key}::text, to_char(h.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    FROM (SELECT row_id, max(at) AS at FROM row_history
          WHERE table_id = ${acc.tableId} AND op IN ('create', 'update', 'restore')
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(changes) c WHERE c->>'field' = ANY(${fields}::text[]))
          GROUP BY row_id) h
    WHERE ${acc.rows("r")} AND r.id = h.row_id`);
  // The values changed under the formulas that read this column (Closing date reads "Ngày đổi Status"): they recompute, like after any change of a source.
  await markPending(db, await dependentsOf(db, acc.tableId, [key]));
  return res.rowCount ?? 0;
}

/**
 * A column that "Ngày sửa của cột" columns watch is being deleted (design module4 19a work 19c). It leaves their lists; a tracker whose LAST watched column it is
 * cannot go on, so the deletion is refused with the trackers named, for the screen to warn before ("Cột X là cột cuối được theo dõi bởi Y").
 */
export async function releaseWatchedColumn(db: Executor, acc: TableAccess, col: { key: string; name: string }): Promise<void> {
  const res = await db.execute(sql`SELECT id, name, config FROM dh_columns WHERE ${acc.scope()} AND type = 'field_modified' AND deleted_at IS NULL AND config->'watch' ? ${col.key}`);
  const trackers = res.rows as { id: string; name: string; config: { watch: string[] } }[];
  const last = trackers.filter((t) => t.config.watch.length === 1);
  if (last.length) {
    throw new AppError("conflict", `Cột "${col.name}" là cột duy nhất được theo dõi bởi ${last.map((t) => `"${t.name}"`).join(", ")}. Bỏ hoặc đổi cột theo dõi đó trước.`, { reason: "watched_by_tracker", column: col.name, trackers: last.map((t) => ({ id: t.id, name: t.name })) });
  }
  for (const t of trackers) {
    const watch = t.config.watch.filter((k) => k !== col.key);
    await db.execute(sql`UPDATE dh_columns SET config = jsonb_set(config, '{watch}', ${JSON.stringify(watch)}::jsonb), version = version + 1, updated_at = now() WHERE ${acc.scope()} AND id = ${t.id}::uuid`);
  }
}
