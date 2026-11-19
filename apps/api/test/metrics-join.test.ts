import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 3A-1, joining tables (design module3 section 3): the diagnosis comes back every time, a table with several rows per key
 * is folded to one value first (so a number is never counted twice), a join with no match is an error that says how to fix it.
 */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
let dealsId: string;
let payId: string;
let dhId: string;
const deal: Record<string, string> = {};
const pay: Record<string, string> = {};

const DEALS = [
  { code: "D1", kind: "POD", value: 1000 },
  { code: "D2", kind: "POD", value: 500 },
  { code: "D3", kind: "DCC", value: 300 },
  { code: "D4", kind: "DCC", value: 200 }, // no payment
  { code: "D5", kind: "POD", value: 100 }, // no payment
  { code: "", kind: "POD", value: 77 }, // empty key
];
const PAYMENTS = [
  { code: "D1", amount: 100 },
  { code: "d1 ", amount: 200 }, // same key as D1 once trimmed and lower-cased
  { code: "D1", amount: 300 },
  { code: "D2", amount: 50 },
  { code: "D3", amount: 10 },
  { code: "X9", amount: 9999 }, // belongs to no deal
];

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
  const d = await makeTable(a, {
    columns: [
      { name: "Mã deal", type: "text" },
      { name: "Loại", type: "single_select", config: { options: [{ name: "POD" }, { name: "DCC" }] } },
      { name: "Giá trị", type: "number" },
    ],
  });
  dealsId = d.tableId;
  dhId = d.dhId;
  const p = await a("datahub.table.create", { datahub_id: dhId, name: "Thanh toán" });
  payId = p.id;
  for (const c of [{ name: "Mã deal", type: "text" }, { name: "Số tiền", type: "number" }]) await a("datahub.column.create", { table_id: payId, ...c });
  await a("datahub.column.create", { table_id: dealsId, name: "Các khoản", type: "relation", config: { target_table_id: payId } });
  const pr = await a("datahub.row.batch", { table_id: payId, ops: PAYMENTS.map((r) => ({ op: "create", data: { "Mã deal": r.code, "Số tiền": r.amount } })) });
  const ids = pr.results.map((r: { id: string }) => r.id);
  // Links: D1 -> three payments, D2 -> one, D3 -> none.
  const links: Record<string, string[]> = { D1: [ids[0], ids[1], ids[2]], D2: [ids[3]] };
  const dr = await a("datahub.row.batch", { table_id: dealsId, ops: DEALS.map((r) => ({ op: "create", data: { "Mã deal": r.code, Loại: r.kind, "Giá trị": r.value, ...(links[r.code] ? { "Các khoản": links[r.code] } : {}) } })) });
  DEALS.forEach((r, i) => (deal[r.code || "_empty"] = dr.results[i].id));
  PAYMENTS.forEach((r, i) => (pay[`${r.code.trim().toUpperCase()}${i}`] = pr.results[i].id));
}, 60_000);
afterAll(async () => {
  await t.close();
});

const byKey = { table: "Thanh toán", as: "TT", on: [{ left: "Mã deal", right: "Mã deal" }] };
const byLink = { table: "Thanh toán", as: "TT", link: "Các khoản" };
const run = (m: Record<string, unknown>, join: Record<string, unknown> = byKey, extra: Record<string, unknown> = {}) =>
  a("metrics.query", { datahub_id: dhId, metric: { name: "m", source: { table: "Bảng 1", joins: [join] }, ...m }, ...extra });

