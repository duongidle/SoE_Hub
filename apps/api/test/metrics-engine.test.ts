import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, actorOf, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { resolveSource, runMetric } from "../src/modules/metrics";

/**
 * Stage 3A-1: the metric engine against a hand calculation in JavaScript over the same rows (negative numbers, a number of 1e14,
 * empty cells, text that looks like numbers, accents), time buckets at the edges of the Vietnam day, week, quarter, and filters.
 */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
let x: Awaited<ReturnType<typeof makeTable>>;

interface R { name: string; money: number | null; kind: string | null; closed: string | null; at: string | null; done: boolean; mst: string | null }
const ROWS: R[] = [
  { name: "A", money: 100, kind: "POD", closed: "2026-11-02", at: "2026-11-15T16:30:00Z", done: true, mst: "0101 " },
  { name: "B", money: 250, kind: "POD", closed: "2026-11-16", at: "2026-11-15T17:00:00Z", done: false, mst: "0101" },
  { name: "C", money: -50, kind: "DCC", closed: "2026-10-31", at: "2026-09-30T16:59:59Z", done: true, mst: "Đức Anh" },
  { name: "D", money: 1e14, kind: "DCC", closed: "2026-09-30", at: "2026-09-30T17:00:00Z", done: false, mst: "duc anh" },
  { name: "E", money: null, kind: "POD", closed: null, at: null, done: false, mst: null },
  { name: "F", money: 3000, kind: null, closed: "2026-01-15", at: "2025-12-31T17:00:00Z", done: true, mst: "" },
  { name: "G", money: 7, kind: "POD", closed: "2026-04-01", at: "2026-02-10T05:00:00Z", done: false, mst: "0202" },
  { name: "H", money: 7, kind: "DCC", closed: "2026-12-31", at: "2026-12-31T16:59:00Z", done: true, mst: "0303" },
  { name: "I", money: 42, kind: "POD", closed: "2026-11-19", at: "2026-11-19T01:00:00Z", done: false, mst: "0404" },
  { name: "J", money: null, kind: "DCC", closed: "2026-03-31", at: "2026-03-31T16:59:59Z", done: false, mst: "0505" },
  { name: "K", money: 12.5, kind: "POD", closed: "2025-11-19", at: "2025-11-19T00:00:00Z", done: true, mst: "0606" },
];

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
  x = await makeTable(a, {
    columns: [
      { name: "Tên", type: "text" },
      { name: "Tiền", type: "number" },
      { name: "Loại", type: "single_select", config: { options: [{ name: "POD" }, { name: "DCC" }] } },
      { name: "Ngày chốt", type: "date" },
      { name: "Giờ", type: "datetime" },
      { name: "Xong", type: "checkbox" },
      { name: "MST", type: "text" },
      { name: "Nhãn", type: "multi_select", config: { options: [{ name: "x" }] } },
    ],
  });
  await a("datahub.row.batch", {
    table_id: x.tableId,
    ops: ROWS.map((r) => ({ op: "create", data: { Tên: r.name, Tiền: r.money, Loại: r.kind, "Ngày chốt": r.closed, Giờ: r.at, Xong: r.done, MST: r.mst } })),
  });
}, 60_000);
afterAll(async () => {
  await t.close();
});

const money = ROWS.map((r) => r.money).filter((v): v is number => v !== null);
const sum = (v: number[]) => v.reduce((s, n) => s + n, 0);
const sorted = (v: number[]) => [...v].sort((p, q) => p - q);
function pct(v: number[], p: number): number {
  const s = sorted(v);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  return s[lo]! + (s[Math.min(lo + 1, s.length - 1)]! - s[lo]!) * (pos - lo);
}
const trimmed = (v: number[], t: number) => {
  const s = sorted(v);
  const cut = Math.floor(t * s.length);
  return sum(s.slice(cut, s.length - cut)) / (s.length - 2 * cut);
};
const stddev = (v: number[], pop = false) => {
  const m = sum(v) / v.length;
  return Math.sqrt(sum(v.map((n) => (n - m) ** 2)) / (pop ? v.length : v.length - 1));
};

