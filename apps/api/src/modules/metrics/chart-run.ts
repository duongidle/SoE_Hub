import { sql } from "drizzle-orm";
import { AppError, businessDate } from "@soe/shared";
import {
  MAX_GROUPS,
  MetricDefSchema,
  buildCohort,
  buildFunnel,
  buildRanking,
  buildScatter,
  buildWaterfall,
  overridesFromFilters,
  parseJson,
  type ChartDef,
  type MetricDef,
  type QueryOverrides,
  type Series,
  type ViewFilters,
} from "@soe/metrics";
import { readSetting } from "../system/settings-catalog";
import { DH_SETTINGS } from "../datahub/limits";
import { resolveSource, type Ctx } from "./context";
import { runBoxplot, runDefinition, runHistogram, type MetricAnswer, type MetricSpec } from "./engine";

type Raw = Record<string, unknown>;

/** A series with its metric loaded: the definition to run and the name to show. */
export interface ResolvedSeries {
  index: number;
  series: Series;
  def: MetricDef;
  metricId: string | null;
  name: string;
}

const bad = (reason: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new AppError("validation_error", message, { reason, ...details });
};

export async function resolveSeries(cctx: Ctx, datahubId: string, chart: ChartDef): Promise<ResolvedSeries[]> {
  const ids = [...new Set(chart.series.map((s) => s.metric_id).filter((x): x is string => !!x))];
  const saved = new Map<string, { name: string; config: unknown }>();
  if (ids.length) {
    const r = await cctx.db.execute(sql`SELECT id, name, config FROM mt_metrics WHERE /*scope*/ datahub_id = ${datahubId}::uuid AND id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND deleted_at IS NULL`);
    for (const x of r.rows as Raw[]) saved.set(x.id as string, { name: x.name as string, config: x.config });
  }
  return chart.series.map((s, index) => {
    if (s.metric_id) {
      const m = saved.get(s.metric_id);
      if (!m) throw new AppError("not_found", `Chuỗi số liệu thứ ${index + 1}: không tìm thấy chỉ số.`, { series: index });
      return { index, series: s, def: parseJson(MetricDefSchema, m.config, `Chỉ số "${m.name}"`), metricId: s.metric_id, name: m.name };
    }
    return { index, series: s, def: s.metric!, metricId: null, name: s.metric!.name };
  });
}

/** The overrides a series puts on its metric, with the dashboard's filters on top. `extra` carries what the chart type asks (top, totals, order, limit). */
export function seriesOverrides(s: Series, filters: ViewFilters | undefined, chartId: string | undefined, flags: ChartDef["options"], extra: QueryOverrides = {}): QueryOverrides {
  const soft = overridesFromFilters(filters, chartId, { ignore_filters: flags?.ignore_filters, ignore_cross: flags?.ignore_cross });
  const ov: QueryOverrides = {
    ...(s.time ? { time: s.time } : {}),
    ...(s.group_by?.length ? { group_by: s.group_by } : {}),
    ...(s.filter ? { filter: s.filter } : {}),
    ...(s.order ? { order: s.order } : {}),
    ...(s.limit ? { limit: s.limit } : {}),
    ...(s.compare ? { compare: s.compare } : {}),
    ...(s.cumulative !== undefined ? { cumulative: s.cumulative } : {}),
    ...(s.target ? { target: s.target } : {}),
    ...(s.outliers ? { outliers: s.outliers } : {}),
    ...soft,
    ...extra,
  };
  return ov;
}

export const specOf = (def: MetricDef): MetricSpec => ({
  measure: def.measure!,
  ...(def.filter ? { filter: def.filter } : {}),
  ...(def.time ? { time: def.time } : {}),
  ...(def.group_by ? { group_by: def.group_by } : {}),
  ...(def.cohort ? { cohort: def.cohort } : {}),
  ...(def.outliers ? { outliers: def.outliers } : {}),
});

const queryOut = (r: ResolvedSeries, a: MetricAnswer) => ({
  metric: { id: r.metricId, name: r.name, agg: r.def.measure?.agg ?? null, field: r.def.measure?.field ?? null, formula: r.def.formula ?? null, format: r.def.format ?? null },
  ...a,
});

/** Chart types whose series can show the rows behind a number. */
const NO_ROWS = new Set(["note", "histogram", "boxplot", "cohort"]);

const valueOf = (a: MetricAnswer): number | null => {
  const v = a.rows[0]?.value;
  return typeof v === "number" ? v : v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null;
};

export interface ChartData {
  type: string;
  /** The reader may see the rows behind the numbers of series `rows_series` (they can read its tables). */
  can_view_rows: boolean;
  series: ReturnType<typeof queryOut>[];
  spark: ReturnType<typeof queryOut> | null;
  view: Record<string, unknown> | null;
  notes: string[];
  rows_series: number | null;
  ms: number;
}

