import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 3C-1: dashboards and the basic charts, in the browser. Dashboard list (new, rename, copy, order, trash), the grid (drag, resize,
 * keyboard, saved and kept after a reload), each basic chart type with its numbers read from the server, empty data, an error in one
 * chart, markup in names shown as text, huge and negative numbers, live reload after a data change, limits, owner-only access.
 * Desktop only (quick test of this step); the phone runs in the final stage test.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-3c1-${p}-7731`;
const email = (who: string) => `${p}.d1${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const ODD = "<b>Đậm</b> & Co";
const BIG = 12_345_678_901_234;
const AMOUNTS: [string, string, number][] = [
  ["POD", "2026-09-10", 100],
  ["POD", "2026-10-05", -50],
  ["DCC", "2026-10-20", BIG],
  [ODD, "2026-11-02", 1000],
  [ODD, "2026-11-03", 2500],
];
const TOTAL_TEXT = "12.345.678.904.784"; // BIG + 100 - 50 + 1000 + 2500

let owner: Session;
let viewer: Session;
let sessions: Session[] = [];
let ownerApi: ApiClient;
let viewerApi: ApiClient;
let hubId: string;
let dealsId: string;
let emptyId: string;
let dashId = "";

const dealsName = () => `Deals ${p}`;
const toast = (page: Page, text: string | RegExp) => expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
const panel = (page: Page) => page.getByTestId("chart-config");
const cardOf = (page: Page, title: string): Locator => page.locator("section[data-chart-id]").filter({ has: page.getByRole("heading", { level: 3, name: title, exact: true }) });
const layoutOf = async (card: Locator) => (await card.getAttribute("data-layout"))!.split(",").map(Number) as [number, number, number, number];
async function saved(page: Page) {
  await expect(page.getByTestId("chart-save-state")).toContainText("Đã lưu tự động", { timeout: 15_000 });
}
async function addChart(page: Page, type: string, title: string) {
  await page.getByTestId("add-chart").click();
  await page.getByRole("menuitem", { name: type, exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByLabel("Tiêu đề").fill(title);
}
async function pickSource(page: Page, agg: string, field?: string) {
  const s = panel(page).getByTestId("series-0");
  await s.getByLabel("Nguồn dữ liệu").selectOption({ label: dealsName() });
  await s.getByLabel("Cách tính").selectOption({ label: agg });
  if (field) await s.getByLabel("Cột giá trị").selectOption({ label: field });
}
async function closePanel(page: Page) {
  await panel(page).getByRole("button", { name: "Đóng cấu hình" }).click();
  await expect(panel(page)).toBeHidden();
}
async function chartData(card: Locator) {
  return (await card.getByTestId("chart-data").innerText()).replace(/\s+/g, " ");
}
const seriesOf = (metricName: string, extra: Record<string, unknown> = {}) => ({ metric: { name: metricName, source: dealsId, measure: { agg: "sum", field: "Số tiền" } }, ...extra });

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "3C-1 chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  const admin = await createAdmin(API, email("admin"), `Admin 3C1 ${p}`, PASSWORD(), ROOT);
  await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 3C1 ${p}`, roles: ["manager"] },
      { email: email("owner"), name: `Chủ 3C1 ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("viewer"), name: `Người Sửa 3C1 ${p}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  viewerApi = await new ApiClient(API).login(email("viewer"), PASSWORD());
  hubId = (await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: `Doanh thu ${p}` })).id;
  dealsId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/tables`, { name: dealsName() })).id;
  for (const [name, type] of [["Loại", "text"], ["Ngày", "date"], ["Số tiền", "currency"]] as const) await ownerApi.call("POST", `/tables/${dealsId}/columns`, { name, type });
  await ownerApi.call("POST", `/tables/${dealsId}/rows/batch`, { ops: AMOUNTS.map(([l, d, v]) => ({ op: "create", data: { Loại: l, Ngày: d, "Số tiền": v } })) });
  emptyId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/tables`, { name: `Rỗng ${p}` })).id;
  await ownerApi.call("POST", `/tables/${emptyId}/columns`, { name: "Số", type: "number" });
  await ownerApi.call("PUT", `/datahubs/${hubId}/shares`, { grantee_id: (await viewerApi.call<{ user: { id: string } }>("GET", "/auth/me")).user.id, permission: "edit_data" });

  owner = await Session.open(browser, p, "owner");
  viewer = await Session.open(browser, p, "viewer");
  sessions = [owner, viewer];
  viewer.allow(403, /\/api\/v1\/(dashboards|datahubs)\//).allow(404, /\/api\/v1\/(dashboards|datahubs)\//);
  owner.allow(400, /\/(metric-query|chart-data)/).allow(409, /\/api\/v1\/dashboards\//).allow(422, /\/api\/v1\/(dashboards|datahubs)\//);
  for (const [s, who] of [[owner, "owner"], [viewer, "viewer"]] as const) {
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

test("tab Dashboard: lần đầu có sẵn một dashboard trống; thêm Thẻ KPI, số lớn không bị cắt", async () => {
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}`);
  await pg.getByTestId("dashboard-tab").click();
  await expect(pg).toHaveURL(new RegExp(`/datahub/${hubId}/dashboard/[0-9a-f-]{36}$`));
  dashId = pg.url().split("/").pop()!;
  await expect(pg.getByRole("tab", { name: "Dashboard 1" })).toHaveAttribute("aria-selected", "true");
  await expect(pg.getByText("Dashboard chưa có biểu đồ")).toBeVisible();

  await addChart(pg, "Thẻ KPI", "Tổng doanh thu");
  await expect(panel(pg).getByText("Chưa đủ thông tin nên chưa lưu")).toBeVisible();
  await pickSource(pg, "Tổng", "Số tiền");
  await saved(pg);
  await closePanel(pg);
  const card = cardOf(pg, "Tổng doanh thu");
  await expect(card.getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await owner.shot("dashboard-kpi");
  // The saved JSON is what the screen drew from.
  const d = await ownerApi.call<{ charts: { chart: { type: string; series: { metric: { measure: { agg: string; field: string } } }[] } }[] }>("GET", `/dashboards/${dashId}`);
  expect(d.charts).toHaveLength(1);
  expect(d.charts[0]!.chart.series[0]!.metric.measure).toEqual({ agg: "sum", field: "Số tiền" });
});

