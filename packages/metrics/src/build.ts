import { sql, type SQL } from "drizzle-orm";
import { compileFilter, type FieldMap } from "@soe/db";
import { AppError, dateRangeNode, type FilterNode } from "@soe/shared";
import { findColumn, normRef, optionId, valueExpr, type MColumn, type MTable, type TableRef, type ValueKind } from "./columns";
import { RangeSchema, parseJson, type Bucket, type CollapseAgg, type Cohort, type Group, type Measure, type TimeSpec } from "./schema";
import { bucketLabel, bucketStart, dayOf, periodIndex, resolveRange, type Shift } from "./time";

/**
 * One metric -> ONE grouped SQL statement on Postgres (design module3 section 6). The statement reads `dh_rows` of the base table
 * (with the scope marker of the table access, so the data scope of the person applies), joins the other tables of the datahub
 * folded to one row per base row, filters, groups and aggregates. Nothing here runs SQL: the API runs `Built.sql` and calls `shape`.
 */

export interface PlanJoin {
  /** Name inside the metric (`Alias.Column`). */
  alias: string;
  table: MTable;
  /** Relation column of the base table, or key pairs. */
  link?: string;
  on?: { left: string; right: string }[];
  collapse?: Record<string, CollapseAgg>;
}

export interface PlanInput {
  base: MTable;
  joins: PlanJoin[];
  measure: Measure;
  filter?: FilterNode;
  time?: TimeSpec;
  group_by?: Group[];
  order?: "group" | "value_desc" | "value_asc";
  limit: number;
  fiscalStartMonth: number;
  /** Vietnam-time date of "today" (relative ranges resolve against it). */
  today: string;
  /** Read an earlier period instead of the range: the same days moved back, the time bucket moved forward so it lines up with the current one. */
  shift?: Shift;
  /** Cohort mode (section 5.3): groups are the start period and the number of periods until the event, then `group_by`. */
  cohort?: Cohort;
  /** Keep only values inside (`inside`) or outside (`outside`) these bounds of the measure column (IQR outliers). */
  outliers?: { lower: number; upper: number; keep: "inside" | "outside" };
}

export interface GroupInfo {
  /** The column as written by the caller, resolved to its name. */
  column: string;
  kind: ValueKind;
  bucket?: Bucket;
  options?: { id: string; name: string }[];
}

export type ValueType = "number" | "date" | "datetime" | "text";

export interface Built {
  sql: SQL;
  groups: GroupInfo[];
  valueType: ValueType;
  range: { field: string; from: string | null; to: string | null } | null;
  limit: number;
  fiscalStartMonth: number;
  /** Aliases of the joined tables the statement reads. */
  joined: string[];
}

const NUMERIC_AGGS = new Set(["sum", "avg", "median", "percentile", "trimmed_mean", "stddev", "stddev_pop"]);

function bad(message: string, details: Record<string, unknown>, code: "validation_error" | "invalid_filter" = "validation_error"): never {
  throw new AppError(code, message, details);
}

interface Resolved {
  t: number;
  col: MColumn;
  expr: SQL;
}

const kindAfter = (col: MColumn, agg: CollapseAgg): ValueKind => (agg === "count" || agg === "sum" || agg === "avg" ? "number" : col.kind);

/** Default way a joined column is folded to one value per base row. */
const defaultCollapse = (col: MColumn): CollapseAgg => (col.kind === "number" ? "sum" : col.kind === "boolean" ? "max" : "min");

class Resolver {
  readonly refs: TableRef[];
  /** Per joined table (index 1...): the columns used and how each is folded. */
  readonly used: Map<string, { col: MColumn; agg: CollapseAgg }>[];

  constructor(
    readonly base: MTable,
    readonly joins: PlanJoin[],
  ) {
    this.refs = [{ alias: "b", data: "b.data", isBase: true }, ...joins.map((_, i) => ({ alias: `j${i + 1}`, data: `j${i + 1}.data`, isBase: false }))];
    this.used = [new Map(), ...joins.map(() => new Map<string, { col: MColumn; agg: CollapseAgg }>())];
  }

  available(): string[] {
    return [...this.base.columns.filter((c) => !c.meta).map((c) => c.name), ...this.joins.flatMap((j) => j.table.columns.filter((c) => !c.meta).map((c) => `${j.alias}.${c.name}`))].slice(0, 60);
  }

