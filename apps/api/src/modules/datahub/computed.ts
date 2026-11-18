import { sql } from "drizzle-orm";
import { z } from "zod";
import { collectDeps, findGroupable, inferType, toDisplayFormula, toStoredFormula, validateCalls, type FType, type GroupableCall, type Node, type RefTarget } from "@soe/formula";
import { AppError } from "@soe/shared";
import type { Executor } from "@soe/db";
import { formulaTypeOf, isComputedType, RESULT_TYPES, resultTypeFor, resultTypeOf, type ResultType } from "./cell-values";
import { normName, type TableSchema } from "./table-schema";
import type { DhColumn } from "./types";

/** Max rows of a table a formula may scan in memory (conditions the grouped SQL cannot answer), design module2 section 6.6. */
export const SCAN_ROW_LIMIT = 20_000;

type Raw = Record<string, unknown>;

// ================================================================================================
// the owner's tables, as formulas may see them (design module2 section 6.4: same owner only)
// ================================================================================================

export interface IxColumn {
  id: string;
  key: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  tableId: string;
}
export interface IxTable {
  id: string;
  name: string;
  datahubId: string;
  rowCount: number;
  columns: IxColumn[];
}
export interface IxDatahub {
  id: string;
  name: string;
  tables: IxTable[];
}

/** Every live datahub, table and column of ONE owner. A formula can only refer to what is in here. */
export class OwnerIndex {
  readonly datahubs: IxDatahub[] = [];
  readonly tableById = new Map<string, IxTable>();
  private readonly dhOfTable = new Map<string, IxDatahub>();

  static async load(db: Executor, ownerId: string): Promise<OwnerIndex> {
    const res = await db.execute(sql`
      SELECT d.id AS dh_id, d.name AS dh_name, t.id AS t_id, t.name AS t_name, t.row_count,
             c.id AS c_id, c.key, c.name AS c_name, c.type, c.config
      FROM dh_datahubs d
      JOIN dh_tables t ON t.datahub_id = d.id AND t.deleted_at IS NULL
      LEFT JOIN dh_columns c ON c.table_id = t.id AND c.deleted_at IS NULL
      WHERE /*scope*/ d.owner_id = ${ownerId}::uuid AND d.deleted_at IS NULL
      ORDER BY d.created_at, t.position, t.created_at, c.position, c.created_at`);
    const ix = new OwnerIndex();
    const dh = new Map<string, IxDatahub>();
    for (const r of res.rows as Raw[]) {
      let d = dh.get(r.dh_id as string);
      if (!d) {
        d = { id: r.dh_id as string, name: r.dh_name as string, tables: [] };
        dh.set(d.id, d);
        ix.datahubs.push(d);
      }
      let t = ix.tableById.get(r.t_id as string);
      if (!t) {
        t = { id: r.t_id as string, name: r.t_name as string, datahubId: d.id, rowCount: r.row_count as number, columns: [] };
        ix.tableById.set(t.id, t);
        ix.dhOfTable.set(t.id, d);
        d.tables.push(t);
      }
      if (r.c_id) t.columns.push({ id: r.c_id as string, key: r.key as string, name: r.c_name as string, type: r.type as string, config: (r.config as Record<string, unknown>) ?? {}, tableId: t.id });
    }
    return ix;
  }

  datahubOf(tableId: string): IxDatahub | undefined {
    return this.dhOfTable.get(tableId);
  }

  column(tableId: string, key: string): IxColumn | undefined {
    return this.tableById.get(tableId)?.columns.find((c) => c.key === key);
  }

  columnByRef(tableId: string, ref: string): IxColumn | undefined {
    const t = this.tableById.get(tableId);
    return t?.columns.find((c) => c.key === ref) ?? t?.columns.find((c) => normName(c.name) === normName(ref));
  }

  /** Name parts of a reference for display: column, `[Bảng].[Cột]` or `[Datahub].[Bảng].[Cột]`. Null when the target no longer exists. */
  namesOf(fromTableId: string, table: string | null, key: string): string[] | null {
    if (table === null || table === fromTableId) {
      const c = this.column(fromTableId, key);
      if (!c) return null;
      return table === null ? [c.name] : [this.tableById.get(table)!.name, c.name];
    }
    const t = this.tableById.get(table);
    const c = this.column(table, key);
    if (!t || !c) return null;
    const from = this.datahubOf(fromTableId);
    const to = this.datahubOf(table);
    return from && to && from.id === to.id ? [t.name, c.name] : [to?.name ?? "?", t.name, c.name];
  }
}

