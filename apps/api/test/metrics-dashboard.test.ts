import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** Stage 3C-1: dashboards and charts of a datahub: who may do what, limits, trash, duplicate, layout. */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let dhId: string;
let tableId: string;
let metricId: string;

async function setSetting(key: string, value: unknown) {
  await t.c.db.db.execute(sql`INSERT INTO system_settings (id, key, value) VALUES (gen_random_uuid(), ${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}

const kpi = (extra: Record<string, unknown> = {}) => ({ type: "kpi", title: "Tổng", series: [{ metric_id: metricId }], ...extra });

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  owner = as(t, org.userA1.id);
  const x = await makeTable(owner, { columns: [{ name: "Mã", type: "text" }, { name: "Số", type: "number" }] });
  dhId = x.dhId;
  tableId = x.tableId;
  await owner("datahub.row.batch", { table_id: tableId, ops: [10, 20, 30].map((n, i) => ({ op: "create", data: { Mã: `K${i}`, Số: n } })) });
  metricId = (await owner("metrics.metric.create", { datahub_id: dhId, metric: { name: "Tổng số", source: tableId, measure: { agg: "sum", field: "Số" } } })).id;
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe("dashboards of the owner", () => {
  let d1: { id: string; version: number };
  it("creates, lists in order, renames, duplicates and reorders", async () => {
    d1 = await owner("metrics.dashboard.create", { datahub_id: dhId, name: "Doanh thu" });
    const d2 = await owner("metrics.dashboard.create", { datahub_id: dhId, name: "Pipeline" });
    expect((await owner("metrics.dashboard.list", { datahub_id: dhId })).items.map((d: { name: string }) => d.name)).toEqual(["Doanh thu", "Pipeline"]);
    expect((await fails(owner("metrics.dashboard.create", { datahub_id: dhId, name: " doanh thu " }))).code).toBe("conflict");
    const r = await owner("metrics.dashboard.update", { dashboard_id: d1.id, version: d1.version, name: "Doanh thu 2026" });
    expect(r.version).toBe(d1.version + 1);
    expect((await fails(owner("metrics.dashboard.update", { dashboard_id: d1.id, version: d1.version, name: "x" }))).code).toBe("conflict");
    d1 = r;
    await owner("metrics.chart.create", { dashboard_id: d1.id, chart: kpi() });
    const copy = await owner("metrics.dashboard.duplicate", { dashboard_id: d1.id });
    expect(copy.name).toBe("Doanh thu 2026 (bản sao)");
    expect(copy.charts).toHaveLength(1);
    expect(copy.charts[0].id).not.toBe((await owner("metrics.dashboard.get", { dashboard_id: d1.id })).charts[0].id);
    const copy2 = await owner("metrics.dashboard.duplicate", { dashboard_id: d1.id });
    expect(copy2.name).toBe("Doanh thu 2026 (bản sao 2)");
    const ids = (await owner("metrics.dashboard.list", { datahub_id: dhId })).items.map((d: { id: string }) => d.id);
    const reordered = [ids[2], ...ids.filter((i: string) => i !== ids[2])];
    expect((await owner("metrics.dashboard.reorder", { datahub_id: dhId, ids: reordered })).items.map((d: { id: string }) => d.id)).toEqual(reordered);
    expect((await fails(owner("metrics.dashboard.reorder", { datahub_id: dhId, ids: [d2.id] }))).details.reason).toBe("order_mismatch");
    expect((await owner("metrics.dashboard.list", { datahub_id: dhId })).items.find((d: { id: string }) => d.id === d1.id).chart_count).toBe(1);
  });

  it("deletes into the trash, lists it, restores (asks for a new name when taken)", async () => {
    const x = await owner("metrics.dashboard.create", { datahub_id: dhId, name: "Tạm" });
    await owner("metrics.dashboard.delete", { dashboard_id: x.id });
    expect((await fails(owner("metrics.dashboard.get", { dashboard_id: x.id }))).code).toBe("not_found");
    expect((await owner("metrics.dashboard.trash", { datahub_id: dhId })).items.map((d: { name: string }) => d.name)).toEqual(["Tạm"]);
    await owner("metrics.dashboard.create", { datahub_id: dhId, name: "Tạm" });
    const e = await fails(owner("metrics.dashboard.restore", { dashboard_id: x.id }));
    expect(e.code).toBe("conflict");
    expect(e.details.reason).toBe("duplicate_name");
    const back = await owner("metrics.dashboard.restore", { dashboard_id: x.id, name: "Tạm khôi phục" });
    expect(back.name).toBe("Tạm khôi phục");
    expect((await owner("metrics.dashboard.trash", { datahub_id: dhId })).items).toHaveLength(0);
    // A live dashboard cannot be restored.
    expect((await fails(owner("metrics.dashboard.restore", { dashboard_id: x.id }))).code).toBe("not_found");
  });

});

describe("limits (settings)", () => {
  it("stops at the limit of dashboards and counts a restore and a copy too", async () => {
    const x = await makeTable(owner, { name: "Giới hạn", columns: [{ name: "Số", type: "number" }] });
    await setSetting("metrics.max_dashboards", 3);
    try {
      const a = await owner("metrics.dashboard.create", { datahub_id: x.dhId, name: "A" });
      await owner("metrics.dashboard.create", { datahub_id: x.dhId, name: "B" });
      await owner("metrics.dashboard.create", { datahub_id: x.dhId, name: "C" });
      expect((await fails(owner("metrics.dashboard.create", { datahub_id: x.dhId, name: "D" }))).code).toBe("quota_exceeded");
      expect((await fails(owner("metrics.dashboard.duplicate", { dashboard_id: a.id }))).code).toBe("quota_exceeded");
      await owner("metrics.dashboard.delete", { dashboard_id: a.id });
      await owner("metrics.dashboard.create", { datahub_id: x.dhId, name: "D" });
      expect((await fails(owner("metrics.dashboard.restore", { dashboard_id: a.id }))).code).toBe("quota_exceeded");
    } finally {
      await setSetting("metrics.max_dashboards", 20);
    }
  });

  it("stops at the limit of charts", async () => {
    const dash = (await owner("metrics.dashboard.create", { datahub_id: dhId, name: "Đầy" })).id;
    await setSetting("metrics.max_charts", 3);
    try {
      for (let i = 0; i < 3; i++) await owner("metrics.chart.create", { dashboard_id: dash, chart: kpi() });
      expect((await fails(owner("metrics.chart.create", { dashboard_id: dash, chart: kpi() }))).code).toBe("quota_exceeded");
      expect((await owner("metrics.dashboard.get", { dashboard_id: dash })).charts).toHaveLength(3);
    } finally {
      await setSetting("metrics.max_charts", 30);
    }
  });
});

describe("charts", () => {
  let dash: string;
  beforeAll(async () => {
    dash = (await owner("metrics.dashboard.create", { datahub_id: dhId, name: "Biểu đồ" })).id;
  });

  it("adds charts at the bottom of the grid, updates with the version, saves the layout in one call, deletes", async () => {
    const a = await owner("metrics.chart.create", { dashboard_id: dash, chart: kpi() });
    const b = await owner("metrics.chart.create", { dashboard_id: dash, chart: { type: "column", series: [{ metric: { name: "Số theo mã", source: tableId, measure: { agg: "sum", field: "Số" }, group_by: [{ field: "Mã" }] } }] } });
    expect(a.chart.layout.y).toBe(0);
    expect(b.chart.layout.y).toBeGreaterThanOrEqual(a.chart.layout.h);
    const up = await owner("metrics.chart.update", { chart_id: a.id, version: a.version, chart: kpi({ title: "Mới" }) });
    expect(up.chart.title).toBe("Mới");
    expect(up.chart.layout).toEqual(a.chart.layout); // the layout stays when the new JSON has none
    expect((await fails(owner("metrics.chart.update", { chart_id: a.id, version: a.version, chart: kpi() }))).code).toBe("conflict");
    await owner("metrics.chart.layout", { dashboard_id: dash, items: [{ chart_id: a.id, layout: { x: 6, y: 2, w: 3, h: 3 } }, { chart_id: b.id, layout: { x: 0, y: 0, w: 6, h: 5 } }] });
    const got = await owner("metrics.dashboard.get", { dashboard_id: dash });
    expect(got.charts.map((c: { id: string }) => c.id)).toEqual([a.id, b.id]);
    expect(got.charts[0].chart.layout).toEqual({ x: 6, y: 2, w: 3, h: 3 });
    expect((await fails(owner("metrics.chart.layout", { dashboard_id: dash, items: [{ chart_id: a.id, layout: { x: 10, y: 0, w: 5, h: 3 } }] }))).details.reason).toBe("layout_out_of_grid");
    await owner("metrics.chart.delete", { chart_id: b.id });
    expect((await owner("metrics.dashboard.get", { dashboard_id: dash })).charts).toHaveLength(1);
  });

  it("refuses a bad chart with a message that says what to fix", async () => {
    expect((await fails(owner("metrics.chart.create", { dashboard_id: dash, chart: { type: "radar", series: [] } }))).code).toBe("validation_error");
    expect((await fails(owner("metrics.chart.create", { dashboard_id: dash, chart: { type: "kpi", series: [] } }))).details.issues[0].path).toBe("series");
    expect((await fails(owner("metrics.chart.create", { dashboard_id: dash, chart: { type: "kpi", series: [{ metric_id: metricId, metric: { name: "x", source: tableId, measure: { agg: "count" } } }] } }))).code).toBe("validation_error");
    const missing = await fails(owner("metrics.chart.create", { dashboard_id: dash, chart: kpi({ series: [{ metric_id: "019e0000-0000-7000-8000-000000000000" }] }) }));
    expect(missing.code).toBe("not_found");
    const badCol = await fails(owner("metrics.chart.create", { dashboard_id: dash, chart: { type: "kpi", series: [{ metric: { name: "x", source: tableId, measure: { agg: "sum", field: "Không có" } } }] } }));
    expect(badCol.code).toBe("validation_error");
    expect(badCol.message).toContain("Chuỗi số liệu thứ 1");
    expect((await fails(owner("metrics.chart.create", { dashboard_id: dash, chart: { type: "note", text: "x", series: [{ metric_id: metricId }] } }))).code).toBe("validation_error");
    await owner("metrics.chart.create", { dashboard_id: dash, chart: { type: "note", text: "<b>Ghi chú</b>" } });
  });
});

describe("everyone else gets nothing", () => {
  let dash: string;
  let chart: string;
  let dh: string;
  beforeAll(async () => {
    const x = await makeTable(owner, { name: "Riêng tư 2", columns: [{ name: "Số", type: "number" }] });
    const m = await owner("metrics.metric.create", { datahub_id: x.dhId, metric: { name: "S", source: x.tableId, measure: { agg: "count" } } });
    dash = (await owner("metrics.dashboard.create", { datahub_id: x.dhId, name: "Của tôi" })).id;
    chart = (await owner("metrics.chart.create", { dashboard_id: dash, chart: { type: "kpi", series: [{ metric_id: m.id }] } })).id;
    // A person given the whole datahub reads numbers but dashboards are the owner's until sharing exists (3C-2).
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    dh = x.dhId;
  });
  it.each([
    ["a person given the datahub", () => org.userA2.id],
    ["the Leader of the owner", () => org.leaderA.id],
    ["the Manager of the owner", () => org.mgrA.id],
    ["a user of another Manager", () => org.userB1.id],
    ["an Admin", () => org.admin.id],
    ["a Guest", () => org.guestData.id],
  ])("%s", async (_n, who) => {
    const u = as(t, who());
    const denied = async (p: Promise<unknown>) => expect(["forbidden", "not_found"]).toContain((await fails(p)).code);
    await denied(u("metrics.dashboard.list", { datahub_id: dh }));
    await denied(u("metrics.dashboard.get", { dashboard_id: dash }));
    await denied(u("metrics.dashboard.create", { datahub_id: dh, name: "X" }));
    await denied(u("metrics.dashboard.update", { dashboard_id: dash, version: 1, name: "X" }));
    await denied(u("metrics.dashboard.duplicate", { dashboard_id: dash }));
    await denied(u("metrics.dashboard.delete", { dashboard_id: dash }));
    await denied(u("metrics.dashboard.trash", { datahub_id: dh }));
    await denied(u("metrics.dashboard.reorder", { datahub_id: dh, ids: [dash] }));
    await denied(u("metrics.chart.create", { dashboard_id: dash, chart: { type: "note", text: "x" } }));
    await denied(u("metrics.chart.update", { chart_id: chart, version: 1, chart: { type: "note", text: "x" } }));
    await denied(u("metrics.chart.delete", { chart_id: chart }));
    await denied(u("metrics.chart.layout", { dashboard_id: dash, items: [{ chart_id: chart, layout: { x: 0, y: 0, w: 3, h: 3 } }] }));
  });
});
