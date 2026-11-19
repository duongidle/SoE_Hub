import type { MetricRow, MetricTable } from "./build";
import { groupKey } from "./post";
import type { Bucket } from "./schema";

/**
 * What the charts of Stage 3C-2 draw, computed here and nowhere else (design module3 sections 7 and 8; CLAUDE.md "Phân vai" point 6):
 * conversion rates of a funnel, the running total of a waterfall, the bins of a histogram, the quartiles of a box plot, the quadrant of
 * a point, the ranking, the triangle of a cohort. Pure functions on the small tables the engine returned; the screens only draw them.
 */

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : null);
const label = (r: MetricRow): string => r.groups.map((g) => g.label).join(" · ") || "Tổng";

// ------------------------------------------------------------------------------------------------
// funnel
// ------------------------------------------------------------------------------------------------

export interface FunnelStep {
  label: string;
  value: number | null;
  /** Ratios: 0.25 = 25%. Null when the first (or previous) step is 0 or empty. */
  pct_of_first: number | null;
  pct_of_prev: number | null;
}

/** Conversion of each step from the first step and from the step before it. */
export function buildFunnel(steps: { label: string; value: number | null }[]): FunnelStep[] {
  const first = steps[0]?.value ?? null;
  return steps.map((s, i) => {
    const prev = i > 0 ? steps[i - 1]!.value : null;
    return {
      label: s.label,
      value: s.value,
      pct_of_first: s.value !== null && first !== null && first !== 0 ? s.value / first : null,
      pct_of_prev: i > 0 && s.value !== null && prev !== null && prev !== 0 ? s.value / prev : null,
    };
  });
}

// ------------------------------------------------------------------------------------------------
// waterfall
// ------------------------------------------------------------------------------------------------

export type WaterfallKind = "start" | "add" | "subtract" | "total";
export interface WaterfallStep {
  label: string;
  kind: WaterfallKind;
  /** What the step does to the running total (negative for a subtraction; for `start`/`total` the level itself). */
  delta: number;
  /** The running total before and after the step; the bar is drawn between them. */
  start: number;
  end: number;
}

/**
 * Running total over the steps: `start` sets the level, `add` adds the value, `subtract` takes it away; a missing value counts as 0.
 * With `total` a last bar shows where the running total ended.
 */
export function buildWaterfall(items: { label: string; value: number | null; step: "start" | "add" | "subtract" }[], total: boolean, totalLabel = "Tổng"): WaterfallStep[] {
  const out: WaterfallStep[] = [];
  let run = 0;
  for (const it of items) {
    const v = it.value ?? 0;
    if (it.step === "start") out.push({ label: it.label, kind: "start", delta: v, start: 0, end: v });
    else out.push({ label: it.label, kind: it.step, delta: it.step === "subtract" ? -v : v, start: run, end: it.step === "subtract" ? run - v : run + v });
    run = out[out.length - 1]!.end;
  }
  if (total) out.push({ label: totalLabel, kind: "total", delta: run, start: 0, end: run });
  return out;
}

// ------------------------------------------------------------------------------------------------
// ranking
// ------------------------------------------------------------------------------------------------

export interface RankItem {
  rank: number;
  label: string;
  value: number | null;
  /** Share of the largest value, 0 to 1 (null when the largest is not above 0). Only for drawing the bar. */
  pct_of_max: number | null;
  change_pct: number | null;
  /** Group values of the row, so a click can filter other charts. */
  groups: MetricRow["groups"];
}

/** Places by value, largest first (the engine already sorted the rows and applied the limit). */
export function buildRanking(rows: MetricRow[]): RankItem[] {
  const max = rows.reduce((m, r) => Math.max(m, num(r.value) ?? -Infinity), -Infinity);
  return rows.map((r, i) => {
    const v = num(r.value);
    return { rank: i + 1, label: label(r), value: v, pct_of_max: v !== null && max > 0 ? Math.max(0, v) / max : null, change_pct: r.change_pct ?? null, groups: r.groups };
  });
}

// ------------------------------------------------------------------------------------------------
// histogram
// ------------------------------------------------------------------------------------------------

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}
export interface Histogram {
  bins: HistogramBin[];
  /** Number of values read, and their range. */
  total: number;
  min: number | null;
  max: number | null;
}

