import { sql } from "drizzle-orm";
import { AppError, businessDate, type FilterNode } from "@soe/shared";
import {
  DEFAULT_GROUPS,
  MAX_GROUPS,
  RangeSchema,
  attachTarget,
  buildCohortSizes,
  buildMetricQuery,
  countGroupsSql,
  buildOutlierBounds,
  checkJoin,
  combineDerived,
  compareTables,
  cumulate,
  diagnoseJoinSql,
  iqrBounds,
  isFormulaMetric,
  joinKind,
  normRef,
  parseDerived,
  parseJson,
  resolveRange,
  shape,
  shapeDiagnosis,
  shiftRange,
  targetKey,
  unmatchedSql,
  MetricDefSchema,
  type Built,
  type Cohort,
  type Group,
  type IqrBounds,
  type JoinDiagnosis,
  type Measure,
  type MetricDef,
  type MetricRow,
  type MetricTable,
  type MTable,
  type Outliers,
  type PlanInput,
  type QueryOverrides,
  type Shift,
  type Target,
  type TimeSpec,
} from "@soe/metrics";
import { readSetting } from "../system/settings-catalog";
import { DH_SETTINGS } from "../datahub/limits";
import { loadDatahubAccess, loadTableAccess } from "../datahub/access";
import { normName } from "../datahub/table-schema";
import { loadMTable, resolveSource, type Ctx, type ResolvedSource } from "./context";
import { runSql } from "./runner";

/** What a query computes on one source: the metric's own parts, with the call's overrides on top. */
export interface MetricSpec {
  measure: Measure;
  filter?: FilterNode;
  time?: TimeSpec;
  group_by?: Group[];
  cohort?: Cohort;
  outliers?: Outliers;
}

export interface MetricAnswer extends MetricTable {
  diagnostics: {
    /** Time range actually used (the days the relative range resolved to). */
    range: Built["range"];
    joins: JoinDiagnosis[];
    /** `compare`: the earlier days that were read. */
    compare?: { kind: string; from: string; to: string };
    /** `outliers`: the IQR bounds (null when there were fewer than 4 values to tell). */
    outliers?: IqrBounds | null;
  };
  /** `outliers.mode = "separate"`: the same metric over the values outside the bounds. */
  outlier_rows?: MetricTable;
  /** `cohort`: rows of each cohort (start period), to turn counts into shares. */
  cohort_sizes?: MetricTable;
  /** `totals`: the measure over each wider group, computed by the engine (never a sum of group results). `by_first`: one row per first group; `by_rest`: one row per combination of the other groups; `grand`: all rows. */
  totals?: { by_first: MetricRow[] | null; by_rest: MetricRow[] | null; grand: MetricRow | null };
  /** `top`: how many groups were folded into the "Khác" row (0 when there were no more than N). */
  other_groups?: number;
  /** Milliseconds the grouped statements took. */
  ms: number;
}

const and = (a: FilterNode | undefined, b: FilterNode | undefined): FilterNode | undefined => (!a ? b : !b ? a : { and: [...("and" in a ? a.and : [a]), ...("and" in b ? b.and : [b])] });

/** Merges the overrides of a call into the metric (`time` key by key, `filter` by AND, `group_by` replaced). */
export function mergeSpec(m: MetricSpec, ov: QueryOverrides = {}): MetricSpec {
  const time = m.time || ov.time ? { ...m.time, ...ov.time } : undefined;
  const filter = and(m.filter, ov.filter);
  const group_by = ov.group_by ?? m.group_by;
  const outliers = ov.outliers === undefined ? m.outliers : (ov.outliers ?? undefined);
  return { measure: m.measure, ...(filter ? { filter } : {}), ...(time ? { time } : {}), ...(group_by ? { group_by } : {}), ...(m.cohort ? { cohort: m.cohort } : {}), ...(outliers ? { outliers } : {}) };
}

export async function diagnoseJoins(ctx: Ctx, rs: ResolvedSource): Promise<JoinDiagnosis[]> {
  const out: JoinDiagnosis[] = [];
  for (const j of rs.joins) {
    checkJoin(rs.base, j);
    const r = await runSql(ctx, diagnoseJoinSql(rs.base, j), [rs.base, j.table]);
    out.push(shapeDiagnosis(j, joinKind(j), r.rows[0] as Record<string, unknown>));
  }
  return out;
}

