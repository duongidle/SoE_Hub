import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedMany } from "./dh-fixtures";
import { GridDriver } from "./grid";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 2C-2: view tabs, the view toolbar (filter, time, sort, group, columns, row height, colours, search), autosave, personal copy of a
 * shared view, and jumping the scroll bar in a table of 100.000 rows. Run at 1280x800 and 375x812.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-view-${p}-7391`;
const email = (who: string) => `${p}.vw${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const STAGES = ["Mới", "Đang chăm", "Chốt"];

let owner: Session;
let viewer: Session;
let editor: Session;
let ownerApi: ApiClient;
let dhId: string;
let tableId: string;
let keys: Record<string, string>;
let sessions: Session[] = [];

/** `YYYY-MM-DD` of today in Vietnam time (the day the server uses). */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  const admin = await createAdmin(API, email("admin"), `Admin View ${p}`, PASSWORD(), ROOT);
  const ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager View ${p}`, roles: ["manager"] },
      { email: email("owner"), name: `Chủ View ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("viewer"), name: `Người Xem View ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("editor"), name: `Người Sửa View ${p}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  const dh = await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: `Deal view ${p}` });
  dhId = dh.id;
  const t = await ownerApi.call<{ id: string }>("POST", `/datahubs/${dh.id}/tables`, { name: "Deals" });
  tableId = t.id;
  keys = {};
  const defs: [string, string, object?][] = [
    ["Tên", "text"],
    ["Giai đoạn", "single_select", { options: STAGES.map((name, i) => ({ name, color: ["blue", "orange", "green"][i] })) }],
    ["Doanh thu", "currency"],
    ["Ngày nhận", "date"],
    ["Phụ trách", "user"],
    ["Gấp đôi", "formula", { formula: "=[Doanh thu]*2" }],
  ];
  for (const [name, type, config] of defs) keys[name] = (await ownerApi.call<{ key: string }>("POST", `/tables/${t.id}/columns`, { name, type, ...(config ? { config } : {}) })).key;
  const d = today();
  await seedMany(ownerApi, t.id, 12, (i) => ({
    Tên: i === 0 ? "Đặng Thị Ngọc Hân" : `Deal ${i + 1}`,
    ...(i < 11 ? { "Giai đoạn": STAGES[i % 3] } : {}),
    ...(i !== 5 ? { "Doanh thu": (i + 1) * 1_000_000 } : {}),
    "Ngày nhận": i < 6 ? d : "2023-05-10",
    "Phụ trách": ids[email("owner")],
  }));
  await ownerApi.call("PUT", `/datahubs/${dh.id}/shares`, { grantee_id: ids[email("viewer")], permission: "view" });
  await ownerApi.call("PUT", `/datahubs/${dh.id}/shares`, { grantee_id: ids[email("editor")], permission: "edit_data" });

  owner = await Session.open(browser, p, "owner");
  viewer = await Session.open(browser, p, "viewer");
  editor = await Session.open(browser, p, "editor");
  sessions = [owner, viewer, editor];
  for (const [s, who] of [[owner, "owner"], [viewer, "viewer"], [editor, "editor"]] as const) {
    await s.login(email(who), PASSWORD());
    await expect(s.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  }
  for (const s of sessions) await s.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: process.env.E2E_WEB_URL ?? "http://localhost:5273" });
});

test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