test("biểu đồ cột (nhóm, chồng), đường theo tháng, tròn và bảng: số lấy từ máy chủ, tên có <b> hiện là chữ", async () => {
  const pg = owner.page;
  // Column: the group labels include markup, which must show as text.
  await addChart(pg, "Cột đứng", "Theo loại");
  await pickSource(pg, "Tổng", "Số tiền");
  await panel(pg).getByRole("button", { name: "Thêm cột nhóm" }).click();
  await panel(pg).getByLabel("Cột nhóm 1").selectOption({ label: "Loại" });
  await panel(pg).getByLabel("Xếp chồng").selectOption({ label: "Chồng" });
  await saved(pg);
  await expect(panel(pg).locator("[data-chart-ready]").first()).toBeVisible();
  await closePanel(pg);
  const col = cardOf(pg, "Theo loại");
  await expect(col.locator("[data-chart-ready]")).toBeVisible();
  const data = await chartData(col);
  expect(data).toContain(ODD);
  expect(data).toContain("12.345.678.901.234"); // DCC, not cut
  expect(data).toContain("POD 50"); // 100 - 50
  await expect(col.locator("b")).toHaveCount(0);

  // Line: by month.
  await addChart(pg, "Đường", "Theo tháng");
  await pickSource(pg, "Đếm dòng");
  await panel(pg).getByLabel("Cột ngày").selectOption({ label: "Ngày" });
  await panel(pg).getByLabel("Nhóm theo thời gian").selectOption({ label: "Tháng" });
  await saved(pg);
  await closePanel(pg);
  const line = cardOf(pg, "Theo tháng");
  await expect(line.locator("[data-chart-ready]")).toBeVisible();
  const ld = await chartData(line);
  expect(ld).toContain("2026-09 1");
  expect(ld).toContain("2026-10 2");
  expect(ld).toContain("2026-11 2");

  // Pie: only positive parts are drawn; the negative one is said, not drawn.
  await addChart(pg, "Tròn", "Cơ cấu");
  await pickSource(pg, "Tổng", "Số tiền");
  await panel(pg).getByRole("button", { name: "Thêm cột nhóm" }).click();
  await panel(pg).getByLabel("Cột nhóm 1").selectOption({ label: "Loại" });
  await saved(pg);
  await closePanel(pg);
  const pie = cardOf(pg, "Cơ cấu");
  await expect(pie.locator("[data-chart-ready]")).toBeVisible();
  expect(await chartData(pie)).toContain("12.345.678.901.234");

  // Table.
  await addChart(pg, "Bảng", "Bảng theo loại");
  await pickSource(pg, "Tổng", "Số tiền");
  await panel(pg).getByRole("button", { name: "Thêm cột nhóm" }).click();
  await panel(pg).getByLabel("Cột nhóm 1").selectOption({ label: "Loại" });
  await saved(pg);
  await closePanel(pg);
  const tb = cardOf(pg, "Bảng theo loại");
  await expect(tb.getByRole("cell", { name: ODD, exact: true })).toBeVisible();
  await expect(tb.getByRole("cell", { name: "12.345.678.901.234", exact: true })).toBeVisible();
  await expect(tb.getByRole("cell", { name: "50", exact: true })).toBeVisible();

  // Note: plain text.
  await addChart(pg, "Ô ghi chú", "Ghi chú");
  await panel(pg).getByLabel("Nội dung ghi chú").fill("Tính theo ngày chốt <script>alert(1)</script>");
  await saved(pg);
  await closePanel(pg);
  await expect(cardOf(pg, "Ghi chú")).toContainText("Tính theo ngày chốt <script>alert(1)</script>");
  await owner.shot("dashboard-basic-charts");
});