/** Ids and row numbers of the base rows that found no partner in one join (`index` = position in `joins`). */
export async function unmatchedRows(ctx: Ctx, rs: ResolvedSource, index: number, limit: number, offset: number) {
  const j = rs.joins[index];
  if (!j) throw new AppError("validation_error", "Không có phép ghép thứ tự này.", { reason: "bad_join", joins: rs.joins.length });
  const r = await runSql(ctx, unmatchedSql(rs.base, j, limit, offset), [rs.base, j.table]);
  const rows = r.rows as { id: string; row_no: number; total: number }[];
  return { join: j.alias, total: rows[0]?.total ?? 0, items: rows.map((x) => ({ id: x.id, row_no: x.row_no })) };
}

/** Plans a metric without running it: every column, option and join is checked. Throws a structured error when something is wrong. */
export async function validateSpec(ctx: Ctx, rs: ResolvedSource, spec: MetricSpec, now: Date = new Date()): Promise<void> {
  const fiscal = await readSetting(ctx.db, DH_SETTINGS.fiscalStartMonth);
  const plan: PlanInput = { base: rs.base, joins: rs.joins, measure: spec.measure, ...optional(spec), limit: 1, fiscalStartMonth: fiscal, today: businessDate(now) };
  buildMetricQuery(plan);
  if (spec.outliers) buildOutlierBounds(plan);
  if (spec.cohort) buildCohortSizes(plan);
}

const optional = (spec: MetricSpec) => ({
  ...(spec.filter ? { filter: spec.filter } : {}),
  ...(spec.time ? { time: spec.time } : {}),
  ...(spec.group_by ? { group_by: spec.group_by } : {}),
  ...(spec.cohort ? { cohort: spec.cohort } : {}),
});

const rowsOf = async (ctx: Ctx, built: Built, tables: MTable[]): Promise<{ table: MetricTable; ms: number }> => {
  const res = await runSql(ctx, built.sql, tables);
  return { table: shape(built, res.rows), ms: res.ms };
};

/**
 * Runs one metric on its source: diagnoses the joins (a join with no match is an error that says what to fix), then ONE grouped
 * statement; with `outliers` first one statement for the quartiles, with `cohort` one more for the cohort sizes. `now` is only for
 * tests; relative ranges resolve against it in Vietnam time. `shift` reads an earlier period (see `compare`).
 */
