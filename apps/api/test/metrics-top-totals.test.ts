import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** Stage 3C-1 fix: the "Khác" row of `top` and the `totals` of a pivot come from the engine, right for every measure (hand calculation over all rows). */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
let tableId: string;
let dhId: string;

const ROWS: { k: string; q: string; v: number; c: string }[] = [
  { k: "A", q: "Q1", v: 10, c: "x" }, { k: "A", q: "Q2", v: 30, c: "x" },
  { k: "B", q: "Q1", v: 20, c: "y" }, { k: "B", q: "Q2", v: 20, c: "y" }, { k: "B", q: "Q2", v: 80, c: "z" },
  { k: "C", q: "Q1", v: 5, c: "x" }, { k: "C", q: "Q2", v: 7, c: "z" },
  { k: "D", q: "Q1", v: 1, c: "x" }, { k: "D", q: "Q1", v: 3, c: "y" },
  { k: "E", q: "Q2", v: 100, c: "x" },
];
const avg = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const distinct = (xs: string[]) => new Set(xs).size;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
  const x = await makeTable(a, { columns: [{ name: "K", type: "text" }, { name: "Q", type: "text" }, { name: "V", type: "number" }, { name: "C", type: "text" }] });
  tableId = x.tableId;
  dhId = x.dhId;
  await a("datahub.row.batch", { table_id: tableId, ops: ROWS.map((r) => ({ op: "create", data: { K: r.k, Q: r.q, V: r.v, C: r.c } })) });
}, 60_000);
afterAll(async () => {
  await t.close();
});

const q = (agg: string, field: string | undefined, extra: Record<string, unknown>) => a("metrics.query", { metric: { name: "m", source: tableId, measure: { agg, ...(field ? { field } : {}) }, ...extra.metric as object }, datahub_id: dhId, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "metric")) });

describe("top N with the Khác row", () => {
  it.each([
    ["sum", (r: typeof ROWS) => r.reduce((s, x) => s + x.v, 0), "V"],
    ["avg", (r: typeof ROWS) => avg(r.map((x) => x.v)), "V"],
    ["median", (r: typeof ROWS) => median(r.map((x) => x.v)), "V"],
    ["count_distinct", (r: typeof ROWS) => distinct(r.map((x) => x.c)), "C"],
    ["count", (r: typeof ROWS) => r.length, undefined],
  ])("%s: Khác is the measure over the rows outside the top, not a sum of groups", async (agg, calc, field) => {
    const res = await q(agg, field, { group_by: [{ field: "K" }], order: "value_desc", top: 2 });
    expect(res.rows).toHaveLength(3);
    const other = res.rows[2];
    expect(other.other).toBe(true);
    expect(other.groups[0].label).toBe("Khác");
    const top = res.rows.slice(0, 2).map((r: { groups: { value: string }[] }) => r.groups[0]!.value);
    const rest = ROWS.filter((r) => !top.includes(r.k));
    expect(other.value).toBeCloseTo(calc(rest), 9);
    // The top groups are the largest by the same measure over their own rows.
    for (const row of res.rows.slice(0, 2)) expect(row.value).toBeCloseTo(calc(ROWS.filter((r) => r.k === row.groups[0].value)), 9);
    expect(res.other_groups).toBe(3);
    expect(res.truncated).toBe(false);
  });
  it("has no Khác row when the groups fit", async () => {
    const res = await q("sum", "V", { group_by: [{ field: "K" }], top: 5 });
    expect(res.rows).toHaveLength(5);
    expect(res.rows.some((r: { other?: boolean }) => r.other)).toBe(false);
    expect(res.other_groups).toBe(0);
  });
  it("needs exactly one group, and is refused with derived metrics, compare and cohort", async () => {
    expect((await fails(q("sum", "V", { group_by: [{ field: "K" }, { field: "Q" }], top: 2 }))).details.reason).toBe("bad_top");
    await a("metrics.metric.create", { datahub_id: dhId, metric: { name: "Tổng V", source: tableId, measure: { agg: "sum", field: "V" } } });
    const e = await fails(a("metrics.query", { metric: { name: "d", formula: "=[Tổng V] / [Tổng V]" }, datahub_id: dhId, group_by: [{ field: "K" }], top: 2 }));
    expect(e.details.reason).toBe("unsupported_for_derived");
  });
});

describe("totals", () => {
  it.each([
    ["sum", (r: typeof ROWS) => r.reduce((s, x) => s + x.v, 0), "V"],
    ["avg", (r: typeof ROWS) => avg(r.map((x) => x.v)), "V"],
    ["median", (r: typeof ROWS) => median(r.map((x) => x.v)), "V"],
    ["count_distinct", (r: typeof ROWS) => distinct(r.map((x) => x.c)), "C"],
  ])("%s: row, column and grand totals are the measure over those rows", async (agg, calc, field) => {
    const res = await q(agg, field, { group_by: [{ field: "K" }, { field: "Q" }], totals: "true" });
    expect(res.totals.grand.value).toBeCloseTo(calc(ROWS), 9);
    expect(res.totals.by_first).toHaveLength(5);
    for (const r of res.totals.by_first) expect(r.value).toBeCloseTo(calc(ROWS.filter((x) => x.k === r.groups[0].value)), 9);
    expect(res.totals.by_rest).toHaveLength(2);
    for (const r of res.totals.by_rest) expect(r.value).toBeCloseTo(calc(ROWS.filter((x) => x.q === r.groups[0].value)), 9);
  });
  it("one group column gives only the grand total", async () => {
    const res = await q("avg", "V", { group_by: [{ field: "K" }], totals: "true" });
    expect(res.totals.by_first).toBeNull();
    expect(res.totals.grand.value).toBeCloseTo(avg(ROWS.map((r) => r.v)), 9);
    expect((await fails(q("sum", "V", { totals: "true" }))).details.reason).toBe("bad_totals");
  });
});
