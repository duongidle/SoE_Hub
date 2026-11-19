import { describe, expect, it } from "vitest";
import { compact, place, clampRect, type Item } from "../src/lib/dashboard/layout";
import { cartesianPicks, crossFiltersOf, heatLevel, pickOf, toCartesian, toPivot, toShares, toSlices } from "../src/lib/dashboard/chart-data";
import { formatCompact, formatValue } from "../src/lib/dashboard/format";
import type { MetricRow, QueryResult } from "../src/lib/dashboard/types";

const it1 = (id: string, x: number, y: number, w = 3, h = 3): Item => ({ id, x, y, w, h });

describe("grid layout", () => {
  it("pushes the items under a moved one down and keeps the grid free of overlaps and gaps", () => {
    const items = [it1("a", 0, 0), it1("b", 3, 0), it1("c", 0, 3)];
    const out = place(items, "b", { x: 0, y: 0 });
    const b = out.find((i) => i.id === "b")!;
    expect([b.x, b.y]).toEqual([0, 0]);
    expect(out.find((i) => i.id === "a")!.y).toBe(3);
    expect(out.find((i) => i.id === "c")!.y).toBe(6);
    for (const x of out) for (const y of out) if (x.id !== y.id) expect(x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h).toBe(false);
  });
  it("lets items rise to fill a gap", () => {
    expect(compact([it1("a", 0, 10), it1("b", 6, 12)]).map((i) => i.y)).toEqual([0, 0]);
  });
  it("clamps to the grid", () => {
    expect(clampRect({ x: 10, y: -2, w: 6, h: 0 })).toEqual({ x: 6, y: 0, w: 6, h: 1 });
    expect(clampRect({ x: 0, y: 0, w: 99, h: 99 }).w).toBe(12);
    expect(place([it1("a", 0, 0)], "a", { w: 1 }, { w: 3, h: 3 })[0]!.w).toBe(3);
  });
});

const mk = (rows: [string[], number | null][], over: Partial<QueryResult> = {}): QueryResult => ({
  metric: { id: null, name: "m", agg: "sum", field: "x", formula: null, format: null },
  columns: rows[0]?.[0].map((_, i) => ({ column: `g${i}`, kind: "text" })) ?? [],
  value_type: "number",
  rows: rows.map(([g, v]): MetricRow => ({ groups: g.map((l) => ({ value: l, label: l })), value: v, count: 1 })),
  truncated: false,
  ...over,
});
const inp = (result: QueryResult, label = "S") => ({ label, kind: "bar" as const, axis: "left" as const, result });

describe("chart data", () => {
  it("one group column: labels are categories, empty cells stay null (never 0)", () => {
    const c = toCartesian([inp(mk([[["A"], 1], [["B"], 2]]), "x"), inp(mk([[["B"], 5]]), "y")]);
    expect(c.categories).toEqual(["A", "B"]);
    expect(c.series.map((s) => s.data)).toEqual([[1, 2], [null, 5]]);
  });
  it("two group columns make one series per value of the second", () => {
    const c = toCartesian([inp(mk([[["T1", "POD"], 1], [["T1", "DCC"], 2], [["T2", "POD"], 3]]))]);
    expect(c.categories).toEqual(["T1", "T2"]);
    expect(c.series.map((s) => [s.name, s.data])).toEqual([["POD", [1, 3]], ["DCC", [2, null]]]);
  });
  it("no group column gives one category", () => {
    const c = toCartesian([inp(mk([[[], 7]]), "Tổng")]);
    expect(c.categories).toEqual(["Tổng"]);
    expect(c.series[0]!.data).toEqual([7]);
  });
  it("100% shares per category; none for a zero or negative total", () => {
    const c = toCartesian([inp(mk([[["A"], 1], [["B"], 0], [["C"], -1]]), "x"), inp(mk([[["A"], 3], [["B"], 0], [["C"], 4]]), "y")]);
    expect(toShares(c)).toEqual([[25, null, null], [75, null, null]]);
  });
  it("slices come in the server's order with its Khác row; non-positive are skipped, nothing is added here", () => {
    const r = mk([[["a"], 10], [["b"], 9], [["z"], 0], [["n"], -3], [["Khác"], 15]]);
    r.rows[4]!.other = true;
    r.other_groups = 4;
    const s = toSlices(r);
    expect(s.slices.map((x) => [x.name, x.value, x.other])).toEqual([["a", 10, false], ["b", 9, false], ["Khác", 15, true]]);
    expect(s.skipped).toBe(2);
    expect(s.folded).toBe(4);
  });
  it("pivot totals are the server's; none when not asked", () => {
    const rows: [string[], number][] = [[["A", "x"], 1], [["A", "y"], 2], [["B", "x"], 3]];
    expect(toPivot(mk(rows)).rowTotals).toBeNull();
    const t = (g: string[], v: number): MetricRow => ({ groups: g.map((l) => ({ value: l, label: l })), value: v, count: 1 });
    const p = toPivot(mk(rows, { totals: { by_first: [t(["A"], 1.5), t(["B"], 3)], by_rest: [t(["x"], 2), t(["y"], 2)], grand: t([], 2) } }));
    expect(p.rowTotals).toEqual([1.5, 3]);
    expect(p.colTotals).toEqual([2, 2]);
    expect(p.grand).toBe(2);
  });
  it("heat level", () => {
    expect(heatLevel(5, [0, 10])).toBe(0.5);
    expect(heatLevel(null, [0, 10])).toBe(0);
  });
});

