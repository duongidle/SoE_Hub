import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { seedMany } from "./dh-fixtures";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 3B: the merged table. Built in the browser (sources in priority order, column mapping, duplicate key, the diagnosis that comes from
 * the server), read-only for everyone, follows its sources through the worker, says plainly when a source is lost and keeps the last good
 * rows, owner-only configuration. Desktop only (quick test of this step); the phone runs in the final stage test.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-3b-${p}-7731`;
const email = (who: string) => `${p}.mg${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const ODD = "Gộp <b>đậm</b> & Co";

let owner: Session;
let viewer: Session;
let sessions: Session[] = [];
let ownerApi: ApiClient;
let viewerApi: ApiClient;
let otherApi: ApiClient;
let hubId: string; // datahub that holds the merged tables
let srcAId: string;
let srcBId: string;
let bigId: string;
let mergedId = "";
const names = () => ({ hub: `Tổng hợp ${ODD} ${p}`, a: `Nguồn A ${p}`, b: `Nguồn B ${ODD} ${p}` });

const dialog = (page: Page, name?: string | RegExp): Locator => page.getByRole("dialog", name ? { name } : undefined).last();
const toast = (page: Page, text: string | RegExp) => expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();
async function statusOf(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
    return 200;
  } catch (e) {
    return Number(/-> (\d{3})/.exec((e as Error).message)?.[1] ?? 0);
  }
}
interface RowOut { id: string; data: Record<string, unknown> }
const rowsOf = async (api: ApiClient, tableId: string) => (await api.raw<{ data: RowOut[]; total?: number }>(`/tables/${tableId}/rows?limit=500&include_total=true`)).data;
const mergeInfo = (api: ApiClient, tableId: string) => api.call<{ status: string; syncing: boolean; errors: { reason: string; name: string | null }[]; diagnostics: { summary: string; total_kept: number; dropped: number } | null; config: unknown }>("GET", `/tables/${tableId}/merge`);
async function colKey(api: ApiClient, tableId: string, name: string) {
  const t = await api.call<{ columns: { name: string; key: string }[] }>("GET", `/tables/${tableId}`);
  return t.columns.find((c) => c.name === name)!.key;
}
const settled = (api: ApiClient, tableId: string) => expect.poll(async () => (await mergeInfo(api, tableId)).syncing, { message: "bảng gộp chưa đồng bộ xong", timeout: 20_000 }).toBe(false);

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "3B chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  const admin = await createAdmin(API, email("admin"), `Admin 3B ${p}`, PASSWORD(), ROOT);
  await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 3B ${p}`, roles: ["manager"] },
      { email: email("owner"), name: `Chủ 3B ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("viewer"), name: `Người Sửa 3B ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("other"), name: `Người Khác 3B ${p}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  viewerApi = await new ApiClient(API).login(email("viewer"), PASSWORD());
  otherApi = await new ApiClient(API).login(email("other"), PASSWORD());
  const n = names();
  hubId = (await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: n.hub })).id;
  // Source A: its own datahub. Source B: another datahub, with markup in the names. Same column names with different case.
  const dhA = await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: `DH A ${p}` });
  srcAId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${dhA.id}/tables`, { name: n.a })).id;
  const dhB = await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: `DH B ${p}` });
  srcBId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${dhB.id}/tables`, { name: n.b })).id;
  for (const [id, cols] of [[srcAId, ["MST", "Tên", "Doanh thu"]], [srcBId, ["mst", "TÊN", "Doanh thu"]]] as const) {
    await ownerApi.call("POST", `/tables/${id}/columns`, { name: cols[0], type: "text" });
    await ownerApi.call("POST", `/tables/${id}/columns`, { name: cols[1], type: "text" });
    await ownerApi.call("POST", `/tables/${id}/columns`, { name: cols[2], type: "currency" });
  }
  await ownerApi.call("POST", `/tables/${srcAId}/rows/batch`, { ops: [
    { op: "create", data: { MST: "0101", Tên: "<b>Công ty</b> An", "Doanh thu": 100 } },
    { op: "create", data: { MST: "Đức Anh", Tên: "Đức Anh A", "Doanh thu": -50 } },
    { op: "create", data: { Tên: "Không khoá", "Doanh thu": 12_345_678_901_234 } },
  ] });
  await ownerApi.call("POST", `/tables/${srcBId}/rows/batch`, { ops: [
    { op: "create", data: { mst: "0101 ", TÊN: "An (B)", "Doanh thu": 999 } },
    { op: "create", data: { mst: "duc anh", TÊN: "Đức Anh B", "Doanh thu": 7 } },
    { op: "create", data: { mst: "0909", TÊN: "Chỉ ở B", "Doanh thu": 1 } },
  ] });
  // A bigger source for the load check.
  bigId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${dhA.id}/tables`, { name: `Lớn ${p}` })).id;
  await ownerApi.call("POST", `/tables/${bigId}/columns`, { name: "MST", type: "text" });
  await ownerApi.call("POST", `/tables/${bigId}/columns`, { name: "Số", type: "number" });
  await seedMany(ownerApi, bigId, 2500, (i) => ({ MST: `K${i % 2000}`, Số: i }));

  owner = await Session.open(browser, p, "owner");
  viewer = await Session.open(browser, p, "viewer");
  sessions = [owner, viewer];
  // The person the table was shared with may lose it again (404/403 on a reload is expected there).
  viewer.allow(404, /\/api\/v1\/(tables|datahubs)\//).allow(403, /\/api\/v1\/(tables|datahubs)\//);
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

test("tạo bảng gộp trong giao diện: nguồn theo thứ tự ưu tiên, ghép cột, khoá chống trùng, chẩn đoán từ máy chủ", async () => {
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}`);
  await expect(pg.getByRole("heading", { level: 1, name: names().hub })).toBeVisible();
  // The only way to start: a datahub with no table shows the button on the tab bar.
  await pg.getByTestId("add-merged-table").click();
  const d = dialog(pg, "Thêm bảng gộp");
  await expect(d).toBeVisible();
  await expect(d.getByTestId("merge-no-source")).toBeVisible();
  await expect(d.getByTestId("merge-submit")).toBeDisabled();

  // Name check, as for any table.
  await d.getByTestId("merge-name").fill("a[b");
  await d.getByTestId("merge-name").blur();
  await expect(d.getByRole("alert").filter({ hasText: /\[|\]/ }).first()).toBeVisible();
  await d.getByTestId("merge-name").fill(`Gộp khách ${p}`);

  // Sources: markup in a name is text. Only tables of the owner are offered (not the other person's).
  const sel = d.getByTestId("merge-source-select");
  await expect(sel.locator("option", { hasText: `Nguồn B ${ODD} ${p}` })).toHaveCount(1);
  await sel.selectOption({ label: `DH A ${p} – ${names().a}` });
  await d.getByTestId("merge-add-source").click();
  await sel.selectOption({ label: `DH B ${p} – ${names().b}` });
  await d.getByTestId("merge-add-source").click();
  await expect(d.getByTestId("merge-source")).toHaveCount(2);
  // No key: the warning and the diagnosis from the server (6 rows read, nothing dropped).
  await expect(d.getByText("Chưa có khoá chống trùng, số liệu có thể bị đếm hai lần.").first()).toBeVisible();
  await expect(d.getByTestId("merge-summary")).toContainText("Gộp 2 bảng: 6 dòng");
  await expect(d.getByTestId("merge-columns")).toContainText("MST, Tên, Doanh thu, Nguồn, Mã dòng gốc");

  // Key on MST (accents, case, spaces ignored): 0101 and Đức Anh are duplicates.
  await d.getByTestId("merge-dedup-on").check();
  await d.getByTestId("merge-key-MST").check();
  await expect(d.getByTestId("merge-summary")).toContainText("Gộp 2 bảng: 5 dòng, loại 1 dòng trùng khoá");
  await d.getByTestId("merge-strategy-cell_merge").check();
  // The row without a key is kept: 3 + 3 - 2 duplicates... "Đức Anh" and "0101 " are two groups; the empty-key row stays.
  await expect(d.getByTestId("merge-summary")).toContainText("loại 2 dòng trùng khoá");
  await d.getByTestId("merge-duplicates").locator("summary").click();
  await expect(d.getByTestId("merge-dup-group")).toHaveCount(2);
  // Priority: move B first, the order is what the server uses.
  await d.getByRole("button", { name: new RegExp(`^Ưu tiên cao hơn: DH B`) }).click();
  await expect(d.getByTestId("merge-source").first()).toContainText(`DH B ${p}`);
  await owner.shot("merge-builder");

  await d.getByTestId("merge-submit").click();
  await expect(dialog(pg, "Thêm bảng gộp")).toBeHidden();
  await toast(pg, `Đã tạo bảng gộp "Gộp khách ${p}"`);
  await expect(pg).toHaveURL(new RegExp(`/datahub/${hubId}/[0-9a-f-]{36}$`));
  mergedId = pg.url().split("/").pop()!;

  // The bar shows read-only and, after the worker is done, up to date with the diagnosis.
  const bar = pg.getByTestId("merge-bar");
  await expect(bar).toContainText("Bảng gộp · chỉ đọc");
  await expect(bar.getByTestId("merge-status")).toContainText("Đã đồng bộ", { timeout: 20_000 });
  await expect(bar.getByTestId("merge-summary")).toContainText("Gộp 2 bảng: 4 dòng, loại 2 dòng trùng khoá");
  await owner.shot("merge-table");

  // Rows (server): B first in priority, cell merge fills the name of "Đức Anh" ... from the first non-empty cell by priority.
  const rows = await rowsOf(ownerApi, mergedId);
  expect(rows).toHaveLength(4);
  const mst = await colKey(ownerApi, mergedId, "MST");
  const ten = await colKey(ownerApi, mergedId, "Tên");
  const dt = await colKey(ownerApi, mergedId, "Doanh thu");
  const src = await colKey(ownerApi, mergedId, "Nguồn");
  expect(rows.find((r) => r.data[mst] === "0101")!.data[ten]).toBe("An (B)"); // B has priority
  expect(rows.find((r) => r.data[ten] === "Không khoá")!.data[dt]).toBe(12_345_678_901_234); // big number kept whole
  expect(rows.map((r) => r.data[dt]).sort((x, y) => Number(x) - Number(y))[0]).toBe(1);
  expect(rows.some((r) => String(r.data[src]).includes(`DH B ${p} – ${names().b}`))).toBe(true);
  expect((await ownerApi.call<{ row_count: number; kind: string }>("GET", `/tables/${mergedId}`)).row_count).toBe(4);
});

