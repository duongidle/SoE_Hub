import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, actorOf, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { runDefinition } from "../src/modules/metrics";

/**
 * Stage 3A-2 (sections 1 to 3): derived metrics, comparison with an earlier period, running total, cohort, targets and outliers,
 * each against a hand calculation in JavaScript over the same rows.
 */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
let x: Awaited<ReturnType<typeof makeTable>>;
let goals: string;
let ctx: { db: TestApp["c"]["db"]["db"]; actor: ReturnType<typeof actorOf> };

interface R { name: string; money: number; kind: "POD" | "DCC"; recv: string; closed: string | null }
const ROWS: R[] = [
  { name: "A", money: 100, kind: "POD", recv: "2026-01-10", closed: "2026-01-20" },
  { name: "B", money: 200, kind: "POD", recv: "2026-01-25", closed: "2026-02-05" },
  { name: "C", money: 300, kind: "DCC", recv: "2026-02-03", closed: "2026-02-10" },
  { name: "D", money: 400, kind: "POD", recv: "2026-02-15", closed: "2026-04-01" },
  { name: "E", money: 50, kind: "DCC", recv: "2026-03-01", closed: "2026-03-02" },
  { name: "F", money: 1000, kind: "POD", recv: "2026-03-10", closed: "2026-03-10" },
  { name: "G", money: 70, kind: "DCC", recv: "2025-02-05", closed: "2025-02-20" },
  { name: "H", money: 30, kind: "POD", recv: "2025-01-05", closed: "2025-01-15" },
  { name: "I", money: 10, kind: "POD", recv: "2026-04-05", closed: null },
  { name: "J", money: 5000, kind: "POD", recv: "2026-03-20", closed: "2026-03-25" },
];
const between = (from: string, to: string) => ({ kind: "between", from, to });
const sum = (v: number[]) => v.reduce((s, n) => s + n, 0);
const month = (d: string) => d.slice(0, 7);

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
  ctx = { db: t.c.db.db, actor: actorOf(org.userA1.id) };
  x = await makeTable(a, {
    columns: [
      { name: "Tên", type: "text" },
      { name: "Tiền", type: "number" },
      { name: "Loại", type: "single_select", config: { options: [{ name: "POD" }, { name: "DCC" }] } },
      { name: "Ngày nhận", type: "date" },
      { name: "Ngày chốt", type: "date" },
    ],
  });
  await a("datahub.row.batch", { table_id: x.tableId, ops: ROWS.map((r) => ({ op: "create", data: { Tên: r.name, Tiền: r.money, Loại: r.kind, "Ngày nhận": r.recv, "Ngày chốt": r.closed } })) });
  const g = await a("datahub.table.create", { datahub_id: x.dhId, name: "Mục tiêu" });
  goals = g.id;
  for (const c of [{ name: "Kỳ", type: "date" }, { name: "Loại", type: "text" }, { name: "Chỉ tiêu", type: "number" }]) await a("datahub.column.create", { table_id: goals, ...c });
  const G = [["2026-02-01", "pod", 150], ["2026-02-01", "DCC", 400], ["2026-03-01", "POD", 5000], ["2026-03-01", "Pod", 1000]];
  await a("datahub.row.batch", { table_id: goals, ops: G.map(([k, l, v]) => ({ op: "create", data: { Kỳ: k, Loại: l, "Chỉ tiêu": v } })) });
  const leaf = (name: string, measure: unknown, filter?: unknown) => a("metrics.metric.create", { datahub_id: x.dhId, metric: { name, source: x.tableId, measure, time: { field: "Ngày chốt" }, ...(filter ? { filter } : {}) } });
  await leaf("Số deal", { agg: "count" });
  await leaf("Tổng tiền", { agg: "sum", field: "Tiền" });
  await leaf("Số deal DCC", { agg: "count" }, { field: "Loại", op: "eq", value: "DCC" });
}, 60_000);
afterAll(async () => {
  await t.close();
});

const define = (name: string, formula: string, extra: Record<string, unknown> = {}) => a("metrics.metric.create", { datahub_id: x.dhId, metric: { name, formula, ...extra } });
const run = (metric: Record<string, unknown>, extra: Record<string, unknown> = {}) => a("metrics.query", { datahub_id: x.dhId, metric, ...extra });
const key = (g: { value: unknown; label: string }) => (typeof g.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.value) ? g.value : g.label);
const byGroup = (r: { rows: { groups: { value: unknown; label: string }[]; [k: string]: unknown }[] }) => new Map(r.rows.map((row) => [row.groups.map(key).join("|"), row]));

