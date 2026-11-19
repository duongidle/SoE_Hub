import { AppError, businessDate, type FilterNode } from "@soe/shared";
import {
  DEFAULT_GROUPS,
  buildMetricQuery,
  checkJoin,
  diagnoseJoinSql,
  joinKind,
  shape,
  shapeDiagnosis,
  unmatchedSql,
  type Built,
  type Group,
  type JoinDiagnosis,
  type MetricDef,
  type MetricTable,
  type QueryOverrides,
  type TimeSpec,
} from "@soe/metrics";
import { readSetting } from "../system/settings-catalog";
import { DH_SETTINGS } from "../datahub/limits";
import type { Ctx, ResolvedSource } from "./context";

/** What a query computes: the metric's own parts, with the call's overrides on top. */
export interface MetricSpec {
  measure: MetricDef["measure"];
  filter?: FilterNode;
  time?: TimeSpec;
  group_by?: Group[];
}

export interface MetricAnswer extends MetricTable {
  diagnostics: {
    /** Time range actually used (the days the relative range resolved to). */
    range: Built["range"];
    joins: JoinDiagnosis[];
  };
  /** Milliseconds the grouped statement took. */
  ms: number;
}

const and = (a: FilterNode | undefined, b: FilterNode | undefined): FilterNode | undefined => (!a ? b : !b ? a : { and: [...("and" in a ? a.and : [a]), ...("and" in b ? b.and : [b])] });

/** Merges the overrides of a call into the metric (`time` key by key, `filter` by AND, `group_by` replaced). */
export function mergeSpec(m: MetricSpec, ov: QueryOverrides = {}): MetricSpec {
  const time = m.time || ov.time ? { ...m.time, ...ov.time } : undefined;
  const filter = and(m.filter, ov.filter);
  const group_by = ov.group_by ?? m.group_by;
  return { measure: m.measure, ...(filter ? { filter } : {}), ...(time ? { time } : {}), ...(group_by ? { group_by } : {}) };
}

export async function diagnoseJoins(ctx: Ctx, rs: ResolvedSource): Promise<JoinDiagnosis[]> {
  const out: JoinDiagnosis[] = [];
  for (const j of rs.joins) {
    checkJoin(rs.base, j);
    const r = await ctx.db.execute(diagnoseJoinSql(rs.base, j));
    out.push(shapeDiagnosis(j, joinKind(j), r.rows[0] as Record<string, unknown>));
  }
  return out;
}

/** Ids and row numbers of the base rows that found no partner in one join (`index` = position in `joins`). */
export async function unmatchedRows(ctx: Ctx, rs: ResolvedSource, index: number, limit: number, offset: number) {
  const j = rs.joins[index];
  if (!j) throw new AppError("validation_error", "Không có phép ghép thứ tự này.", { reason: "bad_join", joins: rs.joins.length });
  const r = await ctx.db.execute(unmatchedSql(rs.base, j, limit, offset));
  const rows = r.rows as { id: string; row_no: number; total: number }[];
  return { join: j.alias, total: rows[0]?.total ?? 0, items: rows.map((x) => ({ id: x.id, row_no: x.row_no })) };
}

/** Plans a metric without running it: every column, option and join is checked. Throws a structured error when something is wrong. */
export async function validateSpec(ctx: Ctx, rs: ResolvedSource, spec: MetricSpec, now: Date = new Date()): Promise<void> {
  const fiscal = await readSetting(ctx.db, DH_SETTINGS.fiscalStartMonth);
  buildMetricQuery({ base: rs.base, joins: rs.joins, ...spec, limit: 1, fiscalStartMonth: fiscal, today: businessDate(now) });
}

/**
 * Runs one metric: diagnoses the joins (a join with no match is an error that says what to fix), then ONE grouped statement.
 * `now` is only for tests; relative ranges resolve against it in Vietnam time.
 */
export async function runMetric(ctx: Ctx, rs: ResolvedSource, spec: MetricSpec, ov: QueryOverrides = {}, now: Date = new Date()): Promise<MetricAnswer> {
  const fiscal = await readSetting(ctx.db, DH_SETTINGS.fiscalStartMonth);
  const merged = mergeSpec(spec, ov);
  const built = buildMetricQuery({ base: rs.base, joins: rs.joins, ...merged, ...(ov.order ? { order: ov.order } : {}), limit: ov.limit ?? DEFAULT_GROUPS, fiscalStartMonth: fiscal, today: businessDate(now) });
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
  const t0 = performance.now();
  const res = await ctx.db.execute(built.sql);
  const ms = Math.round(performance.now() - t0);
  return { ...shape(built, res.rows as Record<string, unknown>[]), diagnostics: { range: built.range, joins }, ms };
}

