import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 3C-2, numbers of the new chart types (`metrics.chart.data`): every figure a chart draws is computed by the server and compared with
 * a hand calculation on the same rows; the dashboard filters and cross filters; the rows behind a number.
 */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let dhId: string;
let tableId: string;
let dashId: string;

// Mã, Loại, Trạng thái, Số tiền, Điểm, Ngày nhận, Ngày chốt
const ROWS: [string, string, string, number, number, string, string | null][] = [
  ["K1", "POD", "Won", 100, 10, "2026-01-10", "2026-01-20"],
  ["K2", "POD", "Won", 200, 20, "2026-01-15", "2026-02-05"],
  ["K3", "POD", "Lost", 50, 30, "2026-01-20", "2026-03-01"],
  ["K4", "DCC", "Won", 300, 40, "2026-02-03", "2026-02-10"],
  ["K5", "DCC", "Open", 400, 50, "2026-02-10", null],
  ["K6", "POD", "Won", 1000, 60, "2026-03-01", "2026-03-15"],
  ["K7", "DCC", "Lost", 25, 70, "2026-03-05", "2026-03-20"],
  ["K8", "POD", "Open", 75, 80, "2026-03-10", null],
];
const SUM_ALL = 2150;

const m = (name: string, agg: string, field?: string, extra: Record<string, unknown> = {}) => ({ name, source: tableId, measure: { agg, ...(field ? { field } : {}) }, ...extra });
const chart = (type: string, series: Record<string, unknown>[], options: Record<string, unknown> = {}) => ({ type, title: type, series, options });
const data = (c: Record<string, unknown>, filters?: unknown) => owner("metrics.chart.data", { chart: c, datahub_id: dhId, ...(filters ? { filters } : {}) });
const sumSeries = (extra: Record<string, unknown> = {}) => ({ metric: m("Tổng tiền", "sum", "Số tiền"), ...extra });

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  owner = as(t, org.userA1.id);
  const x = await makeTable(owner, {
    columns: [
      { name: "Mã", type: "text" },
      { name: "Loại", type: "single_select", config: { options: [{ name: "POD" }, { name: "DCC" }] } },
      { name: "Trạng thái", type: "single_select", config: { options: [{ name: "Won" }, { name: "Lost" }, { name: "Open" }] } },
      { name: "Số tiền", type: "number" },
      { name: "Điểm", type: "number" },
      { name: "Ngày nhận", type: "date" },
      { name: "Ngày chốt", type: "date" },
    ],
  });
  dhId = x.dhId;
  tableId = x.tableId;
  await owner("datahub.row.batch", {
    table_id: tableId,
    ops: ROWS.map(([Mã, Loại, st, tien, diem, nhan, chot]) => ({ op: "create", data: { Mã, Loại, "Trạng thái": st, "Số tiền": tien, Điểm: diem, "Ngày nhận": nhan, ...(chot ? { "Ngày chốt": chot } : {}) } })),
  });
  dashId = (await owner("metrics.dashboard.create", { datahub_id: dhId, name: "Kiểm thử 3C-2" })).id;
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe("distribution charts", () => {
  it("histogram: equal-width bins, counts match a hand count", async () => {
    const r = await data(chart("histogram", [sumSeries()], { bins: 4 }));
    const v = r.view;
    expect(v.kind).toBe("histogram");
    expect(v.total).toBe(8);
    expect([v.min, v.max]).toEqual([25, 1000]);
    expect(v.bins.map((b: { count: number }) => b.count)).toEqual([5, 2, 0, 1]);
    expect(v.bins[0].from).toBe(25);
    expect(v.bins[3].to).toBe(1000);
    expect(v.bins.reduce((a: number, b: { count: number }) => a + b.count, 0)).toBe(8);
  });

  it("histogram of one repeated value is one bin; of no rows is empty", async () => {
    const one = await data(chart("histogram", [{ metric: m("x", "sum", "Số tiền", { filter: { field: "Mã", op: "eq", value: "K1" } }) }], { bins: 5 }));
    expect(one.view.bins).toEqual([{ from: 100, to: 100, count: 1 }]);
    const none = await data(chart("histogram", [{ metric: m("x", "sum", "Số tiền", { filter: { field: "Mã", op: "eq", value: "nope" } }) }]));
    expect(none.view.bins).toEqual([]);
    expect(none.view.total).toBe(0);
  });

  it("histogram and box plot refuse derived metrics and non-numeric columns with a reason", async () => {
    const e = await fails(data(chart("histogram", [{ metric: m("x", "count", "Mã") }])));
    expect(e.code).toBe("validation_error");
    const f = await fails(data(chart("boxplot", [{ metric: { name: "d", formula: "=[a]/[b]" } }])));
    expect(f.details.reason).toBe("unsupported_for_derived");
  });

  it("box plot: quartiles, whiskers and outliers per group", async () => {
    const r = await data(chart("boxplot", [{ metric: m("Tiền", "sum", "Số tiền"), group_by: [{ field: "Loại" }] }]));
    const g = Object.fromEntries(r.view.groups.map((x: { label: string }) => [x.label, x]));
    // POD: 50 75 100 200 1000 -> Q1 75, median 100, Q3 200, upper bound 387.5 -> 1000 is an outlier
    expect(g.POD).toMatchObject({ n: 5, min: 50, q1: 75, median: 100, q3: 200, max: 1000, lower_whisker: 50, upper_whisker: 200, outliers: [1000], outlier_count: 1 });
    // DCC: 25 300 400 -> Q1 162.5, median 300, Q3 350, nothing outside
    expect(g.DCC).toMatchObject({ n: 3, min: 25, q1: 162.5, median: 300, q3: 350, max: 400, lower_whisker: 25, upper_whisker: 400, outliers: [], outlier_count: 0 });
    const all = await data(chart("boxplot", [sumSeries()]));
    expect(all.view.groups).toHaveLength(1);
    expect(all.view.groups[0]).toMatchObject({ n: 8, min: 25, q1: 68.75, median: 150, q3: 325, max: 1000, upper_whisker: 400, outliers: [1000] });
  });
});

