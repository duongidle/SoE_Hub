import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 2C-4: sharing (Xem / Sửa, per datahub or per table, change and revoke, with the real permissions checked on the server),
 * finding duplicate rows, the trash (datahub, table, column, row; name taken), and the Admin limits per person.
 * Desktop only (quick test of this step); the phone runs in the final stage test.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-4c-${p}-5521`;
const email = (who: string) => `${p}.sc${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const ODD = "Chia sẻ <b>đậm</b>";

let admin: ApiClient;
let owner: Session;
let viewer: Session;
let editor: Session;
let adminS: Session;
let ownerApi: ApiClient;
let viewerApi: ApiClient;
let editorApi: ApiClient;
let otherApi: ApiClient;
let ids: Record<string, string> = {};
let dhId: string;
let dealsId: string;
let custId: string;
let sessions: Session[] = [];

const dhName = () => `${ODD} ${p}`;
const dialog = (page: Page, name?: string | RegExp): Locator => page.getByRole("dialog", name ? { name } : undefined).last();
const toast = (page: Page, text: string | RegExp) => expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
/** The HTTP status an API call ends with (the client throws "METHOD url -> status: ..."). */
async function statusOf(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
    return 200;
  } catch (e) {
    return Number(/-> (\d{3})/.exec((e as Error).message)?.[1] ?? 0);
  }
}
const rowsOf = async (api: ApiClient, tableId: string) => (await api.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${tableId}/rows?limit=500`)).data;

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "2C-4 chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  admin = await createAdmin(API, email("admin"), `Admin 4C ${p}`, PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 4C ${p}`, roles: ["manager"] },
      { email: email("owner"), name: `Chủ 4C ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("viewer"), name: `Người Xem 4C ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("editor"), name: `Người Sửa 4C ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("other"), name: `Người Khác 4C ${p}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  viewerApi = await new ApiClient(API).login(email("viewer"), PASSWORD());
  editorApi = await new ApiClient(API).login(email("editor"), PASSWORD());
  otherApi = await new ApiClient(API).login(email("other"), PASSWORD());
  const dh = await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: dhName() });
  dhId = dh.id;
  dealsId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${dh.id}/tables`, { name: "Deals" })).id;
  custId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${dh.id}/tables`, { name: "Khách hàng" })).id;
  await ownerApi.call("POST", `/tables/${dealsId}/columns`, { name: "Tên", type: "text" });
  await ownerApi.call("POST", `/tables/${dealsId}/columns`, { name: "Ghi chú", type: "text" });
  await ownerApi.call("POST", `/tables/${custId}/columns`, { name: "Tên khách", type: "text" });
  await ownerApi.call("POST", `/tables/${dealsId}/rows`, { data: { Tên: "Deal gốc", "Ghi chú": "x" } });
  await ownerApi.call("POST", `/tables/${custId}/rows`, { data: { "Tên khách": "Khách gốc" } });
  // "Người khác" already has one datahub, so a limit of 1 stops the next one.
  await otherApi.call("POST", "/datahubs", { name: `Của người khác ${p}` });

  owner = await Session.open(browser, p, "owner");
  viewer = await Session.open(browser, p, "viewer");
  editor = await Session.open(browser, p, "editor");
  adminS = await Session.open(browser, p, "admin");
  sessions = [owner, viewer, editor, adminS];
  // After a revoke, the open page of the person who lost access reloads and gets 403/404: expected.
  for (const s of [viewer, editor]) s.allow(404, /\/api\/v1\/(tables|datahubs)\//).allow(403, /\/api\/v1\/(tables|datahubs)\//);
  for (const [s, who] of [[owner, "owner"], [viewer, "viewer"], [editor, "editor"], [adminS, "admin"]] as const) {
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

async function openDatahub(s: Session, tableId?: string): Promise<void> {
  await s.page.goto(`/datahub/${dhId}${tableId ? `/${tableId}` : ""}`);
  await expect(s.page.getByRole("heading", { level: 1, name: dhName() })).toBeVisible();
}
async function share(page: Page, who: string, scope: string, permission: string): Promise<void> {
  const d = dialog(page, /^Chia sẻ/);
  await d.getByRole("combobox", { name: "Tìm người" }).fill(who);
  await d.getByRole("option", { name: new RegExp(who) }).getByRole("button").click();
  await d.getByLabel("Phạm vi chia sẻ").selectOption({ label: scope });
  await d.getByLabel("Quyền chia sẻ").selectOption({ label: permission });
  await d.getByRole("button", { name: "Chia sẻ", exact: true }).click();
}

test("chia sẻ: chủ chia sẻ Xem cả datahub và Sửa một bảng; quyền thực tế đúng; đổi quyền; thu hồi", async () => {
  const pg = owner.page;
  await openDatahub(owner, dealsId);
  // Only the owner sees the button.
  await owner.shot("share-owner-header");
  await pg.getByRole("button", { name: "Chia sẻ" }).first().click();
  const d = dialog(pg, /^Chia sẻ/);
  await expect(d).toBeVisible();
  // The title shows a name with markup as plain text.
  await expect(d.getByText(`Chia sẻ "${dhName()}"`)).toBeVisible();
  await expect(d.getByText("Chưa chia sẻ cho ai")).toBeVisible();

  // Nobody found: says so. The owner is not offered to themselves.
  await d.getByRole("combobox", { name: "Tìm người" }).fill("zzzkhongco");
  await expect(d.getByText("Không tìm thấy người nào.")).toBeVisible();
  await d.getByRole("combobox", { name: "Tìm người" }).fill(`Chủ 4C ${p}`);
  await expect(d.getByText("Không tìm thấy người nào.")).toBeVisible();

  await share(pg, `Người Xem 4C ${p}`, "Cả datahub (kể cả bảng tạo sau)", "Xem");
  await toast(pg, "Đã chia sẻ cho");
  await expect(d.getByTestId("share-row")).toHaveCount(1);
  await share(pg, `Người Sửa 4C ${p}`, "Chỉ bảng: Deals", "Sửa dữ liệu");
  await expect(d.getByTestId("share-row")).toHaveCount(2);
  await owner.shot("share-dialog");
  await expect.poll(async () => (await ownerApi.call<{ permission: string; table_id: string | null }[]>("GET", `/datahubs/${dhId}/shares`)).map((s) => `${s.table_id === null ? "dh" : "tb"}:${s.permission}`).sort()).toEqual(["dh:view", "tb:edit_data"]);

  // What each person can really do (server answers).
  const [vRow] = await rowsOf(viewerApi, dealsId);
  expect(await statusOf(() => viewerApi.call("PATCH", `/tables/${dealsId}/rows/${vRow!.id}`, { data: { "Ghi chú": "viewer" } }))).toBe(403);
  expect(await statusOf(() => viewerApi.call("POST", `/tables/${dealsId}/rows`, { data: { Tên: "viewer" } }))).toBe(403);
  const editedByEditor = await editorApi.call<{ id: string }>("POST", `/tables/${dealsId}/rows`, { data: { Tên: "Dòng của người Sửa" } });
  expect(editedByEditor.id).toBeTruthy();
  expect(await statusOf(() => editorApi.call("POST", `/tables/${dealsId}/columns`, { name: "Cột lạ", type: "text" }))).toBe(403);
  expect(await statusOf(() => editorApi.call("PATCH", `/tables/${dealsId}`, { name: "Đổi tên" }))).toBe(403);
  expect(await statusOf(() => editorApi.call("GET", `/tables/${custId}`))).toBeGreaterThanOrEqual(403); // table-only share: the other table is closed
  expect((await editorApi.call<{ tables: { name: string }[] }>("GET", `/datahubs/${dhId}`)).tables.map((t) => t.name)).toEqual(["Deals"]);
  expect((await viewerApi.call<{ tables: { name: string }[] }>("GET", `/datahubs/${dhId}`)).tables.map((t) => t.name).sort()).toEqual(["Deals", "Khách hàng"]);
  expect(await statusOf(() => viewerApi.call("GET", `/datahubs/${dhId}/shares`))).toBe(403);

  // In the browser: the viewer has neither "Chia sẻ" nor the editing tools; the editor has the duplicate tool but not "Thêm cột".
  await openDatahub(viewer, dealsId);
  await expect(viewer.page.getByRole("button", { name: "Cột của bảng" })).toBeVisible();
  await expect(viewer.page.getByRole("button", { name: "Chia sẻ" })).toHaveCount(0);
  await expect(viewer.page.getByRole("button", { name: "Tìm dòng trùng" })).toHaveCount(0);
  await expect(viewer.page.getByRole("button", { name: "Thùng rác" })).toHaveCount(0);
  await openDatahub(editor, dealsId);
  await expect(editor.page.getByRole("button", { name: "Tìm dòng trùng" })).toBeVisible();
  await expect(editor.page.getByRole("button", { name: "Chia sẻ" })).toHaveCount(0);
  await expect(editor.page.getByRole("button", { name: "Thêm cột", exact: true })).toHaveCount(0);

  // Change the editor's permission to Xem: the write stops at once.
  await d.getByLabel(new RegExp(`Quyền của Người Sửa 4C ${p} với Deals`)).selectOption({ label: "Xem" });
  await toast(pg, "Đã đổi quyền");
  await expect.poll(() => statusOf(() => editorApi.call("POST", `/tables/${dealsId}/rows`, { data: { Tên: "sau khi đổi" } }))).toBe(403);
  await d.getByLabel(new RegExp(`Quyền của Người Sửa 4C ${p} với Deals`)).selectOption({ label: "Sửa dữ liệu" });
  await expect.poll(() => statusOf(() => editorApi.call("POST", `/tables/${dealsId}/rows`, { data: { Tên: "lại được" } }))).toBe(200);

  // Revoke both: they lose access.
  for (const [name, scope] of [[`Người Xem 4C ${p}`, "Cả datahub"], [`Người Sửa 4C ${p}`, "Deals"]] as const) {
    await d.getByRole("button", { name: new RegExp(`Thu hồi quyền của ${name} với ${scope}`) }).click();
    await toast(pg, `Đã thu hồi quyền của ${name}`);
  }
  await expect(d.getByText("Chưa chia sẻ cho ai")).toBeVisible();
  await expect.poll(() => statusOf(() => viewerApi.call("GET", `/datahubs/${dhId}`))).toBeGreaterThanOrEqual(403);
  await expect.poll(() => statusOf(() => editorApi.call("GET", `/tables/${dealsId}`))).toBeGreaterThanOrEqual(403);
  await d.getByRole("button", { name: "Đóng", exact: true }).first().click();
  await expect(d).toBeHidden();
});

test("tìm dòng trùng: chọn cột, xử lý từng nhóm, xử lý mọi nhóm, dòng bị xoá vào thùng rác", async () => {
  const names = ["An Phát", "an phat ", "AN PHÁT", "Bình", "bình", "<b>Đậm</b>", "<b>đậm</b>", "Duy nhất"];
  for (const n of names) await ownerApi.call("POST", `/tables/${custId}/rows`, { data: { "Tên khách": n } });
  const pg = owner.page;
  await openDatahub(owner, custId);
  await pg.getByRole("button", { name: "Tìm dòng trùng" }).click();
  const d = dialog(pg, "Tìm dòng trùng");
  await expect(d.getByRole("button", { name: "Tìm dòng trùng" })).toBeDisabled();
  await d.getByRole("checkbox", { name: "Tên khách" }).check();
  await d.getByRole("button", { name: "Tìm dòng trùng" }).click();
  await expect(d.getByText("3 nhóm trùng, 7 dòng")).toBeVisible();
  await owner.shot("duplicates-groups");
  // A name with markup shows as text.
  await expect(d.getByText("<b>Đậm</b>").first()).toBeVisible();

  // Resolve the biggest group by hand (it comes first): keep the first row, delete the other two.
  const cards = d.getByTestId("duplicate-group");
  await expect(cards).toHaveCount(3);
  await cards.first().getByRole("button", { name: /^Xoá 2 dòng còn lại/ }).click();
  await toast(pg, "Đã xoá 2 dòng");
  await expect(d.getByText("2 nhóm trùng, 4 dòng")).toBeVisible();
  await expect(cards).toHaveCount(2);
  await expect.poll(async () => (await rowsOf(ownerApi, custId)).filter((r) => Object.values(r.data).some((v) => /^an ph/i.test(String(v).trim()))).length).toBe(1);

  // Every group at once: keep the first, and the rest go.
  await d.getByRole("button", { name: "Xử lý mọi nhóm" }).click();
  const bulk = dialog(pg, "Xử lý mọi nhóm trùng");
  await bulk.getByRole("button", { name: /^Xoá dòng thừa của 2 nhóm/ }).click();
  await toast(pg, "Đã xử lý 2 nhóm");
  await expect(d.getByText("Không có dòng trùng")).toBeVisible();
  // 1 original + 1 + 1 + 1 + "Duy nhất" + "Khách gốc" = 5 live rows; 4 rows went to the trash.
  await expect.poll(async () => (await rowsOf(ownerApi, custId)).length).toBe(5);
  const trash = await ownerApi.call<{ rows: unknown[] }>("GET", `/datahub/trash?table_id=${custId}`);
  expect(trash.rows.length).toBe(4);
  // A person who can only view cannot use the server command.
  await ownerApi.call("PUT", `/datahubs/${dhId}/shares`, { grantee_id: ids[email("viewer")], permission: "view" });
  expect(await statusOf(() => viewerApi.call("POST", `/tables/${custId}/duplicates/resolve`, { all: { columns: ["Tên khách"], keep: "first", fill_empty: false } }))).toBe(403);
  await ownerApi.call("DELETE", `/datahubs/${dhId}/shares/${(await ownerApi.call<{ id: string }[]>("GET", `/datahubs/${dhId}/shares`))[0]!.id}`);
  await d.getByRole("button", { name: "Đóng" }).first().click();
});

test("thùng rác: khôi phục dòng, cột, bảng, datahub; tên bị dùng thì hỏi tên mới; hiện hạn xoá hẳn", async () => {
  const pg = owner.page;
  // A name taken answers 409 on the restore call; that is what makes the page ask for a new name.
  owner.allow(409, /\/restore$/);
  // Row and column of the table.
  const extra = await ownerApi.call<{ id: string }>("POST", `/tables/${dealsId}/rows`, { data: { Tên: "Dòng sẽ xoá", "Ghi chú": "<i>ghi</i>" } });
  await ownerApi.call("POST", `/tables/${dealsId}/columns`, { name: "Cột sẽ xoá", type: "text" });
  await ownerApi.call("DELETE", `/tables/${dealsId}/rows/${extra.id}`);
  await ownerApi.call("DELETE", `/tables/${dealsId}/columns/${encodeURIComponent("Cột sẽ xoá")}`);
  // A new column took the name of the deleted one: restoring asks for a new name.
  await ownerApi.call("POST", `/tables/${dealsId}/columns`, { name: "Cột sẽ xoá", type: "text" });
  await openDatahub(owner, dealsId);
  await pg.getByRole("button", { name: "Thùng rác" }).click();
  const d = dialog(pg, "Thùng rác của bảng");
  await expect(d.getByTestId("trash-column")).toHaveCount(1);
  await expect(d.getByTestId("trash-row")).toHaveCount(1);
  await expect(d.getByText(/Xoá hẳn \d/).first()).toBeVisible();
  await owner.shot("table-trash");
  await d.getByRole("button", { name: "Khôi phục cột Cột sẽ xoá" }).click();
  const rn = dialog(pg, "Tên cột đã bị dùng");
  await expect(rn).toBeVisible();
  await rn.getByRole("textbox", { name: /Tên mới/ }).fill("Cột đã khôi phục");
  await rn.getByRole("button", { name: "Khôi phục với tên này" }).click();
  await toast(pg, 'Đã khôi phục cột "Cột sẽ xoá"');
  await expect.poll(async () => ((await ownerApi.call<{ columns: { name: string }[] }>("GET", `/tables/${dealsId}`)).columns.map((c) => c.name))).toContain("Cột đã khôi phục");
  await d.getByRole("button", { name: /^Khôi phục dòng/ }).click();
  await toast(pg, 'Đã khôi phục dòng "#');
  await expect.poll(async () => (await rowsOf(ownerApi, dealsId)).some((r) => r.id === extra.id)).toBe(true);
  await expect(d.getByText("Thùng rác của bảng trống")).toBeVisible();
  await d.getByRole("button", { name: "Đóng" }).first().click();

  // Table: delete by the page (with its confirm), restore from the trash page. A new table with the same name is made first.
  await openDatahub(owner, custId);
  await pg.getByRole("button", { name: "Tuỳ chọn bảng Khách hàng" }).click();
  await pg.getByRole("menuitem", { name: "Xoá bảng" }).click();
  await dialog(pg).getByRole("button", { name: "Xoá bảng" }).click();
  await toast(pg, 'Đã xoá bảng "Khách hàng"');
  const again = await ownerApi.call<{ id: string }>("POST", `/datahubs/${dhId}/tables`, { name: "Khách hàng" });
  // And a whole datahub, with a markup name; its name is taken by a new datahub.
  const gone = await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: `Sẽ xoá <b>x</b> ${p}` });
  await ownerApi.call("DELETE", `/datahubs/${gone.id}`);
  await ownerApi.call("POST", "/datahubs", { name: `Sẽ xoá <b>x</b> ${p}` });

  await pg.goto("/datahub");
  await pg.getByRole("link", { name: "Thùng rác" }).click();
  await expect(pg.getByRole("heading", { level: 1, name: "Thùng rác datahub" })).toBeVisible();
  await expect(pg.getByTestId("trash-table")).toHaveCount(1);
  await expect(pg.getByTestId("trash-datahub")).toHaveCount(1);
  await expect(pg.getByTestId("trash-datahub").getByText(`Sẽ xoá <b>x</b> ${p}`)).toBeVisible();
  await expect(pg.getByText(/Xoá hẳn \d/).first()).toBeVisible();
  await owner.shot("trash-page");

  await pg.getByRole("button", { name: "Khôi phục bảng Khách hàng" }).click();
  const rt = dialog(pg, "Tên bảng đã bị dùng");
  await rt.getByRole("textbox", { name: /Tên mới/ }).fill("Khách hàng cũ");
  await rt.getByRole("button", { name: "Khôi phục với tên này" }).click();
  await toast(pg, 'Đã khôi phục bảng "Khách hàng"');
  await expect.poll(async () => (await ownerApi.call<{ tables: { name: string }[] }>("GET", `/datahubs/${dhId}`)).tables.map((t) => t.name).sort()).toEqual(["Deals", "Khách hàng", "Khách hàng cũ"]);
  expect(again.id).toBeTruthy();
  const restoredRows = await rowsOf(ownerApi, (await ownerApi.call<{ tables: { id: string; name: string }[] }>("GET", `/datahubs/${dhId}`)).tables.find((t) => t.name === "Khách hàng cũ")!.id);
  expect(restoredRows.length).toBe(5);

  await pg.getByRole("button", { name: /^Khôi phục datahub Sẽ xoá/ }).click();
  const rd = dialog(pg, "Tên datahub đã bị dùng");
  await rd.getByRole("textbox", { name: /Tên mới/ }).fill(`Đã khôi phục ${p}`);
  await rd.getByRole("button", { name: "Khôi phục với tên này" }).click();
  await expect(pg.getByText("Thùng rác trống")).toBeVisible();
  await expect.poll(async () => (await ownerApi.call<{ name: string }[]>("GET", "/datahubs?scope=mine")).map((x) => x.name)).toContain(`Đã khôi phục ${p}`);
});

