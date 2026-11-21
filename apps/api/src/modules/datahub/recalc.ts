import { sql, type SQL } from "drizzle-orm";
import {
  equalityKey,
  evaluate,
  FError,
  NOT_FOUND,
  parseFormula,
  RangeValue,
  serialToInstant,
  todaySerial,
  type EvalContext,
  type GroupableCall,
  type GroupPlan,
  type Node,
  type Scalar,
  type Value,
} from "@soe/formula";
import { DH_AUTO_INDEX_MIN_ROWS } from "@soe/shared";
import { enqueueOutbox, newId, type Db, type Executor } from "@soe/db";
import { readSetting } from "../system/settings-catalog";
import { DH_SETTINGS } from "./limits";
import { columnTx, deleteQueue, enqueue, flushTouches, lockColumnsAtFlush, linkedRows, nextChangeSeq, readQueue, type KeyTuples, type QueuedRow } from "./change-queue";
import { recordChanges, requestDependentsFull, CHAIN_LIMIT, keyFamily, type RowChange } from "./partial";
import type { Logger } from "pino";
import type { Subscriber } from "../../core/outbox-dispatcher";
import { applyOutcome, cellValue, effectiveType, errKey, isComputedType, resultTypeOf, valueToStored, type ResultType, type StoreOutcome } from "./cell-values";
import { groupableCalls, OwnerIndex, scanRangeNodes, SCAN_ROW_LIMIT } from "./computed";
import { columnFromDb, rowFromDb } from "./table-schema";
import { assertColumnKey, type DhColumn, type Stored } from "./types";
import type { LoadedRow } from "./column-source";
import { keyMatch } from "./access";
import { dropPersonalValues, idsOf, membersOf, overlayRel, refreshReaderScoped } from "./reader-scope";

type Raw = Record<string, unknown>;
export const FORMULA_EVENT = "datahub.formula.recalculated";
const BATCH = 2000;
/** A change event lists at most this many rows (design module2 section 6.7). */
export const EVENT_ROWS = 500;
/** More affected rows than this share of the table: recomputing the whole column is cheaper (design module2 section 6.7). */
export const PARTIAL_MAX_RATIO = 0.2;

// ================================================================================================
// marking columns for recalculation
// ================================================================================================

/**
 * Asks for the whole column to be recomputed (creating or editing a formula, structure changes, TODAY()/NOW()...). It is
 * an entry like any other in the change queue (mode `full`), so it accumulates with the partial changes of the same burst.
 */
export async function markPending(db: Executor, columnIds: string[]): Promise<void> {
  if (columnIds.length === 0) return;
  const alive = await db.execute(sql`SELECT id, table_id, key FROM dh_columns WHERE /*scope:system*/ deleted_at IS NULL AND id = ANY(${`{${columnIds.join(",")}}`}::uuid[])`);
  const rows = alive.rows as Raw[];
  if (rows.length === 0) return;
  const seq = await nextChangeSeq(db);
  await enqueue(db, rows.map((r) => ({ columnId: r.id as string, seq, mode: "full" as const })));
  const byTable = new Map<string, string[]>();
  for (const r of rows) byTable.set(r.table_id as string, [...(byTable.get(r.table_id as string) ?? []), r.key as string]);
  for (const [tableId, columns] of byTable) {
    await enqueueOutbox(db, { event: FORMULA_EVENT, aggregateType: "datahub_table", aggregateId: tableId, payload: { table_id: tableId, columns, state: "pending", changes: [], changed_rows: 0, seq } });
  }
}

const ids = (rows: unknown[]) => (rows as { id: string }[]).map((r) => r.id);

/** Computed columns that read ANY column of the given tables. */
async function readersOfTables(db: Executor, tableIds: string[]): Promise<string[]> {
  if (tableIds.length === 0) return [];
  const res = await db.execute(sql`SELECT DISTINCT c.id FROM dh_formula_deps f JOIN dh_columns c ON c.id = f.column_id
    WHERE /*scope:system*/ c.deleted_at IS NULL AND f.src_table_id = ANY(${`{${tableIds.join(",")}}`}::uuid[])`);
  return ids(res.rows);
}

async function computedColumnsOf(db: Executor, tableIds: string[]): Promise<string[]> {
  const res = await db.execute(sql`SELECT c.id FROM dh_columns c WHERE /*scope:system*/ c.table_id = ANY(${`{${tableIds.join(",")}}`}::uuid[]) AND c.deleted_at IS NULL AND c.type IN ('formula', 'lookup', 'rollup')`);
  return ids(res.rows);
}

async function tablesOfDatahub(db: Executor, datahubId: string): Promise<string[]> {
  const res = await db.execute(sql`SELECT id FROM dh_tables WHERE /*scope:system*/ datahub_id = ${datahubId}::uuid`);
  return ids(res.rows);
}

/**
 * Outbox listener for STRUCTURE changes (column or table deleted/restored, type changed, owner changed): the computed
 * columns that read them recompute whole. Changes to rows do not come through here: the write itself queues what it
 * changed (design module2 section 6.7), in its own transaction, with the old values it knows.
 */
export const formulaSubscriber: Subscriber = {
  name: "datahub.formula",
  match: (e) => e === "datahub.structure.changed" || e === "datahub.share.changed" || e === "org.member.changed",
  async handle(ev, db) {
    if (ev.event === "datahub.share.changed") return onShareChanged(db, ev.payload as { datahub_id: string; grantee_id: string });
    if (ev.event === "org.member.changed") return markPending(db, await readerScopedColumns(db, null));
    const p = ev.payload as { table_id?: string; datahub_id?: string; change?: string };
    const marks = new Set<string>();
    const change = p.change ?? "";
    const tableIds = p.table_id ? [p.table_id] : p.datahub_id ? await tablesOfDatahub(db, p.datahub_id) : [];
    if (["column_deleted", "column_restored", "column_type_changed", "table_deleted", "table_restored", "datahub_deleted", "datahub_restored", "owner_changed"].includes(change)) {
      (await readersOfTables(db, tableIds)).forEach((x) => marks.add(x));
      if (["column_restored", "table_restored", "datahub_restored", "owner_changed", "column_type_changed"].includes(change)) (await computedColumnsOf(db, tableIds)).forEach((x) => marks.add(x));
    }
    // Columns that read a deleted/restored/retyped column or table may have changed what makes them reader-scoped.
    if (p.datahub_id && ["column_deleted", "column_restored", "column_type_changed", "table_deleted", "table_restored", "datahub_restored"].includes(change)) {
      const owner = await db.execute(sql`SELECT owner_id FROM dh_datahubs WHERE /*scope:system*/ id = ${p.datahub_id}::uuid`);
      const ownerId = (owner.rows[0] as { owner_id: string } | undefined)?.owner_id;
      if (ownerId) {
        const f = await refreshReaderScoped(db, ownerId);
        [...f.became, ...f.stopped].forEach((x) => marks.add(x));
      }
    }
    await markPending(db, [...marks]);
  },
};