describe("funnel, waterfall, ranking", () => {
  it("funnel: conversion from the first step and from the step before", async () => {
    const f = (name: string, filter?: unknown) => ({ metric: m(name, "count", undefined, filter ? { filter } : {}), label: name });
    const r = await data(chart("funnel", [f("Tất cả"), f("Won", { field: "Trạng thái", op: "eq", value: "Won" }), f("Won POD", { and: [{ field: "Trạng thái", op: "eq", value: "Won" }, { field: "Loại", op: "eq", value: "POD" }] })]));
    expect(r.view.steps.map((s: { value: number }) => s.value)).toEqual([8, 4, 3]);
    expect(r.view.steps.map((s: { pct_of_first: number }) => s.pct_of_first)).toEqual([1, 0.5, 0.375]);
    expect(r.view.steps.map((s: { pct_of_prev: number | null }) => s.pct_of_prev)).toEqual([null, 0.5, 0.75]);
  });

  it("funnel of one grouped series lists the groups largest first", async () => {
    const r = await data(chart("funnel", [{ metric: m("c", "count"), group_by: [{ field: "Trạng thái" }] }]));
    expect(r.view.steps.map((s: { value: number }) => s.value)).toEqual([4, 2, 2]);
    expect(r.view.steps[0].label).toBe("Won");
  });

  it("waterfall: running total with start, subtract, add and a closing total", async () => {
    const r = await data(
      chart("waterfall", [
        { metric: m("Đầu kỳ", "sum", "Số tiền"), step: "start" },
        { metric: m("Thua", "sum", "Số tiền", { filter: { field: "Trạng thái", op: "eq", value: "Lost" } }), step: "subtract" },
        { metric: m("Đang mở", "sum", "Số tiền", { filter: { field: "Trạng thái", op: "eq", value: "Open" } }), step: "add" },
      ]),
    );
    expect(r.view.steps.map((s: { label: string; kind: string; delta: number; start: number; end: number }) => [s.kind, s.delta, s.start, s.end])).toEqual([
      ["start", SUM_ALL, 0, SUM_ALL],
      ["subtract", -75, SUM_ALL, SUM_ALL - 75],
      ["add", 475, SUM_ALL - 75, SUM_ALL - 75 + 475],
      ["total", SUM_ALL - 75 + 475, 0, SUM_ALL - 75 + 475],
    ]);
    const noTotal = await data(chart("waterfall", [{ metric: m("a", "sum", "Số tiền") }], { total: false }));
    expect(noTotal.view.steps).toHaveLength(1);
  });

  it("ranking: places by value with the bar share of the largest", async () => {
    const r = await data(chart("ranking", [{ metric: m("Tiền", "sum", "Số tiền"), group_by: [{ field: "Mã" }] }], { top_n: 3 }));
    expect(r.view.items.map((x: { rank: number; label: string; value: number; pct_of_max: number }) => [x.rank, x.label, x.value, x.pct_of_max])).toEqual([
      [1, "K6", 1000, 1],
      [2, "K5", 400, 0.4],
      [3, "K4", 300, 0.3],
    ]);
    expect(r.view.truncated).toBe(true);
  });
});

