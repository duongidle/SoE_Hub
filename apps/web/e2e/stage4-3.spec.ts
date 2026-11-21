import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { GridDriver } from "./grid";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 4.3: the screens of Quản lý Deal. The menu by role, the Template page (create a table, add a column with the preview
 * "Áp dụng cho N người", a Leader who only views), cells locked by `can_edit`, a Người dùng cell with attributes (and the 100% limit),
 * the layer tags on template columns. The deals are made up here; no real data. Desktop only (quick test of this step).
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-43-${p}-5521`;
const email = (who: string) => `${p}.s43${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");

let admin: ApiClient;
let mgrApi: ApiClient;
let leadApi: ApiClient;
let u1Api: ApiClient;
let ids: Record<string, string> = {};
let sessions: Session[] = [];
let mgrS: Session;
let leadS: Session;
let u1S: Session;
let adminS: Session;
let dealsTemplateId = "";
let dealsTableId = "";
let dealId = "";

const dialog = (page: Page, name?: string | RegExp): Locator => page.getByRole("dialog", name ? { name } : undefined).last();
const toast = (page: Page, text: string | RegExp) => expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
const uid = (who: string) => ids[email(who)]!;

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, what: string): Promise<T> {
  let last = "";
  for (let i = 0; i < 60; i++) {
    const v = await fn().catch((e: Error) => ((last = e.message), null));
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Hết giờ chờ: ${what}. ${last}`);
}

/** Opens the row panel of the first row of the open table (click a cell, Shift+Space). */
async function openFirstRow(page: Page): Promise<void> {
  await expect(page.getByTestId("grid")).toBeVisible();
  const g = new GridDriver(page);
  await expect.poll(async () => Number(await g.root.getAttribute("data-lines"))).toBeGreaterThan(0);
  await g.click(1, 0);
  await page.keyboard.press("Shift+Space");
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "4.3 chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  admin = await createAdmin(API, email("admin"), `Admin 43 ${p}`, PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 43 ${p}`, roles: ["manager"] },
      { email: email("lead"), name: `Leader 43 ${p}`, roles: ["leader"], manager: email("mgr") },
      { email: email("u1"), name: `Thành viên Một 43 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
      { email: email("u2"), name: `Thành viên Hai 43 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
    ],
    PASSWORD(),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  leadApi = await new ApiClient(API).login(email("lead"), PASSWORD());
  u1Api = await new ApiClient(API).login(email("u1"), PASSWORD());

  // The default set is built by the worker after the Manager joins the org chart.
  const deals = await waitFor(async () => (await mgrApi.call<{ id: string; name: string; master_table_id: string }[]>("GET", "/datahub/templates")).find((t) => t.name === "Deals"), "bộ template mặc định của cây");
  dealsTemplateId = deals.id;
  dealsTableId = deals.master_table_id;
  await waitFor(async () => (await u1Api.call<{ tables: { name: string }[] }>("GET", "/datahub/deal-home")).tables.some((t) => t.name === "Deals"), "bảng Deals tới thành viên");
  // One deal of u1 (Leading), made up for the test.
  const row = await mgrApi.call<{ id: string }>("POST", `/tables/${dealsTableId}/rows`, {
    data: { "Tên công ty": "Công ty thử 43", "Loại deal": "POD bán mới", "Start date": "2026-11-02", "Người tham gia": [{ id: uid("u1"), attrs: { vai_tro: "Leading" } }] },
  });
  dealId = row.id;

  mgrS = await Session.open(browser, p, "mgr").then((x) => x.allow(400, /\/api\/v1\//));
  leadS = await Session.open(browser, p, "lead");
  u1S = await Session.open(browser, p, "u1");
  adminS = await Session.open(browser, p, "admin");
  sessions = [mgrS, leadS, u1S, adminS];
  for (const [s, who] of [[mgrS, "mgr"], [leadS, "lead"], [u1S, "u1"], [adminS, "admin"]] as const) {
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

test("menu theo vai trò: User, Leader, Manager có Quản lý Deal; Admin không (có Template Quản lý Deal); Datahub không lộ datahub Quản lý Deal", async () => {
  for (const s of [u1S, leadS, mgrS]) {
    await s.page.goto("/");
    expect(await s.hasMenu("Quản lý Deal"), s.name).toBe(true);
  }
  await adminS.page.goto("/");
  expect(await adminS.hasMenu("Quản lý Deal")).toBe(false);
  expect(await adminS.hasMenu("Template Quản lý Deal")).toBe(true);
  expect(await u1S.hasMenu("Template Quản lý Deal")).toBe(false);

  const pg = u1S.page;
  await pg.goto("/datahub");
  await expect(pg.getByRole("heading", { name: /Datahub/ }).first()).toBeVisible();
  await expect(pg.getByText("Quản lý Deal")).toHaveCount(1); // only the menu link
  // The menu opens the table list: Deals and Index come first.
  await u1S.clickMenu("Quản lý Deal");
  await expect(pg.getByRole("tab", { name: "Deals" })).toBeVisible();
  await expect(pg.getByRole("tab", { name: "Index" })).toBeVisible();
  await expect(pg.getByRole("link", { name: /Template/ })).toHaveCount(0);
  // An API caller gets the same list: the datahub is not in the Datahub list.
  const list = await u1Api.call<{ name: string }[]>("GET", "/datahubs?scope=all");
  expect(list.some((d) => d.name === "Quản lý Deal")).toBe(false);
  // The manager sees the Template button.
  await mgrS.clickMenu("Quản lý Deal");
  await expect(mgrS.page.getByTestId("open-template-page")).toBeVisible();
});

test("Template: Manager tạo bảng, thêm cột, xem trước \"Áp dụng cho N người\" rồi xác nhận; thành viên thấy cột với nhãn Mẫu", async () => {
  const pg = mgrS.page;
  await pg.goto("/quan-ly-deal");
  await pg.getByTestId("open-template-page").click();
  await expect(pg.getByTestId("template-list")).toBeVisible();
  await expect(pg.getByTestId("template-item").filter({ hasText: "Deals" }).first()).toBeVisible();
  await expect(pg.getByTestId("template-item").filter({ hasText: "Probation KPI" })).toBeVisible();

  await pg.getByRole("button", { name: "Tạo bảng template" }).click();
  const d = dialog(pg, "Tạo bảng template");
  await d.getByLabel("Tên bảng *").fill("Việc của team 4.3");
  await d.getByLabel("Quyền mặc định").selectOption("edit_data");
  await d.getByRole("button", { name: "Tạo bảng" }).click();
  const panel = pg.getByTestId("template-panel");
  await expect(panel.getByRole("heading", { name: "Việc của team 4.3" })).toBeVisible();
  const tpl = (await mgrApi.call<{ id: string; name: string; members: number; master_table_id: string }[]>("GET", "/datahub/templates")).find((t) => t.name === "Việc của team 4.3")!;
  await expect(panel.getByText(`Áp dụng cho ${tpl.members} người`)).toBeVisible();

  // Add a column: layer step with the preview, then the editor, then the confirmation with the same number.
  await panel.getByRole("button", { name: "Thêm cột" }).first().click();
  const step = dialog(pg, "Thêm cột vào template");
  const impact = await mgrApi.call<{ count: number }>("GET", `/datahub/templates/${tpl.id}/impact?layer=basic`);
  await expect(step.getByTestId("template-impact")).toHaveText(`Cột này sẽ hiện cho ${impact.count} người.`);
  await step.getByRole("button", { name: "Tiếp tục" }).click();
  const ed = dialog(pg, "Thêm cột");
  await ed.getByLabel(/Tên cột/).fill("Ghi chú team");
  await ed.getByRole("button", { name: "Thêm cột" }).click();
  await expect(dialog(pg, "Áp dụng thay đổi template?").getByTestId("template-confirm")).toContainText(`Áp dụng cho ${impact.count} người`);
  await dialog(pg, "Áp dụng thay đổi template?").getByRole("button", { name: "Xác nhận" }).click();
  await expect(panel.getByTestId("template-column").filter({ hasText: "Ghi chú team" })).toBeVisible();

  // A member sees the new column in their own copy (the table is shared with the tree), tagged `Mẫu`.
  const mine = await u1Api.call<{ my_table_id: string | null }[]>("GET", "/datahub/templates");
  expect(mine.some((t) => t.my_table_id === tpl.master_table_id)).toBe(true);
  await mgrApi.call("POST", `/tables/${tpl.master_table_id}/rows`, { data: { "Ghi chú team": "dòng thử" } });
  await u1S.page.goto(`/quan-ly-deal/${tpl.master_table_id}`);
  await expect(u1S.page.getByTestId("grid")).toBeVisible();
  const tags = JSON.parse((await u1S.page.getByTestId("grid").getAttribute("data-layer-tags")) ?? "{}") as Record<string, string>;
  expect(tags["Ghi chú team"]).toBe("Mẫu");
});

test("Template: Leader thấy bảng của Manager ở chế độ chỉ xem kèm lý do, không có nút sửa", async () => {
  const pg = leadS.page;
  await pg.goto(`/quan-ly-deal/template?template=${dealsTemplateId}`);
  const panel = pg.getByTestId("template-panel");
  await expect(panel.getByRole("heading", { name: "Deals" })).toBeVisible();
  await expect(panel.getByTestId("template-readonly-reason")).toContainText("do Manager tạo");
  await expect(panel.getByTestId("template-column").first()).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Sửa cột/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Thêm cột" })).toHaveCount(0);
  await expect(panel.getByTestId("template-settings")).toHaveCount(0);
  // The same page for someone who may not open it: a plain User.
  await u1S.page.goto("/quan-ly-deal/template");
  await expect(u1S.page.getByText("Không có quyền").first()).toBeVisible();
  // Server: a Leader's try on a basic column is refused.
  await expect(leadApi.call("POST", `/datahub/templates/${dealsTemplateId}/columns`, { name: "Lén", type: "text", layer: "basic" })).rejects.toThrow(/403/);
});

test("ô khoá theo can_edit: Leader xem deal của team nhưng không sửa; User bật \"Cho phép leader sửa\" thì sửa được", async () => {
  const lead = leadS.page;
  await lead.goto(`/quan-ly-deal/${dealsTableId}`);
  await openFirstRow(lead);
  const name = lead.getByRole("textbox", { name: "Tên công ty" });
  await expect(name).toHaveAttribute("aria-readonly", "true");
  await expect(lead.getByText(/xem được dòng này nhưng không sửa được/).first()).toBeVisible();
  const row = (await leadApi.raw<{ data: { id: string; can_edit?: boolean }[] }>(`/tables/${dealsTableId}/rows?limit=10`)).data.find((r) => r.id === dealId)!;
  expect(row.can_edit).toBe(false);

  // The deal's person switches it on in the page of Deals.
  const u1 = u1S.page;
  await u1.goto(`/quan-ly-deal/${dealsTableId}`);
  const toggle = u1.getByTestId("leader-can-edit");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await toast(u1, /sửa được deal của bạn/);
  await expect.poll(async () => (await leadApi.raw<{ data: { id: string; can_edit?: boolean }[] }>(`/tables/${dealsTableId}/rows?limit=10`)).data.find((r) => r.id === dealId)?.can_edit).toBe(true);
  await lead.reload();
  await openFirstRow(lead);
  await expect(lead.getByRole("textbox", { name: "Tên công ty" })).not.toHaveAttribute("aria-readonly", "true");
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await toast(u1, /chỉ xem deal của bạn/);
});

test("cột tự điền chỉ đọc kèm lý do; cột riêng có nhãn Riêng, cột template có nhãn Mẫu", async () => {
  const pg = u1S.page;
  await u1Api.call("POST", `/tables/${dealsTableId}/columns`, { name: "Việc riêng của tôi", type: "text" });
  await pg.goto(`/quan-ly-deal/${dealsTableId}`);
  await expect(pg.getByTestId("grid")).toBeVisible();
  const tags = JSON.parse((await pg.getByTestId("grid").getAttribute("data-layer-tags")) ?? "{}") as Record<string, string>;
  expect(tags["Tên công ty"]).toBe("Mẫu");
  expect(tags["Việc riêng của tôi"]).toBe("Riêng");
  await openFirstRow(pg);
  await expect(pg.getByRole("textbox", { name: "Vai trò của tôi" })).toHaveAttribute("aria-readonly", "true");
  await expect(pg.getByText(/hệ thống điền từ cột Người tham gia/).first()).toBeVisible();
  // The `Status` option that means "won" is read by meaning: the column role is held by one column of the table.
  const detail = await mgrApi.call<{ roles: { key: string; column: string | null }[] }>("GET", `/datahub/templates/${dealsTemplateId}`);
  expect(detail.roles.find((r) => r.key === "trang_thai")?.column).toBeTruthy();
});

test("ô Người dùng có thuộc tính: Manager sửa vai trò và %, tổng vượt 100% bị chặn với câu dễ hiểu", async () => {
  const pg = mgrS.page;
  await pg.goto(`/quan-ly-deal/${dealsTableId}`);
  await openFirstRow(pg);
  await expect(pg.getByTestId("people-text-" + (await peopleKey()))).toContainText("Leading");
  await pg.getByRole("button", { name: "Sửa người" }).click();
  const ed = pg.getByTestId("people-attrs");
  await expect(ed.getByTestId("people-entry")).toHaveCount(1);
  await ed.getByLabel(/^% doanh thu của/).fill("60%");
  await ed.getByRole("button", { name: "Thêm người" }).click();
  await ed.getByLabel("Tìm người").fill("Thành viên Hai");
  await ed.getByRole("option", { name: /Thành viên Hai/ }).click();
  await expect(ed.getByTestId("people-entry")).toHaveCount(2);
  await ed.getByLabel(/^% doanh thu của Thành viên Hai/).fill("70%");
  await ed.getByRole("button", { name: "Lưu" }).click();
  await expect(ed.getByRole("alert")).toContainText(/vượt/);
  // 60% + 30% is fine.
  await ed.getByLabel(/^% doanh thu của Thành viên Hai/).fill("30%");
  await ed.getByRole("button", { name: "Lưu" }).click();
  await expect(ed.getByRole("alert")).toHaveCount(0, { timeout: 3000 }).catch(async () => { throw new Error(`Lỗi còn lại: ${await ed.getByRole("alert").innerText()}`); });
  await expect(pg.getByTestId("people-attrs")).toHaveCount(0);
  await expect(pg.getByTestId("people-text-" + (await peopleKey()))).toContainText("Thành viên Hai");
  // The people sent down to the second person: they see the deal now.
  const u2Api = await new ApiClient(API).login(email("u2"), PASSWORD());
  await expect.poll(async () => (await u2Api.raw<{ data: unknown[] }>(`/tables/${dealsTableId}/rows?limit=10`)).data.length).toBe(1);
});

test("Template: Manager tạo bảng cho một team; Leader thấy bảng ở nhóm team, thành viên của team nhận", async () => {
  const pg = mgrS.page;
  await pg.goto("/quan-ly-deal/template");
  await expect(pg.getByTestId("template-list")).toBeVisible();
  await pg.getByRole("button", { name: "Tạo bảng template" }).click();
  const d = dialog(pg, "Tạo bảng template");
  await d.getByLabel("Tên bảng *").fill("Việc riêng của team");
  await d.getByLabel("Phạm vi").selectOption("team");
  // A team table needs a Leader: the form says so before anything is sent.
  await d.getByRole("button", { name: "Tạo bảng" }).click();
  await expect(d.getByText("Chọn Leader của team.")).toBeVisible();
  await d.getByLabel("Leader của team").selectOption({ label: `Leader 43 ${p}` });
  await d.getByRole("button", { name: "Tạo bảng" }).click();
  await expect(pg.getByTestId("template-panel").getByRole("heading", { name: "Việc riêng của team" })).toBeVisible();
  // The list groups it under the team of that Leader.
  await expect(pg.getByTestId("template-list").getByRole("heading", { name: `Team Leader 43 ${p}` })).toBeVisible();
  const mine = await mgrApi.call<{ name: string; scope: string; leader_id: string | null }[]>("GET", "/datahub/templates");
  const made = mine.find((t) => t.name === "Việc riêng của team")!;
  expect(made.scope).toBe("team");
  expect(made.leader_id).toBe(uid("lead"));
  await expect.poll(async () => (await leadApi.call<{ name: string }[]>("GET", "/datahub/templates")).some((t) => t.name === "Việc riêng của team")).toBe(true);
  // A table of another tree's team is not offered: only Leaders of this tree are in the list.
  await pg.getByRole("button", { name: "Tạo bảng template" }).click();
  await dialog(pg, "Tạo bảng template").getByLabel("Phạm vi").selectOption("team");
  await expect(dialog(pg, "Tạo bảng template").getByLabel("Leader của team").locator("option")).toHaveCount(2);
  await pg.keyboard.press("Escape");
});

test("Template: cột Người dùng có thuộc tính (vai trò, %, tổng tối đa) và cột gửi xuống tự điền từ thuộc tính", async () => {
  const pg = mgrS.page;
  const tpl = (await mgrApi.call<{ id: string; name: string; master_table_id: string }[]>("GET", "/datahub/templates")).find((t) => t.name === "Việc riêng của team")!;
  await pg.goto(`/quan-ly-deal/template?template=${tpl.id}`);
  const panel = pg.getByTestId("template-panel");
  await expect(panel.getByRole("heading", { name: "Việc riêng của team" })).toBeVisible();

  // 1) A Người dùng column with two attributes.
  await panel.getByRole("button", { name: "Thêm cột" }).first().click();
  await dialog(pg, "Thêm cột vào template").getByRole("button", { name: "Tiếp tục" }).click();
  let ed = dialog(pg, "Thêm cột");
  await ed.getByLabel(/Tên cột/).fill("Người làm");
  await ed.getByLabel("Kiểu cột").selectOption({ label: "Người dùng" });
  const attrs = ed.getByTestId("attrs-editor");
  await attrs.getByRole("button", { name: "Thêm thuộc tính" }).click();
  await attrs.getByLabel("Tên thuộc tính 1").fill("Vai trò");
  await expect(attrs.getByLabel("Mã thuộc tính 1")).toHaveValue("vai_tro");
  await attrs.getByLabel("Các nhãn thuộc tính 1").fill("Chính, Phụ");
  await attrs.getByRole("button", { name: "Thêm thuộc tính" }).click();
  await attrs.getByLabel("Tên thuộc tính 2").fill("Tỉ lệ");
  await attrs.getByLabel("Kiểu thuộc tính 2").selectOption("percent");
  await attrs.getByLabel("Tổng tối đa thuộc tính 2").fill("100");
  // A select attribute without labels is refused in the form, in words.
  await attrs.getByLabel("Các nhãn thuộc tính 1").fill("");
  await ed.getByRole("button", { name: "Thêm cột" }).click();
  await expect(attrs.getByRole("alert")).toContainText("cần ít nhất một nhãn");
  await attrs.getByLabel("Các nhãn thuộc tính 1").fill("Chính, Phụ");
  await ed.getByRole("button", { name: "Thêm cột" }).click();
  await dialog(pg, "Áp dụng thay đổi template?").getByRole("button", { name: "Xác nhận" }).click();
  await expect(panel.getByTestId("template-column").filter({ hasText: "Người làm" })).toBeVisible();
  const cols = (await mgrApi.call<{ columns: { name: string; key: string; config: { attrs?: { key: string; kind: string; options?: string[]; sum_max?: number }[] } }[] }>("GET", `/datahub/templates/${tpl.id}`)).columns;
  const who = cols.find((c) => c.name === "Người làm")!;
  expect(who.config.attrs).toEqual([
    { key: "vai_tro", label: "Vai trò", kind: "select", options: ["Chính", "Phụ"] },
    { key: "ti_le", label: "Tỉ lệ", kind: "percent", sum_max: 1 },
  ]);

  // 2) A column "gửi xuống": one value per person, filled by the system from the % attribute.
  await panel.getByRole("button", { name: "Thêm cột" }).first().click();
  const step = dialog(pg, "Thêm cột vào template");
  await step.getByLabel("Cách lưu giá trị").selectOption("person");
  await step.getByLabel("Cột người tham gia").selectOption({ label: "Người làm" });
  await step.getByLabel("Thuộc tính gửi xuống").selectOption({ label: "Tỉ lệ" });
  await step.getByRole("button", { name: "Tiếp tục" }).click();
  ed = dialog(pg, "Thêm cột");
  await ed.getByLabel(/Tên cột/).fill("Phần của tôi");
  await ed.getByLabel("Kiểu cột").selectOption({ label: "Phần trăm" });
  await ed.getByRole("button", { name: "Thêm cột" }).click();
  await dialog(pg, "Áp dụng thay đổi template?").getByRole("button", { name: "Xác nhận" }).click();
  await expect(panel.getByTestId("template-column").filter({ hasText: "Phần của tôi" }).getByText("Hệ thống tự điền, không ai sửa ô")).toBeVisible();
  const after = (await mgrApi.call<{ columns: { name: string; autofill: { column: string; attr: string } | null }[] }>("GET", `/datahub/templates/${tpl.id}`)).columns;
  expect(after.find((c) => c.name === "Phần của tôi")!.autofill).toEqual({ column: who.key, attr: "ti_le" });

  // A column that cannot take the attribute is refused by the server in words (a text column cannot hold a %).
  await panel.getByRole("button", { name: "Thêm cột" }).first().click();
  const step2 = dialog(pg, "Thêm cột vào template");
  await step2.getByLabel("Cách lưu giá trị").selectOption("person");
  await step2.getByLabel("Cột người tham gia").selectOption({ label: "Người làm" });
  await step2.getByLabel("Thuộc tính gửi xuống").selectOption({ label: "Tỉ lệ" });
  await step2.getByRole("button", { name: "Tiếp tục" }).click();
  ed = dialog(pg, "Thêm cột");
  await ed.getByLabel(/Tên cột/).fill("Sai kiểu");
  await ed.getByRole("button", { name: "Thêm cột" }).click();
  await dialog(pg, "Áp dụng thay đổi template?").getByRole("button", { name: "Xác nhận" }).click();
  await expect(ed.getByRole("alert").filter({ hasText: "không điền được" })).toBeVisible();
});

test("Admin: Cài đặt → Template Quản lý Deal liệt kê bộ mặc định; JSON sai bị chặn trước khi gửi", async () => {
  const pg = adminS.page;
  await pg.goto("/quan-tri/cai-dat");
  await pg.getByRole("link", { name: "Template Quản lý Deal" }).first().click();
  await expect(pg.getByTestId("deal-defaults")).toBeVisible();
  await expect(pg.getByRole("list", { name: "Các bảng của bộ mặc định" }).getByText(/^Deals/)).toBeVisible();
  const box = pg.getByLabel("Nội dung (JSON)");
  await box.fill("[ {");
  await pg.getByRole("button", { name: "Lưu bộ mặc định" }).click();
  await expect(pg.getByText("Nội dung không phải JSON hợp lệ")).toBeVisible();
});

/** The code of the "Người tham gia" column, for the test id of its text in the row panel. */
async function peopleKey(): Promise<string> {
  const t = await mgrApi.call<{ columns: { key: string; name: string }[] }>("GET", `/tables/${dealsTableId}`);
  return t.columns.find((c) => c.name === "Người tham gia")!.key;
}
