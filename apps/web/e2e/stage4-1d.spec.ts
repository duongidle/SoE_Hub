import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { GridDriver } from "./grid";
import { API, Session, type ProjectName, chooseOption, closeSelect, expectSelectValue, openSelect, moreAction, expectMore } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 4.1d: the split lock and its dialogs (share dialog, "Cho phép sửa", members-only person cells, removing a tagged member, no bulk adding),
 * collapsed groups saved in the view, summary export, the column "Ngày sửa của cột", renaming an option that formulas compare with.
 * Desktop only (quick test of this step).
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-4d-${p}-7741`;
const email = (who: string) => `${p}.sd${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");

let admin: ApiClient;
let ownerS: Session;
let u1S: Session;
let leadS: Session;
let sessions: Session[] = [];
let ownerApi: ApiClient;
let u1Api: ApiClient;
let leadApi: ApiClient;
let strangerApi: ApiClient;
let ids: Record<string, string> = {};
let dhId: string;
let tableId: string;
const keys: Record<string, string> = {};

const dhName = () => `Khoá phân chia 4D ${p}`;
const dialog = (page: Page, name?: string | RegExp): Locator => page.getByRole("dialog", name ? { name } : undefined).last();
const toast = (page: Page, text: string | RegExp) => expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
const lines = async (g: GridDriver) => Number(await g.root.getAttribute("data-lines"));
async function statusOf(fn: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await fn();
    return { status: 200, message: "" };
  } catch (e) {
    const m = (e as Error).message;
    return { status: Number(/-> (\d{3})/.exec(m)?.[1] ?? 0), message: m };
  }
}
const rowsOf = async (api: ApiClient) => (await api.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${tableId}/rows?limit=500`)).data;
const namesOf = async (api: ApiClient) => (await rowsOf(api)).map((r) => r.data[keys["Tên"]!] as string).sort();

async function openTable(s: Session): Promise<GridDriver> {
  await s.page.goto(`/datahub/${dhId}/${tableId}`);
  await expect(s.page.getByTestId("grid")).toBeVisible();
  return new GridDriver(s.page);
}

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "4.1d chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  admin = await createAdmin(API, email("admin"), `Admin 4D ${p}`, PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 4D ${p}`, roles: ["manager"] },
      { email: email("lead"), name: `Leader 4D ${p}`, roles: ["leader"], manager: email("mgr") },
      { email: email("owner"), name: `Chủ 4D ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("u1"), name: `Thành viên Một 4D ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
      { email: email("u2"), name: `Thành viên Hai 4D ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
      { email: email("stranger"), name: `Người Lạ 4D ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("outsider"), name: `Người Ngoài 4D ${p}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  u1Api = await new ApiClient(API).login(email("u1"), PASSWORD());
  leadApi = await new ApiClient(API).login(email("lead"), PASSWORD());
  strangerApi = await new ApiClient(API).login(email("stranger"), PASSWORD());
  dhId = (await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: dhName() })).id;
  tableId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${dhId}/tables`, { name: "Deals" })).id;
  const col = async (name: string, type: string, config?: object) => (keys[name] = (await ownerApi.call<{ key: string }>("POST", `/tables/${tableId}/columns`, { name, type, ...(config ? { config } : {}) })).key);
  await col("Tên", "text");
  await col("Phụ trách", "user");
  await col("Giai đoạn", "single_select", { options: [{ name: "Mới" }, { name: "Thắng" }] });
  await col("Doanh thu", "number");
  await col("Ghi chú", "text");
  for (const who of ["u1", "u2", "lead", "stranger"]) await ownerApi.call("PUT", `/datahubs/${dhId}/shares`, { grantee_id: ids[email(who)], table_id: null, permission: "edit_data" });
  const mk = (name: string, who: string, stage: string, money: number) => ownerApi.call("POST", `/tables/${tableId}/rows`, { data: { Tên: name, "Phụ trách": ids[email(who)], "Giai đoạn": stage, "Doanh thu": money, "Ghi chú": `ghi chú ${name}` } });
  await mk("d1", "u1", "Mới", 100);
  await mk("d2", "u1", "Thắng", 250);
  await mk("d3", "u2", "Thắng", 50);
  await mk("d4", "lead", "Mới", 1000);
  await mk("d5", "owner", "Thắng", 7);
  await mk("d6", "stranger", "Mới", 3);

  ownerS = await Session.open(browser, p, "owner");
  u1S = await Session.open(browser, p, "u1");
  leadS = await Session.open(browser, p, "lead");
  sessions = [ownerS, u1S, leadS];
  for (const [s, who] of [[ownerS, "owner"], [u1S, "u1"], [leadS, "lead"]] as const) {
    await s.login(email(who), PASSWORD());
    await expect(s.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  }
  for (const s of sessions) await s.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: process.env.E2E_WEB_URL ?? "http://localhost:5273" });
  // A member who loses the table (revoke below) gets 403/404 on the open page.
  u1S.allow(403, /\/api\/v1\//).allow(404, /\/api\/v1\//);
});