const base = { name: "m", source: "" as string };
const metric = (m: Record<string, unknown>) => ({ ...base, source: x.tableId, ...m });
const q = (m: Record<string, unknown>, extra: Record<string, unknown> = {}) => a("metrics.query", { metric: metric(m), ...extra });
const one = async (measure: Record<string, unknown>) => (await q({ measure })).rows[0].value as number | null;

describe("aggregations match a hand calculation", () => {
  it.each([
    ["sum", { agg: "sum", field: "Tiền" }, () => sum(money)],
    ["avg", { agg: "avg", field: "Tiền" }, () => sum(money) / money.length],
    ["min", { agg: "min", field: "Tiền" }, () => Math.min(...money)],
    ["max", { agg: "max", field: "Tiền" }, () => Math.max(...money)],
    ["median", { agg: "median", field: "Tiền" }, () => pct(money, 0.5)],
    ["p25", { agg: "percentile", p: 25, field: "Tiền" }, () => pct(money, 0.25)],
    ["p75", { agg: "p75", field: "Tiền" }, () => pct(money, 0.75)],
    ["p90", { agg: "p90", field: "Tiền" }, () => pct(money, 0.9)],
    ["p37.5", { agg: "percentile", p: 37.5, field: "Tiền" }, () => pct(money, 0.375)],
    ["trimmed mean 10%", { agg: "trimmed_mean", field: "Tiền" }, () => trimmed(money, 0.1)],
    ["trimmed mean 20%", { agg: "trimmed_mean", trim: 0.2, field: "Tiền" }, () => trimmed(money, 0.2)],
    ["stddev", { agg: "stddev", field: "Tiền" }, () => stddev(money)],
    ["stddev_pop", { agg: "stddev_pop", field: "Tiền" }, () => stddev(money, true)],
    ["count rows", { agg: "count" }, () => ROWS.length],
    ["count of a column counts the filled cells", { agg: "count", field: "Tiền" }, () => money.length],
    ["count of a text column skips empty text", { agg: "count", field: "MST" }, () => ROWS.filter((r) => r.mst).length],
    ["count of a checkbox counts the ticked", { agg: "count", field: "Xong" }, () => ROWS.filter((r) => r.done).length],
    ["count_distinct normalises text (case, accents, spaces)", { agg: "count_distinct", field: "MST" }, () => 7],
    ["count_distinct of numbers", { agg: "count_distinct", field: "Tiền" }, () => new Set(money).size],
  ] as [string, Record<string, unknown>, () => number][])("%s", async (_n, measure, expected) => {
    const v = await one(measure);
    const e = expected();
    // The sum holds 1e14 next to values with decimals; compare with a relative tolerance.
    expect(Math.abs((v as number) - e)).toBeLessThanOrEqual(Math.max(1e-9, Math.abs(e) * 1e-12));
  });

  it("min and max of a date column return the day; of a moment, an ISO time", async () => {
    const d = (await q({ measure: { agg: "max", field: "Ngày chốt" } })).rows[0];
    expect(d.value).toBe("2026-12-31");
    const m = await q({ measure: { agg: "min", field: "Giờ" } });
    expect(m.value_type).toBe("datetime");
    expect(m.rows[0].value).toBe("2025-11-19T00:00:00.000Z");
  });

  it("a group with no number gives null, not zero; no rows at all still answers one row", async () => {
    const r = await q({ measure: { agg: "sum", field: "Tiền" }, filter: { field: "Tên", op: "eq", value: "E" } });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ value: null, count: 1 });
    const none = await q({ measure: { agg: "sum", field: "Tiền" }, filter: { field: "Tên", op: "eq", value: "không có" } });
    expect(none.rows).toEqual([{ groups: [], value: null, count: 0 }]);
    const grouped = await q({ measure: { agg: "sum", field: "Tiền" }, group_by: ["Loại"], filter: { field: "Tên", op: "eq", value: "không có" } });
    expect(grouped.rows).toEqual([]);
  });

  it("refuses an aggregate that does not fit the column, with the reason and the kinds that do", async () => {
    for (const [agg, col] of [["sum", "MST"], ["avg", "Loại"], ["median", "Ngày chốt"], ["max", "Nhãn"], ["count_distinct", "Nhãn"], ["trimmed_mean", "MST"]] as const) {
      const e = await fails(q({ measure: { agg, field: col } }));
      expect(e.code, `${agg} ${col}`).toBe("validation_error");
      expect(e.details.reason).toBe("bad_measure");
    }
    expect((await fails(q({ measure: { agg: "sum" } }))).code).toBe("validation_error");
    expect((await fails(q({ measure: { agg: "percentile", field: "Tiền" } }))).code).toBe("validation_error");
    const e = await fails(q({ measure: { agg: "sum", field: "Không có" } }));
    expect(e.details.reason).toBe("unknown_column");
    expect(e.details.available).toContain("Tiền");
    expect((await fails(q({ measure: { agg: "sum", field: "Tiền", extra: 1 } }))).code).toBe("validation_error");
  });
});

