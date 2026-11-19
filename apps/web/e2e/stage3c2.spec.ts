import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 3C-2: the other chart types, the common filters, cross filtering, the rows behind a number, CSV and PNG, JSON export and import,
 * and sharing a dashboard (the person sees the numbers without any right on the tables; the rows only with the right on the table).
 * Desktop only (quick test of this step); the phone runs in the final stage test.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-3c2-${p}-8842`;
// Every run makes its own people (the database may already hold the ones of an earlier run).
const RUN = Date.now().toString(36);
const email = (who: string) => `${p}.e2${who}${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");

// Mã, Loại, Trạng thái, Số tiền, Điểm, Ngày nhận, Ngày chốt
const ROWS: [string, string, string, number, number, string, string | null][] = [
  ["K1", "POD", "Won", 100, 10, "2026-01-10", "2026-01-20"],
  ["K2", "POD", "Won", 200, 20, "2026-01-15", "2026-02-05"],
  ["K3", "POD", "Lost", 50, 30, "2026-01-20", "2026-03-01"],
  ["K4", "DCC", "Won", 300, 40, "2026-02-03", "2026-02-10"],
  ["K5", "DCC", "Open", 400, 50, "2026-02-10", null],
  ["K6", "POD", "Won", 1000, 60, "2026-03-01", "2026-03-15"],
  ["K7", "DCC", "Lost", 25, 70, "2026-03-05", "2026-03-20"],
  ["K8", "POD", "Open", 75, 80, "2026-03-10", null],
];

let owner: Session;
let viewer: Session;
let guest: Session;
let sessions: Session[] = [];
let ownerApi: ApiClient;
let viewerApi: ApiClient;
let hubId: string;
let dealsId: string;
let dealsName: string;
let dashId = "";

const cardOf = (page: Page, title: string): Locator => page.locator("section[data-chart-id]").filter({ has: page.getByRole("heading", { level: 3, name: title, exact: true }) });
const dataOf = async (card: Locator) => (await card.getByTestId("chart-data").innerText()).replace(/\s+/g, " ");
const cells = async (card: Locator) => (await card.getByTestId("chart-data").locator("tbody tr").evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll("th,td")].map((c) => (c.textContent ?? "").trim()))));
const seriesOf = (name: string, agg: string, field?: string, extra: Record<string, unknown> = {}, metricExtra: Record<string, unknown> = {}) => ({
  metric: { name, source: dealsId, measure: { agg, ...(field ? { field } : {}) }, ...metricExtra },
  ...extra,
});
const mkChart = (type: string, title: string, series: unknown[], options: Record<string, unknown> = {}, layout?: unknown) =>
  ownerApi.call<{ id: string }>("POST", `/dashboards/${dashId}/charts`, { chart: { type, title, series, options, ...(layout ? { layout } : {}) } });
