/** Shapes of the dashboard API (see docs/api/openapi.json). The chart JSON is the same the server stores; numbers come only from `metrics.query`. */

export const CHART_TYPES = ["kpi", "column", "bar", "line", "area", "combo", "pie", "donut", "table", "pivot", "note"] as const;
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

export interface DashboardFull extends DashboardBrief {
  charts: ChartRecord[];
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
  error?: string;
}

/** `metrics.query` answer (the part the charts read). */
export interface QueryResult {
  metric: { id: string | null; name: string | null; agg: Agg | null; field: string | null; formula: string | null; format: "number" | "money" | "percent" | "days" | null };
  columns: { column: string; kind: string; bucket?: Bucket }[];
  value_type: "number" | "text";
  rows: MetricRow[];
  truncated: boolean;
  diagnostics?: { joins: { alias: string; matched: number; base_total: number; unmatched: number }[] };
  ms?: number;
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