test("các loại còn lại (bar, area, combo hai trục, donut, pivot) vẽ được từ JSON; sửa lại bằng khung cấu hình", async () => {
  const pg = owner.page;
  const group = { group_by: [{ field: "Loại" }] };
  const defs = [
    { type: "bar", title: "Thanh ngang", series: [seriesOf("T", group)] },
    { type: "area", title: "Vùng", series: [seriesOf("T", { time: { field: "Ngày", bucket: "month" } })] },
    { type: "combo", title: "Cột và đường", series: [seriesOf("Tiền", { time: { field: "Ngày", bucket: "month" }, kind: "bar", axis: "left", label: "Doanh thu" }), { metric: { name: "N", source: dealsId, measure: { agg: "count" } }, time: { field: "Ngày", bucket: "month" }, kind: "line", axis: "right", label: "Số deal" }] },
    { type: "donut", title: "Donut", series: [seriesOf("T", group)] },
    { type: "pivot", title: "Pivot", options: { totals: true, heat: true }, series: [seriesOf("T", { time: { field: "Ngày", bucket: "month" }, group_by: [{ field: "Loại" }] })] },
  ];
  for (const c of defs) await ownerApi.call("POST", `/dashboards/${dashId}/charts`, { chart: c });
  await pg.reload();
  for (const t of ["Thanh ngang", "Vùng", "Cột và đường", "Donut"]) await expect(cardOf(pg, t).locator("[data-chart-ready]")).toBeVisible();
  expect(await chartData(cardOf(pg, "Cột và đường"))).toMatch(/Doanh thu.*Số deal/);
  const pv = cardOf(pg, "Pivot");
  await expect(pv.getByRole("columnheader", { name: "Tổng" })).toBeVisible();
  await expect(pv.getByRole("cell", { name: TOTAL_TEXT, exact: true })).toBeVisible(); // grand total, only for sums
  // Edit: the panel opens with the saved settings and changes are saved by themselves.
  await cardOf(pg, "Donut").getByRole("button", { name: /Tuỳ chọn biểu đồ Donut/ }).click();
  await pg.getByRole("menuitem", { name: "Sửa biểu đồ" }).click();
  await expect(panel(pg).getByLabel("Loại biểu đồ")).toHaveValue("donut");
  await panel(pg).getByLabel("Tiêu đề").fill("Donut đổi tên");
  await saved(pg);
  await closePanel(pg);
  await expect(cardOf(pg, "Donut đổi tên")).toBeVisible();
});