describe("derived metric", () => {
  it("divides one metric by another over everything", async () => {
    await define("Tiền TB", "=[Tổng tiền] / [Số deal]");
    const r = await run({ name: "i", formula: "=[Tổng tiền] / [Số deal]" });
    expect(r.rows[0].value).toBeCloseTo(sum(ROWS.map((q) => q.money)) / ROWS.length, 9);
    expect(r.metric.formula).toBe("=[Tổng tiền] / [Số deal]");
  });

  it("is computed for each group; a group without a divisor shows the formula error on its row only", async () => {
    const m = await define("Tiền chia DCC", "=[Tổng tiền] / [Số deal DCC]");
    const r = byGroup(await a("metrics.query", { metric_id: m.id, group_by: JSON.stringify(["Loại"]) }));
    const dcc = ROWS.filter((q) => q.kind === "DCC");
    expect(r.get("DCC")!.value).toBeCloseTo(sum(dcc.map((q) => q.money)) / dcc.length, 9);
    expect(r.get("POD")!.value).toBeNull();
    expect(r.get("POD")!.error).toBe("#DIV/0!");
    const safe = await run({ name: "i", formula: "=IFERROR([Tổng tiền] / [Số deal DCC], 0)" }, { group_by: JSON.stringify(["Loại"]) });
    expect(byGroup(safe).get("POD")!.value).toBe(0);
  });

  it("follows the time range and the buckets of the call, and the filter reaches every metric it reads", async () => {
    const q = { time: JSON.stringify({ bucket: "month", range: between("2026-02-01", "2026-03-31") }) };
    const r = byGroup(await run({ name: "i", formula: "=[Tổng tiền] / [Số deal]" }, q));
    for (const mo of ["2026-02", "2026-03"]) {
      const rows = ROWS.filter((p) => p.closed && month(p.closed) === mo);
      expect(r.get(`${mo}-01`)!.value).toBeCloseTo(sum(rows.map((p) => p.money)) / rows.length, 9);
    }
    const f = await run({ name: "i", formula: "=[Tổng tiền] / [Số deal]" }, { filter: JSON.stringify({ field: "Loại", op: "eq", value: "POD" }) });
    const pod = ROWS.filter((p) => p.kind === "POD");
    expect(f.rows[0].value).toBeCloseTo(sum(pod.map((p) => p.money)) / pod.length, 9);
  });

  it("can read another derived metric, compares with an earlier period and refuses a date column of its own", async () => {
    const r = await run({ name: "i", formula: "=[Tiền TB] * 2" });
    expect(r.rows[0].value).toBeCloseTo((sum(ROWS.map((p) => p.money)) / ROWS.length) * 2, 9);
    const c = byGroup(await run({ name: "i", formula: "=[Tổng tiền] / [Số deal]" }, { time: JSON.stringify({ bucket: "month", range: between("2026-02-01", "2026-02-28") }), compare: "year_ago" }));
    expect(c.get("2026-02-01")!.previous).toBeCloseTo(70, 9); // G, Feb 2025
    const e = await fails(run({ name: "i", formula: "=[Tổng tiền] / [Số deal]" }, { time: JSON.stringify({ field: "Ngày chốt" }) }));
    expect(e.details.reason).toBe("bad_time");
  });

  it("says which metric is unknown and lists the real ones; detects a cycle; refuses to save a bad formula", async () => {
    const e = await fails(run({ name: "i", formula: "=[Không có] + 1" }));
    expect(e.details.reason).toBe("unknown_metric");
    expect(e.details.available).toContain("Tổng tiền");
    expect((await fails(define("Sai", "=1 + 2"))).details.reason).toBe("bad_formula");
    expect((await fails(define("Sai2", "=[Không có]"))).details.reason).toBe("unknown_metric");
    // L (source) <- F1 = [L] <- F2 = [F1]; then L becomes [F2]: a cycle.
    const l = await a("metrics.metric.create", { datahub_id: x.dhId, metric: { name: "Vòng L", source: x.tableId, measure: { agg: "count" } } });
    await define("Vòng F1", "=[Vòng L] + 1");
    await define("Vòng F2", "=[Vòng F1] + 1");
    const cyc = await fails(a("metrics.metric.update", { metric_id: l.id, version: l.version, metric: { name: "Vòng L", formula: "=[Vòng F2]" } }));
    expect(cyc.details.reason).toBe("formula_cycle");
    // A metric cannot read itself either.
    const self = await fails(define("Tự", "=[Tự] + 1"));
    expect(["unknown_metric", "formula_cycle"]).toContain(self.details.reason);
  });

  it("is not reachable by a person who may not read the tables it reads", async () => {
    const m = await a("metrics.metric.list", { datahub_id: x.dhId });
    const id = m.items.find((i: { name: string }) => i.name === "Tiền TB").id as string;
    const out = as(t, org.userA2.id);
    expect(["forbidden", "not_found"]).toContain((await fails(out("metrics.query", { metric_id: id }))).code);
    // Given only the goal table: the definition is hidden and a formula typed by hand cannot read the metrics on the other table.
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userB1.id, table_id: goals, permission: "view" });
    const one = as(t, org.userB1.id);
    expect((await fails(one("metrics.query", { metric_id: id }))).code).toBe("not_found");
    expect((await fails(one("metrics.query", { datahub_id: x.dhId, metric: { name: "i", formula: "=[Tổng tiền] / [Số deal]" } }))).details.reason).toBe("unknown_metric");
  });
});

