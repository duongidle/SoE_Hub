import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedMany } from "./dh-fixtures";
import { GridDriver } from "./grid";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 2C-3: column management (add, edit, delete with undo, change type with a warning first), the formula editor (suggestions, syntax,
 * errors, preview, samples, reference picker), Liên kết / Lookup / Rollup columns with the row picker, attachments, and what a person the
 * datahub is shared with can and cannot do. Desktop only (quick test of this step); the phone runs in the final stage test.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-cot-${p}-5521`;
const email = (who: string) => `${p}.cl${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");

let owner: Session;
let viewer: Session;
let editor: Session;
let ownerApi: ApiClient;
let editorApi: ApiClient;
let dhId: string;
let dealsId: string;
const custRows: string[] = [];
const dealRows: string[] = [];
let sessions: Session[] = [];

interface Col { id: string; key: string; name: string; type: string; config: Record<string, unknown> }
const columns = async (api: ApiClient, tableId = dealsId): Promise<Col[]> => ((await api.call("GET", `/tables/${tableId}`)) as { columns: Col[] }).columns;
const colByName = async (name: string, api = ownerApi, tableId = dealsId) => (await columns(api, tableId)).find((c) => c.name === name);

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "2C-3 chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  const admin = await createAdmin(API, email("admin"), `Admin Cột ${p}`, PASSWORD(), ROOT);
  const ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager Cột ${p}`, roles: ["manager"] },
      { email: email("owner"), name: `Chủ Cột ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("viewer"), name: `Người Xem Cột ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("editor"), name: `Người Sửa Cột ${p}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  editorApi = await new ApiClient(API).login(email("editor"), PASSWORD());
  const dh = await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: `Cột ${p}` });
  dhId = dh.id;
  const deals = await ownerApi.call<{ id: string }>("POST", `/datahubs/${dh.id}/tables`, { name: "Deals" });
  dealsId = deals.id;
  const cust = await ownerApi.call<{ id: string }>("POST", `/datahubs/${dh.id}/tables`, { name: "Khách hàng" });
  await ownerApi.call("POST", `/tables/${deals.id}/columns`, { name: "Tên", type: "text" });
  await ownerApi.call("POST", `/tables/${deals.id}/columns`, { name: "Doanh thu", type: "currency" });
  await ownerApi.call("POST", `/tables/${deals.id}/columns`, { name: "Ghi chú", type: "text" });
  await ownerApi.call("POST", `/tables/${cust.id}/columns`, { name: "Tên khách", type: "text" });
  const names = ["Công ty Thuận Phát", "Đặng Thị Ngọc Hân", "An Phát"];
  for (const n of names) custRows.push((await ownerApi.call<{ id: string }>("POST", `/tables/${cust.id}/rows`, { data: { "Tên khách": n } })).id);
  // Many rows in the table the link points at: the picker must stay fast and draw only what is on screen.
  await seedMany(ownerApi, cust.id, 1200, (i) => ({ "Tên khách": `Khách số ${i + 1}` }));
  const notes = ["12", "abc", "7"];
  for (const [i, n] of notes.entries()) dealRows.push((await ownerApi.call<{ id: string }>("POST", `/tables/${deals.id}/rows`, { data: { Tên: `Deal ${i + 1}`, "Doanh thu": (i + 1) * 1_000_000, "Ghi chú": n } })).id);
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