/** Reader-scoped columns of a datahub (null = of every datahub). */
export async function readerScopedColumns(db: Executor, datahubId: string | null): Promise<string[]> {
  const res = await db.execute(sql`SELECT c.id FROM dh_columns c JOIN dh_tables t ON t.id = c.table_id
    WHERE /*scope:system*/ c.reader_scoped AND c.deleted_at IS NULL AND t.deleted_at IS NULL ${datahubId ? sql`AND t.datahub_id = ${datahubId}::uuid` : sql``}`);
  return ids(res.rows);
}

/**
 * A share was added, changed or removed: a person who is no longer a member forgets their personal values; for everyone else the reader-scoped
 * columns of the datahub recompute (a new member needs their values; the others lose nothing).
 */
async function onShareChanged(db: Executor, p: { datahub_id: string; grantee_id: string }): Promise<void> {
  const still = await db.execute(sql`SELECT 1 FROM dh_shares WHERE /*scope:system*/ datahub_id = ${p.datahub_id}::uuid AND grantee_id = ${p.grantee_id}::uuid LIMIT 1`);
  if (still.rows.length === 0) await dropPersonalValues(db, p.datahub_id, p.grantee_id);
  else await markPending(db, await readerScopedColumns(db, p.datahub_id));
}

// ================================================================================================
// volatile columns: TODAY() daily at 00:05, NOW() hourly (with catch-up)
// ================================================================================================

/** The most recent moment a TODAY() column should have been refreshed: 00:05 Vietnam time. */
export function lastDailyBoundary(now: Date): Date {
  const today = todaySerial(now);
  let b = serialToInstant(today + 5 / 1440);
  if (b > now.getTime()) b = serialToInstant(today - 1 + 5 / 1440);
  return new Date(b);
}

export const lastHourBoundary = (now: Date): Date => new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);

/** Marks TODAY()/NOW() columns whose values are older than their last due time. Used by the schedule and when the worker starts (catch-up). */
export async function markVolatilePending(db: Db, now: Date = new Date()): Promise<number> {
  const res = await db.execute(sql`UPDATE dh_columns SET calc_status = 'pending', calc_requested_at = clock_timestamp()
    WHERE /*scope:system*/ id IN (SELECT id FROM dh_columns WHERE deleted_at IS NULL AND calc_status = 'ready' AND (
      (calc_volatile = 'today' AND (calc_at IS NULL OR calc_at < ${lastDailyBoundary(now).toISOString()}::timestamptz)) OR
      (calc_volatile = 'now' AND (calc_at IS NULL OR calc_at < ${lastHourBoundary(now).toISOString()}::timestamptz))) ORDER BY id FOR UPDATE)
    RETURNING id`);
  return res.rows.length;
}

/** After a crash a column can stay `running`: put them back in the queue (worker start). */
export async function resetRunningColumns(db: Db): Promise<number> {
  const res = await db.execute(sql`UPDATE dh_columns SET calc_status = 'pending', calc_requested_at = clock_timestamp()
    WHERE /*scope:system*/ id IN (SELECT id FROM dh_columns WHERE calc_status = 'running' ORDER BY id FOR UPDATE) RETURNING id`);
  return res.rows.length;
}

// ================================================================================================
// the engine: recompute one column
// ================================================================================================

interface Job {
  col: DhColumn;
  tableId: string;
  datahubId: string;
  ownerId: string;
  alive: boolean;
}

async function loadJob(db: Executor, columnId: string): Promise<Job | null> {
  const res = await db.execute(sql`SELECT c.*, t.datahub_id, t.deleted_at AS t_deleted, d.owner_id, d.deleted_at AS d_deleted
    FROM dh_columns c JOIN dh_tables t ON t.id = c.table_id JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ c.id = ${columnId}::uuid`);
  const r = res.rows[0] as Raw | undefined;
  if (!r) return null;
  return { col: columnFromDb(r), tableId: r.table_id as string, datahubId: r.datahub_id as string, ownerId: r.owner_id as string, alive: !r.deleted_at && !r.t_deleted && !r.d_deleted };
}

/** What a table reference in a formula is worth right now: usable, deleted (`#REF!`) or of another owner (`#PERM!`). */
async function refProblems(db: Executor, ix: OwnerIndex, tableIds: string[]): Promise<Map<string, FError>> {
  const out = new Map<string, FError>();
  const missing = tableIds.filter((t) => !ix.tableById.has(t));
  if (missing.length === 0) return out;
  const res = await db.execute(sql`SELECT t.id, t.deleted_at AS t_del, d.deleted_at AS d_del FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id
    WHERE /*scope:system*/ t.id = ANY(${`{${missing.join(",")}}`}::uuid[])`);
  const found = new Map((res.rows as Raw[]).map((r) => [r.id as string, !r.t_del && !r.d_del]));
  for (const t of missing) {
    // Exists and alive but not in the owner's index = belongs to someone else.
    if (found.get(t)) out.set(t, new FError("#PERM!", "Bảng không thuộc cùng chủ với bảng chứa công thức."));
    else out.set(t, new FError("#REF!", "Bảng được tham chiếu đã bị xoá."));
  }
  return out;
}

// ---- one reader -----------------------------------------------------------------------------------------

/**
 * A member who is not the owner, for a reader-scoped column (design module2 section 10): their value is computed over the rows of the
 * split-lock tables THEY see (themselves and the people they manage in the current tree) and stored apart from the owner's.
 */
export interface Reader {
  userId: string;
  ids: string[];
}

/**
 * How a table is read for a computation: `from` goes after `FROM` (alias `dh_rows`), `cond` is ANDed to the WHERE. The owner (`reader` null)
 * reads `dh_rows` as it is. A reader of a table with the split lock sees only their rows; the reader-scoped columns of that table hold THEIR values.
 */
export function sourceView(ix: OwnerIndex, tableId: string, reader: Reader | null): { from: SQL; cond: SQL } {
  const t = ix.tableById.get(tableId);
  // A template table of someone else is read as the OWNER of the column reads it (their rows, their own person cells), whoever the pass is for.
  if (t?.foreign) reader = ix.ownerReader;
  // The owner reads every row of their own table, with their OWN values of the person-stored columns laid over (what the grid shows them).
  if (!reader && t?.columns.some((c) => c.storage === "person") && ix.ownerId) return { from: overlayRel(tableId, ix.ownerId, [], null, true), cond: sql`true` };
  if (!reader || !t) return { from: sql`dh_rows`, cond: sql`true` };
  const scoped = t.columns.filter((c) => c.readerScoped).map((c) => c.key);
  const withPerson = t.columns.some((c) => c.storage === "person");
  const keep = t.split.enabled ? keyMatch(t.split.keys, reader.ids, "r") : null;
  return { from: scoped.length || withPerson ? overlayRel(tableId, reader.userId, scoped, keep, withPerson) : sql`dh_rows`, cond: t.split.enabled ? keyMatch(t.split.keys, reader.ids) : sql`true` };
}