test("kéo thả, đổi kích thước bằng chuột và bàn phím tự lưu; tải lại trang vẫn giữ", async () => {
  const pg = owner.page;
  await pg.reload();
  const card = cardOf(pg, "Tổng doanh thu");
  await expect(card).toBeVisible();
  const before = await layoutOf(card);
  // Keyboard: the handle moves by one cell, the corner resizes.
  await card.getByTestId("chart-resize").focus();
  await pg.keyboard.press("ArrowRight");
  await expect.poll(async () => (await layoutOf(card))[2]).toBe(before[2] + 1);
  await card.getByTestId("chart-resize").press("ArrowDown");
  await expect.poll(async () => (await layoutOf(card))[3]).toBe(before[3] + 1);
  // Mouse: drag the handle to the right by about 3 columns.
  const note = cardOf(pg, "Ghi chú");
  const start = await layoutOf(note);
  await note.getByTestId("chart-move").scrollIntoViewIfNeeded();
  const h = await note.getByTestId("chart-move").boundingBox();
  const gridBox = (await pg.getByTestId("dashboard-grid").boundingBox())!;
  const colStep = (gridBox.width + 12) / 12;
  await pg.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(h!.x + h!.width / 2 + colStep * 2, h!.y + h!.height / 2, { steps: 8 });
  await pg.mouse.up();
  await expect.poll(async () => (await layoutOf(note))[0]).toBe(Math.min(12 - start[2], start[0] + 2));
  // No overlaps after the moves.
  const rects = await pg.locator("section[data-chart-id]").evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute("data-layout")!.split(",").map(Number)));
  for (const a of rects) for (const b of rects) if (a !== b) expect(a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!).toBe(false);
  // Saved: the server has it, and a reload shows the same.
  const mine = (await layoutOf(card)).join(",");
  const mineNote = (await layoutOf(note)).join(",");
  await expect.poll(async () => {
    const d = await ownerApi.call<{ charts: { id: string; chart: { title?: string; layout: { x: number; y: number; w: number; h: number } } }[] }>("GET", `/dashboards/${dashId}`);
    const l = d.charts.find((c) => c.chart.title === "Tổng doanh thu")!.chart.layout;
    return `${l.x},${l.y},${l.w},${l.h}`;
  }, { timeout: 10_000 }).toBe(mine);
  await pg.reload();
  await expect(cardOf(pg, "Tổng doanh thu")).toBeVisible();
  expect((await layoutOf(cardOf(pg, "Tổng doanh thu"))).join(",")).toBe(mine);
  expect((await layoutOf(cardOf(pg, "Ghi chú"))).join(",")).toBe(mineNote);
  await owner.shot("dashboard-after-drag");
});

