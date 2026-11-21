import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { businessDate } from "@soe/shared";
import { BUILTIN_DEFAULT_SET, DEAL_DASHBOARD_NAME, ensureDealDashboard, ensureTreeTemplates, quarterOf } from "../src/modules/deal";
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
const dealData = (name: string): Record<string, unknown> => ({
  "Tên công ty": name,
  "Loại deal": "POD bán mới",
  "Start date": "2026-06-10",
  "Doanh thu dự kiến": 1_000,
  "Nguồn lead": "ML",
  "Level BC": "Level 1",
  "Performance BC": "KPI",
  "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.1 })],
});
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
  await drainOutbox(t); // each person's own columns are computed by the worker before the money commands read them (module4 4.1)
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

describe("metrics point at a column by role", () => {
  it("`role:<key>` reads the column holding the role, per reader (own revenue, own deal count)", async () => {
    const run = (call: ReturnType<typeof as>, measure: Record<string, unknown>, filter?: Record<string, unknown>) =>
      call("metrics.query", { metric: { name: "m", source: tables["Deals"]!, measure }, ...(filter ? { filter } : {}) });
    expect((await run(userA1, { agg: "sum", field: "role:doanh_thu_duoc_tinh" })).rows[0].value).toBe(100_000_000);
    expect((await run(userA2, { agg: "sum", field: "role:doanh_thu_duoc_tinh" })).rows[0].value).toBe(0);
    expect((await run(mgrA, { agg: "sum", field: "role:doanh_thu" })).rows[0].value).toBe(100_000_000);
    const mine = { field: "Tính vào số deal của tôi", op: "eq", value: true };
    expect((await run(userA1, { agg: "count" }, mine)).rows[0].value).toBe(1);
    expect((await run(userA2, { agg: "count" }, mine)).rows[0].value).toBe(0);
    await expect(run(userA1, { agg: "sum", field: "role:khong_co" })).rejects.toMatchObject({ code: expect.stringMatching(/invalid|not_found|validation/) });
  });
});

describe("default Deals dashboard", () => {
  it("a new tree has it (made by the loop that builds the tree); each viewer's numbers are their own; people outside the tree do not see it", async () => {
    const dh = (await mgrA("datahub.table.get", { table_id: tables["Deals"]! })).datahub_id as string;
    const listed = (await mgrA("metrics.dashboard.list", { datahub_id: dh })) as { id: string; name: string }[] | { items: { id: string; name: string }[] };
    const found = (Array.isArray(listed) ? listed : listed.items).find((d) => d.name === DEAL_DASHBOARD_NAME);
    expect(found).toBeTruthy();
    const id = found!.id;
    expect(await ensureDealDashboard((op, input) => mgrA(op, input), t.c.db.db, dh)).toBe(id);
    expect((Array.isArray(listed) ? listed : listed.items).filter((d) => d.name === DEAL_DASHBOARD_NAME)).toHaveLength(1);
    const kpiOf = async (call: ReturnType<typeof as>, title: string) => {
      const d = await call("metrics.dashboard.view", { dashboard_id: id });
      const chart = (d.charts as { id: string; chart: { title?: string } }[]).find((c) => c.chart.title === title)!;
      const r = await call("metrics.chart.data", { chart_id: chart.id });
      return JSON.stringify(r);
    };
    const shared = await userA1("metrics.dashboard.shared");
    expect(((Array.isArray(shared) ? shared : shared.items) as { name: string }[]).map((x) => x.name)).toContain(DEAL_DASHBOARD_NAME);
    expect(await kpiOf(userA1, "Doanh thu tính cho tôi")).toContain("100000000");
    expect(await kpiOf(userA2, "Doanh thu tính cho tôi")).not.toContain("100000000");
  });

  it("forecast of two parts: the signed part is the viewer's share of the unpaid instalments due this quarter, the unsigned part of open deals without a schedule", async () => {
    const q = quarterOf(businessDate(new Date()));
    await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: { ...dealData("Công ty Forecast"), "Ngày dự kiến chốt": q.end, "Doanh thu dự kiến": 30_000_000 } });
    const d2 = await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: { ...dealData("Công ty Forecast Hai"), "Ngày dự kiến chốt": q.end } });
    await drainOutbox(t); // each person's own columns are computed by the worker before the money commands read them (module4 4.1)
    await mgrA("payment.schedule", { deal_id: d2.id, payments: [{ legal_entity: "CT F", amount: 40_000_000, due: q.end }] });
    await settle();
    const dh = (await mgrA("datahub.table.get", { table_id: tables["Deals"]! })).datahub_id as string;
    const lst = (await mgrA("metrics.dashboard.list", { datahub_id: dh })) as { id: string; name: string }[] | { items: { id: string; name: string }[] };
    const id = (Array.isArray(lst) ? lst : lst.items).find((x) => x.name === DEAL_DASHBOARD_NAME)!.id;
    const value = async (call: ReturnType<typeof as>, title: string): Promise<unknown> => {
      const dv = await call("metrics.dashboard.view", { dashboard_id: id });
      const chart = (dv.charts as { id: string; chart: { title?: string } }[]).find((c) => c.chart.title === title)!;
      return JSON.parse(JSON.stringify(await call("metrics.chart.data", { chart_id: chart.id })));
    };
    const num = (r: unknown): number => (r as { series: { rows: { value: number | null }[] }[] }).series[0]!.rows[0]?.value ?? 0;
    expect(num(await value(userA1, "Forecast đã ký (quý này)"))).toBe(40_000_000);
    expect(num(await value(userA1, "Forecast chưa ký (quý này)"))).toBe(30_000_000);
    expect(num(await value(userA2, "Forecast đã ký (quý này)"))).toBe(0);
    // Cohort of June 2026 (Start date): Com Thử is Won, the two forecast deals are open, one more is Disqualified: 4 received, 3 met a customer, 1 won.
    await mgrA("datahub.row.create", { table_id: tables["Deals"]!, data: { ...dealData("Công ty Loại"), Status: "Disqualified" } });
    await settle();
    const cohort = async (title: string) => {
      const r = (await value(mgrA, title)) as { series: { rows: { groups: { label: string }[]; value: number }[] }[] };
      return r.series[0]!.rows.find((x) => x.groups[0]!.label === "2026-06")!.value;
    };
    expect(await cohort("CR1 theo cohort (tháng nhận)")).toBeCloseTo(3 / 4, 9);
    expect(await cohort("CR2 (Winrate) theo cohort (tháng nhận)")).toBeCloseTo(1 / 3, 9);
  });
});