// ---- grouped plans -------------------------------------------------------------------------------------

interface Acc {
  n: number;
  nn: number;
  s: number;
  mn: number | null;
  mx: number | null;
  nb: number;
  /** First error cell (by row number) of the aggregated column among the rows of the group. */
  err?: { rowNo: number; code: string };
  rowNo?: number;
  v?: Value;
}

const SEP = "\u0001";

function numExpr(col: { key: string; type: string; config: Record<string, unknown> }) {
  const k = assertColumnKey(col.key);
  const t = effectiveType(col);
  if (t === "date") return sql.raw(`CASE WHEN jsonb_typeof(data->'${k}') = 'string' AND data->>'${k}' ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (soe_date(data->>'${k}') - DATE '1899-12-30') END`);
  if (t === "datetime") return sql.raw(`CASE WHEN jsonb_typeof(data->'${k}') = 'string' THEN (EXTRACT(EPOCH FROM soe_ts(data->>'${k}'))::numeric + 25200) / 86400 + 25569 END`);
  return sql.raw(`CASE WHEN jsonb_typeof(data->'${k}') = 'number' THEN (data->>'${k}')::numeric END`);
}

const stubRow = (data: Record<string, Stored>): LoadedRow => ({ id: "", rowNo: 0, version: 0, data, createdAt: new Date(0), createdBy: null, updatedAt: new Date(0), updatedBy: null });

/** Equality key of a source column as SQL (`soe_eqk`, migration 0007), or null when the column cannot be filtered that way. */
function sourceKeyExpr(col: { key: string; type: string; config: Record<string, unknown> }): SQL | null {
  const k = assertColumnKey(col.key);
  const f = keyFamily(col);
  if (f === "plain") return sql.raw(`soe_eqk(data->'${k}')`);
  if (f === "date") return sql.raw(`soe_eqk(to_jsonb(CASE WHEN jsonb_typeof(data->'${k}') = 'string' AND data->>'${k}' ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (soe_date(data->>'${k}') - DATE '1899-12-30') END))`);
  return null;
}

/**
 * Answers the rows of the table from one grouped SQL query (design module2 section 6.6). With `restrict` (per key
 * position: the JSON key values the rows being recomputed look up), only the source rows that may belong to those groups
 * are read (design module2 section 6.7); a group is always complete, extra rows only fill groups nobody asks for.
 */