test("Admin: đặt giới hạn riêng cho một người, giới hạn có tác dụng, về mặc định", async () => {
  const pg = adminS.page;
  await adminS.clickMenu("Giới hạn Datahub");
  await expect(pg.getByRole("heading", { level: 1, name: "Giới hạn Datahub theo người" })).toBeVisible();
  await expect(pg.getByText("Chưa đặt giới hạn riêng cho ai.")).toBeVisible();
  const user = pg.getByRole("combobox", { name: "Người dùng" });
  await pg.getByRole("textbox", { name: "Người dùng: tìm" }).fill(`Người Khác 4C ${p}`);
  await user.selectOption({ label: `Người Khác 4C ${p} (${email("other")})` });

  // Wrong values are refused under the form, before the server.
  await pg.getByTestId("limit-max_columns").fill("201");
  await pg.getByTestId("limit-save").click();
  await expect(pg.getByText("Cột tối đa mỗi bảng: tối đa 200.")).toBeVisible();
  await pg.getByTestId("limit-max_columns").fill("0");
  await pg.getByTestId("limit-save").click();
  await expect(pg.getByText(/nhập số nguyên từ 1/)).toBeVisible();
  await pg.getByTestId("limit-max_columns").fill("");

  await pg.getByTestId("limit-max_datahubs").fill("1");
  await pg.getByTestId("limit-max_tables").fill("2");
  await pg.getByTestId("limit-save").click();
  await toast(pg, "Đã lưu giới hạn");
  await expect(pg.getByTestId("limit-row")).toHaveCount(1);
  await expect(pg.getByTestId("limit-row")).toContainText(`Người Khác 4C ${p}`);
  await adminS.shot("admin-limits");

  // The limit works: the person already has one datahub, so a second is refused; a third table too.
  expect(await statusOf(() => otherApi.call("POST", "/datahubs", { name: `Thứ hai ${p}` }))).toBeGreaterThanOrEqual(400);
  const mine = (await otherApi.call<{ id: string; owner_id: string }[]>("GET", "/datahubs?scope=mine"))[0]!;
  await otherApi.call("POST", `/datahubs/${mine.id}/tables`, { name: "B1" });
  await otherApi.call("POST", `/datahubs/${mine.id}/tables`, { name: "B2" });
  expect(await statusOf(() => otherApi.call("POST", `/datahubs/${mine.id}/tables`, { name: "B3" }))).toBeGreaterThanOrEqual(400);

  // Back to the defaults: the limit goes and a second datahub is allowed.
  await pg.getByRole("button", { name: "Về mặc định" }).click();
  await expect.poll(() => statusOf(() => otherApi.call("POST", "/datahubs", { name: `Thứ hai ${p}` }))).toBe(200);
  await expect(pg.getByTestId("limit-row")).toContainText("Mặc định");

  // A person without the right does not see the page.
  await owner.page.goto("/quan-tri/datahub-gioi-han");
  await expect(owner.page.getByRole("heading", { level: 1, name: "Giới hạn Datahub theo người" })).toHaveCount(0);
});
