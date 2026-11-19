import type { MetricRow, QueryResult } from "./types";

/**
 * Turns the answers of `metrics.query` into what a chart draws. Only arranging: rows become categories, series, slices or a matrix.
 * The numbers are the server's. Two small sums are made here and only where the arithmetic is exact: the "Khác" slice and the
 * totals of a pivot, both only for `count` and `sum` (a sum of averages or medians would be wrong, so those are never added).
 */

export const EMPTY_LABEL = "(Trống)";
const SEP = " · ";

export const isAdditive = (r: Pick<QueryResult, "metric">): boolean => r.metric.formula === null && (r.metric.agg === "sum" || r.metric.agg === "count");

const num = (v: number | string | null): number | null => (v === null ? null : typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : null);

export interface CartesianSeries {
  name: string;
  data: (number | null)[];
  kind: "bar" | "line";
  axis: "left" | "right";
  /** Where the number came from: lets a tooltip show the exact value and the comparison. */
  rows: (MetricRow | null)[];
}
export interface Cartesian {
  categories: string[];
  series: CartesianSeries[];
}

export interface SeriesInput {
  label: string;
  kind: "bar" | "line";
  axis: "left" | "right";
  result: QueryResult;
}

/**
 * One group column: its labels are the categories, each series is a line of numbers.
 * Two or more group columns (one series only): the first is the category, the others make the series (`Quý 1 · POD`).
 * No group column: one category "Tổng" with one number per series.
 */
export function toCartesian(inputs: SeriesInput[]): Cartesian {
  const categories: string[] = [];
  const seen = new Set<string>();
  const addCat = (c: string) => {
    if (!seen.has(c)) {
      seen.add(c);
      categories.push(c);
    }
  };
  const first = inputs[0];
  if (!first) return { categories, series: [] };
  const depth = first.result.columns.length;

  if (depth >= 2 && inputs.length === 1) {
    const names: string[] = [];
    const cells = new Map<string, MetricRow>();
    for (const r of first.result.rows) {
      const cat = r.groups[0]!.label;
      const ser = r.groups.slice(1).map((g) => g.label).join(SEP);
      addCat(cat);
      if (!names.includes(ser)) names.push(ser);
      cells.set(`${cat}\u0000${ser}`, r);
    }
    return {
      categories,
      series: names.map((name) => ({
        name,
        kind: first.kind,
        axis: first.axis,
        data: categories.map((c) => num(cells.get(`${c}\u0000${name}`)?.value ?? null)),
        rows: categories.map((c) => cells.get(`${c}\u0000${name}`) ?? null),
      })),
    };
  }

  if (depth === 0) {
    return {
      categories: ["Tổng"],
      series: inputs.map((s) => ({ name: s.label, kind: s.kind, axis: s.axis, data: [num(s.result.rows[0]?.value ?? null)], rows: [s.result.rows[0] ?? null] })),
    };
  }

  for (const s of inputs) for (const r of s.result.rows) addCat(r.groups.map((g) => g.label).join(SEP));
  return {
    categories,
    series: inputs.map((s) => {
      const by = new Map(s.result.rows.map((r) => [r.groups.map((g) => g.label).join(SEP), r]));
      return { name: s.label, kind: s.kind, axis: s.axis, data: categories.map((c) => num(by.get(c)?.value ?? null)), rows: categories.map((c) => by.get(c) ?? null) };
    }),
  };
}

/**
 * Stacked to 100%: each category's numbers as a share of that category's total (display only; the tooltip still shows the real number).
 * A category whose total is 0 or has negative parts has no meaningful share and stays empty.
 */
export function toShares(c: Cartesian): (number | null)[][] {
  return c.series.map((s) =>
    s.data.map((v, i) => {
      if (v === null) return null;
      const parts = c.series.map((x) => x.data[i]).filter((x): x is number => x !== null);
      const total = parts.reduce((a, b) => a + b, 0);
      if (total <= 0 || parts.some((p) => p < 0)) return null;
      return (v / total) * 100;
    }),
  );
}

export interface Slice {
  name: string;
  value: number;
  /** Real rows behind the slice (none for the folded "Khác"). */
  row: MetricRow | null;
}
export interface Slices {
  slices: Slice[];
  /** Groups with zero or negative values cannot be drawn as a share. */
  skipped: number;
  /** Groups left out because the numbers cannot be added up into one "Khác" slice. */
  hidden: number;
  total: number;
}

export function toSlices(result: QueryResult, max = 8): Slices {
  const all = result.rows
    .map((r) => ({ name: r.groups.map((g) => g.label).join(SEP) || "Tổng", value: num(r.value), row: r }))
    .filter((s): s is { name: string; value: number; row: MetricRow } => s.value !== null);
  const pos = all.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const skipped = all.length - pos.length;
  const total = pos.reduce((a, b) => a + b.value, 0);
  if (pos.length <= max) return { slices: pos, skipped, hidden: 0, total };
  if (isAdditive(result)) {
    const keep = pos.slice(0, max - 1);
    const rest = pos.slice(max - 1);
    return { slices: [...keep, { name: "Khác", value: rest.reduce((a, b) => a + b.value, 0), row: null }], skipped, hidden: 0, total };
  }
  return { slices: pos.slice(0, max), skipped, hidden: pos.length - max, total };
}

export interface PivotData {
  rowLabels: string[];
  colLabels: string[];
  cells: (MetricRow | null)[][];
  /** Totals only when the numbers can be added up. */
  rowTotals: (number | null)[] | null;
  colTotals: (number | null)[] | null;
  grand: number | null;
}

/** First group column = rows, second = columns (a third and later are joined into the column label). */
export function toPivot(result: QueryResult): PivotData {
  const rowLabels: string[] = [];
  const colLabels: string[] = [];
  const cell = new Map<string, MetricRow>();
  for (const r of result.rows) {
    const rl = r.groups[0]?.label ?? "Tổng";
    const cl = r.groups.slice(1).map((g) => g.label).join(SEP) || "Giá trị";
    if (!rowLabels.includes(rl)) rowLabels.push(rl);
    if (!colLabels.includes(cl)) colLabels.push(cl);
    cell.set(`${rl}\u0000${cl}`, r);
  }
  const cells = rowLabels.map((rl) => colLabels.map((cl) => cell.get(`${rl}\u0000${cl}`) ?? null));
  if (!isAdditive(result)) return { rowLabels, colLabels, cells, rowTotals: null, colTotals: null, grand: null };
  const sum = (xs: (MetricRow | null)[]) => xs.reduce<number>((a, r) => a + (num(r?.value ?? null) ?? 0), 0);
  const rowTotals = cells.map(sum);
  const colTotals = colLabels.map((_, j) => sum(cells.map((row) => row[j]!)));
  return { rowLabels, colLabels, cells, rowTotals, colTotals, grand: rowTotals.reduce((a, b) => a + b, 0) };
}

/** Position of `v` between the smallest and largest of the matrix, 0 to 1 (for the colour scale). */
export function heatLevel(v: number | null, values: number[]): number {
  if (v === null || !values.length) return 0;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return hi === lo ? 1 : (v - lo) / (hi - lo);
}