const url = () => `/datahub/${dhId}/${dealsId}`;
async function open(s: Session): Promise<GridDriver> {
  await s.page.goto(url());
  await expect(s.page.getByRole("heading", { level: 1, name: `Cột ${p}` })).toBeVisible();
  const g = new GridDriver(s.page);
  await expect(g.root).toBeVisible();
  return g;
}
const dialog = (page: Page, name?: string | RegExp): Locator => page.getByRole("dialog", name ? { name } : undefined).last();
const nameBox = (d: Locator) => d.getByRole("textbox", { name: /^Tên cột/ });
async function openAdd(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Thêm cột", exact: true }).click();
  const d = dialog(page, "Thêm cột");
  await expect(d).toBeVisible();
  return d;
}
async function openManager(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Cột của bảng" }).click();
  const d = dialog(page, "Cột của bảng");
  await expect(d).toBeVisible();
  return d;
}
async function openEdit(page: Page, name: string): Promise<Locator> {
  const m = await openManager(page);
  await m.getByRole("button", { name: `Sửa cột ${name}` }).click();
  const d = dialog(page, `Sửa cột "${name}"`);
  await expect(d).toBeVisible();
  return d;
}
/** A toast of the step before can still be on screen, so a new column is waited for on the server, not by its toast. */
const created = (name: string) => expect.poll(async () => !!(await colByName(name)), { message: `Cột "${name}" chưa được tạo` }).toBe(true);
const waitToast = (page: Page, text: string | RegExp) => expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();

test("thêm cột: lỗi tên hiện dưới ô, sửa rồi lưu; mô tả và thuộc tính", async () => {
  const pg = owner.page;
  await open(owner);
  const d = await openAdd(pg);
  // Empty name: the message is under the field and focus goes to it.
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await expect(d.getByText("Tên không được để trống.")).toBeVisible();
  await expect(nameBox(d)).toBeFocused();
  await nameBox(d).fill("Giá [VND]");
  await nameBox(d).blur();
  await expect(d.getByText("Tên không được chứa dấu [ hoặc ].")).toBeVisible();
  await nameBox(d).fill("  doanh THU ");
  await nameBox(d).blur();
  await expect(d.getByText("Bảng này đã có một cột tên này. Hãy đặt tên khác.")).toBeVisible();
  await owner.shot("column-add-name-error");

  await nameBox(d).fill("Nguồn lead");
  await d.getByLabel("Kiểu cột").selectOption({ label: "Văn bản" });
  await d.getByLabel("Độ dài tối đa").fill("0");
  await d.getByLabel("Độ dài tối đa").blur();
  await expect(d.getByText("Độ dài tối đa là số nguyên từ 1 đến 100000.")).toBeVisible();
  await d.getByLabel("Độ dài tối đa").fill("50");
  await d.getByLabel("Mô tả").fill("Kênh khách biết tới mình");
  await d.getByLabel("Bắt buộc có giá trị").check();
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await waitToast(pg, "Đã thêm cột");
  await expect(d).toBeHidden();
  const c = await colByName("Nguồn lead");
  expect(c).toMatchObject({ type: "text", config: { max_length: 50 } });
  const full = (await ownerApi.call("GET", `/tables/${dealsId}`)) as { columns: { name: string; required: boolean; description: string | null }[] };
  expect(full.columns.find((x) => x.name === "Nguồn lead")).toMatchObject({ required: true, description: "Kênh khách biết tới mình" });
  // The same name typed again: the server says so under the field (not as a toast).
  const d2 = await openAdd(pg);
  await nameBox(d2).fill("nguồn lead");
  await d2.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await expect(d2.getByText("Bảng này đã có một cột tên này. Hãy đặt tên khác.")).toBeVisible();
  await d2.getByRole("button", { name: "Huỷ" }).click();
  await expect(d2).toBeHidden();
});