/** Formula type of a referenced column (for result type inference). */
export function typeOfColumn(c: IxColumn | undefined): FType {
  return c ? formulaTypeOf(c) : "unknown";
}

// ================================================================================================
// what a grouped SQL query can answer
// ================================================================================================

const GROUP_KEY_TYPES = new Set(["text", "long_text", "email", "phone", "url", "number", "currency", "percent", "rating", "auto_number", "date", "datetime", "checkbox", "single_select", "user"]);
const VIRTUAL_TYPES = new Set(["row_id", "created_time", "created_by", "modified_time", "modified_by"]);

export const isGroupKeyColumn = (c: IxColumn | DhColumn | undefined): boolean => !!c && GROUP_KEY_TYPES.has(isComputedType(c.type) ? resultTypeOf(c) : c.type);
export const isPlainStoredColumn = (c: IxColumn | DhColumn | undefined): boolean => !!c && !VIRTUAL_TYPES.has(c.type) && c.type !== "attachment";

/** A call is grouped only when its tables and columns exist and are of types the SQL can group on. */
export function groupableCalls(ast: Node, columnOf: (table: string, key: string) => IxColumn | DhColumn | undefined): GroupableCall[] {
  return findGroupable(ast).filter((g) => {
    if (!g.keyColumns.every((k) => isGroupKeyColumn(columnOf(g.table, k)))) return false;
    if (g.target !== null && !isPlainStoredColumn(columnOf(g.table, g.target))) return false;
    return true;
  });
}

/** `{table.key}` nodes that are NOT answered by a grouped call: they are scanned in memory, so their tables must stay small. */
export function scanRangeNodes(ast: Node, grouped: GroupableCall[]): Extract<Node, { t: "key" }>[] {
  const covered = new Set<Node>();
  for (const g of grouped) g.rangeNodes.forEach((n) => covered.add(n));
  const out: Extract<Node, { t: "key" }>[] = [];
  const visit = (n: Node) => {
    switch (n.t) {
      case "key":
        if (n.table !== null && !covered.has(n)) out.push(n);
        break;
      case "call":
        n.args.forEach(visit);
        break;
      case "un":
      case "pct":
        visit(n.a);
        break;
      case "bin":
        visit(n.l);
        visit(n.r);
        break;
      default:
    }
  };
  visit(ast);
  return out;
}

// ================================================================================================
// saving a computed column
// ================================================================================================

export interface DepRow {
  srcTableId: string;
  srcKey: string;
  kind: "cell" | "range";
}

export interface PreparedComputed {
  /** Configuration to store (formula in key form, result type, link targets as keys). */
  config: Record<string, unknown>;
  deps: DepRow[];
  volatile: "today" | "now" | null;
  resultType: ResultType | null;
}

const ResultTypeSchema = z.enum(RESULT_TYPES);

const FormulaConfig = z.strictObject({ formula: z.string().min(1, "Công thức đang trống.").max(10_000, "Công thức quá dài (tối đa 10.000 ký tự)."), result_type: ResultTypeSchema.optional() });
const RelationConfig = z.strictObject({ target_table_id: z.uuid(), multiple: z.boolean().optional() });
const LookupConfig = z.strictObject({ relation: z.string().min(1).max(100), target_column: z.string().min(1).max(100) });
export const ROLLUP_FUNCTIONS = ["sum", "count", "counta", "avg", "min", "max", "countunique", "concat"] as const;
const RollupConfig = LookupConfig.extend({ fn: z.enum(ROLLUP_FUNCTIONS) });