describe("scatter, 2x2 matrix, heatmap, bullet, gauge", () => {
  const xy = (type: string, options: Record<string, unknown> = {}) => chart(type, [{ metric: m("Tiền", "sum", "Số tiền"), group_by: [{ field: "_row_no" }] }, { metric: m("Điểm", "sum", "Điểm"), group_by: [{ field: "_row_no" }] }], options);

  it("scatter: one point per row, x from the first series, y from the second", async () => {
    const r = await data(xy("scatter"));
    expect(r.view.points).toHaveLength(8);
    expect(r.view.dropped).toBe(0);
    const p = r.view.points.find((x: { label: string }) => x.label === "#6");
    expect([p.x, p.y]).toEqual([1000, 60]);
  });

  it("scatter colours by a second group column", async () => {
    const two = (field: string) => ({ metric: m(field, "sum", field), group_by: [{ field: "_row_no" }, { field: "Loại" }] });
    const r = await data(chart("scatter", [two("Số tiền"), two("Điểm")]));
    expect(new Set(r.view.points.map((p: { color: string }) => p.color))).toEqual(new Set(["POD", "DCC"]));
  });

  it("matrix: splits at the median of each axis unless told, and counts the quadrants", async () => {
    const r = await data(xy("matrix"));
    expect(r.view.split).toEqual({ x: 150, y: 45, x_median: true, y_median: true });
    expect(r.view.quadrants).toEqual({ hh: 2, hl: 2, lh: 2, ll: 2 });
    const fixed = await data(xy("matrix", { x_split: 500, y_split: 50 }));
    expect(fixed.view.split).toMatchObject({ x: 500, y: 50, x_median: false });
    expect(fixed.view.quadrants).toEqual({ hh: 1, hl: 0, lh: 3, ll: 4 });
    const q = fixed.view.points.map((p: { x: number; y: number; quadrant: string }) => [p.x >= 500, p.y >= 50, p.quadrant]);
    for (const [hx, hy, quad] of q) expect(quad).toBe(`${hx ? "h" : "l"}${hy ? "h" : "l"}`);
  });

  it("heatmap: one series with two group columns", async () => {
    const r = await data(chart("heatmap", [{ metric: m("Tiền", "sum", "Số tiền"), group_by: [{ field: "Loại" }, { field: "Trạng thái" }] }]));
    const cells = r.series[0].rows.map((x: { groups: { label: string }[]; value: number }) => [x.groups[0]!.label, x.groups[1]!.label, x.value]);
    expect(cells).toContainEqual(["POD", "Won", 1300]);
    expect(cells).toContainEqual(["DCC", "Open", 400]);
  });

  it("bullet and gauge carry the target, the share reached and the gap from the server", async () => {
    for (const type of ["bullet", "gauge"]) {
      const r = await data(chart(type, [{ metric: m("Tiền", "sum", "Số tiền"), target: { value: 5000 } }], { bands: [{ label: "KPI", value: 3000 }] }));
      expect(r.series[0].rows[0]).toMatchObject({ value: SUM_ALL, target: 5000, achieved: 0.43, gap: 5000 - SUM_ALL });
    }
  });
});