test("chỉ đọc: giao diện không cho nhập, máy chủ từ chối ghi dòng, nhập, thêm cột dữ liệu và xoá cột", async () => {
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/${mergedId}`);
  const bar = pg.getByTestId("merge-bar");
  await expect(bar).toBeVisible();
  // No import, no duplicate finder, no trash for a read-only table.
  await expect(pg.getByRole("button", { name: "Nhập", exact: true })).toHaveCount(0);
  await expect(pg.getByRole("button", { name: "Tìm dòng trùng" })).toHaveCount(0);
  const [row] = await rowsOf(ownerApi, mergedId);
  expect(await statusOf(() => ownerApi.call("POST", `/tables/${mergedId}/rows`, { data: {} }))).toBe(403);
  expect(await statusOf(() => ownerApi.call("PATCH", `/tables/${mergedId}/rows/${row!.id}`, { data: {}, version: 1 }))).toBe(403);
  expect(await statusOf(() => ownerApi.call("DELETE", `/tables/${mergedId}/rows/${row!.id}`))).toBe(403);
  expect(await statusOf(() => ownerApi.call("POST", `/tables/${mergedId}/rows/batch`, { ops: [{ op: "create", data: {} }] }))).toBe(403);
  expect(await statusOf(() => ownerApi.call("POST", `/tables/${mergedId}/columns`, { name: "Tay", type: "text" }))).toBe(403);
  const mst = await colKey(ownerApi, mergedId, "MST");
  expect(await statusOf(() => ownerApi.call("DELETE", `/tables/${mergedId}/columns/${mst}`))).toBe(403);
  // A formula column is allowed.
  expect(await statusOf(() => ownerApi.call("POST", `/tables/${mergedId}/columns`, { name: "Gấp đôi", type: "formula", config: { formula: "=[Doanh thu]*2", result_type: "number" } }))).toBe(200);
  // The merge table is not a target of a source: a merged table cannot be a source of another.
  expect(await statusOf(() => ownerApi.call("POST", `/datahubs/${hubId}/merged-tables`, { name: "Gộp của gộp", sources: [mergedId] }))).toBe(422);
});

test("nguồn đổi thì bảng gộp tự cập nhật; sửa, thêm, xoá dòng nguồn; dữ liệu xấu nhất", async () => {
  const mst = await colKey(ownerApi, mergedId, "MST");
  const ten = await colKey(ownerApi, mergedId, "Tên");
  const aRows = await rowsOf(ownerApi, srcAId);
  const before = await rowsOf(ownerApi, mergedId);
  const idOf = (rows: RowOut[], key: string) => rows.find((r) => r.data[mst] === key)!.id;
  // A new row, an edit with markup and an empty value, a delete.
  await ownerApi.call("POST", `/tables/${srcAId}/rows`, { data: { MST: "7777", Tên: "<script>alert(1)</script>", "Doanh thu": -1 } });
  const row0101 = aRows.find((r) => Object.values(r.data).includes("0101"))!;
  await ownerApi.call("PATCH", `/tables/${srcAId}/rows/${row0101.id}`, { data: { Tên: "An mới" }, version: 1 });
  const rowNoKey = aRows.find((r) => Object.values(r.data).includes("Không khoá"))!;
  await ownerApi.call("DELETE", `/tables/${srcAId}/rows/${rowNoKey.id}`);
  await expect.poll(async () => (await rowsOf(ownerApi, mergedId)).length, { timeout: 20_000 }).toBe(4); // +1 -1
  await settled(ownerApi, mergedId);
  const after = await rowsOf(ownerApi, mergedId);
  expect(after.find((r) => r.data[mst] === "7777")!.data[ten]).toBe("<script>alert(1)</script>");
  // The row of key 0101 is the same merged row (identity = key), its name from B (priority) still.
  expect(idOf(after, "0101")).toBe(idOf(before, "0101"));
  // On screen: the page shows the new count in its bar without a reload (live signal) and the markup stays text.
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/${mergedId}`);
  await expect(pg.getByTestId("merge-bar").getByTestId("merge-status")).toContainText("Đã đồng bộ");
  await expect(pg.getByTestId("merge-bar").getByTestId("merge-summary")).toContainText("Gộp 2 bảng:");
  await owner.shot("merge-after-change");
});

