import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName, chooseOption } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/** Stage 9D: Onboarding through the real screens. Two flows, invented accounts only. Desktop only (the 375px check opens its own phone-sized window). */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-9-${p}-5521`;
const email = (who: string) => `${p}.s9${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
let lead: Session;
let user: Session;
let leadApi: ApiClient;
let sessions: Session[] = [];
let planId = "";
const USER_NAME = () => `Nhân sự 9 ${p}`;

/** Today in Vietnam, the Monday of this week (the plan starts there, so today is in week 1) and today's weekday (1 = Monday ... 7 = Sunday). */
const vnToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
const dayOfWeek = () => { const d = new Date(`${vnToday()}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const mondayOfWeek = () => new Date(new Date(`${vnToday()}T00:00:00Z`).getTime() - (dayOfWeek() - 1) * 86400000).toISOString().slice(0, 10);

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "Stage 9D chỉ chạy ở desktop");
  const admin = await createAdmin(API, email("admin"), `Admin 9 ${p}`, PASSWORD(), ROOT);
  await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 9 ${p}`, roles: ["manager"] },
      { email: email("lead"), name: `Leader 9 ${p}`, roles: ["leader"], manager: email("mgr") },
      { email: email("u1"), name: USER_NAME(), roles: ["user"], manager: email("mgr"), leader: email("lead") },
    ],
    PASSWORD(),
  );
  leadApi = await new ApiClient(API).login(email("lead"), PASSWORD());
  lead = await Session.open(browser, p, "lead");
  user = await Session.open(browser, p, "u1");
  sessions = [lead, user];
  await lead.login(email("lead"), PASSWORD());
  await user.login(email("u1"), PASSWORD());
});
test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