describe("Com của tôi vs Com của team (Leader and Manager count only their own lines for \"của tôi\")", () => {
  it("Leader has 4tr of their own, the team 6tr more: mine 4tr, team 10tr; the Manager's mine is 0", async () => {
    const d = await mgrA("datahub.row.create", {
      table_id: tables["Deals"]!,
      data: {
        "Tên công ty": "Công ty Team Com",
        "Loại deal": "POD bán mới",
        "Start date": "2026-06-10",
        "Ngày dự kiến chốt": "2026-07-01",
        "Doanh thu dự kiến": 1_000,
        "Nguồn lead": "ML",
        "Level BC": "Level 1",
        "Performance BC": "KPI",
        "Người tham gia": [person(org.leaderA.id, { vai_tro: "Associate", ty_le_com: 0.2 }), person(org.userA1.id, { vai_tro: "Associate", ty_le_com: 0.3 })],
      },
    });
    await drainOutbox(t); // each person's own columns are computed by the worker before the money commands read them (module4 4.1)
    const pay = (await mgrA("payment.schedule", { deal_id: d.id, payments: [{ legal_entity: "CT Gamma", amount: 100_000_000, due: "2026-07-01" }] })).payments[0].id;
    await mgrA("payment.confirm", { received_on: "2026-07-04", receipt: { amount: 100_000_000 }, allocations: [{ payment_id: pay, amount: 100_000_000 }] });
    await settle();
    const l = await row(leaderA, tables["Deals"]!, d.id);
    expect(l["Com tạm tính của tôi"]).toBeCloseTo(4_000_000, 6);
    expect(l["Com tạm tính của team"]).toBeCloseTo(10_000_000, 6);
    expect(l["Com đã nhận của tôi"]).toBeCloseTo(0, 6);
    const a1 = await row(userA1, tables["Deals"]!, d.id);
    expect(a1["Com tạm tính của tôi"]).toBeCloseTo(6_000_000, 6);
    expect(a1["Com tạm tính của team"]).toBeUndefined();
    const m = await row(mgrA, tables["Deals"]!, d.id);
    expect(m["Com tạm tính của tôi"]).toBeCloseTo(0, 6);
    expect(m["Com của deal"]).toBeCloseTo(10_000_000, 6);
  });
});