describe("grouping", () => {
  it("groups by a select column (names, not ids) and by two columns", async () => {
    const r = await q({ measure: { agg: "sum", field: "Tiền" }, group_by: ["Loại"] });
    const by = Object.fromEntries(r.rows.map((row: { groups: { label: string }[]; value: number }) => [row.groups[0]!.label, row.value]));
    const exp = (k: string | null) => sum(ROWS.filter((row) => row.kind === k && row.money !== null).map((row) => row.money!));
    expect(by.POD).toBeCloseTo(exp("POD"), 6);
    expect(by.DCC).toBeCloseTo(exp("DCC"), 6);
    expect(by["(Trống)"]).toBe(3000);
    const two = await q({ measure: { agg: "count" }, group_by: ["Loại", "Xong"] });
    expect(two.rows.reduce((s: number, row: { count: number }) => s + row.count, 0)).toBe(ROWS.length);
    expect(two.columns.map((c: { column: string }) => c.column)).toEqual(["Loại", "Xong"]);
  });

  it("refuses to group by a multi value column, and a bucket on a text column", async () => {
    expect((await fails(q({ measure: { agg: "count" }, group_by: ["Nhãn"] }))).details.reason).toBe("bad_group");
    expect((await fails(q({ measure: { agg: "count" }, group_by: [{ field: "Tên", bucket: "month" }] }))).details.reason).toBe("bad_group");
  });

  it("orders by value and truncates to the limit", async () => {
    const r = await q({ measure: { agg: "sum", field: "Tiền" }, group_by: ["Tên"] }, { order: "value_desc", limit: 3 });
    expect(r.rows).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(r.rows.map((row: { groups: { value: string }[] }) => row.groups[0]!.value)).toEqual(["D", "F", "B"]);
  });
});

