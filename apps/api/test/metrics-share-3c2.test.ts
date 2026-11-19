import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 3C-2: sharing a dashboard (numbers computed with the owner's rights), who may look, the rows behind a number in the viewer's own
 * scope, CSV, the viewer's own filters, JSON export and import. Roles: owner, shared person, Leader/Manager of the owner (get nothing
 * extra), Admin, other tree, Guest with and without a grant.
 */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let dhId: string;
let tableId: string;
let dashId: string;
let chartId: string;
let metricId: string;

const roleOf = (key: keyof Org) => as(t, (org[key] as { id: string }).id);
const denied = async (p: Promise<unknown>) => expect(["forbidden", "not_found"]).toContain((await fails(p)).code);
const total = (r: { series: { rows: { value: number }[] }[] }) => r.series[0]!.rows[0]!.value;

async function audits(command: string) {
  return (await t.c.db.db.execute(sql`SELECT target_id, details FROM audit_log WHERE command = ${command} AND result = 'success' ORDER BY at`)).rows as { target_id: string; details: Record<string, unknown> }[];
}

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  owner = as(t, org.userA1.id);
  const x = await makeTable(owner, { name: "Deals riêng", columns: [{ name: "Mã", type: "text" }, { name: "Loại", type: "single_select", config: { options: [{ name: "POD" }, { name: "DCC" }] } }, { name: "Số tiền", type: "number" }] });
  dhId = x.dhId;
  tableId = x.tableId;
  const rows: [string, string, number][] = [["=1+1", "POD", 10], ["K2", "POD", 20], ["K3", "DCC", 30], ["K4", "DCC", 40]];
  await owner("datahub.row.batch", { table_id: tableId, ops: rows.map(([Mã, Loại, tien]) => ({ op: "create", data: { Mã, Loại, "Số tiền": tien } })) });
  metricId = (await owner("metrics.metric.create", { datahub_id: dhId, metric: { name: "Tổng tiền", source: tableId, measure: { agg: "sum", field: "Số tiền" }, group_by: [{ field: "Loại" }] } })).id;
  dashId = (await owner("metrics.dashboard.create", { datahub_id: dhId, name: "Báo cáo riêng" })).id;
  chartId = (await owner("metrics.chart.create", { dashboard_id: dashId, chart: { type: "column", title: "Theo loại", series: [{ metric_id: metricId, label: "Tiền" }], options: { ignore_cross: false } } })).id;
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe("nobody sees a dashboard that is not theirs", () => {
  for (const who of ["userA2", "leaderA", "mgrA", "admin", "userB1", "mgrB", "guestData", "guestSale"] as const) {
    it(`${who} gets nothing: not the dashboard, not the numbers, not the rows`, async () => {
      const c = roleOf(who);
      await denied(c("metrics.dashboard.view", { dashboard_id: dashId }));
      await denied(c("metrics.chart.data", { chart_id: chartId }));
      await denied(c("metrics.chart.rows", { chart_id: chartId }));
      await denied(c("metrics.chart.csv", { chart_id: chartId }));
      await denied(c("metrics.dashboard.filters.save", { dashboard_id: dashId, filters: {} }));
      expect((await c("metrics.dashboard.shared")).items.map((d: { id: string }) => d.id)).not.toContain(dashId);
    });
  }

  it("a person who is not the owner cannot change, share, export, import or preview a draft chart", async () => {
    const c = roleOf("userA2");
    await denied(c("metrics.dashboard.update", { dashboard_id: dashId, version: 1, name: "Hack" }));
    await denied(c("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: org.userA2.id }));
    await denied(c("metrics.dashboard.share.list", { dashboard_id: dashId }));
    await denied(c("metrics.dashboard.export", { dashboard_id: dashId }));
    await denied(c("metrics.dashboard.import", { datahub_id: dhId, dashboard: { format: "soe-dashboard", version: 1, name: "x", charts: [] } }));
    await denied(c("metrics.chart.create", { dashboard_id: dashId, chart: { type: "kpi", series: [{ metric_id: metricId }] } }));
    await denied(c("metrics.chart.data", { chart: { type: "kpi", series: [{ metric: { name: "x", source: tableId, measure: { agg: "sum", field: "Số tiền" } } }] }, datahub_id: dhId }));
    await denied(c("metrics.query", { metric_id: metricId }));
  });
});

describe("sharing with a person", () => {
  let shareId: string;

  it("only a member can receive it: not the owner, not a Guest, not someone unknown", async () => {
    expect((await fails(owner("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: org.userA1.id }))).details.reason).toBe("share_self");
    expect((await fails(owner("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: org.guestData.id }))).details.reason).toBe("grantee_is_guest");
    expect((await fails(owner("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: "01900000-0000-7000-8000-0000000000ff" }))).code).toBe("not_found");
  });

  it("the recipient sees the numbers computed with the owner's rights, without any right on the source table", async () => {
    const s = await owner("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: org.userA2.id });
    shareId = s.id;
    expect((await owner("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: org.userA2.id })).id).toBe(shareId); // sharing again changes nothing
    const c = roleOf("userA2");
    // the recipient cannot read the table or run the metric themselves
    await denied(c("metrics.query", { metric_id: metricId }));
    await denied(c("datahub.row.list", { table_id: tableId }));
    const v = await c("metrics.dashboard.view", { dashboard_id: dashId });
    expect(v.role).toBe("shared");
    expect(v.owner_name).toContain("UserA1");
    expect(v.charts).toHaveLength(1);
    // what they get of the chart is how to draw it, not how it is computed
    expect(JSON.stringify(v.charts[0].chart)).not.toContain(metricId);
    expect(v.charts[0].chart.series[0]).toEqual({ label: "Tiền" });
    expect(v.fields.map((f: { name: string }) => f.name)).toContain("Loại");
    const d = await c("metrics.chart.data", { chart_id: chartId });
    expect(Object.fromEntries(d.series[0].rows.map((r: { groups: { label: string }[]; value: number }) => [r.groups[0]!.label, r.value]))).toEqual({ POD: 30, DCC: 70 });
    expect(d.can_view_rows).toBe(false);
    expect((await c("metrics.dashboard.shared")).items.map((x: { id: string; role: string }) => [x.id, x.role])).toEqual([[dashId, "shared"]]);
    // and a dashboard filter reaches them too
    const f = await c("metrics.chart.data", { chart_id: chartId, filters: { conditions: [{ field: "Loại", op: "eq", value: "POD" }] } });
    expect(f.series[0].rows.map((r: { value: number }) => r.value)).toEqual([30]);
  });

  it("without the right on the source table the rows and the CSV are refused with a reason", async () => {
    const c = roleOf("userA2");
    expect((await fails(c("metrics.chart.rows", { chart_id: chartId }))).details.reason).toBe("no_source_access");
    expect((await fails(c("metrics.chart.csv", { chart_id: chartId }))).details.reason).toBe("no_source_access");
  });

  it("with the right on the table they see its rows, as many as they may read, and a CSV of them", async () => {
    await owner("datahub.share.set", { datahub_id: dhId, grantee_id: org.userA2.id, permission: "view" });
    const c = roleOf("userA2");
    expect((await c("metrics.chart.data", { chart_id: chartId })).can_view_rows).toBe(true);
    const r = await c("metrics.chart.rows", { chart_id: chartId });
    expect([r.total_visible, r.total_owner]).toEqual([4, 4]);
    expect(r.note).toBe("Bạn thấy 4/4 dòng tạo nên con số này.");
    expect(r.items.map((x: { data: Record<string, unknown> }) => Object.values(x.data).join("|"))).toHaveLength(4);
    // one group of the chart: the rows of POD only
    const pod = await c("metrics.chart.rows", { chart_id: chartId, group: JSON.stringify([(await c("metrics.chart.data", { chart_id: chartId })).series[0].rows.find((x: { groups: { label: string }[] }) => x.groups[0]!.label === "POD").groups[0].value]) });
    expect([pod.total_visible, pod.total_owner]).toEqual([2, 2]);
    // CSV: header, UTF-8 BOM, a cell that starts like a formula is marked as text, the clicked group only
    const csv = await c("metrics.chart.csv", { chart_id: chartId });
    expect(csv.csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Mã,Loại,Số tiền");
    expect(lines).toHaveLength(5);
    expect(lines.some((l: string) => l.startsWith("'=1+1,"))).toBe(true);
    expect(csv.rows).toBe(4);
  });

  it("a derived metric has no rows of its own", async () => {
    const dm = await owner("metrics.metric.create", { datahub_id: dhId, metric: { name: "Gấp đôi", formula: "=[Tổng tiền] * 2" } });
    const c = await owner("metrics.chart.create", { dashboard_id: dashId, chart: { type: "kpi", series: [{ metric_id: dm.id }] } });
    const d = await owner("metrics.chart.data", { chart_id: c.id });
    expect(d.can_view_rows).toBe(false);
    expect((await fails(owner("metrics.chart.rows", { chart_id: c.id }))).details.reason).toBe("no_rows_for_derived");
    await owner("metrics.chart.delete", { chart_id: c.id });
    await owner("metrics.metric.delete", { metric_id: dm.id });
  });

  it("removing the share closes the door, and the recipient's own filters go with it", async () => {
    const c = roleOf("userA2");
    await c("metrics.dashboard.filters.save", { dashboard_id: dashId, filters: { conditions: [{ field: "Loại", op: "eq", value: "DCC" }] } });
    await owner("metrics.dashboard.share.remove", { dashboard_id: dashId, share_id: shareId });
    await denied(c("metrics.dashboard.view", { dashboard_id: dashId }));
    await denied(c("metrics.chart.data", { chart_id: chartId }));
    expect((await owner("metrics.dashboard.share.list", { dashboard_id: dashId })).items).toEqual([]);
    expect((await fails(owner("metrics.dashboard.share.remove", { dashboard_id: dashId, share_id: shareId }))).code).toBe("not_found");
    const left = await t.c.db.db.execute(sql`SELECT 1 FROM mt_dashboard_prefs WHERE /*scope:system*/ dashboard_id = ${dashId}::uuid AND user_id = ${org.userA2.id}::uuid`);
    expect(left.rows).toHaveLength(0);
    await owner("datahub.share.remove", { datahub_id: dhId, share_id: (await owner("datahub.share.list", { datahub_id: dhId }))[0].id });
  });

  it("sharing, un-sharing and opening a shared dashboard are in the audit log", async () => {
    expect((await audits("metrics.dashboard.share.set")).map((a) => a.details.shared)).toEqual([true, false]);
    expect((await audits("metrics.dashboard.share.remove")).map((a) => a.details.removed)).toEqual([true]);
    const views = await audits("metrics.dashboard.view");
    expect(views.some((a) => a.target_id === dashId && a.details.role === "shared")).toBe(true);
    expect((await audits("metrics.chart.rows")).length).toBeGreaterThan(0);
    expect((await audits("metrics.chart.csv")).length).toBe(1);
  });
});

describe("the viewer's own filters", () => {
  it("are saved as a private copy, come back in `view`, and reset to the owner's default", async () => {
    await owner("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: org.userA2.id });
    const cur = await owner("metrics.dashboard.get", { dashboard_id: dashId });
    expect(cur.my_filters).toBeNull();
    expect(cur.role).toBe("owner");
    const def = { conditions: [{ field: "Loại", op: "eq", value: "POD" }] };
    await owner("metrics.dashboard.update", { dashboard_id: dashId, version: cur.version, filters: def });
    const c = roleOf("userA2");
    let v = await c("metrics.dashboard.view", { dashboard_id: dashId });
    expect(v.default_filters).toEqual(def);
    expect(v.my_filters).toBeNull();
    const mine = { range: "this_year", conditions: [{ field: "Loại", op: "in", value: ["DCC"] }] };
    await c("metrics.dashboard.filters.save", { dashboard_id: dashId, filters: mine });
    v = await c("metrics.dashboard.view", { dashboard_id: dashId });
    expect(v.my_filters.conditions).toEqual(mine.conditions);
    expect(v.default_filters).toEqual(def); // the owner's default did not change
    expect((await owner("metrics.dashboard.view", { dashboard_id: dashId })).my_filters).toBeNull(); // nor did the owner's own copy
    await c("metrics.dashboard.filters.reset", { dashboard_id: dashId });
    expect((await c("metrics.dashboard.view", { dashboard_id: dashId })).my_filters).toBeNull();
    // a filter the schema does not know is refused
    expect((await fails(c("metrics.dashboard.filters.save", { dashboard_id: dashId, filters: { conditions: [{ field: "Loại", op: "drop table", value: 1 }] } }))).code).toBe("validation_error");
    const g = await owner("metrics.dashboard.get", { dashboard_id: dashId });
    await owner("metrics.dashboard.update", { dashboard_id: dashId, version: g.version, filters: null });
    expect((await owner("metrics.dashboard.get", { dashboard_id: dashId })).default_filters).toEqual({});
  });
});

describe("Guests", () => {
  it("need a data grant covering the owner AND the owner opening the dashboard to Guests", async () => {
    const guest = roleOf("guestData");
    const mgr = roleOf("mgrA");
    await denied(guest("metrics.dashboard.view", { dashboard_id: dashId }));
    // a Guest cannot be given a dashboard directly; the data type exists for Managers to grant
    expect((await mgr("guest.data_type.list")).map((x: { key: string }) => x.key)).toContain("dashboard");
    const grant = await mgr("guest.grant.create", { guest_user_id: org.guestData.id, data_type: "dashboard", channels: ["web"] });
    await denied(guest("metrics.dashboard.view", { dashboard_id: dashId })); // the owner has not opened it to Guests
    const cur = await owner("metrics.dashboard.get", { dashboard_id: dashId });
    await owner("metrics.dashboard.update", { dashboard_id: dashId, version: cur.version, guest_visible: true });
    const v = await guest("metrics.dashboard.view", { dashboard_id: dashId });
    expect(v.role).toBe("guest");
    expect(v.charts[0].chart.series[0]).toEqual({ label: "Tiền" });
    expect((await guest("metrics.chart.data", { chart_id: chartId })).series[0].rows).toHaveLength(2);
    expect((await guest("metrics.dashboard.shared")).items.map((x: { id: string; role: string }) => [x.id, x.role])).toEqual([[dashId, "guest"]]);
    // the numbers yes, the rows never (a Guest cannot read the source table)
    expect((await guest("metrics.chart.data", { chart_id: chartId })).can_view_rows).toBe(false);
    expect((await fails(guest("metrics.chart.rows", { chart_id: chartId }))).details.reason).toBe("no_source_access");
    // a Guest of another place, and one without any grant, stay out
    await denied(roleOf("guestSale")("metrics.dashboard.view", { dashboard_id: dashId }));
    // revoking the grant closes it
    await mgr("guest.grant.revoke", { id: grant.id, version: grant.version });
    await denied(guest("metrics.dashboard.view", { dashboard_id: dashId }));
    const again = await owner("metrics.dashboard.get", { dashboard_id: dashId });
    await owner("metrics.dashboard.update", { dashboard_id: dashId, version: again.version, guest_visible: false });
  });

  it("a copy of a dashboard is not open to Guests", async () => {
    const cur = await owner("metrics.dashboard.get", { dashboard_id: dashId });
    await owner("metrics.dashboard.update", { dashboard_id: dashId, version: cur.version, guest_visible: true });
    const copy = await owner("metrics.dashboard.duplicate", { dashboard_id: dashId });
    expect(copy.guest_visible).toBe(false);
    await owner("metrics.dashboard.delete", { dashboard_id: copy.id });
    const g = await owner("metrics.dashboard.get", { dashboard_id: dashId });
    await owner("metrics.dashboard.update", { dashboard_id: dashId, version: g.version, guest_visible: false });
  });
});

describe("JSON export and import", () => {
  it("exports with saved metrics written out and tables by name; imports into the same or another datahub", async () => {
    const ex = await owner("metrics.dashboard.export", { dashboard_id: dashId });
    expect(ex.format).toBe("soe-dashboard");
    expect(ex.charts).toHaveLength(1);
    const s = ex.charts[0].series[0];
    expect(s.metric_id).toBeUndefined();
    expect(s.metric.source).toBe("Bảng 1"); // the table by name, not by id
    expect(s.label).toBe("Tiền");
    // same datahub: the name is taken, so the copy gets a free one
    const copy = await owner("metrics.dashboard.import", { datahub_id: dhId, dashboard: ex });
    expect(copy.name).toBe("Báo cáo riêng (bản sao)");
    expect(copy.charts).toHaveLength(1);
    expect(copy.role).toBe("owner");
    const again = await owner("metrics.chart.data", { chart_id: copy.charts[0].id });
    expect(Object.fromEntries(again.series[0].rows.map((r: { groups: { label: string }[]; value: number }) => [r.groups[0]!.label, r.value]))).toEqual({ POD: 30, DCC: 70 });
    // another datahub with a table of the same name and columns
    const y = await makeTable(owner, { name: "Datahub hai", columns: [{ name: "Mã", type: "text" }, { name: "Loại", type: "single_select", config: { options: [{ name: "POD" }, { name: "DCC" }] } }, { name: "Số tiền", type: "number" }] });
    await owner("datahub.row.batch", { table_id: y.tableId, ops: [{ op: "create", data: { Mã: "Z", Loại: "POD", "Số tiền": 5 } }] });
    const other = await owner("metrics.dashboard.import", { datahub_id: y.dhId, dashboard: ex, name: "Nhập từ JSON" });
    expect(other.name).toBe("Nhập từ JSON");
    expect((await owner("metrics.chart.data", { chart_id: other.charts[0].id })).series[0].rows[0].value).toBe(5);
  });

  it("refuses wrong JSON with the chart that is wrong; an unknown table, a missing format, too many charts", async () => {
    const bad = { format: "soe-dashboard", version: 1, name: "Sai", charts: [{ type: "kpi", series: [{ metric: { name: "x", source: "Không có bảng này", measure: { agg: "count" } } }] }] };
    const e = await fails(owner("metrics.dashboard.import", { datahub_id: dhId, dashboard: bad }));
    expect(e.message).toContain("Biểu đồ thứ 1");
    expect((await fails(owner("metrics.dashboard.import", { datahub_id: dhId, dashboard: { name: "x", charts: [] } }))).code).toBe("validation_error");
    expect((await fails(owner("metrics.dashboard.import", { datahub_id: dhId, dashboard: { format: "soe-dashboard", version: 1, name: "x", charts: [{ type: "histogram", series: [] }] } }))).code).toBe("validation_error");
    const many = { format: "soe-dashboard", version: 1, name: "Quá nhiều", charts: Array.from({ length: 31 }, () => ({ type: "note", text: "x" })) };
    expect((await fails(owner("metrics.dashboard.import", { datahub_id: dhId, dashboard: many }))).code).toBe("quota_exceeded");
    // nothing was half-created
    expect((await owner("metrics.dashboard.list", { datahub_id: dhId })).items.map((d: { name: string }) => d.name).sort()).toEqual(["Báo cáo riêng", "Báo cáo riêng (bản sao)"]);
  });

  it("keeps the common filters of the dashboard", async () => {
    const g = await owner("metrics.dashboard.get", { dashboard_id: dashId });
    await owner("metrics.dashboard.update", { dashboard_id: dashId, version: g.version, filters: { range: "this_year" } });
    const ex = await owner("metrics.dashboard.export", { dashboard_id: dashId });
    expect(ex.filters).toEqual({ range: { kind: "preset", preset: "this_year" } });
    const copy = await owner("metrics.dashboard.import", { datahub_id: dhId, dashboard: ex, name: "Có bộ lọc" });
    expect(copy.default_filters).toEqual(ex.filters);
  });
});

describe("the numbers are the owner's", () => {
  it("a recipient with no right on the table still gets the exact total", async () => {
    await owner("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: org.userA2.id });
    const kpi = await owner("metrics.chart.create", { dashboard_id: dashId, chart: { type: "kpi", series: [{ metric: { name: "Tổng", source: tableId, measure: { agg: "sum", field: "Số tiền" } } }] } });
    expect(total(await roleOf("userA2")("metrics.chart.data", { chart_id: kpi.id }))).toBe(100);
  });
});

describe("a viewer cannot use filters to probe the source table", () => {
  const num = { conditions: [{ field: "Số tiền", op: "eq", value: 10 }] };
  const reason = async (p: Promise<unknown>) => {
    const e = await fails(p);
    expect(e.code).toBe("forbidden");
    return e.details.reason;
  };
  const cases = (c: ReturnType<typeof as>) => async () => {
    const dash = await c("metrics.dashboard.view", { dashboard_id: dashId });
    const id = dash.charts[0].id as string;
    // a numeric column, a column that is not on the dashboard, a hidden/unknown column
    expect(await reason(c("metrics.chart.data", { chart_id: id, filters: num }))).toBe("filter_field_not_allowed");
    expect(await reason(c("metrics.chart.data", { chart_id: id, filters: { conditions: [{ field: "Bí mật", op: "eq", value: 1 }] } }))).toBe("filter_field_not_allowed");
    // text: exact value is the dashboard's own offer, "contains" would probe character by character
    expect(await reason(c("metrics.chart.data", { chart_id: id, filters: { conditions: [{ field: "Mã", op: "contains", value: "K" }] } }))).toBe("filter_field_not_allowed");
    // cross filters: a column no chart groups by, a chart of another dashboard
    expect(await reason(c("metrics.chart.data", { chart_id: id, filters: { cross: [{ field: "Số tiền", kind: "number", value: 10 }] } }))).toBe("filter_field_not_allowed");
    expect(await reason(c("metrics.chart.data", { chart_id: id, filters: { cross: [{ chart_id: "01900000-0000-7000-8000-000000000001", field: "Loại", kind: "enum", value: "POD" }] } }))).toBe("filter_field_not_allowed");
    // the same checks guard the rows, the CSV and the saved copy
    expect(await reason(c("metrics.chart.rows", { chart_id: id, filters: num }))).toBe("filter_field_not_allowed");
    expect(await reason(c("metrics.chart.csv", { chart_id: id, filters: num }))).toBe("filter_field_not_allowed");
    expect(await reason(c("metrics.dashboard.filters.save", { dashboard_id: dashId, filters: num }))).toBe("filter_field_not_allowed");
    // what the dashboard offers still works: an option of Loại, an exact Mã, a click on the Loại axis, any date range
    const ok = await c("metrics.chart.data", { chart_id: id, filters: { conditions: [{ field: "Loại", op: "eq", value: "POD" }, { field: "Mã", op: "eq", value: "K2" }], cross: [{ chart_id: id, field: "Loại", kind: "enum", value: "POD" }], range: "this_year" } });
    expect(ok.series[0].rows.length).toBeGreaterThanOrEqual(0);
  };

  it("a person it was shared with", async () => {
    await owner("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: org.userA2.id });
    await cases(roleOf("userA2"))();
  });

  it("a Guest with a grant, on a dashboard opened to Guests", async () => {
    const mgr = roleOf("mgrA");
    const grant = await mgr("guest.grant.create", { guest_user_id: org.guestData.id, data_type: "dashboard", channels: ["web"] });
    const cur = await owner("metrics.dashboard.get", { dashboard_id: dashId });
    await owner("metrics.dashboard.update", { dashboard_id: dashId, version: cur.version, guest_visible: true });
    await cases(roleOf("guestData"))();
    const again = await owner("metrics.dashboard.get", { dashboard_id: dashId });
    await owner("metrics.dashboard.update", { dashboard_id: dashId, version: again.version, guest_visible: false });
    await mgr("guest.grant.revoke", { id: grant.id, version: grant.version });
  });

  it("the owner filters freely, on any column and with contains", async () => {
    const id = chartId;
    const r = await owner("metrics.chart.data", { chart_id: id, filters: { conditions: [{ field: "Số tiền", op: "eq", value: 10 }] } });
    expect(r.notes).toEqual([]);
    expect((await owner("metrics.chart.data", { chart_id: id, filters: { conditions: [{ field: "Mã", op: "contains", value: "K" }] } })).series[0].rows.length).toBeGreaterThan(0);
  });
});