/** Equal-width bins from the engine's counts (`b` = bin number from 1, `c` = values in it). Empty bins are kept with 0 so the axis is continuous. */
export function histogramBins(raw: { lo: number | string; hi: number | string; n: number | string; b: number | string; c: number | string }[], bins: number): Histogram {
  if (!raw.length) return { bins: [], total: 0, min: null, max: null };
  const lo = Number(raw[0]!.lo);
  const hi = Number(raw[0]!.hi);
  const total = Number(raw[0]!.n);
  if (hi === lo) return { bins: [{ from: lo, to: hi, count: total }], total, min: lo, max: hi };
  const width = (hi - lo) / bins;
  const counts = new Map(raw.map((r) => [Number(r.b), Number(r.c)]));
  return {
    bins: Array.from({ length: bins }, (_, i) => ({ from: lo + i * width, to: i === bins - 1 ? hi : lo + (i + 1) * width, count: counts.get(i + 1) ?? 0 })),
    total,
    min: lo,
    max: hi,
  };
}

// ------------------------------------------------------------------------------------------------
// box plot
// ------------------------------------------------------------------------------------------------

export interface BoxGroup {
  label: string;
  groups: MetricRow["groups"];
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** The smallest and largest value still inside [Q1 - k*IQR, Q3 + k*IQR]. */
  lower_whisker: number;
  upper_whisker: number;
  outliers: number[];
  /** All values outside the whiskers (`outliers` lists at most 60). */
  outlier_count: number;
}

export function shapeBox(groups: MetricRow["groups"], r: Record<string, unknown>): BoxGroup {
  const nn = (k: string) => Number(r[k]);
  return {
    label: groups.map((g) => g.label).join(" · ") || "Tất cả",
    groups,
    n: nn("n"),
    min: nn("mn"),
    q1: nn("q1"),
    median: nn("med"),
    q3: nn("q3"),
    max: nn("mx"),
    lower_whisker: r.lw === null || r.lw === undefined ? nn("q1") : nn("lw"),
    upper_whisker: r.uw === null || r.uw === undefined ? nn("q3") : nn("uw"),
    outliers: ((r.outs as (number | string)[] | null) ?? []).map(Number),
    outlier_count: nn("n_out"),
  };
}

// ------------------------------------------------------------------------------------------------
// scatter and 2x2 matrix
// ------------------------------------------------------------------------------------------------

export type Quadrant = "hh" | "hl" | "lh" | "ll";
export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  /** Colour category: the group columns after the first (null when there is only one). */
  color: string | null;
  /** Matrix only: `h` = at or above the split, `l` = below; first letter is the x axis. */
  quadrant?: Quadrant;
  /** The first group value, for filtering other charts. */
  groups: MetricRow["groups"];
}
export interface Scatter {
  points: ScatterPoint[];
  /** Points left out because one of the two numbers is missing. */
  dropped: number;
  split?: { x: number | null; y: number | null; /** True when the engine took the median of the points. */ x_median: boolean; y_median: boolean };
  quadrants?: Record<Quadrant, number>;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Pairs the groups of two series (same group columns): the first is the x axis, the second the y axis. */
export function buildScatter(x: MetricTable, y: MetricTable, opts: { matrix?: boolean; xSplit?: number; ySplit?: number } = {}): Scatter {
  const ys = new Map(y.rows.map((r) => [groupKey(r), r]));
  const seen = new Set<string>();
  const points: ScatterPoint[] = [];
  let dropped = 0;
  for (const r of x.rows) {
    const k = groupKey(r);
    seen.add(k);
    const yr = ys.get(k);
    const xv = num(r.value);
    const yv = num(yr?.value);
    if (xv === null || yv === null) {
      dropped++;
      continue;
    }
    const first = r.groups[0];
    const lab = first ? (x.columns[0]?.column === "_row_no" ? `#${first.label}` : first.label) : "Tổng";
    points.push({ label: lab, x: xv, y: yv, color: r.groups.length > 1 ? r.groups.slice(1).map((g) => g.label).join(" · ") : null, groups: r.groups });
  }
  for (const k of ys.keys()) if (!seen.has(k)) dropped++;
  if (!opts.matrix) return { points, dropped };
  const xSplit = opts.xSplit ?? median(points.map((p) => p.x));
  const ySplit = opts.ySplit ?? median(points.map((p) => p.y));
  const quadrants: Record<Quadrant, number> = { hh: 0, hl: 0, lh: 0, ll: 0 };
  for (const p of points) {
    const q = `${xSplit !== null && p.x >= xSplit ? "h" : "l"}${ySplit !== null && p.y >= ySplit ? "h" : "l"}` as Quadrant;
    p.quadrant = q;
    quadrants[q]++;
  }
  return { points, dropped, split: { x: xSplit, y: ySplit, x_median: opts.xSplit === undefined, y_median: opts.ySplit === undefined }, quadrants };
}

// ------------------------------------------------------------------------------------------------
// cohort triangle
// ------------------------------------------------------------------------------------------------

export interface CohortCell {
  offset: number;
  value: number | null;
  /** value / cohort size, 0 to 1 (only when the measure counts rows, null otherwise). */
  rate: number | null;
  /** The period has not happened yet for this cohort: nothing to show (the empty corner of the triangle). */
  pending: boolean;
}
export interface CohortRow {
  /** Start of the cohort period (as the engine grouped it) and its readable label. */
  start: string;
  label: string;
  size: number;
  cells: CohortCell[];
}
export interface CohortTable {
  offsets: number[];
  rows: CohortRow[];
  /** True when a cell is shown as a share of the cohort. */
  rates: boolean;
}

const dayNumber = (d: string) => Math.round(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000);

/** Index of the period a date falls in (the same numbering as `periodIndex` in SQL: consecutive periods differ by 1). */
export function periodIdx(day: string, bucket: Bucket, startMonth: number): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  switch (bucket) {
    case "day": return dayNumber(day);
    case "week": return Math.floor((dayNumber(day) - 4) / 7);
    case "month": return y * 12 + m - 1;
    case "quarter": return Math.floor((y * 12 + m - 1 - (startMonth - 1)) / 3);
    case "year": return y - (m < startMonth ? 1 : 0);
  }
}

