import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 4.4B: the payment screens (Module 4 mục 7.7, 16). Schedule 3 instalments, match and confirm the first (deal Won, commission rows with the right %),
 * a short payment splits the instalment, undo a confirmation, members see no write button, Won cannot be picked by hand.
 * The company, the bank account and every amount are made up here; no real data. Desktop only.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-44-${p}-5531`;
const email = (who: string) => `${p}.s44${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const COMPANY = "Alpha Zeta Logistics";

let admin: ApiClient;
let mgrApi: ApiClient;
let u1Api: ApiClient;
let ids: Record<string, string> = {};
let sessions: Session[] = [];
let mgrS: Session;
let leadS: Session;
let u1S: Session;
const tbl: Record<string, string> = {};
let dealId = "";

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

/** The rows of a table with column NAMES as keys (cells as stored). */
async function rowsOf(api: ApiClient, tableId: string): Promise<Record<string, unknown>[]> {
  const t = await api.call<{ columns: { key: string; name: string }[] }>("GET", `/tables/${tableId}`);
  const r = await api.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${tableId}/rows?limit=500`);
  const nm = new Map(t.columns.map((c) => [c.key, c.name]));
  return r.data.map((x) => ({ _id: x.id, ...Object.fromEntries(Object.entries(x.data).map(([k, v]) => [nm.get(k) ?? k, v])) }));
}

const dealStatus = async () => {
  const r = (await rowsOf(mgrApi, tbl["Deals"]!)).find((x) => x._id === dealId)!;
  const opts = (await mgrApi.call<{ columns: { name: string; config: { options?: { id: string; name: string }[] } }[] }>("GET", `/tables/${tbl["Deals"]}`)).columns.find((c) => c.name === "Status")!.config.options ?? [];
  const v = r["Status"];
  return opts.find((o) => o.id === v || o.name === v)?.name ?? String(v);
};

async function openPayments(s: Session): Promise<void> {
  await s.page.goto("/quan-ly-deal/thanh-toan");
  await expect(s.page.getByTestId("payments-page")).toBeVisible();
}

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "4.4B chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  admin = await createAdmin(API, email("admin"), `Admin 44 ${p}`, PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 44 ${p}`, roles: ["manager"] },
      { email: email("lead"), name: `Leader 44 ${p}`, roles: ["leader"], manager: email("mgr") },
      { email: email("u1"), name: `Thành viên Một 44 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
      { email: email("u2"), name: `Thành viên Hai 44 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
    ],
    PASSWORD(),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  u1Api = await new ApiClient(API).login(email("u1"), PASSWORD());

  // The worker builds the default set (with the payment tables) after the Manager joins the org chart.
  await waitFor(async () => {
    const list = await mgrApi.call<{ name: string; master_table_id: string }[]>("GET", "/datahub/templates");
    for (const n of ["Deals", "Đợt thanh toán", "Tiền về", "Sổ com", "Chính sách com"]) {
      const t = list.find((x) => x.name === n);
      if (!t) return false;
      tbl[n] = t.master_table_id;
    }
    return true;
  }, "bộ bảng mặc định có các bảng thanh toán");
  await waitFor(async () => (await u1Api.call<{ tables: { role_set: string | null }[] }>("GET", "/datahub/deal-home")).tables.some((t) => t.role_set === "payments"), "bảng Đợt thanh toán tới thành viên");
  // An invented policy: ML, Level 3, KPI = 20%.
  await mgrApi.call("POST", `/tables/${tbl["Chính sách com"]}/rows`, { data: { "Hiệu lực từ": "2026-01-01", "Nguồn lead": "ML", Level: "Level 3", Performance: "KPI", "Tỉ lệ": 0.2 } });
  const row = await mgrApi.call<{ id: string }>("POST", `/tables/${tbl["Deals"]}/rows`, {
    data: {
      "Tên công ty": COMPANY,
      "Loại deal": "POD bán mới",
      "Start date": "2026-11-02",
      "Nguồn lead": "ML",
      "Level BC": "Level 3",
      "Performance BC": "KPI",
      "Người tham gia": [{ id: uid("u1"), attrs: { vai_tro: "Leading", ty_le_com: 0.15 } }, { id: uid("u2"), attrs: { vai_tro: "Associate", ty_le_com: 0.05 } }],
    },
  });
  dealId = row.id;

  mgrS = await Session.open(browser, p, "mgr").then((x) => x.allow(400, /\/api\/v1\//));
  leadS = await Session.open(browser, p, "lead");
  u1S = await Session.open(browser, p, "u1");
  sessions = [mgrS, leadS, u1S];
  for (const [s, who] of [[mgrS, "mgr"], [leadS, "lead"], [u1S, "u1"]] as const) {
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

test("Manager lập lịch 3 đợt cho một deal", async () => {
  const page = mgrS.page;
  await openPayments(mgrS);
  await page.getByTestId("open-schedule").click();
  await page.getByTestId("deal-search").fill("Alpha Zeta");
  await page.getByTestId("deal-option").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("sched-save")).toBeVisible();
  const plan = [["100000000", "2026-12-05"], ["50000000", "2026-12-20"], ["50000000", "2027-01-10"]];
  for (const [i, [amount, due]] of plan.entries()) {
    await dialog.getByTestId("sched-add").click();
    const row = dialog.getByTestId("sched-row").nth(i);
    await row.getByLabel("Số tiền").fill(amount!);
    await row.getByLabel("Hạn").fill(due!);
  }
  await dialog.getByTestId("sched-save").click();
  await toast(page, "Đã lưu lịch: 3 đợt");
  await expect(page.getByTestId("dot-row")).toHaveCount(3);
  await expect(page.getByTestId("dot-row").first()).toContainText(COMPANY);
});

test("Ghép tiền về: nhập UNC, gợi ý kèm lý do, xác nhận đợt 1 thì deal Won và Sổ com có dòng tạm tính đúng %", async () => {
  const page = mgrS.page;
  await openPayments(mgrS);
  await page.getByRole("tab", { name: "Ghép tiền về" }).click();
  await page.getByTestId("m-amount").fill("108000000"); // 100tr + VAT 8%
  await page.getByTestId("m-payer").fill("CONG TY ALPHA ZETA LOGISTICS");
  await page.getByTestId("m-account").fill("0123456789");
  await page.getByTestId("m-content").fill("Alpha Zeta thanh toan dot 1");
  await page.getByTestId("m-find").click();
  const cand = page.getByTestId("m-candidates").locator("label").filter({ hasText: "đợt 1" });
  await expect(cand).toBeVisible();
  await expect(cand).toContainText("108tr = 100tr + VAT 8%"); // the reasons are shown
  await cand.getByTestId("m-cand").check();
  const alloc = page.getByTestId("m-alloc-row").first();
  await expect(alloc.getByLabel("Số tiền chưa VAT")).toHaveValue("100000000");
  await expect(alloc.getByLabel("Số tiền nhận")).toHaveValue("108000000");
  await page.getByTestId("m-confirm").click();
  await toast(page, "Đã xác nhận");
  await waitFor(async () => (await dealStatus()) === "Won", "deal sang Won");
  // Commission rows: 100tr x 20% policy x 15% / 5% (temporary).
  const led = await waitFor(async () => {
    const rows = await rowsOf(mgrApi, tbl["Sổ com"]!);
    return rows.length === 2 && rows.every((r) => typeof r["Com"] === "number" && r["Com"] > 0) ? rows : null;
  }, "Sổ com có 2 dòng tính xong");
  expect(led.map((r) => r["Com"]).sort()).toEqual([1000000, 3000000]);
  await page.getByRole("tab", { name: "Sổ com" }).click();
  await page.getByTestId("ledger-all").click();
  await expect(page.getByTestId("ledger-row")).toHaveCount(2);
  await expect(page.getByTestId("ledger-status").first()).toHaveText("Tạm tính");
  await expect(page.getByTestId("ledger-com").filter({ hasText: /3\.000\.000/ })).toHaveCount(1);
});

test("Về thiếu: đợt 2 chỉ về một phần thì phần còn thiếu tách thành đợt mới; huỷ xác nhận đợt 1 gỡ com tạm tính", async () => {
  const page = mgrS.page;
  await openPayments(mgrS);
  await expect(page.getByTestId("dot-row")).toHaveCount(2); // đợt 2, 3 still wait
  await page.getByRole("tab", { name: "Ghép tiền về" }).click();
  await page.getByTestId("m-amount").fill("27000000");
  await page.getByTestId("m-payer").fill("CONG TY ALPHA ZETA LOGISTICS");
  await page.getByTestId("m-account").fill("0123456789");
  await page.getByTestId("m-content").fill("Alpha Zeta thanh toan dot 2");
  await page.getByTestId("m-find").click();
  const cand = page.getByTestId("m-candidates").locator("label").filter({ hasText: "đợt 2" });
  await expect(cand).toBeVisible();
  await cand.getByTestId("m-cand").check();
  const alloc = page.getByTestId("m-alloc-row").first();
  await alloc.getByLabel("Số tiền chưa VAT").fill("25000000");
  await alloc.getByLabel("Số tiền nhận").fill("27000000");
  await expect(page.getByTestId("m-sum")).not.toContainText("phải bằng nhau");
  await page.getByTestId("m-confirm").click();
  await toast(page, "Đã xác nhận");
  await page.getByRole("tab", { name: "Đợt thanh toán" }).click();
  // Waiting now: đợt 3 and the remainder split off from đợt 2.
  await expect(page.getByTestId("dot-row")).toHaveCount(2);
  await page.getByTestId("dot-view-month").click();
  await expect(page.getByTestId("dot-row")).toHaveCount(2);
  // shortfall "split": the instalment keeps what came in (25tr) and counts as paid; the remainder is a new instalment.
  await expect(page.getByTestId("dot-status").filter({ hasText: "Đã về" })).toHaveCount(2);
  // Undo the first instalment.
  await page.getByTestId("dot-row").filter({ hasText: "Đã về" }).first().getByTestId("unconfirm").click();
  await page.getByRole("dialog").getByRole("button", { name: "Huỷ xác nhận" }).click();
  await toast(page, "Đã huỷ xác nhận");
  await expect(page.getByTestId("dot-row")).toHaveCount(1);
  await waitFor(async () => (await rowsOf(mgrApi, tbl["Sổ com"]!)).length === 2, "com tạm tính của đợt 1 đã gỡ (còn 2 dòng của đợt 2)");
});

test("Manager điều chỉnh com kèm lý do; dòng điều chỉnh hiện ở Sổ com", async () => {
  const page = mgrS.page;
  await openPayments(mgrS);
  await page.getByRole("tab", { name: "Sổ com" }).click();
  await page.getByTestId("ledger-all").click();
  await page.getByTestId("ledger-row").first().getByTestId("adjust").click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByTestId("adj-save")).toBeDisabled(); // the reason is required
  await dlg.getByTestId("adj-amount").fill("-200000");
  await dlg.getByTestId("adj-reason").fill("Giảm theo thoả thuận kiểm thử");
  await dlg.getByTestId("adj-save").click();
  await toast(page, "Đã ghi điều chỉnh com");
  await expect(page.getByTestId("ledger-status").filter({ hasText: "Điều chỉnh" })).toHaveCount(1);
});

test("ngăn chi tiết deal hiện các đợt kèm trạng thái và com của tôi từng đợt (thành viên chỉ đọc)", async () => {
  const page = u1S.page;
  await page.goto("/quan-ly-deal");
  await page.getByRole("tab", { name: "Deals", exact: true }).click();
  const { GridDriver } = await import("./grid");
  await expect(page.getByTestId("grid")).toBeVisible();
  const g = new GridDriver(page);
  await expect.poll(async () => Number(await g.root.getAttribute("data-lines"))).toBeGreaterThan(0);
  await g.click(1, 0);
  await page.keyboard.press("Shift+Space");
  const panel = page.getByTestId("deal-payments");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("panel-dot")).toHaveCount(4); // 3 planned + the remainder split off
  await expect(panel.getByTestId("panel-schedule")).toHaveCount(0);
  await expect(panel.getByTestId("panel-com").filter({ hasText: /Com của tôi \d/ }).first()).toBeVisible();
});

test("User và Leader xem được đợt và Sổ com nhưng không có nút ghi", async () => {
  for (const s of [u1S, leadS]) {
    await openPayments(s);
    await expect(s.page.getByTestId("open-schedule"), s.name).toHaveCount(0);
    await expect(s.page.getByRole("tab", { name: "Ghép tiền về" }), s.name).toHaveCount(0);
    await expect(s.page.getByTestId("unconfirm"), s.name).toHaveCount(0);
    await s.page.getByTestId("dot-view-month").click();
    await expect(s.page.getByTestId("dot-row").first(), s.name).toBeVisible();
    await s.page.getByRole("tab", { name: "Sổ com" }).click();
    await expect(s.page.getByTestId("adjust"), s.name).toHaveCount(0);
  }
  // "Com của tôi": UserA1 reads only their own row.
  await u1S.page.getByTestId("ledger-mine").click();
  await expect(u1S.page.getByTestId("ledger-row").first()).toBeVisible();
});

test("chọn Won bằng tay bị từ chối với câu dễ hiểu", async () => {
  const fresh = await mgrApi.call<{ id: string }>("POST", `/tables/${tbl["Deals"]}/rows`, {
    data: { "Tên công ty": "Beta Won Tay", "Loại deal": "POD bán mới", "Start date": "2026-11-03", "Người tham gia": [{ id: uid("u1"), attrs: { vai_tro: "Leading" } }] },
  });
  await expect(mgrApi.call("PATCH", `/tables/${tbl["Deals"]}/rows/${fresh.id}`, { data: { Status: "Won" }, base: {} })).rejects.toThrow(/Won/);
});
