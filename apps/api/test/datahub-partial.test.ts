import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";

/**
 * Partial recalculation (design module2 section 6.7). The proof that only the affected rows were recomputed: a cell of an
 * UNRELATED row is damaged by hand before the change; after the worker has run it must still be damaged (a full-column
 * recomputation would have repaired it), while every affected row has the right value.
 */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
let admin: pg.Client;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
  admin = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await admin.connect();
});
afterAll(async () => {
  await admin.end();
  await t.close();
});

const q = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows as Record<string, unknown>[];
const tamper = (rowId: string, key: string) => q(`UPDATE dh_rows SET data = jsonb_set(data, $2::text[], '-999') WHERE id = $1`, [rowId, `{${key}}`]);
const partial = (n = 1) => drainOutbox(t, { maxRatio: n });

async function rowsOf(tableId: string) {
  return ((await a("datahub.row.list", { table_id: tableId, limit: 500 })).items as { id: string; version: number; data: Record<string, unknown> }[]);
}

/** Customers (Mã) with SUMIFS / COUNTIFS / XLOOKUP over Deals (Mã KH, Doanh thu, Tên). */
async function scenario() {
  const cust = await makeTable(a, { columns: [{ name: "Mã", type: "text" }] });
  const deals = await a("datahub.table.create", { datahub_id: cust.dhId, name: "Deals" });
  for (const [name, type] of [["Mã KH", "text"], ["Doanh thu", "number"], ["Tên", "text"]] as const) await a("datahub.column.create", { table_id: deals.id, name, type });
  const f = async (name: string, formula: string) => (await a("datahub.column.create", { table_id: cust.tableId, name, type: "formula", config: { formula } })).key as string;
  const sum = await f("Tổng", "=SUMIFS([Deals].[Doanh thu], [Deals].[Mã KH], [Mã])");
  const cnt = await f("Số", "=COUNTIFS([Deals].[Mã KH], [Mã])");
  const first = await f("Đầu", "=XLOOKUP([Mã], [Deals].[Mã KH], [Deals].[Tên], \"-\")");
  const custRows: Record<string, { id: string }> = {};
  for (const m of ["KH1", "KH2", "KH3", "KH4"]) custRows[m] = await a("datahub.row.create", { table_id: cust.tableId, data: { Mã: m } });
  const d = (m: string, v: number, n: string) => a("datahub.row.create", { table_id: deals.id, data: { "Mã KH": m, "Doanh thu": v, Tên: n } });
  const d1 = await d("KH1", 100, "d1");
  const d2 = await d("KH1", 50, "d2");
  const d3 = await d("KH2", 70, "d3");
  await drainOutbox(t);
  return { cust, deals, keys: { sum, cnt, first }, custRows, d1, d2, d3, d };
}

async function read(s: Awaited<ReturnType<typeof scenario>>) {
  const mk = (await a("datahub.table.get", { table_id: s.cust.tableId })).columns.find((c: { name: string }) => c.name === "Mã").key as string;
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of await rowsOf(s.cust.tableId)) out[String(r.data[mk])] = { sum: r.data[s.keys.sum], cnt: r.data[s.keys.cnt], first: r.data[s.keys.first] };
  return out;
}

