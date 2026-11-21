import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Stage 4.6A: the "của tôi" columns of Deals (design module4 4.1 rows 14-24, 4.2): one value per reader. Invented figures only.
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
let deal = "";
let payment = "";

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
  const d = await mgrA("datahub.row.create", {
    table_id: tables["Deals"]!,
    data: {
      "Tên công ty": "Công ty Com Thử",
      "Loại deal": "POD bán mới",
      "Start date": "2026-06-10",
      "Ngày dự kiến chốt": "2026-07-01",
      "Doanh thu dự kiến": 1_000,
      "Nguồn lead": "ML",
      "Level BC": "Level 1",
      "Performance BC": "KPI",
      "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.15 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.05 })],
    },
  });
  deal = d.id;
  payment = (await mgrA("payment.schedule", { deal_id: deal, payments: [{ legal_entity: "CT Beta", amount: 100_000_000, due: "2026-07-01" }] })).payments[0].id;
  await settle();
});
afterAll(async () => {
  await t.close();
});

describe("Com dự kiến, Doanh thu tính cho tôi: one value per person", () => {
  it("each person gets their own figure; the Leader gets the team's", async () => {
    const a1 = await row(userA1, tables["Deals"]!, deal);
    const a2 = await row(userA2, tables["Deals"]!, deal);
    expect(a1["Giá trị hợp đồng"]).toBe(100_000_000);
    expect(a1["Com dự kiến của tôi"]).toBeCloseTo(3_000_000, 6);
    expect(a2["Com dự kiến của tôi"]).toBeCloseTo(1_000_000, 6);
    expect(a1["Com chờ nhận của tôi"]).toBeCloseTo(3_000_000, 6);
    expect(a1["Doanh thu tính cho tôi"]).toBeCloseTo(1_000, 6);
    expect(a2["Doanh thu tính cho tôi"]).toBeCloseTo(0, 6);
    const l = await row(leaderA, tables["Deals"]!, deal);
    expect(l["Com dự kiến của team"]).toBeCloseTo(3_000_000, 6);
    expect(l["Com dự kiến của tôi"]).toBeCloseTo(0, 6);
  });

  it("changing one person's % changes only theirs", async () => {
    const cur = await mgrA("datahub.row.get", { table_id: tables["Deals"]!, row_id: deal });
    await mgrA("datahub.row.update", { table_id: tables["Deals"]!, row_id: deal, version: cur.version, data: { "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.25 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.05 })] } });
    await settle();
    expect((await row(userA1, tables["Deals"]!, deal))["Com dự kiến của tôi"]).toBeCloseTo(5_000_000, 6);
    expect((await row(userA2, tables["Deals"]!, deal))["Com dự kiến của tôi"]).toBeCloseTo(1_000_000, 6);
  });
});

describe("ledger roll-ups", () => {
  it("a confirmed payment gives each person their own Tạm tính, the Manager the deal's total, nobody else's lines", async () => {
    await mgrA("payment.confirm", { received_on: "2026-07-03", receipt: { amount: 100_000_000 }, allocations: [{ payment_id: payment, amount: 100_000_000 }] });
    await settle();
    const a1 = await row(userA1, tables["Deals"]!, deal);
    const a2 = await row(userA2, tables["Deals"]!, deal);
    expect(a1["Com tạm tính của tôi"]).toBeCloseTo(5_000_000, 6);
    expect(a2["Com tạm tính của tôi"]).toBeCloseTo(1_000_000, 6);
    expect(a1["Com đã nhận của tôi"]).toBeCloseTo(0, 6);
    expect(a1["Com chờ nhận của tôi"]).toBeCloseTo(0, 6);
    expect(a1["Com của deal"]).toBeUndefined();
    const m = await row(mgrA, tables["Deals"]!, deal);
    expect(m["Com của deal"]).toBeCloseTo(6_000_000, 6);
  });
});

describe("Index: revenue and forecast by the person's share", () => {
  it("revenue by the day the money arrived, weighted by % doanh thu of the reader; the Leader sees the team's total", async () => {
    // Revenue of the instalment is the paid amount: Leading takes 100%, Associate 0% (default).
    const idx = async (call: ReturnType<typeof as>) => {
      const my = (await call("datahub.template.list")).find((x: { name: string }) => x.name === "Index").my_table_id as string;
      const made = await call("datahub.row.create", { table_id: my, data: { Tháng: "2026-07-01" } });
      await settle();
      return row(call, my, made.id);
    };
    const a1 = await idx(userA1);
    const a2 = await idx(userA2);
    expect(a1["Doanh thu Tổng"]).toBe(100_000_000);
    expect(a1["Doanh thu POD"]).toBe(100_000_000);
    expect(a1["Doanh thu PS"]).toBe(0);
    expect(a2["Doanh thu Tổng"]).toBe(0);
    const l = await idx(leaderA);
    expect(l["Doanh thu Tổng (team)"]).toBe(100_000_000);
  });
});