test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

test("khoá phân chia: chủ bật trong hộp thoại Chia sẻ; thành viên chỉ thấy dòng của mình và cấp dưới; tắt thêm hàng loạt", async () => {
  const pg = ownerS.page;
  await pg.goto(`/datahub/${dhId}/${tableId}`);
  await pg.getByRole("button", { name: "Chia sẻ" }).first().click();
  const d = dialog(pg, /^Chia sẻ/);
  const sec = d.getByTestId("split-options");
  await expect(sec).toBeVisible();
  // No user column is chosen yet: the key list offers only Người dùng columns.
  await sec.getByTestId("split-enabled").check();
  const keysBox = sec.getByTestId("split-keys");
  await expect(keysBox.getByRole("checkbox")).toHaveCount(1);
  await expect(keysBox.getByRole("checkbox", { name: "Phụ trách" })).toBeVisible();
  await expect(keysBox.getByRole("checkbox", { name: "Tên" })).toHaveCount(0);
  await keysBox.getByRole("checkbox", { name: "Phụ trách" }).check();
  await sec.getByTestId("split-bulk").uncheck();
  await sec.getByTestId("split-save").click();
  await toast(pg, "Đã lưu phân quyền theo dòng");
  await ownerS.shot("split-share-dialog");
  const tb = await ownerApi.call<{ key_split: { enabled: boolean; key_columns: { name: string }[] }; members_bulk_create: boolean }>("GET", `/tables/${tableId}`);
  expect(tb.key_split.enabled).toBe(true);
  expect(tb.key_split.key_columns.map((c) => c.name)).toEqual(["Phụ trách"]);
  expect(tb.members_bulk_create).toBe(false);
  await d.getByRole("button", { name: "Đóng", exact: true }).first().click();

  // What each person reads (server): own rows, own + team, the owner everything.
  expect(await namesOf(u1Api)).toEqual(["d1", "d2"]);
  expect(await namesOf(leadApi)).toEqual(["d1", "d2", "d3", "d4"]);
  expect(await namesOf(strangerApi)).toEqual(["d6"]);
  expect(await namesOf(ownerApi)).toEqual(["d1", "d2", "d3", "d4", "d5", "d6"]);

  // In the browser: the member sees only 2 rows and no import button; the leader sees 4.
  const g1 = await openTable(u1S);
  await expect(u1S.page.getByText("2 dòng", { exact: true })).toBeVisible();
  await expectMore(u1S.page, "Nhập", false);
  await expect(u1S.page.getByRole("button", { name: "Nhập dữ liệu" })).toHaveCount(0);
  await u1S.shot("split-member-view");
  await openTable(leadS);
  await expect(leadS.page.getByText("4 dòng", { exact: true })).toBeVisible();
  // The owner still has the import button.
  await openTable(ownerS);
  await expect(ownerS.page.getByText("6 dòng", { exact: true })).toBeVisible();
  await expectMore(ownerS.page, "Nhập", true);

  // Pasting more new rows than one is refused with a sentence (the server refuses too).
  await g1.click(0, 1);
  await g1.paste("x1\nx2\nx3");
  await toast(u1S.page, "không cho thành viên thêm nhiều dòng một lúc");
  expect(await namesOf(u1Api)).toEqual(["d1", "d2"]);
  const api = await statusOf(() => u1Api.call("POST", `/tables/${tableId}/rows/batch`, { ops: [{ op: "create", data: { Tên: "a" } }, { op: "create", data: { Tên: "b" } }] }));
  expect(api.status).toBe(403);
  expect(api.message).toContain("bulk_create_off");
  // A single new row is allowed and carries the member's name.
  const one = await u1Api.call<{ id: string; data: Record<string, unknown> }>("POST", `/tables/${tableId}/rows`, { data: { Tên: "d-moi" } });
  expect(one.data[keys["Phụ trách"]!]).toBe(ids[email("u1")]);
  await ownerApi.call("DELETE", `/tables/${tableId}/rows/${one.id}`);
});