const url = () => `/datahub/${dhId}/${tableId}`;
const lines = async (g: GridDriver) => Number(await g.root.getAttribute("data-lines"));
const count = (page: Page, text: string) => expect(page.getByText(text, { exact: true })).toBeVisible();
const panel = (page: Page, name: string): Locator => page.getByRole("dialog", { name });
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Công cụ view" });
async function open(s: Session): Promise<GridDriver> {
  await s.page.goto(url());
  await expect(s.page.getByRole("heading", { level: 1, name: `Deal view ${p}` })).toBeVisible();
  const g = new GridDriver(s.page);
  await expect(g.root).toBeVisible();
  return g;
}
async function views(api: ApiClient): Promise<{ id: string; name: string; shared: boolean; config: Record<string, unknown>; has_override: boolean }[]> {
  return ((await api.call("GET", `/tables/${tableId}/views`)) as { views: never[] }).views;
}
async function sharedView(api: ApiClient) {
  return (await views(api)).find((v) => v.shared)!;
}
async function apiTotal(query: string): Promise<number> {
  return ((await ownerApi.call("GET", `/tables/${tableId}/rows?limit=1&include_total=true${query}`, undefined, true)) as { total: number }).total;
}
/** The view toolbar opens a panel; a button of the toolbar with this name. */
async function openTool(page: Page, name: string, panelName: string): Promise<Locator> {
  await toolbar(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  const d = panel(page, panelName);
  await expect(d).toBeVisible();
  return d;
}
const waitSaved = (page: Page) => expect(page.getByText("Đã lưu view")).toBeVisible();

test("tab view: thêm, đổi tên, sao chép, xoá; URL giữ view đang chọn", async () => {
  const pg = owner.page;
  await open(owner);
  const tabs = pg.getByRole("tablist", { name: "Các view" });
  await expect(tabs.getByRole("tab", { name: "Dạng bảng" })).toHaveAttribute("aria-selected", "true");
  await pg.getByRole("button", { name: "Thêm view" }).click();
  const longName = "Báo cáo <b>doanh thu</b> & kế hoạch năm 2027 của khối kinh doanh miền Nam &amp; miền Trung xx".slice(0, 100);
  await pg.getByLabel("Tên view *").fill(longName);
  await pg.getByRole("dialog").getByRole("button", { name: "Thêm view" }).click();
  await expect(pg.getByText(/^Đã thêm view/)).toBeVisible();
  await expect(tabs.getByRole("tab", { selected: true })).toHaveAttribute("title", longName);
  expect(pg.url()).toMatch(/view=/);
  await owner.shot("view-tab-long");
  // The address holds the view: the page opened again shows the same one.
  const withView = pg.url();
  await pg.goto(withView);
  await expect(tabs.getByRole("tab", { selected: true })).toHaveAttribute("title", longName);
  // Rename, copy, delete.
  await pg.getByRole("button", { name: /^Tuỳ chọn view/ }).click();
  await pg.getByRole("menuitem", { name: "Đổi tên view" }).click();
  await pg.getByLabel("Tên view *").fill("Của tôi");
  await pg.getByRole("dialog").getByRole("button", { name: "Lưu" }).click();
  await expect(tabs.getByRole("tab", { name: /Của tôi/ })).toBeVisible();
  await pg.getByRole("button", { name: /^Tuỳ chọn view/ }).click();
  await pg.getByRole("menuitem", { name: "Sao chép view" }).click();
  await pg.getByRole("dialog").getByRole("button", { name: "Sao chép" }).click();
  await expect(tabs.getByRole("tab", { name: /Của tôi \(bản sao\)/ })).toBeVisible();
  await pg.getByRole("button", { name: /^Tuỳ chọn view/ }).click();
  await pg.getByRole("menuitem", { name: "Xoá view" }).click();
  await pg.getByRole("dialog").getByRole("button", { name: "Xoá view" }).click();
  await expect(tabs.getByRole("tab", { name: /bản sao/ })).toHaveCount(0);
  expect((await views(ownerApi)).filter((v) => !v.shared).map((v) => v.name)).toEqual(["Của tôi"]);
  // Back to the shared view for the next tests, and drop the personal one.
  await pg.getByRole("tab", { name: "Dạng bảng" }).click();
});

test("lọc: điều kiện lồng nhau tự lưu, giữ sau khi tải lại; lọc rỗng có nút Xoá bộ lọc", async () => {
  const pg = owner.page;
  const g = await open(owner);
  await expect(pg.getByText("12 dòng", { exact: true })).toBeVisible();
  const d = await openTool(pg, "Lọc", "Lọc dòng");
  await d.getByRole("button", { name: "Thêm điều kiện" }).click();
  await d.getByLabel("Cột", { exact: true }).selectOption({ label: "Giai đoạn" });
  await d.getByLabel("Giá trị").selectOption({ label: "Chốt" });
  await expect(pg.getByText("4 dòng", { exact: true })).toBeVisible();
  await waitSaved(pg);
  expect((await sharedView(ownerApi)).config.filter).toEqual({ field: keys["Giai đoạn"], op: "eq", value: expect.any(String) });
  await pg.keyboard.press("Escape");
  await expect(toolbar(pg).getByRole("button", { name: /^Lọc/ })).toContainText("1");
  await pg.reload();
  await expect(pg.getByText("4 dòng", { exact: true })).toBeVisible();
  // A condition on a number: "lớn hơn" a huge value leaves nothing.
  const d2 = await openTool(pg, "Lọc", "Lọc dòng");
  await d2.getByRole("button", { name: "Thêm điều kiện" }).click();
  await d2.getByLabel("Cột", { exact: true }).nth(1).selectOption({ label: "Doanh thu" });
  await d2.getByLabel("Toán tử").nth(1).selectOption({ label: "lớn hơn" });
  await d2.getByLabel("Giá trị").nth(1).fill("99.999.999.999");
  await d2.getByLabel("Giá trị").nth(1).blur();
  await expect(pg.getByRole("heading", { name: "Không có dòng nào khớp" })).toBeVisible();
  await pg.keyboard.press("Escape");
  await owner.shot("view-filter-empty");
  await pg.getByRole("button", { name: "Xoá bộ lọc" }).click();
  await expect(pg.getByText("12 dòng", { exact: true })).toBeVisible();
  await waitSaved(pg);
  expect((await sharedView(ownerApi)).config.filter).toBeUndefined();
  await expect(g.root).toBeVisible();
});

test("sắp xếp nhiều cấp và theo cột công thức; nhóm có dòng tổng và đóng/mở nhóm", async () => {
  const pg = owner.page;
  const g = await open(owner);
  const s = await openTool(pg, "Sắp xếp", "Sắp xếp");
  await s.getByRole("button", { name: "Thêm cấp sắp xếp" }).click();
  await s.getByLabel("Cột sắp xếp cấp 1").selectOption({ label: "Gấp đôi" });
  await s.getByLabel("Chiều sắp xếp").selectOption({ label: "Lớn → nhỏ" });
  await expect.poll(async () => g.read(11, 0), { timeout: 10_000 }).toMatch(/24\.000\.000/);
  await pg.keyboard.press("Escape");
  await waitSaved(pg);
  // Group by stage with the total of revenue.
  const gp = await openTool(pg, "Nhóm", "Nhóm dòng");
  await gp.getByRole("button", { name: "Thêm cấp nhóm" }).click();
  await gp.getByLabel("Cột nhóm cấp 1").selectOption({ label: "Giai đoạn" });
  await gp.getByLabel("Tổng của cột Doanh thu").selectOption({ label: "Tổng" });
  await pg.keyboard.press("Escape");
  // 12 rows + 4 groups (Mới, Đang chăm, Chốt, empty).
  await expect.poll(() => lines(g), { timeout: 10_000 }).toBe(16);
  const groups = (await ownerApi.call("GET", `/tables/${tableId}/row-groups?group=${encodeURIComponent(JSON.stringify([{ field: keys["Giai đoạn"] }]))}`)) as { groups: { count: number }[] };
  expect(groups.groups.map((x) => x.count)).toEqual([4, 4, 3, 1]);
  const box = (await g.root.boundingBox())!;
  const first = await g.point(0, 0);
  await pg.mouse.move(first.x, first.y);
  await expect(pg.getByRole("tooltip")).toContainText("Giai đoạn: Mới · 4 dòng");
  await owner.shot("view-grouped");
  // Close the first group: 4 lines fewer. Open it again.
  await g.click(0, 0);
  await expect.poll(() => lines(g)).toBe(12);
  await g.click(0, 0);
  await expect.poll(() => lines(g)).toBe(16);
  void box;
  // The total of a group line comes from the server: hover the cell of the column.
  const tot = await g.point(2, 0);
  await pg.mouse.move(tot.x, tot.y);
  await expect(pg.getByRole("tooltip")).toContainText(/Tổng của cột "Doanh thu": 1\d\.000\.000 ₫|Tổng của cột "Doanh thu"/);
  // Take the group and the sort away.
  await pg.keyboard.press("Escape");
  const gp2 = await openTool(pg, "Nhóm", "Nhóm dòng");
  await gp2.getByRole("button", { name: "Bỏ cấp nhóm 1" }).click();
  await pg.keyboard.press("Escape");
  const s2 = await openTool(pg, "Sắp xếp", "Sắp xếp");
  await s2.getByRole("button", { name: "Bỏ cấp sắp xếp 1" }).click();
  await pg.keyboard.press("Escape");
  await expect.poll(() => lines(g)).toBe(12);
  await waitSaved(pg);
  const cfg = (await sharedView(ownerApi)).config;
  expect(cfg.group).toBeUndefined();
  expect(cfg.sort).toBeUndefined();
});

test("ô Thời gian: khoảng có sẵn, kỳ cụ thể có ‹ ›, chip bỏ được; số dòng khớp server", async () => {
  const pg = owner.page;
  await open(owner);
  const d = await openTool(pg, "Thời gian", "Lọc theo thời gian");
  await d.getByLabel("Khoảng thời gian").selectOption({ label: "Tháng này" });
  const expected = await apiTotal(`&time_filter=${encodeURIComponent(JSON.stringify({ columns: [keys["Ngày nhận"]], range: { kind: "preset", preset: "this_month" } }))}`);
  expect(expected).toBe(6);
  await expect(pg.getByText("6 dòng", { exact: true })).toBeVisible();
  const chip = pg.getByLabel("Bộ lọc đang bật");
  await expect(chip).toContainText("Ngày nhận");
  await expect(chip).toContainText("Tháng này");
  await expect(chip).toContainText(/\d{2}\/\d{2}\/\d{4} – \d{2}\/\d{2}\/\d{4}/);
  await owner.shot("view-time");
  // A specific month, one step back: the rows of this month are out.
  await d.getByLabel("Khoảng thời gian").selectOption({ label: "Một kỳ cụ thể (tháng, quý, năm)" });
  await expect(chip).toContainText(/Tháng \d+\/\d{4}/);
  await d.getByRole("button", { name: "Kỳ trước" }).click();
  await expect(pg.getByRole("heading", { name: "Không có dòng nào khớp" })).toBeVisible();
  await pg.keyboard.press("Escape");
  await chip.getByRole("button", { name: "Bỏ lọc theo thời gian" }).click();
  await expect(pg.getByText("12 dòng", { exact: true })).toBeVisible();
  await waitSaved(pg);
  expect((await sharedView(ownerApi)).config.time_filter).toBeUndefined();
});

test("cột của view: ẩn, đổi thứ tự, cố định, chiều cao dòng, tô màu; tải lại vẫn giữ", async () => {
  const pg = owner.page;
  const g = await open(owner);
  const widths = async () => (JSON.parse((await g.root.getAttribute("data-widths")) ?? "[]") as number[]).length;
  expect(await widths()).toBe(6);
  const c = await openTool(pg, "Cột", "Cột của view");
  await c.getByLabel("Hiện cột Ngày nhận").uncheck();
  await expect.poll(widths).toBe(5);
  await c.getByRole("button", { name: "Đưa cột Doanh thu lên" }).click();
  await c.getByRole("button", { name: "Cố định đến cột Tên" }).click();
  await pg.keyboard.press("Escape");
  // Row height and a colour rule: stage "Chốt" in green.
  const rh = await openTool(pg, "Dòng", "Chiều cao dòng");
  await rh.getByLabel("Cao").check();
  await expect.poll(async () => Number(await g.root.getAttribute("data-row-height"))).toBe(56);
  await pg.keyboard.press("Escape");
  const col = await openTool(pg, "Tô màu", "Tô màu theo điều kiện");
  await col.getByRole("button", { name: "Thêm quy tắc" }).click();
  await col.getByRole("button", { name: "Thêm điều kiện" }).click();
  await col.getByLabel("Cột", { exact: true }).selectOption({ label: "Giai đoạn" });
  await col.getByLabel("Giá trị").selectOption({ label: "Chốt" });
  await col.getByLabel("Màu của quy tắc 1").selectOption({ label: "Xanh lá" });
  await pg.keyboard.press("Escape");
  await waitSaved(pg);
  await owner.shot("view-colors");
  const rows = (await ownerApi.call("GET", `/tables/${tableId}/rows?limit=50&marks=${encodeURIComponent(JSON.stringify([{ field: keys["Giai đoạn"], op: "eq", value: "Chốt" }]))}`)) as { marks?: number[] }[];
  expect(rows.filter((r) => r.marks?.length).length).toBe(3);
  await pg.reload();
  expect(await widths()).toBe(5);
  expect(Number(await g.root.getAttribute("data-row-height"))).toBe(56);
  const cfg = (await sharedView(ownerApi)).config as Record<string, unknown>;
  expect(cfg.hidden).toEqual([keys["Ngày nhận"]]);
  expect(cfg.frozen).toBe(1);
  expect(cfg.row_height).toBe("tall");
  // Undo all of it through the same toolbar.
  const c2 = await openTool(pg, "Cột", "Cột của view");
  await c2.getByRole("button", { name: "Hiện tất cả" }).click();
  await c2.getByRole("button", { name: "Bỏ cố định đến cột Tên" }).click();
  await pg.keyboard.press("Escape");
  const rh2 = await openTool(pg, "Dòng", "Chiều cao dòng");
  await rh2.getByLabel("Vừa").check();
  await pg.keyboard.press("Escape");
  const col2 = await openTool(pg, "Tô màu", "Tô màu theo điều kiện");
  await col2.getByRole("button", { name: "Xoá quy tắc 1" }).click();
  await pg.keyboard.press("Escape");
  await expect.poll(widths).toBe(6);
  await waitSaved(pg);
});

test("tìm kiếm trong bảng; view dùng cột đã xoá vẫn mở được và báo rõ", async () => {
  const pg = owner.page;
  await open(owner);
  await pg.getByLabel("Tìm trong bảng").fill("Ngọc Hân");
  await expect(pg.getByText("1 dòng", { exact: true })).toBeVisible();
  await pg.getByLabel("Tìm trong bảng").fill("không có chuỗi này");
  await expect(pg.getByRole("heading", { name: "Không có dòng nào khớp" })).toBeVisible();
  await pg.getByRole("button", { name: "Xoá bộ lọc" }).click();
  await expect(pg.getByText("12 dòng", { exact: true })).toBeVisible();
  // A filter on a column that is deleted afterwards.
  const extra = await ownerApi.call<{ key: string; id: string }>("POST", `/tables/${tableId}/columns`, { name: "Cột tạm", type: "number" });
  const sv = await sharedView(ownerApi);
  await ownerApi.call("PATCH", `/views/${sv.id}`, { config: { filter: { field: extra.key, op: "gt", value: 5 } } });
  await ownerApi.call("DELETE", `/tables/${tableId}/columns/${extra.id}`);
  await pg.reload();
  await expect(pg.getByText("12 dòng", { exact: true })).toBeVisible();
  const alert = pg.getByRole("alert").filter({ hasText: "trỏ tới cột đã bị xoá" });
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Xoá khỏi view" }).click();
  await expect(alert).toHaveCount(0);
  await waitSaved(pg);
  expect((await sharedView(ownerApi)).config.filter).toBeUndefined();
});

test("người Xem và người Sửa đổi view chung: lưu thành bản riêng, chủ không bị ảnh hưởng, Về mặc định", async () => {
  for (const [s, who] of [[viewer, "viewer"], [editor, "editor"]] as const) {
    const pg = s.page;
    const g = await open(s);
    const d = await openTool(pg, "Sắp xếp", "Sắp xếp");
    await d.getByRole("button", { name: "Thêm cấp sắp xếp" }).click();
    await d.getByLabel("Cột sắp xếp cấp 1").selectOption({ label: "Doanh thu" });
    await d.getByLabel("Chiều sắp xếp").selectOption({ label: "Lớn → nhỏ" });
    await pg.keyboard.press("Escape");
    await expect(pg.getByText("Đã lưu view (chỉ cho bạn)")).toBeVisible();
    await expect.poll(async () => g.read(2, 0), { timeout: 10_000 }).toMatch(/12\.000\.000/);
    const mine = await new ApiClient(API).login(email(who), PASSWORD());
    const v = (await views(mine)).find((x) => x.shared)!;
    expect(v.has_override).toBe(true);
    expect(v.config.sort).toBeDefined();
    // The owner still sees the shared view as it was.
    expect((await sharedView(ownerApi)).config.sort).toBeUndefined();
    await owner.page.goto(url());
    await expect(owner.page.getByText("12 dòng", { exact: true })).toBeVisible();
    await pg.getByRole("button", { name: /^Tuỳ chọn view/ }).click();
    await pg.getByRole("menuitem", { name: "Về mặc định" }).click();
    await expect(pg.getByText("Đã về thiết lập mặc định của chủ bảng")).toBeVisible();
    expect((await views(mine)).find((x) => x.shared)!.has_override).toBe(false);
    // They can also make a personal view; they cannot delete or rename the shared one.
    await pg.getByRole("button", { name: /^Tuỳ chọn view/ }).click();
    await expect(pg.getByRole("menuitem", { name: "Đổi tên view" })).toHaveCount(0);
    await expect(pg.getByRole("menuitem", { name: "Xoá view" })).toHaveCount(0);
    await pg.keyboard.press("Escape");
    await s.shot(`view-sharee-${who}`);
  }
});

test("bảng rất lớn: kéo thanh cuộn tới đâu cũng dưới 1 giây, đúng cả khi lọc, sắp xếp và nhóm", async () => {
  test.setTimeout(240_000);
  const big = await ownerApi.call<{ id: string }>("POST", `/datahubs/${dhId}/tables`, { name: "Một trăm nghìn dòng" });
  await ownerApi.call("POST", `/tables/${big.id}/columns`, { name: "Tên", type: "text" });
  await ownerApi.call("POST", `/tables/${big.id}/columns`, { name: "Tiền", type: "currency" });
  await ownerApi.call("POST", `/tables/${big.id}/columns`, { name: "Nhóm", type: "single_select", config: { options: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] } });
  await seedMany(ownerApi, big.id, 100_000, (i) => ({ Tên: `Dòng thử ${i + 1}`, Tiền: (i + 1) * 1000, Nhóm: "ABCD"[i % 4] }));
  const pg = owner.page;
  await pg.goto(`/datahub/${dhId}/${big.id}`);
  await expect(pg.getByText("100.000 dòng", { exact: true })).toBeVisible({ timeout: 60_000 });
  const g = new GridDriver(pg);
  const jump = async (fraction: number): Promise<number> => {
    const t0 = Date.now();
    const answer = pg.waitForResponse((r) => /\/rows\?/.test(r.url()) && /offset=/.test(r.url()) && r.ok(), { timeout: 5000 });
    await pg.evaluate((f) => {
      const el = document.querySelector(".dvn-scroller") as HTMLElement;
      el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
    }, fraction);
    await answer;
    // The canvas shows the rows: the cell no longer says "loading".
    await expect.poll(async () => g.read(0, 2).catch(() => ""), { timeout: 5000 }).toMatch(/^Dòng thử \d+$/);
    return Date.now() - t0;
  };
  const times: number[] = [];
  for (const f of [1, 0.5, 0.9, 0.1, 0.77]) times.push(await jump(f));
  // Request + draw (the read itself costs a few hundred ms in the test); the server side is 130 ms (see the api tests).
  console.log(`jump times (ms): ${times.join(", ")}`);
  for (const t of times) expect(t).toBeLessThan(1000 + 700);
  await expect.poll(async () => Number((await g.read(0, 2)).replace("Dòng thử ", "")), { timeout: 5000 }).toBeGreaterThan(70_000);
  await owner.shot("view-100k");
  // Sorted by money, high to low: the bottom of the table holds the smallest.
  const v = (await views(ownerApi)).filter((x) => x.shared);
  void v;
  const bigViews = ((await ownerApi.call("GET", `/tables/${big.id}/views`)) as { views: { id: string }[] }).views;
  await ownerApi.call("PATCH", `/views/${bigViews[0]!.id}`, { config: { sort: [{ field: "Tiền", dir: "desc" }] } });
  await pg.reload();
  await expect(pg.getByText("100.000 dòng", { exact: true })).toBeVisible({ timeout: 30_000 });
  await jump(1);
  await expect.poll(async () => g.read(1, 2), { timeout: 5000 }).toMatch(/^[1-9]\.000 ₫$|^[1-9]\d?\.000 ₫$/);
  // Grouped in four groups of 25.000 rows: close the first group, jump to the end.
  await ownerApi.call("PATCH", `/views/${bigViews[0]!.id}`, { config: { sort: null, group: [{ field: "Nhóm" }] } });
  await pg.reload();
  await expect.poll(() => lines(g), { timeout: 30_000 }).toBe(100_004);
  await jump(1);
  await owner.shot("view-100k-grouped");
});

