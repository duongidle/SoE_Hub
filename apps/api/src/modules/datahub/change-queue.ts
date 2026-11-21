import { sql } from "drizzle-orm";
import type { Db, Executor } from "@soe/db";

/**
 * The shared change queue of the Datahub (design module2 section 6.7). One table (`dh_change_queue`) for the whole system.
 * A write of source data adds, for every computed column that depends on it, WHAT may have changed; the worker takes a
 * column's whole burst at once, recomputes only the affected rows and deletes what it took. Entries are written in the
 * transaction of the write, so a committed write always has its entries.
 */

export type QueueMode = "rows" | "linked" | "keys" | "full";

export interface QueueEntry {
  columnId: string;
  /** Change sequence of the write that produced the entry (design module2 section 6.7, "Đợi tính xong"). */
  seq: number;
  mode: QueueMode;
  /** `rows`: rows of the column's table. `linked`: rows of the linked (target) table of a lookup/rollup. */
  rowIds?: string[];
  /** `keys`: group keys of changed source rows (old and new); see `KeyTuples`. */
  keys?: KeyTuples;
}

/** `cols`: keys of the columns of the dependent table that hold the group key; `tuples[i][j]` is the raw (stored) key value for `cols[j]`. */
export interface KeyTuples {
  cols: string[];
  tuples: unknown[][];
}

export interface QueuedRow {
  id: number;
  columnId: string;
  seq: number;
  mode: QueueMode;
  rowIds: string[] | null;
  keys: KeyTuples | null;
}

const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;

/** The next global change sequence. Every write of source data takes one. */
export async function nextChangeSeq(db: Executor): Promise<number> {
  const res = await db.execute(sql`SELECT nextval('dh_change_seq')::bigint::text AS seq`);
  return Number((res.rows[0] as { seq: string }).seq);
}

/** The highest sequence handed out so far (what `consistent=true` waits for). */
export async function currentChangeSeq(db: Executor): Promise<number> {
  const res = await db.execute(sql`SELECT CASE WHEN is_called THEN last_value ELSE 0 END::text AS seq FROM dh_change_seq`);
  return Number((res.rows[0] as { seq: string }).seq);
}

interface TouchState {
  touch: Set<string>;
  lockOnly: Set<string>;
}
const touchStates = new WeakMap<object, TouchState>();

/**
 * Runs `fn` in a transaction in which `touchColumns` only collects: the column rows are locked ONCE, in id order, just
 * before the commit (`flushTouches`). Why: a transaction that touches columns in several calls (one per source table, one
 * per template table...) takes the locks in several rounds, and two such transactions in opposite orders deadlock (seen
 * for real: worker `datahub.formula` against the member-tree build). One sorted round at the end cannot form a cycle with
 * another sorted round. Every transaction that can reach `touchColumns` must be opened with this (see design/ban-do-code.md, Module 0).
 */
export async function columnTx<T>(db: Db, fn: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    touchStates.set(tx, { touch: new Set(), lockOnly: new Set() });
    try {
      const out = await fn(tx as Executor);
      await flushTouches(tx as Executor);
      return out;
    } finally {
      touchStates.delete(tx);
    }
  });
}

/** Locks (no status change) columns together with the touched ones at the flush, so a transaction that updates its own column also takes that lock in the sorted round. */
export function lockColumnsAtFlush(db: Executor, columnIds: string[]): void {
  const st = touchStates.get(db);
  if (!st) throw new Error("lockColumnsAtFlush needs a transaction opened with columnTx");
  for (const id of columnIds) st.lockOnly.add(id);
}

/**
 * Locks the collected columns in id order. `FOR NO KEY UPDATE`, not `FOR UPDATE`: inserting into `dh_change_queue` takes `FOR KEY SHARE` on the column (foreign key), which
 * `FOR UPDATE` conflicts with, so a writer that had queued an entry would block the lock round of another one (a second deadlock cycle). The UPDATE below takes the same weaker lock.
 *
 * Then marks the touched ones. Called by `columnTx` before the commit; a transaction not opened with it touches at once (single sorted round per call). */
export async function flushTouches(db: Executor): Promise<void> {
  const st = touchStates.get(db);
  if (!st) return;
  const touch = [...st.touch].sort();
  const all = [...new Set([...touch, ...st.lockOnly])].sort();
  st.touch.clear();
  st.lockOnly.clear();
  await lockAndMark(db, touch, all);
}