describe("only the affected rows are recomputed (grouped calls)", () => {
  it("an amount edit recomputes the group of that key only", async () => {
    const s = await scenario();
    expect((await read(s))["KH1"]).toEqual({ sum: 150, cnt: 2, first: "d1" });
    await tamper(s.custRows["KH3"]!.id, s.keys.sum);
    await tamper(s.custRows["KH2"]!.id, s.keys.sum); // KH2 is not touched by the edit either
    await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d1.id, data: { "Doanh thu": 400 }, version: s.d1.version });
    await partial();
    const r = await read(s);
    expect(r["KH1"]).toEqual({ sum: 450, cnt: 2, first: "d1" });
    expect(r["KH3"]!.sum).toBe(-999); // not recomputed
    expect(r["KH2"]!.sum).toBe(-999);
    // A whole-column recomputation repairs them (and proves the damage was real).
    await a("datahub.column.update", { table_id: s.cust.tableId, column: s.keys.sum, config: { formula: "=SUMIFS([Deals].[Doanh thu], [Deals].[Mã KH], [Mã])" } });
    await partial();
    expect((await read(s))["KH3"]!.sum).toBe(0);
  });

  it("a key change recomputes the OLD and the NEW group (the old value comes from the write itself)", async () => {
    const s = await scenario();
    await tamper(s.custRows["KH3"]!.id, s.keys.cnt);
    await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d3.id, data: { "Mã KH": "KH4" }, version: s.d3.version }); // KH2 -> KH4
    await partial();
    const r = await read(s);
    expect(r["KH2"]).toEqual({ sum: 0, cnt: 0, first: "-" });
    expect(r["KH4"]).toEqual({ sum: 70, cnt: 1, first: "d3" });
    expect(r["KH1"]).toEqual({ sum: 150, cnt: 2, first: "d1" });
    expect(r["KH3"]!.cnt).toBe(-999);
  });

  it("insert, delete and restore of a source row", async () => {
    const s = await scenario();
    await tamper(s.custRows["KH3"]!.id, s.keys.sum);
    const n = await s.d("KH4", 9, "d9");
    await partial();
    expect((await read(s))["KH4"]).toEqual({ sum: 9, cnt: 1, first: "d9" });
    await a("datahub.row.delete", { table_id: s.deals.id, row_id: n.id });
    await partial();
    expect((await read(s))["KH4"]).toEqual({ sum: 0, cnt: 0, first: "-" });
    await a("datahub.row.restore", { table_id: s.deals.id, row_id: n.id });
    await partial();
    expect((await read(s))["KH4"]).toEqual({ sum: 9, cnt: 1, first: "d9" });
    expect((await read(s))["KH3"]!.sum).toBe(-999);
  });

  it("keys that are equal for the engine (case, numeric text, spaces) are the same group", async () => {
    const s = await scenario();
    await a("datahub.row.create", { table_id: s.cust.tableId, data: { Mã: "00123" } });
    await a("datahub.row.create", { table_id: s.cust.tableId, data: { Mã: "ab Á" } });
    await drainOutbox(t);
    await s.d(" 123 ", 5, "x1");
    await s.d("AB á", 6, "x2");
    await partial();
    const r = await read(s);
    expect(r["00123"]).toEqual({ sum: 5, cnt: 1, first: "x1" });
    expect(r["ab Á"]).toEqual({ sum: 6, cnt: 1, first: "x2" });
  });

  it("unchanged cells are neither written nor announced; version and updated_at never move", async () => {
    const s = await scenario();
    const before = await rowsOf(s.cust.tableId);
    const ev0 = Number((await q(`SELECT count(*) FROM outbox WHERE event = 'datahub.formula.recalculated' AND payload->>'state' = 'changed' AND payload->>'table_id' = $1`, [s.cust.tableId]))[0]!.count);
    // The deal's name is read by XLOOKUP only for the first row of each key: renaming d2 changes nothing for anyone.
    await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d2.id, data: { Tên: "d2b" }, version: s.d2.version });
    await partial();
    const after = await rowsOf(s.cust.tableId);
    expect(after.map((r) => [r.id, r.version, r.data])).toEqual(before.map((r) => [r.id, r.version, r.data]));
    const ev1 = Number((await q(`SELECT count(*) FROM outbox WHERE event = 'datahub.formula.recalculated' AND payload->>'state' = 'changed' AND payload->>'table_id' = $1`, [s.cust.tableId]))[0]!.count);
    expect(ev1).toBe(ev0);
  });

  it("falls back to the whole column when a read is not an equality group on a plain column", async () => {
    const x = await makeTable(a, { columns: [{ name: "Mã", type: "text" }, { name: "Năm", type: "number" }] });
    const src = await a("datahub.table.create", { datahub_id: x.dhId, name: "Nguồn" });
    for (const [name, type] of [["Mã", "text"], ["Năm", "number"], ["Tiền", "number"]] as const) await a("datahub.column.create", { table_id: src.id, name, type });
    const f = await a("datahub.column.create", { table_id: x.tableId, name: "T", type: "formula", config: { formula: '=SUMIFS([Nguồn].[Tiền], [Nguồn].[Mã], [Mã] & "-" & [Năm])' } });
    const r1 = await a("datahub.row.create", { table_id: x.tableId, data: { Mã: "A", Năm: 1 } });
    const r2 = await a("datahub.row.create", { table_id: x.tableId, data: { Mã: "B", Năm: 2 } });
    await drainOutbox(t);
    await tamper(r2.id, f.key);
    const s1 = await a("datahub.row.create", { table_id: src.id, data: { Mã: "A-1", Năm: 1, Tiền: 7 } });
    void s1;
    await partial();
    const rows = await rowsOf(x.tableId);
    expect(rows.find((r) => r.id === r1.id)!.data[f.key]).toBe(7);
    expect(rows.find((r) => r.id === r2.id)!.data[f.key]).toBe(0); // the whole column was recomputed, the damage is gone
  });

  it("above 20% of the table the whole column is recomputed", async () => {
    const s = await scenario(); // 4 customers; the edit touches 1 (25%)
    await tamper(s.custRows["KH3"]!.id, s.keys.sum);
    await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d1.id, data: { "Doanh thu": 1 }, version: s.d1.version });
    await drainOutbox(t); // default ratio 0.2
    const r = await read(s);
    expect(r["KH1"]!.sum).toBe(51);
    expect(r["KH3"]!.sum).toBe(0);
  });
});

