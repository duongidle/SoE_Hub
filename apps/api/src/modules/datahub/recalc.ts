import { sql } from "drizzle-orm";
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
import { enqueueOutbox, type Db, type Executor } from "@soe/db";
import type { Logger } from "pino";
import type { Subscriber } from "../../core/outbox-dispatcher";
import { applyOutcome, cellValue, effectiveType, errKey, isComputedType, resultTypeOf, valueToStored, type ResultType, type StoreOutcome } from "./cell-values";
import { groupableCalls, OwnerIndex, scanRangeNodes, SCAN_ROW_LIMIT } from "./computed";
import { columnFromDb, rowFromDb } from "./table-schema";
import { assertColumnKey, type DhColumn, type Stored } from "./types";
import type { LoadedRow } from "./column-source";

type Raw = Record<string, unknown>;
export const FORMULA_EVENT = "datahub.formula.recalculated";
const BATCH = 2000;

// ================================================================================================
// marking columns for recalculation
// ================================================================================================

/** Columns waiting for the worker (design module2 section 6.5). Cheap and idempotent: a column is recomputed whole. */
export async function markPending(db: Executor, columnIds: string[]): Promise<void> {
  if (columnIds.length === 0) return;
  const res = await db.execute(sql`UPDATE dh_columns SET calc_status = 'pending', calc_requested_at = clock_timestamp()
    WHERE /*scope:system*/ deleted_at IS NULL AND id = ANY(${`{${columnIds.join(",")}}`}::uuid[]) RETURNING table_id, key`);
  const byTable = new Map<string, string[]>();
  for (const r of res.rows as Raw[]) byTable.set(r.table_id as string, [...(byTable.get(r.table_id as string) ?? []), r.key as string]);
  for (const [tableId, columns] of byTable) {
    await enqueueOutbox(db, { event: FORMULA_EVENT, aggregateType: "datahub_table", aggregateId: tableId, payload: { table_id: tableId, columns, state: "pending", changed_rows: 0, row_ids: null } });
  }
}

const ids = (rows: unknown[]) => (rows as { id: string }[]).map((r) => r.id);

/** Computed columns that depend on the given columns of a table (any kind of dependency). */
async function dependentsOf(db: Executor, tableId: string, keys: string[], opts: { skipApiComputed?: boolean } = {}): Promise<string[]> {
  if (keys.length === 0) return [];
  const res = await db.execute(sql`SELECT DISTINCT c.id FROM dh_formula_deps f JOIN dh_columns c ON c.id = f.column_id
    WHERE /*scope:system*/ c.deleted_at IS NULL AND f.src_table_id = ${tableId}::uuid AND f.src_key = ANY(${`{${keys.join(",")}}`}::text[])
    ${opts.skipApiComputed ? sql`AND NOT (c.type = 'formula' AND c.table_id = ${tableId}::uuid AND NOT EXISTS (SELECT 1 FROM dh_formula_deps r WHERE r.column_id = c.id AND r.kind = 'range'))` : sql``}`);
  return ids(res.rows);
}

/** Computed columns that read ANY column of the given tables. */
async function readersOfTables(db: Executor, tableIds: string[]): Promise<string[]> {
  if (tableIds.length === 0) return [];
  const res = await db.execute(sql`SELECT DISTINCT c.id FROM dh_formula_deps f JOIN dh_columns c ON c.id = f.column_id
    WHERE /*scope:system*/ c.deleted_at IS NULL AND f.src_table_id = ANY(${`{${tableIds.join(",")}}`}::uuid[])`);
  return ids(res.rows);
}

