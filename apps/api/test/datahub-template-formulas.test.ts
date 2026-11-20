import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 4.2 part 4: a formula of a person's own table (an Index copy, a table they made in their Quản lý Deal) reads a template table of someone else
 * (the shared Deals) as THAT PERSON reads it: their rows under the split lock and their own person cells (design module4 19 work 5, 9).
 * Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. Tree B: MgrB > LeaderB > UserB1.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let userB1: ReturnType<typeof as>;
let deals: { id: string; master_table_id: string };
let index: { id: string; master_table_id: string };
const key: Record<string, string> = {};
const rid: Record<string, string> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });

const myTable = async (call: ReturnType<typeof as>, tplName: string) => (await call("datahub.template.list")).find((x: { name: string }) => x.name === tplName)!.my_table_id as string;
/** The only row of a person's own Index copy: its computed cells by column name. */
async function indexRow(call: ReturnType<typeof as>, tableId: string) {
  const t2 = await call("datahub.table.get", { table_id: tableId });
  const r = (await call("datahub.row.list", { table_id: tableId, limit: 10 })).items[0] as { data: Record<string, unknown> };
  return Object.fromEntries((t2.columns as { key: string; name: string }[]).map((c) => [c.name, r.data[c.key]]));
}

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.leaderB, org.mgrA, org.mgrB]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  userB1 = as(t, org.userB1.id);
  deals = await mgrA("datahub.template.create", { name: "Deals", kind: "shared", member_permission: "edit_data" });
  const dcol = async (name: string, type: string, extra: Record<string, unknown> = {}) => {
    const c = await mgrA("datahub.template.column.create", { template_id: deals.id, name, type, ...extra });
    key[name] = c.key;
  };
  await dcol("Tên", "text");
  await dcol("Doanh thu", "number");
  await dcol("Trạng thái", "single_select", { config: { options: [{ name: "Processing", meaning: "open" }, { name: "Won", meaning: "won" }] } });
  await dcol("Người tham gia", "user", { config: { attrs: [{ key: "ty_le_dt", label: "% doanh thu", kind: "percent", default: 0 }] } });
  await dcol("% doanh thu của tôi", "percent", { storage: "person", autofill: { column: "Người tham gia", attr: "ty_le_dt" } });
  await mgrA("datahub.table.share_options.set", { table_id: deals.master_table_id, key_split: true, key_columns: ["Người tham gia"] });
  index = await mgrA("datahub.template.create", { name: "Index", kind: "personal" });
  const icol = async (name: string, type: string, extra: Record<string, unknown> = {}) => {
    await mgrA("datahub.template.column.create", { template_id: index.id, name, type, ...extra });
  };
  await icol("Tháng", "text");
  await icol("Doanh thu tôi thấy", "formula", { config: { formula: "=SUM([Deals].[Doanh thu])" } });
  await icol("Số deal tôi thấy", "formula", { config: { formula: "=COUNTA([Deals].[Tên])" } });
  await icol("Phần của tôi", "formula", { config: { formula: "=SUM([Deals].[% doanh thu của tôi])" } });
  await icol("Số Won", "formula", { config: { formula: '=COUNTIFS([Deals].[Trạng thái], "Won")' } });
  const mk = async (name: string, rev: number, people: unknown, status = "Processing") => {
    rid[name] = (await mgrA("datahub.row.create", { table_id: deals.master_table_id, data: { Tên: name, "Doanh thu": rev, "Trạng thái": status, "Người tham gia": people } })).id;
  };
  await mk("d1", 100, [person(org.userA1.id, { ty_le_dt: 0.6 }), person(org.userA2.id, { ty_le_dt: 0.4 })], "Won");
  await mk("d2", 200, [person(org.userA2.id, { ty_le_dt: 1 })]);
  await mk("d3", 50, [person(org.leaderA.id, { ty_le_dt: 0.5 })]);
  for (const call of [mgrA, leaderA, userA1, userA2]) await call("datahub.row.create", { table_id: await myTable(call, "Index"), data: { Tháng: "2026-11" } });
  await drainOutbox(t);
});
afterAll(async () => {
  await t.close();
});

