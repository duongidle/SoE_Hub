import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Stage 4.6E: the people of a deal can be laid out three ways and only formulas change (Dương 22/11/2026; module4 4.1 "Sửa 22/11/2026").
 * (a) default: one column `Người tham gia` with attributes; (b) two columns Leading / Associate, each with attributes; (c) four columns
 * (Leading, Leading %, Associate, Associate %) with the "của tôi" formulas rewritten using ME(). No code changes between the layouts: the money commands
 * (`payment.schedule`, `payment.confirm`) read the people from every column that holds the role `nguoi_tham_gia` and each person's share from that
 * person's own `... của tôi` columns. Invented figures only. Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
const tables: Record<string, string> = {};
let dealsTpl = "";
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const settle = async () => {
  await drainOutbox(t);
  await processPendingColumns(t.c.db.db);
  await drainOutbox(t);
};
const names = async (call: ReturnType<typeof as>, table: string) => Object.fromEntries(((await call("datahub.table.get", { table_id: table })).columns as { key: string; name: string }[]).map((c) => [c.name, c.key]));
/** One row by column name. */
async function row(call: ReturnType<typeof as>, table: string, id: string): Promise<Record<string, unknown>> {
  const r = await call("datahub.row.get", { table_id: table, row_id: id });
  const nm = await names(call, table);
  const byKey = Object.fromEntries(Object.entries(nm).map(([n, k]) => [k, n]));
  return Object.fromEntries(Object.entries(r.data as Record<string, unknown>).map(([k, v]) => [byKey[k] ?? k, v]));
}
const rowsOf = async (call: ReturnType<typeof as>, table: string): Promise<Record<string, unknown>[]> => {
  const nm = await names(call, table);
  const byKey = Object.fromEntries(Object.entries(nm).map(([n, k]) => [k, n]));
  const r = await call("datahub.row.list", { table_id: table, limit: 200 });
  return (r.items as { data: Record<string, unknown> }[]).map((x) => Object.fromEntries(Object.entries(x.data).map(([k, v]) => [byKey[k] ?? k, v])));
};
const ATTRS = [
  { key: "ty_le_com", label: "% com", kind: "percent", default: 0 },
  { key: "ty_le_dt", label: "% doanh thu", kind: "percent", default: 0 },
  { key: "tinh_deal", label: "Tính vào số deal", kind: "boolean", default: false },
];
const addCol = async (name: string, type: string, extra: Record<string, unknown> = {}) => mgrA("datahub.template.column.create", { template_id: dealsTpl, name, type, ...extra });
const setRole = (column: string, role: string | null) => mgrA("datahub.template.column.set_role", { template_id: dealsTpl, column, role });
const dealData = (name: string, extra: Record<string, unknown>) => ({ "Tên công ty": name, "Loại deal": "POD bán mới", "Start date": "2026-06-10", "Nguồn lead": "ML", "Level BC": "Level 1", "Performance BC": "KPI", ...extra });

/** Schedules, confirms and reads what the money commands wrote, plus what each person reads. */
async function pay(deal: string, tag: string) {
  await settle();
  const s = await mgrA("payment.schedule", { deal_id: deal, payments: [{ legal_entity: `CT ${tag}`, amount: 100_000_000, due: "2026-07-01" }] });
  const c = await mgrA("payment.confirm", { received_on: "2026-07-01", receipt: { amount: 100_000_000 }, allocations: [{ payment_id: s.payments[0].id, amount: 100_000_000 }] });
  await settle();
  return { payment: s.payments[0].id as string, confirm: c };
}
const ledgerOf = async (deal: string) => (await rowsOf(mgrA, tables["Sổ com"]!)).filter((r) => (r["Deal"] as string[] | undefined)?.[0] === deal);
const revenueOf = async (deal: string) => (await rowsOf(mgrA, tables["Doanh thu theo người"]!)).filter((r) => (r["Deal"] as string[] | undefined)?.[0] === deal);
const byUser = (rows: Record<string, unknown>[]) => Object.fromEntries(rows.map((r) => [r["Người"] as string, r]));

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  leaderA = as(t, org.leaderA.id);
  await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id);
  await drainOutbox(t);
  const list = await mgrA("datahub.template.list");
  for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = list.find((x: { name: string }) => x.name === d.name).master_table_id;
  dealsTpl = list.find((x: { name: string }) => x.name === "Deals").id;
  await mgrA("datahub.row.create", { table_id: tables["Chính sách com"]!, data: { "Hiệu lực từ": "2026-01-01", "Nguồn lead": "ML", Level: "Level 1", Performance: "KPI", "Tỉ lệ": 0.2 } });
  await mgrA("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2026-01-01", "Tên tham số": "Tỉ lệ SoE", "Giá trị": 0.5 } });
});
afterAll(async () => {
  await t.close();
});