export async function runMetric(ctx: Ctx, rs: ResolvedSource, spec: MetricSpec, ov: QueryOverrides = {}, now: Date = new Date(), shift?: Shift): Promise<MetricAnswer> {
  const fiscal = await readSetting(ctx.db, DH_SETTINGS.fiscalStartMonth);
  const merged = mergeSpec(spec, ov);
  const plan: PlanInput = {
    base: rs.base,
    joins: rs.joins,
    measure: merged.measure,
    ...optional(merged),
    ...(ov.order ? { order: ov.order } : {}),
    limit: ov.limit ?? DEFAULT_GROUPS,
    fiscalStartMonth: fiscal,
    today: businessDate(now),
    ...(shift ? { shift } : {}),
  };
  const tables = [rs.base, ...rs.joins.map((j) => j.table)];
  const built = buildMetricQuery(plan); // plans first: a wrong column is reported before any SQL runs
  const joins = await diagnoseJoins(ctx, rs);
  for (const d of joins) {
    if (d.base_total > 0 && d.matched === 0) {
      throw new AppError("validation_error", `Ghép bảng "${d.alias}": 0/${d.base_total} dòng ghép được.`, {
        reason: "join_no_match",
        join: d,
        hint: d.kind === "link" ? `Chưa dòng nào của bảng "${rs.base.name}" có liên kết tới "${d.table}". Kiểm tra cột Liên kết đã được điền chưa.` : `Không giá trị khoá nào của "${rs.base.name}" có trong "${d.table}". Kiểm tra hai cột khoá có cùng kiểu và cùng cách viết (mã, khoảng trắng, chữ hoa/thường không quan trọng) không.`,
      });
    }
  }
  let ms = 0;
  let bounds: IqrBounds | null | undefined;
  let main = built;
  let outside: Built | null = null;
  if (merged.outliers) {
    const qr = await runSql(ctx, buildOutlierBounds(plan), tables);
    const q = qr.rows[0] as { q1: number | null; q3: number | null; n: number };
    ms += qr.ms;
    bounds = iqrBounds(q.q1 === null ? null : Number(q.q1), q.q3 === null ? null : Number(q.q3), Number(q.n), merged.outliers.k);
    if (bounds && merged.outliers.mode !== "include") {
      main = buildMetricQuery({ ...plan, outliers: { lower: bounds.lower, upper: bounds.upper, keep: "inside" } });
      if (merged.outliers.mode === "separate") outside = buildMetricQuery({ ...plan, outliers: { lower: bounds.lower, upper: bounds.upper, keep: "outside" } });
    }
  }
  if (ov.top && merged.cohort) bad("bad_top", 'Cohort không dùng "top".');
  // The plan the main statement runs (with the outlier bounds when they cut values out): "top" and "Khác" read the same rows.
  const mainPlan: PlanInput = bounds && merged.outliers && merged.outliers.mode !== "include" ? { ...plan, outliers: { lower: bounds.lower, upper: bounds.upper, keep: "inside" } } : plan;
  if (ov.top) main = buildMetricQuery({ ...mainPlan, order: "value_desc", limit: ov.top });
  const r = await rowsOf(ctx, main, tables);
  ms += r.ms;
  let otherGroups: number | undefined;
  if (ov.top) {
    otherGroups = 0;
    if (r.table.truncated) {
      const kept = r.table.rows.map((x) => x.groups[0]!.value);
      const rest = await rowsOf(ctx, buildMetricQuery({ ...mainPlan, order: undefined, keepGroups: [], excludeFirst: kept, limit: 1 }), tables);
      ms += rest.ms;
      const row = rest.table.rows[0];
      r.table = { ...r.table, truncated: false, rows: [...r.table.rows, { groups: [{ value: null, label: "Khác" }], value: row?.value ?? null, count: row?.count ?? 0, other: true }] };
      const cnt = await runSql(ctx, countGroupsSql(mainPlan), tables);
      ms += cnt.ms;
      otherGroups = Number((cnt.rows[0] as { n: number }).n) - ov.top;
    }
  }
  const answer: MetricAnswer = { ...r.table, ...(otherGroups !== undefined ? { other_groups: otherGroups } : {}), diagnostics: { range: built.range, joins, ...(bounds !== undefined ? { outliers: bounds } : {}) }, ms };
  if (outside) {
    const o = await rowsOf(ctx, outside, tables);
    answer.outlier_rows = o.table;
    answer.ms += o.ms;
  }
  if (ov.totals) {
    const k = built.groups.length;
    if (k === 0 || merged.cohort) bad("bad_totals", 'Tổng chỉ dùng cho bảng có cột nhóm (và không dùng với cohort).', { reason: "bad_totals", groups: k });
    const one = async (keep: number[]) => (await rowsOf(ctx, buildMetricQuery({ ...mainPlan, keepGroups: keep, limit: MAX_GROUPS }), tables));
    const byFirst = k >= 2 ? await one([0]) : null;
    const byRest = k >= 2 ? await one(Array.from({ length: k - 1 }, (_, i) => i + 1)) : null;
    const grand = await one([]);
    answer.totals = { by_first: byFirst?.table.rows ?? null, by_rest: byRest?.table.rows ?? null, grand: grand.table.rows[0] ?? null };
    answer.ms += grand.ms + (byFirst?.ms ?? 0) + (byRest?.ms ?? 0);
  }
  if (merged.cohort) {
    const c = await rowsOf(ctx, buildCohortSizes(plan), tables);
    answer.cohort_sizes = c.table;
    answer.ms += c.ms;
  }
  return answer;
}

// ------------------------------------------------------------------------------------------------
// full metric: derived (formula), running total, comparison, target
// ------------------------------------------------------------------------------------------------

const MAX_DEPTH = 5;

interface SavedMetric {
  id: string;
  name: string;
  def: MetricDef;
  tableIds: string[];
}