describe("relations, lookups and rollups: reverse lookup through the GIN index", () => {
  it("a changed target row recomputes only the rows that link to it", async () => {
    const cust = await makeTable(a, { columns: [{ name: "Tên", type: "text" }, { name: "Hạng", type: "number" }] });
    const deals = await a("datahub.table.create", { datahub_id: cust.dhId, name: "Deals" });
    await a("datahub.column.create", { table_id: deals.id, name: "Tên deal", type: "text" });
    await a("datahub.column.create", { table_id: deals.id, name: "KH", type: "relation", config: { target_table_id: cust.tableId, multiple: true } });
    const look = await a("datahub.column.create", { table_id: deals.id, name: "Tên KH", type: "lookup", config: { relation: "KH", target_column: "Tên" } });
    const roll = await a("datahub.column.create", { table_id: deals.id, name: "Tổng hạng", type: "rollup", config: { relation: "KH", target_column: "Hạng", fn: "sum" } });
    const c1 = await a("datahub.row.create", { table_id: cust.tableId, data: { Tên: "A", Hạng: 1 } });
    const c2 = await a("datahub.row.create", { table_id: cust.tableId, data: { Tên: "B", Hạng: 2 } });
    const d1 = await a("datahub.row.create", { table_id: deals.id, data: { "Tên deal": "d1", KH: [c1.id] } });
    const d2 = await a("datahub.row.create", { table_id: deals.id, data: { "Tên deal": "d2", KH: [c1.id, c2.id] } });
    const d3 = await a("datahub.row.create", { table_id: deals.id, data: { "Tên deal": "d3", KH: [c2.id] } });
    await partial();
    expect((await rowsOf(deals.id)).map((r) => r.data[roll.key])).toEqual([1, 3, 2]);
    await tamper(d3.id, roll.key);
    await a("datahub.row.update", { table_id: cust.tableId, row_id: c1.id, data: { Hạng: 10, Tên: "A2" }, version: c1.version });
    await partial();
    const rows = await rowsOf(deals.id);
    expect(rows.find((r) => r.id === d1.id)!.data).toMatchObject({ [roll.key]: 10, [look.key]: "A2" });
    expect(rows.find((r) => r.id === d2.id)!.data).toMatchObject({ [roll.key]: 12 });
    expect(rows.find((r) => r.id === d3.id)!.data[roll.key]).toBe(-999); // links only c2: untouched
    // Deleting the target row empties its rows' values; restoring brings them back.
    await a("datahub.row.delete", { table_id: cust.tableId, row_id: c1.id });
    await partial();
    expect((await rowsOf(deals.id)).find((r) => r.id === d1.id)!.data[roll.key]).toBe(0);
    await a("datahub.row.restore", { table_id: cust.tableId, row_id: c1.id });
    await partial();
    expect((await rowsOf(deals.id)).find((r) => r.id === d1.id)!.data[roll.key]).toBe(10);
    // Editing the relation cell recomputes that row (and only that row).
    await tamper(d3.id, roll.key);
    const cur = (await rowsOf(deals.id)).find((r) => r.id === d1.id)!;
    await a("datahub.row.update", { table_id: deals.id, row_id: d1.id, data: { KH: [c2.id] }, version: cur.version });
    await partial();
    const rows2 = await rowsOf(deals.id);
    expect(rows2.find((r) => r.id === d1.id)!.data[roll.key]).toBe(2);
    expect(rows2.find((r) => r.id === d3.id)!.data[roll.key]).toBe(-999);
  });
});