describe("comparison with an earlier period", () => {
  const sumBy = (rows: R[]) => sum(rows.map((r) => r.money));
  const base = { name: "i", source: "", measure: { agg: "sum", field: "Tiền" }, time: { field: "Ngày chốt", bucket: "month" } };
  const m = (extra: Record<string, unknown> = {}) => ({ ...base, source: x.tableId, ...extra });

  it("previous_period of whole months lines the months up", async () => {
    const r = byGroup(await run(m(), { time: JSON.stringify({ range: between("2026-02-01", "2026-03-31") }), compare: "previous_period" }));
    const feb = sumBy(ROWS.filter((p) => p.closed && month(p.closed) === "2026-02"));
    const mar = sumBy(ROWS.filter((p) => p.closed && month(p.closed) === "2026-03"));
    const jan = sumBy(ROWS.filter((p) => p.closed && month(p.closed) === "2026-01"));
    expect(r.get("2026-02-01")).toMatchObject({ value: feb, previous: null, change: null });
    expect(r.get("2026-03-01")).toMatchObject({ value: mar, previous: jan, change: mar - jan });
    expect(r.get("2026-03-01")!.change_pct).toBeCloseTo((mar - jan) / jan, 9);
  });

  it("year_ago, with buckets and without", async () => {
    const r = byGroup(await run(m(), { time: JSON.stringify({ range: between("2026-02-01", "2026-03-31") }), compare: "year_ago" }));
    expect(r.get("2026-02-01")).toMatchObject({ previous: 70, change: 500 - 70 });
    expect(r.get("2026-03-01")).toMatchObject({ previous: null });
    const one = await run({ name: "i", source: x.tableId, measure: { agg: "sum", field: "Tiền" }, time: { field: "Ngày chốt" } }, { time: JSON.stringify({ range: between("2026-02-01", "2026-02-28") }), compare: "year_ago" });
    expect(one.rows[0]).toMatchObject({ value: 500, previous: 70 });
    expect(one.diagnostics.compare).toEqual({ kind: "year_ago", from: "2025-02-01", to: "2025-02-28" });
  });

  it("keeps the earlier groups that have no current row, and respects other groups", async () => {
    const r = await run(m({ group_by: ["Loại"] }), { time: JSON.stringify({ range: between("2026-02-01", "2026-02-28") }), compare: "year_ago" });
    const k = byGroup(r);
    expect(k.get("2026-02-01|DCC")).toMatchObject({ value: 300, previous: 70 });
    expect(k.get("2026-02-01|POD")).toMatchObject({ value: 200, previous: null });
  });

  it("a saved comparison can be switched off, needs a range, and is refused for cohorts", async () => {
    const saved = m({ compare: "year_ago", time: { field: "Ngày chốt", range: between("2026-02-01", "2026-02-28") } });
    expect((await run(saved)).rows[0].previous).toBe(70);
    expect((await run(saved, { compare: "none" })).rows[0].previous).toBeUndefined();
    expect((await fails(run(m(), { compare: "year_ago" }))).details.reason).toBe("bad_compare");
    expect((await fails(a("metrics.metric.create", { datahub_id: x.dhId, metric: m({ compare: "year_ago" }) }))).details.reason).toBe("bad_compare");
  });
});

