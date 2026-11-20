import { sql } from "drizzle-orm";
import { findGroupable, walk, type Node } from "@soe/formula";
import type { Executor } from "@soe/db";
import { effectiveType } from "./cell-values";
import { enqueue, type KeyTuples, type QueueEntry } from "./change-queue";
import { isGroupKeyColumn, isPlainStoredColumn } from "./computed";
import { parsedExpr } from "./row-formulas";

/**
 * Which computed columns a source write may have changed, and which of their rows (design module2 section 6.7).
 * Called in the transaction of the write with the OLD and NEW data of every changed row (so old values come from the
 * write itself, never guessed); the answer is accumulated in the shared change queue (`change-queue.ts`).
 */

export interface RowChange {
  rowId: string;
  /** `restore` = the row is back in the table (its data did not change, but it counts again). */
  kind: "insert" | "update" | "delete" | "restore";
  /** All cells before the change (null for an insert or a restore). Error markers (`!key`) included. */
  old: Record<string, unknown> | null;
  /** All cells after the change (null for a delete). */
  new: Record<string, unknown> | null;
  /** The keys that changed, when old and new cannot say it (a reader-scoped column: each reader has their own value). */
  keys?: string[];
}

/** A burst bigger than this makes every dependant recompute its whole column (a list of 5,000 keys is not cheaper than a scan). */
export const CHAIN_LIMIT = 5000;

type Raw = Record<string, unknown>;

interface Dependent {
  id: string;
  tableId: string;
  key: string;
  type: string;
  config: Record<string, unknown>;
  /** Columns of the SOURCE table it reads as `cell` (same table as the dependant) / as `range` (whole column). */
  cellKeys: Set<string>;
  rangeKeys: Set<string>;
  /** Has any `range` dependency: the worker computes it. A formula without one is computed by the API in the writing transaction. */
  hasRange: boolean;
  /** Reader-scoped (design module2 section 10): the worker computes it, for the owner and for each member, even without a `range` dependency. */
  scoped: boolean;
  /** It reads a table of ANOTHER owner (a template table the column's owner reads, module4 19 work 5, 9): its values depend on what that owner sees, so it recomputes whole. */
  foreign: boolean;
}

interface ColInfo {
  type: string;
  config: Record<string, unknown>;
}

/** Every computed column that reads the table, plus the worker-computed columns that live in it (they need new rows). */
async function loadDependents(db: Executor, tableId: string): Promise<Dependent[]> {
  const res = await db.execute(sql`SELECT c.id, c.table_id, c.key, c.type, c.config, c.reader_scoped, f.src_key, f.kind,
      EXISTS (SELECT 1 FROM dh_formula_deps r WHERE r.column_id = c.id AND r.kind = 'range') AS has_range,
      (SELECT d2.owner_id FROM dh_tables t2 JOIN dh_datahubs d2 ON d2.id = t2.datahub_id WHERE /*scope:system*/ t2.id = c.table_id) IS DISTINCT FROM
      (SELECT d3.owner_id FROM dh_tables t3 JOIN dh_datahubs d3 ON d3.id = t3.datahub_id WHERE /*scope:system*/ t3.id = f.src_table_id) AS foreign_src
    FROM dh_formula_deps f JOIN dh_columns c ON c.id = f.column_id
    WHERE /*scope:system*/ f.src_table_id = ${tableId}::uuid AND c.deleted_at IS NULL`);
  const out = new Map<string, Dependent>();
  const get = (r: Raw): Dependent => {
    let d = out.get(r.id as string);
    if (!d) {
      d = { id: r.id as string, tableId: r.table_id as string, key: r.key as string, type: r.type as string, config: (r.config as Record<string, unknown>) ?? {}, cellKeys: new Set(), rangeKeys: new Set(), hasRange: r.has_range as boolean, scoped: !!r.reader_scoped, foreign: false };
      out.set(d.id, d);
    }
    return d;
  };
  for (const r of res.rows as Raw[]) {
    const d = get(r);
    (r.kind === "cell" ? d.cellKeys : d.rangeKeys).add(r.src_key as string);
    if (r.foreign_src) d.foreign = true;
  }
  const own = await db.execute(sql`SELECT c.id, c.table_id, c.key, c.type, c.config, c.reader_scoped,
      EXISTS (SELECT 1 FROM dh_formula_deps r WHERE r.column_id = c.id AND r.kind = 'range') AS has_range
    FROM dh_columns c WHERE /*scope:system*/ c.table_id = ${tableId}::uuid AND c.deleted_at IS NULL AND c.type IN ('lookup', 'rollup', 'formula')`);
  for (const r of own.rows as Raw[]) {
    if (r.type === "formula" && !r.has_range && !r.reader_scoped) continue;
    get(r);
  }
  return [...out.values()];
}

async function loadColumnInfo(db: Executor, tableIds: string[]): Promise<Map<string, ColInfo>> {
  const res = await db.execute(sql`SELECT table_id, key, type, config FROM dh_columns WHERE /*scope:system*/ table_id = ANY(${`{${tableIds.join(",")}}`}::uuid[]) AND deleted_at IS NULL`);
  return new Map((res.rows as Raw[]).map((r) => [`${r.table_id}:${r.key}`, { type: r.type as string, config: (r.config as Record<string, unknown>) ?? {} }]));
}

