import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API, Session, type ProjectName, moreAction } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 4.5B: close a period, compare the commission policy, BANT ready-made filters, the shared period bar, snapshots (Module 4 mục 8, 9, 11, 11a, 12).
 * Every company, account and amount is made up here; no real data. Desktop only. The month closed is October 2026, so the test does not depend on today's date.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-45-${p}-7741`;
const email = (who: string) => `${p}.s45${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const GAMMA = "Gamma Chot Ky";
const DELTA = "Delta Dang Mo";

let admin: ApiClient;
let mgrApi: ApiClient;
let ids: Record<string, string> = {};
let sessions: Session[] = [];
let mgrS: Session;
let leadS: Session;
let u1S: Session;
const tbl: Record<string, string> = {};
let gammaId = "";
let deltaId = "";
let dot1 = "";

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
const rowOf = async (name: string, id: string) => (await rowsOf(mgrApi, tbl[name]!)).find((x) => x._id === id);

/** Edit cells of a deal the way a client does: `base` carries what it read, by column key. */
async function patchDeal(id: string, data: Record<string, unknown>): Promise<void> {
  const t = await mgrApi.call<{ columns: { key: string; name: string }[] }>("GET", `/tables/${tbl["Deals"]}`);
  const raw = (await mgrApi.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${tbl["Deals"]}/rows?limit=500`)).data.find((x) => x.id === id)!;
  const base = Object.fromEntries(Object.keys(data).map((n) => { const k = t.columns.find((c) => c.name === n)!.key; return [k, raw.data[k] ?? null]; }));
  await mgrApi.call("PATCH", `/tables/${tbl["Deals"]}/rows/${id}`, { data, base });
}

async function optionName(table: string, column: string, v: unknown): Promise<string> {
  const t = await mgrApi.call<{ columns: { name: string; config: { options?: { id: string; name: string }[] } }[] }>("GET", `/tables/${tbl[table]}`);
  const o = t.columns.find((c) => c.name === column)?.config.options ?? [];
  const x = Array.isArray(v) ? v[0] : v;
  return o.find((z) => z.id === x || z.name === x)?.name ?? String(x ?? "");
}

/** Lines of the open grid, 0 when the table says no row matches. */
async function lines(page: Page): Promise<number> {
  const g = page.getByTestId("grid");
  if ((await g.count()) === 0) return (await page.getByText("Không có dòng nào khớp").count()) > 0 ? 0 : -1;
  return Number(await g.getAttribute("data-lines"));
}
const expectLines = (page: Page, n: number) => expect.poll(() => lines(page), { timeout: 15_000 }).toBe(n);

async function setPeriod(page: Page, choice: { unit: string; year: number; index?: number }, rule = "related") {
  await page.evaluate(([c, r]) => localStorage.setItem("soe.deal.period", JSON.stringify({ choice: c, rule: r })), [choice, rule] as const);
  await page.reload();
}

async function openTab(page: Page, name: string) {
  await page.goto("/quan-ly-deal");
  await page.getByRole("tab", { name, exact: true }).click();
}

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "4.5B chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  admin = await createAdmin(API, email("admin"), `Admin 45 ${p}`, PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 45 ${p}`, roles: ["manager"] },
      { email: email("lead"), name: `Leader 45 ${p}`, roles: ["leader"], manager: email("mgr") },
      { email: email("u1"), name: `Thành viên Một 45 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
      { email: email("u2"), name: `Thành viên Hai 45 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
    ],
    PASSWORD(),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  const u1Api = await new ApiClient(API).login(email("u1"), PASSWORD());

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
  const people = [{ id: uid("u1"), attrs: { vai_tro: "Leading", ty_le_com: 0.15 } }, { id: uid("u2"), attrs: { vai_tro: "Associate", ty_le_com: 0.05 } }];
  const gamma = await mgrApi.call<{ id: string }>("POST", `/tables/${tbl["Deals"]}/rows`, {
    data: { "Tên công ty": GAMMA, "Loại deal": "POD bán mới", "Start date": "2026-10-02", "Nguồn lead": "ML", "Level BC": "Level 3", "Performance BC": "KPI", "Người tham gia": people },
  });
  gammaId = gamma.id;
  const delta = await mgrApi.call<{ id: string }>("POST", `/tables/${tbl["Deals"]}/rows`, {
    data: { "Tên công ty": DELTA, "Loại deal": "POD bán mới", "Start date": "2026-11-05", "Người tham gia": [{ id: uid("u1"), attrs: { vai_tro: "Leading" } }] },
  });
  deltaId = delta.id;

  // Gamma: two instalments, the first one paid in October (Won, temporary commission). A transfer nobody matched stays in "Tiền về".
  const sched = await mgrApi.call<{ payments: { id: string; seq: number }[] }>("POST", "/deal/payments/schedule", {
    deal_id: gammaId,
    payments: [{ amount: 100000000, due: "2026-10-10" }, { amount: 50000000, due: "2026-11-10" }],
  });
  dot1 = sched.payments.find((x) => x.seq === 1)!.id;
  await mgrApi.call("POST", "/deal/payments/confirm", {
    received_on: "2026-10-15",
    receipt: { amount: 108000000, payer_name: "CONG TY GAMMA CHOT KY", account_no: "0987654321", content: "Gamma thanh toan dot 1" },
    allocations: [{ payment_id: dot1, amount: 100000000, amount_received: 108000000, shortfall: "keep" }],
  });
  await mgrApi.call("POST", `/tables/${tbl["Tiền về"]}/rows`, { data: { "Ngày nhận": "2026-10-20", "Số tiền (gồm VAT)": 5400000, "Tên đơn vị trả": "KHACH LE KHONG RO" } });
  await waitFor(async () => {
    const rows = await rowsOf(mgrApi, tbl["Sổ com"]!);
    return rows.length === 2 && rows.every((r) => typeof r["Com"] === "number" && r["Com"] > 0);
  }, "Sổ com có 2 dòng tính xong");

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