describe("running total", () => {
  const m = (extra: Record<string, unknown> = {}) => ({ name: "i", source: x.tableId, measure: { agg: "sum", field: "Tiền" }, time: { field: "Ngày chốt", bucket: "month", range: between("2026-01-01", "2026-04-30") }, cumulative: true, ...extra });
  it("adds up month by month", async () => {
    const r = await run(m());
    const per = ["2026-01", "2026-02", "2026-03", "2026-04"].map((mo) => sum(ROWS.filter((p) => p.closed && month(p.closed) === mo).map((p) => p.money)));
    let run_ = 0;
    expect(r.rows.map((row: { value: number }) => row.value)).toEqual(per.map((v) => (run_ += v)));
  });
  it("adds up separately for each group", async () => {
    const r = byGroup(await run(m({ group_by: ["Loại"] })));
    const dcc = ["2026-02", "2026-03"].map((mo) => sum(ROWS.filter((p) => p.kind === "DCC" && p.closed && month(p.closed) === mo).map((p) => p.money)));
    expect(r.get("2026-02-01|DCC")!.value).toBe(dcc[0]);
    expect(r.get("2026-03-01|DCC")!.value).toBe(dcc[0]! + dcc[1]!);
  });
  it("counts too, and works with a comparison", async () => {
    const r = await run(m({ measure: { agg: "count" } }), { compare: "year_ago", time: JSON.stringify({ range: between("2026-02-01", "2026-03-31") }) });
    expect(r.rows.map((row: { value: number }) => row.value)).toEqual([2, 5]);
    expect(byGroup(r).get("2026-02-01")!.previous).toBe(1);
  });
  it("refuses what has no meaning", async () => {
    expect((await fails(run(m({ measure: { agg: "avg", field: "Tiền" } })))).details.reason).toBe("bad_cumulative");
    expect((await fails(run(m({ time: { field: "Ngày chốt" } })))).details.reason).toBe("bad_cumulative");
    expect((await fails(run({ name: "i", formula: "=[Tổng tiền]/[Số deal]", cumulative: true }))).code).toBe("validation_error");
  });
});

describe("cohort", () => {
  const cohort = { start: "Ngày nhận", event: "Ngày chốt", bucket: "month" };
  const def = (extra: Record<string, unknown> = {}) => ({ name: "i", source: x.tableId, measure: { agg: "count" }, cohort: { ...cohort, ...extra } });
  // Months between receiving and closing, from the rows above.
  const offset = (p: R) => (Number(p.closed!.slice(0, 4)) - Number(p.recv.slice(0, 4))) * 12 + Number(p.closed!.slice(5, 7)) - Number(p.recv.slice(5, 7));

  it("counts by start month and by months until the event; rows without an event are not in the matrix but in the sizes", async () => {
    const r = await run(def());
    expect(r.columns.map((c: { column: string }) => c.column)).toEqual(["Ngày nhận", "Kỳ sau Ngày nhận"]);
    const got = byGroup(r);
    const want = new Map<string, number>();
    for (const p of ROWS.filter((q) => q.closed)) want.set(`${p.recv.slice(0, 7)}-01|${offset(p)}`, (want.get(`${p.recv.slice(0, 7)}-01|${offset(p)}`) ?? 0) + 1);
    expect(new Map([...got].map(([k, v]) => [k, v.value]))).toEqual(want);
    const sizes = byGroup(r.cohort_sizes);
    expect(sizes.get("2026-03-01")!.value).toBe(3);
    expect(sizes.get("2026-04-01")!.value).toBe(1); // I has no event yet
  });

  it("keeps only mature cohorts and cuts the later periods", async () => {
    const mature = await runDefinition(ctx, def({ mature_after: 2 }) as never, {}, { now: new Date("2026-04-15T05:00:00Z") });
    const starts = new Set(mature.rows.map((row) => row.groups[0]!.value));
    expect([...starts].sort()).toEqual(["2025-01-01", "2025-02-01", "2026-01-01", "2026-02-01"]);
    expect(mature.cohort_sizes!.rows.map((row) => row.groups[0]!.value).sort()).toEqual(["2025-01-01", "2025-02-01", "2026-01-01", "2026-02-01"]);
    const cut = await run(def({ max_offset: 0 }));
    expect(cut.rows.every((row: { groups: { value: number }[] }) => row.groups[1]!.value === 0)).toBe(true);
  });

  it("refuses non-date columns and a comparison", async () => {
    expect((await fails(run(def({ start: "Tên" })))).details.reason).toBe("bad_cohort");
    expect((await fails(run({ ...def(), compare: "year_ago", time: { field: "Ngày chốt", range: between("2026-01-01", "2026-02-01") } }))).code).toBe("validation_error");
  });
});

