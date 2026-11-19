import type { CrossFilter, MetricRow, PickInfo, QueryResult } from "./types";

/**
 * Turns the answers of `metrics.query` into what a chart draws. Only arranging: rows become categories, series, slices or a matrix.
 * Every number is the server's, including the "Khác" slice (`top`) and the totals of a pivot (`totals`): nothing is added up here.
 */

export const EMPTY_LABEL = "(Trống)";
const SEP = " · ";

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
  /** The server's "Khác" row. */
  other: boolean;
}
export interface Slices {
  slices: Slice[];
  /** Groups with zero or negative values cannot be drawn as a share. */
  skipped: number;
  /** Groups the server folded into "Khác". */
  folded: number;
}

/** Slices in the server's order (largest first, "Khác" last). Only positive values are drawn. */
export function toSlices(result: QueryResult): Slices {
  const all = result.rows.map((r) => ({ name: r.other ? "Khác" : r.groups.map((g) => g.label).join(SEP) || "Tổng", value: num(r.value), other: !!r.other }));
  const slices = all.filter((s): s is Slice => s.value !== null && s.value > 0);
  return { slices, skipped: all.filter((s) => s.value !== null).length - slices.length, folded: result.other_groups ?? 0 };
}

export interface PivotData {
  rowLabels: string[];
  colLabels: string[];
  cells: (MetricRow | null)[][];
  /** Totals from the server (null when it was not asked for). */
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
  const t = result.totals;
  if (!t || !t.by_first || !t.by_rest) return { rowLabels, colLabels, cells, rowTotals: null, colTotals: null, grand: null };
  const byRow = new Map(t.by_first.map((r) => [r.groups[0]?.label ?? "Tổng", num(r.value)]));
  const byCol = new Map(t.by_rest.map((r) => [r.groups.map((g) => g.label).join(SEP) || "Giá trị", num(r.value)]));
  return { rowLabels, colLabels, cells, rowTotals: rowLabels.map((l) => byRow.get(l) ?? null), colTotals: colLabels.map((l) => byCol.get(l) ?? null), grand: num(t.grand?.value ?? null) };
}

/** Position of `v` between the smallest and largest of the matrix, 0 to 1 (for the colour scale). */
export function heatLevel(v: number | null, values: number[]): number {
  if (v === null || !values.length) return 0;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return hi === lo ? 1 : (v - lo) / (hi - lo);
}

/** Where a click on a row of series `series` lands: its group columns and values. Rows with no group, and the "Khác" row, cannot filter anything. */
export function pickOf(series: number, columns: PickInfo["columns"], row: MetricRow | null | undefined): PickInfo | undefined {
  if (!row || row.other || !row.groups.length) return undefined;
  return { series, columns, groups: row.groups };
}

/** Per series and category of a cartesian chart: the pick of its row. */
export function cartesianPicks(inputs: SeriesInput[], c: Cartesian): (PickInfo | undefined)[][] {
  const deep = inputs.length === 1 && inputs[0]!.result.columns.length >= 2;
  return c.series.map((s, i) => s.rows.map((r) => pickOf(deep ? 0 : i, inputs[deep ? 0 : i]?.result.columns ?? [], r)));
}

/** Cross filters a pick makes: one per group column of the row (a period when the column is a date grouped by a bucket). */
export function crossFiltersOf(pick: PickInfo, chartId: string | undefined): CrossFilter[] {
  return pick.groups.flatMap((g, i) => {
    const col = pick.columns[i];
    if (!col) return [];
    const kind = (["number", "date", "datetime", "text", "enum", "boolean", "uuid", "set"].includes(col.kind) ? col.kind : "text") as CrossFilter["kind"];
    return [{ ...(chartId ? { chart_id: chartId } : {}), field: col.column, kind, ...(col.bucket ? { bucket: col.bucket } : {}), value: g.value }];
  });
}