const expectLines = async (deal: string, com: Record<string, number>, rev: Record<string, number>) => {
  const ledger = byUser(await ledgerOf(deal));
  const revenue = byUser(await revenueOf(deal));
  expect(Object.keys(ledger).sort()).toEqual(Object.keys(com).sort());
  for (const [u, v] of Object.entries(com)) expect(ledger[u]!["% com"] as number, `% com ${u}`).toBeCloseTo(v, 9);
  expect(Object.keys(revenue).sort()).toEqual(Object.keys(rev).sort());
  for (const [u, v] of Object.entries(rev)) expect(revenue[u]!["% doanh thu"] as number, `% doanh thu ${u}`).toBeCloseTo(v, 9);
};
/** Com dự kiến / tạm tính each person reads on the ledger: 100M x 20% x their %. */
const expectOwnCom = async (call: ReturnType<typeof as>, deal: string, pct: number) => {
  const mine = (await rowsOf(call, tables["Sổ com"]!)).filter((r) => (r["Deal"] as string[] | undefined)?.[0] === deal);
  expect(mine).toHaveLength(1);
  expect(mine[0]!["Com tạm tính của tôi"] as number).toBeCloseTo(100_000_000 * 0.2 * pct, 3);
};

/** The team columns: the Leader reads the total of their own team (LeaderA > UserA1), the Manager the total of everyone on the deal. */
const expectTeam = async (deal: string, team: { com: number; dt: number }, all: number) => {
  const l = await row(leaderA, tables["Deals"]!, deal);
  expect(l["% com của team"] as number, "% com của team").toBeCloseTo(team.com, 9);
  expect(l["% doanh thu của team"] as number, "% doanh thu của team").toBeCloseTo(team.dt, 9);
  expect((await row(mgrA, tables["Deals"]!, deal))["Tổng % com đã chia"] as number, "Tổng % com đã chia").toBeCloseTo(all, 9);
};

describe("(a) the default layout: one column with attributes", () => {
  let deal = "";
  it("the viewer columns give each person their own share; the commands write the right lines", async () => {
    deal = (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Bố trí A", { "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.15, ty_le_dt: 0.6, tinh_deal: true }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.05, ty_le_dt: 0.4 })] }) })).id;
    await settle();
    expect((await row(userA1, tables["Deals"]!, deal))["% Com cá nhân"]).toBeCloseTo(0.15, 9);
    expect((await row(userA2, tables["Deals"]!, deal))["% Com cá nhân"]).toBeCloseTo(0.05, 9);
    expect((await row(userA1, tables["Deals"]!, deal))["Vai trò của tôi"]).toBe("Leading");
    await pay(deal, "A");
    await expectLines(deal, { [org.userA1.id]: 0.15, [org.userA2.id]: 0.05 }, { [org.userA1.id]: 0.6, [org.userA2.id]: 0.4 });
    await expectOwnCom(userA1, deal, 0.15);
    await expectOwnCom(userA2, deal, 0.05);
    await expectTeam(deal, { com: 0.15, dt: 0.6 }, 0.2);
  });
  it("the split lock gives the deal to its people only", async () => {
    const only1 = (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Chỉ A1", { "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.1 })] }) })).id;
    await settle();
    expect((await row(userA1, tables["Deals"]!, only1))["Tên công ty"]).toBe("Chỉ A1");
    expect((await fails(userA2("datahub.row.get", { table_id: tables["Deals"]!, row_id: only1 }))).code).toMatch(/not_found|forbidden/);
  });
});