describe("number formats", () => {
  it("compact, money, percent, empty", () => {
    expect(formatCompact(1_200_000_000)).toBe("1,2 tỷ");
    expect(formatCompact(350_000_000)).toBe("350 tr");
    expect(formatCompact(-2_500_000)).toBe("-2,5 tr");
    expect(formatCompact(12_345)).toBe("12.345");
    expect(formatValue(null, "money")).toBe("—");
    expect(formatValue(0.125, "percent")).toBe("12,5%");
    expect(formatValue(12_345_678_901_234, "number")).toBe("12.345.678.901.234");
  });
});

describe("picks and cross filters", () => {
  const cols = [{ column: "Loại", kind: "enum" }, { column: "Ngày", kind: "date", bucket: "month" as const }];
  const row = (g: [string | null, string][], extra: Partial<MetricRow> = {}): MetricRow => ({ groups: g.map(([v, l]) => ({ value: v, label: l })), value: 1, count: 1, ...extra });
  it("a row with no group and the Khác row cannot be picked", () => {
    expect(pickOf(0, cols, row([]))).toBeUndefined();
    expect(pickOf(0, cols, row([[null, "Khác"]], { other: true }))).toBeUndefined();
    expect(pickOf(0, cols, null)).toBeUndefined();
  });
  it("one cross filter per group column, a period keeps its bucket, an empty group stays null", () => {
    const pick = pickOf(1, cols, row([["opt1", "POD"], ["2026-02-01", "2026-02"]]))!;
    expect(crossFiltersOf(pick, "c1")).toEqual([
      { chart_id: "c1", field: "Loại", kind: "enum", value: "opt1" },
      { chart_id: "c1", field: "Ngày", kind: "date", bucket: "month", value: "2026-02-01" },
    ]);
    expect(crossFiltersOf(pickOf(0, [{ column: "Loại", kind: "enum" }], row([[null, "(Trống)"]]))!, undefined)).toEqual([{ field: "Loại", kind: "enum", value: null }]);
  });
  it("cartesian picks follow the categories and the series of two group columns", () => {
    const r = mk([[["T1", "POD"], 1], [["T1", "DCC"], 2], [["T2", "POD"], 3]]);
    const inputs = [inp(r)];
    const c = toCartesian(inputs);
    const picks = cartesianPicks(inputs, c);
    expect(picks.map((s) => s.map((p) => p?.groups.map((g) => g.label)))).toEqual([[["T1", "POD"], ["T2", "POD"]], [["T1", "DCC"], undefined]]);
    expect(picks[0]![0]!.series).toBe(0);
  });
});