/** Keys of the cells whose value (or error) differs between the old and the new data. An error marker `!k` counts as `k`. */
export function changedKeys(c: Pick<RowChange, "old" | "new" | "keys">): Set<string> {
  if (c.keys) return new Set(c.keys);
  const o = c.old ?? {};
  const n = c.new ?? {};
  const out = new Set<string>();
  for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null)) out.add(k.startsWith("!") ? k.slice(1) : k);
  }
  return out;
}

const intersects = (a: Set<string>, b: Iterable<string>): boolean => {
  for (const x of b) if (a.has(x)) return true;
  return false;
};

// ------------------------------------------------------------------------------------------------
// grouped calls: which groups a change touches
// ------------------------------------------------------------------------------------------------

const PLAIN_TYPES = new Set(["text", "long_text", "email", "phone", "url", "number", "currency", "percent", "rating", "auto_number"]);

/**
 * Columns whose raw stored value decides group equality. `plain`: text and numbers (the SQL key `soe_eqk` treats numbers
 * and numeric text alike, as `equalityKey` does). `date`: ISO date text (equal text = equal date). Anything else (selects
 * show a label, checkboxes are never blank, datetimes round) is not partial-capable: the whole column is recomputed.
 */
export function keyFamily(col: ColInfo | undefined): "plain" | "date" | null {
  if (!col) return null;
  const t = effectiveType(col);
  if (PLAIN_TYPES.has(t)) return "plain";
  if (t === "date") return "date";
  return null;
}

interface CallPlan {
  /** Source columns the call reads (keys and the aggregated column): a change in none of them cannot touch the call. */
  watch: Set<string>;
  positions: { srcKey: string; depKey: string | null }[];
}

/**
 * The calls of a formula that read the table, when ALL its reads of that table are grouped calls with equality keys
 * whose row side is a plain column (or a constant). Null = something else reads the table: recompute the whole column.
 */
export function callPlans(ast: Node, tableId: string, own: { tableId: string }, col: (table: string, key: string) => ColInfo | undefined): CallPlan[] | null {
  const covered = new Set<Node>();
  const plans: CallPlan[] = [];
  for (const g of findGroupable(ast)) {
    if (g.table !== tableId || g.keyColumns.length === 0) continue;
    const cols = g.keyColumns.map((k) => col(tableId, k));
    if (!cols.every((c) => isGroupKeyColumn(c as never))) continue;
    if (g.target !== null && !isPlainStoredColumn(col(tableId, g.target) as never)) continue;
    let ok = true;
    const positions: CallPlan["positions"] = [];
    g.keyNodes.forEach((n, i) => {
      const srcKey = g.keyColumns[i]!;
      if (n.t === "key" && n.table === null) {
        const fs = keyFamily(col(tableId, srcKey));
        const fd = keyFamily(col(own.tableId, n.key));
        if (!fs || fs !== fd) ok = false;
        positions.push({ srcKey, depKey: n.key });
      } else if (n.t === "num" || n.t === "str" || n.t === "bool") positions.push({ srcKey, depKey: null });
      else ok = false;
    });
    if (!ok || positions.every((p) => p.depKey === null)) continue;
    g.rangeNodes.forEach((n) => covered.add(n));
    plans.push({ watch: new Set([...g.keyColumns, ...(g.target ? [g.target] : [])]), positions });
  }
  let allCovered = true;
  walk(ast, (n) => {
    if (n.t === "key" && n.table === tableId && !covered.has(n)) allCovered = false;
  });
  return allCovered ? plans : null;
}

// ------------------------------------------------------------------------------------------------
// recording a change
// ------------------------------------------------------------------------------------------------

export interface RecordOptions {
  /** The worker's chain (a computed column changed): formulas that read only their own row are recomputed too (the API already did for a user's write). */
  includeApiFormulas?: boolean;
  /** The changes are of a reader-scoped column: group keys cannot be listed (values differ per reader), so a grouped read of it recomputes whole. */
  scopedSource?: boolean;
}

/**
 * Adds to the change queue what the given row changes may have changed in every computed column that depends on the
 * table. `seq` is the change sequence of the write. Returns the ids of the columns that were queued.
 */
