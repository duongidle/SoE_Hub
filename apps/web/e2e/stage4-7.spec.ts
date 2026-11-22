import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
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
  sessions = [mgrS];
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