describe("time buckets in Vietnam time", () => {
  const bucket = async (field: string, b: string) => {
    const r = await q({ measure: { agg: "count" }, time: { field, bucket: b } });
    return Object.fromEntries(r.rows.map((row: { groups: { value: string }[]; count: number }) => [row.groups[0]!.value, row.count])) as Record<string, number>;
  };

  it("a moment belongs to the day it falls on in Vietnam: 23:30 stays, 00:00 moves on", async () => {
    const d = await bucket("Giờ", "day");
    expect(d["2026-11-15"]).toBe(1); // A: 23:30 on Sunday
    expect(d["2026-11-16"]).toBe(1); // B: 00:00 on Monday
    expect(d["2026-09-30"]).toBe(1);
    expect(d["2026-10-01"]).toBe(1);
    expect(d["2026-01-01"]).toBe(1);
    expect(d.null).toBe(1); // E has no moment: its own group, never dropped
  });

  it("weeks start on Monday", async () => {
    const w = await bucket("Giờ", "week");
    expect(w["2026-11-09"]).toBe(1); // Sunday 15 Nov 23:30 belongs to the week of Monday 9 Nov
    expect(w["2026-11-16"]).toBe(2); // Monday 16 Nov 00:00 and Thursday 19 Nov
  });

  it("months, quarters and years switch at midnight Vietnam time, not UTC", async () => {
    const m = await bucket("Giờ", "month");
    expect(m["2026-09-01"]).toBe(1);
    expect(m["2026-10-01"]).toBe(1);
    const qr = await bucket("Giờ", "quarter");
    expect(qr["2026-07-01"]).toBe(1); // 30 Sep 23:59:59
    expect(qr["2026-10-01"]).toBe(5); // 1 Oct 00:00, 15/16/19 Nov and 31 Dec 23:59 (16:59 UTC)
    const y = await bucket("Giờ", "year");
    expect(y["2026-01-01"]).toBe(9);
    expect(y["2025-01-01"]).toBe(1); // 19 Nov 2025
  });

  it("a date column buckets by its own day; labels read as periods", async () => {
    const r = await q({ measure: { agg: "count" }, time: { field: "Ngày chốt", bucket: "quarter" } });
    expect(r.rows.map((row: { groups: { label: string }[] }) => row.groups[0]!.label)).toContain("Q4/2026");
    expect(r.columns[0]).toMatchObject({ column: "Ngày chốt", kind: "date", bucket: "quarter" });
  });

  it("quarters and years follow the fiscal start month setting", async () => {
    const adm = as(t, org.admin.id);
    const s = await adm("system.setting.set", { key: "datahub.fiscal_start_month", value: 4 });
    try {
      const qr = await q({ measure: { agg: "count" }, time: { field: "Ngày chốt", bucket: "quarter" } });
      const m = Object.fromEntries(qr.rows.map((row: { groups: { value: string; label: string }[]; count: number }) => [row.groups[0]!.value, [row.groups[0]!.label, row.count]]));
      expect(m["2026-01-01"]).toEqual(["Q4/2025", 2]); // 15 Jan, 31 Mar
      expect(m["2026-04-01"]).toEqual(["Q1/2026", 1]);
      expect(m["2026-10-01"]).toEqual(["Q3/2026", 5]);
      const y = await q({ measure: { agg: "count" }, time: { field: "Ngày chốt", bucket: "year" } });
      const ym = Object.fromEntries(y.rows.map((row: { groups: { value: string }[]; count: number }) => [row.groups[0]!.value, row.count]));
      expect(ym["2025-04-01"]).toBe(3); // 2025-11-19, 2026-01-15, 2026-03-31
      expect(ym["2026-04-01"]).toBe(7);
    } finally {
      await adm("system.setting.set", { key: "datahub.fiscal_start_month", value: 1, version: s.version });
    }
  });
});

describe("time ranges resolve against today in Vietnam time", () => {
  const run = async (range: unknown, now: string) => {
    const rs = await resolveSource({ db: t.c.db.db, actor: actorOf(org.userA1.id) }, x.tableId);
    const r = await runMetric({ db: t.c.db.db, actor: actorOf(org.userA1.id) }, rs, { measure: { agg: "count" }, time: { field: "Ngày chốt", range } as never }, {}, new Date(now));
    return { n: r.rows[0]!.value as number, range: r.diagnostics.range };
  };
  const NOW = "2026-11-19T03:00:00Z"; // Thursday 19 Nov, 10:00 in Vietnam
  it.each([
    ["this_week", "2026-11-16", "2026-11-22", 2],
    ["last_week", "2026-11-09", "2026-11-15", 0],
    ["this_month", "2026-11-01", "2026-11-30", 3],
    ["last_month", "2026-10-01", "2026-10-31", 1],
    ["this_quarter", "2026-10-01", "2026-12-31", 5],
    ["last_quarter", "2026-07-01", "2026-09-30", 1],
    ["this_year", "2026-01-01", "2026-12-31", 9],
    ["last_year", "2025-01-01", "2025-12-31", 1],
    ["today", "2026-11-19", "2026-11-19", 1],
  ])("%s", async (preset, from, to, n) => {
    expect(await run(preset, NOW)).toEqual({ n, range: { field: "Ngày chốt", from, to } });
  });
  it("last N days, last N months, an explicit period and a between range", async () => {
    expect(await run({ kind: "preset", preset: "last_n_days", n: 7 }, NOW)).toMatchObject({ n: 2, range: { from: "2026-11-13", to: "2026-11-19" } });
    expect(await run({ kind: "last_n_months", n: 3 }, NOW)).toMatchObject({ n: 5, range: { from: "2026-09-01", to: "2026-11-30" } });
    expect(await run({ kind: "period", unit: "quarter", year: 2026, index: 1 }, NOW)).toMatchObject({ n: 2, range: { from: "2026-01-01", to: "2026-03-31" } });
    expect(await run({ kind: "between", from: "2026-11-02", to: "2026-11-16" }, NOW)).toMatchObject({ n: 2 });
  });
  it("the Vietnam day changes at 17:00 UTC, so the week changes there too", async () => {
    // 23:30 Sunday 15 Nov in Vietnam: still the week of 9 Nov.
    expect((await run("this_week", "2026-11-15T16:30:00Z")).range).toMatchObject({ from: "2026-11-09", to: "2026-11-15" });
    expect((await run("this_week", "2026-11-15T17:00:00Z")).range).toMatchObject({ from: "2026-11-16", to: "2026-11-22" });
  });
  it("a range on a moment column covers [midnight, midnight) in Vietnam time", async () => {
    const rs = await resolveSource({ db: t.c.db.db, actor: actorOf(org.userA1.id) }, x.tableId);
    const ctx = { db: t.c.db.db, actor: actorOf(org.userA1.id) };
    const r = await runMetric(ctx, rs, { measure: { agg: "count" }, time: { field: "Giờ", range: { kind: "between", from: "2026-11-15", to: "2026-11-15" } } as never });
    expect(r.rows[0]!.value).toBe(1); // A (23:30) but not B (00:00 on the 16th)
  });
  it("a range or bucket without a time field is refused; so is a text field", async () => {
    expect((await fails(q({ measure: { agg: "count" }, time: { range: "this_month" } }))).details.reason).toBe("bad_time");
    expect((await fails(q({ measure: { agg: "count" }, time: { field: "Tên", bucket: "day" } }))).details.reason).toBe("bad_time");
  });
});

