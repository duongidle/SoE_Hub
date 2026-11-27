import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API, Session, type ProjectName, chooseOption, expectSelectValue } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 4.6B: the Deals dashboard in the menu, numbers of the reader, forecast of the team, Probation KPI "Đã đạt", the period of the instalments screen
 * (Module 4 mục 6, 10.2, 11a, 13). Every company, account and amount is made up here; no real data. Desktop only.
 * The quarter is fixed (Q4 2026), so nothing but the "last month" test depends on today's date.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-46-${p}-7741`;
const email = (who: string) => `${p}.s46${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const OMEGA = "Omega Chung Deal";
const SIGMA = "Sigma Da Thu";
const THETA = "Theta Thang Truoc";

let admin: ApiClient;
let mgrApi: ApiClient;
let u1Api: ApiClient;
let u2Api: ApiClient;
let ids: Record<string, string> = {};
let sessions: Session[] = [];
let mgrS: Session;
let leadS: Session;
let u1S: Session;
let u2S: Session;
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

/** The table a person reads by name (a member reads their own copy), with column NAMES as keys. */
async function rowsOf(api: ApiClient, name: string): Promise<Record<string, unknown>[]> {
  const home = await api.call<{ tables: { id: string; name: string }[] }>("GET", "/datahub/deal-home");
  const id = home.tables.find((t) => t.name === name)?.id;
  if (!id) throw new Error(`Không thấy bảng ${name}`);
  const t = await api.call<{ columns: { key: string; name: string }[] }>("GET", `/tables/${id}`);
  const r = await api.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${id}/rows?limit=500`);
  const nm = new Map(t.columns.map((c) => [c.key, c.name]));
  return r.data.map((x) => ({ _id: x.id, ...Object.fromEntries(Object.entries(x.data).map(([k, v]) => [nm.get(k) ?? k, v])) }));
}
const dealRow = async (api: ApiClient, company: string) => (await rowsOf(api, "Deals")).find((r) => r["Tên công ty"] === company);

async function openDashboard(s: Session) {
  await s.page.evaluate(() => localStorage.setItem("soe.deal.period", JSON.stringify({ choice: { unit: "quarter", year: 2026, index: 4 }, rule: "related" })));
  await s.page.goto("/quan-ly-deal/dashboard");
  await expect(s.page.getByTestId("deal-dashboard")).toBeVisible({ timeout: 30_000 });
  await expect(s.page.getByTestId("dashboard-grid")).toBeVisible({ timeout: 30_000 });
}
const card = (page: Page, title: string) => page.locator(`section[aria-label="${title}"]`);