test("nguồn lớn: 2.500 dòng thêm vào bảng gộp, đủ số dòng, bảng đồng bộ xong", async () => {
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/${mergedId}`);
  await expect(pg.getByTestId("merge-bar")).toBeVisible();
  await pg.getByTestId("merge-configure").click();
  const d = dialog(pg, /^Cấu hình bảng gộp/);
  await expect(d).toBeVisible();
  // The saved configuration is back in the form: 2 sources, key on MST, manual mapping.
  await expect(d.getByTestId("merge-source")).toHaveCount(2);
  await expect(d.getByTestId("merge-key-MST")).toBeChecked();
  await d.getByTestId("merge-source-select").selectOption({ label: `DH A ${p} – Lớn ${p}` });
  await d.getByTestId("merge-add-source").click();
  // The big table has MST and Số: map MST by hand (Số has no counterpart, so it is left out of the merge).
  const mapping = d.getByTestId("merge-mapping");
  const mstRow = mapping.getByTestId("merge-mapping-row").filter({ has: pg.locator('input[value="MST"]') });
  await mstRow.getByRole("combobox", { name: new RegExp(`ở DH A ${p} – Lớn ${p}`) }).selectOption({ label: "MST" });
  await expect(d.getByTestId("merge-summary")).toContainText("Gộp 3 bảng", { timeout: 20_000 });
  await d.getByTestId("merge-submit").click();
  await expect(dialog(pg, /^Cấu hình bảng gộp/)).toBeHidden();
  await toast(pg, "Đã lưu cấu hình");
  await settled(ownerApi, mergedId);
  // 2.000 distinct keys K0..K1999 (500 repeated) + 5 other keys/rows ... counted by the server.
  const info = await mergeInfo(ownerApi, mergedId);
  expect(info.status).toBe("ok");
  const t = await ownerApi.raw<{ total: number }>(`/tables/${mergedId}/rows?limit=1&include_total=true`);
  expect(t.total).toBe(info.diagnostics!.total_kept);
  expect(info.diagnostics!.total_kept).toBeGreaterThanOrEqual(2000);
  expect(info.diagnostics!.dropped).toBeGreaterThanOrEqual(500);
  await expect(pg.getByTestId("merge-bar").getByTestId("merge-summary")).toContainText("loại");
  await owner.shot("merge-big");
});

test("mất nguồn: bảng báo lỗi rõ, giữ dữ liệu cũ; khôi phục nguồn thì tự đồng bộ lại", async () => {
  const pg = owner.page;
  const n0 = (await rowsOf(ownerApi, mergedId)).length;
  await ownerApi.call("DELETE", `/tables/${srcBId}`);
  await expect.poll(async () => (await mergeInfo(ownerApi, mergedId)).status, { timeout: 20_000 }).toBe("error");
  await pg.goto(`/datahub/${hubId}/${mergedId}`);
  const errors = pg.getByTestId("merge-errors");
  await expect(errors).toContainText("giữ dữ liệu của lần đồng bộ cuối");
  await expect(errors).toContainText(`Bảng "${names().b}"`);
  await expect(errors).toContainText("đã bị xoá");
  await expect(pg.getByTestId("merge-status")).toContainText("Lỗi nguồn");
  expect((await rowsOf(ownerApi, mergedId)).length).toBe(n0); // last good copy kept
  await owner.shot("merge-source-lost");

  await ownerApi.call("POST", `/tables/${srcBId}/restore`, {});
  await expect.poll(async () => (await mergeInfo(ownerApi, mergedId)).status, { timeout: 20_000 }).toBe("ok");
  await expect(pg.getByTestId("merge-errors")).toHaveCount(0);
  await expect(pg.getByTestId("merge-status")).toContainText("Đã đồng bộ");
});

test("người được chia sẻ: chỉ xem (kể cả khi được cho quyền Sửa); không tạo, không cấu hình, không đồng bộ; không thấy nguồn", async () => {
  const pg = viewer.page;
  // Shared as "Sửa dữ liệu": still read-only on a merged table.
  await ownerApi.call("PUT", `/datahubs/${hubId}/shares`, { grantee_id: await personId(viewerApi), table_id: mergedId, permission: "edit_data" });
  await pg.goto(`/datahub/${hubId}/${mergedId}`);
  const bar = pg.getByTestId("merge-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByTestId("merge-status")).toContainText("Đã đồng bộ");
  await expect(bar.getByTestId("merge-summary")).toContainText("Gộp 3 bảng");
  await expect(bar.getByTestId("merge-configure")).toHaveCount(0);
  await expect(bar.getByTestId("merge-resync")).toHaveCount(0);
  await expect(pg.getByTestId("add-merged-table")).toHaveCount(0);
  // The names of the sources are not shown to the person (they may not be shared with them).
  await expect(bar).not.toContainText("DH A");
  const info = await mergeInfo(viewerApi, mergedId);
  expect(info.config).toBeNull();
  expect(await statusOf(() => viewerApi.call("POST", `/tables/${mergedId}/rows`, { data: {} }))).toBe(403);
  expect(await statusOf(() => viewerApi.call("POST", `/tables/${mergedId}/merge/sync`, {}))).toBe(403);
  expect(await statusOf(() => viewerApi.call("PUT", `/tables/${mergedId}/merge`, { sources: [srcAId] }))).toBe(403);
  expect(await statusOf(() => viewerApi.call("POST", `/datahubs/${hubId}/merged-tables`, { name: "Của người khác", sources: [srcAId] }))).toBe(403);
  expect((await rowsOf(viewerApi, mergedId)).length).toBeGreaterThan(0);
  await viewer.shot("merge-viewer");
  // A person with no access at all: the datahub is not found.
  expect(await statusOf(() => otherApi.call("POST", `/datahubs/${hubId}/merged-tables`, { name: "Lạ", sources: [srcAId] }))).toBe(404);
  expect(await statusOf(() => otherApi.call("GET", `/tables/${mergedId}/merge`))).toBe(404);
  // A table that is not the owner's cannot be a source, even when it is shared with the owner.
  const theirs = await viewerApi.call<{ id: string }>("POST", "/datahubs", { name: `Của người sửa ${p}` });
  const theirTable = await viewerApi.call<{ id: string }>("POST", `/datahubs/${theirs.id}/tables`, { name: "Của họ" });
  await viewerApi.call("POST", `/tables/${theirTable.id}/columns`, { name: "MST", type: "text" });
  await viewerApi.call("PUT", `/datahubs/${theirs.id}/shares`, { grantee_id: await personId(ownerApi), permission: "view" });
  expect(await statusOf(() => ownerApi.call("POST", `/datahubs/${hubId}/merged-tables`, { name: "Nguồn lạ", sources: [srcAId, theirTable.id] }))).toBe(422);
});

async function personId(api: ApiClient): Promise<string> {
  return (await api.call<{ user: { id: string } }>("GET", "/auth/me")).user.id;
}

test("cấu hình: đổi thứ tự ưu tiên và cách chống trùng, bảng chép lại; chuyển cả cây thì chủ vẫn đọc được", async () => {
  const pg = owner.page;
  await pg.goto(`/datahub/${hubId}/${mergedId}`);
  await pg.getByTestId("merge-configure").click();
  const d = dialog(pg, /^Cấu hình bảng gộp/);
  await expect(d.getByTestId("merge-source")).toHaveCount(3);
  await d.getByTestId("merge-strategy-priority").check();
  await expect(d.getByTestId("merge-summary")).toContainText("loại", { timeout: 20_000 });
  await d.getByTestId("merge-submit").click();
  await expect(dialog(pg, /^Cấu hình bảng gộp/)).toBeHidden();
  await settled(ownerApi, mergedId);
  await expect(pg.getByTestId("merge-bar").getByTestId("merge-status")).toContainText("Đã đồng bộ", { timeout: 20_000 });
  expect((await mergeInfo(ownerApi, mergedId)).status).toBe("ok");
  // "Đồng bộ lại" asks the worker again and the bar goes back to up-to-date.
  await pg.getByTestId("merge-resync").click();
  await toast(pg, "Đã yêu cầu đồng bộ lại");
  await expect(pg.getByTestId("merge-status")).toContainText("Đã đồng bộ", { timeout: 20_000 });
  await owner.shot("merge-configured");
});

test("OpenAPI có đủ endpoint bảng gộp", async () => {
  const res = await fetch(`${API}/api/openapi.json`);
  if (!res.ok) return test.skip(true, "OpenAPI không phục vụ ở môi trường này");
  const doc = (await res.json()) as { paths: Record<string, unknown> };
  for (const path of ["/api/v1/datahubs/{datahub_id}/merged-tables", "/api/v1/tables/{table_id}/merge", "/api/v1/tables/{table_id}/merge/sync", "/api/v1/datahubs/{datahub_id}/merge-preview", "/api/v1/tables/{table_id}/merge/duplicates", "/api/v1/tables/{table_id}/merge/origin/{row_id}"]) {
    expect(Object.keys(doc.paths), path).toContain(path);
  }
});