/** Pixel of a mark of an ECharts chart (the dev build keeps the handle on the element), relative to the page. */
async function markPoint(card: Locator, coord: unknown[]) {
  const box = card.locator("[data-chart-ready]").first();
  const pt = await box.evaluate((el, c) => {
    const ch = (el as unknown as { __echart: { convertToPixel: (f: unknown, v: unknown) => number[] } }).__echart;
    return ch.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, c);
  }, coord);
  const bb = (await box.boundingBox())!;
  return { x: bb.x + pt[0]!, y: bb.y + pt[1]! };
}

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "3C-2 chỉ chạy ở desktop (điện thoại: các luồng chính ở stage3e)");
  const admin = await createAdmin(API, email("admin"), `Admin 3C2 ${p} ${RUN}`, PASSWORD(), ROOT);
  const ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 3C2 ${p} ${RUN}`, roles: ["manager"] },
      { email: email("owner"), name: `Chủ 3C2 ${p} ${RUN}`, roles: ["user"], manager: email("mgr") },
      { email: email("viewer"), name: `Người xem 3C2 ${p} ${RUN}`, roles: ["user"], manager: email("mgr") },
      { email: email("guest"), name: `Guest 3C2 ${p} ${RUN}`, roles: ["guest"], manager: email("mgr"), guestPreset: "data" },
    ],
    PASSWORD(),
  );
  const mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  viewerApi = await new ApiClient(API).login(email("viewer"), PASSWORD());
  hubId = (await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: `Doanh thu 3C2 ${p} ${RUN}` })).id;
  dealsName = `Deals ${p}`;
  dealsId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/tables`, { name: dealsName })).id;
  const col = (name: string, type: string, config?: unknown) => ownerApi.call("POST", `/tables/${dealsId}/columns`, { name, type, ...(config ? { config } : {}) });
  await col("Mã", "text");
  await col("Loại", "single_select", { options: [{ name: "POD" }, { name: "DCC" }] });
  await col("Trạng thái", "single_select", { options: [{ name: "Won" }, { name: "Lost" }, { name: "Open" }] });
  await col("Số tiền", "number");
  await col("Điểm", "number");
  await col("Ngày nhận", "date");
  await col("Ngày chốt", "date");
  await ownerApi.call("POST", `/tables/${dealsId}/rows/batch`, {
    ops: ROWS.map(([Mã, Loại, st, tien, diem, nhan, chot]) => ({ op: "create", data: { Mã, Loại, "Trạng thái": st, "Số tiền": tien, Điểm: diem, "Ngày nhận": nhan, ...(chot ? { "Ngày chốt": chot } : {}) } })),
  });
  dashId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Loại biểu đồ mới" })).id;
  // A Manager grants the Guest "Dashboard" data of the tree; the owner opens the dashboard to Guests later in the test.
  await mgrApi.call("POST", "/guest/grants", { guest_user_id: ids[email("guest")], data_type: "dashboard", channels: ["web"] });

  owner = await Session.open(browser, p, "owner");
  viewer = await Session.open(browser, p, "viewer");
  guest = await Session.open(browser, p, "guest");
  sessions = [owner, viewer, guest];
  viewer.allow(403, /\/api\/v1\//).allow(404, /\/api\/v1\//);
  guest.allow(403, /\/api\/v1\//).allow(404, /\/api\/v1\//);
  owner.allow(409, /\/api\/v1\/dashboards\//).allow(422, /\/api\/v1\//).allow(400, /\/api\/v1\//);
  for (const [s, who] of [[owner, "owner"], [viewer, "viewer"], [guest, "guest"]] as const) {
    await s.login(email(who), PASSWORD());
    await expect(s.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  }
});

test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

test("các loại biểu đồ mới: số do máy chủ tính (phễu, waterfall, xếp hạng, histogram, box plot, scatter, ma trận, heatmap, cohort, đồng hồ, bullet)", async () => {
  const pg = owner.page;
  const w = { w: 6, h: 6 };
  const at = (i: number) => ({ x: (i % 2) * 6, y: Math.floor(i / 2) * 6, ...w });
  let i = 0;
  const count = (name: string, filter?: unknown) => seriesOf(name, "count", undefined, { label: name }, filter ? { filter } : {});
  await mkChart("funnel", "Phễu", [count("Tất cả"), count("Won", { field: "Trạng thái", op: "eq", value: "Won" }), count("Won POD", { and: [{ field: "Trạng thái", op: "eq", value: "Won" }, { field: "Loại", op: "eq", value: "POD" }] })], {}, at(i++));
  await mkChart("waterfall", "Waterfall", [seriesOf("Đầu kỳ", "sum", "Số tiền", { step: "start", label: "Đầu kỳ" }), seriesOf("Thua", "sum", "Số tiền", { step: "subtract", label: "Thua" }, { filter: { field: "Trạng thái", op: "eq", value: "Lost" } }), seriesOf("Đang mở", "sum", "Số tiền", { step: "add", label: "Đang mở" }, { filter: { field: "Trạng thái", op: "eq", value: "Open" } })], {}, at(i++));
  await mkChart("ranking", "Xếp hạng", [seriesOf("Tiền", "sum", "Số tiền", { group_by: [{ field: "Mã" }] })], { top_n: 3 }, at(i++));
  await mkChart("histogram", "Phân bố", [seriesOf("Tiền", "sum", "Số tiền")], { bins: 4 }, at(i++));
  await mkChart("boxplot", "Box plot", [seriesOf("Tiền", "sum", "Số tiền", { group_by: [{ field: "Loại" }] })], {}, at(i++));
  const xy = (f: string) => seriesOf(f, "sum", f, { group_by: [{ field: "Mã" }], label: f });
  await mkChart("scatter", "Scatter", [xy("Số tiền"), xy("Điểm")], {}, at(i++));
  await mkChart("matrix", "Ma trận", [xy("Số tiền"), xy("Điểm")], {}, at(i++));
  await mkChart("heatmap", "Heatmap", [seriesOf("Tiền", "sum", "Số tiền", { group_by: [{ field: "Loại" }, { field: "Trạng thái" }] })], {}, at(i++));
  await mkChart("cohort", "Cohort", [seriesOf("Chốt", "count", undefined, {}, { cohort: { start: "Ngày nhận", event: "Ngày chốt", bucket: "month" } })], {}, at(i++));
  await mkChart("gauge", "Đồng hồ", [seriesOf("Tiền", "sum", "Số tiền", { target: { value: 5000 } })], {}, at(i++));
  await mkChart("bullet", "Bullet", [seriesOf("Tiền", "sum", "Số tiền", { target: { value: 5000 } })], { bands: [{ label: "KPI", value: 3000 }, { label: "Goal", value: 4000 }] }, at(i++));
  await pg.goto(`/datahub/${hubId}/dashboard/${dashId}`);
  for (const t of ["Phễu", "Waterfall", "Xếp hạng", "Phân bố", "Box plot", "Scatter", "Ma trận", "Heatmap", "Cohort", "Đồng hồ", "Bullet"]) {
    await expect(cardOf(pg, t).locator("[data-chart-ready]").first(), t).toBeVisible();
  }

  const funnel = await cells(cardOf(pg, "Phễu"));
  expect(funnel.map((r) => r[1])).toEqual(["8", "4", "3"]);
  expect(funnel.map((r) => r[2])).toEqual(["100,0%", "50,0%", "37,5%"]);
  expect(funnel.map((r) => r[3])).toEqual(["—", "50,0%", "75,0%"]);

  const wf = await cells(cardOf(pg, "Waterfall"));
  expect(wf.map((r) => [r[0], r[1], r[2]])).toEqual([["Đầu kỳ", "2.150", "2.150"], ["Thua", "-75", "2.075"], ["Đang mở", "475", "2.550"], ["Tổng", "2.550", "2.550"]]);

  const rk = await cells(cardOf(pg, "Xếp hạng"));
  expect(rk).toEqual([["1", "K6", "1.000"], ["2", "K5", "400"], ["3", "K4", "300"]]);

  const hist = await cells(cardOf(pg, "Phân bố"));
  expect(hist.map((r) => r[1])).toEqual(["5", "2", "0", "1"]);

  const box = await cells(cardOf(pg, "Box plot"));
  const pod = box.find((r) => r[0] === "POD")!;
  expect(pod).toEqual(["POD", "5", "50", "75", "100", "200", "1.000", "1"]);
  expect(box.find((r) => r[0] === "DCC")!.slice(0, 2)).toEqual(["DCC", "3"]);

  const sc = await cells(cardOf(pg, "Scatter"));
  expect(sc).toHaveLength(8);
  expect(sc.find((r) => r[0] === "K6")!.slice(1)).toEqual(["1.000", "60"]);
  await expect(cardOf(pg, "Ma trận").getByTestId("chart-note")).toContainText("Mốc chia: Số tiền 150 (trung vị), Điểm 45 (trung vị).");
  await expect(cardOf(pg, "Ma trận").getByTestId("chart-note")).toContainText("Số tiền cao, Điểm cao: 2; Số tiền cao, Điểm thấp: 2; Số tiền thấp, Điểm cao: 2; Số tiền thấp, Điểm thấp: 2.");

  const heat = await dataOf(cardOf(pg, "Heatmap"));
  expect(heat).toContain("1.300");

  const co = await cells(cardOf(pg, "Cohort"));
  expect(co.map((r) => [r[0], r[1], r[2], r[3], r[4]])).toEqual([["2026-01", "3", "33,3%", "33,3%", "33,3%"], ["2026-02", "2", "50,0%", "0,0%", "0,0%"], ["2026-03", "3", "66,7%", "0,0%", "0,0%"]]);

  expect(await cells(cardOf(pg, "Đồng hồ"))).toEqual([["Tiền", "2.150", "5.000", "43,0%"]]);
  await expect(cardOf(pg, "Đồng hồ")).toContainText("Giá trị 2.150 trên mục tiêu 5.000");
  const bu = await cells(cardOf(pg, "Bullet"));
  expect(bu).toEqual([["Tiền", "2.150", "5.000", "43,0%"]]);
  await owner.shot("dashboard-3c2-types");
});

test("bộ lọc chung: khoảng thời gian và cột; bản riêng tự lưu, giữ sau khi tải lại, về mặc định; chủ lưu làm mặc định", async () => {
  const pg = owner.page;
  const d2 = await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Có bộ lọc" });
  const mk = (type: string, title: string, series: unknown[], layout: unknown, options: Record<string, unknown> = {}) => ownerApi.call("POST", `/dashboards/${d2.id}/charts`, { chart: { type, title, series, options, layout } });
  await mk("kpi", "Tổng theo ngày chốt", [seriesOf("Tổng", "sum", "Số tiền", {}, { time: { field: "Ngày chốt" } })], { x: 0, y: 0, w: 3, h: 3 });
  await mk("kpi", "Tổng mọi lúc", [seriesOf("Tổng", "sum", "Số tiền")], { x: 3, y: 0, w: 3, h: 3 }, { ignore_filters: true });
  await pg.goto(`/datahub/${hubId}/dashboard/${d2.id}`);
  const k1 = cardOf(pg, "Tổng theo ngày chốt").getByTestId("kpi-value");
  const k2 = cardOf(pg, "Tổng mọi lúc").getByTestId("kpi-value");
  await expect(k1).toHaveText("2.150");
  await pg.getByTestId("filter-field").selectOption({ label: "Loại" });
  await pg.getByTestId("filter-value").selectOption({ label: "POD" });
  await expect(k1).toHaveText("1.425");
  await expect(k2).toHaveText("2.150"); // opted out of the common filter
  await expect(pg.getByTestId("filter-chip")).toHaveText(/Loại = POD/);
  await pg.getByTestId("filter-range").selectOption({ label: "Năm nay" });
  await expect(k1).toHaveText(/^\d/); // the dashboard filters are applied together; the exact number depends on today's date
  await pg.getByTestId("filter-range").selectOption({ label: "Mọi thời gian" });
  await expect(k1).toHaveText("1.425");
  // saved as the person's own copy: it survives a reload
  await expect.poll(async () => (await ownerApi.call<{ my_filters: unknown }>("GET", `/dashboards/${d2.id}`)).my_filters).not.toBeNull();
  await pg.reload();
  await expect(cardOf(pg, "Tổng theo ngày chốt").getByTestId("kpi-value")).toHaveText("1.425");
  await expect(pg.getByTestId("filter-chip")).toHaveText(/Loại = POD/);
  // back to the default
  await pg.getByTestId("filter-reset").click();
  await expect(k1).toHaveText("2.150");
  await expect(pg.getByTestId("filter-chip")).toHaveCount(0);
  expect((await ownerApi.call<{ my_filters: unknown }>("GET", `/dashboards/${d2.id}`)).my_filters).toBeNull();
  // the owner makes a filter the default for everyone
  await pg.getByTestId("filter-field").selectOption({ label: "Loại" });
  await pg.getByTestId("filter-value").selectOption({ label: "DCC" });
  await expect(k1).toHaveText("725");
  await pg.getByTestId("filter-save-default").click();
  await expect.poll(async () => (await ownerApi.call<{ default_filters: { conditions?: unknown[] } }>("GET", `/dashboards/${d2.id}`)).default_filters.conditions?.length).toBe(1);
  await expect(pg.getByTestId("filter-reset")).toBeDisabled();
  await owner.shot("dashboard-3c2-filters");
});

test("lọc chéo: bấm một cột của biểu đồ lọc các biểu đồ khác, thanh lọc hiện chip, bấm lại hoặc × để bỏ", async () => {
  const pg = owner.page;
  const d3 = await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Lọc chéo" });
  const mk = (type: string, title: string, series: unknown[], layout: unknown, options: Record<string, unknown> = {}) => ownerApi.call("POST", `/dashboards/${d3.id}/charts`, { chart: { type, title, series, options, layout } });
  await mk("column", "Theo loại", [seriesOf("Tiền", "sum", "Số tiền", { group_by: [{ field: "Loại" }] })], { x: 0, y: 0, w: 6, h: 5 });
  await mk("kpi", "Tổng", [seriesOf("Tổng", "sum", "Số tiền")], { x: 6, y: 0, w: 3, h: 3 });
  await mk("kpi", "Tổng riêng", [seriesOf("Tổng", "sum", "Số tiền")], { x: 9, y: 0, w: 3, h: 3 }, { ignore_cross: true });
  await pg.goto(`/datahub/${hubId}/dashboard/${d3.id}`);
  const col = cardOf(pg, "Theo loại");
  await expect(col.locator("[data-chart-ready]")).toBeVisible();
  await expect(cardOf(pg, "Tổng").getByTestId("kpi-value")).toHaveText("2.150");
  // POD is 1.425: click the POD column
  const tops = await dataOf(col);
  expect(tops).toContain("POD 1.425");
  const point = await markPoint(col, ["POD", 700]);
  await pg.mouse.click(point.x, point.y);
  await expect(cardOf(pg, "Tổng").getByTestId("kpi-value")).toHaveText("1.425");
  await expect(cardOf(pg, "Tổng riêng").getByTestId("kpi-value")).toHaveText("2.150"); // does not take cross filters
  await expect(pg.getByTestId("cross-chip")).toContainText("Từ “Theo loại”: Loại = POD");
  // the clicked chart itself keeps all its columns
  expect(await dataOf(col)).toContain("DCC 725");
  // clicking the same column again lifts the filter
  await pg.mouse.click(point.x, point.y);
  await expect(cardOf(pg, "Tổng").getByTestId("kpi-value")).toHaveText("2.150");
  await expect(pg.getByTestId("cross-chip")).toHaveCount(0);
  // pick DCC, then drop it with the × of the chip
  const dcc = await markPoint(col, ["DCC", 300]);
  await pg.mouse.click(dcc.x, dcc.y);
  await expect(cardOf(pg, "Tổng").getByTestId("kpi-value")).toHaveText("725");
  await pg.getByRole("button", { name: "Bỏ lọc chéo từ Theo loại" }).click();
  await expect(cardOf(pg, "Tổng").getByTestId("kpi-value")).toHaveText("2.150");
});

test("xem các dòng tạo nên một con số, xuất CSV và PNG", async () => {
  const pg = owner.page;
  const d4 = await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Dòng và xuất file" });
  const mk = (type: string, title: string, series: unknown[], layout: unknown) => ownerApi.call("POST", `/dashboards/${d4.id}/charts`, { chart: { type, title, series, layout } });
  await mk("kpi", "Tổng POD", [seriesOf("Tổng POD", "sum", "Số tiền", {}, { filter: { field: "Loại", op: "eq", value: "POD" } })], { x: 0, y: 0, w: 3, h: 3 });
  await mk("column", "Theo loại", [seriesOf("Tiền", "sum", "Số tiền", { group_by: [{ field: "Loại" }] })], { x: 3, y: 0, w: 6, h: 5 });
  await pg.goto(`/datahub/${hubId}/dashboard/${d4.id}`);
  await expect(cardOf(pg, "Tổng POD").getByTestId("kpi-value")).toHaveText("1.425");
  await cardOf(pg, "Tổng POD").getByTestId("kpi-rows").click();
  const dlg = pg.getByRole("dialog");
  await expect(dlg.getByTestId("rows-note")).toHaveText("Bạn thấy 5/5 dòng tạo nên con số này.");
  const table = dlg.getByTestId("rows-table");
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(table).toContainText("K8");
  await expect(table).not.toContainText("K4"); // a DCC row
  const [csv] = await Promise.all([pg.waitForEvent("download"), dlg.getByTestId("rows-csv").click()]);
  const text = fs.readFileSync((await csv.path())!, "utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const lines = text.slice(1).trim().split(/\r?\n/);
  expect(lines[0]).toContain("Mã");
  expect(lines).toHaveLength(6);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  await dlg.getByRole("button", { name: "Đóng", exact: true }).click();
  // CSV straight from the menu of a chart, and PNG
  await cardOf(pg, "Theo loại").getByRole("button", { name: /Tuỳ chọn biểu đồ Theo loại/ }).click();
  const [csv2] = await Promise.all([pg.waitForEvent("download"), pg.getByRole("menuitem", { name: "Xuất CSV" }).click()]);
  expect(fs.readFileSync((await csv2.path())!, "utf8").trim().split(/\r?\n/)).toHaveLength(9);
  await expect(cardOf(pg, "Theo loại").locator("[data-chart-ready]")).toBeVisible();
  await cardOf(pg, "Theo loại").getByRole("button", { name: /Tuỳ chọn biểu đồ Theo loại/ }).click();
  const [png] = await Promise.all([pg.waitForEvent("download"), pg.getByRole("menuitem", { name: "Xuất PNG" }).click()]);
  expect(png.suggestedFilename()).toBe("Theo-loại.png");
  expect([...fs.readFileSync((await png.path())!).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  // a KPI card is not a picture: no PNG item
  await cardOf(pg, "Tổng POD").getByRole("button", { name: /Tuỳ chọn biểu đồ Tổng POD/ }).click();
  await expect(pg.getByRole("menuitem", { name: "Xuất PNG" })).toHaveCount(0);
  await pg.keyboard.press("Escape");
});

test("xuất JSON một dashboard và nhập lại: cùng số liệu; JSON sai báo rõ biểu đồ nào sai", async () => {
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/dashboard/${dashId}`);
  await pg.getByRole("button", { name: /Tuỳ chọn dashboard Loại biểu đồ mới/ }).click();
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.getByRole("menuitem", { name: "Xuất JSON" }).click()]);
  const json = fs.readFileSync((await dl.path())!, "utf8");
  const parsed = JSON.parse(json) as { format: string; charts: unknown[] };
  expect(parsed.format).toBe("soe-dashboard");
  expect(parsed.charts).toHaveLength(11);
  await pg.getByTestId("import-json").click();
  const dlg = pg.getByRole("dialog");
  await dlg.getByTestId("import-text").fill("{ không phải json");
  await dlg.getByRole("button", { name: "Nhập dashboard" }).click();
  await expect(dlg.getByRole("alert")).toContainText("không phải JSON hợp lệ");
  const bad = { ...parsed, charts: [{ type: "kpi", series: [{ metric: { name: "x", source: "Không có bảng này", measure: { agg: "count" } } }] }] };
  await dlg.getByTestId("import-text").fill(JSON.stringify(bad));
  await dlg.getByRole("button", { name: "Nhập dashboard" }).click();
  await expect(dlg.getByRole("alert")).toContainText("Biểu đồ thứ 1");
  await dlg.getByTestId("import-text").fill(json);
  await dlg.getByRole("button", { name: "Nhập dashboard" }).click();
  await expect(dlg).toBeHidden();
  await expect(pg.getByRole("tab", { name: "Loại biểu đồ mới (bản sao)" })).toHaveAttribute("aria-selected", "true");
  await expect(cardOf(pg, "Phễu").locator("[data-chart-ready]").first()).toBeVisible();
  await expect(cardOf(pg, "Xếp hạng").locator("[data-chart-ready]").first()).toBeVisible();
  const funnel = await cells(cardOf(pg, "Phễu"));
  expect(funnel.map((r) => r[1])).toEqual(["8", "4", "3"]);
  expect((await cells(cardOf(pg, "Xếp hạng")))[0]).toEqual(["1", "K6", "1.000"]);
});

test("chia sẻ dashboard: người nhận thấy số mà không có quyền bảng; có quyền bảng thì xem được các dòng; bỏ chia sẻ thì mất", async () => {
  const pg = owner.page;
  const d5 = await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Chia sẻ thử" });
  const mk = (type: string, title: string, series: unknown[], layout: unknown) => ownerApi.call("POST", `/dashboards/${d5.id}/charts`, { chart: { type, title, series, layout } });
  await mk("kpi", "Tổng riêng của chủ", [seriesOf("Tổng", "sum", "Số tiền")], { x: 0, y: 0, w: 3, h: 3 });
  await mk("column", "Theo loại", [seriesOf("Tiền", "sum", "Số tiền", { group_by: [{ field: "Loại" }] })], { x: 3, y: 0, w: 6, h: 5 });
  await pg.goto(`/datahub/${hubId}/dashboard/${d5.id}`);
  await pg.getByRole("button", { name: /Tuỳ chọn dashboard Chia sẻ thử/ }).click();
  await pg.getByRole("menuitem", { name: "Chia sẻ…" }).click();
  const dlg = pg.getByRole("dialog");
  await dlg.getByLabel("Tìm người *").fill(`Người xem 3C2 ${p} ${RUN}`);
  await dlg.getByRole("option", { name: new RegExp(`Người xem 3C2 ${p} ${RUN}`) }).click();
  await dlg.getByTestId("dshare-add").click();
  await expect(dlg.getByTestId("dshare-row")).toContainText(`Người xem 3C2 ${p} ${RUN}`);
  await dlg.getByRole("button", { name: "Đóng", exact: true }).last().click();

  const vp = viewer.page;
  await vp.goto("/");
  await vp.getByRole("link", { name: "Dashboard chia sẻ" }).first().click();
  await vp.getByTestId("shared-dashboard").filter({ hasText: "Chia sẻ thử" }).click();
  await expect(vp.getByTestId("dash-owner")).toContainText(`Của Chủ 3C2 ${p} ${RUN}`);
  await expect(cardOf(vp, "Tổng riêng của chủ").getByTestId("kpi-value")).toHaveText("2.150");
  // nothing to edit
  await expect(vp.getByTestId("add-chart")).toHaveCount(0);
  await expect(vp.getByTestId("chart-move")).toHaveCount(0);
  await expect(vp.getByTestId("kpi-rows")).toHaveCount(0); // no right on the table: the number is not a button
  await cardOf(vp, "Theo loại").getByRole("button", { name: /Tuỳ chọn biểu đồ Theo loại/ }).click();
  await expect(vp.getByRole("menuitem", { name: /Xem các dòng/ })).toHaveCount(0);
  await expect(vp.getByRole("menuitem", { name: "Sửa biểu đồ" })).toHaveCount(0);
  await vp.keyboard.press("Escape");
  // the person's own filter works on the numbers the owner computed
  await vp.getByTestId("filter-field").selectOption({ label: "Loại" });
  await vp.getByTestId("filter-value").selectOption({ label: "POD" });
  await expect(cardOf(vp, "Tổng riêng của chủ").getByTestId("kpi-value")).toHaveText("1.425");
  await vp.getByTestId("filter-reset").click();
  await expect(cardOf(vp, "Tổng riêng của chủ").getByTestId("kpi-value")).toHaveText("2.150");
  // the person cannot read the table itself
  const direct = await viewerApi.call("GET", `/tables/${dealsId}/rows`).then(() => 200, (e: Error) => Number(/-> (\d{3})/.exec(e.message)?.[1]));
  expect(direct).toBe(404);
  // with the right on the table, the number opens its rows (and the CSV)
  await ownerApi.call("PUT", `/datahubs/${hubId}/shares`, { grantee_id: (await viewerApi.call<{ user: { id: string } }>("GET", "/auth/me")).user.id, permission: "view" });
  await vp.reload();
  await expect(cardOf(vp, "Tổng riêng của chủ").getByTestId("kpi-rows")).toBeVisible();
  await cardOf(vp, "Tổng riêng của chủ").getByTestId("kpi-rows").click();
  await expect(vp.getByRole("dialog").getByTestId("rows-note")).toHaveText("Bạn thấy 8/8 dòng tạo nên con số này.");
  await vp.getByRole("dialog").getByRole("button", { name: "Đóng", exact: true }).first().click();

  // un-share: the door closes
  await pg.reload();
  await pg.getByRole("button", { name: /Tuỳ chọn dashboard Chia sẻ thử/ }).click();
  await pg.getByRole("menuitem", { name: "Chia sẻ…" }).click();
  await pg.getByRole("dialog").getByRole("button", { name: /Bỏ chia sẻ với/ }).click();
  await expect(pg.getByRole("dialog").getByTestId("dshare-row")).toHaveCount(0);
  await vp.goto("/dashboard");
  await expect(vp.getByTestId("shared-dashboard").filter({ hasText: "Chia sẻ thử" })).toHaveCount(0);
  await vp.goto(`/dashboard/${d5.id}`);
  await expect(vp.getByText("Không tải được dashboard")).toBeVisible();
  await owner.shot("dashboard-3c2-share");
});

test("Guest được cấp dữ liệu Dashboard chỉ thấy dashboard chủ đã mở cho Guest, chỉ xem số, không xem dòng", async () => {
  const gp = guest.page;
  const d6 = await ownerApi.call<{ id: string; version: number }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Cho Guest" });
  await ownerApi.call("POST", `/dashboards/${d6.id}/charts`, { chart: { type: "kpi", title: "Tổng cho Guest", series: [seriesOf("Tổng", "sum", "Số tiền")], layout: { x: 0, y: 0, w: 3, h: 3 } } });
  await gp.goto("/dashboard");
  await expect(gp.getByTestId("shared-dashboards")).toHaveCount(0); // not opened yet
  await gp.goto(`/dashboard/${d6.id}`);
  await expect(gp.getByText("Không tải được dashboard")).toBeVisible();
  await ownerApi.call("PATCH", `/dashboards/${d6.id}`, { version: d6.version, guest_visible: true });
  await gp.goto("/dashboard");
  await gp.getByTestId("shared-dashboard").filter({ hasText: "Cho Guest" }).click();
  await expect(cardOf(gp, "Tổng cho Guest").getByTestId("kpi-value")).toHaveText("2.150");
  await expect(gp.getByTestId("kpi-rows")).toHaveCount(0);
  await expect(gp.getByTestId("add-chart")).toHaveCount(0);
  // the viewer's JSON of the dashboard never carries the metric definitions
  const v = await new ApiClient(API).login(email("guest"), PASSWORD()).then((c) => c.call<{ charts: { chart: { series: Record<string, unknown>[] } }[] }>("GET", `/dashboards/${d6.id}/view`));
  expect(JSON.stringify(v.charts[0]!.chart.series)).not.toContain("measure");
  await guest.shot("dashboard-3c2-guest");
});