  resolve(ref: string, code: "validation_error" | "invalid_filter" = "validation_error"): Resolved {
    const own = findColumn(this.base, ref);
    if (own) return { t: 0, col: own, expr: valueExpr(this.refs[0]!, own) };
    const n = normRef(ref);
    for (let i = 0; i < this.joins.length; i++) {
      const j = this.joins[i]!;
      const prefix = `${normRef(j.alias)}.`;
      if (!n.startsWith(prefix)) continue;
      const col = findColumn(j.table, ref.slice(prefix.length));
      if (!col) bad(`Bảng "${j.alias}" không có cột "${ref.slice(prefix.length)}".`, { reason: "unknown_column", column: ref, available: this.available() }, code);
      if (col.meta) bad(`Cột "${ref}" là trường chuẩn của dòng, chỉ dùng được ở bảng chính.`, { reason: "unsupported_column", column: ref }, code);
      if (col.kind === "set") bad(`Cột "${ref}" (${col.typeLabel ?? "nhiều giá trị"}) không dùng được trong bảng ghép.`, { reason: "unsupported_column", column: ref }, code);
      const agg = j.collapse && Object.entries(j.collapse).find(([k]) => normRef(k) === normRef(col.name) || k === col.key)?.[1] || defaultCollapse(col);
      if ((agg === "sum" || agg === "avg") && col.kind !== "number") bad(`Không "${agg}" được cột "${ref}": chỉ cột số mới cộng hoặc lấy trung bình.`, { reason: "bad_collapse", column: ref, collapse: agg }, code);
      const kind = kindAfter(col, agg);
      const exposed: MColumn = { ...col, kind };
      this.used[i + 1]!.set(col.key, { col, agg });
      return { t: i + 1, col: exposed, expr: valueExpr(this.refs[i + 1]!, exposed) };
    }
    return bad(`Không có cột "${ref}".`, { reason: "unknown_column", column: ref, available: this.available() }, code);
  }
}

/** Folds the filter (columns by name, options by name) to field ids of the statement and collects the field map. */
function normalizeFilter(rs: Resolver, node: FilterNode, fm: FieldMap): FilterNode {
  const walk = (n: FilterNode): FilterNode => {
    if ("and" in n) return { and: n.and.map(walk) };
    if ("or" in n) return { or: n.or.map(walk) };
    const r = rs.resolve(n.field, "invalid_filter");
    const id = `${r.t}:${r.col.key}`;
    fm[id] = { type: r.col.kind, expr: r.expr, sortable: false };
    const { op } = n;
    let { value } = n;
    if ((op === "eq" || op === "neq") && value === null) return { field: id, op: op === "eq" ? "is_empty" : "is_not_empty" };
    if (r.col.kind === "enum" && value !== undefined && value !== null) {
      const one = (v: unknown): string => optionId(r.col, v) ?? bad(`Lựa chọn không có trong cột "${r.col.name}".`, { reason: "unknown_option", column: r.col.name, options: (r.col.options ?? []).map((o) => o.name) }, "invalid_filter");
      value = Array.isArray(value) ? value.map(one) : one(value);
    }
    return value === undefined ? { field: id, op } : { field: id, op, value };
  };
  return walk(node);
}

const lit = (n: number): SQL => {
  if (!Number.isFinite(n)) throw new AppError("internal_error", "Giá trị số không hợp lệ.");
  return sql.raw(String(n));
};

function expectKind(m: Measure, col: MColumn, ok: ValueKind[], hint: string): void {
  if (!ok.includes(col.kind)) {
    bad(`Phép "${m.agg}" không dùng được cho cột "${col.name}" (${col.typeLabel ?? col.kind}). ${hint}`, { reason: "bad_measure", agg: m.agg, column: col.name, column_kind: col.kind, allowed_kinds: ok }, "validation_error");
  }
}