describe("filters reuse the filter language of the Datahub", () => {
  const n = async (filter: unknown) => (await q({ measure: { agg: "count" }, filter })).rows[0].value;
  it("options by name, text, ranges, empties, and or/and", async () => {
    expect(await n({ field: "Loại", op: "eq", value: "pod" })).toBe(ROWS.filter((r) => r.kind === "POD").length);
    expect(await n({ field: "Loại", op: "in", value: ["POD", "DCC"] })).toBe(ROWS.filter((r) => r.kind).length);
    expect(await n({ field: "Loại", op: "eq", value: null })).toBe(1);
    expect(await n({ field: "Tên", op: "contains", value: "a" })).toBe(1);
    expect(await n({ field: "Tiền", op: "between", value: [0, 200] })).toBe(ROWS.filter((r) => r.money !== null && r.money >= 0 && r.money <= 200).length);
    expect(await n({ and: [{ field: "Xong", op: "eq", value: true }, { or: [{ field: "Loại", op: "eq", value: "DCC" }, { field: "Tiền", op: "gt", value: 1000 }] }] })).toBe(ROWS.filter((r) => r.done && (r.kind === "DCC" || (r.money ?? 0) > 1000)).length);
    expect(await n({ field: "MST", op: "is_empty" })).toBe(2);
    expect(await n({ field: "Ngày chốt", op: "this_month" })).toBeGreaterThanOrEqual(0);
  });
  it("a call can add a filter and replace the grouping of a saved metric", async () => {
    const saved = await a("metrics.metric.create", { datahub_id: x.dhId, metric: metric({ name: "Tổng tiền", measure: { agg: "sum", field: "Tiền" } }) });
    const all = await a("metrics.query", { metric_id: saved.id });
    expect(all.rows[0].value).toBeCloseTo(sum(money), 3);
    const pod = await a("metrics.query", { metric_id: saved.id, filter: { field: "Loại", op: "eq", value: "POD" }, group_by: ["Xong"] });
    expect(pod.rows.reduce((s: number, r: { value: number }) => s + r.value, 0)).toBeCloseTo(sum(ROWS.filter((r) => r.kind === "POD" && r.money !== null).map((r) => r.money!)), 3);
    expect((await fails(a("metrics.query", { metric_id: saved.id, filter: { field: "Loại", op: "eq", value: "XYZ" } }))).code).toBe("invalid_filter");
    expect((await fails(a("metrics.query", { metric_id: saved.id, metric: metric({ measure: { agg: "count" } }) }))).details.reason).toBe("metric_required");
  });
});