/** A saved metric of the datahub by name, when the person may read every table it reads. */
async function savedMetricByName(ctx: Ctx, datahubId: string, name: string): Promise<SavedMetric> {
  const acc = await loadDatahubAccess(ctx, datahubId, "view");
  const r = await ctx.db.execute(sql`SELECT id, name, config, table_ids FROM mt_metrics WHERE /*scope*/ datahub_id = ${datahubId}::uuid AND name_norm = ${normName(name)} AND deleted_at IS NULL`);
  const row = r.rows[0] as { id: string; name: string; config: unknown; table_ids: string[] } | undefined;
  if (!row || (acc.tableIds !== null && !row.table_ids.every((t) => acc.tableIds!.includes(t)))) {
    const all = await ctx.db.execute(sql`SELECT name FROM mt_metrics WHERE /*scope*/ datahub_id = ${datahubId}::uuid AND deleted_at IS NULL ORDER BY name_norm LIMIT 30`);
    throw new AppError("validation_error", `Không có chỉ số "${name}" trong datahub này (hoặc bạn không có quyền xem các bảng nó đọc).`, {
      reason: "unknown_metric",
      metric: name,
      available: (all.rows as { name: string }[]).map((x) => x.name),
    });
  }
  return { id: row.id, name: row.name, def: parseJson(MetricDefSchema, row.config, `Chỉ số "${row.name}"`), tableIds: row.table_ids };
}

/** What a metric reads once the call's changes are applied. */
interface Effective {
  time?: TimeSpec;
  filter?: FilterNode;
  group_by?: Group[];
  compare?: "previous_period" | "year_ago";
  cumulative: boolean;
  target?: Target;
  outliers?: Outliers;
}

function effective(def: MetricDef, ov: QueryOverrides): Effective {
  const m = mergeSpec({ measure: def.measure ?? { agg: "count" }, ...(def.filter ? { filter: def.filter } : {}), ...(def.time ? { time: def.time } : {}), ...(def.group_by ? { group_by: def.group_by } : {}) }, ov);
  const compare = ov.compare === undefined ? def.compare : (ov.compare ?? undefined);
  const target = ov.target === undefined ? def.target : (ov.target ?? undefined);
  return {
    ...(m.time ? { time: m.time } : {}),
    ...(m.filter ? { filter: m.filter } : {}),
    ...(m.group_by ? { group_by: m.group_by } : {}),
    ...(compare ? { compare } : {}),
    cumulative: ov.cumulative ?? def.cumulative ?? false,
    ...(target ? { target } : {}),
    ...(m.outliers ? { outliers: m.outliers } : {}),
  };
}

const bad = (reason: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new AppError("validation_error", message, { reason, ...details });
};

export interface RunOpts {
  now?: Date;
  /** Needed for a derived metric (and for a source or target called by name). */
  datahubId?: string;
  /** Internal: an earlier period is being read for `compare`. */
  shift?: Shift;
  depth?: number;
  /** Names of the derived metrics being evaluated (cycle check). */
  stack?: string[];
}

/**
 * Runs a metric definition with everything it can have: a source metric or a derived one (`formula`), a running total, a comparison
 * with the previous period or the same period last year, a target. Each leaf is ONE grouped statement; the rest works on the small
 * tables they return (packages/metrics/src/post.ts).
 */