describe("(b) two columns Leading and Associate, each with attributes", () => {
  let deal = "";
  it("Manager only edits columns and formulas", async () => {
    await addCol("Leading", "user", { config: { attrs: ATTRS }, role: "nguoi_tham_gia" });
    await addCol("Associate", "user", { config: { attrs: ATTRS }, role: "nguoi_tham_gia" });
    await setRole("Người tham gia", null);
    await mgrA("datahub.table.share_options.set", { table_id: tables["Deals"]!, key_split: true, key_columns: ["Leading", "Associate"] });
    const mine = (attr: string, dflt: string) => `=IF(ISME([Leading]),ATTR([Leading],ME(),"${attr}"),IF(ISME([Associate]),ATTR([Associate],ME(),"${attr}"),${dflt}))`;
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "Vai trò của tôi", config: { formula: '=IF(ISME([Leading]),"Leading",IF(ISME([Associate]),"Associate",""))', result_type: "text" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "% doanh thu của tôi", config: { formula: mine("% doanh thu", "0"), result_type: "percent" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "% Com cá nhân", config: { formula: mine("% com", "0"), result_type: "percent" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "Tính vào số deal của tôi", config: { formula: '=IF(ISME([Leading]),ATTR([Leading],ME(),"Tính vào số deal")=TRUE,IF(ISME([Associate]),ATTR([Associate],ME(),"Tính vào số deal")=TRUE,FALSE))', result_type: "checkbox" } });
    const sum2 = (attr: string, mineOnly: boolean) => `=ATTRSUM([Leading],"${attr}"${mineOnly ? ',"của tôi"' : ""})+ATTRSUM([Associate],"${attr}"${mineOnly ? ',"của tôi"' : ""})`;
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "Tổng % com đã chia", config: { formula: sum2("% com", false), result_type: "percent" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "% com của team", config: { formula: sum2("% com", true), result_type: "percent" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "% doanh thu của team", config: { formula: sum2("% doanh thu", true), result_type: "percent" } });
  });
  it("the commands read the people of both columns and each person's own share", async () => {
    deal = (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Bố trí B", { Leading: [person(org.userA1.id, { ty_le_com: 0.2, ty_le_dt: 0.5, tinh_deal: true })], Associate: [person(org.userA2.id, { ty_le_com: 0.1, ty_le_dt: 0.5 })] }) })).id;
    await settle();
    expect((await row(userA1, tables["Deals"]!, deal))["% Com cá nhân"]).toBeCloseTo(0.2, 9);
    expect((await row(userA2, tables["Deals"]!, deal))["% Com cá nhân"]).toBeCloseTo(0.1, 9);
    expect((await row(userA2, tables["Deals"]!, deal))["Vai trò của tôi"]).toBe("Associate");
    await pay(deal, "B");
    await expectLines(deal, { [org.userA1.id]: 0.2, [org.userA2.id]: 0.1 }, { [org.userA1.id]: 0.5, [org.userA2.id]: 0.5 });
    await expectOwnCom(userA1, deal, 0.2);
    await expectOwnCom(userA2, deal, 0.1);
    await expectTeam(deal, { com: 0.2, dt: 0.5 }, 0.3);
  });
  it("the split lock follows the new key columns", async () => {
    const only2 = (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Chỉ A2", { Associate: [person(org.userA2.id, { ty_le_com: 0.1 })] }) })).id;
    await settle();
    expect((await row(userA2, tables["Deals"]!, only2))["Tên công ty"]).toBe("Chỉ A2");
    expect((await fails(userA1("datahub.row.get", { table_id: tables["Deals"]!, row_id: only2 }))).code).toMatch(/not_found|forbidden/);
  });
});

describe("(c) four columns: Leading, Leading %, Associate, Associate %", () => {
  let deal = "";
  it("Manager adds the four columns and rewrites the formulas with ME()", async () => {
    await addCol("L4", "user", { role: "nguoi_tham_gia" });
    await addCol("L4 %", "percent");
    await addCol("A4", "user", { role: "nguoi_tham_gia" });
    await addCol("A4 %", "percent");
    await setRole("Leading", null);
    await setRole("Associate", null);
    await mgrA("datahub.table.share_options.set", { table_id: tables["Deals"]!, key_split: true, key_columns: ["L4", "A4"] });
    const mine = (l: string, a: string) => `=IF([L4]=ME(),${l},IF([A4]=ME(),${a},0))`;
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "Vai trò của tôi", config: { formula: '=IF([L4]=ME(),"Leading",IF([A4]=ME(),"Associate",""))', result_type: "text" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "% doanh thu của tôi", config: { formula: mine("0.6", "0.4"), result_type: "percent" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "% Com cá nhân", config: { formula: mine("[L4 %]", "[A4 %]"), result_type: "percent" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "Tính vào số deal của tôi", config: { formula: "=IF([L4]=ME(),TRUE,FALSE)", result_type: "checkbox" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "Tổng % com đã chia", config: { formula: "=[L4 %]+[A4 %]", result_type: "percent" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "% com của team", config: { formula: "=IF(INSCOPE([L4]),[L4 %],0)+IF(INSCOPE([A4]),[A4 %],0)", result_type: "percent" } });
    await mgrA("datahub.template.column.update", { template_id: dealsTpl, column: "% doanh thu của team", config: { formula: "=IF(INSCOPE([L4]),0.6,0)+IF(INSCOPE([A4]),0.4,0)", result_type: "percent" } });
  });
  it("the commands write the right lines without a code change", async () => {
    deal = (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Bố trí C", { L4: org.userA1.id, "L4 %": 0.3, A4: org.userA2.id, "A4 %": 0.1 }) })).id;
    await settle();
    expect((await row(userA1, tables["Deals"]!, deal))["% Com cá nhân"]).toBeCloseTo(0.3, 9);
    expect((await row(userA2, tables["Deals"]!, deal))["% Com cá nhân"]).toBeCloseTo(0.1, 9);
    await pay(deal, "C");
    await expectLines(deal, { [org.userA1.id]: 0.3, [org.userA2.id]: 0.1 }, { [org.userA1.id]: 0.6, [org.userA2.id]: 0.4 });
    await expectOwnCom(userA1, deal, 0.3);
    await expectOwnCom(userA2, deal, 0.1);
    await expectTeam(deal, { com: 0.3, dt: 0.6 }, 0.4);
  });
  it("changing a person's % changes the lines of the next payment for that person only", async () => {
    const cur = await mgrA("datahub.row.get", { table_id: tables["Deals"]!, row_id: deal });
    const k = await names(mgrA, tables["Deals"]!);
    await mgrA("datahub.row.update", { table_id: tables["Deals"]!, row_id: deal, version: cur.version, data: { [k["L4 %"]!]: 0.25 } });
    await settle();
    expect((await row(userA1, tables["Deals"]!, deal))["% Com cá nhân"]).toBeCloseTo(0.25, 9);
    expect((await row(userA2, tables["Deals"]!, deal))["% Com cá nhân"]).toBeCloseTo(0.1, 9);
    const s = await mgrA("payment.schedule", { deal_id: deal, payments: [{ legal_entity: "CT C2", amount: 50_000_000, due: "2026-08-01" }] });
    await mgrA("payment.confirm", { received_on: "2026-08-01", receipt: { amount: 50_000_000 }, allocations: [{ payment_id: s.payments.find((p: { created: boolean }) => p.created).id, amount: 50_000_000 }] });
    const lines = (await ledgerOf(deal)).filter((r) => r["Người"] === org.userA1.id).map((r) => Math.round((r["% com"] as number) * 10000) / 10000).sort();
    expect(lines).toEqual([0.25, 0.3]);
  });
  it("the total % com may not exceed Tỉ lệ SoE (0.5), checked by the commands on the four-column layout", async () => {
    const over = (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Quá trần", { L4: org.userA1.id, "L4 %": 0.35, A4: org.userA2.id, "A4 %": 0.2 }) })).id;
    await settle();
    const e = await fails(mgrA("payment.schedule", { deal_id: over, payments: [{ legal_entity: "CT quá", amount: 10_000_000, due: "2026-09-01" }] }));
    expect(e.code).toBe("validation_error");
    expect(e.details?.reason).toBe("com_over_cap");
    // Exactly at the cap passes, and confirm checks it too.
    const cur = await mgrA("datahub.row.get", { table_id: tables["Deals"]!, row_id: over });
    const k = await names(mgrA, tables["Deals"]!);
    await mgrA("datahub.row.update", { table_id: tables["Deals"]!, row_id: over, version: cur.version, data: { [k["A4 %"]!]: 0.15 } });
    const s = await mgrA("payment.schedule", { deal_id: over, payments: [{ legal_entity: "CT vừa", amount: 10_000_000, due: "2026-09-01" }] });
    const cur2 = await mgrA("datahub.row.get", { table_id: tables["Deals"]!, row_id: over });
    await mgrA("datahub.row.update", { table_id: tables["Deals"]!, row_id: over, version: cur2.version, data: { [k["A4 %"]!]: 0.3 } });
    const e2 = await fails(mgrA("payment.confirm", { received_on: "2026-09-02", receipt: { amount: 10_000_000 }, allocations: [{ payment_id: s.payments[0].id, amount: 10_000_000 }] }));
    expect(e2.details?.reason).toBe("com_over_cap");
  });
  it("a com_split sent by hand is checked against the cap too (schedule and confirm)", async () => {
    const d = (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Chia tay", { L4: org.userA1.id, "L4 %": 0.1 }) })).id;
    await settle();
    const split = (a: number, b: number) => [{ user_id: org.userA1.id, pct: a }, { user_id: org.userA2.id, pct: b }];
    const e = await fails(mgrA("payment.schedule", { deal_id: d, payments: [{ legal_entity: "CT tay", amount: 10_000_000, due: "2026-10-01", com_split: split(0.4, 0.2) }] }));
    expect(e.details?.reason).toBe("com_over_cap");
    const s = await mgrA("payment.schedule", { deal_id: d, payments: [{ legal_entity: "CT tay", amount: 10_000_000, due: "2026-10-01", com_split: split(0.3, 0.2) }] });
    const e2 = await fails(mgrA("payment.confirm", { received_on: "2026-10-02", receipt: { amount: 10_000_000 }, allocations: [{ payment_id: s.payments[0].id, amount: 10_000_000, com_split: split(0.4, 0.2) }] }));
    expect(e2.details?.reason).toBe("com_over_cap");
  });
});
