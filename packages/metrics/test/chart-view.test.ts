import { describe, expect, it } from "vitest";
import { buildCohort, buildFunnel, buildRanking, buildScatter, buildWaterfall, histogramBins, median, overridesFromFilters, periodEnd, periodIdx, type MetricRow, type MetricTable } from "../src";

const table = (rows: [string[], number | null][], cols = 1): MetricTable => ({
  columns: Array.from({ length: cols }, (_, i) => ({ column: `c${i}`, kind: "text" as const })),
  value_type: "number",
  truncated: false,
  rows: rows.map(([g, v]): MetricRow => ({ groups: g.map((x) => ({ value: x, label: x })), value: v, count: 1 })),
});

describe("funnel", () => {
  it("conversion from the first and from the previous step; null when the base is 0 or empty", () => {
    const s = buildFunnel([{ label: "a", value: 200 }, { label: "b", value: 50 }, { label: "c", value: 0 }, { label: "d", value: 5 }]);
    expect(s.map((x) => x.pct_of_first)).toEqual([1, 0.25, 0, 0.025]);
    expect(s.map((x) => x.pct_of_prev)).toEqual([null, 0.25, 0, null]);
    expect(buildFunnel([{ label: "a", value: 0 }, { label: "b", value: 3 }]).map((x) => x.pct_of_first)).toEqual([null, null]);
    expect(buildFunnel([{ label: "a", value: null }, { label: "b", value: 3 }])[1]!.pct_of_prev).toBeNull();
  });
});

describe("waterfall", () => {
  it("running total with negative levels and a missing value as 0", () => {
    const w = buildWaterfall([{ label: "s", value: 10, step: "start" }, { label: "-", value: 25, step: "subtract" }, { label: "?", value: null, step: "add" }, { label: "+", value: 5, step: "add" }], true);
    expect(w.map((x) => [x.kind, x.start, x.end])).toEqual([["start", 0, 10], ["subtract", 10, -15], ["add", -15, -15], ["add", -15, -10], ["total", 0, -10]]);
  });
});

describe("ranking", () => {
  it("shares of the largest value; none when the largest is not above 0", () => {
    const r = buildRanking(table([[["a"], 50], [["b"], 25]].map(([g, v]) => [g as string[], v as number])).rows);
    expect(r.map((x) => [x.rank, x.pct_of_max])).toEqual([[1, 1], [2, 0.5]]);
    expect(buildRanking(table([[["a"], -5], [["b"], 0]]).rows).map((x) => x.pct_of_max)).toEqual([null, null]);
  });
});

describe("histogram bins", () => {
  it("lays out equal bins over [lo, hi], keeps empty ones", () => {
    const h = histogramBins([{ lo: 0, hi: 10, n: 4, b: 1, c: 3 }, { lo: 0, hi: 10, n: 4, b: 5, c: 1 }], 5);
    expect(h.bins.map((b) => [b.from, b.to, b.count])).toEqual([[0, 2, 3], [2, 4, 0], [4, 6, 0], [6, 8, 0], [8, 10, 1]]);
    expect(h.total).toBe(4);
  });
});