test("cột Một lựa chọn: lựa chọn, màu, thứ tự; sửa; đổi kiểu báo trước; xoá có Hoàn tác", async () => {
  const pg = owner.page;
  await open(owner);
  let d = await openAdd(pg);
  await nameBox(d).fill("Giai đoạn");
  await d.getByLabel("Kiểu cột").selectOption({ label: "Một lựa chọn" });
  await d.getByRole("button", { name: "Thêm lựa chọn" }).click();
  await d.getByRole("textbox", { name: "Tên lựa chọn 1" }).fill("Mới");
  await d.getByRole("button", { name: "Thêm lựa chọn" }).click();
  await d.getByRole("textbox", { name: "Tên lựa chọn 2" }).fill(" mới ");
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await expect(d.getByText('Tên lựa chọn bị trùng: "mới".')).toBeVisible();
  await d.getByRole("textbox", { name: "Tên lựa chọn 2" }).fill("Chốt");
  await d.getByLabel("Màu của lựa chọn 2").selectOption({ label: "Xanh lá" });
  await d.getByRole("button", { name: "Chuyển lựa chọn 2 lên" }).click();
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await waitToast(pg, "Đã thêm cột");
  // A toast of the step before may still be on screen, so the server is polled instead of read once.
  const optionsOf = async () => ((await colByName("Giai đoạn"))?.config.options as { name: string; color: string }[] | undefined)?.map((o) => [o.name, o.color]);
  await expect.poll(optionsOf).toEqual([["Chốt", "green"], ["Mới", "gray"]]);

  // Rename an option: its id stays, so a value already in a row stays.
  d = await openEdit(pg, "Giai đoạn");
  await d.getByRole("textbox", { name: "Tên lựa chọn 2" }).fill("Mới tạo");
  await d.getByRole("button", { name: "Lưu cột" }).click();
  await waitToast(pg, "Đã lưu cột");
  await expect.poll(async () => ((await colByName("Giai đoạn"))?.config.options as { name: string }[] | undefined)?.map((o) => o.name)).toEqual(["Chốt", "Mới tạo"]);

  // Change the type of "Ghi chú" (text: "12", "abc", "7") to a number: the dialog says what is lost; "Giữ lại" changes nothing.
  d = await openEdit(pg, "Ghi chú");
  await d.getByLabel("Kiểu cột").selectOption({ label: "Số" });
  await d.getByRole("button", { name: "Lưu cột" }).click();
  const warn = dialog(pg, /Đổi cột "Ghi chú" từ Văn bản sang Số\?/);
  await expect(warn).toBeVisible();
  await expect(warn.getByText(/2 ô đổi sang dạng của kiểu/)).toBeVisible();
  await expect(warn.getByText(/1 ô không chuyển được nên sẽ bị xoá trắng/)).toBeVisible();
  await expect(warn.getByText('Dòng #2: "abc"')).toBeVisible();
  await owner.shot("column-type-change-warning");
  await warn.getByRole("button", { name: "Giữ lại" }).click();
  expect((await colByName("Ghi chú"))!.type).toBe("text");
  await dialog(pg, /Sửa cột/).getByRole("button", { name: "Lưu cột" }).click();
  await warn.getByRole("button", { name: "Đổi kiểu và xoá 1 ô" }).click();
  await waitToast(pg, "Đã đổi kiểu cột");
  expect((await colByName("Ghi chú"))!.type).toBe("number");
  const noteKey = (await colByName("Ghi chú"))!.key;
  const rows = (await ownerApi.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${dealsId}/rows?limit=10`)).data;
  expect(rows.map((r) => r.data[noteKey] ?? null)).toEqual([12, null, 7]);

  // Delete with "Hoàn tác": the column and its values come back.
  const m = await openManager(pg);
  await m.getByRole("button", { name: "Xoá cột Giai đoạn" }).click();
  await waitToast(pg, 'Đã xoá cột "Giai đoạn"');
  expect(await colByName("Giai đoạn")).toBeUndefined();
  await pg.locator("[data-sonner-toast]").filter({ hasText: 'Đã xoá cột "Giai đoạn"' }).getByRole("button", { name: "Hoàn tác" }).click();
  await waitToast(pg, 'Đã khôi phục cột "Giai đoạn"');
  expect(await colByName("Giai đoạn")).toBeTruthy();
});

test("công thức: gợi ý, cú pháp, lỗi báo ngay rồi sửa, xem trước, công thức mẫu, chèn tham chiếu", async () => {
  const pg = owner.page;
  await open(owner);
  const d = await openAdd(pg);
  await nameBox(d).fill("Gấp đôi");
  await d.getByLabel("Kiểu cột").selectOption({ label: "Công thức" });
  const box = d.getByRole("textbox", { name: "Công thức", exact: true });
  await box.click();

  // Suggestions of a function and syntax help.
  await box.pressSequentially("=SU");
  await expect(d.getByRole("option", { name: /^SUM\s/ })).toBeVisible();
  await box.fill("");
  await box.pressSequentially("=IF(");
  await expect(d.locator("#col-formula-help b").first()).toHaveText("điều_kiện");
  await box.pressSequentially("[Doanh thu] > 0, ");
  await expect(d.locator("#col-formula-help b").first()).toHaveText("nếu_đúng");

  // Suggestions of a column: typing [ lists the columns, the tables and the datahubs; Enter puts the column in.
  await box.fill("=[do");
  await expect(d.getByRole("option", { name: /^Doanh thu/ })).toBeVisible();
  await box.press("Enter");
  await expect(box).toHaveValue("=[Doanh thu]");
  await box.pressSequentially(" * [Không có]");
  // The server finds the bad name; it is underlined and said in words.
  await expect(d.getByRole("alert").filter({ hasText: /Không có cột "Không có"/ })).toBeVisible();
  await expect(d.locator("mark")).toHaveText(/Không có/);
  await owner.shot("formula-error");
  // Saving the wrong formula is refused by the server (400, expected here) and the answer is shown under the box.
  owner.allow(400, /\/columns$/);
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await expect(d.getByRole("alert").filter({ hasText: /Không có cột "Không có"/ }).first()).toBeVisible();
  expect(await colByName("Gấp đôi")).toBeUndefined();

  // Fix it: the preview shows the first rows.
  await box.fill("=[Doanh thu] * 2");
  await expect(d.getByText("Xem trước 5 dòng đầu")).toBeVisible();
  await expect(d.getByRole("cell", { name: "2.000.000", exact: true })).toBeVisible();
  await expect(d.getByRole("cell", { name: "6.000.000", exact: true })).toBeVisible();

  // Reference picker: a column of another table.
  await d.getByRole("button", { name: "Chèn cột hoặc bảng" }).click();
  const ref = pg.getByRole("dialog", { name: "Chèn cột hoặc bảng" });
  await ref.getByRole("combobox", { name: /^Bảng/ }).selectOption({ label: "Khách hàng" });
  await expect(ref.getByRole("combobox", { name: /^Cột/ })).toHaveValue("Tên khách");
  await expect(ref.getByText("[Khách hàng].[Tên khách]")).toBeVisible();
  await ref.getByRole("button", { name: "Chèn vào công thức" }).click();
  await expect(box).toHaveValue(/\[Khách hàng\]\.\[Tên khách\]/);

  // Sample library: picks columns from lists and writes a formula.
  await d.getByRole("button", { name: "Công thức mẫu" }).click();
  const lib = pg.getByRole("dialog", { name: "Công thức mẫu" });
  await lib.getByRole("button", { name: /Phân loại theo ngưỡng/ }).click();
  await expect(lib.getByLabel("Cột số")).toHaveValue("Doanh thu");
  await lib.getByRole("button", { name: "Thay công thức bằng mẫu này" }).click();
  await expect(box).toHaveValue('=IF([Doanh thu] >= 1000000000, "Trên 1 tỷ", "Dưới 1 tỷ")');
  await expect(d.getByRole("cell", { name: "Dưới 1 tỷ" }).first()).toBeVisible();
  await box.fill("=[Doanh thu] * 2");
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await waitToast(pg, "Đã thêm cột");
  const f = await colByName("Gấp đôi");
  expect(f).toMatchObject({ type: "formula", config: { formula: "=[Doanh thu] * 2" } });

  // Editing a formula shows its text again; a bad edit is refused and keeps the old one.
  const e = await openEdit(pg, "Gấp đôi");
  await expect(e.getByRole("textbox", { name: "Công thức", exact: true })).toHaveValue("=[Doanh thu] * 2");
  await e.getByRole("textbox", { name: "Công thức", exact: true }).fill("=[Gấp đôi] + 1");
  owner.allow(400, /\/columns\/[^/]+$/);
  await e.getByRole("button", { name: "Lưu cột" }).click();
  await expect(e.getByRole("alert").filter({ hasText: /vòng/i }).first()).toBeVisible();
  expect((await colByName("Gấp đôi"))!.config.formula).toBe("=[Doanh thu] * 2");
  await e.getByRole("button", { name: "Huỷ" }).click();
});

test("cột Liên kết, Lookup, Rollup: chọn bảng và cột từ danh sách; chọn dòng đích trong khung dòng và trong ô; danh sách ảo hoá", async () => {
  const pg = owner.page;
  const g = await open(owner);
  // Relation column to "Khách hàng".
  let d = await openAdd(pg);
  await nameBox(d).fill("Khách");
  await d.getByLabel("Kiểu cột").selectOption({ label: "Liên kết dòng" });
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await expect(d.getByText("Chọn bảng để liên kết tới.")).toBeVisible();
  await d.getByLabel("Liên kết tới bảng").selectOption({ label: "Khách hàng" });
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await created("Khách");
  await expect(d).toBeHidden();
  // Lookup and rollup read through it.
  d = await openAdd(pg);
  await nameBox(d).fill("Tên KH");
  await d.getByLabel("Kiểu cột").selectOption({ label: "Lookup" });
  await d.getByLabel("Cột Liên kết của bảng này").selectOption({ label: "Khách" });
  await expect(d.getByLabel(/^Cột của bảng "Khách hàng"/)).toBeEnabled();
  await d.getByLabel(/^Cột của bảng "Khách hàng"/).selectOption({ label: "Tên khách" });
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await created("Tên KH");
  await expect(d).toBeHidden();
  d = await openAdd(pg);
  await nameBox(d).fill("Số KH");
  await d.getByLabel("Kiểu cột").selectOption({ label: "Rollup" });
  await d.getByLabel("Cột Liên kết của bảng này").selectOption({ label: "Khách" });
  await d.getByLabel(/^Cột của bảng "Khách hàng"/).selectOption({ label: "Tên khách" });
  await d.getByLabel("Cách tổng hợp").selectOption({ label: "Đếm ô không trống" });
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await created("Số KH");
  await expect(d).toBeHidden();
  const cols = await columns(ownerApi);
  expect(cols.find((c) => c.name === "Tên KH")).toMatchObject({ type: "lookup", config: { relation: "Khách", target_column: "Tên khách" } });
  expect(cols.find((c) => c.name === "Số KH")).toMatchObject({ type: "rollup", config: { fn: "counta" } });

  // The row panel: pick the linked row from a searchable list.
  await expect(g.root).toBeVisible();
  await g.click(0, 0);
  await pg.getByRole("button", { name: "Chi tiết dòng" }).click();
  const panel = pg.getByRole("dialog", { name: /^Dòng #/ });
  await panel.getByRole("button", { name: "Chọn dòng" }).click();
  const list = panel.getByRole("listbox", { name: "Dòng của bảng được liên kết" });
  await expect(list.getByRole("option").first()).toBeVisible();
  // 1.203 rows in the target table, but only the ones in view are drawn.
  expect(await list.getByRole("option").count()).toBeLessThan(20);
  await panel.getByRole("textbox", { name: "Tìm dòng để liên kết" }).fill("thuan phat");
  await expect(list.getByRole("option")).toHaveCount(1);
  await list.getByRole("option", { name: "Công ty Thuận Phát" }).click();
  await panel.getByRole("button", { name: "Xong" }).click();
  const key = (await colByName("Khách"))!.key;
  await expect.poll(async () => (await ownerApi.raw<{ data: { data: Record<string, unknown> }[] }>(`/tables/${dealsId}/rows?limit=1`)).data[0]!.data[key]).toEqual([custRows[0]]);
  // The worker computes the lookup and the rollup.
  const lk = (await colByName("Tên KH"))!.key;
  await expect.poll(async () => (await ownerApi.raw<{ data: { data: Record<string, unknown> }[] }>(`/tables/${dealsId}/rows?limit=1`)).data[0]!.data[lk], { timeout: 20_000 }).toBe("Công ty Thuận Phát");
  await panel.getByRole("button", { name: "Đóng" }).first().click();

  // The cell itself: open the picker with Enter, pick two rows of a multiple link, Xong.
  const colIndex = (await columns(ownerApi)).findIndex((c) => c.key === key);
  await g.click(colIndex, 1);
  await pg.keyboard.press("Enter");
  const cellList = pg.getByRole("listbox", { name: "Dòng của bảng được liên kết" });
  await expect(cellList).toBeVisible();
  await pg.getByRole("textbox", { name: "Tìm dòng để liên kết" }).fill("Đặng");
  await cellList.getByRole("option", { name: "Đặng Thị Ngọc Hân" }).click();
  await pg.getByRole("textbox", { name: "Tìm dòng để liên kết" }).fill("An Phát");
  await cellList.getByRole("option", { name: "An Phát" }).click();
  await pg.getByRole("button", { name: "Xong" }).click();
  await expect.poll(async () => (((await ownerApi.raw<{ data: { data: Record<string, unknown> }[] }>(`/tables/${dealsId}/rows?limit=3`)).data[1]!.data[key] as string[] | undefined) ?? []).sort()).toEqual([custRows[1]!, custRows[2]!].sort());
  expect(await g.read(colIndex, 1)).toBe("Đặng Thị Ngọc Hân, An Phát");
  await owner.shot("relation-picker");
});

test("cột Đính kèm: tải file lên, tải về, loại file không nhận, gỡ file", async () => {
  const pg = owner.page;
  const g = await open(owner);
  const d = await openAdd(pg);
  await nameBox(d).fill("Hợp đồng");
  await d.getByLabel("Kiểu cột").selectOption({ label: "Đính kèm" });
  await d.getByLabel("Số file tối đa mỗi ô").fill("3");
  await d.getByRole("button", { name: "Thêm cột", exact: true }).click();
  await created("Hợp đồng");
  await expect(d).toBeHidden();
  const key = (await colByName("Hợp đồng"))!.key;

  await g.click(0, 0);
  await pg.getByRole("button", { name: "Chi tiết dòng" }).click();
  const panel = pg.getByRole("dialog", { name: /^Dòng #/ });
  const input = panel.getByTestId("attachment-input");
  // A type the system does not take: said in words, the cell stays empty.
  owner.allow(415, /\/api\/v1\/files$/);
  await input.setInputFiles({ name: "chay.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
  await expect(panel.getByRole("alert").filter({ hasText: /Chưa nhận loại file của "chay.exe"/ })).toBeVisible();
  await input.setInputFiles({ name: "hợp đồng Thuận Phát.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 thử nghiệm") });
  await expect(panel.getByText("hợp đồng Thuận Phát.pdf")).toBeVisible();
  await expect(panel.getByText(`${Buffer.byteLength("%PDF-1.4 thử nghiệm")} B`)).toBeVisible();
  const cellIds = async () => (await ownerApi.raw<{ data: { data: Record<string, unknown> }[] }>(`/tables/${dealsId}/rows?limit=1`)).data[0]!.data[key] as string[] | undefined;
  await expect.poll(async () => (await cellIds())?.length).toBe(1);
  // Download: the file that comes back is the one that went up.
  const [dl] = await Promise.all([pg.waitForEvent("download"), panel.getByRole("button", { name: "Tải về hợp đồng Thuận Phát.pdf" }).click()]);
  expect(dl.suggestedFilename()).toBe("hợp đồng Thuận Phát.pdf");
  expect((await dl.createReadStream().then((s) => new Promise<string>((res) => { let t = ""; s.on("data", (c) => (t += c)); s.on("end", () => res(t)); })))).toBe("%PDF-1.4 thử nghiệm");
  await owner.shot("attachment-panel");
  await panel.getByRole("button", { name: "Đóng" }).first().click();
  // The grid shows the count.
  const colIndex = (await columns(ownerApi)).findIndex((c) => c.key === key);
  expect(await g.read(colIndex, 0)).toBe("1 tệp");
  // Remove it from the cell.
  await g.click(0, 0);
  await pg.getByRole("button", { name: "Chi tiết dòng" }).click();
  await pg.getByRole("dialog", { name: /^Dòng #/ }).getByRole("button", { name: /^Gỡ hợp đồng Thuận Phát.pdf khỏi ô/ }).click();
  await expect.poll(async () => (await cellIds())?.length ?? 0).toBe(0);
  // Put it back for the next test (through the API: the same file id).
  const file = await ownerApi.call<{ file: { id: string }; upload: { url: string; headers: Record<string, string> } }>("POST", "/files", { filename: "baogia.pdf", content_type: "application/pdf", size_bytes: 4 });
  await fetch(file.upload.url, { method: "PUT", headers: file.upload.headers, body: "%PDF" });
  await ownerApi.call("POST", `/files/${file.file.id}/complete`, {});
  await ownerApi.call("PATCH", `/tables/${dealsId}/rows/${dealRows[0]}`, { data: { "Hợp đồng": [file.file.id] }, base: {} });
});

test("người Xem và người Sửa: không đổi được cấu trúc, không thấy công thức; Sửa được file, không sửa được liên kết", async () => {
  // Server first: every structure change is refused for both.
  await expect(editorApi.call("POST", `/tables/${dealsId}/columns`, { name: "X", type: "text" })).rejects.toThrow(/403/);
  await expect(editorApi.call("PATCH", `/tables/${dealsId}/columns/Tên`, { name: "Y" })).rejects.toThrow(/403/);
  await expect(editorApi.call("DELETE", `/tables/${dealsId}/columns/Tên`)).rejects.toThrow(/403/);
  const shared = (await editorApi.call("GET", `/tables/${dealsId}`)) as { columns: { name: string; type: string; config: Record<string, unknown> }[] };
  const formula = shared.columns.find((c) => c.name === "Gấp đôi")!;
  expect(formula.type).toBe("formula");
  expect(formula.config.formula).toBeUndefined();

  for (const s of [viewer, editor]) {
    const pg = s.page;
    const g = await open(s);
    await expect(pg.getByRole("button", { name: "Thêm cột", exact: true })).toHaveCount(0);
    const m = await openManager(pg);
    await expect(m.getByText("Chỉ chủ datahub được thêm, sửa hay xoá cột.")).toBeVisible();
    await expect(m.getByRole("button", { name: /^Sửa cột / })).toHaveCount(0);
    await expect(m.getByRole("button", { name: /^Xoá cột / })).toHaveCount(0);
    await expect(m.getByRole("button", { name: "Thêm cột" })).toHaveCount(0);
    // The formula column is there as a type, with no text of the formula.
    const row = m.getByRole("listitem").filter({ hasText: "Gấp đôi" });
    await expect(row.getByText("Công thức", { exact: true })).toBeVisible();
    await expect(m.getByText(/Doanh thu\] \* 2/)).toHaveCount(0);
    await s.shot(`column-manager-${s.name}`);
    await m.getByRole("button", { name: "Đóng" }).first().click();

    // Row panel: links are read-only (a reason in words); files can be seen and downloaded; only the editor uploads.
    await g.click(0, 0);
    await pg.getByRole("button", { name: "Chi tiết dòng" }).click();
    const panel = pg.getByRole("dialog", { name: /^Dòng #/ });
    await expect(panel.getByRole("button", { name: "Chọn dòng" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Tải về baogia.pdf" })).toBeVisible();
    if (s === editor) {
      await expect(panel.getByRole("button", { name: "Tải file lên" })).toBeVisible();
      await expect(panel.getByText("Chỉ chủ datahub được sửa cột liên kết.")).toBeVisible();
      const [dl] = await Promise.all([pg.waitForEvent("download"), panel.getByRole("button", { name: "Tải về baogia.pdf" }).click()]);
      expect(dl.suggestedFilename()).toBe("baogia.pdf");
    } else {
      await expect(panel.getByRole("button", { name: "Tải file lên" })).toHaveCount(0);
      await expect(panel.getByText("Bạn chỉ có quyền xem bảng này.")).toBeVisible();
    }
    await panel.getByRole("button", { name: "Đóng" }).first().click();
  }
});