export async function recordChanges(db: Executor, tableId: string, changes: RowChange[], seq: number, opts: RecordOptions = {}): Promise<string[]> {
  if (changes.length === 0) return [];
  const deps = await loadDependents(db, tableId);
  if (deps.length === 0) return [];
  const overflow = changes.length > CHAIN_LIMIT;
  const info = overflow ? new Map<string, ColInfo>() : await loadColumnInfo(db, [...new Set([tableId, ...deps.map((d) => d.tableId)])]);
  const colOf = (t: string, k: string) => info.get(`${t}:${k}`);
  const diffs = overflow ? [] : changes.map((c) => ({ c, keys: c.kind === "update" ? changedKeys(c) : null }));
  const entries: QueueEntry[] = [];
  // Under the split lock a row moving from one person to another changes what each member sees: the columns that read this table recompute for it.
  const lock = await db.execute(sql`SELECT key_split, key_columns FROM dh_tables WHERE /*scope:system*/ id = ${tableId}::uuid`);
  const lockRow = lock.rows[0] as { key_split: boolean; key_columns: string[] } | undefined;
  const lockKeys = new Set<string>(lockRow?.key_split ? lockRow.key_columns : []);

  for (const d of deps) {
    if (d.type === "formula" && !d.hasRange && !d.scoped && !opts.includeApiFormulas) continue;
    const push = (e: Omit<QueueEntry, "columnId" | "seq">) => entries.push({ columnId: d.id, seq, ...e });
    if (d.foreign && d.tableId !== tableId) {
      // The values of a column that reads another owner's table follow what its owner sees: any change that may reach what it reads recomputes the whole column.
      const reads = new Set<string>([...d.cellKeys, ...d.rangeKeys, ...(d.type === "formula" ? [] : [d.config.target_key as string]), ...lockKeys]);
      if (overflow || changes.some((c) => c.kind !== "update" || intersects(changedKeys(c), reads))) push({ mode: "full" });
      continue;
    }
    if (overflow) {
      push({ mode: "full" });
      continue;
    }
    // Rows of the column's own table: a new or restored row needs its value; a changed cell it reads changes its value.
    if (d.tableId === tableId) {
      const reads = new Set(d.type === "formula" ? d.cellKeys : [d.config.relation_key as string]);
      if (d.scoped) lockKeys.forEach((k) => reads.add(k));
      const ids = diffs.filter(({ c, keys }) => c.kind === "insert" || c.kind === "restore" || (c.kind === "update" && intersects(keys!, reads))).map(({ c }) => c.rowId);
      if (ids.length) push({ mode: "rows", rowIds: ids });
    }
    if (d.type === "lookup" || d.type === "rollup") {
      if (d.config.target_table_id === tableId) {
        const tk = d.config.target_key as string;
        const ids = diffs.filter(({ c, keys }) => c.kind === "delete" || c.kind === "restore" || (c.kind === "update" && (keys!.has(tk) || intersects(keys!, lockKeys)))).map(({ c }) => c.rowId);
        if (ids.length) push({ mode: "linked", rowIds: ids });
      }
      continue;
    }
    if (d.rangeKeys.size === 0) continue;
    if (opts.scopedSource) {
      push({ mode: "full" });
      continue;
    }
    const relevant = diffs.filter(({ c, keys }) => c.kind !== "update" || intersects(keys!, d.rangeKeys) || intersects(keys!, lockKeys));
    if (relevant.length === 0) continue;
    const ast = typeof d.config.expr === "string" ? parsedExpr(d.config.expr) : null;
    const plans = ast ? callPlans(ast, tableId, { tableId: d.tableId }, colOf) : null;
    if (!plans) {
      push({ mode: "full" });
      continue;
    }
    let full = false;
    for (const cp of plans) {
      const cols = cp.positions.filter((p) => p.depKey !== null);
      const tuples = new Map<string, unknown[]>();
      for (const { c, keys } of relevant) {
        if (c.kind === "update" && !intersects(keys!, cp.watch) && !intersects(keys!, lockKeys)) continue;
        for (const data of [c.old, c.new]) {
          if (!data) continue;
          // An error in a key cell is its own group in the formula engine; do not try to be clever.
          if (cp.positions.some((p) => `!${p.srcKey}` in data)) full = true;
          const tuple = cols.map((p) => data[p.srcKey] ?? null);
          tuples.set(JSON.stringify(tuple), tuple);
        }
      }
      if (tuples.size === 0) continue;
      const keys: KeyTuples = { cols: cols.map((p) => p.depKey!), tuples: [...tuples.values()] };
      push({ mode: "keys", keys });
    }
    if (full) push({ mode: "full" });
  }
  await enqueue(db, entries);
  return [...new Set(entries.map((e) => e.columnId))];
}

/** Every dependant of the given columns recomputes its whole column (too many changes to list, or a change that cannot be listed). */
export async function requestDependentsFull(db: Executor, tableId: string, keys: string[], seq: number, opts: RecordOptions = {}): Promise<string[]> {
  if (keys.length === 0) return [];
  const res = await db.execute(sql`SELECT DISTINCT c.id FROM dh_formula_deps f JOIN dh_columns c ON c.id = f.column_id
    WHERE /*scope:system*/ c.deleted_at IS NULL AND f.src_table_id = ${tableId}::uuid AND f.src_key = ANY(${`{${keys.join(",")}}`}::text[])
    ${opts.includeApiFormulas ? sql`` : sql`AND (c.type <> 'formula' OR c.reader_scoped OR EXISTS (SELECT 1 FROM dh_formula_deps r WHERE r.column_id = c.id AND r.kind = 'range'))`}`);
  const ids = (res.rows as { id: string }[]).map((r) => r.id);
  await enqueue(db, ids.map((columnId) => ({ columnId, seq, mode: "full" as const })));
  return ids;
}