test("nhiều dashboard: tạo, đổi tên, nhân bản, đổi thứ tự, xoá vào thùng rác và khôi phục (kể cả khi tên bị dùng)", async () => {
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/dashboard`);
  await expect(pg.getByRole("tab", { name: "Dashboard 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await pg.getByRole("button", { name: "Dashboard mới" }).click();
  await pg.getByRole("textbox", { name: /Tên dashboard/ }).fill("Pipeline <b>Q4</b>");
  await pg.getByRole("button", { name: "Tạo dashboard" }).click();
  await expect(pg.getByRole("tab", { name: "Pipeline <b>Q4</b>" })).toHaveAttribute("aria-selected", "true");
  await expect(pg.getByText("Dashboard chưa có biểu đồ")).toBeVisible();
  // Rename.
  await pg.getByRole("button", { name: /Tuỳ chọn dashboard Pipeline/ }).click();
  await pg.getByRole("menuitem", { name: "Đổi tên" }).click();
  await pg.getByRole("textbox", { name: /Tên dashboard/ }).fill("Pipeline Q4");
  await pg.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(pg.getByRole("tab", { name: "Pipeline Q4" })).toBeVisible();
  // A taken name is refused with the server's message.
  await pg.getByRole("button", { name: /Tuỳ chọn dashboard Pipeline Q4/ }).click();
  await pg.getByRole("menuitem", { name: "Đổi tên" }).click();
  await pg.getByRole("textbox", { name: /Tên dashboard/ }).fill("dashboard 1");
  await pg.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(pg.getByRole("dialog").getByText(/đã có một dashboard tên này/i)).toBeVisible();
  await pg.getByRole("dialog").getByRole("button", { name: "Huỷ" }).click();
  // Copy the first dashboard (with its charts).
  await pg.getByRole("tab", { name: "Dashboard 1", exact: true }).click();
  const n = await pg.locator("section[data-chart-id]").count();
  await pg.getByRole("button", { name: /Tuỳ chọn dashboard Dashboard 1/ }).click();
  await pg.getByRole("menuitem", { name: "Nhân bản" }).click();
  await toast(pg, "Đã nhân bản thành \"Dashboard 1 (bản sao)\"");
  await expect(pg.getByRole("tab", { name: "Dashboard 1 (bản sao)" })).toHaveAttribute("aria-selected", "true");
  await expect(pg.locator("section[data-chart-id]")).toHaveCount(n);
  // Order: move the copy to the left; the order is the server's.
  await pg.getByRole("button", { name: /Tuỳ chọn dashboard Dashboard 1 \(bản sao\)/ }).click();
  await pg.getByRole("menuitem", { name: "Chuyển sang trái" }).click();
  await expect.poll(async () => (await ownerApi.raw<{ data: { name: string }[] }>(`/datahubs/${hubId}/dashboards`)).data.map((d) => d.name)).toEqual(["Dashboard 1", "Dashboard 1 (bản sao)", "Pipeline Q4"]);
  // Delete into the trash, then restore; a taken name asks for a new one.
  await pg.getByRole("button", { name: /Tuỳ chọn dashboard Dashboard 1 \(bản sao\)/ }).click();
  await pg.getByRole("menuitem", { name: "Xoá dashboard" }).click();
  await pg.getByRole("dialog").getByRole("button", { name: "Xoá dashboard" }).click();
  await expect(pg.getByRole("tab", { name: "Dashboard 1 (bản sao)" })).toHaveCount(0);
  await pg.getByRole("button", { name: /^Thùng rác/ }).click();
  await expect(pg.getByRole("dialog").getByText("Dashboard 1 (bản sao)")).toBeVisible();
  await pg.getByRole("button", { name: "Khôi phục dashboard Dashboard 1 (bản sao)" }).click();
  await toast(pg, "Đã khôi phục dashboard");
  await pg.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(pg.getByRole("tab", { name: "Dashboard 1 (bản sao)" })).toBeVisible();
  // Delete again, take the name, restore -> the dialog asks for another name.
  const copy = (await ownerApi.raw<{ data: { id: string; name: string }[] }>(`/datahubs/${hubId}/dashboards`)).data.find((d) => d.name === "Dashboard 1 (bản sao)")!;
  await ownerApi.call("DELETE", `/dashboards/${copy.id}`);
  await ownerApi.call("POST", `/datahubs/${hubId}/dashboards`, { name: "Dashboard 1 (bản sao)" });
  await pg.reload();
  await pg.getByRole("button", { name: /^Thùng rác/ }).click();
  await pg.getByRole("button", { name: "Khôi phục dashboard Dashboard 1 (bản sao)" }).click();
  const ask = pg.getByRole("dialog", { name: "Tên dashboard đã bị dùng" });
  await expect(ask).toBeVisible();
  await ask.getByLabel("Tên mới").fill("Dashboard khôi phục");
  await ask.getByRole("button", { name: "Khôi phục với tên này" }).click();
  await toast(pg, "Đã khôi phục dashboard");
  await pg.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(pg.getByRole("tab", { name: "Dashboard khôi phục" })).toBeVisible();
  await owner.shot("dashboard-list");
});

test("dữ liệu rỗng, một biểu đồ lỗi và lỗi quá nặng không làm hỏng cả dashboard", async () => {
  const pg = owner.page;
  const dash = await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Trường hợp xấu" });
  const mk = (chart: unknown) => ownerApi.call<{ id: string }>("POST", `/dashboards/${dash.id}/charts`, { chart });
  await mk({ type: "column", title: "Bảng rỗng", series: [{ metric: { name: "S", source: emptyId, measure: { agg: "sum", field: "Số" } }, group_by: [{ field: "Số" }] }] });
  await mk({ type: "kpi", title: "KPI rỗng", series: [{ metric: { name: "S", source: emptyId, measure: { agg: "sum", field: "Số" } } }] });
  await mk({ type: "pie", title: "Tròn rỗng", series: [{ metric: { name: "S", source: emptyId, measure: { agg: "count" } }, group_by: [{ field: "Số" }] }] });
  // A column that is deleted after the chart was saved: only this chart shows the error.
  const doomed = await ownerApi.call<{ key: string }>("POST", `/tables/${dealsId}/columns`, { name: "Tạm", type: "number" });
  await mk({ type: "kpi", title: "KPI hỏng", series: [{ metric: { name: "S", source: dealsId, measure: { agg: "sum", field: "Tạm" } } }] });
  const heavy = await mk({ type: "kpi", title: "KPI nặng", series: [{ metric: { name: "Nặng", source: dealsId, measure: { agg: "count" } } }] });
  await mk({ type: "kpi", title: "KPI âm", series: [{ metric: { name: "Âm", source: dealsId, measure: { agg: "min", field: "Số tiền" } } }] });
  await ownerApi.call("DELETE", `/tables/${dealsId}/columns/${doomed.key}`);
  const heavyUrl = new RegExp(`chart-data\\?.*chart_id=${heavy.id}`);
  await pg.route(heavyUrl, (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "validation_error", message: "Truy vấn quá nặng (quá 10 giây).", details: { reason: "query_too_heavy", hint: "Thu hẹp khoảng thời gian hoặc thêm bộ lọc." } } }) }),
  );
  await pg.goto(`/datahub/${hubId}/dashboard/${dash.id}`);
  await expect(cardOf(pg, "Bảng rỗng").getByText("Chưa có dữ liệu")).toBeVisible();
  await expect(cardOf(pg, "KPI rỗng").getByTestId("kpi-value")).toHaveText("—");
  await expect(cardOf(pg, "Tròn rỗng").getByText("Chưa có dữ liệu")).toBeVisible();
  await expect(cardOf(pg, "KPI hỏng").getByRole("alert")).toBeVisible();
  await expect(cardOf(pg, "KPI nặng").getByRole("alert")).toContainText("Truy vấn quá nặng");
  await expect(cardOf(pg, "KPI nặng")).toContainText("Thu hẹp khoảng thời gian");
  await expect(cardOf(pg, "KPI âm").getByTestId("kpi-value")).toHaveText("-50");
  await owner.shot("dashboard-bad-cases");
  await pg.unroute(heavyUrl);
});

test("dữ liệu bảng đổi thì dashboard tự tải lại (SSE, gộp tín hiệu), không cần mở lại trang", async () => {
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/dashboard/${dashId}`);
  await expect(cardOf(pg, "Tổng doanh thu").getByTestId("kpi-value")).toHaveText(TOTAL_TEXT);
  await ownerApi.call("POST", `/tables/${dealsId}/rows/batch`, { ops: [1, 2, 3, 4, 5].map((n) => ({ op: "create", data: { Loại: "POD", Ngày: "2026-11-10", "Số tiền": n * 1000 } })) });
  // 12.345.678.904.784 + 15.000
  await expect(cardOf(pg, "Tổng doanh thu").getByTestId("kpi-value")).toHaveText("12.345.678.919.784", { timeout: 20_000 });
});

