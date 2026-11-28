import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 12D-2: the screens of Quản lý Deal in the new look (period bar with its own label, KPI and forecast blocks, template two-column page,
 * payments, period close) and the shortcut from a deal row to its payments. Pictures at desktop and 375px; no horizontal overflow on a phone.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-12d2-${p}-8842`;
const RUN = Date.now().toString(36);
const email = (who: string) => `${p}.d${who}${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const SHOTS = process.env.DEAL_SHOTS ?? path.join(process.cwd(), "e2e/results/stage12d2");

let mgr: Session;
let phone: Session;
let sessions: Session[] = [];
let dealsTableId = "";
let dealRowId = "";
let mgrApi: ApiClient;

const shot = async (s: Session, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.page.screenshot({ path: path.join(SHOTS, `${s.project}-${name}.png`), fullPage: false });
};

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "12D-2 mở cả hai cỡ trong cùng bài test ở desktop");
  const adm = await createAdmin(API, email("admin"), `Admin 12D2 ${RUN}`, PASSWORD(), ROOT);
  const ids = await seedPeople(
    API,
    adm,
    [
      { email: email("mgr"), name: `Manager 12D2 ${RUN}`, roles: ["manager"] },
      { email: email("u1"), name: `Thành viên Một ${RUN}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  let deals: { id: string; name: string; master_table_id: string } | undefined;
  for (let i = 0; i < 60 && !deals; i++) {
    deals = (await mgrApi.call<{ id: string; name: string; master_table_id: string }[]>("GET", "/datahub/templates")).find((t) => t.name === "Deals");
    if (!deals) await new Promise((r) => setTimeout(r, 500));
  }
  dealsTableId = deals!.master_table_id;
  for (const [i, type] of ["POD bán mới", "PS không kèm POD", "POD bán mới"].entries()) {
    const created = await mgrApi.call<{ id: string }>("POST", `/tables/${dealsTableId}/rows`, {
      data: { "Tên công ty": `Công ty thử ${i + 1}`, "Loại deal": type, "Start date": `2026-11-0${i + 2}`, "Người tham gia": [{ id: ids[email("u1")]!, attrs: { vai_tro: "Leading" } }] },
    });
    if (i === 0) dealRowId = created.id;
  }
  mgr = await Session.open(browser, "desktop", "mgr");
  phone = await Session.open(browser, "phone", "mgr-phone");
  sessions = [mgr, phone];
  for (const s of sessions) {
    await s.login(email("mgr"), PASSWORD());
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

for (const [name, url, ready] of [
  ["home", "/quan-ly-deal", "Doanh thu theo người"],
  ["dashboard", "/quan-ly-deal/dashboard", "Forecast của team trong kỳ"],
  ["template", "/quan-ly-deal/template", ""],
  ["payments", "/quan-ly-deal/thanh-toan", ""],
  ["period", "/quan-ly-deal/chot-ky", ""],
] as const) {
  test(`màn ${name}: ảnh desktop và 375px, không tràn ngang`, async () => {
    for (const s of sessions) {
      await s.page.goto(url);
      await s.page.waitForLoadState("networkidle");
      if (ready) await expect(s.page.getByText(ready).first()).toBeVisible();
      await s.page.waitForTimeout(800);
      await s.expectNoHorizontalOverflow();
      await shot(s, name);
    }
  });
}

test("nút kỳ trên thanh công cụ: bảng nhỏ nói lọc theo cột nào, Toàn bộ thời gian, đổi cách hiểu thì đổi dòng nói", async () => {
  const pg = mgr.page;
  await pg.goto("/quan-ly-deal");
  await pg.getByRole("tab", { name: "Deals", exact: true }).click();
  // One button on the toolbar; the panel is closed until it is pressed.
  await expect(pg.getByTestId("shared-period")).toHaveCount(0);
  await expect(pg.getByTestId("period-name")).toHaveText(/^Quý [1-4]\/\d{4}$/);
  await pg.getByTestId("period-button").click();
  await expect(pg.getByTestId("period-rule-related")).toBeChecked();
  await pg.getByTestId("period-all").click();
  await expect(pg.getByTestId("period-name")).toHaveText("Toàn bộ thời gian");
  await expect(pg.getByTestId("period-sub")).toContainText("Không lọc theo kỳ");
  await expect(pg.getByTestId("period-rule")).toHaveCount(0); // no period: no way to read it
  await pg.getByTestId("period-quick-quarter").click();
  await expect(pg.getByTestId("period-name")).toHaveText(/^Quý [1-4]\/\d{4}$/);
  await pg.evaluate(() => localStorage.setItem("soe.deal.period", JSON.stringify({ choice: null, rule: "closed" })));
  await pg.reload();
  await pg.getByTestId("period-button").click();
  await expect(pg.getByTestId("period-rule-closed")).toBeChecked();
  await pg.getByTestId("deal-dashboard-tab").click({ force: true });
  await expect(pg.getByTestId("period-button")).toBeVisible();
  await pg.getByTestId("period-button").click();
  await expect(pg.getByTestId("period-sub")).toHaveText("Khoảng thời gian chung của mọi biểu đồ");
  await pg.evaluate(() => localStorage.removeItem("soe.deal.period"));
});

test("lối tắt: từ ngăn kéo dòng deal đi tới đợt thanh toán và com của đúng deal đó", async () => {
  const pg = mgr.page;
  const home = await mgrApi.call<{ tables: { id: string; role_set: string | null }[] }>("GET", "/datahub/deal-home");
  const dealsId = home.tables.find((t) => t.role_set === "deals")!.id;
  await pg.goto(`/quan-ly-deal/${dealsId}?row=${dealRowId}`);
  await pg.getByTestId("panel-open-payments").click();
  await expect(pg).toHaveURL(new RegExp(`/quan-ly-deal/thanh-toan\\?.*deal=${dealRowId}`));
  await expect(pg.getByTestId("deal-focus")).toContainText("Công ty thử 1");
  await expect(pg.getByTestId("dot-view-pending")).toHaveCount(0); // the views are for the whole list
  await pg.getByTestId("deal-focus-clear").click();
  await expect(pg.getByTestId("deal-focus")).toHaveCount(0);
  await expect(pg.getByTestId("dot-view-pending")).toBeVisible();
  await pg.goBack();
  await pg.getByTestId("panel-open-com").click();
  await expect(pg).toHaveURL(/tab=ledger/);
  await expect(pg.getByTestId("deal-focus")).toContainText("Công ty thử 1");
  await expect(pg.getByRole("tab", { name: "Sổ com" })).toHaveAttribute("aria-selected", "true");
});