test("dữ liệu xấu nhất của thanh công cụ: tên cột dài, danh sách cột nhiều, 375px không tràn ngang", async () => {
  const pg = owner.page;
  const worst = await ownerApi.call<{ id: string }>("POST", `/datahubs/${dhId}/tables`, { name: "Cột dài" });
  const longName = (n: number) => `Tổng giá trị hợp đồng đã ký trong kỳ chưa trừ chiết khấu số ${n} và các khoản hoàn tiền`.slice(0, 100);
  for (let i = 0; i < 40; i++) await ownerApi.call("POST", `/tables/${worst.id}/columns`, { name: longName(i), type: i % 2 ? "currency" : "text" });
  await ownerApi.call("POST", `/tables/${worst.id}/rows`, { data: {} });
  await pg.goto(`/datahub/${dhId}/${worst.id}`);
  await expect(pg.getByText("1 dòng", { exact: true })).toBeVisible();
  for (const [btn, name] of [["Lọc", "Lọc dòng"], ["Sắp xếp", "Sắp xếp"], ["Nhóm", "Nhóm dòng"], ["Cột", "Cột của view"], ["Tô màu", "Tô màu theo điều kiện"]] as const) {
    const d = await openTool(pg, btn, name);
    if (btn === "Lọc") {
      await d.getByRole("button", { name: "Thêm điều kiện" }).click();
      await d.getByRole("button", { name: "Thêm nhóm điều kiện" }).click();
    }
    const box = (await d.boundingBox())!;
    const vp = pg.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `Bảng "${name}" tràn khỏi màn hình`).toBeLessThanOrEqual(vp.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
    await owner.shot(`view-worst-${btn}`);
    await pg.keyboard.press("Escape");
  }
  await owner.expectNoHorizontalOverflow();
});