export async function runDefinition(ctx: Ctx, def: MetricDef, ov: QueryOverrides = {}, opts: RunOpts = {}): Promise<MetricAnswer> {
  const now = opts.now ?? new Date();
  const depth = opts.depth ?? 0;
  const eff = effective(def, ov);
  const formula = isFormulaMetric(def);
  let rs: ResolvedSource | null = null;
  let dh = opts.datahubId;
  if (!formula) {
    rs = await resolveSource(ctx, def.source!, dh);
    dh = rs.datahubId;
  } else if (!dh) {
    bad("datahub_required", "Chỉ số phái sinh cần datahub_id để tìm các chỉ số nó tham chiếu.");
  }
  if (formula && (eff.time?.field || ov.time?.field)) bad("bad_time", "Chỉ số phái sinh không chọn cột ngày (time.field): mỗi chỉ số nó dùng giữ cột ngày của mình. Chỉ đặt khoảng (range) và nhóm (bucket).");
  const fiscal = await readSetting(ctx.db, DH_SETTINGS.fiscalStartMonth);
  const today = businessDate(now);
  const bucketed = !!eff.time?.bucket;

  if (eff.cumulative) {
    if (formula) bad("bad_cumulative", "Chỉ số phái sinh không cộng dồn được (tỉ số cộng dồn không có nghĩa). Cộng dồn từng chỉ số tử và mẫu.");
    if (def.measure!.agg !== "count" && def.measure!.agg !== "sum") bad("bad_cumulative", `Cộng dồn chỉ dùng cho đếm (count) và tổng (sum), không dùng cho "${def.measure!.agg}".`, { agg: def.measure!.agg });
    if (!bucketed) bad("bad_cumulative", "Cộng dồn cần nhóm theo thời gian (time.field và time.bucket).");
    if (def.cohort) bad("bad_cumulative", "Cohort không cộng dồn.");
  }

  if (ov.top || ov.totals) {
    const what = ov.top ? 'nhóm "Khác" (top)' : "tổng";
    if (formula) bad("unsupported_for_derived", `Chưa hỗ trợ ${what} cho chỉ số phái sinh (tỉ số của các tổng không bằng tổng của tỉ số). Dùng chỉ số gốc.`);
    if (eff.compare || eff.cumulative || eff.target || def.cohort) bad("unsupported_combo", `Không dùng ${what} cùng so sánh, cộng dồn, mục tiêu hay cohort.`);
  }

  const series = async (shift?: Shift): Promise<MetricAnswer> => {
    const sub: QueryOverrides = { ...ov, ...(eff.cumulative ? { order: "group" as const, limit: MAX_GROUPS } : {}) };
    let a: MetricAnswer;
    if (formula) {
      a = await runFormula(ctx, def as MetricDef & { formula: string }, eff, sub, { ...opts, now, datahubId: dh!, depth, ...(shift ? { shift } : {}) });
    } else {
      a = await runMetric(ctx, rs!, { measure: def.measure!, ...(def.filter ? { filter: def.filter } : {}), ...(def.time ? { time: def.time } : {}), ...(def.group_by ? { group_by: def.group_by } : {}), ...(def.cohort ? { cohort: def.cohort } : {}), ...(def.outliers ? { outliers: def.outliers } : {}) }, sub, now, shift);
    }
    if (eff.cumulative) {
      if (a.truncated) bad("too_many_groups", "Quá nhiều nhóm để cộng dồn: thu hẹp khoảng thời gian hoặc bộ lọc.");
      a = { ...a, ...cumulate(a, 0) };
    }
    return a;
  };

  let a = await series(opts.shift);
  if (opts.shift) return a;

  if (eff.compare) {
    if (def.cohort) bad("bad_compare", "Cohort không so sánh với kỳ khác.");
    if (!eff.time?.range) bad("bad_compare", "So sánh với kỳ khác cần khoảng thời gian (time.range) để biết kỳ nào là kỳ này.");
    const range = resolveRange(parseJson(RangeSchema, eff.time!.range, "Khoảng thời gian"), today, fiscal);
    const shift = shiftRange(eff.compare, range);
    const prev = await series(shift);
    a = { ...a, ...compareTables(a, prev), diagnostics: { ...a.diagnostics, compare: { kind: eff.compare, from: shift.from, to: shift.to } }, ms: a.ms + prev.ms };
  }
  if (eff.target) {
    if (def.cohort) bad("bad_target", "Cohort không có mục tiêu.");
    a = await applyTarget(ctx, a, eff, dh!, fiscal, today);
  }
  return a;
}