async function lockAndMark(db: Executor, touchIds: string[], lockIds: string[]): Promise<void> {
  if (lockIds.length === 0) return;
  await db.execute(sql`SELECT id FROM dh_columns WHERE /*scope:system*/ id = ANY(${uuidArray(lockIds)}::uuid[]) ORDER BY id FOR NO KEY UPDATE`);
  if (touchIds.length === 0) return;
  await db.execute(sql`UPDATE dh_columns SET calc_status = CASE WHEN calc_status = 'running' THEN calc_status ELSE 'pending' END, calc_requested_at = clock_timestamp()
    WHERE /*scope:system*/ deleted_at IS NULL AND id = ANY(${uuidArray(touchIds)}::uuid[])`);
}

/**
 * Marks the columns as waiting for the worker. In a transaction opened with `columnTx` it only collects (see there);
 * otherwise the columns are locked in id order and updated at once. The update is unconditional on purpose: it makes the
 * worker's claim wait until this transaction commits, and moves `calc_requested_at` past a run that is already going, so an
 * entry added while a column is being computed is never lost (the run ends `pending` again).
 */
export async function touchColumns(db: Executor, columnIds: string[]): Promise<void> {
  if (columnIds.length === 0) return;
  const st = touchStates.get(db);
  if (st) {
    for (const id of columnIds) st.touch.add(id);
    return;
  }
  const ids = [...new Set(columnIds)].sort();
  await lockAndMark(db, ids, ids);
}

/** Adds entries to the queue (accumulating: nothing is merged here, the worker merges a column's burst when it takes it) and marks their columns. */
export async function enqueue(db: Executor, entries: QueueEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await touchColumns(db, entries.map((e) => e.columnId));
  const payload = entries.map((e) => ({ column_id: e.columnId, seq: e.seq, mode: e.mode, row_ids: e.rowIds ?? null, keys: e.keys ?? null }));
  // Large payloads go in pieces so one statement stays small.
  for (let i = 0; i < payload.length; i += 200) {
    await db.execute(sql`INSERT INTO dh_change_queue (column_id, seq, mode, row_ids, keys)
      SELECT v.column_id, v.seq, v.mode, CASE WHEN v.row_ids IS NULL THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(v.row_ids)::uuid) END, v.keys
      FROM jsonb_to_recordset(${JSON.stringify(payload.slice(i, i + 200))}::jsonb) AS v(column_id uuid, seq bigint, mode text, row_ids jsonb, keys jsonb)`);
  }
}

/** Everything waiting for a column, oldest first. */
export async function readQueue(db: Executor, columnId: string): Promise<QueuedRow[]> {
  const res = await db.execute(sql`SELECT id::text AS id, column_id, seq::text AS seq, mode, row_ids, keys FROM dh_change_queue WHERE column_id = ${columnId}::uuid ORDER BY id`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    columnId: r.column_id as string,
    seq: Number(r.seq),
    mode: r.mode as QueueMode,
    rowIds: (r.row_ids as string[] | null) ?? null,
    keys: (r.keys as KeyTuples | null) ?? null,
  }));
}

/** Removes entries that were processed. Only the entries that were read are removed: one written meanwhile stays. */
export async function deleteQueue(db: Executor, ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 5000) {
    await db.execute(sql`DELETE FROM dh_change_queue WHERE id = ANY(${uuidArray(ids.slice(i, i + 5000).map(String))}::bigint[])`);
  }
}

/** Does the column still have entries (optionally only those at or before a sequence)? */
export async function hasQueued(db: Executor, columnId: string, upToSeq?: number): Promise<boolean> {
  const res = await db.execute(sql`SELECT EXISTS (SELECT 1 FROM dh_change_queue WHERE column_id = ${columnId}::uuid ${upToSeq === undefined ? sql`` : sql`AND seq <= ${upToSeq}::bigint`}) AS e`);
  return (res.rows[0] as { e: boolean }).e;
}

/**
 * Reverse lookup of a Relation column without a link table: the rows of `tableId` whose relation cell contains any of
 * `targetIds`. Uses the partial GIN index of the column (`soe_dh_ensure_index(..., 'rel')`, created with the column) and
 * jsonb `?|`. `within` limits the search to some rows (used to find which queued rows are affected).
 */
export async function linkedRows(db: Executor, tableId: string, relKey: string, targetIds: string[], opts: { within?: string[] } = {}): Promise<string[]> {
  if (targetIds.length === 0) return [];
  const out = new Set<string>();
  const expr = sql.raw(`(data->'${assertKey(relKey)}')`);
  for (let i = 0; i < targetIds.length; i += 2000) {
    const res = await db.execute(sql`SELECT id FROM dh_rows WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL
      AND ${expr} ?| ${uuidArray(targetIds.slice(i, i + 2000))}::text[] ${opts.within ? sql`AND id = ANY(${uuidArray(opts.within)}::uuid[])` : sql``}`);
    for (const r of res.rows as { id: string }[]) out.add(r.id);
  }
  return [...out];
}

function assertKey(key: string): string {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(key)) throw new Error(`invalid column key: ${key}`);
  return key;
}