test("Leader gắn lộ trình mẫu cho nhân sự, sửa trong trình sửa; nhân sự tick việc, gửi Q&A, thấy Q&A 1/10", async () => {
  test.setTimeout(240_000);
  // The worker makes the sample plan of a new Leader within a minute.
  // The templates of the tree are the Manager's sample and the Leader's own; only the Leader's keeps the forms the Leader can see, so wait for THAT one (the worker builds them one after another).
  const leadId = ((await leadApi.call<{ user: { id: string } }>("GET", "/auth/me")).user.id);
  await expect.poll(async () => (await leadApi.call<{ owner_id: string }[]>("GET", "/onboarding/plans?scope=template")).some((x) => x.owner_id === leadId), { timeout: 150_000, intervals: [3000] }).toBe(true);
  const ownIndex = (await leadApi.call<{ owner_id: string }[]>("GET", "/onboarding/plans?scope=template")).findIndex((x) => x.owner_id === leadId);

  const lp = lead.page;
  // Clone the sample (it keeps the forms, no new tables), then assign the clone from the same tab.
  await lp.goto("/onboarding/lo-trinh");
  await lp.getByRole("tab", { name: "Mẫu" }).click();
  await lp.getByTestId("plan-row").nth(ownIndex).getByTestId("plan-clone").click();
  await expect(lp.getByTestId("onb-editor")).toBeVisible();
  await lp.goto("/onboarding/lo-trinh");
  await lp.getByRole("tab", { name: "Mẫu" }).click(); // a clone of a template is a template
  await lp.getByTestId("plan-row").filter({ hasText: "(bản sao)" }).first().getByTestId("plan-assign").click();
  await chooseOption(lp.getByTestId("assign-staff"), { label: USER_NAME() });
  await lp.getByTestId("assign-start").fill(mondayOfWeek());
  await lp.getByTestId("assign-ok").click();
  await expect(lp.getByTestId("onb-plan-view")).toBeVisible();
  planId = /\/nhan-su\/([0-9a-f-]{36})/.exec(lp.url())![1]!;

  // The weekly Q&A item moves to today, so the person has something to do today (the editor of a running plan).
  await lp.goto(`/onboarding/lo-trinh/${planId}`);
  await expect(lp.getByTestId("onb-editor")).toBeVisible();
  const item = lp.locator('[data-testid="ed-item"]').filter({ has: lp.locator('input[value="Gửi câu hỏi Q&A trong tuần"]') }).first();
  await expect(item).toBeVisible();
  await chooseOption(item.locator('label:has(> span:text-is("Thứ")) [role="combobox"]'), String(dayOfWeek()));
  await lp.getByTestId("plan-save").click();
  await expect(lp.getByText("Đã lưu lộ trình.")).toBeVisible();

  // The person: Today, tick, send one Q&A, My results.
  const up = user.page;
  await up.goto("/onboarding");
  await up.getByRole("tab", { name: "Hôm nay" }).click(); // 12F-1: the page opens on the Journey
  await expect(up.getByTestId("onb-today")).toBeVisible();
  const occ = up.getByTestId("onb-occ").filter({ hasText: "Gửi câu hỏi Q&A trong tuần" }).first();
  await expect(occ).toBeVisible();
  await occ.getByTestId("occ-tick").click();
  await expect(occ.getByTestId("occ-tick")).toBeChecked();
  await up.reload();
  await expect(up.getByTestId("onb-occ").filter({ hasText: "Gửi câu hỏi Q&A trong tuần" }).first().getByTestId("occ-tick")).toBeChecked();

  const href = await up.getByTestId("onb-occ").filter({ hasText: "Gửi câu hỏi Q&A trong tuần" }).first().getByTestId("occ-form").getAttribute("href");
  await up.goto(href!);
  await up.getByLabel("Ngày").fill(vnToday());
  await up.getByLabel("Ứng dụng").fill("HRM");
  await up.getByLabel("Câu hỏi").fill("Làm sao tạo ca làm việc mới?");
  await up.getByTestId("form-submit").click();
  await expect(up.getByTestId("fill-notice")).toBeVisible();

  await expect(async () => {
    await up.goto("/onboarding");
    await up.getByRole("tab", { name: "Kết quả của tôi" }).click();
    await expect(up.getByTestId("onb-cp").filter({ hasText: "Q&A 10 câu" }).first()).toContainText(/Số câu Q&A trong tuần: 1 ≥ 10/);
  }).toPass({ timeout: 60_000 });
});

test("Leader mở Theo dõi, vào trang nhân sự, xác nhận tay checkpoint; Hành trình của nhân sự ở 375px không tràn", async ({ browser }) => {
  test.setTimeout(120_000);
  const lp = lead.page;
  await lp.goto("/onboarding/theo-doi");
  const row = lp.getByTestId("onb-row").filter({ hasText: USER_NAME() });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("onb-row-progress")).toContainText("%");
  await row.click();
  await expect(lp.getByTestId("onb-plan-view")).toBeVisible();
  expect(lp.url()).toContain(planId);
  await lp.getByRole("tab", { name: "Kết quả" }).click();
  const cp = lp.getByTestId("onb-cp").filter({ hasText: "Mockup done" });
  await cp.getByTestId("cp-confirm").click();
  await expect(cp.getByTestId("cp-confirm")).toHaveText("Bỏ xác nhận");
  await expect(cp).toContainText("Leader đã xác nhận");

  const phone = await Session.open(browser, "phone", "u1phone");
  sessions.push(phone);
  await phone.login(email("u1"), PASSWORD());
  await expect(phone.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  await phone.page.goto("/onboarding");
  await phone.page.getByRole("tab", { name: "Hành trình" }).click();
  await expect(phone.page.getByTestId("onb-journey")).toBeVisible();
  await phone.page.getByTestId("onb-week").first().click(); // 12F-1: the week node itself opens the drawer
  await expect(phone.page.getByTestId("onb-week-drawer")).toBeVisible();
  const o = await phone.page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s).toBeLessThanOrEqual(o.c);
});
