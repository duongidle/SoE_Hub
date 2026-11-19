import type { Column } from "@/lib/datahub/types";
import { isGroupable, kindOf } from "@/lib/datahub/view-config";
import type { Agg, Bucket, ChartDef, ChartOptions, ChartType, SeriesDef } from "./types";

/** Choices of the chart configuration panel and the small rules around them (what a chart type needs, what makes it ready to save). */

export const TYPE_LABELS: Record<ChartType, string> = {
  kpi: "Thẻ KPI",
  column: "Cột đứng",
  bar: "Thanh ngang",
  line: "Đường",
  area: "Vùng",
  combo: "Cột + đường (hai trục)",
  pie: "Tròn",
  donut: "Donut",
  table: "Bảng",
  pivot: "Bảng pivot",
  note: "Ô ghi chú",
  bullet: "Bullet (so với mục tiêu)",
  gauge: "Đồng hồ",
  funnel: "Phễu",
  boxplot: "Box plot",
  histogram: "Histogram",
  scatter: "Scatter",
  matrix: "Ma trận 2×2",
  heatmap: "Heatmap",
  waterfall: "Waterfall",
  ranking: "Bảng xếp hạng",
  cohort: "Cohort",
};

export const TYPE_HINTS: Record<ChartType, string> = {
  kpi: "Một con số lớn, so kỳ trước, mục tiêu, xu hướng nhỏ.",
  column: "So sánh các nhóm hoặc các kỳ; có thể chồng.",
  bar: "So sánh các nhóm có tên dài; có thể chồng.",
  line: "Xu hướng theo thời gian.",
  area: "Xu hướng theo thời gian, nhấn mạnh khối lượng.",
  combo: "Cột và đường trên hai trục, ví dụ doanh thu và winrate.",
  pie: "Tỉ trọng các phần trong tổng (tối đa 8 phần).",
  donut: "Như biểu đồ tròn, có lỗ giữa.",
  table: "Các nhóm và số liệu dạng bảng.",
  pivot: "Dòng theo nhóm thứ nhất, cột theo nhóm thứ hai, có tổng.",
  note: "Chú thích hoặc hướng dẫn đọc dashboard.",
  bullet: "Giá trị thực tế trên các mốc (KPI, Goal, Out performance) và mục tiêu.",
  gauge: "Phần trăm đạt mục tiêu, hoặc giá trị trên thang tự đặt.",
  funnel: "Các bước chuyển đổi, kèm tỉ lệ từ bước đầu và từ bước trước.",
  boxplot: "Phân bố của một cột số: tứ phân vị, râu và ngoại lai, theo nhóm.",
  histogram: "Phân bố của một cột số theo các khoảng đều nhau.",
  scatter: "Hai số liệu của cùng một nhóm: mỗi nhóm một điểm, tô màu theo cột nhóm thứ hai.",
  matrix: "Như scatter, chia bốn góc theo mốc tự đặt hoặc trung vị.",
  heatmap: "Một số liệu theo hai cột nhóm, tô màu theo giá trị (người × tháng).",
  waterfall: "Từ giá trị đầu cộng trừ từng bước đến giá trị cuối.",
  ranking: "Các nhóm xếp theo giá trị, lớn nhất trước.",
  cohort: "Tam giác cohort: nhóm theo kỳ bắt đầu, cột là số kỳ sau đó.",
};

export const AGG_LABELS: Record<Agg, string> = {
  count: "Đếm dòng",
  count_distinct: "Đếm không trùng",
  sum: "Tổng",
  avg: "Trung bình",
  min: "Nhỏ nhất",
  max: "Lớn nhất",
  median: "Trung vị",
  percentile: "Phân vị (P)",
  trimmed_mean: "Trung bình cắt đuôi",
  stddev: "Độ lệch chuẩn",
  stddev_pop: "Độ lệch chuẩn (cả tập)",
};

export const BUCKET_LABELS: Record<Bucket, string> = { day: "Ngày", week: "Tuần", month: "Tháng", quarter: "Quý", year: "Năm" };

export const FORMAT_LABELS = { "": "Theo chỉ số", number: "Số", money: "Tiền (₫)", compact: "Tiền gọn (1,2 tỷ, 350 tr)", percent: "Phần trăm", days: "Số ngày" } as const;