/** A deal of two people (invented split), with the schedule given. */
async function makeDeal(company: string, extra: Record<string, unknown>, people: { who: string; role: string; com: number; dt: number }[]): Promise<string> {
  const home = await mgrApi.call<{ tables: { id: string; name: string }[] }>("GET", "/datahub/deal-home");
  const deals = home.tables.find((t) => t.name === "Deals")!.id;
  const r = await mgrApi.call<{ id: string }>("POST", `/tables/${deals}/rows`, {
    data: {
      "Tên công ty": company,
      "Loại deal": "POD bán mới",
      "Start date": "2026-10-05",
      "Nguồn lead": "ML",
      "Level BC": "Level 1",
      "Performance BC": "KPI",
      "Người tham gia": people.map((x) => ({ id: uid(x.who), attrs: { vai_tro: x.role, ty_le_com: x.com, ty_le_dt: x.dt } })),
      ...extra,
    },
  });
  return r.id;
}

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "4.6B chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  admin = await createAdmin(API, email("admin"), `Admin 46 ${p}`, PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 46 ${p}`, roles: ["manager"] },
      { email: email("lead"), name: `Leader 46 ${p}`, roles: ["leader"], manager: email("mgr") },
      { email: email("u1"), name: `Thành viên Một 46 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
      { email: email("u2"), name: `Thành viên Hai 46 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
    ],
    PASSWORD(),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  u1Api = await new ApiClient(API).login(email("u1"), PASSWORD());
  u2Api = await new ApiClient(API).login(email("u2"), PASSWORD());

  const tbl: Record<string, string> = {};
  await waitFor(async () => {
    const list = await mgrApi.call<{ name: string; master_table_id: string }[]>("GET", "/datahub/templates");
    for (const n of ["Deals", "Đợt thanh toán", "Chính sách com", "Probation KPI"]) {
      const t = list.find((x) => x.name === n);
      if (!t) return false;
      tbl[n] = t.master_table_id;
    }
    return true;
  }, "bộ bảng mặc định của cây");
  // An invented policy: ML, Level 1, KPI = 20%; the commission of Omega is split 15% / 5% of that.
  await mgrApi.call("POST", `/tables/${tbl["Chính sách com"]}/rows`, { data: { "Hiệu lực từ": "2026-01-01", "Nguồn lead": "ML", Level: "Level 1", Performance: "KPI", "Tỉ lệ": 0.2 } });
  for (const who of ["u1", "u2"]) {
    await mgrApi.call("POST", `/tables/${tbl["Probation KPI"]}/rows`, { data: { Người: uid(who), Năm: 2026, "KPI Software": 400_000_000, "KPI Non-software": 100_000_000, "% Q1": 0.25, "% Q2": 0.25, "% Q3": 0.25, "% Q4": 0.25 } });
  }

  // Omega: open, 100tr due in Q4, shared by two people (15% and 5% of the commission). Unsigned: open, no schedule, expected to close in Q4.
  const omega = await makeDeal(OMEGA, { "Ngày dự kiến chốt": "2026-12-20" }, [{ who: "u1", role: "Leading", com: 0.15, dt: 0.6 }, { who: "u2", role: "Associate", com: 0.05, dt: 0.4 }]);
  await mgrApi.call("POST", "/deal/payments/schedule", { deal_id: omega, payments: [{ amount: 100_000_000, due: "2026-12-15" }] });
  await makeDeal("Unsigned Chua Ky", { "Ngày dự kiến chốt": "2026-12-10", "Doanh thu dự kiến": 30_000_000 }, [{ who: "u1", role: "Leading", com: 0.2, dt: 1 }]);
  // Sigma: one instalment of 80tr, paid on 10 Nov 2026 (Won): revenue 60% / 40%.
  const sigma = await makeDeal(SIGMA, {}, [{ who: "u1", role: "Leading", com: 0.15, dt: 0.6 }, { who: "u2", role: "Associate", com: 0.05, dt: 0.4 }]);
  const sch = await mgrApi.call<{ payments: { id: string }[] }>("POST", "/deal/payments/schedule", { deal_id: sigma, payments: [{ amount: 80_000_000, due: "2026-11-10" }] });
  await mgrApi.call("POST", "/deal/payments/confirm", { received_on: "2026-11-10", receipt: { amount: 80_000_000 }, allocations: [{ payment_id: sch.payments[0]!.id, amount: 80_000_000 }] });
  await waitFor(async () => {
    const a = await dealRow(u1Api, OMEGA);
    const k = (await rowsOf(u1Api, "Probation KPI"))[0];
    return a && typeof a["Com dự kiến của tôi"] === "number" && k && typeof k["Đã đạt"] === "number" && k["Đã đạt"] === 48_000_000;
  }, "Com dự kiến và KPI Đã đạt tính xong");
  await waitFor(async () => (await u1Api.call<{ name: string }[]>("GET", "/dashboards/shared").then((r) => (Array.isArray(r) ? r : (r as unknown as { data: { name: string }[] }).data))).some((d) => d.name === "Deals"), "dashboard Deals tới thành viên");

  mgrS = await Session.open(browser, p, "mgr").then((x) => x.allow(400, /\/api\/v1\//));
  leadS = await Session.open(browser, p, "lead");
  u1S = await Session.open(browser, p, "u1");
  u2S = await Session.open(browser, p, "u2");
  sessions = [mgrS, leadS, u1S, u2S];
  for (const [s, who] of [[mgrS, "mgr"], [leadS, "lead"], [u1S, "u1"], [u2S, "u2"]] as const) {
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

test("hai người cùng deal thấy hai số Com dự kiến của tôi khác nhau, trên dashboard và trên bảng Deals", async () => {
  // Omega: 100tr x 20% x 15% = 3tr for the Leading person, x 5% = 1tr for the Associate (the same deal, the same row).
  // The card adds up every deal the reader is in: u1 = Omega 3tr + Unsigned 30tr x 20% x 20% = 1,2tr + Sigma 80tr x 20% x 15% = 2,4tr = 6,6tr; u2 = Omega 1tr + Sigma 0,8tr = 1,8tr.
  await openDashboard(u1S);
  await openDashboard(u2S);
  await expect(card(u1S.page, "Com dự kiến của tôi").getByTestId("kpi-value")).toContainText("6.600.000");
  await expect(card(u2S.page, "Com dự kiến của tôi").getByTestId("kpi-value")).toContainText("1.800.000");
  // The table of Deals gives the same two numbers (one table, two readers).
  expect((await dealRow(u1Api, OMEGA))?.["Com dự kiến của tôi"]).toBeCloseTo(3_000_000, 6);
  expect((await dealRow(u2Api, OMEGA))?.["Com dự kiến của tôi"]).toBeCloseTo(1_000_000, 6);
  // The dashboard is in the menu of Quản lý Deal, next to the tables.
  await u1S.page.goto("/quan-ly-deal");
  await expect(u1S.page.getByTestId("deal-dashboard-tab")).toBeVisible();
  // The date range of the filter bar is the shared period of the page.
  await openDashboard(u1S);
  await expect(u1S.page.getByTestId("filter-range-locked")).toBeVisible();
  await expect(u1S.page.getByTestId("period-name")).toHaveText("Quý 4/2026");
});

test("Leader và Manager thấy forecast của team; User không thấy bảng forecast", async () => {
  for (const s of [mgrS, leadS]) {
    await openDashboard(s);
    const panel = s.page.getByTestId("forecast-panel");
    await expect(panel, s.name).toBeVisible();
    await expect(panel.getByTestId("forecast-signed"), s.name).toContainText("100.000.000"); // Omega's instalment, due 15 Dec
    await expect(panel.getByTestId("forecast-unsigned"), s.name).toContainText(/\d/);
  }
  await expect(u1S.page.getByTestId("forecast-panel")).toHaveCount(0);
  // The panel is the server's answer: the same two parts as the command gives the Manager.
  const f = await mgrApi.call<{ signed: number; unsigned: number }>("GET", "/deal/forecast?from=2026-10-01&to=2026-12-31");
  expect(f.signed).toBe(100_000_000);
  expect(f.unsigned).toBeGreaterThan(0);
  await expect(mgrS.page.getByTestId("forecast-total")).toContainText(String(f.signed + f.unsigned).replace(/\B(?=(\d{3})+(?!\d))/g, "."));
});

test("Probation KPI: Đã đạt, Còn thiếu và % đạt đúng số tự dựng với mọi người đọc", async () => {
  // Sigma paid 80tr: 60% = 48tr for u1, 40% = 32tr for u2. KPI of the year 400tr + 100tr.
  const expectKpi = (r: Record<string, unknown> | undefined, done: number) => {
    expect(r?.["Đã đạt"]).toBe(done);
    expect(r?.["Còn thiếu"]).toBe(500_000_000 - done);
    expect(r?.["% đạt"]).toBeCloseTo(done / 500_000_000, 9);
  };
  const kpiOf = async (api: ApiClient, who: string) => (await rowsOf(api, "Probation KPI")).find((r) => JSON.stringify(r["Người"]).includes(uid(who)));
  for (const api of [u1Api, mgrApi]) expectKpi(await kpiOf(api, "u1"), 48_000_000);
  for (const api of [u2Api, mgrApi]) expectKpi(await kpiOf(api, "u2"), 32_000_000);
});

test("mốc cohort chín: đổi mốc thì dòng ghi chú đổi, ít hơn 10 deal Won thì dùng mặc định 90 ngày", async () => {
  const page = u1S.page;
  await openDashboard(u1S);
  const note = page.getByTestId("cycle-note");
  await expect(note).toContainText("Đang dùng mốc");
  await expect(note).toContainText("mặc định"); // one Won deal: fewer than 10
  await expect(note).toContainText("90 ngày");
  await chooseOption(page.getByTestId("cycle-milestone"), "none");
  await expect(note).toContainText("không chờ");
  await chooseOption(page.getByTestId("cycle-milestone"), "p90");
  await expect(note).toContainText("P90");
  // The cohort charts exist, and cutting at the mature month does not break the dashboard.
  await page.getByTestId("cycle-cut").check();
  await expect(card(page, "CR2 (Winrate) theo cohort (tháng nhận)")).toBeVisible();
  // Q4 2026 starts after the cut-off for as long as today is within 90 days of it: then no cohort of the period is mature and the card says so (no request for an empty range).
  // Later the period has mature months and the chart is drawn: either way the card answers and the session sees no error.
  await expect(card(page, "CR2 (Winrate) theo cohort (tháng nhận)").getByTestId("no-mature-cohort").or(card(page, "CR2 (Winrate) theo cohort (tháng nhận)").getByTestId("chart-data"))).toBeAttached({ timeout: 20_000 });
  await page.getByTestId("cycle-cut").uncheck();
  await expect(card(page, "CR2 (Winrate) theo cohort (tháng nhận)").getByTestId("chart-data")).toBeAttached({ timeout: 20_000 });
  await expect(card(page, "Com dự kiến của tôi").getByTestId("kpi-value")).toContainText("6.600.000");
});

test("màn Đợt chọn kỳ: tháng trước hiện đợt đã về của tháng chưa chốt và huỷ xác nhận được", async () => {
  // Paid in the middle of LAST month (whatever today is): a month that is not closed yet.
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const day = last.toISOString().slice(0, 10);
  const theta = await makeDeal(THETA, {}, [{ who: "u2", role: "Leading", com: 0.1, dt: 1 }]);
  const sch = await mgrApi.call<{ payments: { id: string }[] }>("POST", "/deal/payments/schedule", { deal_id: theta, payments: [{ amount: 20_000_000, due: day }] });
  await mgrApi.call("POST", "/deal/payments/confirm", { received_on: day, receipt: { amount: 20_000_000 }, allocations: [{ payment_id: sch.payments[0]!.id, amount: 20_000_000 }] });
  const page = mgrS.page;
  await page.goto("/quan-ly-deal/thanh-toan");
  await page.getByTestId("dot-view-month").click();
  await expectSelectValue(page.getByTestId("dot-period"), "this_month");
  await chooseOption(page.getByTestId("dot-period"), "last_month");
  const row = page.getByTestId("dot-row").filter({ hasText: "20.000.000" });
  await expect(row).toHaveCount(1);
  await row.getByTestId("unconfirm").click();
  await page.getByRole("dialog").getByRole("button", { name: "Huỷ xác nhận" }).click();
  await toast(page, "Đã huỷ xác nhận");
  await expect(page.getByTestId("dot-row").filter({ hasText: "20.000.000" })).toHaveCount(0);
  // The instalment is back to "waiting for money".
  await page.getByTestId("dot-view-pending").click();
  await expect(page.getByTestId("dot-row").filter({ hasText: "20.000.000" })).toHaveCount(1);
});