test("giới hạn 20 dashboard và 30 biểu đồ: máy chủ từ chối, giao diện nói rõ", async () => {
  const pg = owner.page;
  // Charts: fill one dashboard with notes up to the limit, then add one more in the screen.
  const full = await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name: "Đầy biểu đồ" });
  for (let i = 0; i < 30; i++) await ownerApi.call("POST", `/dashboards/${full.id}/charts`, { chart: { type: "note", title: `N${i}`, text: "x" } });
  await pg.goto(`/datahub/${hubId}/dashboard/${full.id}`);
  await expect(pg.getByText("30 biểu đồ", { exact: true })).toBeVisible();
  await addChart(pg, "Ô ghi chú", "Thứ 31");
  await panel(pg).getByLabel("Nội dung ghi chú").fill("quá");
  await expect(panel(pg).getByRole("alert")).toContainText("giới hạn 30 biểu đồ", { timeout: 15_000 });
  await closePanel(pg);
  // Dashboards: top up to 20 by API, the 21st is refused in the screen.
  const have = (await ownerApi.raw<{ data: unknown[] }>(`/datahubs/${hubId}/dashboards`)).data.length;
  for (let i = have; i < 20; i++) await ownerApi.call("POST", `/datahubs/${hubId}/dashboards`, { name: `Đủ ${i}` });
  await pg.reload();
  await pg.getByRole("button", { name: "Dashboard mới" }).click();
  await pg.getByRole("textbox", { name: /Tên dashboard/ }).fill("Thứ 21");
  await pg.getByRole("button", { name: "Tạo dashboard" }).click();
  await expect(pg.getByRole("dialog").getByRole("alert")).toContainText("giới hạn 20 dashboard");
});