describe("join by key columns", () => {
  it("folds the many-rows table to one value per deal: sums are never counted twice", async () => {
    // Left join: every deal counts, D1 once (not three times). Same number as without the join.
    const base = await run({ measure: { agg: "sum", field: "Giá trị" } });
    expect(base.rows[0].value).toBe(1000 + 500 + 300 + 200 + 100 + 77);
    // The payments of a deal are summed first (D1: 600), then over the deals.
    const paid = await run({ measure: { agg: "sum", field: "TT.Số tiền" } });
    expect(paid.rows[0].value).toBe(600 + 50 + 10);
    const g = await run({ measure: { agg: "sum", field: "TT.Số tiền" }, group_by: ["Loại"] });
    const by = Object.fromEntries(g.rows.map((r: { groups: { label: string }[]; value: number }) => [r.groups[0]!.label, r.value]));
    expect(by).toEqual({ POD: 650, DCC: 10 });
    expect((await run({ measure: { agg: "count" } })).rows[0].value).toBe(6);
  });

  it("joining another table never changes a number measured on the base table (unmatched and many-rows deals included)", async () => {
    const plain = (m: Record<string, unknown>) => a("metrics.query", { datahub_id: dhId, metric: { name: "m", source: "Bảng 1", ...m } });
    const total = { measure: { agg: "sum", field: "Giá trị" } };
    const want = 1000 + 500 + 300 + 200 + 100 + 77;
    expect((await plain(total)).rows[0].value).toBe(want);
    expect((await run(total)).rows[0].value).toBe(want);
    expect((await run(total, byLink)).rows[0].value).toBe(want);
    expect((await run({ ...total, group_by: ["Loại"] })).rows.map((r: { value: number }) => r.value)).toEqual((await plain({ ...total, group_by: ["Loại"] })).rows.map((r: { value: number }) => r.value));
    for (const agg of ["count", "avg", "max", "median"]) {
      const m = agg === "count" ? { measure: { agg } } : { measure: { agg, field: "Giá trị" } };
      expect((await run(m)).rows[0].value).toBe((await plain(m)).rows[0].value);
    }
  });

  it("a deal without a partner has empty joined columns", async () => {
    const r = await run({ measure: { agg: "count", field: "TT.Số tiền" } });
    expect(r.rows[0].value).toBe(3); // only D1, D2, D3 have an amount
    const g = await run({ measure: { agg: "count" }, group_by: ["TT.Số tiền"] });
    expect(g.rows.some((x: { groups: { label: string }[] }) => x.groups[0]!.label === "(Trống)")).toBe(true);
  });

  it("the diagnosis comes with every answer", async () => {
    const r = await run({ measure: { agg: "count" } });
    expect(r.diagnostics.joins).toEqual([
      expect.objectContaining({ alias: "TT", table: "Thanh toán", kind: "key", base_total: 6, matched: 3, unmatched: 3, empty_key: 1, duplicate_groups: 1, duplicate_rows: 3, folded: true }),
    ]);
    expect(r.diagnostics.joins[0].duplicate_sample).toEqual(["d1"]);
    const d = await a("metrics.source.diagnose", { datahub_id: dhId, source: { table: "Bảng 1", joins: [byKey] } });
    expect(d.joins[0]).toMatchObject({ matched: 3, unmatched: 3 });
  });

  it("lists the deals that did not match, by row number", async () => {
    const u = await a("metrics.source.unmatched", { datahub_id: dhId, source: { table: "Bảng 1", joins: [byKey] } });
    expect(u.total).toBe(3);
    expect(u.items.map((x: { id: string }) => x.id)).toEqual([deal.D4, deal.D5, deal._empty]);
    const page = await a("metrics.source.unmatched", { datahub_id: dhId, source: { table: "Bảng 1", joins: [byKey] }, limit: 1, offset: 1 });
    expect(page.items.map((x: { id: string }) => x.id)).toEqual([deal.D5]);
    expect(page.total).toBe(3);
  });

  it("collapse picks how the many rows fold: max, count, first, last", async () => {
    const c = (collapse: Record<string, string>, agg = "sum") => run({ measure: { agg, field: "TT.Số tiền" } }, { ...byKey, collapse });
    expect((await c({ "Số tiền": "max" })).rows[0].value).toBe(300 + 50 + 10);
    expect((await c({ "Số tiền": "count" })).rows[0].value).toBe(3 + 1 + 1);
    expect((await c({ "Số tiền": "first" })).rows[0].value).toBe(100 + 50 + 10);
    expect((await c({ "Số tiền": "last" })).rows[0].value).toBe(300 + 50 + 10);
    expect((await c({ "Số tiền": "avg" }, "max")).rows[0].value).toBe(200);
    // A collapse of a column the metric does not read changes nothing.
    expect((await c({ "Mã deal": "sum" })).rows[0].value).toBe(660);
  }, 20_000);

  it("filters and groups on joined columns (after folding)", async () => {
    const big = await run({ measure: { agg: "count" }, filter: { field: "TT.Số tiền", op: "gt", value: 100 } });
    expect(big.rows[0].value).toBe(1); // only D1 (600)
    const g = await run({ measure: { agg: "count" }, group_by: ["TT.Mã deal"] });
    expect(g.rows).toHaveLength(4); // D1, D2, D3 and the deals without payment
  });

  it("0 rows matched is an error with the diagnosis and a hint", async () => {
    const e = await fails(run({ measure: { agg: "count" } }, { table: "Thanh toán", as: "TT", on: [{ left: "Loại", right: "Mã deal" }] }));
    expect(e.code).toBe("validation_error");
    expect(e.details.reason).toBe("join_no_match");
    expect(e.details.join).toMatchObject({ base_total: 6, matched: 0 });
    expect(e.details.hint).toContain("khoá");
  });

  it("refuses a bad join with the reason", async () => {
    expect((await fails(run({ measure: { agg: "count" } }, { table: "Thanh toán", on: [{ left: "Không có", right: "Mã deal" }] }))).details.reason).toBe("bad_join");
    expect((await fails(run({ measure: { agg: "count" } }, { table: "Không có bảng" }))).code).toBe("validation_error"); // neither link nor on
    expect((await fails(run({ measure: { agg: "count" } }, { table: "Không có bảng", on: [{ left: "Mã deal", right: "x" }] }))).details.reason).toBe("join_table_not_found");
    expect((await fails(run({ measure: { agg: "sum", field: "TT.Không có" } }))).details.reason).toBe("unknown_column");
    expect((await fails(run({ measure: { agg: "sum", field: "TT.Mã deal" } }))).details.reason).toBe("bad_measure");
    expect((await fails(run({ measure: { agg: "sum", field: "TT._created_at" } }))).details.reason).toBe("unsupported_column");
    expect((await fails(run({ measure: { agg: "count", field: "TT.Mã deal" } }, { ...byKey, collapse: { "Mã deal": "sum" } }))).details.reason).toBe("bad_collapse");
  });

  it("a joined table of another datahub is refused", async () => {
    const other = await makeTable(a, { name: "Khác", columns: [{ name: "Mã deal", type: "text" }] });
    const e = await fails(run({ measure: { agg: "count" } }, { table: other.tableId, on: [{ left: "Mã deal", right: "Mã deal" }] }));
    expect(e.details.reason).toBe("cross_datahub");
  });
});