test("ô Người dùng chỉ gợi ý thành viên; cột không cho sửa là chỉ đọc với thành viên, vẫn sửa được ở chủ", async () => {
  // Owner turns "Cho phép sửa" off for Ghi chú from the column editor.
  const pg = ownerS.page;
  await openTable(ownerS);
  await moreAction(pg, "Cột của bảng");
  await dialog(pg, "Cột của bảng").getByRole("button", { name: "Sửa cột Ghi chú" }).click();
  const e = dialog(pg, 'Sửa cột "Ghi chú"');
  const allow = e.getByRole("checkbox", { name: /Cho phép sửa/ });
  await expect(allow).toBeChecked();
  await allow.uncheck();
  await e.getByRole("button", { name: "Lưu cột" }).click();
  await toast(pg, "Đã lưu cột");
  await expect.poll(async () => ((await ownerApi.call<{ columns: { name: string; allow_edit: boolean }[] }>("GET", `/tables/${tableId}`)).columns.find((c) => c.name === "Ghi chú")!.allow_edit)).toBe(false);

  const g = await openTable(u1S);
  // Control: Tên is editable. Ghi chú (column 4) refuses typing and keeps its value.
  await g.type(0, 0, "d1 sửa");
  await expect.poll(() => g.read(0, 0)).toBe("d1 sửa");
  await g.type(4, 0, "zzz");
  expect(await g.read(4, 0)).toBe("ghi chú d1");
  const row0 = (await rowsOf(u1Api)).find((r) => r.data[keys["Tên"]!] === "d1 sửa")!;
  expect(row0.data[keys["Ghi chú"]!]).toBe("ghi chú d1");
  const refused = await statusOf(() => u1Api.call("PATCH", `/tables/${tableId}/rows/${row0.id}`, { data: { "Ghi chú": "api" }, version: 99 }));
  expect(refused.status).toBe(403);
  // The owner still types into it.
  const og = await openTable(ownerS);
  await og.type(4, 0, "chủ sửa");
  await expect.poll(() => og.read(4, 0)).toBe("chủ sửa");
  const curVersion = async () => (await ownerApi.call<{ version: number }>("GET", `/tables/${tableId}/rows/${row0.id}`)).version;
  await ownerApi.call("PATCH", `/tables/${tableId}/rows/${row0.id}`, { data: { "Ghi chú": "ghi chú d1", Tên: "d1" }, version: await curVersion() });

  // The person cell of a member suggests only the owner and members: "Người Ngoài" was never shared the table.
  await openTable(u1S);
  await g.click(1, 0, { double: true });
  const box = u1S.page.getByRole("textbox", { name: "Tìm người" });
  await box.fill("Ngoài");
  await expect(u1S.page.getByText(/Không có thành viên nào khớp/)).toBeVisible();
  await box.fill(`Thành viên Hai 4D ${p}`);
  await expect(u1S.page.getByRole("option", { name: new RegExp(`Thành viên Hai 4D ${p}`) })).toBeVisible();
  await u1S.page.keyboard.press("Escape");
  // The server refuses a non-member too, whatever the screen offers.
  const v2 = await curVersion();
  const bad = await statusOf(() => ownerApi.call("PATCH", `/tables/${tableId}/rows/${row0.id}`, { data: { "Phụ trách": ids[email("outsider")] }, version: v2 }));
  expect(bad.status).toBe(400);
  expect(bad.message).toContain("chưa là thành viên");
});

