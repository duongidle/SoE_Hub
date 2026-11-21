import { z } from "zod";
import { CompareSchema, GroupSchema, MAX_GROUPS, MAX_GROUP_FIELDS, MetricDefSchema, OutliersSchema, TargetSchema, TimeSpecSchema } from "./schema";
import { FilterSchema } from "@soe/shared";
import { DashFiltersSchema } from "./dash-filter";

/**
 * JSON of a chart on a dashboard (design module3 sections 2, 7, 8). The server keeps it as written (after checking the shape and
 * that every metric exists); it never computes anything from it: the screens ask `metrics.query` once per series.
 * Stage 3C-1 has the basic types; 3C-2 adds the rest (bullet, gauge, funnel...) by extending `CHART_TYPES`.
 */
export const CHART_TYPES = [
  "kpi", "column", "bar", "line", "area", "combo", "pie", "donut", "table", "pivot", "note",
  // 3C-2
  "bullet", "gauge", "funnel", "boxplot", "histogram", "scatter", "matrix", "heatmap", "waterfall", "ranking", "cohort",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** Chart types that read exactly one series (the others take several, or exactly two for scatter and matrix). */
export const SINGLE_SERIES: readonly string[] = ["kpi", "pie", "donut", "table", "pivot", "bullet", "gauge", "boxplot", "histogram", "heatmap", "ranking", "cohort"];

export const MAX_SERIES = 6;
export const GRID_COLUMNS = 12;
export const MAX_GRID_ROWS = 40;

/** What one series asks of `metrics.query`: a saved metric (`metric_id`) or one written in place (`metric`), plus the overrides. */
export const SeriesSchema = z
  .strictObject({
    metric_id: z.uuid().optional(),
    metric: MetricDefSchema.optional(),
    /** Name in the legend; default is the metric name. */
    label: z.string().max(100).optional(),
    /** Combo chart: which axis and which drawing. */
    axis: z.enum(["left", "right"]).optional(),
    kind: z.enum(["bar", "line"]).optional(),
    /** Waterfall: what this series does to the running total (default: the first series starts it, the others add). */
    step: z.enum(["start", "add", "subtract"]).optional(),
    time: TimeSpecSchema.optional(),
    group_by: z.array(GroupSchema).max(MAX_GROUP_FIELDS).optional(),
    filter: FilterSchema.optional(),
    order: z.enum(["group", "value_desc", "value_asc"]).optional(),
    limit: z.number().int().min(1).max(MAX_GROUPS).optional(),
    compare: CompareSchema.optional(),
    cumulative: z.boolean().optional(),
    target: TargetSchema.optional(),
    outliers: OutliersSchema.optional(),
  })
  .superRefine((s, ctx) => {
    if ((s.metric_id ? 1 : 0) + (s.metric ? 1 : 0) !== 1) ctx.addIssue({ code: "custom", message: 'Mỗi chuỗi số liệu cần đúng một trong "metric_id" (chỉ số đã lưu) hoặc "metric" (chỉ số viết tại chỗ).' });
  });
export type Series = z.output<typeof SeriesSchema>;

export const ChartOptionsSchema = z.strictObject({
  /** Bar and area: stacked, or stacked to 100%. */
  stack: z.enum(["none", "stack", "percent"]).optional(),
  /** Numbers drawn on the marks. */
  labels: z.boolean().optional(),
  legend: z.boolean().optional(),
  /** Logarithmic value axis, for numbers that differ a lot. */
  log: z.boolean().optional(),
  /** `compact` = 1,2 tỷ / 350 tr. Default: the metric's own format. */
  format: z.enum(["number", "money", "percent", "days", "compact"]).optional(),
  smooth: z.boolean().optional(),
  /** KPI card: small trend line under the number, by this bucket. */
  sparkline: z.enum(["day", "week", "month", "quarter", "year"]).optional(),
  /** Pivot: colour scale and totals. */
  heat: z.boolean().optional(),
  totals: z.boolean().optional(),
  /** Pie: slices kept before the rest is folded into "Khác" (when the number can be added up). */
  max_slices: z.number().int().min(2).max(8).optional(),
  /** Histogram: number of bins. */
  bins: z.number().int().min(2).max(50).optional(),
  /** Bullet: reference bands (for example KPI / Goal / Out performance), drawn behind the bar up to each value. */
  bands: z.array(z.strictObject({ label: z.string().max(40), value: z.number().finite() })).max(4).optional(),
  /** Gauge without a target: the ends of the scale (percent metrics default to 0..1). */
  gauge_min: z.number().finite().optional(),
  gauge_max: z.number().finite().optional(),
  /** 2x2 matrix: where the quadrants split (default: the median of each axis, computed by the engine). */
  x_split: z.number().finite().optional(),
  y_split: z.number().finite().optional(),
  /** Ranking: how many places are listed. */
  top_n: z.number().int().min(1).max(50).optional(),
  /** Waterfall: close with a bar of the running total (default true). */
  total: z.boolean().optional(),
  /** Dashboard filters (3C-2): this chart ignores the common filter bar, or the filters made by clicking other charts. */
  ignore_filters: z.boolean().optional(),
  ignore_cross: z.boolean().optional(),
});
export type ChartOptions = z.output<typeof ChartOptionsSchema>;

export const LayoutSchema = z.strictObject({
  x: z.number().int().min(0).max(GRID_COLUMNS - 1),
  y: z.number().int().min(0).max(10_000),
  w: z.number().int().min(1).max(GRID_COLUMNS),
  h: z.number().int().min(1).max(MAX_GRID_ROWS),
});
export type Layout = z.output<typeof LayoutSchema>;

export const ChartDefSchema = z
  .strictObject({
    type: z.enum(CHART_TYPES),
    title: z.string().max(100).optional(),
    series: z.array(SeriesSchema).max(MAX_SERIES).default([]),
    /** Text of a note box (shown as plain text). */
    text: z.string().max(5000).optional(),
    options: ChartOptionsSchema.optional(),
    layout: LayoutSchema.optional(),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (c.type === "note") {
      if (c.series.length) issue("series", "Ô ghi chú không có số liệu.");
    } else if (c.series.length === 0) issue("series", "Biểu đồ cần ít nhất một chuỗi số liệu.");
    if (c.type !== "combo" && c.type !== "note" && c.series.length > 1 && SINGLE_SERIES.includes(c.type)) issue("series", `Loại "${c.type}" chỉ có một chuỗi số liệu.`);
    if ((c.type === "scatter" || c.type === "matrix") && c.series.length !== 2) issue("series", `Loại "${c.type}" cần đúng hai chuỗi số liệu: trục ngang rồi trục dọc.`);
  });
export type ChartDef = z.output<typeof ChartDefSchema>;

/** What a dashboard keeps in its `config` (3C-2): the default common filters, and whether Guests with a dashboard grant may open it. */
export const DashboardConfigSchema = z.strictObject({
  filters: z.lazy(() => DashFiltersSchema).optional(),
  guest_visible: z.boolean().optional(),
  /** Numbers are computed with the VIEWER's own rights (their rows, their own values of "của tôi" columns), and everyone who reads the datahub may open it (default Deals dashboard, module4 13). */
  as_viewer: z.boolean().optional(),
});
export type DashboardConfig = z.output<typeof DashboardConfigSchema>;