export interface RunChartInput {
  chart: ChartDef;
  chartId?: string;
  datahubId: string;
  filters?: ViewFilters;
  now?: Date;
  /** The reader, when numbers are computed with someone else's rights: decides `can_view_rows`. */
  reader?: Ctx;
}

/**
 * The numbers of one chart, with everything the chart type needs computed here (conversion of a funnel, running total of a waterfall,
 * bins, quartiles, quadrants, ranking, cohort triangle): the screens only draw. `cctx` is the context the numbers are computed in
 * (the owner's rights). Each series is one metric query; the types that need raw values (histogram, box plot) run their own statement.
 */
export async function runChart(cctx: Ctx, inp: RunChartInput): Promise<ChartData> {
  const { chart, datahubId } = inp;
  const now = inp.now ?? new Date();
  const o = chart.options ?? {};
  const out: ChartData = { type: chart.type, can_view_rows: false, series: [], spark: null, view: null, notes: [], rows_series: null, ms: 0 };
  if (chart.type === "note") return out;
  const rs = await resolveSeries(cctx, datahubId, chart);
  const ovOf = (r: ResolvedSeries, extra: QueryOverrides = {}) => seriesOverrides(r.series, inp.filters, inp.chartId, o, extra);
  const run = async (r: ResolvedSeries, extra: QueryOverrides = {}): Promise<MetricAnswer> => {
    try {
      return await runDefinition(cctx, r.def, ovOf(r, extra), { datahubId, now });
    } catch (e) {
      if (e instanceof AppError && chart.series.length > 1) throw new AppError(e.code, `Chuỗi số liệu thứ ${r.index + 1}: ${e.message}`, { ...(e.details ?? {}), series: r.index });
      throw e;
    }
  };
  const track = (a: { ms: number; diagnostics: MetricAnswer["diagnostics"] }) => {
    out.ms += a.ms;
    for (const f of a.diagnostics.skipped_filters ?? []) {
      const note = `Bộ lọc chung "${f}" không áp dụng cho biểu đồ này (bảng của nó không có cột đó).`;
      if (!out.notes.includes(note)) out.notes.push(note);
    }
  };
  const baseOnly = (r: ResolvedSeries) => {
    if (r.def.formula !== undefined) bad("unsupported_for_derived", `Loại "${chart.type}" đọc thẳng các giá trị của một cột, không dùng được với chỉ số phái sinh (formula). Dùng chỉ số gốc có phép đo trên cột số.`, { series: r.index });
    if (!r.def.measure?.field) bad("bad_measure", `Loại "${chart.type}" cần phép đo trên một cột số (measure.field).`, { series: r.index });
  };
  const sourceOf = async (r: ResolvedSeries) => resolveSource(cctx, r.def.source!, datahubId);

  if (!NO_ROWS.has(chart.type) && rs[0] && rs[0].def.formula === undefined) {
    out.rows_series = 0;
    out.can_view_rows = inp.reader ? await canReadSource(inp.reader, datahubId, rs[0].def) : true;
  }

  switch (chart.type) {
    case "histogram": {
      const r = rs[0]!;
      baseOnly(r);
      const h = await runHistogram(cctx, await sourceOf(r), specOf(r.def), ovOf(r), o.bins ?? 10, now);
      track(h);
      out.view = { kind: "histogram", column: r.def.measure!.field, bins: h.bins, total: h.total, min: h.min, max: h.max, diagnostics: h.diagnostics };
      return out;
    }
    case "boxplot": {
      const r = rs[0]!;
      baseOnly(r);
      const b = await runBoxplot(cctx, await sourceOf(r), specOf(r.def), ovOf(r), now);
      track(b);
      out.view = { kind: "boxplot", column: r.def.measure!.field, groups: b.groups, truncated: b.truncated, diagnostics: b.diagnostics };
      return out;
    }
    case "scatter":
    case "matrix": {
      const [rx, ry] = rs as [ResolvedSeries, ResolvedSeries];
      const extra: QueryOverrides = { order: "group", limit: MAX_GROUPS };
      const [ax, ay] = await Promise.all([run(rx, extra), run(ry, extra)]);
      track(ax);
      track(ay);
      out.series = [queryOut(rx, ax), queryOut(ry, ay)];
      const sc = buildScatter(ax, ay, { matrix: chart.type === "matrix", ...(o.x_split !== undefined ? { xSplit: o.x_split } : {}), ...(o.y_split !== undefined ? { ySplit: o.y_split } : {}) });
      out.view = { kind: chart.type, x_label: rx.series.label?.trim() || rx.name, y_label: ry.series.label?.trim() || ry.name, truncated: ax.truncated || ay.truncated, ...sc };
      return out;
    }
    case "funnel": {
      if (rs.length > 1) {
        const answers = await Promise.all(rs.map((r) => run(r)));
        answers.forEach(track);
        out.series = rs.map((r, i) => queryOut(r, answers[i]!));
        out.view = { kind: "funnel", steps: buildFunnel(rs.map((r, i) => ({ label: r.series.label?.trim() || r.name, value: valueOf(answers[i]!) }))) };
      } else {
        const a = await run(rs[0]!, { order: "value_desc" });
        track(a);
        out.series = [queryOut(rs[0]!, a)];
        out.view = { kind: "funnel", steps: buildFunnel(a.rows.map((x) => ({ label: x.groups.map((g) => g.label).join(" · ") || "Tổng", value: typeof x.value === "number" ? x.value : null }))), truncated: a.truncated };
      }
      return out;
    }
    case "waterfall": {
      const total = o.total !== false;
      if (rs.length > 1) {
        const answers = await Promise.all(rs.map((r) => run(r)));
        answers.forEach(track);
        out.series = rs.map((r, i) => queryOut(r, answers[i]!));
        out.view = { kind: "waterfall", steps: buildWaterfall(rs.map((r, i) => ({ label: r.series.label?.trim() || r.name, value: valueOf(answers[i]!), step: r.series.step ?? (i === 0 ? "start" : "add") })), total) };
      } else {
        const a = await run(rs[0]!, { order: "group" });
        track(a);
        out.series = [queryOut(rs[0]!, a)];
        out.view = { kind: "waterfall", steps: buildWaterfall(a.rows.map((x) => ({ label: x.groups.map((g) => g.label).join(" · ") || "Tổng", value: typeof x.value === "number" ? x.value : null, step: "add" as const })), total), truncated: a.truncated };
      }
      return out;
    }
    case "ranking": {
      const a = await run(rs[0]!, { order: "value_desc", limit: o.top_n ?? 10 });
      track(a);
      out.series = [queryOut(rs[0]!, a)];
      out.view = { kind: "ranking", items: buildRanking(a.rows), truncated: a.truncated };
      return out;
    }
    case "cohort": {
      const r = rs[0]!;
      if (!r.def.cohort) bad("bad_cohort", 'Bảng cohort cần chỉ số có "cohort" (cột ngày bắt đầu và cột ngày sự kiện).', { series: 0 });
      const a = await run(r, { order: "group", limit: MAX_GROUPS });
      track(a);
      out.series = [queryOut(r, a)];
      const bucket = r.def.cohort!.bucket ?? "month";
      const agg = r.def.measure?.agg;
      out.view = { kind: "cohort", bucket, ...buildCohort(a, a.cohort_sizes, { bucket, today: businessDate(now), fiscalStartMonth: await readSetting(cctx.db, DH_SETTINGS.fiscalStartMonth), ...(r.def.cohort!.max_offset !== undefined ? { maxOffset: r.def.cohort!.max_offset } : {}), rates: agg === "count" || agg === "count_distinct" }), truncated: a.truncated };
      return out;
    }
    default: {
      // kpi, column, bar, line, area, combo, pie, donut, table, pivot, bullet, gauge, heatmap: the answers of the series.
      const extra = (r: ResolvedSeries): QueryOverrides => {
        void r;
        if (chart.type === "pie" || chart.type === "donut") return { top: o.max_slices ?? 8, order: "value_desc" };
        if (chart.type === "pivot" && o.totals !== false) return { totals: true };
        return {};
      };
      const answers = await Promise.all(rs.map((r) => run(r, extra(r))));
      answers.forEach(track);
      out.series = rs.map((r, i) => queryOut(r, answers[i]!));
      if (chart.type === "kpi" && o.sparkline) {
        const r = rs[0]!;
        const field = r.series.time?.field ?? r.def.time?.field;
        if (field && r.def.formula === undefined) {
          const range = r.series.time?.range ?? r.def.time?.range;
          const sp = await runDefinition(cctx, r.def, { ...ovOf(r), compare: null, target: null, time: { field, bucket: o.sparkline, ...(range ? { range } : {}) }, group_by: [] }, { datahubId, now });
          track(sp);
          out.spark = queryOut(r, sp);
        }
      }
      return out;
    }
  }
}

/** True when the reader can resolve every table the series reads (so the rows behind its numbers are theirs to see). */
export async function canReadSource(vctx: Ctx, datahubId: string, def: MetricDef): Promise<boolean> {
  if (def.formula !== undefined || def.source === undefined) return false;
  try {
    await resolveSource(vctx, def.source, datahubId);
    return true;
  } catch (e) {
    if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden")) return false;
    throw e;
  }
}