describe("chains: the change list of one column is the input of the next", () => {
  it("B groups over A's computed column; C groups over B; only the touched keys move", async () => {
    // Table P (Mã, Tiền) -> Q: per Mã SUM of Tiền (formula in Q) -> R: per Nhóm SUM of Q's sum.
    const q1 = await makeTable(a, { columns: [{ name: "Mã", type: "text" }, { name: "Nhóm", type: "text" }] });
    const p = await a("datahub.table.create", { datahub_id: q1.dhId, name: "P" });
    for (const [name, type] of [["Mã", "text"], ["Tiền", "number"]] as const) await a("datahub.column.create", { table_id: p.id, name, type });
    const r = await a("datahub.table.create", { datahub_id: q1.dhId, name: "R" });
    await a("datahub.column.create", { table_id: r.id, name: "Nhóm", type: "text" });
    const sumQ = await a("datahub.column.create", { table_id: q1.tableId, name: "Tổng", type: "formula", config: { formula: "=SUMIFS([P].[Tiền], [P].[Mã], [Mã])" } });
    const sumR = await a("datahub.column.create", { table_id: r.id, name: "Tổng nhóm", type: "formula", config: { formula: '=SUMIFS([Bảng 1].[Tổng], [Bảng 1].[Nhóm], [Nhóm])' } });
    const qa = await a("datahub.row.create", { table_id: q1.tableId, data: { Mã: "a", Nhóm: "G1" } });
    await a("datahub.row.create", { table_id: q1.tableId, data: { Mã: "b", Nhóm: "G1" } });
    await a("datahub.row.create", { table_id: q1.tableId, data: { Mã: "c", Nhóm: "G2" } });
    const g1 = await a("datahub.row.create", { table_id: r.id, data: { Nhóm: "G1" } });
    const g2 = await a("datahub.row.create", { table_id: r.id, data: { Nhóm: "G2" } });
    const g3 = await a("datahub.row.create", { table_id: r.id, data: { Nhóm: "G3" } });
    const pa = await a("datahub.row.create", { table_id: p.id, data: { Mã: "a", Tiền: 5 } });
    await a("datahub.row.create", { table_id: p.id, data: { Mã: "c", Tiền: 7 } });
    await partial();
    const read = async () => Object.fromEntries((await rowsOf(r.id)).map((x) => [x.id, x.data[sumR.key]]));
    expect(await read()).toEqual({ [g1.id]: 5, [g2.id]: 7, [g3.id]: 0 });
    await tamper(g3.id, sumR.key);
    await a("datahub.row.update", { table_id: p.id, row_id: pa.id, data: { Tiền: 50 }, version: pa.version });
    await partial();
    expect(await read()).toEqual({ [g1.id]: 50, [g2.id]: 7, [g3.id]: -999 });
    // moving customer "a" to another group moves its sum from G1 to G2 (old and new keys of the chain)
    await a("datahub.row.update", { table_id: q1.tableId, row_id: qa.id, data: { Nhóm: "G2" }, version: (await rowsOf(q1.tableId))[0]!.version });
    await partial();
    expect(await read()).toEqual({ [g1.id]: 0, [g2.id]: 57, [g3.id]: -999 });
    void sumQ;
  });
});