test("gỡ thành viên đang được tag: hộp thoại cảnh báo số dòng, tag giữ nguyên, ô hiện \"không còn quyền\"", async () => {
  const pg = ownerS.page;
  await openTable(ownerS);
  await pg.getByRole("button", { name: "Chia sẻ" }).first().click();
  const d = dialog(pg, /^Chia sẻ/);
  await d.getByRole("button", { name: new RegExp(`Thu hồi quyền của Người Lạ 4D ${p}`) }).click();
  const w = dialog(pg, "Thu hồi quyền của người đang được tag?");
  await expect(w).toBeVisible();
  await expect(w.getByText(/đang được ghi tên ở 1 dòng/)).toBeVisible();
  await ownerS.shot("split-remove-warning");
  await w.getByRole("button", { name: "Thu hồi quyền" }).click();
  await toast(pg, "vẫn ghi tên người này");
  await d.getByRole("button", { name: "Đóng", exact: true }).first().click();
  // The tag stays; the cell tells it.
  const rows = await rowsOf(ownerApi);
  expect(rows.find((r) => r.data[keys["Tên"]!] === "d6")!.data[keys["Phụ trách"]!]).toBe(ids[email("stranger")]);
  const g = await openTable(ownerS);
  // The grid draws "<tên> (không còn quyền)" in the cell; Copy keeps the plain name so it can be pasted back. The detail panel is plain text.
  await g.clickMarker(5);
  await ownerS.page.getByRole("button", { name: "Chi tiết dòng" }).click();
  await expect(ownerS.page.getByRole("dialog").last().getByText(`Người Lạ 4D ${p} (không còn quyền)`)).toBeVisible();
  await ownerS.shot("split-no-access-cell");
  await ownerS.page.keyboard.press("Escape");
  expect((await statusOf(() => strangerApi.call("GET", `/tables/${tableId}`))).status).toBeGreaterThanOrEqual(403);
});

async function openTool(page: Page, name: string, panelName: string): Promise<Locator> {
  await page.getByRole("toolbar", { name: "Công cụ view" }).getByRole("button", { name: new RegExp(`^${name}(?! của bảng)`) }).click();
  const d = page.getByRole("dialog", { name: panelName });
  await expect(d).toBeVisible();
  return d;
}

