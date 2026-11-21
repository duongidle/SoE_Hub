import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Stage 4.6A2: "Doanh thu theo người" (revenue of ONE named person) and Probation KPI progress. Invented figures only.
 * Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
const tables: Record<string, string> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const settle = async () => {
  await drainOutbox(t);
  await processPendingColumns(t.c.db.db);
  await drainOutbox(t);
  await processPendingColumns(t.c.db.db);
  await drainOutbox(t);
};
async function row(call: ReturnType<typeof as>, table: string, id: string): Promise<Record<string, unknown>> {
  const r = await call("datahub.row.get", { table_id: table, row_id: id });
  const tb = await call("datahub.table.get", { table_id: table });
  const nm = Object.fromEntries((tb.columns as { key: string; name: string }[]).map((c) => [c.key, c.name]));
  return Object.fromEntries(Object.entries(r.data as Record<string, unknown>).map(([k, v]) => [nm[k] ?? k, v]));
}

let dealA = "";
let dealB = "";
let payA = "";
let payB = "";
const dealData = (name: string, people: unknown[]) => ({
  "Tên công ty": name,
  "Loại deal": "POD bán mới",
  "Start date": "2026-06-10",
  "Ngày dự kiến chốt": "2026-07-01",
  "Doanh thu dự kiến": 1_000,
  "Nguồn lead": "ML",
  "Level BC": "Level 1",
  "Performance BC": "KPI",
  "Người tham gia": people,
});
const kpiRow = async (user: string, year = 2026): Promise<string> => {
  const r = await mgrA("datahub.row.create", { table_id: tables["Probation KPI"]!, data: { Người: user, Năm: year, "KPI Software": 400_000_000, "KPI Non-software": 100_000_000, "% Q1": 0.25, "% Q2": 0.25, "% Q3": 0.25, "% Q4": 0.25 } });
  return r.id;
};
let kpiA1 = "";
let kpiLeader = "";

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id);
  await drainOutbox(t);
  const list = await mgrA("datahub.template.list");
  for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = list.find((x: { name: string }) => x.name === d.name).master_table_id;
  await mgrA("datahub.row.create", { table_id: tables["Chính sách com"]!, data: { "Hiệu lực từ": "2026-01-01", "Nguồn lead": "ML", Level: "Level 1", Performance: "KPI", "Tỉ lệ": 0.2 } });
  await mgrA("datahub.row.create", { table_id: tables["Tham số com"]!, data: { "Hiệu lực từ": "2026-01-01", "Tên tham số": "Tỉ lệ SoE", "Giá trị": 0.5 } });
  // Deal A: userA1 alone (Leading takes 100%). Deal B: the Leader 60%, userA1 40%.
  dealA = (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Công ty Một", [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.1 })]) })).id;
  dealB = (await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: dealData("Công ty Hai", [person(org.leaderA.id, { vai_tro: "Leading", ty_le_dt: 0.6, ty_le_com: 0.1 }), person(org.userA1.id, { vai_tro: "Associate", ty_le_dt: 0.4, ty_le_com: 0.1 })]) })).id;
  payA = (await mgrA("payment.schedule", { deal_id: dealA, payments: [{ legal_entity: "CT A", amount: 100_000_000, due: "2026-07-01" }] })).payments[0].id;
  payB = (await mgrA("payment.schedule", { deal_id: dealB, payments: [{ legal_entity: "CT B", amount: 50_000_000, due: "2026-08-01" }] })).payments[0].id;
  kpiA1 = await kpiRow(org.userA1.id);
  kpiLeader = await kpiRow(org.leaderA.id);
  await settle();
});
afterAll(async () => {
  await t.close();
});

const revenueRows = async (): Promise<Record<string, unknown>[]> => {
  const r = await mgrA("datahub.row.list", { table_id: tables["Doanh thu theo người"]!, limit: 100 });
  const tb = await mgrA("datahub.table.get", { table_id: tables["Doanh thu theo người"]! });
  const nm = Object.fromEntries((tb.columns as { key: string; name: string }[]).map((c) => [c.key, c.name]));
  return (r.items as { data: Record<string, unknown> }[]).map((x) => Object.fromEntries(Object.entries(x.data).map(([k, v]) => [nm[k] ?? k, v])));
};

describe("Doanh thu theo người", () => {
  it("is empty before the money arrives; confirming writes one row per person with a share", async () => {
    expect(await revenueRows()).toHaveLength(0);
    await mgrA("payment.confirm", { received_on: "2026-07-03", receipt: { amount: 100_000_000 }, allocations: [{ payment_id: payA, amount: 100_000_000 }] });
    await mgrA("payment.confirm", { received_on: "2026-08-05", receipt: { amount: 50_000_000 }, allocations: [{ payment_id: payB, amount: 50_000_000 }] });
    await settle();
    const rows = await revenueRows();
    expect(rows).toHaveLength(3);
    const by = (u: string) => rows.filter((r) => r["Người"] === u).map((r) => r["Doanh thu"] as number).sort((x, y) => x - y);
    expect(by(org.userA1.id)).toEqual([20_000_000, 100_000_000]);
    expect(by(org.leaderA.id)).toEqual([30_000_000]);
  });

  it("Probation KPI: Đã đạt is the revenue of the person on the row, whoever reads it", async () => {
    for (const [name, call] of [["manager", mgrA], ["leader", leaderA], ["user", userA1]] as const) {
      const r = await row(call, tables["Probation KPI"]!, kpiA1);
      expect(r["Đã đạt"], name).toBe(120_000_000);
      expect(r["Còn thiếu"], name).toBe(380_000_000);
      expect(r["% đạt"] as number, name).toBeCloseTo(0.24, 9);
    }
    const l = await row(leaderA, tables["Probation KPI"]!, kpiLeader);
    expect(l["Đã đạt"]).toBe(30_000_000);
    expect((await row(mgrA, tables["Probation KPI"]!, kpiLeader))["Đã đạt"]).toBe(30_000_000);
  });

  it("a person sees only their own revenue rows; the Leader the team's; the Manager all", async () => {
    const count = async (call: ReturnType<typeof as>) => ((await call("datahub.row.list", { table_id: tables["Doanh thu theo người"]!, limit: 100 })).items as unknown[]).length;
    expect(await count(userA1)).toBe(2);
    expect(await count(userA2)).toBe(0);
    expect(await count(leaderA)).toBe(3);
    expect(await count(mgrA)).toBe(3);
  });

  it("unconfirm removes the person's rows and the KPI falls", async () => {
    expect(((await row(mgrA, tables["Deals"]!, dealB))["Sổ com"] as unknown[]).length).toBe(2);
    await mgrA("payment.unconfirm", { payment_ids: [payB] });
    await settle();
    // no orphan ledger id is left in the deal's link
    expect((((await row(mgrA, tables["Deals"]!, dealB))["Sổ com"] as unknown[] | null) ?? []).length).toBe(0);
    expect(await revenueRows()).toHaveLength(1);
    expect((await row(userA1, tables["Probation KPI"]!, kpiA1))["Đã đạt"]).toBe(100_000_000);
    expect((await row(leaderA, tables["Probation KPI"]!, kpiLeader))["Đã đạt"]).toBe(0);
  });
});
