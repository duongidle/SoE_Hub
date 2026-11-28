import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { seedLead, seedMany, type LeadFixture } from "./dh-fixtures";
import { GridDriver } from "./grid";
import { API, Session, type ProjectName, chooseOption, expectMore, moreAction } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 2C-1: datahub list, table tabs, the data grid (read, edit, paste, fill, undo, delete, bulk edit), the row panel and live updates.
 * Run once per project (desktop 1280x800, phone 375x812). People are made through the API; the checks go through the pages.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const phone = () => p === "phone";
const PASSWORD = () => `Kiem-thu-dh-${p}-7391`;
const email = (who: string) => `${p}.dh${who}@base.vn`;
const longEmail = () => `${p}.bartholomew.fitzgerald-northwind-holdings@base.vn`;
const COL = { name: 0, revenue: 1, rate: 2, date: 3, called: 4, rating: 5, stage: 6, source: 7, owner: 8, note: 9, qty: 10, double: 11, unit: 12, rowId: 13 };

let owner: Session;
let viewer: Session;
let editor: Session;
let ownerApi: ApiClient;
let fx: LeadFixture;
let worst: { datahubId: string; tableId: string; name: string };
let ids: Record<string, string>;
let sessions: Session[] = [];

const ROOT = path.join(process.cwd(), "../..");

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  const admin = await createAdmin(API, email("admin"), `Admin DH ${p}`, PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager DH ${p}`, roles: ["manager"] },
      { email: email("owner"), name: `Đặng Thị Ngọc Hân ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("viewer"), name: `Người Xem ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("editor"), name: `Người Sửa ${p}`, roles: ["user"], manager: email("mgr") },
      { email: longEmail(), name: "Nguyễn Trần Bảo Khánh Linh Phương", roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  fx = await seedLead(ownerApi, `Theo dõi lead ${p}`, { people: [{ id: ids[email("owner")]!, name: `Đặng Thị Ngọc Hân ${p}` }] });
  await ownerApi.call("PUT", `/datahubs/${fx.datahubId}/shares`, { grantee_id: ids[email("viewer")], permission: "view" });
  await ownerApi.call("PUT", `/datahubs/${fx.datahubId}/shares`, { grantee_id: ids[email("editor")], permission: "edit_data" });
  // The worst realistic data, made through the API: names at the limit of the schema (100 characters), markup in names, a very
  // long person name, huge and negative numbers, a long text.
  const longApi = await new ApiClient(API).login(longEmail(), PASSWORD());
  const wName = `Báo cáo <b>doanh thu</b> & kế hoạch năm 2027 của khối kinh doanh miền Nam &amp; miền Trung ${p}`.slice(0, 100);
  const wDh = await longApi.call<{ id: string }>("POST", "/datahubs", { name: wName });
  const wTable = await longApi.call<{ id: string }>("POST", `/datahubs/${wDh.id}/tables`, { name: "Doanh thu dự kiến theo từng quý của tất cả các nhóm bán hàng trên toàn quốc (bản nháp thứ ba)".slice(0, 100) });
  const longCol = "Tổng giá trị hợp đồng đã ký trong kỳ chưa trừ chiết khấu và các khoản hoàn tiền cho khách hàng".slice(0, 100);
  await longApi.call("POST", `/tables/${wTable.id}/columns`, { name: "Tên", type: "text" });
  await longApi.call("POST", `/tables/${wTable.id}/columns`, { name: longCol, type: "currency" });
  await longApi.call("POST", `/tables/${wTable.id}/columns`, { name: "Ghi chú", type: "long_text" });
  await longApi.call("POST", `/tables/${wTable.id}/columns`, { name: "Phụ trách", type: "user" });
  for (const [n, v, note] of [
    ["Nguyễn Trần Bảo Khánh Linh Phương — công ty cổ phần thương mại dịch vụ xuất nhập khẩu", 12_345_678_900, "x".repeat(40) + " " + "Ghi chú rất dài ".repeat(60)],
    ["Vy", -987_654_321, ""],
    ["<b>Đậm</b> &amp; nghiêng", 0, "dòng 1\ndòng 2\ndòng 3"],
  ] as const) await longApi.call("POST", `/tables/${wTable.id}/rows`, { data: { Tên: n, [longCol]: v, "Ghi chú": note || undefined, "Phụ trách": ids[longEmail()] } });
  await longApi.call("PUT", `/datahubs/${wDh.id}/shares`, { grantee_id: ids[email("viewer")], permission: "view" });
  worst = { datahubId: wDh.id, tableId: wTable.id, name: wName };
  owner = await Session.open(browser, p, "owner");
  viewer = await Session.open(browser, p, "viewer");
  editor = await Session.open(browser, p, "editor");
  sessions = [owner, viewer, editor];
  // Expected refusals: a duplicate name (409), a cell edited by someone else (409), a datahub that does not exist (404), and the open
  // table read once more just after it was deleted (the live signal can arrive before the page has moved to another tab).
  owner.allow(409, /\/api\/v1\/datahubs$/).allow(409, /\/rows\/batch$/).allow(404, /\/api\/v1\/datahubs\//).allow(404, /\/api\/v1\/tables\/[0-9a-f-]+$/);
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

const leadUrl = () => `/datahub/${fx.datahubId}/${fx.leadId}`;
const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

async function openLead(s: Session): Promise<GridDriver> {
  await s.page.goto(leadUrl());
  await expect(s.page.getByRole("heading", { level: 1, name: `Theo dõi lead ${p}` })).toBeVisible();
  await expect(s.page.getByText(/^[\d.]+ dòng$/)).toBeVisible();
  const g = new GridDriver(s.page);
  await expect(g.root).toBeVisible();
  return g;
}

async function apiRows(): Promise<{ id: string; data: Record<string, unknown> }[]> {
  return (await ownerApi.call<{ id: string; data: Record<string, unknown> }[]>("GET", `/tables/${fx.leadId}/rows?limit=500`)) as never;
}
const cellOf = (r: { data: Record<string, unknown> }, name: string) => r.data[fx.keys[name]!];

test("menu Datahub, danh sách: tạo, đổi tên, xoá và hoàn tác; 4 trạng thái", async () => {
  const pg = owner.page;
  await pg.goto("/");
  await expect(pg.getByRole("heading", { level: 1, name: /^Xin chào/ })).toBeVisible();
  await owner.clickMenu("Datahub");
  await expect(pg).toHaveURL(/\/datahub$/);
  await expect(pg.getByRole("heading", { level: 1, name: "Datahub" })).toBeVisible();
  await expect(pg.getByRole("link", { name: `Mở datahub Theo dõi lead ${p}` })).toBeVisible();
  await expect(pg.getByText(/^Chủ:/)).toHaveCount(0);

  await pg.getByRole("button", { name: "Tạo datahub" }).click();
  const d = pg.getByRole("dialog", { name: "Tạo datahub" });
  await d.getByLabel("Tên *").fill("sai [tên]");
  await d.getByLabel("Tên *").blur();
  await expect(d.getByRole("alert")).toContainText("chứa dấu [ hoặc ]");
  await d.getByLabel("Tên *").fill("Bảng nháp");
  await d.getByRole("button", { name: "Tạo datahub" }).click();
  await expect(d).toBeHidden();
  await expect(pg.getByRole("link", { name: "Mở datahub Bảng nháp" })).toBeVisible();
  await expect(toast(pg, 'Đã tạo datahub "Bảng nháp"')).toBeVisible();

  // The name is unique among my datahubs: the second try fails with a readable message.
  await pg.getByRole("button", { name: "Tạo datahub" }).click();
  await pg.getByRole("dialog", { name: "Tạo datahub" }).getByLabel("Tên *").fill("bảng nháp");
  await pg.getByRole("dialog", { name: "Tạo datahub" }).getByRole("button", { name: "Tạo datahub" }).click();
  await expect(pg.getByRole("dialog", { name: "Tạo datahub" }).getByRole("alert")).toBeVisible();
  // A focused input shows one thin border and a soft ring, never the global 2px outline on top of them.
  const nameField = pg.getByRole("dialog", { name: "Tạo datahub" }).getByLabel("Tên *");
  await nameField.focus();
  await expect(nameField).toHaveCSS("outline-style", "none");
  await owner.shot("13-focus-input");
  await pg.getByRole("dialog", { name: "Tạo datahub" }).getByRole("button", { name: "Huỷ" }).click();
  await expect(pg.getByRole("dialog", { name: "Bỏ thay đổi?" })).toBeHidden();

  await pg.getByRole("button", { name: "Tuỳ chọn cho Bảng nháp" }).click();
  await pg.getByRole("menuitem", { name: "Đổi tên" }).click();
  const r = pg.getByRole("dialog", { name: "Đổi tên datahub" });
  await r.getByLabel("Tên *").fill("Bảng nháp 2");
  await r.getByRole("button", { name: "Lưu" }).click();
  await expect(pg.getByRole("link", { name: "Mở datahub Bảng nháp 2" })).toBeVisible();

  await pg.getByRole("button", { name: "Tuỳ chọn cho Bảng nháp 2" }).click();
  await pg.getByRole("menuitem", { name: "Xoá datahub" }).click();
  // No question asked: it is gone at once and the toast offers "Hoàn tác".
  await expect(pg.getByRole("dialog")).toHaveCount(0);
  await expect(pg.getByRole("link", { name: "Mở datahub Bảng nháp 2" })).toHaveCount(0);
  await toast(pg, 'Đã xoá datahub "Bảng nháp 2"').waitFor();
  await owner.shot("10a-dh-undo-toast");
  await toast(pg, 'Đã xoá datahub "Bảng nháp 2"').getByRole("button", { name: "Hoàn tác" }).click();
  await expect(pg.getByRole("link", { name: "Mở datahub Bảng nháp 2" })).toBeVisible();
  await owner.shot("10-dh-list");

  // Shared with me: the owner's name and the permission, no menu of options.
  await viewer.page.goto("/datahub");
  await viewer.page.getByRole("tab", { name: /Được chia sẻ với tôi/ }).click();
  await expect(viewer.page).toHaveURL(/[?&]tab=shared/);
  await viewer.page.reload();
  await expect(viewer.page.getByRole("tab", { name: /Được chia sẻ với tôi/ })).toHaveAttribute("aria-selected", "true");
  await expect(viewer.page.getByText(`Chủ: Đặng Thị Ngọc Hân ${p}`)).toBeVisible();
  await viewer.shot("12b2-datahub-owner-chip");
  await expect(viewer.page.getByText("Xem", { exact: true }).first()).toBeVisible();
  await expect(viewer.page.getByRole("button", { name: /Tuỳ chọn cho/ })).toHaveCount(0);
  await expect(viewer.page.getByRole("button", { name: "Tạo datahub" })).toBeVisible();
  await viewer.shot("11-dh-shared");
  // Empty state of the "mine" tab for a person with no datahub.
  await viewer.page.getByRole("tab", { name: /Của tôi/ }).click();
  await expect(viewer.page.getByText("Bạn chưa có datahub nào")).toBeVisible();
  await expect(viewer.page.getByRole("button", { name: "Tạo datahub đầu tiên" })).toBeVisible();
  await expect(viewer.page).toHaveURL(/[?&]tab=mine/);
  await viewer.shot("12-dh-empty-cta");
  // "Tất cả" (mine + shared) is the default tab: it keeps the address short.
  await viewer.page.getByRole("tab", { name: /^Tất cả/ }).click();
  await expect(viewer.page).not.toHaveURL(/tab=/);
  await expect(viewer.page.getByText(`Chủ: Đặng Thị Ngọc Hân ${p}`)).toBeVisible();
});

test("trang datahub: tab bảng, URL gửi được, thêm / đổi tên / chuyển / xoá bảng", async () => {
  const pg = owner.page;
  await pg.goto(`/datahub/${fx.datahubId}`);
  // No table in the address: the first table opens and the address names it.
  await expect(pg).toHaveURL(new RegExp(`/datahub/${fx.datahubId}/[0-9a-f-]{36}$`));
  await expect(pg.getByRole("tab", { name: "Khách hàng" })).toBeVisible();
  await pg.getByRole("tab", { name: "Lead" }).click();
  await expect(pg).toHaveURL(new RegExp(`/${fx.leadId}$`));

  await pg.getByRole("button", { name: "Thêm bảng" }).click();
  await pg.getByRole("menuitem", { name: "Thêm bảng" }).click();
  const d = pg.getByRole("dialog", { name: "Thêm bảng" });
  await d.getByLabel("Tên bảng *").fill("Tạm");
  await d.getByRole("button", { name: "Thêm bảng" }).click();
  await expect(pg.getByRole("tab", { name: "Tạm" })).toHaveAttribute("aria-selected", "true");
  await expect(pg.getByText("Bảng chưa có cột")).toBeVisible();

  await pg.getByRole("button", { name: "Tuỳ chọn bảng Tạm" }).click();
  await pg.getByRole("menuitem", { name: "Đổi tên bảng" }).click();
  await pg.getByRole("dialog", { name: "Đổi tên bảng" }).getByLabel("Tên bảng *").fill("Tạm 2");
  await pg.getByRole("dialog", { name: "Đổi tên bảng" }).getByRole("button", { name: "Lưu" }).click();
  await expect(pg.getByRole("tab", { name: "Tạm 2" })).toBeVisible();

  await pg.getByRole("button", { name: "Tuỳ chọn bảng Tạm 2" }).click();
  await pg.getByRole("menuitem", { name: "Chuyển sang trái" }).click();
  await expect(pg.getByRole("tab").nth(2)).toHaveText("Tạm 2"); // the first tab is Dashboard, pinned on the left

  await pg.getByRole("button", { name: "Tuỳ chọn bảng Tạm 2" }).click();
  await pg.getByRole("menuitem", { name: "Xoá bảng" }).click();
  await Promise.all([pg.waitForResponse((r) => r.request().method() === "DELETE"), pg.getByRole("dialog", { name: "Xoá bảng?" }).getByRole("button", { name: "Xoá bảng" }).click()]);
  await expect(pg.getByRole("tab", { name: "Tạm 2" })).toHaveCount(0);
  await toast(pg, 'Đã xoá bảng "Tạm 2"').getByRole("button", { name: "Hoàn tác" }).click();
  await expect(pg.getByRole("tab", { name: "Tạm 2" })).toBeVisible();
  await owner.shot("12-dh-tabs");
  // Clean up so later tests start from the same tabs.
  await pg.getByRole("tab", { name: "Tạm 2" }).click();
  await pg.getByRole("button", { name: "Tuỳ chọn bảng Tạm 2" }).click();
  await pg.getByRole("menuitem", { name: "Xoá bảng" }).click();
  await Promise.all([pg.waitForResponse((r) => r.request().method() === "DELETE"), pg.getByRole("dialog", { name: "Xoá bảng?" }).getByRole("button", { name: "Xoá bảng" }).click()]);
  await expect(pg.getByRole("tab", { name: "Tạm 2" })).toHaveCount(0);

  // A wrong table in the address: a clear "no access" message, not a blank page.
  await pg.goto(`/datahub/${fx.datahubId}/00000000-0000-7000-8000-000000000000`);
  await expect(pg.getByText("Không mở được bảng")).toBeVisible();
  await pg.goto(`/datahub/00000000-0000-7000-8000-000000000000`);
  await expect(pg.getByText("Không mở được datahub")).toBeVisible();
});

test("grid: mọi kiểu cột hiện đúng định dạng vi-VN, lỗi công thức, ký tự đặc biệt hiện nguyên văn", async () => {
  test.skip(phone(), "Đọc từng ô bằng clipboard chạy ở bản desktop; điện thoại kiểm tra bố cục ở test cuối.");
  const g = await openLead(owner);
  const row0 = [`Đặng Thị Ngọc Hân`, "156.000.000 ₫", "12,5%", "18/11/2026", "Có", "3", "Mới", "Facebook, Sự kiện", `Đặng Thị Ngọc Hân ${p}`, "", "0", "312.000.000", "#DIV/0!", "#1"];
  for (const [c, want] of row0.entries()) expect(await g.read(c, 0), `cột ${c}, dòng 1`).toBe(want);
  expect(await g.read(COL.revenue, 1)).toBe("12.345.678.900 ₫");
  expect(await g.read(COL.unit, 1)).toBe("4.115.226.300");
  expect(await g.read(COL.double, 1)).toBe("24.691.357.800");
  expect(await g.read(COL.name, 2)).toBe("<b>Công ty</b> & Co &amp; Thuận Phát");
  expect(await g.read(COL.revenue, 2)).toBe("-5.000 ₫");
  expect(await g.read(COL.note, 2)).toBe("dòng 1 dòng 2");
  expect(await g.read(COL.date, 1)).toBe("19/11/2026");
  await owner.shot("20-grid");
});

test("sửa ô theo kiểu: chữ, tiền, ngày, phần trăm; sai thì báo rõ và không ghi", async () => {
  test.skip(phone(), "Gõ trong grid: bản desktop.");
  const g = await openLead(owner);
  await g.type(COL.name, 0, "Nguyễn Trần Bảo Khánh Linh Phương");
  await expect(toast(owner.page, "Lỗi")).toHaveCount(0);
  expect(await g.read(COL.name, 0)).toBe("Nguyễn Trần Bảo Khánh Linh Phương");
  await g.type(COL.revenue, 0, "200,000,000");
  expect(await g.read(COL.revenue, 0)).toBe("200.000.000 ₫");
  // The formula of the same row follows at once; a formula never needs the screen to compute it.
  await expect.poll(async () => g.read(COL.double, 0)).toBe("400.000.000");
  await g.type(COL.date, 0, "05/12/2026");
  expect(await g.read(COL.date, 0)).toBe("05/12/2026");
  await g.type(COL.rate, 0, "30");
  expect(await g.read(COL.rate, 0)).toBe("30%");
  await g.type(COL.qty, 0, "4");
  await expect.poll(async () => g.read(COL.unit, 0)).toBe("50.000.000");
  const row = (await apiRows())[0]!;
  expect(cellOf(row, "Doanh thu")).toBe(200_000_000);
  expect(cellOf(row, "Ngày nhận")).toBe("2026-12-05");
  expect(cellOf(row, "Tỉ lệ chốt")).toBe(0.3);

  // Unreadable input: a message that names what is wrong; the value stays.
  await g.type(COL.revenue, 0, "abc");
  await expect(toast(owner.page, "không phải số tiền")).toBeVisible();
  expect(await g.read(COL.revenue, 0)).toBe("200.000.000 ₫");
  // A computed column does not open an editor.
  await g.click(COL.double, 0);
  await owner.page.keyboard.type("9", { delay: 50 });
  await owner.page.waitForTimeout(300);
  expect(await g.read(COL.double, 0)).toBe("400.000.000");
  await owner.shot("21-grid-edited");
});

test("sửa ô lựa chọn, đánh giá, checkbox, người dùng", async () => {
  test.skip(phone(), "Gõ trong grid: bản desktop.");
  const g = await openLead(owner);
  const pg = owner.page;
  // Single select: Enter opens the list.
  await g.click(COL.stage, 1);
  await pg.keyboard.press("Enter");
  await pg.getByRole("option", { name: "Chốt" }).click();
  await expect.poll(async () => g.read(COL.stage, 1)).toBe("Chốt");
  // Multi select: toggle two, Xong.
  await g.click(COL.source, 1);
  await pg.keyboard.press("Enter");
  await pg.getByRole("option", { name: "Giới thiệu" }).click();
  await pg.getByRole("option", { name: "Sự kiện" }).click();
  await pg.getByRole("button", { name: "Xong" }).click();
  await expect.poll(async () => g.read(COL.source, 1)).toBe("Giới thiệu, Sự kiện");
  await owner.shot("22-select-editor");
  // Rating.
  await g.click(COL.rating, 1);
  await pg.keyboard.press("Enter");
  await pg.getByRole("radio", { name: "4 sao" }).click();
  await expect.poll(async () => g.read(COL.rating, 1)).toBe("4");
  // Checkbox: a click on the box.
  const before = await g.read(COL.called, 1);
  const pt = await g.point(COL.called, 1);
  await pg.mouse.click(pt.x, pt.y);
  await pg.mouse.click(pt.x, pt.y);
  await expect.poll(async () => g.read(COL.called, 1)).not.toBe(before);
  // Person: search by name.
  await g.click(COL.owner, 1);
  await pg.keyboard.press("Enter");
  await pg.getByLabel("Tìm người").fill(`Người Xem ${p}`);
  await pg.getByRole("option", { name: new RegExp(`Người Xem ${p}`) }).click();
  await expect.poll(async () => g.read(COL.owner, 1)).toBe(`Người Xem ${p}`);
  const row = (await apiRows())[1]!;
  expect(cellOf(row, "Giai đoạn")).toMatch(/^o_/);
  expect(cellOf(row, "Mức quan tâm")).toBe(4);
  expect(cellOf(row, "Phụ trách")).toBe(ids[email("viewer")]);
});

test("dán vùng từ Excel (ngày dd/mm/yyyy, 156,000,000), thêm dòng mới, và dán sai thì không ghi gì", async () => {
  test.skip(phone(), "Dán vào grid: bản desktop.");
  const g = await openLead(owner);
  const pg = owner.page;
  await g.click(COL.name, 2);
  await g.paste("Khách A\t156,000,000\t7,5%\t01/12/2026\nKhách B\t2.500.000\t10%\t02/12/2026");
  await expect(toast(pg, /Đã dán 8 ô, thêm 1 dòng/)).toBeVisible();
  await expect(pg.getByText(/^4 dòng$/)).toBeVisible();
  expect(await g.read(COL.name, 3)).toBe("Khách B");
  expect(await g.read(COL.revenue, 3)).toBe("2.500.000 ₫");
  expect(await g.read(COL.rate, 2)).toBe("7,5%");
  expect(await g.read(COL.date, 2)).toBe("01/12/2026");
  // Wrong cells: nothing is written, the message names row and column.
  await g.click(COL.revenue, 0);
  await g.paste("1.000\nabc\n");
  await expect(toast(pg, /Dòng 2, cột "Doanh thu"/)).toBeVisible();
  expect(await g.read(COL.revenue, 0)).toBe("200.000.000 ₫");
  // One value over a block fills the block.
  await g.click(COL.stage, 0);
  await pg.keyboard.press("Shift+ArrowDown");
  await pg.keyboard.press("Shift+ArrowDown");
  await g.paste("Đang chăm");
  await expect.poll(async () => g.read(COL.stage, 2)).toBe("Đang chăm");
  await owner.shot("23-pasted");
});

test("hoàn tác và làm lại (Ctrl+Z, nút), điền xuống (Ctrl+D)", async () => {
  test.skip(phone(), "Phím tắt: bản desktop.");
  const g = await openLead(owner);
  const pg = owner.page;
  await expect(pg.getByText(/^4 dòng$/)).toBeVisible();
  // Fill down: the first cell of a column over rows 1-3.
  await g.click(COL.qty, 0);
  await pg.keyboard.press("Shift+ArrowDown");
  await pg.keyboard.press("Shift+ArrowDown");
  await pg.keyboard.press("ControlOrMeta+d");
  await expect.poll(async () => g.read(COL.qty, 2)).toBe("4");
  await expect(toast(pg, /Đã điền 2 ô/)).toBeVisible();
  // Undo the fill, then redo it.
  await moreAction(pg, "Hoàn tác");
  await expect.poll(async () => g.read(COL.qty, 2)).not.toBe("4");
  await moreAction(pg, "Làm lại");
  await expect.poll(async () => g.read(COL.qty, 2)).toBe("4");
  // A row added with the button: undo sends it to the trash, redo brings it back; Ctrl+Z does the same.
  const count = async () => Number(((await pg.getByText(/^[\d.]+ dòng$/).textContent()) ?? "0").replace(/\D/g, ""));
  const total = await count();
  await pg.getByRole("button", { name: "Thêm dòng" }).first().click();
  await expect.poll(count).toBe(total + 1);
  await moreAction(pg, "Hoàn tác");
  await expect.poll(count, { timeout: 15_000 }).toBe(total);
  await moreAction(pg, "Làm lại");
  await expect.poll(count, { timeout: 15_000 }).toBe(total + 1);
  await g.click(COL.name, 0);
  await pg.keyboard.press("ControlOrMeta+z");
  await expect.poll(count, { timeout: 15_000 }).toBe(total);
  await pg.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(count, { timeout: 15_000 }).toBe(total + 1);
  // Put the table back to 4 rows for the next tests: delete the extra row (its trash entry stays, which is what the trash is for).
  await g.clickMarker(total);
  await pg.getByRole("button", { name: "Xoá 1 dòng" }).click();
  await expect.poll(count, { timeout: 15_000 }).toBe(total);
});

test("xoá dòng đã chọn có Hoàn tác; sửa hàng loạt", async () => {
  test.skip(phone(), "Chọn dòng bằng chuột: bản desktop.");
  const g = await openLead(owner);
  const pg = owner.page;
  await g.clickMarker(3);
  await expect(pg.getByRole("button", { name: "Xoá 1 dòng" })).toBeVisible();
  await pg.getByRole("button", { name: "Xoá 1 dòng" }).click();
  await expect(pg.getByText(/^3 dòng$/)).toBeVisible();
  await toast(pg, "Đã xoá 1 dòng").getByRole("button", { name: "Hoàn tác" }).click();
  await expect(pg.getByText(/^4 dòng$/)).toBeVisible();
  expect(await g.read(COL.name, 3)).toBe("Khách B");

  await g.clickMarker(0);
  await expect(pg.getByRole("button", { name: "Sửa 1 dòng" })).toBeVisible();
  await g.clickMarker(1, { append: true });
  await expect(pg.getByRole("button", { name: "Sửa 2 dòng" })).toBeVisible();
  await pg.getByRole("button", { name: "Sửa 2 dòng" }).click();
  const d = pg.getByRole("dialog", { name: "Sửa 2 dòng" });
  await chooseOption(d.getByLabel("Cột"), { label: "Giai đoạn" });
  await chooseOption(d.getByRole("combobox").nth(1), { label: "Chốt" });
  await d.getByRole("button", { name: "Ghi vào 2 dòng" }).click();
  await expect(toast(pg, "Đã sửa 2 dòng")).toBeVisible();
  expect(await g.read(COL.stage, 0)).toBe("Chốt");
  expect(await g.read(COL.stage, 1)).toBe("Chốt");
  await owner.shot("24-bulk");
});

test("chi tiết dòng: sửa trong khung, lịch sử thay đổi", async () => {
  const g = await openLead(owner);
  const pg = owner.page;
  if (phone()) {
    await g.click(COL.name, 0);
  } else await g.click(COL.name, 0);
  await pg.getByRole("button", { name: "Chi tiết dòng" }).click();
  const d = pg.getByRole("dialog", { name: /^Dòng #1$/ });
  await expect(d).toBeVisible();
  // The phone run skips the grid edits of the earlier tests, so the row still holds its first values.
  await expect(d.getByLabel("Doanh thu")).toHaveValue(phone() ? "156.000.000" : "200.000.000"); // thousands separators until the cursor is in the field
  await expect(d.getByLabel("Đơn giá")).toContainText(phone() ? "#DIV/0!" : "50.000.000");
  await d.getByLabel("Ghi chú").fill("Gọi lại sau 3 ngày");
  await d.getByLabel("Ghi chú").blur();
  await expect(toast(pg, "Lỗi")).toHaveCount(0);
  await d.getByLabel("Tỉ lệ chốt").fill("abc");
  await d.getByLabel("Tỉ lệ chốt").blur();
  await expect(d.getByRole("alert").filter({ hasText: "không phải phần trăm" })).toBeVisible();
  await d.getByLabel("Tỉ lệ chốt").fill("45%");
  await d.getByLabel("Tỉ lệ chốt").blur();
  await expect.poll(async () => cellOf((await apiRows())[0]!, "Tỉ lệ chốt")).toBe(0.45);
  await d.getByRole("tab", { name: "Lịch sử thay đổi" }).click();
  await expect(d.getByRole("list", { name: "Lịch sử thay đổi" })).toContainText("Tỉ lệ chốt");
  await expect(d.getByRole("list", { name: "Lịch sử thay đổi" })).toContainText("45%");
  await expect(d.getByRole("list", { name: "Lịch sử thay đổi" })).toContainText(`Đặng Thị Ngọc Hân ${p}`);
  await owner.shot("25-row-panel");
  await pg.keyboard.press("Escape");
  await expect(d).toBeHidden();
});

test("xung đột cùng ô: báo rõ, nạp lại giá trị mới, không ghi đè im lặng", async () => {
  test.skip(phone(), "Gõ trong grid: bản desktop.");
  const pg = owner.page;
  // Hold the live stream back (before the page opens it) so this screen stays unaware of the change made through the API.
  await pg.route("**/api/v1/events", (r) => r.abort());
  const g = await openLead(owner);
  const rows = await apiRows();
  await ownerApi.call("PATCH", `/tables/${fx.leadId}/rows/${rows[2]!.id}`, { data: { "Tên lead": "Đổi qua API" }, base: { "Tên lead": cellOf(rows[2]!, "Tên lead") } });
  await g.type(COL.name, 2, "Tôi sửa sau");
  await expect(toast(pg, /vừa được người khác sửa/)).toBeVisible();
  expect(await g.read(COL.name, 2)).toBe("Đổi qua API");
  expect(cellOf((await apiRows())[2]!, "Tên lead")).toBe("Đổi qua API");
  await pg.unroute("**/api/v1/events");
});

test("người chỉ có quyền Xem: không sửa được; server vẫn chặn", async () => {
  const g = await openLead(viewer);
  const pg = viewer.page;
  await expect(pg.getByText("Chỉ xem", { exact: true })).toBeVisible();
  await expect(pg.getByRole("button", { name: "Thêm dòng" })).toHaveCount(0);
  await expectMore(pg, "Hoàn tác", false);
  if (!phone()) {
    const before = await g.read(COL.name, 0);
    await g.type(COL.name, 0, "Không được");
    await pg.waitForTimeout(400);
    expect(await g.read(COL.name, 0)).toBe(before);
    await g.click(COL.name, 0);
    await g.paste("X\nY");
    await expect(toast(pg, "Bạn chỉ có quyền xem bảng này")).toBeVisible();
  }
  const viewerApi = await new ApiClient(API).login(email("viewer"), PASSWORD());
  await expect(viewerApi.call("POST", `/tables/${fx.leadId}/rows`, { data: { "Tên lead": "lén" } })).rejects.toThrow(/403/);
  await viewer.shot("30-viewer");
});

test("người có quyền Sửa thấy thay đổi của chủ ngay, không cần tải lại", async () => {
  test.skip(phone(), "Hai người cùng mở bảng: bản desktop.");
  const gOwner = await openLead(owner);
  const gEditor = await openLead(editor);
  const before = await gEditor.read(COL.name, 0);
  await gOwner.type(COL.name, 0, "Cập nhật trực tiếp");
  await expect.poll(async () => gEditor.read(COL.name, 0), { timeout: 15_000 }).toBe("Cập nhật trực tiếp");
  expect(before).not.toBe("Cập nhật trực tiếp");
  // The editor edits a cell and the owner sees it; the editor cannot touch structure (no tab menu).
  await gEditor.type(COL.qty, 1, "9");
  await expect.poll(async () => gOwner.read(COL.qty, 1), { timeout: 15_000 }).toBe("9");
  await expect(editor.page.getByRole("button", { name: /Tuỳ chọn bảng/ })).toHaveCount(0);
  await expect(editor.page.getByRole("button", { name: "Thêm bảng" })).toHaveCount(0);
  await editor.shot("31-editor");
});

test("10.000 dòng: nạp từng trang, cuộn xuống cuối, số dòng đúng", async () => {
  test.setTimeout(120_000);
  const big = await ownerApi.call<{ id: string }>("POST", `/datahubs/${fx.datahubId}/tables`, { name: "Nhiều dòng" });
  const col = await ownerApi.call<{ key: string }>("POST", `/tables/${big.id}/columns`, { name: "Tên", type: "text" });
  await ownerApi.call("POST", `/tables/${big.id}/columns`, { name: "Tiền", type: "currency" });
  void col;
  await seedMany(ownerApi, big.id, 10_000, (i) => ({ Tên: `Dòng thử ${i + 1}`, Tiền: (i + 1) * 1000 }));
  const pg = owner.page;
  await pg.goto(`/datahub/${fx.datahubId}/${big.id}`);
  await expect(pg.getByText(/10\.000 dòng|Đã tải .* \/ 10\.000 dòng/)).toBeVisible();
  const g = new GridDriver(pg);
  await g.click(0, 2);
  await pg.keyboard.press("ControlOrMeta+ArrowDown");
  await expect.poll(async () => pg.getByText("10.000 dòng", { exact: true }).count(), { timeout: 90_000 }).toBe(1);
  await expect.poll(async () => g.read(0, 0).catch(() => ""), { timeout: 20_000 }).toMatch(/^Dòng thử \d+$/);
  await owner.shot("40-10k");
});

test("dữ liệu xấu nhất: tên dài đúng giới hạn, ký tự đặc biệt, tên người rất dài, số lớn và âm", async () => {
  const pg = viewer.page;
  await pg.goto("/datahub");
  await pg.getByRole("tab", { name: /Được chia sẻ với tôi/ }).click();
  const card = pg.getByRole("link", { name: `Mở datahub ${worst.name}` });
  await expect(card).toBeVisible();
  await expect(pg.getByText("Chủ: Nguyễn Trần Bảo Khánh Linh Phương")).toBeVisible();
  await viewer.expectNoHorizontalOverflow();
  await viewer.shot("60-worst-list");
  await pg.goto(`/datahub/${worst.datahubId}/${worst.tableId}`);
  await expect(pg.getByRole("heading", { level: 1 })).toHaveText(worst.name);
  await expect(pg.getByText(/^3 dòng$/)).toBeVisible();
  await viewer.expectNoHorizontalOverflow();
  const g = new GridDriver(pg);
  if (!phone()) {
    expect(await g.read(1, 0)).toBe("12.345.678.900 ₫");
    expect(await g.read(1, 1)).toBe("-987.654.321 ₫");
    expect(await g.read(0, 2)).toBe("<b>Đậm</b> &amp; nghiêng");
    expect(await g.read(3, 0)).toBe("Nguyễn Trần Bảo Khánh Linh Phương");
  }
  await viewer.shot("61-worst-table");
  // The row panel shows the whole long values and wraps them.
  await g.openMarker(0); // a click on the row number cell, outside its tick box, opens the row panel
  const d = pg.getByRole("dialog", { name: /^Dòng #1$/ });
  await expect(d.getByLabel("Ghi chú")).toBeVisible();
  await expect(d.getByLabel("Tổng giá trị hợp đồng")).toContainText("12.345.678.900 ₫");
  await viewer.shot("62-worst-panel");
  await pg.keyboard.press("Escape");
});

test("bố cục: không tràn ngang cả trang, bảng cuộn trong khung (1280 và 375)", async () => {
  await openLead(owner);
  await owner.expectNoHorizontalOverflow();
  await owner.page.goto("/datahub");
  await owner.expectNoHorizontalOverflow();
  await owner.page.goto(leadUrl());
  await expect(owner.page.getByTestId("grid")).toBeVisible();
  await expect(owner.page.locator(".dvn-scroller")).toBeVisible();
  const inner = await owner.page.evaluate(() => {
    const s = document.querySelector(".dvn-scroller") as HTMLElement;
    return { sw: s.scrollWidth, cw: s.clientWidth };
  });
  expect(inner.sw).toBeGreaterThan(inner.cw);
  await owner.shot("50-layout");
});