/**
 * Rows = cohorts (the period rows started in), columns = how many periods later. A cell for a period that has not happened yet is `pending`
 * (the empty corner), any other period without events is 0. `sizes` are the rows of each cohort; `rates` says the measure counts rows,
 * so a cell can be shown as a share of the cohort.
 */
export function buildCohort(a: MetricTable, sizes: MetricTable | undefined, o: { bucket: Bucket; today: string; fiscalStartMonth: number; maxOffset?: number; rates: boolean }): CohortTable {
  const sizeOf = new Map((sizes?.rows ?? []).map((r) => [String(r.groups[0]?.value ?? ""), num(r.value) ?? 0]));
  const starts = new Map<string, { label: string; cells: Map<number, number | null> }>();
  let maxSeen = 0;
  for (const r of a.rows) {
    const s = String(r.groups[0]?.value ?? "");
    const off = Number(r.groups[1]?.value ?? 0);
    if (!starts.has(s)) starts.set(s, { label: r.groups[0]?.label ?? s, cells: new Map() });
    starts.get(s)!.cells.set(off, num(r.value));
    maxSeen = Math.max(maxSeen, off);
  }
  for (const [s] of sizeOf) if (!starts.has(s)) starts.set(s, { label: s, cells: new Map() });
  const todayIdx = periodIdx(o.today, o.bucket, o.fiscalStartMonth);
  // Cohorts that exist only in `sizes` carry no label of their own; the label is the start day written as the bucket reads it.
  const top = Math.max(maxSeen, o.maxOffset ?? 0);
  const offsets = Array.from({ length: top + 1 }, (_, i) => i);
  const rows: CohortRow[] = [...starts.entries()]
    .sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0))
    .map(([start, v]) => {
      const size = sizeOf.get(start) ?? 0;
      const age = start && /^\d{4}-\d{2}-\d{2}/.test(start) ? todayIdx - periodIdx(start.slice(0, 10), o.bucket, o.fiscalStartMonth) : Infinity;
      return {
        start,
        label: v.label,
        size,
        cells: offsets.map((off): CohortCell => {
          const pending = off > age;
          const value = pending ? null : (v.cells.get(off) ?? 0);
          return { offset: off, value, rate: !pending && o.rates && size > 0 && value !== null ? value / size : null, pending };
        }),
      };
    });
  return { offsets, rows, rates: o.rates };
}