async function runFormula(ctx: Ctx, def: MetricDef & { formula: string }, eff: Effective, ov: QueryOverrides, opts: Required<Pick<RunOpts, "now" | "datahubId" | "depth">> & RunOpts): Promise<MetricAnswer> {
  const parsed = parseDerived(def.formula);
  const stack = [...(opts.stack ?? []), def.name];
  if (opts.depth >= MAX_DEPTH) bad("formula_too_deep", `Chỉ số phái sinh lồng quá ${MAX_DEPTH} tầng.`, { stack });
  const refOv: QueryOverrides = {
    ...(eff.time?.range || eff.time?.bucket ? { time: { ...(eff.time.range ? { range: eff.time.range } : {}), ...(eff.time.bucket ? { bucket: eff.time.bucket } : {}) } } : {}),
    ...(eff.group_by ? { group_by: eff.group_by } : {}),
    ...(eff.filter ? { filter: eff.filter } : {}),
    order: "group",
    limit: MAX_GROUPS,
    compare: null,
    target: null,
  };
  const tables: MetricTable[] = [];
  const joins: JoinDiagnosis[] = [];
  let ms = 0;
  let range: Built["range"] = null;
  for (const name of parsed.names) {
    if (stack.some((s) => normRef(s) === normRef(name))) bad("formula_cycle", `Chỉ số phái sinh tham chiếu vòng tròn: ${[...stack, name].join(" -> ")}.`, { stack: [...stack, name] });
    const ref = await savedMetricByName(ctx, opts.datahubId, name);
    const a = await runDefinition(ctx, ref.def, refOv, { now: opts.now, datahubId: opts.datahubId, depth: opts.depth + 1, stack, ...(opts.shift ? { shift: opts.shift } : {}) });
    tables.push(a);
    joins.push(...a.diagnostics.joins);
    ms += a.ms;
    range = range ?? a.diagnostics.range;
  }
  const t = combineDerived(parsed, tables, ov.order ?? "group", ov.limit ?? DEFAULT_GROUPS, opts.now);
  return { ...t, diagnostics: { range, joins }, ms };
}

// ------------------------------------------------------------------------------------------------
// target
// ------------------------------------------------------------------------------------------------