describe("an Index copy reads the shared Deals as its owner reads it", () => {
  it("each person gets the totals over the deals THEY see, and their own person values", async () => {
    const a1 = await indexRow(userA1, await myTable(userA1, "Index"));
    expect(a1["Doanh thu tôi thấy"]).toBe(100);
    expect(a1["Số deal tôi thấy"]).toBe(1);
    expect(a1["Phần của tôi"]).toBeCloseTo(0.6, 9);
    expect(a1["Số Won"]).toBe(1);
    const a2 = await indexRow(userA2, await myTable(userA2, "Index"));
    expect(a2["Doanh thu tôi thấy"]).toBe(300);
    expect(a2["Số deal tôi thấy"]).toBe(2);
    expect(a2["Phần của tôi"]).toBeCloseTo(1.4, 9);
    // LeaderA sees UserA1's deal (d1) and their own (d3); the Manager sees all three, and has no share of their own.
    const l = await indexRow(leaderA, await myTable(leaderA, "Index"));
    expect([l["Doanh thu tôi thấy"], l["Số deal tôi thấy"]]).toEqual([150, 2]);
    expect(l["Phần của tôi"]).toBeCloseTo(0.5, 9);
    const m = await indexRow(mgrA, await myTable(mgrA, "Index"));
    expect([m["Doanh thu tôi thấy"], m["Số deal tôi thấy"], m["Phần của tôi"]]).toEqual([350, 3, 0]);
  });

  it("a change in Deals reaches only the people it concerns", async () => {
    const d2 = await mgrA("datahub.row.get", { table_id: deals.master_table_id, row_id: rid["d2"]! });
    await mgrA("datahub.row.update", { table_id: deals.master_table_id, row_id: rid["d2"]!, version: d2.version, data: { "Doanh thu": 500 } });
    await drainOutbox(t);
    expect((await indexRow(userA2, await myTable(userA2, "Index")))["Doanh thu tôi thấy"]).toBe(600);
    expect((await indexRow(userA1, await myTable(userA1, "Index")))["Doanh thu tôi thấy"]).toBe(100);
    expect((await indexRow(mgrA, await myTable(mgrA, "Index")))["Doanh thu tôi thấy"]).toBe(650);
  });

  it("moving a person in or out of a deal changes what they see and their share", async () => {
    const d1 = await mgrA("datahub.row.get", { table_id: deals.master_table_id, row_id: rid["d1"]! });
    await mgrA("datahub.row.update", { table_id: deals.master_table_id, row_id: rid["d1"]!, version: d1.version, data: { "Người tham gia": [person(org.userA1.id, { ty_le_dt: 1 })] } });
    await drainOutbox(t);
    const a2 = await indexRow(userA2, await myTable(userA2, "Index"));
    expect([a2["Doanh thu tôi thấy"], a2["Số deal tôi thấy"], a2["Phần của tôi"]]).toEqual([500, 1, 1]);
    const a1 = await indexRow(userA1, await myTable(userA1, "Index"));
    expect(a1["Phần của tôi"]).toBeCloseTo(1, 9);
  });

  it("renaming a status option by the Manager rewrites the formulas of everyone who reads it", async () => {
    const cur = (await mgrA("datahub.template.get", { template_id: deals.id })).columns.find((c: { name: string }) => c.name === "Trạng thái");
    const opts = (cur.config.options as { id: string; name: string; meaning: string }[]).map((o) => (o.name === "Won" ? { ...o, name: "Đã thắng" } : o));
    await mgrA("datahub.template.column.update", { template_id: deals.id, column: "Trạng thái", config: { options: opts }, update_formulas: true });
    await drainOutbox(t);
    expect((await indexRow(userA1, await myTable(userA1, "Index")))["Số Won"]).toBe(1);
    const f = await t.c.db.db.execute(sql`SELECT c.config->>'expr' AS expr FROM dh_columns c JOIN dh_tables tb ON tb.id = c.table_id JOIN dh_datahubs d ON d.id = tb.datahub_id
      WHERE /*scope:system*/ d.owner_id = ${org.userA1.id}::uuid AND c.name = 'Số Won' AND c.deleted_at IS NULL`);
    expect(JSON.stringify(f.rows)).toContain("Đã thắng");
  });
});

describe("a table the person made in their Quản lý Deal reads Deals too", () => {
  it("a formula in an own table reads [Deals] as that person; the other tree cannot", async () => {
    const dh = ((await t.c.db.db.execute(sql`SELECT id FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${org.userA1.id}::uuid AND system_key = 'deal'`)).rows[0] as { id: string }).id;
    const tb = await userA1("datahub.table.create", { datahub_id: dh, name: "Của tôi" });
    await userA1("datahub.column.create", { table_id: tb.id, name: "Ghi", type: "text" });
    const f = await userA1("datahub.column.create", { table_id: tb.id, name: "Tổng", type: "formula", config: { formula: "=SUM([Deals].[Doanh thu])" } });
    await userA1("datahub.row.create", { table_id: tb.id, data: { Ghi: "x" } });
    await drainOutbox(t);
    const r = (await userA1("datahub.row.list", { table_id: tb.id, limit: 5 })).items[0] as { data: Record<string, unknown> };
    expect(r.data[f.key]).toBe(100);
    // UserB1 is not a member of tree A's Deals: the formula cannot name it.
    const own = await userB1("datahub.datahub.create", { name: "Của B" });
    const tbB = await userB1("datahub.table.create", { datahub_id: own.id, name: "Bảng B" });
    expect((await fails(userB1("datahub.column.create", { table_id: tbB.id, name: "Lén", type: "formula", config: { formula: "=SUM([Deals].[Doanh thu])" } }))).code).toBe("validation_error");
  });
});