/** The columns of a table that the API cannot compute alone (they read other tables or linked rows). */
async function workerColumnsOf(db: Executor, tableIds: string[]): Promise<string[]> {
  const res = await db.execute(sql`SELECT c.id FROM dh_columns c
    WHERE /*scope:system*/ c.table_id = ANY(${`{${tableIds.join(",")}}`}::uuid[]) AND c.deleted_at IS NULL
      AND (c.type IN ('lookup', 'rollup') OR (c.type = 'formula' AND EXISTS (SELECT 1 FROM dh_formula_deps r WHERE r.column_id = c.id AND r.kind = 'range')))`);
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
 * Outbox listener: finds the computed columns a change affects and marks them pending (the recalculation loop does the
 * work). Same-row formulas were already computed by the API in the writing transaction and are skipped here.
 */
export const formulaSubscriber: Subscriber = {
  name: "datahub.formula",
  match: (e) => e.startsWith("datahub.row.") || e === "datahub.structure.changed" || e === FORMULA_EVENT,
  async handle(ev, db) {
    const p = ev.payload as { table_id?: string; datahub_id?: string; columns?: string[]; change?: string; state?: string; changed_rows?: number };
    const marks = new Set<string>();
    if (ev.event === FORMULA_EVENT) {
      if (p.state === "done" && (p.changed_rows ?? 0) > 0 && p.table_id) (await dependentsOf(db, p.table_id, p.columns ?? [])).forEach((x) => marks.add(x));
    } else if (ev.event === "datahub.structure.changed") {
      const change = p.change ?? "";
      const tableIds = p.table_id ? [p.table_id] : p.datahub_id ? await tablesOfDatahub(db, p.datahub_id) : [];
      if (["column_deleted", "column_restored", "column_type_changed", "table_deleted", "table_restored", "datahub_deleted", "datahub_restored", "owner_changed"].includes(change)) {
        (await readersOfTables(db, tableIds)).forEach((x) => marks.add(x));
        if (["column_restored", "table_restored", "datahub_restored", "owner_changed", "column_type_changed"].includes(change)) (await computedColumnsOf(db, tableIds)).forEach((x) => marks.add(x));
      }
    } else if (p.table_id) {
      const kind = ev.event.slice("datahub.row.".length);
      (await dependentsOf(db, p.table_id, p.columns ?? [], { skipApiComputed: true })).forEach((x) => marks.add(x));
      if (kind !== "updated") {
        (await readersOfTables(db, [p.table_id])).forEach((x) => marks.add(x));
        (await workerColumnsOf(db, [p.table_id])).forEach((x) => marks.add(x));
      }
    }
    await markPending(db, [...marks]);
  },
};

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
    WHERE /*scope:system*/ deleted_at IS NULL AND calc_status = 'ready' AND (
      (calc_volatile = 'today' AND (calc_at IS NULL OR calc_at < ${lastDailyBoundary(now).toISOString()}::timestamptz)) OR
      (calc_volatile = 'now' AND (calc_at IS NULL OR calc_at < ${lastHourBoundary(now).toISOString()}::timestamptz)))
    RETURNING id`);
  return res.rows.length;
}

/** After a crash a column can stay `running`: put them back in the queue (worker start). */
export async function resetRunningColumns(db: Db): Promise<number> {
  const res = await db.execute(sql`UPDATE dh_columns SET calc_status = 'pending', calc_requested_at = clock_timestamp() WHERE /*scope:system*/ calc_status = 'running' RETURNING id`);
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

// ---- grouped plans -------------------------------------------------------------------------------------

interface Acc {
  n: number;
  nn: number;
  s: number;
  mn: number | null;
  mx: number | null;
  nb: number;
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

/** Answers every row of the table at once from one grouped SQL query (design module2 section 6.6). */
async function buildPlan(db: Executor, ix: OwnerIndex, g: GroupableCall): Promise<GroupPlan> {
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
  const where = sql`/*scope:system*/ table_id = ${g.table}::uuid AND deleted_at IS NULL`;
  const target = g.target ? ix.column(g.table, g.target)! : null;
  const map = new Map<string, Acc>();

  if (g.kind === "criteria") {
    const parts = [...keySelect, sql`count(*)::float8 AS n`];
    if (target) {
      const num = numExpr(target);
      const k = assertColumnKey(target.key);
      parts.push(sql`count(${num})::float8 AS nn`, sql`coalesce(sum(${num}), 0)::float8 AS s`, sql`min(${num})::float8 AS mn`, sql`max(${num})::float8 AS mx`);
      parts.push(sql`count(*) FILTER (WHERE ${sql.raw(`data->'${k}' IS NOT NULL AND data->>'${k}' <> ''`)})::float8 AS nb`);
    }
    const groupBy = keyCols.length ? sql`GROUP BY ${sql.join(keyCols.map((c) => sql.raw(`data->'${assertColumnKey(c.key)}'`)), sql`, `)}` : sql``;
    const res = await db.execute(sql`SELECT ${sql.join(parts, sql`, `)} FROM dh_rows WHERE ${where} ${groupBy}`);
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
      map.set(key, a);
    }
    const zero: Acc = { n: 0, nn: 0, s: 0, mn: null, mx: null, nb: 0 };
    const answer = (a: Acc): Value => {
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
    FROM dh_rows WHERE ${where} AND ${notNull} ORDER BY ${sql.join(k0.map((k) => sql.raw(`data->'${k}'`)), sql`, `)}, row_no`);
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
async function loadScanColumn(db: Executor, ix: OwnerIndex, tableId: string, key: string): Promise<Value[] | FError> {
  const t = ix.tableById.get(tableId)!;
  const col = ix.column(tableId, key);
  if (!col) return new FError("#REF!", "Cột được tham chiếu đã bị xoá.");
  if (t.rowCount > SCAN_ROW_LIMIT) return new FError("#VALUE!", `Bảng "${t.name}" quá lớn (${t.rowCount} dòng) để duyệt từng dòng.`);
  const out: Value[] = [];
  let last = 0;
  for (;;) {
    const res = await db.execute(sql`SELECT id, row_no, data, created_at, created_by, updated_at, updated_by FROM dh_rows
      WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND row_no > ${last}::int ORDER BY row_no LIMIT ${BATCH}`);
    const rows = res.rows as Raw[];
    if (rows.length === 0) break;
    for (const r of rows) out.push(cellValue(col as unknown as DhColumn, rowFromDb(r)));
    last = rows[rows.length - 1]!.row_no as number;
    if (rows.length < BATCH) break;
  }
  return out;
}