test("chỉ chủ datahub dùng dashboard: người được chia sẻ không thấy tab và API từ chối", async () => {
  const pg = viewer.page;
  await pg.goto(`/datahub/${hubId}`);
  await expect(pg.getByRole("tab", { name: dealsName() })).toBeVisible();
  await expect(pg.getByTestId("dashboard-tab")).toHaveCount(0);
  await pg.goto(`/datahub/${hubId}/dashboard`);
  await expect(pg.getByText("Không mở được dashboard")).toBeVisible();
  for (const [m, u] of [["GET", `/datahubs/${hubId}/dashboards`], ["GET", `/dashboards/${dashId}`], ["POST", `/dashboards/${dashId}/charts`]] as const) {
    const r = await viewerApi.call(m, u, m === "POST" ? { chart: { type: "note", text: "x" } } : undefined).then(() => 200, (e: Error) => Number(/-> (\d{3})/.exec(e.message)?.[1]));
    expect([403, 404], `${m} ${u}`).toContain(r);
  }
  // The person can still compute numbers on what they were given.
  const r = await viewerApi.call<{ rows: { value: number }[] }>("GET", `/metric-query?metric=${encodeURIComponent(JSON.stringify({ name: "n", source: dealsId, measure: { agg: "count" } }))}&datahub_id=${hubId}`);
  expect(r.rows[0]!.value).toBeGreaterThan(0);
});