describe("target", () => {
  const sumM = (extra: Record<string, unknown> = {}) => ({ name: "i", source: x.tableId, measure: { agg: "sum", field: "Tiền" }, time: { field: "Ngày chốt", bucket: "month", range: between("2026-01-01", "2026-03-31") }, ...extra });

  it("a constant: share reached and what is missing", async () => {
    const r = byGroup(await run(sumM({ target: { value: 1000 } })));
    const feb = 500;
    expect(r.get("2026-02-01")).toMatchObject({ value: feb, target: 1000, achieved: 0.5, gap: 500 });
    expect(r.get("2026-03-01")).toMatchObject({ value: 6050, target: 1000, gap: 1000 - 6050 });
    expect(r.get("2026-03-01")!.achieved).toBeCloseTo(6.05, 9);
  });

  it("from a table, by period and by a column, matching names without regard to case; none where the table has no row", async () => {
    const target = { table: "Mục tiêu", value_field: "Chỉ tiêu", period_field: "Kỳ", by: { Loại: "Loại" } };
    const r = byGroup(await run(sumM({ group_by: ["Loại"], target })));
    expect(r.get("2026-02-01|POD")).toMatchObject({ value: 200, target: 150, gap: -50 });
    expect(r.get("2026-02-01|POD")!.achieved).toBeCloseTo(200 / 150, 9);
    expect(r.get("2026-02-01|DCC")).toMatchObject({ value: 300, target: 400, achieved: 0.75, gap: 100 });
    // Two target rows (POD and Pod) for March add up.
    expect(r.get("2026-03-01|POD")).toMatchObject({ value: 6000, target: 6000, achieved: 1, gap: 0 });
    expect(r.get("2026-03-01|DCC")).toMatchObject({ value: 50, target: null, achieved: null, gap: null });
    expect(r.get("2026-01-01|POD")).toMatchObject({ value: 100, target: null });
  });

  it("without groups it sums the target of the whole range; a saved target can be switched off", async () => {
    const target = { table: "Mục tiêu", value_field: "Chỉ tiêu", period_field: "Kỳ" };
    const one = await run({ name: "i", source: x.tableId, measure: { agg: "sum", field: "Tiền" }, time: { field: "Ngày chốt", range: between("2026-02-01", "2026-03-31") }, target });
    expect(one.rows[0]).toMatchObject({ value: 6550, target: 150 + 400 + 5000 + 1000 });
    const saved = await a("metrics.metric.create", { datahub_id: x.dhId, metric: sumM({ name: "Có mục tiêu", target: { value: 10 } }) });
    expect((await a("metrics.query", { metric_id: saved.id })).rows[0].target).toBe(10);
    expect((await a("metrics.query", { metric_id: saved.id, target: JSON.stringify({ value: 20 }) })).rows[0].target).toBe(20);
  });

  it("works on a derived metric too, and says what is wrong when the table does not fit", async () => {
    const r = await run({ name: "i", formula: "=[Tổng tiền] / [Số deal]", target: { value: 100 } }, { time: JSON.stringify({ bucket: "month", range: between("2026-02-01", "2026-02-28") }) });
    expect(r.rows[0]).toMatchObject({ value: 250, target: 100, achieved: 2.5 });
    expect((await fails(run(sumM({ group_by: ["Loại"], target: { table: "Mục tiêu", value_field: "Chỉ tiêu", period_field: "Kỳ" } })))).details.reason).toBe("bad_target");
    expect((await fails(run(sumM({ target: { table: "Mục tiêu", value_field: "Chỉ tiêu" } })))).details.reason).toBe("bad_target");
    expect((await fails(run(sumM({ target: { table: "Không có", value_field: "Chỉ tiêu", period_field: "Kỳ" } })))).details.reason).toBe("target_table_not_found");
    expect((await fails(run(sumM({ target: { table: "Mục tiêu", value_field: "Cột lạ", period_field: "Kỳ" } })))).details.reason).toBe("unknown_column");
    expect((await fails(a("metrics.metric.create", { datahub_id: x.dhId, metric: sumM({ name: "Sai", target: { table: "Mục tiêu", value_field: "Cột lạ", period_field: "Kỳ" } }) }))).details.reason).toBe("unknown_column");
  });

  it("is not computed for a person who may not read the target table", async () => {
    const other = await makeTable(a, { name: "Riêng", columns: [{ name: "N", type: "number" }] });
    await a("datahub.share.set", { datahub_id: other.dhId, grantee_id: org.userA2.id, table_id: other.tableId, permission: "view" });
    // userA2 is a viewer of the other datahub only; the target table lives in the first datahub.
    const v = as(t, org.userA2.id);
    expect((await fails(v("metrics.query", { datahub_id: x.dhId, metric: sumM({ target: { table: "Mục tiêu", value_field: "Chỉ tiêu", period_field: "Kỳ" } }) }))).code).toBe("not_found");
  });
});

