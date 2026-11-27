import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { API, Session, type ProjectName, chooseOption } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";
import { seedMany } from "./dh-fixtures";

/**
 * Stage 3E-2: the final test of Stage 3 (dashboards), real api + worker + web.
 *  1. By role: owner, a person the dashboard is shared with (without / with the right on the source table), a Leader / Manager of the
 *     same tree and the Admin (not shared), Guests (grant + the owner's `guest_visible`).
 *  2. Worst-case data: empty table, 10.000 rows, huge and negative numbers, blank group value, markup in names.
 *  3. A few main flows on the phone (375px).
 * Every flow ends with "no console error, no unexpected 4xx/5xx" (Session.check). Screenshots only of the main screens.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-3e-${p}-9913`;
const RUN = Date.now().toString(36);
const email = (who: string) => `${p}.e3${who}${RUN}@base.vn`;
const name = (who: string) => `${who} 3E ${p} ${RUN}`;
const ROOT = path.join(process.cwd(), "../..");
const HUGE = 9_999_999_999_999;
const TOTAL_TEXT = "10.000.000.001.599"; // HUGE + 100 + 200 - 50 + 300 + 1000 - 25 + 75
const MARK = "<b>x</b>";

// Mã, Loại (null = blank), Trạng thái, Số tiền, Điểm, Ngày nhận, Ngày chốt, Phí
const ROWS: [string, string | null, string, number, number, string, string | null, number | null][] = [
  ["K1", "POD", "Won", 100, 10, "2026-01-10", "2026-01-20", 5],
  ["K2", "POD", "Won", 200, 20, "2026-01-15", "2026-02-05", -10],
  ["K3", "DCC", "Lost", -50, 30, "2026-01-20", "2026-03-01", null],
  ["K4", "DCC", "Won", 300, 40, "2026-02-03", "2026-02-10", null],
  ["K5", MARK, "Open", HUGE, 50, "2026-02-10", null, null],
  ["K6", null, "Won", 1000, 60, "2026-03-01", "2026-03-15", null],
  ["K7", "POD", "Lost", -25, 70, "2026-03-05", "2026-03-20", null],
  ["K8", null, "Open", 75, 80, "2026-03-10", null, null],
];

let admin: ApiClient;
let mgrApi: ApiClient;
let leaderApi: ApiClient;
let ownerApi: ApiClient;
let viewerNoApi: ApiClient;
let guestOkApi: ApiClient;
let guestNoApi: ApiClient;
let owner: Session;
let viewerNo: Session;
let viewerSrc: Session;
let guestOk: Session;
let sessions: Session[] = [];
let ids: Record<string, string> = {};
let hubId: string;
let dealsId: string;
let emptyId: string;
let mergedId: string;
let fullId = ""; // the dashboard of every chart type
let guestDashId = "";
let hiddenDashId = "";

const cardOf = (page: Page, title: string): Locator => page.locator("section[data-chart-id]").filter({ has: page.getByRole("heading", { level: 3, name: title, exact: true }) });
const cells = async (card: Locator) => card.getByTestId("chart-data").locator("tbody tr").evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll("th,td")].map((c) => (c.textContent ?? "").trim())));
const outcome = async (fn: () => Promise<unknown>): Promise<{ status: number; code: string; reason: string }> => {
  try {
    await fn();
    return { status: 200, code: "", reason: "" };
  } catch (e) {
    const msg = (e as Error).message;
    const body = msg.slice(msg.indexOf("{"));
    let code = "";
    let reason = "";
    try {
      const j = JSON.parse(body) as { error?: { code?: string; details?: { reason?: string } } };
      code = j.error?.code ?? "";
      reason = j.error?.details?.reason ?? "";
    } catch {
      /* not JSON */
    }
    return { status: Number(/-> (\d{3})/.exec(msg)?.[1] ?? 0), code, reason };
  }
};
const qs = (o: Record<string, unknown>) => "?" + Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === "string" ? v : JSON.stringify(v))}`).join("&");
const seriesOf = (source: string, label: string, agg: string, field?: string, extra: Record<string, unknown> = {}, metricExtra: Record<string, unknown> = {}) => ({
  metric: { name: label, source, measure: { agg, ...(field ? { field } : {}) }, ...metricExtra },
  label,
  ...extra,
});
const mkChart = (api: ApiClient, dashId: string, type: string, title: string, series: unknown[], options: Record<string, unknown> = {}, layout?: unknown, text?: string) =>
  api.call<{ id: string }>("POST", `/dashboards/${dashId}/charts`, { chart: { type, title, series, options, ...(layout ? { layout } : {}), ...(text ? { text } : {}) } });
const at = (i: number) => ({ x: (i % 2) * 6, y: Math.floor(i / 2) * 6, w: 6, h: 6 });

/** One chart of every type over a table with these columns: Mã, Loại, Trạng thái, Số tiền, Điểm, Ngày nhận, Ngày chốt. */
async function everyType(api: ApiClient, dashId: string, src: string, tag: string) {
  const g = (f: string) => ({ group_by: [{ field: f }] });
  const month = { time: { field: "Ngày nhận", bucket: "month" } };
  const sum = (l: string, extra: Record<string, unknown> = {}, me: Record<string, unknown> = {}) => seriesOf(src, l, "sum", "Số tiền", extra, me);
  const xy = (f: string) => seriesOf(src, f, "sum", f, { ...g("Mã") });
  const defs: [string, string, unknown[], Record<string, unknown>?, string?][] = [
    ["kpi", "KPI", [sum("Tổng")]],
    ["column", "Cột", [sum("Tiền", g("Loại"))]],
    ["bar", "Thanh", [sum("Tiền", g("Loại"))]],
    ["line", "Đường", [sum("Tiền", month)]],
    ["area", "Vùng", [sum("Tiền", month)]],
    ["combo", "Kết hợp", [sum("Tiền", { ...month, kind: "bar", axis: "left" }), seriesOf(src, "Số deal", "count", undefined, { ...month, kind: "line", axis: "right" })]],
    ["pie", "Tròn", [sum("Tiền", g("Loại"))]],
    ["donut", "Donut", [sum("Tiền", g("Loại"))]],
    ["table", "Bảng", [sum("Tiền", g("Mã"))]],
    ["pivot", "Pivot", [sum("Tiền", { ...month, ...g("Loại") })], { totals: true }],
    ["note", "Ghi chú", [], {}, "Một ghi chú ngắn"],
    ["bullet", "Bullet", [sum("Tiền", { target: { value: 5000 } })], { bands: [{ label: "KPI", value: 3000 }, { label: "Goal", value: 4000 }] }],
    ["gauge", "Đồng hồ", [sum("Tiền", { target: { value: 5000 } })]],
    ["funnel", "Phễu", [seriesOf(src, "Tất cả", "count"), seriesOf(src, "Won", "count", undefined, {}, { filter: { field: "Trạng thái", op: "eq", value: "Won" } })]],
    ["boxplot", "Box plot", [sum("Tiền", g("Loại"))]],
    ["histogram", "Histogram", [sum("Tiền")], { bins: 4 }],
    ["scatter", "Scatter", [xy("Số tiền"), xy("Điểm")]],
    ["matrix", "Ma trận", [xy("Số tiền"), xy("Điểm")]],
    ["heatmap", "Heatmap", [sum("Tiền", { group_by: [{ field: "Loại" }, { field: "Trạng thái" }] })]],
    ["waterfall", "Waterfall", [sum("Đầu kỳ", { step: "start" }), sum("Thua", { step: "subtract" }, { filter: { field: "Trạng thái", op: "eq", value: "Lost" } }), sum("Mở", { step: "add" }, { filter: { field: "Trạng thái", op: "eq", value: "Open" } })]],
    ["ranking", "Xếp hạng", [sum("Tiền", g("Mã"))], { top_n: 3 }],
    ["cohort", "Cohort", [seriesOf(src, "Chốt", "count", undefined, {}, { cohort: { start: "Ngày nhận", event: "Ngày chốt", bucket: "month" } })]],
  ];
  const titles: string[] = [];
  let i = 0;
  for (const [type, title, series, options, text] of defs) {
    const t = `${title} ${tag}`;
    titles.push(t);
    await mkChart(api, dashId, type, t, series, options ?? {}, at(i++), text);
  }
  return titles;
}

async function waitAllCharts(pg: Page, titles: string[]) {
  for (const t of titles) {
    const card = cardOf(pg, t);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("[data-chart-ready], [data-testid=kpi-value], [data-testid=chart-data], [data-testid=chart-note], table, p, [role=alert]").first(), t).toBeVisible({ timeout: 20_000 });
  }
}

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  admin = await createAdmin(API, email("admin"), name("Admin"), PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: name("Manager"), roles: ["manager"] },
      { email: email("leader"), name: name("Leader"), roles: ["leader"], manager: email("mgr") },
      { email: email("owner"), name: name("Chủ"), roles: ["user"], manager: email("mgr"), leader: email("leader") },
      { email: email("vno"), name: name("Xem không quyền"), roles: ["user"], manager: email("mgr"), leader: email("leader") },
      { email: email("vsrc"), name: name("Xem có quyền"), roles: ["user"], manager: email("mgr"), leader: email("leader") },
      { email: email("gok"), name: name("Guest được cấp"), roles: ["guest"], manager: email("mgr"), guestPreset: "data" },
      { email: email("gno"), name: name("Guest không cấp"), roles: ["guest"], manager: email("mgr"), guestPreset: "data" },
    ],
    PASSWORD(),
  );
  const login = (w: string) => new ApiClient(API).login(email(w), PASSWORD());
  mgrApi = await login("mgr");
  leaderApi = await login("leader");
  ownerApi = await login("owner");
  viewerNoApi = await login("vno");
  guestOkApi = await login("gok");
  guestNoApi = await login("gno");

  hubId = (await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: `Doanh thu 3E ${p} ${RUN}` })).id;
  dealsId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/tables`, { name: `Deals ${p}` })).id;
  const col = (t: string, n: string, type: string, config?: unknown) => ownerApi.call("POST", `/tables/${t}/columns`, { name: n, type, ...(config ? { config } : {}) });
  await col(dealsId, "Mã", "text");
  await col(dealsId, "Loại", "single_select", { options: [{ name: "POD" }, { name: "DCC" }, { name: MARK }] });
  await col(dealsId, "Trạng thái", "single_select", { options: [{ name: "Won" }, { name: "Lost" }, { name: "Open" }] });
  await col(dealsId, "Số tiền", "number");
  await col(dealsId, "Điểm", "number");
  await col(dealsId, "Ngày nhận", "date");
  await col(dealsId, "Ngày chốt", "date");
  await col(dealsId, "Phí <b>x</b>", "number");
  await ownerApi.call("POST", `/tables/${dealsId}/rows/batch`, {
    ops: ROWS.map(([Mã, Loại, st, tien, diem, nhan, chot, phi]) => ({
      op: "create",
      data: { Mã, ...(Loại ? { Loại } : {}), "Trạng thái": st, "Số tiền": tien, Điểm: diem, "Ngày nhận": nhan, ...(chot ? { "Ngày chốt": chot } : {}), ...(phi !== null ? { "Phí <b>x</b>": phi } : {}) },
    })),
  });
  emptyId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/tables`, { name: `Rỗng ${p}` })).id;
  await col(emptyId, "Mã", "text");
  await col(emptyId, "Loại", "single_select", { options: [{ name: "POD" }] });
  await col(emptyId, "Trạng thái", "single_select", { options: [{ name: "Won" }, { name: "Lost" }, { name: "Open" }] });
  for (const n of ["Số tiền", "Điểm"]) await col(emptyId, n, "number");
  for (const n of ["Ngày nhận", "Ngày chốt"]) await col(emptyId, n, "date");

  // A merged table over two small sources.
  const mk2 = async (n: string, rows: [string, number][]) => {
    const t = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/tables`, { name: `${n} ${p}` })).id;
    await col(t, "MST", "text");
    await col(t, "Số", "number");
    await ownerApi.call("POST", `/tables/${t}/rows/batch`, { ops: rows.map(([MST, Số]) => ({ op: "create", data: { MST, Số } })) });
    return t;
  };
  const sa = await mk2("Nguồn A", [["A1", 10], ["A2", -4]]);
  const sb = await mk2("Nguồn B", [["B1", 1000]]);
  mergedId = (await ownerApi.call<{ table: { id: string } }>("POST", `/datahubs/${hubId}/merged-tables`, { name: `Gộp ${p}`, sources: [sa, sb] })).table.id;
  await expect
    .poll(async () => (await ownerApi.call<{ syncing: boolean }>("GET", `/tables/${mergedId}/merge`)).syncing, { timeout: 20_000 })
    .toBe(false);

  // The dashboard of every chart type, plus a chart on the merged table.
  fullId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Đủ loại" })).id;
  const titles = await everyType(ownerApi, fullId, dealsId, "");
  await mkChart(ownerApi, fullId, "kpi", "Gộp tổng", [seriesOf(mergedId, "Gộp", "sum", "Số")], {}, at(titles.length));
  await mkChart(ownerApi, fullId, "kpi", "Phí lạ", [seriesOf(dealsId, "Phí", "sum", "Phí <b>x</b>")], {}, at(titles.length + 1));
  guestDashId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Cho Guest" })).id;
  await mkChart(ownerApi, guestDashId, "kpi", "Tổng cho Guest", [seriesOf(dealsId, "Tổng", "sum", "Số tiền")], {}, { x: 0, y: 0, w: 4, h: 3 });
  hiddenDashId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Chưa mở Guest" })).id;
  await mkChart(ownerApi, hiddenDashId, "kpi", "Tổng kín", [seriesOf(dealsId, "Tổng", "sum", "Số tiền")], {}, { x: 0, y: 0, w: 4, h: 3 });
  const gd = await ownerApi.call<{ version: number }>("GET", `/dashboards/${guestDashId}`);
  await ownerApi.call("PATCH", `/dashboards/${guestDashId}`, { version: gd.version, guest_visible: true });
  await mgrApi.call("POST", "/guest/grants", { guest_user_id: ids[email("gok")], data_type: "dashboard", channels: ["web"] });
  // vsrc has the right on the source table (a share of the whole datahub), vno does not.
  await ownerApi.call("PUT", `/datahubs/${hubId}/shares`, { grantee_id: ids[email("vsrc")], permission: "view" });
  for (const d of [fullId, guestDashId]) {
    for (const w of ["vno", "vsrc"]) await ownerApi.call("PUT", `/dashboards/${d}/shares`, { grantee_id: ids[email(w)] });
  }

  owner = await Session.open(browser, p, "owner");
  viewerNo = await Session.open(browser, p, "vno");
  viewerSrc = await Session.open(browser, p, "vsrc");
  guestOk = await Session.open(browser, p, "gok");
  sessions = [owner, viewerNo, viewerSrc, guestOk];
  for (const s of [viewerNo, viewerSrc, guestOk]) s.allow(403, /\/api\/v1\//).allow(404, /\/api\/v1\//);
  owner.allow(409, /\/api\/v1\/dashboards\//).allow(422, /\/api\/v1\//).allow(400, /\/api\/v1\//);
  for (const [s, who] of [[owner, "owner"], [viewerNo, "vno"], [viewerSrc, "vsrc"], [guestOk, "gok"]] as const) {
    await s.login(email(who), PASSWORD());
    await expect(s.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  }
});

test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-3e-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Owner
// ---------------------------------------------------------------------------------------------------------------------------------

test("chủ: dashboard đủ 22 loại biểu đồ vẽ được; số khớp số tính tay và API; tên có <b> hiện là chữ; số lớn, số âm, giá trị trống", async () => {
  test.skip(p === "phone");
  test.setTimeout(120_000);
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/dashboard/${fullId}`);
  const types = ["KPI", "Cột", "Thanh", "Đường", "Vùng", "Kết hợp", "Tròn", "Donut", "Bảng", "Pivot", "Ghi chú", "Bullet", "Đồng hồ", "Phễu", "Box plot", "Histogram", "Scatter", "Ma trận", "Heatmap", "Waterfall", "Xếp hạng", "Cohort"].map((t) => `${t} `);
  await waitAllCharts(pg, types.map((t) => t));
  await expect(pg.getByRole("alert")).toHaveCount(0); // no chart in an error state

  // by hand: the total and the groups
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await expect(cardOf(pg, "Gộp tổng").getByTestId("kpi-value")).toHaveText("1.006");
  await expect(cardOf(pg, "Phí lạ").getByTestId("kpi-value")).toHaveText("-5");
  const col = await cells(cardOf(pg, "Cột "));
  const by = Object.fromEntries(col.map((r) => [r[0]!, r[1]!]));
  expect(by["POD"]).toBe("275");
  expect(by["DCC"]).toBe("250");
  expect(by[MARK]).toBe("9.999.999.999.999"); // markup is text, the number is not cut
  expect(col).toHaveLength(4); // POD, DCC, the markup option and the blank group
  expect(Object.values(by).sort()).toContain("1.075"); // blank Loại: K6 + K8
  await expect(cardOf(pg, "Cột ").locator("b")).toHaveCount(0);
  const rk = await cells(cardOf(pg, "Xếp hạng "));
  expect(rk[0]).toEqual(["1", "K5", "9.999.999.999.999"]);
  expect(rk).toHaveLength(3);
  const tb = await cardOf(pg, "Bảng ").locator("tbody tr").evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll("th,td")].map((c) => (c.textContent ?? "").trim())));
  expect(tb.find((r) => r[0] === "K3")![1]).toBe("-50");
  expect(tb.find((r) => r[0] === "K5")![1]).toBe("9.999.999.999.999");

  // the same numbers as the API of the dashboard (one place computes)
  const api = async (title: string) => {
    const d = await ownerApi.call<{ charts: { id: string; chart: { title: string } }[] }>("GET", `/dashboards/${fullId}`);
    const c = d.charts.find((x) => x.chart.title === title)!;
    return ownerApi.call<{ series: { rows: { group?: unknown[]; value: number | null }[] }[]; view: Record<string, any> | null }>("GET", `/chart-data${qs({ chart_id: c.id })}`); // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  expect((await api("KPI ")).series[0]!.rows[0]!.value).toBe(HUGE + 1600);
  const hist = (await api("Histogram ")).view as { bins: { count: number }[]; min: number; max: number; total: number };
  expect(hist.total).toBe(8);
  expect(hist.min).toBe(-50);
  expect(hist.max).toBe(HUGE);
  expect(hist.bins.map((b) => b.count)).toEqual([7, 0, 0, 1]);
  expect((await cells(cardOf(pg, "Histogram "))).map((r) => r[1])).toEqual(["7", "0", "0", "1"]);
  const box = (await api("Box plot ")).view as { groups: { label: string; n: number; min: number; median: number; max: number }[] };
  const pod = box.groups.find((g) => g.label === "POD")!;
  expect([pod.n, pod.min, pod.median, pod.max]).toEqual([3, -25, 100, 200]);
  const wf = (await api("Waterfall ")).view as { steps: { label: string; delta: number; start: number; end: number }[] };
  const wfUi = await cells(cardOf(pg, "Waterfall "));
  expect(wfUi).toHaveLength(wf.steps.length);
  const last = wf.steps[wf.steps.length - 1]!;
  expect(last.end).toBe(2 * HUGE + 1750); // start (HUGE+1600) - (-75 of the Lost rows) + (HUGE+75 of the Open rows)
  // gauge with a huge value: the axis labels and the centre text have thousands dots, no float noise, and the axis ends on a round step
  const gaugeTexts = await cardOf(pg, "Đồng hồ ").locator("[data-chart-ready]").first().evaluate((el) => {
    const o = (el as unknown as { __echart: { getOption: () => { series: { max: number; axisLabel: { formatter: (x: number) => string }; detail: { formatter: (x: number) => string } }[] } } }).__echart.getOption().series[0]!;
    return { max: o.max, ticks: [0, 1, 2, 3, 4, 5].map((i) => o.axisLabel.formatter((o.max / 5) * i)), centre: o.detail.formatter(200_000_000_000_040) };
  });
  expect(gaugeTexts.max).toBe(3e11); // reached share 200.000.000.032 % -> next round step
  for (const t of [...gaugeTexts.ticks, gaugeTexts.centre]) expect(t, t).toMatch(/^(0|\d{1,3}(\.\d{3})*)%$/);
  expect(gaugeTexts.centre).toBe("200.000.000.000.040%");
  await owner.shot("3e-dashboard-all-types");
});

test("chủ: bộ lọc chung, lọc chéo, xem các dòng, CSV, PNG, xuất rồi nhập JSON", async () => {
  test.skip(p === "phone");
  test.setTimeout(120_000);
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/dashboard/${fullId}`);
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  // common filter
  await chooseOption(pg.getByTestId("filter-field"), { label: "Loại" });
  await chooseOption(pg.getByTestId("filter-value"), { label: "POD" });
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText("275");
  await pg.getByTestId("filter-reset").click();
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  // the rows behind the number, and the CSV
  await cardOf(pg, "KPI ").getByTestId("kpi-rows").click();
  const dlg = pg.getByRole("dialog");
  await expect(dlg.getByTestId("rows-note")).toHaveText("Bạn thấy 8/8 dòng tạo nên con số này.");
  await expect(dlg.getByTestId("rows-table")).toContainText("9.999.999.999.999");
  await expect(dlg.getByTestId("rows-table")).toContainText("10/01/2026"); // a date is written as a date
  const [csv] = await Promise.all([pg.waitForEvent("download"), dlg.getByTestId("rows-csv").click()]);
  const lines = fs.readFileSync((await csv.path())!, "utf8").slice(1).trim().split(/\r?\n/);
  expect(lines).toHaveLength(9);
  await dlg.getByRole("button", { name: "Đóng", exact: true }).click();
  // PNG
  await cardOf(pg, "Cột ").getByRole("button", { name: /Tuỳ chọn biểu đồ Cột/ }).click();
  const [png] = await Promise.all([pg.waitForEvent("download"), pg.getByRole("menuitem", { name: "Xuất PNG" }).click()]);
  expect([...fs.readFileSync((await png.path())!).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  // cross filter: click the tall column (the markup option, 9.999.999.999.999); the POD bar is sub-pixel next to it
  const box = cardOf(pg, "Cột ").locator("[data-chart-ready]").first();
  const pt = await box.evaluate((el, c) => (el as unknown as { __echart: { convertToPixel: (f: unknown, v: unknown) => number[] } }).__echart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, c), [MARK, HUGE / 2]);
  const bb = (await box.boundingBox())!;
  await pg.mouse.click(bb.x + pt[0]!, bb.y + pt[1]!);
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText("9.999.999.999.999");
  await expect(pg.getByTestId("cross-chip")).toBeVisible();
  await pg.getByRole("button", { name: /Bỏ lọc chéo từ/ }).click();
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  // JSON out and in again: the copy draws the same numbers
  await pg.getByRole("button", { name: /Tuỳ chọn dashboard Đủ loại/ }).click();
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.getByRole("menuitem", { name: "Xuất JSON" }).click()]);
  const json = fs.readFileSync((await dl.path())!, "utf8");
  expect((JSON.parse(json) as { charts: unknown[] }).charts).toHaveLength(24);
  await pg.getByTestId("import-json").click();
  await pg.getByRole("dialog").getByTestId("import-text").fill(json);
  await pg.getByRole("dialog").getByRole("button", { name: "Nhập dashboard" }).click();
  await expect(pg.getByRole("dialog")).toBeHidden();
  await expect(pg.getByRole("tab", { name: "Đủ loại (bản sao)" })).toHaveAttribute("aria-selected", "true");
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await expect(cardOf(pg, "Gộp tổng").getByTestId("kpi-value")).toHaveText("1.006");
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Roles
// ---------------------------------------------------------------------------------------------------------------------------------

test("được chia sẻ dashboard, không có quyền bảng nguồn: thấy đúng số của chủ, lọc thành bản riêng, không xem dòng/CSV; API trực tiếp bị chặn", async () => {
  test.skip(p === "phone");
  const vp = viewerNo.page;
  await vp.goto("/dashboard");
  await vp.getByTestId("shared-dashboard").filter({ hasText: "Đủ loại" }).click();
  await expect(vp.getByTestId("dash-owner")).toContainText(name("Chủ"));
  await expect(cardOf(vp, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT); // the same number as the owner
  const col = await cells(cardOf(vp, "Cột "));
  expect(Object.fromEntries(col.map((r) => [r[0]!, r[1]!]))["POD"]).toBe("275");
  await expect(vp.getByTestId("kpi-rows")).toHaveCount(0);
  await expect(vp.getByTestId("add-chart")).toHaveCount(0);
  await cardOf(vp, "Cột ").getByRole("button", { name: /Tuỳ chọn biểu đồ Cột/ }).click();
  await expect(vp.getByRole("menuitem", { name: /Xem các dòng/ })).toHaveCount(0);
  await expect(vp.getByRole("menuitem", { name: /CSV/ })).toHaveCount(0);
  await vp.keyboard.press("Escape");
  // own filter: a copy of the person, the default of the owner stays
  await chooseOption(vp.getByTestId("filter-field"), { label: "Loại" });
  await chooseOption(vp.getByTestId("filter-value"), { label: "POD" });
  await expect(cardOf(vp, "KPI ").getByTestId("kpi-value")).toHaveText("275");
  await expect.poll(async () => (await viewerNoApi.call<{ my_filters: unknown }>("GET", `/dashboards/${fullId}/view`)).my_filters).not.toBeNull();
  expect((await ownerApi.call<{ my_filters: unknown }>("GET", `/dashboards/${fullId}`)).my_filters).toBeNull();
  await vp.getByTestId("filter-reset").click();
  await expect(cardOf(vp, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await viewerNo.shot("3e-dashboard-shared-no-source");

  // straight to the API
  const d = await viewerNoApi.call<{ charts: { id: string; chart: { title: string } }[] }>("GET", `/dashboards/${fullId}/view`);
  const cid = d.charts.find((c) => c.chart.title === "Cột ")!.id;
  const rows = await outcome(() => viewerNoApi.call("GET", `/chart-rows${qs({ chart_id: cid })}`));
  expect([rows.code, rows.reason]).toEqual(["forbidden", "no_source_access"]);
  expect((await outcome(() => viewerNoApi.call("GET", `/chart-csv${qs({ chart_id: cid })}`))).code).toBe("forbidden");
  expect((await outcome(() => viewerNoApi.call("GET", `/tables/${dealsId}/rows`))).code).toBe("not_found");
  // a filter on a column the dashboard does not offer (a number column; "contains" on text) is refused, not dropped
  const bad = await outcome(() => viewerNoApi.call("GET", `/chart-data${qs({ chart_id: cid, filters: { conditions: [{ field: "Điểm", op: "eq", value: 10 }] } })}`));
  expect([bad.code, bad.reason]).toEqual(["forbidden", "filter_field_not_allowed"]);
  const bad2 = await outcome(() => viewerNoApi.call("GET", `/chart-data${qs({ chart_id: cid, filters: { conditions: [{ field: "Mã", op: "contains", value: "K" }] } })}`));
  expect(bad2.code).toBe("forbidden");
  const bad3 = await outcome(() => viewerNoApi.call("GET", `/chart-data${qs({ chart_id: cid, filters: { cross: [{ field: "Điểm", kind: "number", value: 10 }] } })}`));
  expect(bad3.code).toBe("forbidden");
  // the allowed filter works
  const okF = await viewerNoApi.call<{ series: { rows: { value: number }[] }[] }>("GET", `/chart-data${qs({ chart_id: d.charts.find((c) => c.chart.title === "KPI ")!.id, filters: { conditions: [{ field: "Loại", op: "eq", value: "DCC" }] } })}`);
  expect(okF.series[0]!.rows[0]!.value).toBe(250);
});

test("được chia sẻ dashboard và có quyền xem bảng nguồn: xem các dòng hiện \"Bạn thấy x/y\"", async () => {
  test.skip(p === "phone");
  const vp = viewerSrc.page;
  await vp.goto("/dashboard");
  await vp.getByTestId("shared-dashboard").filter({ hasText: "Đủ loại" }).click();
  await expect(cardOf(vp, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await cardOf(vp, "KPI ").getByTestId("kpi-rows").click();
  await expect(vp.getByRole("dialog").getByTestId("rows-note")).toHaveText("Bạn thấy 8/8 dòng tạo nên con số này.");
  await expect(vp.getByRole("dialog").getByTestId("rows-table")).toContainText("K5");
  await viewerSrc.shot("3e-dashboard-rows-box");
  await vp.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).first().click();
  // the owner's JSON/edit door stays closed for him
  await expect(vp.getByTestId("add-chart")).toHaveCount(0);
});

test("Leader/Manager cùng cây không được chia sẻ, và Admin: không thấy dashboard của chủ (not_found)", async () => {
  test.skip(p === "phone");
  for (const [who, api] of [["leader", leaderApi], ["mgr", mgrApi], ["admin", admin]] as const) {
    for (const url of [`/dashboards/${fullId}`, `/dashboards/${fullId}/view`, `/dashboards/${guestDashId}/view`]) {
      const r = await outcome(() => api.call("GET", url));
      expect([who, url, r.status, r.code]).toEqual([who, url, 404, "not_found"]);
    }
    const d = await ownerApi.call<{ charts: { id: string }[] }>("GET", `/dashboards/${fullId}`);
    const c = await outcome(() => api.call("GET", `/chart-data${qs({ chart_id: d.charts[0]!.id })}`));
    expect([who, c.code]).toEqual([who, "not_found"]);
    const shared = await api.call<unknown[]>("GET", "/dashboards/shared");
    expect(JSON.stringify(shared), who).not.toContain(fullId);
  }
  // the owner's own list still has them
  expect((await ownerApi.call<unknown[]>("GET", `/datahubs/${hubId}/dashboards`)).length).toBeGreaterThanOrEqual(3);
});

test("Guest: được Manager cấp loại dashboard và chủ bật guest_visible thì xem số; thiếu một trong hai thì không", async () => {
  test.skip(p === "phone");
  const gp = guestOk.page;
  await gp.goto("/dashboard");
  await expect(gp.getByTestId("shared-dashboard").filter({ hasText: "Cho Guest" })).toBeVisible();
  await expect(gp.getByTestId("shared-dashboard").filter({ hasText: "Chưa mở Guest" })).toHaveCount(0); // granted but the owner did not open it
  await gp.getByTestId("shared-dashboard").filter({ hasText: "Cho Guest" }).click();
  await expect(cardOf(gp, "Tổng cho Guest").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await expect(gp.getByTestId("kpi-rows")).toHaveCount(0);
  await expect(gp.getByTestId("add-chart")).toHaveCount(0);
  await guestOk.shot("3e-dashboard-guest");
  expect((await outcome(() => guestOkApi.call("GET", `/dashboards/${hiddenDashId}/view`))).code).toBe("not_found");
  const g = await guestOkApi.call<{ charts: { id: string; chart: { series: unknown[] } }[] }>("GET", `/dashboards/${guestDashId}/view`);
  expect(JSON.stringify(g.charts[0]!.chart.series)).not.toContain("measure");
  expect((await outcome(() => guestOkApi.call("GET", `/chart-rows${qs({ chart_id: g.charts[0]!.id })}`))).code).toBe("forbidden");
  // opened by the owner but never granted by the Manager: nothing
  const gd = await outcome(() => guestNoApi.call("GET", `/dashboards/${guestDashId}/view`));
  expect(gd.code).toBe("not_found");
  expect(JSON.stringify(await guestNoApi.call("GET", "/dashboards/shared"))).not.toContain(guestDashId);
  // closing "guest_visible" shuts the door again
  const cur = await ownerApi.call<{ version: number }>("GET", `/dashboards/${guestDashId}`);
  await ownerApi.call("PATCH", `/dashboards/${guestDashId}`, { version: cur.version, guest_visible: false });
  expect((await outcome(() => guestOkApi.call("GET", `/dashboards/${guestDashId}/view`))).code).toBe("not_found");
  await ownerApi.call("PATCH", `/dashboards/${guestDashId}`, { version: cur.version + 1, guest_visible: true });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. Worst-case data
// ---------------------------------------------------------------------------------------------------------------------------------

test("bảng rỗng: cả 22 loại biểu đồ hiện trạng thái rỗng, không lỗi", async () => {
  test.skip(p === "phone");
  test.setTimeout(120_000);
  const pg = owner.page;
  const d = await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Bảng rỗng" });
  const titles = await everyType(ownerApi, d.id, emptyId, "rỗng");
  await pg.goto(`/datahub/${hubId}/dashboard/${d.id}`);
  await waitAllCharts(pg, titles);
  await expect(pg.getByRole("alert")).toHaveCount(0);
  await expect(cardOf(pg, "KPI rỗng").getByTestId("kpi-value")).toHaveText("—");
  for (const t of ["Cột", "Tròn", "Đường", "Histogram"]) await expect(cardOf(pg, `${t} rỗng`).getByText("Chưa có dữ liệu")).toBeVisible();
  await owner.shot("3e-dashboard-empty");
});

test("10.000 dòng: số khớp số tính tay, mọi biểu đồ xong trong vài giây", async () => {
  test.skip(p === "phone");
  test.setTimeout(180_000);
  const pg = owner.page;
  const big = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/tables`, { name: `Lớn ${p}` })).id;
  await ownerApi.call("POST", `/tables/${big}/columns`, { name: "Mã", type: "text" });
  await ownerApi.call("POST", `/tables/${big}/columns`, { name: "Loại", type: "single_select", config: { options: [{ name: "POD" }, { name: "DCC" }] } });
  await ownerApi.call("POST", `/tables/${big}/columns`, { name: "Số tiền", type: "number" });
  await seedMany(ownerApi, big, 10_000, (i) => ({ Mã: `M${i}`, ...(i % 3 === 0 ? { Loại: "POD" } : i % 3 === 1 ? { Loại: "DCC" } : {}), "Số tiền": i - 5000 }));
  const d = await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Mười nghìn dòng" });
  const mk = (type: string, title: string, series: unknown[], options: Record<string, unknown>, i: number) => mkChart(ownerApi, d.id, type, title, series, options, at(i));
  await mk("kpi", "Tổng 10k", [seriesOf(big, "Tổng", "sum", "Số tiền")], {}, 0);
  await mk("kpi", "Đếm 10k", [seriesOf(big, "Đếm", "count")], {}, 1);
  await mk("column", "Loại 10k", [seriesOf(big, "Số", "count", undefined, { group_by: [{ field: "Loại" }] })], {}, 2);
  await mk("histogram", "Phân bố 10k", [seriesOf(big, "Tiền", "sum", "Số tiền")], { bins: 5 }, 3);
  await mk("boxplot", "Box 10k", [seriesOf(big, "Tiền", "sum", "Số tiền", { group_by: [{ field: "Loại" }] })], {}, 4);
  await mk("ranking", "Hạng 10k", [seriesOf(big, "Tiền", "sum", "Số tiền", { group_by: [{ field: "Mã" }] })], { top_n: 5 }, 5);
  const t0 = Date.now();
  await pg.goto(`/datahub/${hubId}/dashboard/${d.id}`);
  // sum of (i - 5000), i = 0..9999 = 49.995.000 - 50.000.000 = -5.000
  await expect(cardOf(pg, "Tổng 10k").getByTestId("kpi-value")).toHaveText("-5.000", { timeout: 20_000 });
  await expect(cardOf(pg, "Đếm 10k").getByTestId("kpi-value")).toHaveText("10.000");
  await expect(cardOf(pg, "Loại 10k").locator("[data-chart-ready]").first()).toBeVisible();
  const cnt = Object.fromEntries((await cells(cardOf(pg, "Loại 10k"))).map((r) => [r[0]!, r[1]!]));
  expect(cnt["POD"]).toBe("3.334");
  expect(cnt["DCC"]).toBe("3.333");
  expect(Object.values(cnt)).toContain("3.333");
  await expect(cardOf(pg, "Phân bố 10k").locator("[data-chart-ready]").first()).toBeVisible();
  expect((await cells(cardOf(pg, "Phân bố 10k"))).map((r) => Number(r[1]!.replace(/\./g, ""))).reduce((a, b) => a + b, 0)).toBe(10_000);
  await expect(cardOf(pg, "Hạng 10k").locator("[data-chart-ready]").first()).toBeVisible();
  const rk = await cells(cardOf(pg, "Hạng 10k"));
  expect(rk[0]).toEqual(["1", "M9999", "4.999"]);
  await expect(cardOf(pg, "Box 10k").locator("[data-chart-ready]").first()).toBeVisible();
  expect(Date.now() - t0, "dashboard 10.000 dòng mất quá lâu").toBeLessThan(15_000);
  await cardOf(pg, "Tổng 10k").getByTestId("kpi-rows").click();
  await expect(pg.getByRole("dialog").getByTestId("rows-note")).toHaveText("Bạn thấy 10.000/10.000 dòng tạo nên con số này.");
  await pg.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).first().click();
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. Phone (375px)
// ---------------------------------------------------------------------------------------------------------------------------------

test("điện thoại: chủ mở dashboard, xem biểu đồ, đổi bộ lọc chung rồi về mặc định", async () => {
  test.skip(p !== "phone");
  test.setTimeout(90_000);
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/dashboard/${fullId}`);
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await expect(cardOf(pg, "Cột ").locator("[data-chart-ready]").first()).toBeVisible();
  const col = await cells(cardOf(pg, "Cột "));
  expect(Object.fromEntries(col.map((r) => [r[0]!, r[1]!]))["POD"]).toBe("275");
  // the number is not cut at 375px
  const kv = cardOf(pg, "KPI ").getByTestId("kpi-value");
  expect(await kv.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await chooseOption(pg.getByTestId("filter-field"), { label: "Loại" });
  await chooseOption(pg.getByTestId("filter-value"), { label: "POD" });
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText("275");
  await pg.getByTestId("filter-reset").click();
  await expect(cardOf(pg, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await owner.shot("3e-phone-dashboard");
});

test("điện thoại: người được chia sẻ mở dashboard từ danh sách, thấy số, không có nút xem dòng", async () => {
  test.skip(p !== "phone");
  test.setTimeout(90_000);
  const vp = viewerNo.page;
  await vp.goto("/dashboard");
  await vp.getByTestId("shared-dashboard").filter({ hasText: "Đủ loại" }).click();
  await expect(cardOf(vp, "KPI ").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await expect(vp.getByTestId("kpi-rows")).toHaveCount(0);
  await chooseOption(vp.getByTestId("filter-field"), { label: "Loại" });
  await chooseOption(vp.getByTestId("filter-value"), { label: "DCC" });
  await expect(cardOf(vp, "KPI ").getByTestId("kpi-value")).toHaveText("250");
  await vp.getByTestId("filter-reset").click();
  await viewerNo.shot("3e-phone-shared");
});

test("điện thoại: người có quyền bảng mở hộp xem các dòng", async () => {
  test.skip(p !== "phone");
  const vp = viewerSrc.page;
  await vp.goto("/dashboard");
  await vp.getByTestId("shared-dashboard").filter({ hasText: "Đủ loại" }).click();
  await cardOf(vp, "KPI ").getByTestId("kpi-rows").click();
  await expect(vp.getByRole("dialog").getByTestId("rows-note")).toHaveText("Bạn thấy 8/8 dòng tạo nên con số này.");
  await viewerSrc.shot("3e-phone-rows-box");
});