export const RANGES: { token: string; label: string; value: unknown }[] = [
  { token: "", label: "Mọi thời gian", value: undefined },
  { token: "this_month", label: "Tháng này", value: { kind: "preset", preset: "this_month" } },
  { token: "last_month", label: "Tháng trước", value: { kind: "preset", preset: "last_month" } },
  { token: "this_quarter", label: "Quý này", value: { kind: "preset", preset: "this_quarter" } },
  { token: "last_quarter", label: "Quý trước", value: { kind: "preset", preset: "last_quarter" } },
  { token: "this_year", label: "Năm nay", value: { kind: "preset", preset: "this_year" } },
  { token: "last_year", label: "Năm trước", value: { kind: "preset", preset: "last_year" } },
  { token: "d30", label: "30 ngày qua", value: { kind: "preset", preset: "last_n_days", n: 30 } },
  { token: "m6", label: "6 tháng gần nhất", value: { kind: "last_n_months", n: 6 } },
  { token: "m12", label: "12 tháng gần nhất", value: { kind: "last_n_months", n: 12 } },
];

export const rangeToken = (r: unknown): string => {
  if (!r) return "";
  const s = JSON.stringify(r);
  return RANGES.find((x) => x.value && JSON.stringify(x.value) === s)?.token ?? "custom";
};

export const MAX_SERIES_PER_CHART = 4;
const MULTI = new Set<ChartType>(["column", "bar", "line", "area", "combo", "funnel", "waterfall"]);
export const allowsManySeries = (t: ChartType) => MULTI.has(t);
/** Exactly two series: the horizontal axis, then the vertical one. */
export const needsTwoSeries = (t: ChartType) => t === "scatter" || t === "matrix";
/** Types that read the values of one number column (no choice of calculation). */
export const usesRawValues = (t: ChartType) => t === "histogram" || t === "boxplot";
export const usesGroups = (t: ChartType) => t !== "kpi" && t !== "note" && t !== "histogram" && t !== "cohort" && t !== "gauge";
export const usesTime = (t: ChartType) => t !== "note" && t !== "cohort";

export const emptySeries = (): SeriesDef => ({ metric: { name: "Biểu đồ" } });

export function newChart(type: ChartType): ChartDef {
  return { type, title: "", series: type === "note" ? [] : needsTwoSeries(type) ? [emptySeries(), emptySeries()] : [emptySeries()], ...(type === "note" ? { text: "" } : {}), options: {} };
}

/** Typing a type change keeps what still makes sense. */
export function retype(c: ChartDef, type: ChartType): ChartDef {
  const base = c.series.length ? (needsTwoSeries(type) ? c.series.slice(0, 2) : allowsManySeries(type) ? c.series : c.series.slice(0, 1)) : [emptySeries()];
  const series = type === "note" ? [] : needsTwoSeries(type) && base.length < 2 ? [...base, emptySeries()] : base;
  const options: ChartOptions = { ...c.options };
  if (type !== "combo") for (const s of series) {
    delete s.axis;
    delete s.kind;
  }
  if (type !== "waterfall") for (const s of series) delete s.step;
  return { ...c, type, series, options };
}

/** A series is ready when it points at a saved metric, or at a source with a measure (and a column unless it counts rows). */
export function seriesReady(s: SeriesDef): boolean {
  if (s.metric_id) return true;
  const m = s.metric;
  if (!m?.source || !m.measure) return false;
  return m.measure.agg === "count" || !!m.measure.field;
}

export function chartReady(c: ChartDef): boolean {
  if (c.type === "note") return true;
  if (needsTwoSeries(c.type) && c.series.length !== 2) return false;
  if (c.type === "cohort" && !(c.series[0]?.metric?.cohort)) return false;
  if (usesRawValues(c.type)) return c.series.length > 0 && c.series.every((s) => !!s.metric?.source && !!s.metric.measure?.field);
  return c.series.length > 0 && c.series.every(seriesReady);
}

/** Scatter and matrix pair the groups of their two series, so both read the same group columns: copy those of the first onto the second. */
export function mirrorGroups(c: ChartDef): ChartDef {
  if (!needsTwoSeries(c.type) || c.series.length !== 2) return c;
  const [a, b] = c.series as [SeriesDef, SeriesDef];
  const groups = a.metric_id ? a.group_by : a.metric?.group_by;
  const next: SeriesDef = b.metric_id ? { ...b, group_by: groups as SeriesDef["group_by"] } : { ...b, metric: { ...(b.metric ?? { name: "Biểu đồ" }), group_by: groups } };
  return JSON.stringify(next) === JSON.stringify(b) ? c : { ...c, series: [a, next] };
}

export function chartTitle(c: ChartDef, index?: number): string {
  const t = c.title?.trim();
  if (t) return t;
  const s = c.series[0];
  const base = s?.label?.trim() || s?.metric?.name;
  if (c.type === "note") return "Ghi chú";
  return base && base !== "Biểu đồ" ? base : `${TYPE_LABELS[c.type]}${index !== undefined ? ` ${index + 1}` : ""}`;
}

export const isNumberCol = (c: Column) => kindOf(c) === "number";
export const isDateCol = (c: Column) => kindOf(c) === "date" || kindOf(c) === "datetime";
export const isGroupCol = (c: Column) => isGroupable(c) && kindOf(c) !== "date";