test("thu gọn / mở tất cả nhóm: lưu vào view, còn nguyên sau khi tải lại; người được chia sẻ có bản riêng", async () => {
  const pg = ownerS.page;
  const g = await openTable(ownerS);
  const gp = await openTool(pg, "Nhóm", "Nhóm dòng");
  await gp.getByRole("button", { name: "Thêm cấp nhóm" }).click();
  await chooseOption(gp.getByLabel("Cột nhóm cấp 1"), { label: "Giai đoạn" });
  await chooseOption(gp.getByLabel("Tổng của cột Doanh thu"), { label: "Tổng" });
  await pg.keyboard.press("Escape");
  await expect(pg.getByText("Đã lưu view")).toBeVisible();
  // 6 rows + 2 groups.
  await expect.poll(() => lines(g)).toBe(8);
  await pg.getByTestId("groups-collapse-all").click();
  await expect.poll(() => lines(g)).toBe(2);
  const sharedView = async (api: ApiClient) => (await api.call<{ views: { id: string; shared: boolean; config: Record<string, unknown>; has_override: boolean }[] }>("GET", `/tables/${tableId}/views`)).views.find((v) => v.shared)!;
  await expect.poll(async () => (await sharedView(ownerApi)).config.groups_collapsed).toBe(true);
  // Reload: still collapsed.
  const g2 = await openTable(ownerS);
  await expect.poll(() => lines(g2)).toBe(2);
  // Open one group by clicking its header; the state is saved as an exception of the mode.
  await g2.click(0, 0);
  await expect.poll(() => lines(g2)).toBe(2 + 3);
  await expect.poll(async () => ((await sharedView(ownerApi)).config.groups_toggled as string[] | undefined)?.length).toBe(1);
  await pg.getByTestId("groups-expand-all").click();
  await expect.poll(() => lines(g2)).toBe(8);
  await expect.poll(async () => (await sharedView(ownerApi)).config.groups_collapsed).toBeUndefined();
  // A member who collapses saves a copy of their own; the shared view stays as the owner left it.
  await pg.getByTestId("groups-collapse-all").click();
  await expect.poll(async () => (await sharedView(ownerApi)).config.groups_collapsed).toBe(true);
  const shared = await sharedView(u1Api);
  await u1Api.call("PATCH", `/views/${shared.id}`, { config: { groups_collapsed: false } });
  expect((await sharedView(u1Api)).has_override).toBe(true);
  expect((await sharedView(ownerApi)).config.groups_collapsed).toBe(true);
});