describe("join by a relation column", () => {
  it("folds the linked rows of each deal and reports the deals linked to several rows", async () => {
    const r = await run({ measure: { agg: "sum", field: "TT.Số tiền" } }, byLink);
    expect(r.rows[0].value).toBe(600 + 50); // D1 (3 links) and D2 (1 link); D3 has no link
    expect((await run({ measure: { agg: "sum", field: "Giá trị" } }, byLink)).rows[0].value).toBe(1000 + 500 + 300 + 200 + 100 + 77);
    expect(r.diagnostics.joins[0]).toMatchObject({ kind: "link", base_total: 6, matched: 2, unmatched: 4, duplicate_groups: 1, duplicate_rows: 3, folded: true });
  });

  it("lists the deals without a link", async () => {
    const u = await a("metrics.source.unmatched", { datahub_id: dhId, source: { table: "Bảng 1", joins: [byLink] } });
    expect(u.items.map((x: { id: string }) => x.id)).toEqual([deal.D3, deal.D4, deal.D5, deal._empty]);
  });

  it("refuses a link column that points to another table, or a column that is not a link", async () => {
    expect((await fails(run({ measure: { agg: "count" } }, { table: "Thanh toán", link: "Giá trị" }))).details.reason).toBe("bad_join");
    const t2 = await a("datahub.table.create", { datahub_id: dhId, name: "Khác bảng" });
    await a("datahub.column.create", { table_id: t2.id, name: "x", type: "text" });
    const e = await fails(run({ measure: { agg: "count" } }, { table: t2.id, link: "Các khoản" }));
    expect(e.details.reason).toBe("bad_join");
  });

  it("no link at all gives join_no_match", async () => {
    const empty = await a("datahub.table.create", { datahub_id: dhId, name: "Trống" });
    await a("datahub.column.create", { table_id: empty.id, name: "k", type: "text" });
    await a("datahub.column.create", { table_id: empty.id, name: "Liên kết", type: "relation", config: { target_table_id: dealsId } });
    await a("datahub.row.create", { table_id: empty.id, data: { k: "1" } });
    const e = await fails(a("metrics.query", { datahub_id: dhId, metric: { name: "m", source: { table: "Trống", joins: [{ table: "Bảng 1", link: "Liên kết" }] }, measure: { agg: "count" } } }));
    expect(e.details.reason).toBe("join_no_match");
  });
});