describe("scatter and matrix", () => {
  it("pairs by group, drops points with a missing number, finds quadrants from medians", () => {
    const x = table([[["1"], 1], [["2"], 2], [["3"], 3], [["4"], 4], [["5"], null]]);
    const y = table([[["1"], 40], [["2"], 30], [["3"], 20], [["4"], 10], [["5"], 9]]);
    const s = buildScatter(x, y, { matrix: true });
    expect(s.dropped).toBe(1);
    expect(s.split).toMatchObject({ x: 2.5, y: 25 });
    expect(s.points.map((p) => p.quadrant)).toEqual(["lh", "lh", "hl", "hl"]);
    expect(s.quadrants).toEqual({ hh: 0, hl: 2, lh: 2, ll: 0 });
    expect(buildScatter(x, y, { matrix: true, xSplit: 0, ySplit: 100 }).quadrants).toEqual({ hh: 0, hl: 4, lh: 0, ll: 0 });
  });
  it("median of an even and an odd list", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("cohort triangle", () => {
  const a = table([[["2026-01-01", "0"], 2], [["2026-01-01", "1"], 1], [["2026-02-01", "0"], 3], [["2026-03-01", "0"], 1]], 2);
  for (const r of a.rows) r.groups[1]!.value = Number(r.groups[1]!.value);
  const sizes = table([[["2026-01-01"], 4], [["2026-02-01"], 5], [["2026-03-01"], 2]]);
  it("future periods are pending, others without events are 0, rates are shares of the cohort", () => {
    const c = buildCohort(a, sizes, { bucket: "month", today: "2026-03-15", fiscalStartMonth: 1, maxOffset: 2, rates: true });
    expect(c.offsets).toEqual([0, 1, 2]);
    const cells = (i: number) => c.rows[i]!.cells.map((x) => [x.value, x.pending]);
    expect(cells(0)).toEqual([[2, false], [1, false], [0, false]]); // January: two months have passed
    expect(cells(1)).toEqual([[3, false], [0, false], [null, true]]);
    expect(cells(2)).toEqual([[1, false], [null, true], [null, true]]);
    expect(c.rows[0]!.cells[0]!.rate).toBe(0.5);
    expect(c.rows[2]!.cells[1]!.rate).toBeNull();
  });
  it("no rates when the measure does not count rows", () => {
    expect(buildCohort(a, sizes, { bucket: "month", today: "2026-12-01", fiscalStartMonth: 1, rates: false }).rows[0]!.cells[0]!.rate).toBeNull();
  });
  it("period numbers: consecutive periods differ by 1, weeks start on Monday, fiscal quarters follow the start month", () => {
    expect(periodIdx("2026-12-31", "month", 1) - periodIdx("2026-11-01", "month", 1)).toBe(1);
    expect(periodIdx("2026-11-23", "week", 1) - periodIdx("2026-11-16", "week", 1)).toBe(1);
    expect(periodIdx("2026-11-22", "week", 1)).toBe(periodIdx("2026-11-16", "week", 1));
    expect(periodIdx("2026-04-01", "quarter", 4) - periodIdx("2026-03-31", "quarter", 4)).toBe(1);
    expect(periodIdx("2026-03-31", "year", 4)).toBe(2025);
  });
});

describe("dashboard filters", () => {
  const f = { range: { kind: "preset" as const, preset: "this_month" as const }, conditions: [{ field: "Loại", op: "eq" as const, value: "POD" }], cross: [{ chart_id: "11111111-1111-4111-8111-111111111111", field: "Trạng thái", kind: "enum" as const, value: "Won" }, { field: "Ngày", kind: "date" as const, bucket: "quarter" as const, value: "2026-10-01" }] };
  it("ANDs conditions and crosses, skips the clicked chart's own cross, honours the opt-outs", () => {
    const all = overridesFromFilters(f, "22222222-2222-4222-8222-222222222222");
    expect(all.soft_filter).toEqual({ and: [{ field: "Loại", op: "eq", value: "POD" }, { field: "Trạng thái", op: "eq", value: "Won" }, { field: "Ngày", op: "between", value: ["2026-10-01", "2026-12-31"] }] });
    expect(all.soft_range).toEqual(f.range);
    expect(overridesFromFilters(f, "11111111-1111-4111-8111-111111111111").soft_filter).toEqual({ and: [{ field: "Loại", op: "eq", value: "POD" }, { field: "Ngày", op: "between", value: ["2026-10-01", "2026-12-31"] }] });
    expect(overridesFromFilters(f, undefined, { ignore_filters: true }).soft_filter).toEqual({ and: [{ field: "Trạng thái", op: "eq", value: "Won" }, { field: "Ngày", op: "between", value: ["2026-10-01", "2026-12-31"] }] });
    expect(overridesFromFilters(f, undefined, { ignore_filters: true }).soft_range).toBeUndefined();
    expect(overridesFromFilters(f, undefined, { ignore_cross: true }).soft_filter).toEqual({ field: "Loại", op: "eq", value: "POD" });
    expect(overridesFromFilters(undefined, undefined)).toEqual({});
  });
  it("a click on an empty group filters for empty; a many-valued column cannot be matched", () => {
    expect(overridesFromFilters({ cross: [{ field: "Loại", kind: "enum", value: null }] }, undefined).soft_filter).toEqual({ field: "Loại", op: "is_empty" });
    expect(overridesFromFilters({ cross: [{ field: "Tag", kind: "set", value: "x" }] }, undefined).soft_filter).toBeUndefined();
  });
  it("the last day of a period", () => {
    expect([periodEnd("2026-02-01", "month"), periodEnd("2026-11-16", "week"), periodEnd("2026-10-01", "quarter"), periodEnd("2026-01-01", "year"), periodEnd("2026-05-05", "day")]).toEqual(["2026-02-28", "2026-11-22", "2026-12-31", "2026-12-31", "2026-05-05"]);
  });
});