test("xuất dạng tổng hợp: hộp thoại có Dòng nhóm / Mọi dòng; file là các dòng nhóm", async () => {
  const pg = ownerS.page;
  await openTable(ownerS);
  await moreAction(pg, "Xuất");
  const d = dialog(pg, "Xuất dữ liệu");
  await chooseOption(d.getByLabel("Phạm vi xuất"), { index: 0 });
  await expectSelectValue(d.getByLabel("Dòng xuất ra"), "groups");
  const rowsList = await openSelect(d.getByLabel("Dòng xuất ra"));
  await expect(rowsList.getByRole("option")).toHaveText(["Dòng nhóm (tổng hợp)", "Mọi dòng"]);
  await closeSelect(rowsList);
  const dl = pg.waitForEvent("download");
  await d.getByRole("button", { name: "Xuất file" }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
  await expect(d.getByText(/Đã xuất xong/)).toBeVisible();
  const body = await ownerApi.call<{ status: string }>("POST", "/datahub/exports", { table_id: tableId, format: "csv", groups_only: true, group: [{ field: "Giai đoạn", dir: "asc" }], aggs: { "Doanh thu": "sum" } });
  expect(body.status).toBe("pending");
});

test("cột Ngày sửa của cột: tạo trên bảng đã có dữ liệu (điền từ lịch sử), đổi cột theo dõi thì đổi ngày, cột khác thì không", async () => {
  const pg = ownerS.page;
  // Back to a flat view (the grouping of the test before would put a group line at the top).
  const shared = (await ownerApi.call<{ views: { id: string; shared: boolean }[] }>("GET", `/tables/${tableId}/views`)).views.find((v) => v.shared)!;
  await ownerApi.call("PATCH", `/views/${shared.id}`, { config: { group: null, group_aggs: null, groups_collapsed: null, groups_toggled: null } });
  await openTable(ownerS);
  await moreAction(pg, "Thêm cột");
  const d = dialog(pg, "Thêm cột");
  await d.getByRole("textbox", { name: /^Tên cột/ }).fill("Ngày đổi giai đoạn");
  await chooseOption(d.getByLabel("Kiểu cột"), { label: "Ngày sửa của cột" });
  // Computed and system columns are not offered; one watched column is needed.
  await d.getByRole("button", { name: "Thêm cột" }).click();
  await expect(d.getByRole("alert").filter({ hasText: "Chọn từ 1 đến 5 cột" }).first()).toBeVisible();
  await d.getByRole("checkbox", { name: "Giai đoạn" }).check();
  await d.getByRole("button", { name: "Thêm cột" }).click();
  await toast(pg, "Đã thêm cột");
  const cols = (await ownerApi.call<{ columns: { name: string; key: string; type: string }[] }>("GET", `/tables/${tableId}`)).columns;
  const tracker = cols.find((c) => c.name === "Ngày đổi giai đoạn")!;
  expect(tracker.type).toBe("field_modified");
  const first = (await rowsOf(ownerApi)).find((r) => r.data[keys["Tên"]!] === "d2")!;
  const filled = first.data[tracker.key] as string;
  expect(filled).toMatch(/^\d{4}-\d\d-\d\dT/); // from the row history (the stage was set when the row was made)
  // Another column: unchanged. The watched column: later date. Nobody can type into the tracking column.
  await new Promise((r) => setTimeout(r, 30));
  const v = (await ownerApi.call<{ version: number }>("GET", `/tables/${tableId}/rows/${first.id}`)).version;
  await ownerApi.call("PATCH", `/tables/${tableId}/rows/${first.id}`, { data: { "Doanh thu": 251 }, version: v });
  expect((await ownerApi.call<{ data: Record<string, unknown> }>("GET", `/tables/${tableId}/rows/${first.id}`)).data[tracker.key]).toBe(filled);
  await ownerApi.call("PATCH", `/tables/${tableId}/rows/${first.id}`, { data: { "Giai đoạn": "Mới" }, version: v + 1 });
  const later = (await ownerApi.call<{ data: Record<string, unknown> }>("GET", `/tables/${tableId}/rows/${first.id}`)).data[tracker.key] as string;
  expect(Date.parse(later)).toBeGreaterThan(Date.parse(filled));
  const g = await openTable(ownerS);
  const idx = cols.findIndex((c) => c.name === "Ngày đổi giai đoạn");
  expect(await g.read(idx, 0)).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  await ownerS.shot("field-modified-column");
});

test("đổi tên lựa chọn: hộp thoại liệt kê công thức so chữ với tên cũ, mặc định cập nhật cả chúng", async () => {
  const pg = ownerS.page;
  await ownerApi.call("POST", `/tables/${tableId}/columns`, { name: "Là Thắng", type: "formula", config: { formula: '=IF([Giai đoạn]="Thắng",1,0)' } });
  await ownerApi.call("POST", `/tables/${tableId}/columns`, { name: "Nối Thắng", type: "formula", config: { formula: '=[Giai đoạn]&"Thắng"' } });
  await openTable(ownerS);
  await moreAction(pg, "Cột của bảng");
  await dialog(pg, "Cột của bảng").getByRole("button", { name: "Sửa cột Giai đoạn" }).click();
  const e = dialog(pg, 'Sửa cột "Giai đoạn"');
  await e.getByLabel("Tên lựa chọn 2").fill("Won");
  await e.getByRole("button", { name: "Lưu cột" }).click();
  const w = dialog(pg, "Công thức đang so chữ với tên cũ");
  await expect(w).toBeVisible();
  await expect(w.getByText("Là Thắng")).toBeVisible();
  await expect(w.getByText("Nối Thắng")).toHaveCount(0); // a concatenation is not a comparison
  await expect(w.getByTestId("option-impact-update")).toBeChecked();
  await ownerS.shot("option-rename-impact");
  await w.getByTestId("option-impact-save").click();
  await toast(pg, "Đã lưu cột và cập nhật công thức");
  const formula = async (name: string) => (await ownerApi.call<{ columns: { name: string; config: { formula?: string } }[] }>("GET", `/tables/${tableId}`)).columns.find((c) => c.name === name)!.config.formula;
  expect(await formula("Là Thắng")).toBe('=IF([Giai đoạn]="Won",1,0)');
  expect(await formula("Nối Thắng")).toBe('=[Giai đoạn]&"Thắng"');
});
