import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { GridDriver } from "./grid";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 4.7B: screens of the 4.7 changes. B1: "Xác nhận rồi chốt" on the period screen (instalments an import brought in with a received date but no
 * confirmation) and the Template page with a role held by several columns. Every company, account and amount is made up; no real data. Desktop only.
 * Each part has its own `describe`; the setup (people, tables) is shared at file level.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-47-${p}-6619`;
const email = (who: string) => `${p}.s47${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");

let admin: ApiClient;
let mgrApi: ApiClient;
let ids: Record<string, string> = {};
let sessions: Session[] = [];
let mgrS: Session;
let guestS: Session;
const tbl: Record<string, string> = {};
let dealsTemplateId = "";

const uid = (who: string) => ids[email(who)]!;
const toast = (page: Page, text: string | RegExp) => expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible();

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, what: string): Promise<T> {
  let last = "";
  for (let i = 0; i < 60; i++) {
    const v = await fn().catch((e: Error) => ((last = e.message), null));
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Hết giờ chờ: ${what}. ${last}`);
}

/** Edit cells of a row the way a client does: `base` carries what it read, by column key. */
async function patchRow(table: string, id: string, data: Record<string, unknown>): Promise<void> {
  const t = await mgrApi.call<{ columns: { key: string; name: string }[] }>("GET", `/tables/${tbl[table]}`);
  const raw = (await mgrApi.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${tbl[table]}/rows?limit=500`)).data.find((x) => x.id === id)!;
  const base = Object.fromEntries(Object.keys(data).map((n) => { const k = t.columns.find((c) => c.name === n)!.key; return [k, raw.data[k] ?? null]; }));
  await mgrApi.call("PATCH", `/tables/${tbl[table]}/rows/${id}`, { data, base });
}

