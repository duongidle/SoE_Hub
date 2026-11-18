import { sql } from "drizzle-orm";
import type { Executor } from "@soe/db";
import { currentChangeSeq, linkedRows, readQueue } from "./change-queue";
import { rowsOfKeys } from "./recalc";

/**
 * Waiting for the worker and showing which cells are still being computed (design module2 section 6.7, "Đợi tính xong").
 *
 * A computed column is DONE up to a change sequence when neither it nor any column it reads (through
 * `dh_formula_deps`, to any depth) still has queue entries at or before that sequence. The queue is the truth: a write
 * queues its entries in its own transaction, and the worker deletes them in the same transaction that releases the column
 * and queues the dependants (so a chain never shows a gap). A column that is `pending`/`running` with NO entry at all
 * (TODAY()/NOW() refresh) counts as not done for every sequence.
 */

export interface Consistency {
  /** The sequence waited for. */
  seq: number;
  /** True when the wait timed out: the values returned may still be old. */
  stale: boolean;
  /** Keys of the computed columns of the table that were not finished. Empty when `stale` is false. */
  columns: string[];
}

/** Default time to wait when no setting overrides it is `DH_SETTINGS.consistentWaitMs` (5 s). */
const MAX_SEQ = Number.MAX_SAFE_INTEGER;

interface Unfinished {
  rootId: string;
  rootKey: string;
  rootType: string;
  rootConfig: Record<string, unknown>;
  /** The column itself has queue entries / is pending (false: only a column it reads is). */
  own: boolean;
}

/** Computed columns of the table (not deleted) that are not done up to `seq`, with whether the column itself or only an upstream column is waiting. */
async function unfinished(db: Executor, tableId: string, seq: number): Promise<Unfinished[]> {
  const res = await db.execute(sql`WITH RECURSIVE up(root, id) AS (
      SELECT c.id, c.id FROM dh_columns c WHERE /*scope:system*/ c.table_id = ${tableId}::uuid AND c.deleted_at IS NULL AND c.type IN ('formula', 'lookup', 'rollup')
      UNION
      SELECT up.root, y.id FROM up JOIN dh_formula_deps f ON f.column_id = up.id
        JOIN dh_columns y ON y.table_id = f.src_table_id AND y.key = f.src_key AND y.deleted_at IS NULL)
    SELECT r.id AS root_id, r.key AS root_key, r.type AS root_type, r.config AS root_config, bool_or(up.id = up.root) AS own
    FROM up JOIN dh_columns c ON c.id = up.id JOIN dh_columns r ON r.id = up.root
    WHERE EXISTS (SELECT 1 FROM dh_change_queue q WHERE q.column_id = c.id AND q.seq <= ${String(seq)}::bigint)
       OR (c.calc_status <> 'ready' AND NOT EXISTS (SELECT 1 FROM dh_change_queue q WHERE q.column_id = c.id))
    GROUP BY r.id, r.key, r.type, r.config`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    rootId: r.root_id as string,
    rootKey: r.root_key as string,
    rootType: r.root_type as string,
    rootConfig: (r.root_config as Record<string, unknown>) ?? {},
    own: r.own as boolean,
  }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits (at most `waitMs`) until every computed column of the table is done up to `seq`. Times out with `stale: true` and the unfinished columns. */
export async function waitConsistent(db: Executor, tableId: string, seq: number, waitMs: number): Promise<Consistency> {
  const deadline = Date.now() + waitMs;
  let delay = 25;
  for (;;) {
    const left = await unfinished(db, tableId, seq);
    if (left.length === 0) return { seq, stale: false, columns: [] };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { seq, stale: true, columns: left.map((l) => l.rootKey).sort() };
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, 250);
  }
}

/** The sequence a read asks for: `consistent_after`, or the newest one handed out now for `consistent=true` (the larger when both are given). */
export async function wantedSeq(db: Executor, o: { consistentAfter?: number; consistent?: boolean }): Promise<number | null> {
  if (o.consistentAfter === undefined && !o.consistent) return null;
  const now = o.consistent ? await currentChangeSeq(db) : 0;
  return Math.max(o.consistentAfter ?? 0, now);
}

/**
 * Which cells of these rows are being computed right now: `{ rowId: [column keys] }` (rows with none are absent).
 * A column with a `full` entry, a refresh without entries, or one whose upstream column is waiting is pending for every
 * given row (which rows will change is not known yet); otherwise only the rows its queued entries name or resolve to
 * (rows of the table, rows linked to changed target rows through the GIN index, rows holding a changed group key).
 */
export async function pendingCells(db: Executor, tableId: string, rowIds: string[], only?: Set<string>): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (rowIds.length === 0) return out;
  const cols = (await unfinished(db, tableId, MAX_SEQ)).filter((c) => !only || only.has(c.rootKey));
  if (cols.length === 0) return out;
  const mark = (ids: Iterable<string>, key: string) => {
    for (const id of ids) (out[id] ??= []).push(key);
  };
  const page = new Set(rowIds);
  for (const c of cols) {
    const entries = c.own ? await readQueue(db, c.rootId) : [];
    if (!c.own || entries.length === 0 || entries.some((e) => e.mode === "full")) {
      mark(rowIds, c.rootKey);
      continue;
    }
    const hit = new Set<string>();
    for (const e of entries) if (e.mode === "rows") e.rowIds?.forEach((x) => page.has(x) && hit.add(x));
    const linked = entries.filter((e) => e.mode === "linked").flatMap((e) => e.rowIds ?? []);
    if (linked.length) for (const id of await linkedRows(db, tableId, c.rootConfig.relation_key as string, [...new Set(linked)], { within: rowIds })) hit.add(id);
    const keyed = entries.filter((e) => e.mode === "keys");
    if (keyed.length) for (const id of await rowsOfKeys(db, tableId, keyed, 0, rowIds)) hit.add(id);
    mark(hit, c.rootKey);
  }
  return out;
}