describe("cohort triangle", () => {
  it("rows are start months, columns the months until the event, cells are shares of the cohort", async () => {
    const r = await data(chart("cohort", [{ metric: m("Chốt", "count", undefined, { cohort: { start: "Ngày nhận", event: "Ngày chốt", bucket: "month" } }) }]));
    const v = r.view;
    expect(v.kind).toBe("cohort");
    expect(v.offsets).toEqual([0, 1, 2]);
    const row = Object.fromEntries(v.rows.map((x: { start: string }) => [x.start, x]));
    expect(row["2026-01-01"].size).toBe(3);
    expect(row["2026-01-01"].cells.map((c: { value: number }) => c.value)).toEqual([1, 1, 1]);
    expect(row["2026-01-01"].cells[0].rate).toBeCloseTo(1 / 3, 10);
    expect(row["2026-02-01"].cells.map((c: { value: number }) => c.value)).toEqual([1, 0, 0]);
    expect(row["2026-03-01"].cells.map((c: { value: number }) => c.value)).toEqual([2, 0, 0]);
    expect(row["2026-03-01"].cells[0].rate).toBeCloseTo(2 / 3, 10);
    expect(v.rates).toBe(true);
  });

  it("a chart without a cohort definition says what to add", async () => {
    expect((await fails(data(chart("cohort", [sumSeries()])))).details.reason).toBe("bad_cohort");
  });
});

describe("chart shape rules", () => {
  it("scatter and matrix need exactly two series; single-series types refuse a second one", async () => {
    expect((await fails(owner("metrics.chart.create", { dashboard_id: dashId, chart: chart("scatter", [sumSeries()]) }))).code).toBe("validation_error");
    expect((await fails(owner("metrics.chart.create", { dashboard_id: dashId, chart: chart("histogram", [sumSeries(), sumSeries()]) }))).code).toBe("validation_error");
    const ok = await owner("metrics.chart.create", { dashboard_id: dashId, chart: chart("matrix", [sumSeries(), sumSeries()]) });
    expect(ok.chart.type).toBe("matrix");
    await owner("metrics.chart.delete", { chart_id: ok.id });
  });
});