describe("outliers by IQR", () => {
  const sorted = ROWS.map((r) => r.money).sort((p, q) => p - q);
  const pct = (p: number) => {
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos);
    return sorted[lo]! + (sorted[Math.min(lo + 1, sorted.length - 1)]! - sorted[lo]!) * (pos - lo);
  };
  const q1 = pct(0.25);
  const q3 = pct(0.75);
  const upper = q3 + 1.5 * (q3 - q1);
  const lower = q1 - 1.5 * (q3 - q1);
  const inside = ROWS.filter((r) => r.money >= lower && r.money <= upper);
  const outside = ROWS.filter((r) => r.money < lower || r.money > upper);
  const m = (mode: string, extra: Record<string, unknown> = {}) => ({ name: "i", source: x.tableId, measure: { agg: "sum", field: "Tiền" }, outliers: { mode, ...extra } });

  it("include counts everything and reports the bounds", async () => {
    const r = await run(m("include"));
    expect(r.rows[0].value).toBe(sum(ROWS.map((p) => p.money)));
    expect(r.diagnostics.outliers).toMatchObject({ q1, q3, iqr: q3 - q1, lower, upper, n: ROWS.length, k: 1.5 });
    expect(outside.map((o) => o.name)).toEqual(["F", "J"]);
  });
  it("exclude drops the rows outside the bounds", async () => {
    const r = await run(m("exclude"));
    expect(r.rows[0].value).toBe(sum(inside.map((p) => p.money)));
    expect(r.rows[0].count).toBe(inside.length);
  });
  it("separate returns the inside numbers and, apart, the outside ones", async () => {
    const r = await run(m("separate"));
    expect(r.rows[0].value).toBe(sum(inside.map((p) => p.money)));
    expect(r.outlier_rows.rows[0].value).toBe(sum(outside.map((p) => p.money)));
  });
  it("k widens or narrows the bounds, per group queries use the bounds of the whole set", async () => {
    // k = 10 moves the upper bound to Q3 + 3200: only J (5000) is still outside.
    const wide = await run(m("exclude", { k: 10 }));
    expect(wide.rows[0].value).toBe(sum(ROWS.map((p) => p.money)) - 5000);
    // k = 0: the bounds are the quartiles themselves.
    const tight = await run(m("exclude", { k: 0 }));
    expect(tight.rows[0].value).toBe(sum(ROWS.filter((p) => p.money >= q1 && p.money <= q3).map((p) => p.money)));
    const g = byGroup(await run({ ...m("exclude"), group_by: ["Loại"] }));
    expect(g.get("POD")!.value).toBe(sum(inside.filter((p) => p.kind === "POD").map((p) => p.money)));
  });
  it("applies to the filtered rows, can be set by the call, and is refused on a count or a non-number", async () => {
    const f = await run(m("exclude"), { filter: JSON.stringify({ field: "Loại", op: "eq", value: "DCC" }) });
    // Only 3 DCC rows: fewer than 4 values, no bounds, nothing is dropped.
    expect(f.rows[0].value).toBe(420);
    expect(f.diagnostics.outliers).toBeNull();
    const call = await run({ name: "i", source: x.tableId, measure: { agg: "sum", field: "Tiền" } }, { outliers: JSON.stringify({ mode: "exclude" }) });
    expect(call.rows[0].value).toBe(sum(inside.map((p) => p.money)));
    expect((await fails(run({ name: "i", source: x.tableId, measure: { agg: "count" }, outliers: { mode: "exclude" } }))).details.reason).toBe("bad_outliers");
    expect((await fails(run({ name: "i", source: x.tableId, measure: { agg: "count", field: "Tên" }, outliers: { mode: "exclude" } }))).details.reason).toBe("bad_outliers");
  });
});