/** A deal with one instalment an import would bring in: a received date and amount, no confirmation. */
async function importedInstalment(company: string, start: string, due: string, receivedOn: string): Promise<void> {
  const deal = await mgrApi.call<{ id: string }>("POST", `/tables/${tbl["Deals"]}/rows`, {
    data: { "Tên công ty": company, "Loại deal": "POD bán mới", "Start date": start, "Người tham gia": [{ id: uid("u1"), attrs: { vai_tro: "Leading", ty_le_com: 0.1 } }] },
  });
  const s = await mgrApi.call<{ payments: { id: string }[] }>("POST", "/deal/payments/schedule", { deal_id: deal.id, payments: [{ amount: 20000000, due }] });
  await patchRow("Đợt thanh toán", s.payments[0]!.id, { "Ngày tiền về": receivedOn, "Số tiền về (chưa VAT)": 20000000 });
}

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "4.7B chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  admin = await createAdmin(API, email("admin"), `Admin 47 ${p}`, PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 47 ${p}`, roles: ["manager"] },
      { email: email("lead"), name: `Leader 47 ${p}`, roles: ["leader"], manager: email("mgr") },
      { email: email("u1"), name: `Thành viên Một 47 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
      { email: email("guest"), name: `Guest 47 ${p}`, roles: ["guest"], manager: email("mgr"), guestPreset: "data" },
    ],
    PASSWORD(),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  await waitFor(async () => {
    const list = await mgrApi.call<{ id: string; name: string; master_table_id: string }[]>("GET", "/datahub/templates");
    for (const n of ["Deals", "Đợt thanh toán", "Tiền về", "Sổ com"]) {
      const t = list.find((x) => x.name === n);
      if (!t) return false;
      tbl[n] = t.master_table_id;
      if (n === "Deals") dealsTemplateId = t.id;
    }
    return true;
  }, "bộ bảng mặc định có các bảng thanh toán");
  mgrS = await Session.open(browser, p, "mgr").then((x) => x.allow(400, /\/api\/v1\//));
  guestS = await Session.open(browser, p, "guest").then((x) => x.allow(403, /\/api\/v1\//).allow(404, /\/api\/v1\//));
  sessions = [mgrS, guestS];
  await guestS.login(email("guest"), PASSWORD());
  await mgrS.login(email("mgr"), PASSWORD());
  await expect(mgrS.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
});

test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

test.describe("4.7B1 Chốt kỳ: xác nhận đợt import rồi chốt", () => {
  test("đợt có ngày tiền về mà chưa xác nhận được liệt kê; Xác nhận rồi chốt tạo Tiền về, Won, Sổ com và chốt kỳ", async () => {
    await importedInstalment("Epsilon Import 47", "2026-09-02", "2026-09-10", "2026-09-12");
    const page = mgrS.page;
    await page.goto("/quan-ly-deal/chot-ky");
    await page.getByTestId("period-month").fill("2026-09");
    await expect(page.getByTestId("period-state")).toHaveText("Đang mở");
    const review = page.getByTestId("period-review");
    await expect(review.getByText(/Đợt đã có ngày hoặc số tiền về nhưng chưa xác nhận/)).toBeVisible();
    await expect(review.getByTestId("review-item").filter({ hasText: "Epsilon Import 47" })).toBeVisible();
    await page.getByTestId("confirm-and-close").click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toContainText("Xác nhận 1 đợt");
    await dlg.getByRole("button", { name: "Xác nhận rồi chốt" }).click();
    await toast(page, "Đã xác nhận 1 đợt và chốt kỳ tháng 9/2026");
    await expect(page.getByTestId("period-state")).toHaveText("Đã chốt", { timeout: 30_000 });
    const result = page.getByTestId("confirm-result");
    await expect(result).toContainText("Đã xác nhận 1 đợt");
    await expect(result).toContainText("1 deal chuyển Won");
    await expect(result).toContainText("1 dòng Sổ com mới");
    await expect(page.getByTestId("confirm-and-close")).toHaveCount(0);
    // The server made the rows: a linked receipt, a ledger line closed with the period.
    const rows = await mgrApi.raw<{ data: { data: Record<string, unknown> }[] }>(`/tables/${tbl["Tiền về"]}/rows?limit=50`);
    expect(rows.data.length).toBeGreaterThanOrEqual(1);
    const ledger = await mgrApi.raw<{ data: unknown[] }>(`/tables/${tbl["Sổ com"]}/rows?limit=50`);
    expect(ledger.data.length).toBe(1);
  });

  test("kỳ bị chốt ở nơi khác trong lúc màn đang mở: bấm Xác nhận rồi chốt hiện câu dễ hiểu", async () => {
    await importedInstalment("Zeta Import 47", "2026-08-03", "2026-08-10", "2026-08-12");
    const page = mgrS.page;
    await page.goto("/quan-ly-deal/chot-ky");
    await page.getByTestId("period-month").fill("2026-08");
    await expect(page.getByTestId("confirm-and-close")).toBeVisible();
    // Someone else confirms and closes the month through the API meanwhile.
    await mgrApi.call("POST", "/deal/periods/confirm-received", { month: "2026-08" });
    await waitFor(async () => {
      try { await mgrApi.call("POST", "/deal/periods/close", { month: "2026-08", close_anyway: true }); return true; } catch { return false; }
    }, "chốt kỳ 8/2026 qua API");
    mgrS.allow(409, /\/deal\/periods\/confirm-received/); // the refusal this test provokes
    await page.getByTestId("confirm-and-close").click();
    await page.getByRole("dialog").getByRole("button", { name: "Xác nhận rồi chốt" }).click();
    await expect(page.getByText(/đã được chốt rồi/)).toBeVisible();
    await expect(page.getByTestId("confirm-result")).toHaveCount(0);
  });
});

test.describe("4.7B1 Template: vai trò nhiều cột", () => {
  test("Người tham gia giữ bởi hai cột: cả hai cột có nhãn vai trò, ô chọn vai trò liệt kê mọi cột giữ vai trò đó", async () => {
    for (const name of ["Leading 47", "Associate 47"]) {
      await mgrApi.call("POST", `/datahub/templates/${dealsTemplateId}/columns`, { name, type: "user", layer: "basic", storage: "shared", role: "nguoi_tham_gia" });
    }
    const detail = await mgrApi.call<{ roles: { key: string; columns: string[]; multi: boolean }[] }>("GET", `/datahub/templates/${dealsTemplateId}`);
    const role = detail.roles.find((r) => r.key === "nguoi_tham_gia")!;
    expect(role.multi).toBe(true);
    expect(role.columns.length).toBe(3);

    const page = mgrS.page;
    await page.goto(`/quan-ly-deal/template?template=${dealsTemplateId}`);
    const panel = page.getByTestId("template-panel");
    for (const name of ["Người tham gia", "Leading 47", "Associate 47"]) {
      await expect(panel.getByTestId("template-column").filter({ hasText: name }).first().getByTestId("role-badge")).toHaveText(/Vai trò: Người tham gia/);
    }
    await expect(panel.getByTestId("role-badge").filter({ hasText: "Vai trò: Người tham gia" })).toHaveCount(3);
    // The role dialog of one of them names the other holders and says nobody lets go.
    await panel.getByRole("button", { name: "Vai trò của cột Leading 47" }).click();
    const d = page.getByRole("dialog", { name: /Vai trò của cột "Leading 47"/ });
    const option = d.getByRole("option", { name: /Người tham gia/ });
    await expect(option).toContainText("đang gắn cho cột");
    await expect(option).toContainText("Associate 47");
    await expect(option).not.toContainText("Leading 47");
    await expect(d.getByTestId("role-multi-note")).toContainText("Associate 47");
    await expect(d.getByTestId("role-multi-note")).toContainText("Leading 47");
  });
});

test.describe("4.7B2 Import: cột Người và Liên kết", () => {
  let dhId = "";
  let projId = "";
  let custId = "";
  const keys: Record<string, string> = {};

  test.beforeAll(async () => {
    dhId = (await mgrApi.call<{ id: string }>("POST", "/datahubs", { name: `Import 47 ${p}` })).id;
    custId = (await mgrApi.call<{ id: string }>("POST", `/datahubs/${dhId}/tables`, { name: "Khách 47" })).id;
    keys["Mã KH"] = (await mgrApi.call<{ key: string }>("POST", `/tables/${custId}/columns`, { name: "Mã KH", type: "text", unique: true })).key;
    keys["Tên KH"] = (await mgrApi.call<{ key: string }>("POST", `/tables/${custId}/columns`, { name: "Tên KH", type: "text" })).key;
    await mgrApi.call("POST", `/tables/${custId}/rows`, { data: { "Mã KH": "KH1", "Tên KH": "Khách Một" } });
    projId = (await mgrApi.call<{ id: string }>("POST", `/datahubs/${dhId}/tables`, { name: "Dự án 47" })).id;
    await mgrApi.call("POST", `/tables/${projId}/columns`, { name: "Tên dự án", type: "text" });
    await mgrApi.call("POST", `/tables/${projId}/columns`, { name: "Phụ trách", type: "user" });
    await mgrApi.call("POST", `/tables/${projId}/columns`, { name: "Khách", type: "relation", config: { target_table_id: custId } });
  });

  async function openImport(text: string) {
    const page = mgrS.page;
    await page.goto(`/datahub/${dhId}/${projId}`);
    await page.getByRole("button", { name: "Nhập", exact: true }).click();
    const d = page.getByRole("dialog", { name: "Nhập dữ liệu" });
    await d.getByRole("tab", { name: "Dán dữ liệu" }).click();
    await d.getByLabel("Dữ liệu dán").fill(text);
    await d.getByRole("button", { name: "Đọc dữ liệu" }).click();
    await d.getByRole("button", { name: "Ghép cột" }).click();
    await expect(d.getByLabel("Bảng có sẵn")).toHaveValue(projId);
    return d;
  }

  test("cột Người và Liên kết chọn được khi ghép cột; xem trước báo email lạ và liên kết không khớp đúng dòng", async () => {
    const d = await openImport(["Tên dự án\tPhụ trách\tKhách", `DA1\t${email("u1")}\tKH1`, "DA2\tnguoila@base.vn\tKH1", `DA3\t${email("u1")}\tKH-LA`].join("\n"));
    // The two columns of the table with the same header are mapped to the table's Người dùng and Liên kết columns.
    await expect(d.getByLabel("Cột của bảng cho cột B")).not.toHaveValue("");
    await expect(d.getByLabel("Cột của bảng cho cột C")).not.toHaveValue("");
    await expect(d.getByLabel("Cột tìm dòng liên kết cho cột C")).toBeVisible();
    await d.getByRole("button", { name: "Kiểm tra" }).click();
    const issues = d.getByTestId("import-issues");
    await expect(issues).toContainText("Dòng 3");
    await expect(issues).toContainText("nguoila@base.vn");
    await expect(issues).toContainText("Dòng 4");
    await d.getByRole("button", { name: "Bắt đầu nhập" }).click();
    await expect(d.getByTestId("import-result")).toContainText("Đã nhập xong", { timeout: 30_000 });
    await expect(d.getByTestId("import-result")).toContainText("Thêm 1");
    const rows = await mgrApi.raw<{ data: { data: Record<string, unknown> }[] }>(`/tables/${projId}/rows?limit=50`);
    expect(rows.data.length).toBe(1);
    expect(JSON.stringify(rows.data[0]!.data)).toContain(uid("u1"));
  });

  test("ô link_by: chọn cột khác của bảng đích để tìm dòng liên kết", async () => {
    const d = await openImport(["Tên dự án\tKhách", "DA4\tKhách Một"].join("\n"));
    await d.getByLabel("Cột tìm dòng liên kết cho cột B").selectOption({ label: "Tìm theo cột Tên KH" });
    await d.getByRole("button", { name: "Kiểm tra" }).click();
    await expect(d.getByTestId("import-report-sheet")).toBeVisible();
    await expect(d.getByTestId("import-issues")).toHaveCount(0);
    await d.getByRole("button", { name: "Bắt đầu nhập" }).click();
    await expect(d.getByTestId("import-result")).toContainText("Đã nhập xong", { timeout: 30_000 });
    const rows = await mgrApi.raw<{ data: { data: Record<string, unknown> }[] }>(`/tables/${projId}/rows?limit=50`);
    expect(rows.data.length).toBe(2);
  });
});

test.describe("4.7B2 Guest bảng", () => {
  let dhId = "";
  let tId = "";

  test.beforeAll(async () => {
    dhId = (await mgrApi.call<{ id: string }>("POST", "/datahubs", { name: `Guest 47 ${p}` })).id;
    tId = (await mgrApi.call<{ id: string }>("POST", `/datahubs/${dhId}/tables`, { name: "Báo giá 47" })).id;
    for (const [name, type] of [["Công ty", "text"], ["Giá", "currency"], ["Ghi chú nội bộ", "text"]] as const) await mgrApi.call("POST", `/tables/${tId}/columns`, { name, type });
    await mgrApi.call("POST", `/tables/${tId}/rows`, { data: { "Công ty": "Alpha 47", "Giá": 5000000, "Ghi chú nội bộ": "bí mật" } });
  });

  test("Manager cấp bảng với hai cột; Guest chỉ thấy hai cột đó và không có ô tìm kiếm", async () => {
    const page = mgrS.page;
    await page.goto("/cap-du-lieu");
    await page.getByRole("button", { name: "Cấp dữ liệu" }).click();
    const d = page.getByRole("dialog", { name: "Cấp dữ liệu cho Guest" });
    await d.getByLabel("Guest").selectOption({ label: `Guest 47 ${p} (${email("guest")})` });
    await d.getByLabel("Dữ liệu", { exact: true }).selectOption({ label: "Bảng Datahub (chọn cột được thấy)" });
    await expect(d.getByRole("button", { name: "Cấp", exact: true })).toBeDisabled();
    await d.getByLabel("Datahub", { exact: true }).selectOption({ label: `Guest 47 ${p}` });
    await d.getByLabel("Bảng được cấp").selectOption({ label: "Báo giá 47" });
    const cols = d.getByTestId("grant-columns");
    await cols.getByLabel("Công ty").check();
    await cols.getByLabel("Giá").check();
    await d.getByLabel("Xem trên web").check();
    await d.getByRole("button", { name: "Cấp", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "Bảng Datahub" }).first()).toBeVisible();

    const gp = guestS.page;
    await gp.goto("/du-lieu-duoc-cap");
    await gp.getByTestId("guest-table").first().click();
    await expect(gp.getByTestId("guest-table-name")).toHaveText("Báo giá 47");
    const grid = new GridDriver(gp);
    await expect(grid.root).toBeVisible();
    await expect.poll(async () => JSON.parse((await grid.root.getAttribute("data-widths")) ?? "[]").length).toBe(2);
    await expect.poll(() => grid.read(0, 0), { timeout: 15_000 }).toBe("Alpha 47");
    await expect(gp.getByLabel("Tìm trong bảng")).toHaveCount(0);
    await expect(gp.getByText("bí mật")).toHaveCount(0);
    // The server agrees: a search is refused, and the column that was not granted is not in the answer.
    const guestApi = await new ApiClient(API).login(email("guest"), PASSWORD());
    const rows = await guestApi.raw<{ data: { data: Record<string, unknown> }[] }>(`/tables/${tId}/rows?limit=10`);
    expect(JSON.stringify(rows.data)).not.toContain("bí mật");
    await guestS.shot("guest-bang-duoc-cap");
  });

  test("Guest tìm kiếm bị server từ chối: câu dễ hiểu, không lộ dòng", async () => {
    const guestApi = await new ApiClient(API).login(email("guest"), PASSWORD());
    await expect(guestApi.raw(`/tables/${tId}/rows?limit=10&search=bi`)).rejects.toThrow(/guest_search|tìm kiếm/);
  });
});