describe("dashboard filters and cross filters", () => {
  const kpi = (options: Record<string, unknown> = {}) => chart("kpi", [{ metric: m("Tổng", "sum", "Số tiền", { time: { field: "Ngày chốt" } }) }], options);
  const value = (r: { series: { rows: { value: number }[] }[] }) => r.series[0]!.rows[0]!.value;

  it("a condition narrows the chart; ignore_filters opts out", async () => {
    const f = { conditions: [{ field: "Loại", op: "eq", value: "POD" }] };
    expect(value(await data(kpi(), f))).toBe(100 + 200 + 50 + 1000 + 75);
    expect(value(await data(kpi({ ignore_filters: true }), f))).toBe(SUM_ALL);
  });

  it("a condition on a column the chart's table lacks is skipped and reported, not an error", async () => {
    const other = await owner("datahub.table.create", { datahub_id: dhId, name: "Mục tiêu" });
    await owner("datahub.column.create", { table_id: other.id, name: "Chỉ tiêu", type: "number" });
    await owner("datahub.row.batch", { table_id: other.id, ops: [{ op: "create", data: { "Chỉ tiêu": 7 } }] });
    const c = chart("kpi", [{ metric: { name: "Chỉ tiêu", source: other.id, measure: { agg: "sum", field: "Chỉ tiêu" } } }]);
    const r = await data(c, { conditions: [{ field: "Loại", op: "eq", value: "POD" }] });
    expect(r.series[0].rows[0].value).toBe(7);
    expect(r.notes.join(" ")).toContain("Loại");
    // an option the column does not have is skipped as well
    const o = await data(kpi(), { conditions: [{ field: "Loại", op: "eq", value: "Không có" }] });
    expect(value(o)).toBe(SUM_ALL);
  });

  it("the date range applies to a chart with a date column and leaves the others alone", async () => {
    const range = { range: { kind: "between", from: "2026-02-01", to: "2026-02-28" } };
    expect(value(await data(kpi(), range))).toBe(200 + 300);
    const noDate = chart("kpi", [sumSeries()]);
    expect(value(await data(noDate, range))).toBe(SUM_ALL);
  });

  it("a cross filter on a group and on a period; the clicked chart does not filter itself", async () => {
    const won = { cross: [{ field: "Trạng thái", kind: "enum", value: "Won" }] };
    expect(value(await data(chart("kpi", [sumSeries()]), won))).toBe(100 + 200 + 300 + 1000);
    const month = { cross: [{ field: "Ngày nhận", kind: "date", bucket: "month", value: "2026-02-01" }] };
    expect(value(await data(chart("kpi", [sumSeries()]), month))).toBe(300 + 400);
    const saved = await owner("metrics.chart.create", { dashboard_id: dashId, chart: chart("kpi", [sumSeries()]) });
    const self = await owner("metrics.chart.data", { chart_id: saved.id, filters: { cross: [{ chart_id: saved.id, field: "Trạng thái", kind: "enum", value: "Won" }] } });
    expect(value(self)).toBe(SUM_ALL);
    const other = await owner("metrics.chart.data", { chart_id: saved.id, filters: { cross: [{ chart_id: "01900000-0000-7000-8000-000000000001", field: "Trạng thái", kind: "enum", value: "Won" }] } });
    expect(value(other)).toBe(100 + 200 + 300 + 1000);
    const noCross = await owner("metrics.chart.data", { chart_id: saved.id, filters: { cross: [{ field: "Trạng thái", kind: "enum", value: "Won" }] } });
    expect(value(noCross)).toBe(100 + 200 + 300 + 1000);
    await owner("metrics.chart.delete", { chart_id: saved.id });
  });

  it("the sparkline of a KPI card comes with the answer", async () => {
    const c = chart("kpi", [{ metric: m("Tổng", "sum", "Số tiền", { time: { field: "Ngày nhận" } }) }], { sparkline: "month" });
    const r = await data(c);
    expect(r.spark.rows.map((x: { value: number }) => x.value)).toEqual([350, 700, 1100]);
    expect(value(r)).toBe(SUM_ALL);
  });

  it("pie folds the rest into Khác and a pivot returns totals, computed by the engine", async () => {
    const pie = await data(chart("pie", [{ metric: m("Tiền", "avg", "Số tiền"), group_by: [{ field: "Mã" }] }], { max_slices: 3 }));
    const other = pie.series[0].rows.find((x: { other?: boolean }) => x.other);
    expect(other.value).toBeCloseTo((100 + 200 + 50 + 25 + 75) / 5, 10); // average of the rows outside the top 3 (not a sum of averages)
    const piv = await data(chart("pivot", [{ metric: m("Tiền", "sum", "Số tiền"), group_by: [{ field: "Loại" }, { field: "Trạng thái" }] }]));
    expect(piv.series[0].totals.grand.value).toBe(SUM_ALL);
  });
});