function badConfig(label: string, e: z.ZodError): never {
  throw new AppError("validation_error", `Cấu hình cột ${label} không hợp lệ: ${e.issues.map((i) => i.message).join("; ")}`, { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
}

interface Where {
  tableId: string;
  datahubId: string;
}

/** Resolves a name reference to a key target, only inside the owner's own datahubs. */
function nameResolver(ix: OwnerIndex, at: Where, own: { key: string } | null) {
  return (parts: string[]): RefTarget => {
    const here = ix.tableById.get(at.tableId);
    const dhHere = ix.datahubs.find((d) => d.id === at.datahubId);
    const findCol = (t: IxTable | undefined, name: string, label: string): IxColumn | { error: string } => {
      const c = t?.columns.find((x) => normName(x.name) === normName(name));
      if (!c) return { error: `Không có cột "${name}" trong ${label}.` };
      return c;
    };
    if (parts.length === 1) {
      const c = findCol(here, parts[0]!, "bảng này");
      if ("error" in c) return c;
      return { table: null, key: c.key };
    }
    let dh = dhHere;
    let tableName = parts[0]!;
    let colName = parts[1]!;
    if (parts.length === 3) {
      dh = ix.datahubs.find((d) => normName(d.name) === normName(parts[0]!));
      if (!dh) return { error: `Không có datahub "${parts[0]}" của bạn. Công thức chỉ dùng được datahub do chính bạn sở hữu; datahub người khác chia sẻ không dùng được (#PERM!).` };
      tableName = parts[1]!;
      colName = parts[2]!;
    }
    const t = dh?.tables.find((x) => normName(x.name) === normName(tableName));
    if (!t) return { error: `Không có bảng "${tableName}" trong datahub "${dh?.name ?? ""}". Công thức chỉ dùng được bảng của datahub do bạn sở hữu.` };
    const c = findCol(t, colName, `bảng "${t.name}"`);
    if ("error" in c) return c;
    void own;
    return { table: t.id, key: c.key };
  };
}

/** The cycle check (design module2 section 6.5): the new column may not be reachable from what it reads. */
async function assertNoCycle(db: Executor, ix: OwnerIndex, self: { tableId: string; key: string }, deps: DepRow[]): Promise<void> {
  const tableIds = [...ix.tableById.keys()];
  const res = await db.execute(sql`
    SELECT c.table_id, c.key, f.src_table_id, f.src_key
    FROM dh_formula_deps f JOIN dh_columns c ON c.id = f.column_id
    WHERE /*scope*/ f.table_id = ANY(${`{${tableIds.join(",")}}`}::uuid[]) AND c.deleted_at IS NULL`);
  const edges = new Map<string, Set<string>>();
  for (const r of res.rows as Raw[]) {
    const from = `${r.table_id}:${r.key}`;
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from)!.add(`${r.src_table_id}:${r.src_key}`);
  }
  const selfNode = `${self.tableId}:${self.key}`;
  // The saved column's old dependencies are replaced by the new ones.
  edges.set(selfNode, new Set(deps.map((d) => `${d.srcTableId}:${d.srcKey}`)));
  const nameOf = (node: string) => {
    const [t, k] = [node.slice(0, 36), node.slice(37)];
    const c = ix.column(t, k);
    const tb = ix.tableById.get(t);
    return c && tb ? `[${tb.name}].[${c.name}]` : node;
  };
  const stack: string[] = [];
  const seen = new Set<string>();
  const dfs = (node: string): boolean => {
    if (node === selfNode && stack.length > 0) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    stack.push(node);
    for (const next of edges.get(node) ?? []) if (dfs(next)) return true;
    stack.pop();
    return false;
  };
  seen.clear();
  stack.length = 0;
  if (dfs(selfNode)) {
    throw new AppError("validation_error", `Công thức tham chiếu vòng tròn (#CYCLE!): ${[...stack, selfNode].map(nameOf).join(" → ")}. Cột không được dùng chính nó, trực tiếp hay qua cột khác.`, { code: "#CYCLE!" });
  }
}

function depsOfAst(ast: Node, here: string): { deps: DepRow[]; volatile: "today" | "now" | null } {
  const d = collectDeps(ast);
  return {
    deps: [...d.cells.map((k) => ({ srcTableId: here, srcKey: k, kind: "cell" as const })), ...d.ranges.map((r) => ({ srcTableId: r.table, srcKey: r.key, kind: "range" as const }))],
    volatile: d.volatile,
  };
}

/** Preview and save share this: parse, resolve names, check, infer the result type. */
export function compileFormula(source: string, ix: OwnerIndex, at: Where, own: { key: string } | null): { stored: string; ast: Node; deps: DepRow[]; volatile: "today" | "now" | null; type: FType; grouped: GroupableCall[]; scan: Extract<Node, { t: "key" }>[] } {
  const r = toStoredFormula(source, nameResolver(ix, at, own));
  if (!r.ok) throw new AppError("validation_error", r.error.message, { position: { start: r.error.start, end: r.error.end } });
  const issues = validateCalls(r.ast);
  if (issues.length) throw new AppError("validation_error", issues[0]!.message, { position: { start: issues[0]!.start, end: issues[0]!.end } });
  const { deps, volatile } = depsOfAst(r.ast, at.tableId);
  const colOf = (t: string | null, k: string) => ix.column(t ?? at.tableId, k);
  const type = inferType(r.ast, (n) => (n.t === "key" ? typeOfColumn(colOf(n.table, n.key)) : "unknown"));
  const grouped = groupableCalls(r.ast, (t, k) => ix.column(t, k));
  return { stored: r.stored, ast: r.ast, deps, volatile, type, grouped, scan: scanRangeNodes(r.ast, grouped) };
}

/** Tables read by in-memory scans must stay small (design module2 section 6.6). */
export function assertScanLimits(ix: OwnerIndex, scan: { table: string | null }[]): void {
  const seen = new Set<string>();
  for (const n of scan) {
    if (!n.table || seen.has(n.table)) continue;
    seen.add(n.table);
    const t = ix.tableById.get(n.table);
    if (t && t.rowCount > SCAN_ROW_LIMIT) {
      throw new AppError(
        "validation_error",
        `Bảng "${t.name}" có ${t.rowCount.toLocaleString("vi-VN")} dòng. Cách dùng này (điều kiện >, <, ký tự đại diện, regex, MATCH gần đúng...) phải duyệt từng dòng nên chỉ cho bảng nguồn tối đa ${SCAN_ROW_LIMIT.toLocaleString("vi-VN")} dòng. Dùng điều kiện bằng (=) cho SUMIFS/COUNTIFS/XLOOKUP để tính bằng SQL gom nhóm.`,
        { code: "scan_too_large", table: t.name, rows: t.rowCount, limit: SCAN_ROW_LIMIT },
      );
    }
  }
}

function targetResultType(c: IxColumn): ResultType {
  const t = isComputedType(c.type) ? resultTypeOf(c) : c.type;
  switch (t) {
    case "number":
    case "currency":
    case "rating":
    case "auto_number":
      return "number";
    case "percent":
      return "percent";
    case "date":
      return "date";
    case "datetime":
    case "created_time":
    case "modified_time":
      return "datetime";
    case "checkbox":
      return "checkbox";
    default:
      return "text";
  }
}

export interface ComputedInput {
  id: string;
  key: string;
  tableId: string;
  datahubId: string;
  type: "formula" | "relation" | "lookup" | "rollup";
  /** The existing column when updating. */
  current?: DhColumn;
}

/**
 * Validates and prepares the configuration of a formula, relation, lookup or rollup column. Throws a Vietnamese
 * `validation_error` for anything wrong (unknown name, wrong owner, cycle, too large to scan). Needs the owner's index.
 */
export async function prepareComputed(db: Executor, ix: OwnerIndex, schema: TableSchema, spec: ComputedInput, raw: Record<string, unknown>): Promise<PreparedComputed> {
  const at = { tableId: spec.tableId, datahubId: spec.datahubId };
  const self = { tableId: spec.tableId, key: spec.key };
  if (spec.type === "relation") {
    const r = RelationConfig.safeParse(raw);
    if (!r.success) badConfig("Liên kết dòng", r.error);
    if (!ix.tableById.has(r.data.target_table_id)) {
      throw new AppError("validation_error", "Bảng liên kết phải là bảng trong datahub do bạn sở hữu (bảng người khác chia sẻ không dùng được).", { code: "#PERM!" });
    }
    if (spec.current && spec.current.config.target_table_id !== r.data.target_table_id) throw new AppError("validation_error", "Không đổi được bảng đích của cột liên kết; tạo cột mới.");
    return { config: { target_table_id: r.data.target_table_id, multiple: r.data.multiple ?? true }, deps: [], volatile: null, resultType: null };
  }
  if (spec.type === "formula") {
    const r = FormulaConfig.safeParse(raw);
    if (!r.success) badConfig("Công thức", r.error);
    const c = compileFormula(r.data.formula, ix, at, self);
    assertScanLimits(ix, c.scan);
    await assertNoCycle(db, ix, self, c.deps);
    const resultType = r.data.result_type ?? resultTypeFor(c.type);
    return { config: { expr: c.stored, result_type: resultType }, deps: c.deps, volatile: c.volatile, resultType };
  }
  // lookup / rollup
  const r = (spec.type === "lookup" ? LookupConfig : RollupConfig).safeParse(raw);
  if (!r.success) badConfig(spec.type === "lookup" ? "Lookup" : "Rollup", r.error);
  const data = r.data as z.infer<typeof RollupConfig>;
  const rel = schema.tryResolve(data.relation);
  if (!rel || rel.deletedAt || rel.type !== "relation") throw new AppError("validation_error", `"${data.relation}" không phải cột Liên kết dòng của bảng này.`);
  const targetTable = rel.config.target_table_id as string;
  if (!ix.tableById.has(targetTable)) throw new AppError("validation_error", "Bảng đích của cột liên kết không còn dùng được.", { code: "#REF!" });
  const target = ix.columnByRef(targetTable, data.target_column);
  if (!target) throw new AppError("validation_error", `Không có cột "${data.target_column}" trong bảng đích "${ix.tableById.get(targetTable)!.name}".`);
  const multiple = rel.config.multiple !== false;
  let resultType: ResultType;
  if (spec.type === "lookup") {
    resultType = multiple ? "text" : targetResultType(target);
  } else {
    const tt = targetResultType(target);
    switch (data.fn) {
      case "sum":
      case "avg":
        if (tt !== "number" && tt !== "percent") throw new AppError("validation_error", `${data.fn.toUpperCase()} chỉ dùng cho cột số.`);
        resultType = tt === "percent" ? "percent" : "number";
        break;
      case "min":
      case "max":
        if (tt === "text" || tt === "checkbox") throw new AppError("validation_error", `${data.fn.toUpperCase()} chỉ dùng cho cột số hoặc ngày.`);
        resultType = tt;
        break;
      case "concat":
        resultType = "text";
        break;
      default:
        resultType = "number";
    }
  }
  const deps: DepRow[] = [
    { srcTableId: spec.tableId, srcKey: rel.key, kind: "cell" },
    { srcTableId: targetTable, srcKey: target.key, kind: "range" },
  ];
  await assertNoCycle(db, ix, self, deps);
  return {
    config: { relation_key: rel.key, target_table_id: targetTable, target_key: target.key, ...(spec.type === "rollup" ? { fn: data.fn } : {}), result_type: resultType },
    deps,
    volatile: null,
    resultType,
  };
}

/** Configuration for API output: formulas with current names, link targets with names. */
export function displayConfig(col: Pick<DhColumn, "type" | "config" | "tableId">, ix: OwnerIndex | null): Record<string, unknown> {
  const cfg = { ...col.config };
  if (!ix) {
    // No names to show (not the owner): keys mean nothing to the reader, so they are left out.
    for (const k of ["expr", "relation_key", "target_table_id", "target_key"]) delete cfg[k];
    return cfg;
  }
  if (col.type === "formula" && ix && typeof cfg.expr === "string") {
    cfg.formula = toDisplayFormula(cfg.expr, (t, k) => ix.namesOf(col.tableId, t, k));
    delete cfg.expr;
  } else if ((col.type === "lookup" || col.type === "rollup") && ix) {
    const rel = ix.column(col.tableId, cfg.relation_key as string);
    const target = ix.column(cfg.target_table_id as string, cfg.target_key as string);
    cfg.relation = rel?.name ?? null;
    cfg.target_column = target?.name ?? null;
    cfg.target_table = ix.tableById.get(cfg.target_table_id as string)?.name ?? null;
  } else if (col.type === "relation" && ix) {
    (cfg as Record<string, unknown>).target_table = ix.tableById.get(cfg.target_table_id as string)?.name ?? null;
  }
  return cfg;
}
