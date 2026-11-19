/** Shapes of the dashboard API (see docs/api/openapi.json). The chart JSON is the same the server stores; numbers come only from `metrics.query`. */

export const CHART_TYPES = [
  "kpi", "column", "bar", "line", "area", "combo", "pie", "donut", "table", "pivot", "note",
  "bullet", "gauge", "funnel", "boxplot", "histogram", "scatter", "matrix", "heatmap", "waterfall", "ranking", "cohort",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const GRID_COLUMNS = 12;

export interface Layout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Bucket = "day" | "week" | "month" | "quarter" | "year";
export type Agg = "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "median" | "percentile" | "trimmed_mean" | "stddev" | "stddev_pop";
export type FormatName = "number" | "money" | "percent" | "days" | "compact";

export interface MetricJson {
  name: string;
  source?: string | { table: string; joins?: unknown[]; name?: string };
  measure?: { agg: Agg; field?: string; p?: number; trim?: number };
  formula?: string;
  filter?: unknown;
  time?: { field?: string; bucket?: Bucket; range?: unknown };
  group_by?: ({ field: string; bucket?: Bucket } | string)[];
  format?: "number" | "money" | "percent" | "days";
  [k: string]: unknown;
}

export interface SeriesDef {
  metric_id?: string;
  metric?: MetricJson;
  label?: string;
  axis?: "left" | "right";
  kind?: "bar" | "line";
  step?: "start" | "add" | "subtract";
  time?: { field?: string; bucket?: Bucket; range?: unknown };
  group_by?: { field: string; bucket?: Bucket }[];
  filter?: unknown;
  order?: "group" | "value_desc" | "value_asc";
  limit?: number;
  compare?: "previous_period" | "year_ago";
  cumulative?: boolean;
  target?: { value?: number; [k: string]: unknown };
}

export interface ChartOptions {
  stack?: "none" | "stack" | "percent";
  labels?: boolean;
  legend?: boolean;
  log?: boolean;
  format?: FormatName;
  smooth?: boolean;
  sparkline?: Bucket;
  heat?: boolean;
  totals?: boolean;
  max_slices?: number;
  bins?: number;
  bands?: { label: string; value: number }[];
  gauge_min?: number;
  gauge_max?: number;
  x_split?: number;
  y_split?: number;
  top_n?: number;
  total?: boolean;
  ignore_filters?: boolean;
  ignore_cross?: boolean;
}

export interface ChartDef {
  type: ChartType;
  title?: string;
  series: SeriesDef[];
  text?: string;
  options?: ChartOptions;
  layout?: Layout;
}

export interface DashboardBrief {
  id: string;
  datahub_id: string;
  name: string;
  position: number;
  chart_count?: number;
  version: number;
  deleted_at?: string | null;
  updated_at: string;
}

export interface ChartRecord {
  id: string;
  dashboard_id: string;
  position: number;
  version: number;
  chart: ChartDef;
  updated_at: string;
}

export interface FilterField {
  name: string;
  kind: "enum" | "text" | "boolean";
  options?: string[];
}

/** The common filters of a dashboard (Module 3 section 8): a date range and conditions on columns. */
export interface DashCondition {
  field: string;
  op: "eq" | "neq" | "contains" | "in";
  value: string | number | boolean | (string | number)[];
}
export interface DashFilters {
  range?: unknown;
  conditions?: DashCondition[];
}
/** A click on a chart element: "this group of this column" (a period when the chart groups by time). */
export interface CrossFilter {
  chart_id?: string;
  field: string;
  kind: "number" | "date" | "datetime" | "text" | "enum" | "boolean" | "uuid" | "set";
  bucket?: Bucket;
  value: string | number | boolean | null;
}
export interface ViewFilters extends DashFilters {
  cross?: CrossFilter[];
}

export type DashRole = "owner" | "shared" | "guest";

export interface DashboardFull extends DashboardBrief {
  charts: ChartRecord[];
  role: DashRole;
  guest_visible: boolean;
  default_filters: DashFilters;
  my_filters: DashFilters | null;
  fields: FilterField[];
  owner_name: string | null;
  datahub_name: string;
}

export interface SharedDashboard {
  id: string;
  name: string;
  datahub_id: string;
  datahub_name: string;
  owner_name: string | null;
  role: "shared" | "guest";
  updated_at: string;
}

export interface DashShare {
  id: string;
  grantee_id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
}

/** Where a click landed: the group columns and values of the row (for cross filtering and for "xem các dòng"). */
export interface PickInfo {
  /** Index of the series of the chart the row belongs to. */
  series: number;
  columns: { column: string; kind: string; bucket?: Bucket }[];
  groups: { value: string | number | boolean | null; label: string }[];
}

export interface MetricRow {
  groups: { value: string | number | boolean | null; label: string }[];
  value: number | string | null;
  count: number;
  previous?: number | string | null;
  change?: number | null;
  change_pct?: number | null;
  target?: number | null;
  achieved?: number | null;
  gap?: number | null;
  /** The "Khác" row of `top`, computed by the server over the rows outside the top. */
  other?: boolean;
  error?: string;
}

/** `metrics.query` answer (the part the charts read). */
export interface QueryResult {
  metric: { id: string | null; name: string | null; agg: Agg | null; field: string | null; formula: string | null; format: "number" | "money" | "percent" | "days" | null };
  columns: { column: string; kind: string; bucket?: Bucket }[];
  value_type: "number" | "text";
  rows: MetricRow[];
  truncated: boolean;
  /** `totals=true`: the measure over each wider group, from the server. */
  totals?: { by_first: MetricRow[] | null; by_rest: MetricRow[] | null; grand: MetricRow | null };
  other_groups?: number;
  diagnostics?: { joins: { alias: string; matched: number; base_total: number; unmatched: number }[] };
  ms?: number;
}

// ---- what `metrics.chart.data` computes for the types that need more than the rows of a series (3C-2) ----
export interface FunnelView { kind: "funnel"; steps: { label: string; value: number | null; pct_of_first: number | null; pct_of_prev: number | null }[]; truncated?: boolean }
export interface WaterfallView { kind: "waterfall"; steps: { label: string; kind: "start" | "add" | "subtract" | "total"; delta: number; start: number; end: number }[]; truncated?: boolean }
export interface HistogramView { kind: "histogram"; column: string; bins: { from: number; to: number; count: number }[]; total: number; min: number | null; max: number | null }
export interface BoxGroupView { label: string; n: number; min: number; q1: number; median: number; q3: number; max: number; lower_whisker: number; upper_whisker: number; outliers: number[]; outlier_count: number }
export interface BoxplotView { kind: "boxplot"; column: string; groups: BoxGroupView[]; truncated: boolean }
export interface ScatterPointView { label: string; x: number; y: number; color: string | null; quadrant?: "hh" | "hl" | "lh" | "ll" }
export interface ScatterView {
  kind: "scatter" | "matrix";
  x_label: string;
  y_label: string;
  points: ScatterPointView[];
  dropped: number;
  truncated: boolean;
  split?: { x: number | null; y: number | null; x_median: boolean; y_median: boolean };
  quadrants?: Record<"hh" | "hl" | "lh" | "ll", number>;
}
export interface RankingView { kind: "ranking"; items: { rank: number; label: string; value: number | null; pct_of_max: number | null; change_pct: number | null; groups: { value: string | number | boolean | null; label: string }[] }[]; truncated: boolean }
export interface CohortView {
  kind: "cohort";
  bucket: Bucket;
  offsets: number[];
  rows: { start: string; label: string; size: number; cells: { offset: number; value: number | null; rate: number | null; pending: boolean }[] }[];
  rates: boolean;
  truncated: boolean;
}
export type ChartView = FunnelView | WaterfallView | HistogramView | BoxplotView | ScatterView | RankingView | CohortView;

export interface ChartDataResult {
  type: ChartType;
  can_view_rows: boolean;
  series: QueryResult[];
  spark: QueryResult | null;
  view: ChartView | null;
  notes: string[];
  rows_series: number | null;
  ms: number;
}

export interface RowsResult {
  columns: { key: string; name: string; type: string }[];
  items: { id: string; row_no: number; data: Record<string, unknown> }[];
  total_visible: number;
  total_owner: number;
  note: string;
}

export interface SavedMetric {
  id: string;
  datahub_id: string;
  name: string;
  definition: MetricJson;
  table_ids: string[];
  version: number;
}

export interface SavedSource {
  id: string;
  datahub_id: string;
  name: string;
  definition: { name?: string; table: string; joins?: unknown[] };
  table_ids: string[];
  version: number;
}