/** The aggregate over the value `x` of the measure column and the type of the result. */
function aggregate(m: Measure, col: MColumn | null, x: SQL | null): { sql: SQL; type: ValueType } {
  if (m.agg === "count") {
    if (!col || !x) return { sql: sql`count(*)`, type: "number" };
    switch (col.kind) {
      case "text":
      case "enum": return { sql: sql`count(NULLIF(${x}, ''))`, type: "number" };
      case "set": return { sql: sql`count(*) FILTER (WHERE ${x} IS NOT NULL AND ${x} <> '[]'::jsonb)`, type: "number" };
      case "boolean": return { sql: sql`count(*) FILTER (WHERE ${x})`, type: "number" };
      default: return { sql: sql`count(${x})`, type: "number" };
    }
  }
  if (!col || !x) throw new AppError("internal_error", "Thiếu cột cho phép tổng hợp.");
  if (m.agg === "count_distinct") {
    expectKind(m, col, ["number", "date", "datetime", "text", "enum", "boolean", "uuid"], "Cột nhiều giá trị (nhiều lựa chọn, liên kết, đính kèm) không đếm không trùng được.");
    if (col.kind === "text") return { sql: sql`count(DISTINCT NULLIF(soe_unaccent(lower(btrim(${x}))), ''))`, type: "number" };
    return { sql: sql`count(DISTINCT ${x})`, type: "number" };
  }
  if (NUMERIC_AGGS.has(m.agg)) expectKind(m, col, ["number"], "Chỉ cột số, tiền, phần trăm hoặc công thức cho ra số mới dùng được. Muốn đếm thì dùng count hoặc count_distinct.");
  switch (m.agg) {
    case "sum": return { sql: sql`sum(${x})`, type: "number" };
    case "avg": return { sql: sql`avg(${x})`, type: "number" };
    case "stddev": return { sql: sql`stddev_samp(${x})`, type: "number" };
    case "stddev_pop": return { sql: sql`stddev_pop(${x})`, type: "number" };
    case "median": return { sql: sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY (${x})::float8)`, type: "number" };
    case "percentile": return { sql: sql`percentile_cont(${lit((m.p ?? 50) / 100)}) WITHIN GROUP (ORDER BY (${x})::float8)`, type: "number" };
    case "min":
    case "max": {
      expectKind(m, col, ["number", "date", "datetime", "text", "enum"], "Cột nhiều giá trị hoặc checkbox không có nhỏ nhất / lớn nhất.");
      const f = m.agg === "min" ? sql`min` : sql`max`;
      if (col.kind === "number") return { sql: sql`${f}(${x})`, type: "number" };
      if (col.kind === "date") return { sql: sql`${f}(${x})::text`, type: "date" };
      if (col.kind === "datetime") return { sql: sql`to_char(${f}(${x}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`, type: "datetime" };
      return { sql: sql`${f}((${x})::text)`, type: "text" };
    }
    // Trimmed mean is planned apart (window functions); this entry only tells the caller that the result is a number.
    case "trimmed_mean": return { sql: sql`NULL`, type: "number" };
  }
}

/** Folds a column of the joined table to one jsonb value for each key. */
function collapseExpr(col: MColumn, agg: CollapseAgg, ref: TableRef, rowNo: SQL): SQL {
  const x = valueExpr(ref, col);
  switch (agg) {
    case "count": return sql`to_jsonb(count(${col.kind === "text" || col.kind === "enum" ? sql`NULLIF(${x}, '')` : x}))`;
    case "sum": return sql`to_jsonb(sum(${x}))`;
    case "avg": return sql`to_jsonb(avg(${x}))`;
    case "first": return sql`to_jsonb((array_agg(${x} ORDER BY ${rowNo}))[1])`;
    case "last": return sql`to_jsonb((array_agg(${x} ORDER BY ${rowNo} DESC))[1])`;
    case "min":
    case "max": {
      if (col.kind === "boolean") return agg === "min" ? sql`to_jsonb(bool_and(${x}))` : sql`to_jsonb(bool_or(${x}))`;
      const f = agg === "min" ? sql`min` : sql`max`;
      if (col.kind === "uuid") return sql`to_jsonb(${f}((${x})::text))`;
      return sql`to_jsonb(${f}(${x}))`;
    }
  }
}

const normPart = (x: SQL): SQL => sql`coalesce(soe_unaccent(lower(btrim((${x})::text))), '')`;

/** Normalised key of a row from key values: accents removed, not case sensitive, trimmed; null when every part is empty. */
function keyOf(parts: SQL[]): SQL {
  const cat = sql`concat_ws(chr(31), ${sql.join(parts.map(normPart), sql`, `)})`;
  return sql`(CASE WHEN replace(${cat}, chr(31), '') = '' THEN NULL ELSE ${cat} END)`;
}

/** Checks the join definition against the tables and returns the key columns, or the relation column. */
function joinParts(base: MTable, j: PlanJoin): { link?: MColumn; pairs: { left: MColumn; right: MColumn }[] } {
  if (j.link) {
    const c = findColumn(base, j.link);
    if (!c || c.kind !== "set" || !c.relationTarget) bad(`"${j.link}" không phải cột Liên kết của bảng "${base.name}".`, { reason: "bad_join", join: j.alias, link: j.link }, "validation_error");
    if (c.relationTarget !== j.table.id) bad(`Cột Liên kết "${c.name}" không trỏ tới bảng "${j.table.name}".`, { reason: "bad_join", join: j.alias, link: c.name, hint: "Chọn đúng cột Liên kết trỏ tới bảng cần ghép, hoặc ghép bằng cặp cột khoá (on)." }, "validation_error");
    return { link: c, pairs: [] };
  }
  const pairs = (j.on ?? []).map((p) => {
    const left = findColumn(base, p.left);
    const right = findColumn(j.table, p.right);
    if (!left) bad(`Bảng "${base.name}" không có cột khoá "${p.left}".`, { reason: "bad_join", join: j.alias, column: p.left }, "validation_error");
    if (!right) bad(`Bảng "${j.table.name}" không có cột khoá "${p.right}".`, { reason: "bad_join", join: j.alias, column: p.right }, "validation_error");
    if (left.kind === "set" || right.kind === "set") bad("Cột khoá không được là cột nhiều giá trị.", { reason: "bad_join", join: j.alias }, "validation_error");
    return { left, right };
  });
  return { pairs };
}

const LINK_ELEMENTS = (ref: TableRef, col: MColumn): SQL => sql`jsonb_array_elements_text(CASE WHEN jsonb_typeof(${valueExpr(ref, col)}) = 'array' THEN ${valueExpr(ref, col)} ELSE '[]'::jsonb END)`;

/** The `JOIN` of one joined table: its used columns folded to one jsonb `data` per base row, left join (a base row with no partner stays, its joined columns are empty). */
function joinSql(rs: Resolver, i: number): SQL {
  const j = rs.joins[i]!;
  const ref = rs.refs[i + 1]!;
  const r = `r${i + 1}`;
  const rRef: TableRef = { alias: r, data: `${r}.data`, isBase: false };
  const parts = joinParts(rs.base, j);
  const fold = sql.join(
    [...rs.used[i + 1]!.values()].flatMap(({ col, agg }) => [sql.raw(`'${col.key}'`), collapseExpr(col, agg, rRef, sql.raw(`${r}.row_no`))]),
    sql`, `,
  );
  const obj = sql`jsonb_build_object(${fold})`;
  const alive = sql`${j.table.scope(r)} AND ${sql.raw(r)}.deleted_at IS NULL`;
  if (parts.link) {
    return sql`LEFT JOIN LATERAL (SELECT ${obj} AS data FROM ${LINK_ELEMENTS(rs.refs[0]!, parts.link)} AS l(id) JOIN dh_rows ${sql.raw(r)} ON ${sql.raw(r)}.id = l.id::uuid AND ${alive} HAVING count(*) > 0) ${sql.raw(ref.alias)} ON true`;
  }
  const jkey = keyOf(parts.pairs.map((p) => valueExpr(rRef, p.right)));
  const bkey = keyOf(parts.pairs.map((p) => valueExpr(rs.refs[0]!, p.left)));
  return sql`LEFT JOIN (SELECT ${jkey} AS k, ${obj} AS data FROM dh_rows ${sql.raw(r)} WHERE ${alive} AND ${jkey} IS NOT NULL GROUP BY 1) ${sql.raw(ref.alias)} ON ${sql.raw(ref.alias)}.k = ${bkey}`;
}

interface Prepared {
  rs: Resolver;
  mCol: MColumn | null;
  x: SQL | null;
  agg: { sql: SQL; type: ValueType };
  groups: GroupInfo[];
  gSql: SQL[];
  from: SQL;
  where: SQL[];
  range: Built["range"];
  sm: number;
}

/** Resolves every column, the groups and the rows of the statement (scope, filter, range, cohort and outlier conditions). */
function prepare(p: PlanInput, mode: "main" | "cohort_sizes" | "outlier_bounds" = "main"): Prepared {
  const aliases = new Set<string>();
  for (const j of p.joins) {
    const a = normRef(j.alias);
    if (aliases.has(a)) bad(`Hai bảng ghép cùng tên "${j.alias}". Đặt tên khác bằng "as".`, { reason: "bad_join", alias: j.alias });
    aliases.add(a);
  }
  const rs = new Resolver(p.base, p.joins);
  const sm = p.fiscalStartMonth;

  // The measure.
  let mCol: MColumn | null = null;
  let x: SQL | null = null;
  if (p.measure.field) {
    const r = rs.resolve(p.measure.field);
    mCol = r.col;
    x = r.expr;
  }
  const agg = aggregate(p.measure, mCol, x);

  // The groups: the time bucket first, then the columns.
  const groups: GroupInfo[] = [];
  const gSql: SQL[] = [];
  const time = p.time;
  if (time?.range && !time.field) bad("Có khoảng thời gian (range) thì phải chỉ rõ cột ngày (time.field).", { reason: "bad_time" });
  if (time?.bucket && !time.field) bad("Có nhóm theo thời gian (bucket) thì phải chỉ rõ cột ngày (time.field).", { reason: "bad_time" });
  const timeCol = time?.field ? rs.resolve(time.field) : null;
  if (timeCol && timeCol.col.kind !== "date" && timeCol.col.kind !== "datetime") {
    bad(`Cột "${timeCol.col.name}" không phải cột ngày nên không dùng làm trục thời gian được.`, { reason: "bad_time", column: timeCol.col.name, column_kind: timeCol.col.kind });
  }
  const addGroup = (r: Resolved, bucket?: Bucket, shifted = false) => {
    const k = r.col.kind;
    if (k === "set") bad(`Không nhóm theo cột "${r.col.name}" (${r.col.typeLabel ?? "nhiều giá trị"}) được.`, { reason: "bad_group", column: r.col.name });
    if (k === "date" || k === "datetime") {
      const b = bucket ?? "day";
      groups.push({ column: r.col.name, kind: k, bucket: b });
      const day = dayOf(r.expr, k);
      gSql.push(sql`(${bucketStart(shifted && p.shift ? sql`(${day} + ${sql.raw(`interval '${p.shift.interval}'`)})::date` : day, b, sm)})::text`);
    } else {
      groups.push({ column: r.col.name, kind: k, ...(k === "enum" ? { options: r.col.options ?? [] } : {}) });
      gSql.push(k === "uuid" ? sql`(${r.expr})::text` : k === "number" ? sql`(${r.expr})::text` : r.expr);
    }
  };
  // Cohort: the start period, then the number of periods until the event (0 = the same period).
  const cohortWhere: SQL[] = [];
  if (p.cohort && mode !== "outlier_bounds") {
    const c = p.cohort;
    const bucket = c.bucket ?? "month";
    const start = rs.resolve(c.start);
    const event = rs.resolve(c.event);
    for (const [label, r] of [["start", start], ["event", event]] as const) {
      if (r.col.kind !== "date" && r.col.kind !== "datetime") bad(`Cohort.${label}: cột "${r.col.name}" không phải cột ngày.`, { reason: "bad_cohort", column: r.col.name, column_kind: r.col.kind });
    }
    const sDay = dayOf(start.expr, start.col.kind as "date" | "datetime");
    const eDay = dayOf(event.expr, event.col.kind as "date" | "datetime");
    addGroup(start, bucket);
    const off = sql`(${periodIndex(eDay, bucket, sm)} - ${periodIndex(sDay, bucket, sm)})`;
    if (mode === "main") {
      groups.push({ column: `Kỳ sau ${start.col.name}`, kind: "number" });
      gSql.push(sql`(${off})::text`);
      cohortWhere.push(sql`${event.expr} IS NOT NULL`, sql`${off} >= 0`);
      if (c.max_offset !== undefined) cohortWhere.push(sql`${off} <= ${lit(c.max_offset)}`);
    }
    cohortWhere.push(sql`${start.expr} IS NOT NULL`);
    if (c.mature_after) cohortWhere.push(sql`${periodIndex(sDay, bucket, sm)} <= ${periodIndex(sql`${sql.raw(`DATE '${p.today}'`)}`, bucket, sm)} - ${lit(c.mature_after)}`);
  }
  if (timeCol && time?.bucket) addGroup(timeCol, time.bucket, true);
  for (const g of p.group_by ?? []) {
    const r = rs.resolve(g.field);
    if (g.bucket && r.col.kind !== "date" && r.col.kind !== "datetime") bad(`"bucket" chỉ dùng cho cột ngày, "${r.col.name}" không phải.`, { reason: "bad_group", column: r.col.name });
    addGroup(r, g.bucket);
  }

  // The rows: scope, not deleted, filter, time range.
  const fm: FieldMap = {};
  const where: SQL[] = [p.base.scope("b"), sql`b.deleted_at IS NULL`];
  let nodes: FilterNode[] = [];
  if (p.filter) nodes.push(normalizeFilter(rs, p.filter, fm));
  let range: Built["range"] = null;
  if (timeCol && time?.range) {
    const dr = p.shift ? { from: p.shift.from, to: p.shift.to } : resolveRange(parseJson(RangeSchema, time.range, "Khoảng thời gian"), p.today, sm);
    if (dr.from && dr.to && dr.from > dr.to) bad("Ngày bắt đầu phải trước hoặc cùng ngày kết thúc.", { reason: "bad_time", from: dr.from, to: dr.to });
    const id = `${timeCol.t}:${timeCol.col.key}`;
    fm[id] = { type: timeCol.col.kind, expr: timeCol.expr, sortable: false };
    nodes.push(dateRangeNode(id, timeCol.col.kind as "date" | "datetime", dr));
    range = { field: timeCol.col.name, from: dr.from, to: dr.to };
  }
  nodes = nodes.filter(Boolean);
  if (nodes.length) where.push(compileFilter(nodes.length === 1 ? nodes[0]! : { and: nodes }, fm)!);

  where.push(...cohortWhere);
  if (p.outliers && mode !== "outlier_bounds") {
    if (!x || !mCol || mCol.kind !== "number") bad("Loại giá trị ngoại lai cần phép đo trên một cột số (measure.field).", { reason: "bad_outliers", ...(mCol ? { column: mCol.name, column_kind: mCol.kind } : {}) });
    const { lower, upper, keep } = p.outliers;
    where.push(keep === "inside" ? sql`(${x} IS NULL OR (${x} >= ${lit(lower)} AND ${x} <= ${lit(upper)}))` : sql`(${x} IS NOT NULL AND (${x} < ${lit(lower)} OR ${x} > ${lit(upper)}))`);
  }

  const joins = p.joins.map((_, i) => joinSql(rs, i));
  const from = sql`dh_rows b ${sql.join(joins, sql` `)}`;
  return { rs, mCol, x, agg, groups, gSql, from, where, range, sm };
}

/** Plans one metric query. Throws `validation_error` / `invalid_filter` with `details.reason` the caller can act on. */
export function buildMetricQuery(p: PlanInput): Built {
  const { x, mCol, agg, groups, gSql, from, where, range, sm } = prepare(p);
  const wh = sql.join(where, sql` AND `);
  const k = gSql.length;
  const sel = (exprs: SQL[]) => sql.join(exprs.map((e, i) => sql`${e} AS ${sql.raw(`g${i}`)}`), sql`, `);
  const pos = (n: number) => sql.raw(String(n));
  const order =
    p.order === "value_desc" || p.order === "value_asc"
      ? sql` ORDER BY ${pos(k + 1)} ${sql.raw(p.order === "value_desc" ? "DESC" : "ASC")} NULLS LAST${k ? sql`, ${sql.join(gSql.map((_, i) => pos(i + 1)), sql`, `)}` : sql``}`
      : k
        ? sql` ORDER BY ${sql.join(gSql.map((_, i) => sql`${pos(i + 1)} NULLS LAST`), sql`, `)}`
        : sql``;
  const limit = sql` LIMIT ${p.limit + 1}`;

  let stmt: SQL;
  if (p.measure.agg === "trimmed_mean") {
    // Cut the lowest and highest share of the values of each group, then average the rest. Window functions rank the values.
    if (!x || !mCol) throw new AppError("internal_error", "Thiếu cột cho trung bình cắt đuôi.");
    expectKind(p.measure, mCol, ["number"], "Chỉ cột số mới dùng được.");
    const part = k ? sql`PARTITION BY ${sql.join(gSql, sql`, `)}` : sql``;
    const trim = lit(p.measure.trim ?? 0.1);
    const inner = sql`SELECT ${k ? sql`${sel(gSql)}, ` : sql``}${x} AS x, row_number() OVER (${part} ORDER BY ${x} NULLS LAST) AS rn, count(${x}) OVER (${part}) AS nn FROM ${from} WHERE ${wh}`;
    const gcols = sql.join(gSql.map((_, i) => sql.raw(`g${i}`)), sql`, `);
    stmt = sql`SELECT ${k ? sql`${gcols}, ` : sql``}avg(x) FILTER (WHERE x IS NOT NULL AND rn > floor(${trim} * nn) AND rn <= nn - floor(${trim} * nn)) AS value, count(*)::int AS n FROM (${inner}) s${k ? sql` GROUP BY ${gcols}` : sql``}`;
    const ord = p.order === "value_desc" || p.order === "value_asc" ? sql` ORDER BY ${pos(k + 1)} ${sql.raw(p.order === "value_desc" ? "DESC" : "ASC")} NULLS LAST` : k ? sql` ORDER BY ${sql.join(gSql.map((_, i) => sql`${pos(i + 1)} NULLS LAST`), sql`, `)}` : sql``;
    stmt = sql`${stmt}${ord}${limit}`;
  } else {
    stmt = sql`SELECT ${k ? sql`${sel(gSql)}, ` : sql``}${agg.sql} AS value, count(*)::int AS n FROM ${from} WHERE ${wh}${k ? sql` GROUP BY ${sql.join(gSql.map((_, i) => pos(i + 1)), sql`, `)}` : sql``}${order}${limit}`;
  }
  return { sql: stmt, groups, valueType: p.measure.agg === "trimmed_mean" ? "number" : agg.type, range, limit: p.limit, fiscalStartMonth: sm, joined: p.joins.map((j) => j.alias) };
}


/** Sizes of the cohorts: rows of each start period (same filters, mature cohorts only), by `group_by`. Same shape as a metric without `measure`. */
export function buildCohortSizes(p: PlanInput): Built {
  const { groups, gSql, from, where, range, sm } = prepare({ ...p, measure: { agg: "count" }, outliers: undefined }, "cohort_sizes");
  const k = gSql.length;
  const stmt = sql`SELECT ${sql.join(gSql.map((e, i) => sql`${e} AS ${sql.raw(`g${i}`)}`), sql`, `)}, count(*) AS value, count(*)::int AS n FROM ${from} WHERE ${sql.join(where, sql` AND `)} GROUP BY ${sql.join(gSql.map((_, i) => sql.raw(String(i + 1))), sql`, `)} ORDER BY ${sql.join(gSql.map((_, i) => sql`${sql.raw(String(i + 1))} NULLS LAST`), sql`, `)} LIMIT ${p.limit + 1}`;
  void k;
  return { sql: stmt, groups, valueType: "number", range, limit: p.limit, fiscalStartMonth: sm, joined: p.joins.map((j) => j.alias) };
}

/** Quartiles of the measure column over the rows the metric reads (no groups): the base of IQR outliers. One row: q1, q3, n. */
export function buildOutlierBounds(p: PlanInput): SQL {
  const { x, mCol, from, where } = prepare({ ...p, outliers: undefined, cohort: undefined, group_by: undefined, time: p.time ? { ...p.time, bucket: undefined } : undefined }, "outlier_bounds");
  if (!x || !mCol || mCol.kind !== "number") bad("Loại giá trị ngoại lai cần phép đo trên một cột số (measure.field).", { reason: "bad_outliers", ...(mCol ? { column: mCol.name, column_kind: mCol.kind } : {}) });
  return sql`SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY (${x})::float8) AS q1, percentile_cont(0.75) WITHIN GROUP (ORDER BY (${x})::float8) AS q3, count(${x})::int AS n FROM ${from} WHERE ${sql.join(where, sql` AND `)}`;
}

export interface MetricRow {
  groups: { value: string | number | boolean | null; label: string }[];
  value: number | string | null;
  /** Rows of the source that fall in the group. */
  count: number;
  /** `compare`: the value of the same group in the earlier period, and the change from it (`change_pct` is a ratio: 0.25 = +25%, null when the earlier value is 0 or empty). */
  previous?: number | string | null;
  change?: number | null;
  change_pct?: number | null;
  /** `target`: the target of the group, the share reached (`achieved` is a ratio: 0.85 = 85%) and what is still missing (`gap`, negative when the target is exceeded). */
  target?: number | null;
  achieved?: number | null;
  gap?: number | null;
  /** Derived metric: the error of the formula for this group (`#DIV/0!`...); `value` is null then. */
  error?: string;
}

export interface MetricTable {
  columns: { column: string; kind: ValueKind; bucket?: Bucket }[];
  value_type: ValueType;
  rows: MetricRow[];
  truncated: boolean;
}

/** Turns the rows Postgres returned into the answer: numbers as numbers, option ids as names, periods as readable labels. */
export function shape(b: Built, raw: Record<string, unknown>[]): MetricTable {
  const truncated = raw.length > b.limit;
  const rows = raw.slice(0, b.limit).map((r): MetricRow => {
    const groups = b.groups.map((g, i) => {
      const v = r[`g${i}`] as string | boolean | null;
      if (v === null || v === undefined) return { value: null, label: "(Trống)" };
      if (g.bucket) return { value: v as string, label: bucketLabel(v as string, g.bucket, b.fiscalStartMonth) };
      if (g.kind === "enum") return { value: v as string, label: g.options?.find((o) => o.id === v)?.name ?? (v as string) };
      if (g.kind === "number") return { value: Number(v), label: String(Number(v)) };
      if (g.kind === "boolean") return { value: v as boolean, label: v ? "Có" : "Không" };
      return { value: v as string, label: String(v) };
    });
    const val = r.value;
    return { groups, value: val === null || val === undefined ? null : b.valueType === "number" ? Number(val) : String(val), count: Number(r.n) };
  });
  return { columns: b.groups.map((g) => ({ column: g.column, kind: g.kind, ...(g.bucket ? { bucket: g.bucket } : {}) })), value_type: b.valueType, rows, truncated };
}

// ------------------------------------------------------------------------------------------------
// join diagnostics (design module3 section 3)
// ------------------------------------------------------------------------------------------------

export interface JoinDiagnosis {
  alias: string;
  table: string;
  kind: "link" | "key";
  /** Rows of the base table the person may read. */
  base_total: number;
  /** Rows that found a partner in the joined table: the ones the metric counts. */
  matched: number;
  unmatched: number;
  /** Key join: base rows with an empty key. */
  empty_key: number;
  /** Key join: keys with more than one row in the joined table. Link join: base rows with more than one link. */
  duplicate_groups: number;
  /** Rows of the joined table inside those groups (link join: links of those rows). */
  duplicate_rows: number;
  duplicate_sample: string[];
  /** True when duplicates exist: the joined columns were folded to one value per base row before the join, so no number is counted twice. */
  folded: boolean;
}

function joinCtes(base: MTable, j: PlanJoin): { with: SQL; kind: "link" | "key" } {
  const parts = joinParts(base, j);
  const bRef: TableRef = { alias: "b", data: "b.data", isBase: true };
  const rRef: TableRef = { alias: "r", data: "r.data", isBase: false };
  if (parts.link) {
    return {
      kind: "link",
      with: sql`bl AS (SELECT b.id, b.row_no, (SELECT count(*) FROM ${LINK_ELEMENTS(bRef, parts.link)} AS l(id) JOIN dh_rows r ON r.id = l.id::uuid AND ${j.table.scope("r")} AND r.deleted_at IS NULL)::int AS n FROM dh_rows b WHERE ${base.scope("b")} AND b.deleted_at IS NULL)`,
    };
  }
  const bk = keyOf(parts.pairs.map((p) => valueExpr(bRef, p.left)));
  const rk = keyOf(parts.pairs.map((p) => valueExpr(rRef, p.right)));
  return {
    kind: "key",
    with: sql`bk AS (SELECT b.id, b.row_no, ${bk} AS k FROM dh_rows b WHERE ${base.scope("b")} AND b.deleted_at IS NULL),
      jk AS (SELECT ${rk} AS k FROM dh_rows r WHERE ${j.table.scope("r")} AND r.deleted_at IS NULL),
      jg AS (SELECT k, count(*)::int AS n FROM jk WHERE k IS NOT NULL GROUP BY k)`,
  };
}

/** SQL of the diagnosis of one join: how many base rows found a partner, and where keys repeat. One row. */
export function diagnoseJoinSql(base: MTable, j: PlanJoin): SQL {
  const c = joinCtes(base, j);
  if (c.kind === "link") {
    return sql`WITH ${c.with} SELECT count(*)::int AS base_total, (count(*) FILTER (WHERE n > 0))::int AS matched, 0::int AS empty_key,
      (count(*) FILTER (WHERE n > 1))::int AS duplicate_groups, coalesce(sum(n) FILTER (WHERE n > 1), 0)::int AS duplicate_rows,
      coalesce((SELECT array_agg('#' || x.row_no) FROM (SELECT row_no FROM bl WHERE n > 1 ORDER BY n DESC, row_no LIMIT 5) x), '{}') AS duplicate_sample FROM bl`;
  }
  return sql`WITH ${c.with} SELECT (SELECT count(*) FROM bk)::int AS base_total,
      (SELECT count(*) FROM bk JOIN jg ON jg.k = bk.k)::int AS matched,
      (SELECT count(*) FROM bk WHERE k IS NULL)::int AS empty_key,
      (SELECT count(*) FROM jg WHERE n > 1)::int AS duplicate_groups,
      (SELECT coalesce(sum(n), 0) FROM jg WHERE n > 1)::int AS duplicate_rows,
      coalesce((SELECT array_agg(x.k) FROM (SELECT k FROM jg WHERE n > 1 ORDER BY n DESC, k LIMIT 5) x), '{}') AS duplicate_sample`;
}

export function shapeDiagnosis(j: PlanJoin, kind: "link" | "key", r: Record<string, unknown>): JoinDiagnosis {
  const total = Number(r.base_total);
  const matched = Number(r.matched);
  return {
    alias: j.alias,
    table: j.table.name,
    kind,
    base_total: total,
    matched,
    unmatched: total - matched,
    empty_key: Number(r.empty_key),
    duplicate_groups: Number(r.duplicate_groups),
    duplicate_rows: Number(r.duplicate_rows),
    duplicate_sample: (r.duplicate_sample as string[]) ?? [],
    folded: Number(r.duplicate_groups) > 0,
  };
}

export const joinKind = (j: PlanJoin): "link" | "key" => (j.link ? "link" : "key");

/** SQL listing base rows that found no partner in a join: id and row number, by row number. */
export function unmatchedSql(base: MTable, j: PlanJoin, limit: number, offset: number): SQL {
  const c = joinCtes(base, j);
  if (c.kind === "link") return sql`WITH ${c.with} SELECT id, row_no, count(*) OVER ()::int AS total FROM bl WHERE n = 0 ORDER BY row_no LIMIT ${limit} OFFSET ${offset}`;
  return sql`WITH ${c.with} SELECT bk.id, bk.row_no, count(*) OVER ()::int AS total FROM bk WHERE bk.k IS NULL OR NOT EXISTS (SELECT 1 FROM jg WHERE jg.k = bk.k) ORDER BY bk.row_no LIMIT ${limit} OFFSET ${offset}`;
}

/** Validates a join definition without running anything (used when a source is saved). */
export function checkJoin(base: MTable, j: PlanJoin): void {
  joinParts(base, j);
}