// ---- formula column --------------------------------------------------------------------------------------

export interface RecalcResult {
  changedRows: number;
  changedRowIds: string[] | null;
  total: number;
}

const rowIdLimit = 500;

async function writePatches(db: Executor, tableId: string, key: string, patches: { id: string; patch: Record<string, unknown> }[]): Promise<void> {
  if (patches.length === 0) return;
  // Only this column's value and error keys are replaced, on the CURRENT data of the row: a concurrent user edit of
  // another cell is never overwritten. No version, no updated_at, no history, no audit (design module2 section 6.5).
  await db.execute(sql`UPDATE dh_rows r SET data = (r.data - ARRAY[${key}::text, ${errKey(key)}::text]) || v.patch
    FROM jsonb_to_recordset(${JSON.stringify(patches)}::jsonb) AS v(id uuid, patch jsonb)
    WHERE /*scope:system*/ r.table_id = ${tableId}::uuid AND r.id = v.id`);
}

/** What a formula needs to run over the rows of a table: plans for grouped calls, scanned columns, and a context that follows `setRow`. */
export interface FormulaEnv {
  ctx: EvalContext;
  setRow(row: LoadedRow): void;
}

export async function buildFormulaEnv(db: Executor, ix: OwnerIndex, tableId: string, ast: Node | null, now: Date): Promise<FormulaEnv> {
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

  // Plans for grouped calls whose references are all usable.
  const plans = new Map<number, GroupPlan>();
  let scanNodes: Extract<Node, { t: "key" }>[] = [];
  if (ast) {
    const grouped = groupableCalls(ast, (t, k) => ix.column(t, k));
    scanNodes = scanRangeNodes(ast, grouped);
    for (const g of grouped) {
      const bad = problems.has(g.table) || [...g.keyColumns, ...(g.target ? [g.target] : [])].some((k) => refError(g.table, k));
      if (bad) continue;
      plans.set(g.nodeId, await buildPlan(db, ix, g));
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
    scan.set(w, await loadScanColumn(db, ix, t, k));
  }

  let current: LoadedRow = stubRow({});
  const ctx: EvalContext = {
    now,
    plans,
    cell: (key) => {
      const c = colsByKey.get(key);
      if (!c) throw new FError("#REF!", "Cột được tham chiếu đã bị xoá.");
      return cellValue(c, current);
    },
    range: (table, key) => {
      const bad = refError(table, key);
      if (bad) throw bad;
      const loaded = scan.get(`${table}.${key}`);
      if (!loaded) throw new FError("#VALUE!", "Cột này quá lớn để duyệt từng dòng; dùng điều kiện bằng (=) để tính bằng SQL.");
      if (loaded instanceof FError) throw loaded;
      return new RangeValue(table, key, () => loaded);
    },
    rowInfo: () => ({ id: current.id, rowNo: current.rowNo, createdAt: cellValue({ type: "created_time", key: "_", config: {} } as DhColumn, current) as number, modifiedAt: cellValue({ type: "modified_time", key: "_", config: {} } as DhColumn, current) as number }),
  };
  return { ctx, setRow: (r) => { current = r; } };
}

async function recalcFormula(db: Db, job: Job, now: Date, progress: (done: number) => Promise<void>): Promise<RecalcResult> {
  const col = job.col;
  const ix = await OwnerIndex.load(db, job.ownerId);
  const parsed = typeof col.config.expr === "string" ? parseFormula(col.config.expr) : null;
  const resultType = resultTypeOf(col);
  const ast: Node | null = parsed && parsed.ok ? parsed.ast : null;
  const env = await buildFormulaEnv(db, ix, job.tableId, ast, now);

  let last = 0;
  let total = 0;
  let changed = 0;
  const changedIds: string[] = [];
  for (;;) {
    const res = await db.execute(sql`SELECT id, row_no, version, data, created_at, created_by, updated_at, updated_by FROM dh_rows
      WHERE /*scope:system*/ table_id = ${job.tableId}::uuid AND deleted_at IS NULL AND row_no > ${last}::int ORDER BY row_no LIMIT ${BATCH}`);
    const rows = (res.rows as Raw[]).map(rowFromDb);
    if (rows.length === 0) break;
    const patches: { id: string; patch: Record<string, unknown> }[] = [];
    for (const row of rows) {
      env.setRow(row);
      let out: StoreOutcome;
      if (!ast) out = { kind: "error", code: "#NAME?" };
      else out = valueToStored(resultType, evaluate(ast, env.ctx));
      const data = { ...row.data };
      if (applyOutcome(data, col, out)) {
        patches.push({ id: row.id, patch: out.kind === "value" ? { [col.key]: out.value } : out.kind === "error" ? { [errKey(col.key)]: out.code } : {} });
        changed++;
        if (changedIds.length < rowIdLimit + 1) changedIds.push(row.id);
      }
    }
    await writePatches(db, job.tableId, col.key, patches);
    total += rows.length;
    last = rows[rows.length - 1]!.rowNo;
    await progress(total);
    if (rows.length < BATCH) break;
  }
  return { changedRows: changed, changedRowIds: changedIds.length > rowIdLimit ? null : changedIds, total };
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

async function recalcLink(db: Db, job: Job, progress: (done: number) => Promise<void>): Promise<RecalcResult> {
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

  let last = 0;
  let total = 0;
  let changed = 0;
  const changedIds: string[] = [];
  for (;;) {
    const res = await db.execute(sql`SELECT id, row_no, version, data, created_at, created_by, updated_at, updated_by FROM dh_rows
      WHERE /*scope:system*/ table_id = ${job.tableId}::uuid AND deleted_at IS NULL AND row_no > ${last}::int ORDER BY row_no LIMIT ${BATCH}`);
    const rows = (res.rows as Raw[]).map(rowFromDb);
    if (rows.length === 0) break;
    const linkIds = new Set<string>();
    for (const r of rows) {
      const l = r.data[relKey];
      if (Array.isArray(l)) l.forEach((x) => linkIds.add(x));
    }
    const targets = new Map<string, Scalar>();
    if (!fatal && linkIds.size && fullTarget) {
      const tres = await db.execute(sql`SELECT id, data, created_at, created_by, updated_at, updated_by FROM dh_rows
        WHERE /*scope:system*/ table_id = ${targetTable}::uuid AND deleted_at IS NULL AND id = ANY(${`{${[...linkIds].join(",")}}`}::uuid[])`);
      for (const t of tres.rows as Raw[]) targets.set(t.id as string, cellValue(fullTarget, rowFromDb(t)));
    }
    const patches: { id: string; patch: Record<string, unknown> }[] = [];
    for (const row of rows) {
      let out: StoreOutcome;
      if (fatal) out = { kind: "error", code: fatal.code };
      else {
        const links = Array.isArray(row.data[relKey]) ? (row.data[relKey] as string[]) : [];
        const values = links.filter((id) => targets.has(id)).map((id) => targets.get(id)!);
        const bad = values.find((v) => v instanceof FError) as FError | undefined;
        if (bad) out = { kind: "error", code: bad.code };
        else if (col.type === "rollup") out = valueToStored(resultType as ResultType, rollup(col.config.fn as string, values));
        else if (single || values.length <= 1) out = valueToStored(resultType as ResultType, values.length ? values[0]! : null);
        else out = valueToStored("text", values.filter((v) => v !== null && v !== "").map((v) => String(v)).join(", "));
      }
      const data = { ...row.data };
      if (applyOutcome(data, col, out)) {
        patches.push({ id: row.id, patch: out.kind === "value" ? { [col.key]: out.value } : out.kind === "error" ? { [errKey(col.key)]: out.code } : {} });
        changed++;
        if (changedIds.length < rowIdLimit + 1) changedIds.push(row.id);
      }
    }
    await writePatches(db, job.tableId, col.key, patches);
    total += rows.length;
    last = rows[rows.length - 1]!.rowNo;
    await progress(total);
    if (rows.length < BATCH) break;
  }
  return { changedRows: changed, changedRowIds: changedIds.length > rowIdLimit ? null : changedIds, total };
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

/** Recomputes one claimed column and releases it. Safe to call again for the same column. */
export async function recalcColumn(db: Db, columnId: string, claimedAt: string, now: Date = new Date(), log?: Logger): Promise<RecalcResult> {
  const job = await loadJob(db, columnId);
  let result: RecalcResult = { changedRows: 0, changedRowIds: [], total: 0 };
  try {
    if (job && job.alive && isComputedType(job.col.type)) {
      const progress = async (done: number) => {
        await db.execute(sql`UPDATE dh_columns SET calc_done = ${done}::int WHERE /*scope:system*/ id = ${columnId}::uuid`);
      };
      result = job.col.type === "formula" ? await recalcFormula(db, job, now, progress) : await recalcLink(db, job, progress);
    }
  } catch (e) {
    log?.error({ err: e, column: columnId }, "formula recalculation failed");
    // Put it back so a fix (or a retry) is possible; the loop does not spin because requested_at moves forward.
    await db.execute(sql`UPDATE dh_columns SET calc_status = 'ready', calc_at = now() WHERE /*scope:system*/ id = ${columnId}::uuid`);
    throw e;
  }
  await db.execute(sql`UPDATE dh_columns SET calc_status = CASE WHEN calc_requested_at > ${claimedAt}::timestamptz THEN 'pending' ELSE 'ready' END,
      calc_done = ${result.total}::int, calc_total = ${result.total}::int, calc_at = ${now.toISOString()}::timestamptz WHERE /*scope:system*/ id = ${columnId}::uuid`);
  if (job) {
    await enqueueOutbox(db, {
      event: FORMULA_EVENT,
      aggregateType: "datahub_table",
      aggregateId: job.tableId,
      payload: { table_id: job.tableId, columns: [job.col.key], state: "done", changed_rows: result.changedRows, row_ids: result.changedRowIds },
    });
  }
  return result;
}

/** Recomputes every pending column (one at a time). Returns how many were processed. */
export async function processPendingColumns(db: Db, opts: { now?: Date; log?: Logger; max?: number } = {}): Promise<number> {
  let n = 0;
  for (;;) {
    if (opts.max !== undefined && n >= opts.max) break;
    const next = await claimNext(db);
    if (!next) break;
    try {
      await recalcColumn(db, next.id, next.claimedAt, opts.now ?? new Date(), opts.log);
    } catch {
      // Already logged; the column was released. Carry on with the others.
    }
    n++;
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