async function buildPlan(db: Executor, ix: OwnerIndex, g: GroupableCall, restrict: string[][] | null = null, reader: Reader | null = null): Promise<GroupPlan> {
  const view = sourceView(ix, g.table, reader);
  const keyCols = g.keyColumns.map((k) => ix.column(g.table, k)!);
  const keyOf = (rawKeys: unknown[]): string | null => {
    const parts: string[] = [];
    for (let i = 0; i < keyCols.length; i++) {
      const c = keyCols[i]!;
      const raw = rawKeys[i];
      if (raw === null || raw === undefined) {
        if (g.kind === "lookup") return null;
        parts.push(equalityKey(null));
        continue;
      }
      const v = cellValue(c as unknown as DhColumn, stubRow({ [c.key]: raw as Stored }));
      parts.push(equalityKey(v as Scalar));
    }
    return parts.join(SEP);
  };
  const keySelect = keyCols.map((c, i) => sql.raw(`data->'${assertColumnKey(c.key)}' AS k${i}`));
  let where = sql`/*scope:system*/ table_id = ${g.table}::uuid AND deleted_at IS NULL`;
  if (restrict) {
    keyCols.forEach((c, i) => {
      where = sql`${where} AND ${sourceKeyExpr(c)!} = ANY(ARRAY(SELECT soe_eqk(x::jsonb) FROM unnest(${`{${restrict[i]!.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`}::text[]) x))`;
    });
  }
  const target = g.target ? ix.column(g.table, g.target)! : null;
  const map = new Map<string, Acc>();

  if (g.kind === "criteria") {
    const parts = [...keySelect, sql`count(*)::float8 AS n`];
    if (target) {
      const num = numExpr(target);
      const k = assertColumnKey(target.key);
      parts.push(sql`count(${num})::float8 AS nn`, sql`coalesce(sum(${num}), 0)::float8 AS s`, sql`min(${num})::float8 AS mn`, sql`max(${num})::float8 AS mx`);
      // COUNTA counts error cells (Excel), so a cell with an error key counts as non-blank.
      parts.push(sql`count(*) FILTER (WHERE ${sql.raw(`(data->'${k}' IS NOT NULL AND data->>'${k}' <> '') OR data ? '${errKey(k)}'`)})::float8 AS nb`);
      // The first error cell by row number: sum, average, min and max return it (Excel propagates errors).
      parts.push(sql`min(row_no) FILTER (WHERE ${sql.raw(`data ? '${errKey(k)}'`)})::float8 AS er`, sql`(array_agg(${sql.raw(`data->>'${errKey(k)}'`)} ORDER BY row_no) FILTER (WHERE ${sql.raw(`data ? '${errKey(k)}'`)}))[1] AS ec`);
    }
    const groupBy = keyCols.length ? sql`GROUP BY ${sql.join(keyCols.map((c) => sql.raw(`data->'${assertColumnKey(c.key)}'`)), sql`, `)}` : sql``;
    const res = await db.execute(sql`SELECT ${sql.join(parts, sql`, `)} FROM ${view.from} dh_rows WHERE ${where} AND ${view.cond} ${groupBy}`);
    for (const r of res.rows as Raw[]) {
      const key = keyOf(keyCols.map((_, i) => r[`k${i}`]));
      if (key === null) continue;
      const a = map.get(key) ?? { n: 0, nn: 0, s: 0, mn: null, mx: null, nb: 0 };
      a.n += Number(r.n);
      a.nn += Number(r.nn ?? 0);
      a.s += Number(r.s ?? 0);
      if (r.mn !== null && r.mn !== undefined) a.mn = a.mn === null ? Number(r.mn) : Math.min(a.mn, Number(r.mn));
      if (r.mx !== null && r.mx !== undefined) a.mx = a.mx === null ? Number(r.mx) : Math.max(a.mx, Number(r.mx));
      a.nb += Number(r.nb ?? 0);
      if (r.er !== null && r.er !== undefined && (!a.err || Number(r.er) < a.err.rowNo)) a.err = { rowNo: Number(r.er), code: String(r.ec) };
      map.set(key, a);
    }
    const zero: Acc = { n: 0, nn: 0, s: 0, mn: null, mx: null, nb: 0 };
    const answer = (a: Acc): Value => {
      if (a.err && (g.agg === "sum" || g.agg === "avg" || g.agg === "min" || g.agg === "max")) return new FError(a.err.code as never);
      switch (g.agg) {
        case "count":
          return a.n;
        case "count_num":
          return a.nn;
        case "counta":
          return a.nb;
        case "sum":
          return a.s;
        case "avg":
          return a.nn > 0 ? a.s / a.nn : new FError("#DIV/0!");
        case "min":
          return a.mn ?? 0;
        case "max":
          return a.mx ?? 0;
        default:
          return null;
      }
    };
    return { kind: "criteria", keyNodes: g.keyNodes, lookup: (keys) => answer(map.get(keys.map((k) => equalityKey(k)).join(SEP)) ?? zero) };
  }

  // lookup: the first row (by row number) of each key
  const k0 = keyCols.map((c) => assertColumnKey(c.key));
  const tk = assertColumnKey(target!.key);
  const notNull = sql.raw(k0.map((k) => `data->'${k}' IS NOT NULL`).join(" AND "));
  const res = await db.execute(sql`SELECT DISTINCT ON (${sql.join(k0.map((k) => sql.raw(`data->'${k}'`)), sql`, `)}) ${sql.join(keySelect, sql`, `)}, row_no::float8 AS row_no,
      ${sql.raw(`data->'${tk}'`)} AS v, ${sql.raw(`data->>'${errKey(tk)}'`)} AS e
    FROM ${view.from} dh_rows WHERE ${where} AND ${view.cond} AND ${notNull} ORDER BY ${sql.join(k0.map((k) => sql.raw(`data->'${k}'`)), sql`, `)}, row_no`);
  for (const r of res.rows as Raw[]) {
    const key = keyOf(keyCols.map((_, i) => r[`k${i}`]));
    if (key === null) continue;
    const prev = map.get(key);
    if (prev && prev.rowNo! <= Number(r.row_no)) continue;
    const data: Record<string, Stored> = {};
    if (r.v !== null && r.v !== undefined) data[target!.key] = r.v as Stored;
    if (r.e) (data as Record<string, unknown>)[errKey(target!.key)] = r.e;
    map.set(key, { n: 0, nn: 0, s: 0, mn: null, mx: null, nb: 0, rowNo: Number(r.row_no), v: cellValue(target as unknown as DhColumn, stubRow(data)) });
  }
  return {
    kind: "lookup",
    keyNodes: g.keyNodes,
    notFoundArg: g.notFoundArg,
    lookup: (keys) => {
      const a = map.get(keys.map((k) => equalityKey(k)).join(SEP));
      return a ? a.v! : NOT_FOUND;
    },
  };
}

/** Loads one whole column for in-memory scans (conditions SQL cannot answer). Too large: every read of it is an error. */
async function loadScanColumn(db: Executor, ix: OwnerIndex, tableId: string, key: string, reader: Reader | null = null): Promise<Value[] | FError> {
  const view = sourceView(ix, tableId, reader);
  const t = ix.tableById.get(tableId)!;
  const col = ix.column(tableId, key);
  if (!col) return new FError("#REF!", "Cột được tham chiếu đã bị xoá.");
  if (t.rowCount > SCAN_ROW_LIMIT) return new FError("#VALUE!", `Bảng "${t.name}" quá lớn (${t.rowCount} dòng) để duyệt từng dòng.`);
  const out: Value[] = [];
  let last = 0;
  for (;;) {
    const res = await db.execute(sql`SELECT id, row_no, data, created_at, created_by, updated_at, updated_by FROM ${view.from} dh_rows
      WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND ${view.cond} AND row_no > ${last}::int ORDER BY row_no LIMIT ${BATCH}`);
    const rows = res.rows as Raw[];
    if (rows.length === 0) break;
    for (const r of rows) out.push(cellValue(col as unknown as DhColumn, rowFromDb(r)));
    last = rows[rows.length - 1]!.row_no as number;
    if (rows.length < BATCH) break;
  }
  return out;
}

// ---- formula column --------------------------------------------------------------------------------------

/** One cell of a computed column as the change feed shows it: the value, or `{error: code}`. */
type Cell = unknown;
const cellOf = (value: unknown, error: unknown): Cell => (error ? { error } : (value ?? null));

export interface CellChange {
  rowId: string;
  oldValue: unknown;
  oldError: unknown;
  newValue: unknown;
  newError: unknown;
}

/** What one recomputation of a column did. `rows` is null when there were too many changes to keep a list. */
export interface RecalcResult {
  changedRows: number;
  total: number;
  partial: boolean;
  /** Rows whose stored value changed, as source changes for the columns that read this one. Null = over `CHAIN_LIMIT`. */
  rows: RowChange[] | null;
  /** The column is reader-scoped: `rows` only name the rows (their old and new values differ per reader). */
  scoped?: boolean;
}

async function writePatches(db: Executor, tableId: string, key: string, patches: { id: string; patch: Record<string, unknown> }[]): Promise<void> {
  if (patches.length === 0) return;
  // Only this column's value and error keys are replaced, on the CURRENT data of the row: a concurrent user edit of
  // another cell is never overwritten. No version, no updated_at, no history, no audit (design module2 section 6.5).
  await db.execute(sql`UPDATE dh_rows r SET data = (r.data - ARRAY[${key}::text, ${errKey(key)}::text]) || v.patch
    FROM jsonb_to_recordset(${JSON.stringify(patches)}::jsonb) AS v(id uuid, patch jsonb)
    WHERE /*scope:system*/ r.table_id = ${tableId}::uuid AND r.id = v.id`);
}

/** A reader's own values of a reader-scoped column (`dh_personal_rows`). Same rule as `writePatches`: only this column's keys are replaced; no history, no audit. */
async function writePersonal(db: Executor, tableId: string, userId: string, key: string, patches: { id: string; patch: Record<string, unknown> }[]): Promise<void> {
  if (patches.length === 0) return;
  await db.execute(sql`INSERT INTO dh_personal_rows (row_id, user_id, table_id, data)
    SELECT v.id, ${userId}::uuid, ${tableId}::uuid, v.patch FROM jsonb_to_recordset(${JSON.stringify(patches)}::jsonb) AS v(id uuid, patch jsonb)
    ON CONFLICT (row_id, user_id) DO UPDATE SET data = (dh_personal_rows.data - ARRAY[${key}::text, ${errKey(key)}::text]) || EXCLUDED.data`);
}

/** Collects what a recomputation changed: the change feed (events of at most 500 rows) and the source changes for dependants. */
class Changes {
  count = 0;
  /** Ids of the rows whose stored value changed (for the chain of a reader-scoped column). */
  readonly touched = new Set<string>();
  private rows: RowChange[] | null = [];
  constructor(
    private readonly job: Job,
    private readonly seq: number,
    /** Set: this recomputation is for ONE member (their values go to `dh_personal_rows`, the event goes to them only). */
    private readonly reader: Reader | null = null,
  ) {}

  /** Writes a batch of patches and, in the SAME transaction, its change events (design module2 section 6.7). */
  async commit(db: Db, batch: { row: LoadedRow; data: Record<string, Stored>; patch: Record<string, unknown> }[]): Promise<void> {
    if (batch.length === 0) return;
    const col = this.job.col;
    const ek = errKey(col.key);
    await db.transaction(async (tx) => {
      const patches = batch.map((b) => ({ id: b.row.id, patch: b.patch }));
      if (this.reader) await writePersonal(tx, this.job.tableId, this.reader.userId, col.key, patches);
      else await writePatches(tx, this.job.tableId, col.key, patches);
      // One statement for all the events of the batch (at most 500 cells each).
      const events: { id: string; payload: unknown }[] = [];
      for (let i = 0; i < batch.length; i += EVENT_ROWS) {
        const part = batch.slice(i, i + EVENT_ROWS);
        const changes = part.map((b) => ({ row_id: b.row.id, column: col.key, old: cellOf(b.row.data[col.key], (b.row.data as Raw)[ek]), new: cellOf(b.data[col.key], (b.data as Raw)[ek]) }));
        events.push({ id: newId(), payload: { table_id: this.job.tableId, columns: [col.key], state: "changed", changes, changed_rows: part.length, seq: this.seq, ...(this.reader ? { reader: this.reader.userId } : {}) } });
      }
      await tx.execute(sql`INSERT INTO outbox (id, event, aggregate_type, aggregate_id, payload)
        SELECT v.id, ${FORMULA_EVENT}, 'datahub_table', ${this.job.tableId}, v.payload FROM jsonb_to_recordset(${JSON.stringify(events)}::jsonb) AS v(id uuid, payload jsonb)`);
    });
    this.count += batch.length;
    for (const b of batch) this.touched.add(b.row.id);
    if (this.rows) {
      for (const b of batch) this.rows.push({ rowId: b.row.id, kind: "update", old: b.row.data, new: b.data });
      if (this.rows.length > CHAIN_LIMIT) this.rows = null;
    }
  }

  get changes(): RowChange[] | null {
    return this.rows;
  }
}

/** What a formula needs to run over the rows of a table: plans for grouped calls, scanned columns, and a context that follows `setRow`. */
export interface FormulaEnv {
  ctx: EvalContext;
  setRow(row: LoadedRow): void;
}

/**
 * `rows` = the rows about to be computed (a partial recomputation, or the 5-row preview). Each grouped call then reads only
 * the source rows of the groups those rows look up, instead of grouping the whole source table (design module2 section 6.7).
 * Without `rows` the plans cover the whole table (the full-column recomputation).
 */
export async function buildFormulaEnv(db: Executor, ix: OwnerIndex, tableId: string, ast: Node | null, now: Date, rows?: LoadedRow[], reader: Reader | null = null): Promise<FormulaEnv> {
  // Columns of this table as engine columns (the row loader needs the full DhColumn shape).
  const full = await db.execute(sql`SELECT * FROM dh_columns WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL`);
  const colsByKey = new Map((full.rows as Raw[]).map(columnFromDb).map((c) => [c.key, c]));

  const refTables = new Set<string>();
  if (ast) {
    const visit = (n: Node) => {
      if (n.t === "key" && n.table) refTables.add(n.table);
      else if (n.t === "call") n.args.forEach(visit);
      else if (n.t === "un" || n.t === "pct") visit(n.a);
      else if (n.t === "bin") {
        visit(n.l);
        visit(n.r);
      }
    };
    visit(ast);
  }
  const problems = await refProblems(db, ix, [...refTables]);
  const refError = (table: string, key: string): FError | null => {
    const p = problems.get(table);
    if (p) return p;
    if (!ix.column(table, key)) return new FError("#REF!", "Cột được tham chiếu đã bị xoá.");
    return null;
  };

  let current: LoadedRow = stubRow({});
  const cellOfRow = (key: string) => {
    const c = colsByKey.get(key);
    if (!c) throw new FError("#REF!", "Cột được tham chiếu đã bị xoá.");
    return cellValue(c, current);
  };
  const rowInfo = () => ({ id: current.id, rowNo: current.rowNo, createdAt: cellValue({ type: "created_time", key: "_", config: {} } as DhColumn, current) as number, modifiedAt: cellValue({ type: "modified_time", key: "_", config: {} } as DhColumn, current) as number });

  /** The JSON key values of each position of a call that these rows look up; null when the call cannot be restricted. */
  const restrictFor = (g: GroupableCall): string[][] | null => {
    if (!rows || g.keyColumns.length === 0) return null;
    if (!g.keyColumns.every((k) => sourceKeyExpr(ix.column(g.table, k) as never))) return null;
    const probe: EvalContext = { now, cell: cellOfRow, range: () => { throw new FError("#REF!"); }, rowInfo };
    const sets = g.keyNodes.map(() => new Set<string>());
    const saved = current;
    try {
      for (const r of rows) {
        current = r;
        for (let i = 0; i < g.keyNodes.length; i++) {
          const v = evaluate(g.keyNodes[i]!, probe);
          if (v instanceof FError || Array.isArray(v) || (typeof v === "number" && !Number.isFinite(v))) return null;
          sets[i]!.add(JSON.stringify(v));
        }
      }
    } finally {
      current = saved;
    }
    return sets.map((x) => [...x]);
  };

  // Plans for grouped calls whose references are all usable.
  const plans = new Map<number, GroupPlan>();
  let scanNodes: Extract<Node, { t: "key" }>[] = [];
  if (ast) {
    const grouped = groupableCalls(ast, (t, k) => ix.column(t, k));
    scanNodes = scanRangeNodes(ast, grouped);
    for (const g of grouped) {
      const bad = problems.has(g.table) || [...g.keyColumns, ...(g.target ? [g.target] : [])].some((k) => refError(g.table, k));
      if (bad) continue;
      // The groups of this call are found (source side) and its rows are found by key (this side) with the equality-key index.
      for (const k of g.keyColumns) await requestEqkIndex(db, g.table, k, ix.tableById.get(g.table)?.rowCount ?? 0);
      for (const n of g.keyNodes) if (n.t === "key" && n.table === null) await requestEqkIndex(db, tableId, n.key, ix.tableById.get(tableId)?.rowCount ?? 0);
      plans.set(g.nodeId, await buildPlan(db, ix, g, restrictFor(g), reader));
    }
  }
  // Columns read by scans (and by the fallback of grouped calls on small tables), loaded once.
  const scan = new Map<string, Value[] | FError>();
  const wanted = new Set<string>();
  const addWanted = (table: string, key: string) => {
    if (!refError(table, key)) wanted.add(`${table}.${key}`);
  };
  scanNodes.forEach((n) => addWanted(n.table!, n.key));
  if (ast) {
    for (const g of groupableCalls(ast, (t, k) => ix.column(t, k))) {
      const t = ix.tableById.get(g.table);
      if (t && t.rowCount <= SCAN_ROW_LIMIT) for (const n of g.rangeNodes) addWanted(n.table!, n.key);
    }
  }
  for (const w of wanted) {
    const [t, k] = [w.slice(0, 36), w.slice(37)];
    scan.set(w, await loadScanColumn(db, ix, t, k, reader));
  }

  const ctx: EvalContext = {
    now,
    plans,
    cell: cellOfRow,
    range: (table, key) => {
      const bad = refError(table, key);
      if (bad) throw bad;
      const loaded = scan.get(`${table}.${key}`);
      if (!loaded) throw new FError("#VALUE!", "Cột này quá lớn để duyệt từng dòng; dùng điều kiện bằng (=) để tính bằng SQL.");
      if (loaded instanceof FError) throw loaded;
      return new RangeValue(table, key, () => loaded);
    },
    rowInfo,
  };
  return { ctx, setRow: (r) => { current = r; } };
}

// ---- which rows -------------------------------------------------------------------------------------------

/** `ids` null = the whole column. */
interface Scope {
  ids: string[] | null;
}

const ROW_SELECT = sql.raw("id, row_no, version, data, created_at, created_by, updated_at, updated_by");

/** The rows of a table to compute, in batches: all of them (paged by row number) or the given ids. */
async function* rowBatches(db: Executor, tableId: string, scope: Scope, view: { from: SQL; cond: SQL } = { from: sql`dh_rows`, cond: sql`true` }): AsyncGenerator<LoadedRow[]> {
  if (scope.ids) {
    for (let i = 0; i < scope.ids.length; i += BATCH) {
      const res = await db.execute(sql`SELECT ${ROW_SELECT} FROM ${view.from} dh_rows WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND ${view.cond}
        AND id = ANY(${`{${scope.ids.slice(i, i + BATCH).join(",")}}`}::uuid[]) ORDER BY row_no`);
      const rows = (res.rows as Raw[]).map(rowFromDb);
      if (rows.length) yield rows;
    }
    return;
  }
  let last = 0;
  for (;;) {
    const res = await db.execute(sql`SELECT ${ROW_SELECT} FROM ${view.from} dh_rows
      WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND ${view.cond} AND row_no > ${last}::int ORDER BY row_no LIMIT ${BATCH}`);
    const rows = (res.rows as Raw[]).map(rowFromDb);
    if (rows.length === 0) return;
    yield rows;
    last = rows[rows.length - 1]!.rowNo;
    if (rows.length < BATCH) return;
  }
}

const patchOf = (col: DhColumn, out: StoreOutcome): Record<string, unknown> => (out.kind === "value" ? { [col.key]: out.value } : out.kind === "error" ? { [errKey(col.key)]: out.code } : {});

async function recalcFormula(db: Db, job: Job, now: Date, progress: (done: number) => Promise<void>, scope: Scope, changes: Changes, reader: Reader | null = null): Promise<number> {
  const col = job.col;
  const ix = await OwnerIndex.load(db, job.ownerId);
  const parsed = typeof col.config.expr === "string" ? parseFormula(col.config.expr) : null;
  const resultType = resultTypeOf(col);
  const ast: Node | null = parsed && parsed.ok ? parsed.ast : null;
  // A full recomputation builds its plans once for the whole table; a partial one per batch, for just those rows.
  const whole = scope.ids === null ? await buildFormulaEnv(db, ix, job.tableId, ast, now, undefined, reader) : null;

  let total = 0;
  for await (const rows of rowBatches(db, job.tableId, scope, sourceView(ix, job.tableId, reader))) {
    const env = whole ?? (await buildFormulaEnv(db, ix, job.tableId, ast, now, rows, reader));
    const batch: { row: LoadedRow; data: Record<string, Stored>; patch: Record<string, unknown> }[] = [];
    for (const row of rows) {
      env.setRow(row);
      const out: StoreOutcome = !ast ? { kind: "error", code: "#NAME?" } : valueToStored(resultType, evaluate(ast, env.ctx));
      const data = { ...row.data };
      if (applyOutcome(data, col, out)) batch.push({ row, data, patch: patchOf(col, out) });
    }
    await changes.commit(db, batch);
    total += rows.length;
    await progress(total);
  }
  return total;
}

// ---- lookup and rollup ----------------------------------------------------------------------------------------

function rollup(fn: string, values: Scalar[]): Scalar {
  const nums = values.filter((v): v is number => typeof v === "number");
  const present = values.filter((v) => v !== null && v !== "");
  switch (fn) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "count":
      return nums.length;
    case "counta":
      return present.length;
    case "avg":
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case "min":
      return nums.length ? nums.reduce((m, x) => (x < m ? x : m)) : null;
    case "max":
      return nums.length ? nums.reduce((m, x) => (x > m ? x : m)) : null;
    case "countunique":
      return new Set(present.map((v) => equalityKey(v))).size;
    case "concat":
      return present.map((v) => String(v)).join(", ");
    default:
      return null;
  }
}

async function recalcLink(db: Db, job: Job, progress: (done: number) => Promise<void>, scope: Scope, changes: Changes, reader: Reader | null = null): Promise<number> {
  const col = job.col;
  const ix = await OwnerIndex.load(db, job.ownerId);
  const relKey = col.config.relation_key as string;
  const targetTable = col.config.target_table_id as string;
  const targetKey = col.config.target_key as string;
  const resultType = resultTypeOf(col);
  const problems = await refProblems(db, ix, [targetTable]);
  const targetCol = ix.column(targetTable, targetKey);
  const relCol = ix.column(job.tableId, relKey);
  const fatal: FError | null = problems.get(targetTable) ?? (!targetCol ? new FError("#REF!", "Cột được tham chiếu đã bị xoá.") : !relCol ? new FError("#REF!", "Cột liên kết đã bị xoá.") : null);
  const fullTarget = targetCol ? (await db.execute(sql`SELECT * FROM dh_columns WHERE /*scope:system*/ id = ${targetCol.id}::uuid`)).rows.map((r) => columnFromDb(r as Raw))[0] : undefined;
  const single = ix.column(job.tableId, relKey)?.config.multiple === false;

  const targetView = sourceView(ix, targetTable, reader);
  let total = 0;
  for await (const rows of rowBatches(db, job.tableId, scope, sourceView(ix, job.tableId, reader))) {
    const linkIds = new Set<string>();
    for (const r of rows) {
      const l = r.data[relKey];
      if (Array.isArray(l)) (l as string[]).forEach((x) => linkIds.add(x));
    }
    const targets = new Map<string, Scalar>();
    if (!fatal && linkIds.size && fullTarget) {
      const tres = await db.execute(sql`SELECT id, data, created_at, created_by, updated_at, updated_by FROM ${targetView.from} dh_rows
        WHERE /*scope:system*/ table_id = ${targetTable}::uuid AND deleted_at IS NULL AND ${targetView.cond} AND id = ANY(${`{${[...linkIds].join(",")}}`}::uuid[])`);
      for (const t of tres.rows as Raw[]) targets.set(t.id as string, cellValue(fullTarget, rowFromDb(t)));
    }
    const batch: { row: LoadedRow; data: Record<string, Stored>; patch: Record<string, unknown> }[] = [];
    for (const row of rows) {
      let out: StoreOutcome;
      if (fatal) out = { kind: "error", code: fatal.code };
      else {
        const links = Array.isArray(row.data[relKey]) ? (row.data[relKey] as string[]) : [];
        const values = links.filter((id) => targets.has(id)).map((id) => targets.get(id)!);
        // Same rule as the matching aggregate: sum, avg, min, max and concat return the first error; count, counta, countunique do not.
        const bad = ["count", "counta", "countunique"].includes(col.config.fn as string) && col.type === "rollup" ? undefined : (values.find((v) => v instanceof FError) as FError | undefined);
        if (bad) out = { kind: "error", code: bad.code };
        else if (col.type === "rollup") out = valueToStored(resultType as ResultType, rollup(col.config.fn as string, values));
        else if (single || values.length <= 1) out = valueToStored(resultType as ResultType, values.length ? values[0]! : null);
        else out = valueToStored("text", values.filter((v) => v !== null && v !== "").map((v) => String(v)).join(", "));
      }
      const data = { ...row.data };
      if (applyOutcome(data, col, out)) batch.push({ row, data, patch: patchOf(col, out) });
    }
    await changes.commit(db, batch);
    total += rows.length;
    await progress(total);
  }
  return total;
}

// ================================================================================================
// resolving what a column's queued changes mean
// ================================================================================================

/** Asks for the equality-key index of a column (kind `eqk`) when the table is big. Best effort, same budget and job as every automatic index. */
export async function requestEqkIndex(db: Executor, tableId: string, key: string, rowCount: number): Promise<void> {
  if (rowCount < DH_AUTO_INDEX_MIN_ROWS) return;
  await db.execute(sql`INSERT INTO dh_index_requests (table_id, column_key, kind, rows_at_request) VALUES (${tableId}::uuid, ${key}, 'eqk', ${rowCount}) ON CONFLICT DO NOTHING`).catch(() => {});
}

/** Own rows whose key columns equal one of the queued group keys (the SQL twin of `equalityKey`, `soe_eqk`; candidates only). */
export async function rowsOfKeys(db: Executor, tableId: string, entries: QueuedRow[], rowCount: number, within?: string[]): Promise<string[]> {
  const bySignature = new Map<string, { cols: string[]; tuples: Map<string, unknown[]> }>();
  for (const e of entries) {
    const k = e.keys as KeyTuples;
    const g = bySignature.get(k.cols.join(",")) ?? { cols: k.cols, tuples: new Map() };
    for (const t of k.tuples) g.tuples.set(JSON.stringify(t), t);
    bySignature.set(k.cols.join(","), g);
  }
  const out = new Set<string>();
  for (const g of bySignature.values()) {
    const cols = g.cols.map(assertColumnKey);
    const sel = sql.join(cols.map((_, j) => sql.raw(`soe_eqk(x->${j}) AS k${j}`)), sql`, `);
    const exact = sql.raw(cols.map((c, j) => `t.k${j} = soe_eqk(r.data->'${c}')`).join(" AND "));
    // The first key column is matched with `= ANY(array)` (an index scan on the equality-key index); the full tuple is checked after.
    const res = await db.execute(sql`WITH t AS (SELECT DISTINCT ${sel} FROM jsonb_array_elements(${JSON.stringify([...g.tuples.values()])}::jsonb) x)
      SELECT r.id FROM dh_rows r WHERE /*scope:system*/ r.table_id = ${tableId}::uuid AND r.deleted_at IS NULL
        AND ${sql.raw(`soe_eqk(r.data->'${cols[0]}')`)} = ANY(ARRAY(SELECT k0 FROM t))
        AND EXISTS (SELECT 1 FROM t WHERE ${exact})
        ${within ? sql`AND r.id = ANY(${`{${within.join(",")}}`}::uuid[])` : sql``}`);
    for (const r of res.rows as { id: string }[]) out.add(r.id);
    // A big table finds the rows of a group by an index on the equality key.
    for (const c of cols) await requestEqkIndex(db, tableId, c, rowCount);
  }
  return [...out];
}

/** The rows to recompute for a burst of queued changes, or the whole column (a `full` entry, nothing queued, or too many rows). */
export async function resolveScope(db: Executor, job: { col: DhColumn; tableId: string }, entries: QueuedRow[], maxRatio: number): Promise<Scope> {
  if (entries.length === 0 || entries.some((e) => e.mode === "full")) return { ids: null };
  const rc = await db.execute(sql`SELECT row_count FROM dh_tables WHERE /*scope:system*/ id = ${job.tableId}::uuid`);
  const rowCount = Number((rc.rows[0] as { row_count: number } | undefined)?.row_count ?? 0);
  const ids = new Set<string>();
  for (const e of entries) if (e.mode === "rows") e.rowIds?.forEach((x) => ids.add(x));
  const linked = entries.filter((e) => e.mode === "linked").flatMap((e) => e.rowIds ?? []);
  if (linked.length) for (const id of await linkedRows(db, job.tableId, job.col.config.relation_key as string, [...new Set(linked)])) ids.add(id);
  const keyed = entries.filter((e) => e.mode === "keys");
  if (keyed.length) for (const id of await rowsOfKeys(db, job.tableId, keyed, rowCount)) ids.add(id);
  if (maxRatio < 1 && ids.size > rowCount * maxRatio) return { ids: null };
  return { ids: [...ids] };
}

// ================================================================================================
// queue processing
// ================================================================================================

/** Takes the next pending column whose own inputs are not themselves waiting (so a chain runs in dependency order). */
async function claimNext(db: Db): Promise<{ id: string; claimedAt: string } | null> {
  const res = await db.execute(sql`UPDATE dh_columns c SET calc_status = 'running', calc_done = 0, calc_total = (SELECT row_count FROM dh_tables WHERE id = c.table_id)
    WHERE /*scope:system*/ c.id = (
      SELECT c2.id FROM dh_columns c2
      WHERE c2.calc_status = 'pending' AND c2.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM dh_formula_deps f JOIN dh_columns y ON y.table_id = f.src_table_id AND y.key = f.src_key AND y.deleted_at IS NULL
                        WHERE f.column_id = c2.id AND y.id <> c2.id AND y.calc_status <> 'ready')
      ORDER BY c2.calc_requested_at, c2.id LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING c.id, clock_timestamp()::text AS claimed_at`);
  const r = res.rows[0] as Raw | undefined;
  return r ? { id: r.id as string, claimedAt: r.claimed_at as string } : null;
}

export interface RecalcOptions {
  /** Share of the table above which a partial recomputation becomes a full one (default `PARTIAL_MAX_RATIO`; 1 = never, used by tests). */
  maxRatio?: number;
}

/**
 * Recomputes one claimed column and releases it. Takes the column's WHOLE burst from the change queue, recomputes only
 * the rows it names (or the whole column), then in one transaction: deletes what it took, releases the column, queues the
 * changes for the columns that read this one (the chain) and announces the end. Safe to call again for the same column.
 */
export async function recalcColumn(db: Db, columnId: string, claimedAt: string, now: Date = new Date(), log?: Logger, opts: RecalcOptions = {}): Promise<RecalcResult> {
  const job = await loadJob(db, columnId);
  const entries = await readQueue(db, columnId);
  const seq = entries.reduce((m, e) => Math.max(m, e.seq), 0);
  let result: RecalcResult = { changedRows: 0, total: 0, partial: false, rows: [] };
  try {
    if (job && job.alive && isComputedType(job.col.type)) {
      const scope = await resolveScope(db, job, entries, opts.maxRatio ?? PARTIAL_MAX_RATIO);
      if (scope.ids) await db.execute(sql`UPDATE dh_columns SET calc_total = ${scope.ids.length}::int WHERE /*scope:system*/ id = ${columnId}::uuid`);
      const progress = async (done: number) => {
        await db.execute(sql`UPDATE dh_columns SET calc_done = ${done}::int WHERE /*scope:system*/ id = ${columnId}::uuid`);
      };
      const changes = new Changes(job, seq);
      const run = (reader: Reader | null, c: Changes, p: (done: number) => Promise<void>) =>
        job.col.type === "formula" ? recalcFormula(db, job, now, p, scope, c, reader) : recalcLink(db, job, p, scope, c, reader);
      const total = await run(null, changes, progress);
      result = { changedRows: changes.count, total, partial: scope.ids !== null, rows: changes.changes };
      if (job.col.readerScoped) {
        // Each member who is not the owner gets their own value, over the rows they see. The owner's pass above is over every row.
        const touched = new Set(changes.touched);
        for (const userId of await membersOf(db, job.tableId)) {
          const reader: Reader = { userId, ids: await idsOf(db, userId) };
          const rc = new Changes(job, seq, reader);
          await run(reader, rc, async () => {});
          result.changedRows += rc.count;
          rc.touched.forEach((x) => touched.add(x));
        }
        // What the columns that read this one need to know: which rows changed (the values differ per reader, so no old/new pair).
        result.scoped = true;
        result.rows = touched.size > CHAIN_LIMIT ? null : [...touched].map((rowId) => ({ rowId, kind: "update" as const, old: null, new: null, keys: [job.col.key] }));
      }
    }
  } catch (e) {
    log?.error({ err: e, column: columnId }, "formula recalculation failed");
    // Released so a fix (or the next change) can retry; the entries stay. The loop does not spin: only a new request makes it pending.
    await db.execute(sql`UPDATE dh_columns SET calc_status = 'ready', calc_at = now() WHERE /*scope:system*/ id = ${columnId}::uuid`);
    throw e;
  }
  await columnTx(db, async (tx) => {
    await deleteQueue(tx, entries.map((e) => e.id));
    if (job) {
      // The chain: the columns that read this one get exactly the rows that changed (old and new values), in this same transaction.
      if (result.changedRows > 0) {
        if (result.rows) await recordChanges(tx, job.tableId, result.rows, seq, { includeApiFormulas: true, scopedSource: result.scoped });
        else await requestDependentsFull(tx, job.tableId, [job.col.key], seq, { includeApiFormulas: true });
      }
      await enqueueOutbox(tx, {
        event: FORMULA_EVENT,
        aggregateType: "datahub_table",
        aggregateId: job.tableId,
        payload: { table_id: job.tableId, columns: [job.col.key], state: "done", changes: [], changed_rows: result.changedRows, seq },
      });
    }
    // The own column is locked LAST and in the same sorted round as the columns the chain touched (columnTx): taking it first,
    // then the dependants, was half of a deadlock cycle with a writer that touches them in the other order.
    lockColumnsAtFlush(tx, [columnId]);
    await flushTouches(tx);
    await tx.execute(sql`UPDATE dh_columns SET calc_status = CASE WHEN calc_requested_at > ${claimedAt}::timestamptz THEN 'pending' ELSE 'ready' END,
        calc_done = ${result.total}::int, calc_total = ${result.total}::int, calc_at = ${now.toISOString()}::timestamptz, calc_seq = GREATEST(calc_seq, ${seq}::bigint)
      WHERE /*scope:system*/ id = ${columnId}::uuid`);
  });
  return result;
}

/** Recomputes the pending columns, up to `parallel` at a time (independent columns in parallel, a chain in order). Returns how many were processed. */
export async function processPendingColumns(db: Db, opts: { now?: Date; log?: Logger; max?: number; parallel?: number; maxRatio?: number } = {}): Promise<number> {
  let n = 0;
  const parallel = Math.max(1, Math.min(opts.parallel ?? (await readSetting(db, DH_SETTINGS.recalcParallel)), 4));
  const lane = async () => {
    let done = 0;
    for (;;) {
      if (opts.max !== undefined && n >= opts.max) break;
      const next = await claimNext(db);
      if (!next) break;
      n++;
      try {
        await recalcColumn(db, next.id, next.claimedAt, opts.now ?? new Date(), opts.log, { maxRatio: opts.maxRatio });
      } catch {
        // Already logged; the column was released. Carry on with the others.
      }
      done++;
    }
    return done;
  };
  // A column whose input another lane is still computing is not claimable yet: go round again until a pass finds nothing.
  for (;;) {
    const passes = await Promise.all(Array.from({ length: parallel }, lane));
    if (passes.reduce((a, b) => a + b, 0) === 0) break;
  }
  return n;
}

/** The recalculation loop of the worker: polls the queue every `intervalMs`. */
export function startRecalcLoop(db: Db, log: Logger, intervalMs: number): { stop(): Promise<void> } {
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  const tick = async () => {
    try {
      await processPendingColumns(db, { log });
    } catch (e) {
      log.error({ err: e }, "recalculation loop error");
    }
  };
  const timer = setInterval(() => {
    if (stopped) return;
    running = running.then(tick);
  }, intervalMs);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