/** The plan that reads the target table: sum of the value column by the period and by the columns that match the metric's groups. */
async function targetPlan(ctx: Ctx, t: Target, eff: Effective, datahubId: string, fiscal: number, today: string): Promise<PlanInput> {
  const ref = t.table!;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let id = ref;
  if (!UUID.test(ref)) {
    const r = await ctx.db.execute(sql`SELECT id FROM dh_tables WHERE /*scope*/ datahub_id = ${datahubId}::uuid AND name_norm = ${normName(ref)} AND deleted_at IS NULL`);
    id = (r.rows[0] as { id: string } | undefined)?.id ?? "";
    if (!id) bad("target_table_not_found", `Không tìm thấy bảng mục tiêu "${ref}" trong datahub này.`, { table: ref });
  }
  let acc;
  try {
    acc = await loadTableAccess(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") throw new AppError("not_found", `Không tìm thấy bảng mục tiêu "${ref}", hoặc bạn không có quyền xem.`, { reason: "target_table_not_found", table: ref });
    throw e;
  }
  if (acc.table.datahubId !== datahubId) bad("cross_datahub", `Bảng mục tiêu "${acc.table.name}" thuộc datahub khác.`, { table: acc.table.name });
  const base = await loadMTable(ctx, acc);
  const by = Object.entries(t.by ?? {});
  const groups: Group[] = [];
  for (const g of eff.group_by ?? []) {
    const hit = by.find(([k]) => normRef(k) === normRef(g.field));
    if (!hit) bad("bad_target", `Chỉ số nhóm theo "${g.field}" nhưng mục tiêu không nói cột nào của bảng mục tiêu ứng với nhóm này (target.by).`, { column: g.field, by: Object.keys(t.by ?? {}) });
    groups.push({ field: hit![1], ...(g.bucket ? { bucket: g.bucket } : {}) });
  }
  if (eff.time?.bucket && !t.period_field) bad("bad_target", "Chỉ số nhóm theo thời gian nên mục tiêu cần cột kỳ của bảng mục tiêu (target.period_field).", { bucket: eff.time.bucket });
  const time: TimeSpec | undefined = t.period_field ? { field: t.period_field, ...(eff.time?.bucket ? { bucket: eff.time.bucket } : {}), ...(eff.time?.range ? { range: eff.time.range } : {}) } : undefined;
  return { base, joins: [], measure: { agg: "sum", field: t.value_field! }, ...(time ? { time } : {}), ...(groups.length ? { group_by: groups } : {}), limit: MAX_GROUPS, fiscalStartMonth: fiscal, today };
}

async function applyTarget(ctx: Ctx, a: MetricAnswer, eff: Effective, datahubId: string, fiscal: number, today: string): Promise<MetricAnswer> {
  const t = eff.target!;
  if (t.value !== undefined) return { ...a, ...attachTarget(a, () => t.value!) };
  const plan = await targetPlan(ctx, t, eff, datahubId, fiscal, today);
  const r = await rowsOf(ctx, buildMetricQuery(plan), [plan.base]);
  // The metric's groups are [time bucket?, ...group_by]; so are the target table's: the keys meet column by column.
  const timeIdx = eff.time?.bucket ? 0 : null;
  const map = new Map<string, number | null>();
  // Target rows whose labels differ only in case or accents ("POD", "Pod") are the same group: their targets add up.
  for (const row of r.table.rows) {
    const k = targetKey(row.groups, timeIdx);
    const v = typeof row.value === "number" ? row.value : null;
    map.set(k, v === null ? (map.get(k) ?? null) : (map.get(k) ?? 0) + v);
  }
  const withTarget = attachTarget(a, (row: MetricRow) => map.get(targetKey(row.groups, timeIdx)) ?? null);
  return { ...a, ...withTarget, ms: a.ms + r.ms };
}

/** Checks a metric definition without running it: formula (names, cycles), source, columns, comparison, target. Returns the ids of the tables it reads. */
export async function validateDefinition(ctx: Ctx, datahubId: string, def: MetricDef, stack: string[] = [], now: Date = new Date()): Promise<string[]> {
  const eff = effective(def, {});
  const fiscal = await readSetting(ctx.db, DH_SETTINGS.fiscalStartMonth);
  const today = businessDate(now);
  if (eff.compare) {
    if (!eff.time?.range) bad("bad_compare", "So sánh với kỳ khác cần khoảng thời gian (time.range).");
    shiftRange(eff.compare, resolveRange(parseJson(RangeSchema, eff.time!.range, "Khoảng thời gian"), today, fiscal));
  }
  let tableIds: string[];
  if (isFormulaMetric(def)) {
    const names = parseDerived(def.formula).names;
    const here = [...stack, def.name];
    if (here.length > MAX_DEPTH) bad("formula_too_deep", `Chỉ số phái sinh lồng quá ${MAX_DEPTH} tầng.`, { stack: here });
    const ids = new Set<string>();
    for (const n of names) {
      if (here.some((s) => normRef(s) === normRef(n))) bad("formula_cycle", `Chỉ số phái sinh tham chiếu vòng tròn: ${[...here, n].join(" -> ")}.`, { stack: [...here, n] });
      const ref = await savedMetricByName(ctx, datahubId, n);
      for (const t of await validateDefinition(ctx, datahubId, ref.def, here, now)) ids.add(t);
    }
    if (eff.time?.field) bad("bad_time", "Chỉ số phái sinh không chọn cột ngày (time.field).");
    tableIds = [...ids];
  } else {
    const rs = await resolveSource(ctx, def.source!, datahubId);
    if (rs.datahubId !== datahubId) bad("cross_datahub", "Nguồn của chỉ số thuộc datahub khác.");
    await validateSpec(ctx, rs, { measure: def.measure!, ...(def.filter ? { filter: def.filter } : {}), ...(def.time ? { time: def.time } : {}), ...(def.group_by ? { group_by: def.group_by } : {}), ...(def.cohort ? { cohort: def.cohort } : {}), ...(def.outliers ? { outliers: def.outliers } : {}) }, now);
    if (def.cumulative && def.measure!.agg !== "count" && def.measure!.agg !== "sum") bad("bad_cumulative", `Cộng dồn chỉ dùng cho đếm (count) và tổng (sum), không dùng cho "${def.measure!.agg}".`);
    if (def.cumulative && !def.time?.bucket) bad("bad_cumulative", "Cộng dồn cần nhóm theo thời gian (time.field và time.bucket).");
    tableIds = rs.tableIds;
  }
  if (eff.target && eff.target.value === undefined) {
    const plan = await targetPlan(ctx, eff.target, eff, datahubId, fiscal, today);
    buildMetricQuery(plan);
    tableIds = [...new Set([...tableIds, plan.base.id])];
  }
  return tableIds;
}