test("User và Leader không thấy màn chốt kỳ", async () => {
  for (const s of [u1S, leadS]) {
    await s.page.goto("/quan-ly-deal");
    await s.page.getByRole("tab", { name: "Deals", exact: true }).click();
    await expect(s.page.getByTestId("period-button"), s.name).toBeVisible(); // the period button is for everyone
    await expect(s.page.getByTestId("open-period-page"), s.name).toHaveCount(0);
    await s.page.goto("/quan-ly-deal/chot-ky");
    await expect(s.page.getByText("Chỉ Manager chốt kỳ"), s.name).toBeVisible();
    await expect(s.page.getByTestId("close-period"), s.name).toHaveCount(0);
  }
});

let last = "";
test("chốt kỳ tháng 10 còn mục tồn: xem com theo người, xác nhận chốt dù còn mục, Sổ com thành Đã chốt", async () => {
  const page = mgrS.page;
  await page.goto("/quan-ly-deal");
  await page.getByTestId("open-period-page").click();
  await expect(page.getByTestId("period-page")).toBeVisible();
  await page.getByTestId("period-month").fill("2026-10");
  await expect(page.getByTestId("period-state")).toHaveText("Đang mở");
  // The transfer nobody matched is listed, with a link to its row.
  await expect(page.getByTestId("period-review").getByText("Tiền về chưa ghép vào đợt nào")).toBeVisible();
  await expect(page.getByTestId("review-item").first()).toBeVisible();
  await expect(page.getByTestId("review-link").first()).toBeVisible();
  // Commission by person: 100tr x 20% x 15% = 3tr and x 5% = 1tr; click a person for the ledger lines.
  await expect(page.getByTestId("com-person")).toHaveCount(2);
  await expect(page.getByTestId("com-total").filter({ hasText: /3\.000\.000/ })).toHaveCount(1);
  await expect(page.getByTestId("com-total").filter({ hasText: /1\.000\.000/ })).toHaveCount(1);
  await page.getByTestId("com-person").first().getByRole("button", { name: "Xem dòng" }).click();
  await expect(page.getByTestId("com-line")).toHaveCount(1);
  await expect(page.getByTestId("com-line").first()).toContainText(GAMMA);

  await page.getByTestId("close-period").click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText("Còn");
  await dlg.getByRole("button", { name: /Chốt dù còn \d+ mục/ }).click();
  await toast(page, "Đã chốt kỳ tháng 10/2026");
  await expect(page.getByTestId("period-state")).toHaveText("Đã chốt");
  await expect(page.getByTestId("period-row")).toHaveCount(1);
  // The XLSX of the commission ledger is made right after closing.
  await expect(page.getByTestId("com-export")).toBeVisible();
  await expect(page.getByTestId("com-export").getByText(/File XLSX đã sẵn sàng/)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("com-export").getByRole("button", { name: "Đóng" }).click();

  await waitFor(async () => {
    const rows = await rowsOf(mgrApi, tbl["Sổ com"]!);
    const names = await Promise.all(rows.map((r) => optionName("Sổ com", "Trạng thái", r["Trạng thái"])));
    last = names.join("|");
    return names.length === 2 && names.every((n) => n === "Đã chốt");
  }, `Sổ com Đã chốt (đang: ${last})`);
  await page.goto("/quan-ly-deal/thanh-toan");
  await page.getByRole("tab", { name: "Sổ com" }).click();
  await page.getByTestId("ledger-all").click();
  await expect(page.getByTestId("ledger-status").first()).toHaveText("Đã chốt");
});

test("sau chốt: huỷ xác nhận đợt đã về và sửa deal đóng trong tháng đều bị chặn", async () => {
  // The instalment was paid on 15 Oct (a closed month): the server refuses to undo it, in words the screen can show as they are.
  await expect(mgrApi.call("POST", "/deal/payments/unconfirm", { payment_ids: [dot1] })).rejects.toThrow(/khoá|chốt/i);
  expect(await rowOf("Đợt thanh toán", dot1)).toBeTruthy();
  // The deal closed in October: its Loại deal (like Status and the closing date) is frozen (the message names the closed period).
  await expect(mgrApi.call("PATCH", `/tables/${tbl["Deals"]}/rows/${gammaId}`, { data: { "Loại deal": "Data" }, base: {} })).rejects.toThrow(/khoá|chốt|kỳ/i);
  // Notes and BANT of that deal stay editable.
  await mgrApi.call("PATCH", `/tables/${tbl["Deals"]}/rows/${gammaId}`, { data: { "Ghi chú": "Ghi chú sau khi chốt" }, base: {} });
});

test("mở lại kỳ có xác nhận và lý do; kỳ trở lại Đang mở", async () => {
  const page = mgrS.page;
  await page.goto("/quan-ly-deal/chot-ky");
  await page.getByTestId("period-month").fill("2026-10");
  await expect(page.getByTestId("period-state")).toHaveText("Đã chốt");
  await page.getByTestId("reopen-period").click();
  await expect(page.getByTestId("reopen-confirm")).toBeDisabled(); // the reason is required
  await page.getByTestId("reopen-reason").fill("Sửa Closing date theo kiểm thử");
  await page.getByTestId("reopen-confirm").click();
  await toast(page, "Đã mở lại kỳ");
  await expect(page.getByTestId("period-state")).toHaveText("Đang mở");
  await expect(page.getByTestId("period-row")).toHaveCount(0);
  // The ledger lines already closed stay closed (reopening does not recalculate them).
  const rows = await rowsOf(mgrApi, tbl["Sổ com"]!);
  const names = await Promise.all(rows.map((r) => optionName("Sổ com", "Trạng thái", r["Trạng thái"])));
  expect(names.every((n) => n === "Đã chốt")).toBe(true);
});

/** The ready-made filters sit in the "Lọc" panel (12H-4): open it when it is closed, then press the row. */
async function quick(page: Page, which: "recheck" | "priority"): Promise<void> {
  const row = page.getByTestId(`quick-${which}`);
  if (!(await row.isVisible())) await page.getByRole("toolbar", { name: "Công cụ view" }).getByRole("button", { name: /^Lọc/ }).click();
  await row.click();
}

test("BANT: đổi một chữ B/A/N/T thì Mức ưu tiên đổi; nút Cần chấm lại hôm nay và Ưu tiên hôm nay lọc đúng", async () => {
  const page = mgrS.page;
  await setPeriod(page, { unit: "quarter", year: 2026, index: 4 });
  await openTab(page, "Deals");
  await expectLines(page, 2);
  // Delta is open and never scored: it is in the recheck queue.
  await quick(page, "recheck");
  await expectLines(page, 1);
  // Scored: Need and Authority have evidence, Budget too -> P1.
  const level = async () => String((await rowOf("Deals", deltaId))?.["Mức ưu tiên"] ?? "");
  await patchDeal(deltaId, { Budget: "Có bằng chứng", Authority: "Có bằng chứng", Need: "Có bằng chứng", Timeline: "Chưa rõ" });
  await waitFor(async () => (await level()).startsWith("P1"), "Mức ưu tiên P1");
  await quick(page, "recheck"); // off
  await quick(page, "priority");
  await expectLines(page, 1); // only the open deal
  await quick(page, "recheck");
  await expectLines(page, 0); // scored just now: out of the recheck queue (both filters on)
  await quick(page, "recheck");
  await quick(page, "priority");
  // One word changes: Authority "Âm" -> P3.
  await patchDeal(deltaId, { Authority: "Âm" });
  await waitFor(async () => (await level()).startsWith("P3"), "Mức ưu tiên P3");
});

test("thanh chọn kỳ: đổi kỳ và cách hiểu thì Deals lọc đúng; Không theo kỳ chung giữ view riêng", async () => {
  const page = mgrS.page;
  await page.goto("/quan-ly-deal");
  await openTab(page, "Deals");
  await expect(page.getByTestId("period-name")).toHaveText(/^Quý [1-4]\/\d{4}$/); // default: this quarter
  await setPeriod(page, { unit: "month", year: 2026, index: 11 }, "received");
  await openTab(page, "Deals");
  await expect(page.getByTestId("period-name")).toHaveText("Tháng 11/2026");
  await expectLines(page, 1); // Delta started on 5 Nov
  await page.getByTestId("period-button").click(); // the panel stays open while the period is stepped
  await page.getByTestId("period-prev").click();
  await expect(page.getByTestId("period-name")).toHaveText("Tháng 10/2026");
  await expectLines(page, 1); // Gamma started on 2 Oct
  await page.getByTestId("period-rule-closed").check();
  await expectLines(page, 1); // Gamma closed on 15 Oct
  await page.getByTestId("period-prev").click();
  await expectLines(page, 0); // nothing closed in September
  // "Toàn bộ thời gian": no period at all, both deals show.
  await page.getByTestId("period-all").click();
  await expect(page.getByTestId("period-name")).toHaveText("Toàn bộ thời gian");
  await expectLines(page, 2);
  await page.getByTestId("period-all").click();
  await expectLines(page, 0);
  // Leave the shared period: the view keeps its own (no) time range and shows both deals; the choice is saved in the view.
  await page.getByTestId("follow-period").uncheck();
  await expectLines(page, 2);
  await expect(page.getByText("Đã lưu view")).toBeVisible();
  await page.reload();
  await page.getByTestId("period-button").click();
  await expect(page.getByTestId("follow-period")).not.toBeChecked();
  await expectLines(page, 2);
  await page.getByTestId("follow-period").check();
  await expectLines(page, 0);
  await page.getByTestId("period-quick-quarter").click();
  await expect(page.getByTestId("period-name")).toHaveText(/^Quý [1-4]\/\d{4}$/);
});

test("Manager chụp snapshot dự báo, xem danh sách và so sánh cuối quý", async () => {
  const page = mgrS.page;
  await page.goto("/quan-ly-deal/chot-ky");
  await page.getByRole("tab", { name: "Snapshot dự báo" }).click();
  await page.getByTestId("snapshot-create").click();
  await toast(page, "Đã chụp");
  await expect(page.getByTestId("snapshot-row")).toHaveCount(1);
  // The new snapshot opens its comparison; the button hides and shows it again.
  await expect(page.getByTestId("snapshot-compare-panel")).toBeVisible();
  await page.getByTestId("snapshot-compare").first().click();
  await expect(page.getByTestId("snapshot-compare-panel")).toHaveCount(0);
  await page.getByTestId("snapshot-compare").first().click();
  await expect(page.getByTestId("snapshot-compare-panel")).toBeVisible();
  await expect(page.getByTestId("accuracy")).toBeVisible();
});

test("so sánh phiên bản chính sách com: dòng đổi, tỉ lệ cũ sang mới, số deal mở bị ảnh hưởng", async () => {
  // A new version from 1 Dec 2026: the ML / Level 3 / KPI rate goes 20% -> 25% (invented numbers).
  await mgrApi.call("POST", `/tables/${tbl["Chính sách com"]}/rows`, { data: { "Hiệu lực từ": "2026-12-01", "Nguồn lead": "ML", Level: "Level 3", Performance: "KPI", "Tỉ lệ": 0.25 } });
  const page = mgrS.page;
  await openTab(page, "Chính sách com");
  await moreAction(page, "So sánh phiên bản"); // since 12C the action lives in the "•••" menu
  const dlg = page.getByTestId("policy-diff");
  await expect(dlg.getByTestId("policy-diff-row")).toHaveCount(1);
  await expect(dlg.getByTestId("policy-diff-row")).toContainText("Đổi");
  await expect(dlg.getByTestId("policy-diff-row")).toContainText("20%");
  await expect(dlg.getByTestId("policy-diff-row")).toContainText("25%");
  await expect(dlg.getByTestId("policy-diff-affected")).toContainText("deal đang mở bị ảnh hưởng");
  // Members do not see the button.
  await openTab(u1S.page, "Chính sách com").catch(() => undefined);
  await expect(u1S.page.getByRole("button", { name: "So sánh phiên bản" })).toHaveCount(0);
});