describe("saved sources", () => {
  it("a saved source is used by a metric by name or by id; the metric reads the same numbers", async () => {
    const src = await a("metrics.source.create", { datahub_id: dhId, source: { name: "Deal + thanh toán", table: "Bảng 1", joins: [byKey] } });
    expect(src.table_ids).toHaveLength(2);
    const byName = await a("metrics.query", { datahub_id: dhId, metric: { name: "m", source: "Deal + thanh toán", measure: { agg: "sum", field: "TT.Số tiền" } } });
    const byId = await a("metrics.query", { metric: { name: "m", source: src.id, measure: { agg: "sum", field: "TT.Số tiền" } } });
    expect(byName.rows[0].value).toBe(660);
    expect(byId.rows[0].value).toBe(660);
    const saved = await a("metrics.metric.create", { datahub_id: dhId, metric: { name: "Đã thu", source: src.id, measure: { agg: "sum", field: "TT.Số tiền" }, group_by: ["Loại"] } });
    expect((await a("metrics.query", { metric_id: saved.id })).rows).toHaveLength(2);
    expect((await a("metrics.source.get", { source_id: src.id })).definition).toMatchObject({ table: "Bảng 1" });
    expect((await a("metrics.source.list", { datahub_id: dhId })).items.map((s: { id: string }) => s.id)).toContain(src.id);
  });

  it("a source needs a name and a valid join; a metric on a missing source or column is refused when saved", async () => {
    expect((await fails(a("metrics.source.create", { datahub_id: dhId, source: { table: "Bảng 1" } }))).details.reason).toBe("name_required");
    expect((await fails(a("metrics.source.create", { datahub_id: dhId, source: { name: "xấu", table: "Bảng 1", joins: [{ table: "Thanh toán", link: "Giá trị" }] } }))).details.reason).toBe("bad_join");
    expect((await fails(a("metrics.metric.create", { datahub_id: dhId, metric: { name: "xấu", source: "Không có", measure: { agg: "count" } } }))).code).toBe("not_found");
    expect((await fails(a("metrics.metric.create", { datahub_id: dhId, metric: { name: "xấu", source: "Bảng 1", measure: { agg: "sum", field: "Giá" } } }))).details.reason).toBe("unknown_column");
  });
});
