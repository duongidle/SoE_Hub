import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { createAdmin, seedPeople } from "./seed";

/**
 * Stage 6B: bell, reminders, general announcements, notification settings. The reminder fires through the real worker job (every minute).
 * Every account is made up. Desktop only.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-6-${p}-5521`;
const email = (who: string) => `${p}.s6${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
let leadS: Session;
let userS: Session;
let leadId = "";
let sessions: Session[] = [];

/** `dd/mm/yyyy hh:mm` in Vietnam time, `minutes` from now. */
const vnAfter = (minutes: number) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(Date.now() + minutes * 60_000)).map((x) => [x.type, x.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
};
const bell = (s: Session) => s.page.getByRole("button", { name: /^Thông báo, \d+ chưa đọc$/ });

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "Stage 6B chỉ chạy ở desktop");
  const admin = await createAdmin(API, email("admin"), `Admin 6 ${p}`, PASSWORD(), ROOT);
  const ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 6 ${p}`, roles: ["manager"] },
      { email: email("lead"), name: `Leader 6 ${p}`, roles: ["leader"], manager: email("mgr") },
      { email: email("u1"), name: `Thành viên 6 ${p}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
    ],
    PASSWORD(),
  );
  leadId = ids[email("lead")]!;
  leadS = await Session.open(browser, p, "lead");
  userS = await Session.open(browser, p, "u1");
  sessions = [leadS, userS];
  await leadS.login(email("lead"), PASSWORD());
  await userS.login(email("u1"), PASSWORD());
  await expect(userS.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
});
test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

test("nhắc hẹn giờ gần: chuông nhảy số và hiện toast khi worker gửi", async () => {
  test.setTimeout(240_000);
  const page = userS.page;
  const content = `Gọi lại khách ${p}`;
  await page.goto("/nhac-hen");
  await page.getByTestId("new-reminder").click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nội dung").fill(content);
  await d.getByPlaceholder("dd/mm/yyyy hh:mm").fill(vnAfter(1));
  await d.getByRole("button", { name: "Đặt nhắc" }).click();
  await expect(page.getByTestId("reminder-item").filter({ hasText: content })).toBeVisible();
  // The worker sends it within about two minutes: the toast pops while the page stays open, and the bell counts it.
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: content })).toBeVisible({ timeout: 170_000 });
  await expect(page.getByTestId("bell-count")).toBeVisible();
  await bell(userS).click();
  await expect(page.getByRole("dialog", { name: "Thông báo" }).getByTestId("notification-item").filter({ hasText: content })).toBeVisible();
  await page.keyboard.press("Escape");
  // "Xong" moves it to the done tab.
  await page.getByTestId("reminder-item").filter({ hasText: content }).getByRole("button", { name: "Xong" }).click();
  await page.getByTestId("reminders-done-toggle").click();
  await expect(page.getByTestId("reminder-item").filter({ hasText: content })).toBeVisible();
});

test("Leader gửi thông báo chung cho team: thành viên thấy, người gửi thấy Đã đọc, thu hồi thì biến mất", async () => {
  const title = `Họp team ${p} 9h`;
  const lp = leadS.page;
  await lp.goto("/thong-bao-chung");
  await lp.getByTestId("ann-new").click();
  await lp.getByTestId("ann-title").fill(title);
  await lp.getByTestId("ann-body").fill("Nội dung họp");
  await lp.getByTestId(`ann-team-${leadId}`).check();
  await lp.getByTestId("ann-send").click();
  const sent = lp.getByTestId("ann-sent").filter({ hasText: title });
  await expect(sent).toContainText("Đã đọc 0/1");

  // The member sees it in the bell (live), opens it, and it counts as read.
  const up = userS.page;
  await up.goto("/");
  await expect(bell(userS)).toBeVisible();
  await bell(userS).click();
  const item = up.getByRole("dialog", { name: "Thông báo" }).getByTestId("notification-item").filter({ hasText: title });
  await expect(item).toBeVisible();
  await item.click();
  await expect(up).toHaveURL(/\/thong-bao-chung$/);
  await expect(up.getByTestId("ann-received").filter({ hasText: title })).toBeVisible();

  await lp.reload();
  await expect(lp.getByTestId("ann-sent").filter({ hasText: title })).toContainText("Đã đọc 1/1");
  await lp.getByTestId("ann-sent").filter({ hasText: title }).getByRole("button", { name: "Thu hồi" }).click();
  await lp.getByRole("dialog").getByRole("button", { name: "Thu hồi" }).click();
  await expect(lp.getByTestId("ann-sent").filter({ hasText: title })).toContainText("Đã thu hồi");

  await up.reload();
  await expect(up.getByTestId("ann-received").filter({ hasText: title })).toHaveCount(0);
  await up.goto("/thong-bao");
  await expect(up.getByTestId("notification-item").filter({ hasText: title })).toHaveCount(0);
});

test("Chuông có ba tab và nút +: Leader tạo được cả hai loại, thành viên chỉ tạo nhắc hẹn; menu không còn mục riêng", async () => {
  const lp = leadS.page;
  await lp.goto("/");
  await expect(await leadS.hasMenu("Nhắc hẹn")).toBe(false);
  await expect(await leadS.hasMenu("Thông báo chung")).toBe(false);
  await bell(leadS).click();
  const panel = lp.getByRole("dialog", { name: "Thông báo" });
  for (const name of ["Thông báo", "Nhắc hẹn", "Thông báo chung"]) await expect(panel.getByRole("tab", { name, exact: true })).toBeVisible();
  await panel.getByRole("tab", { name: "Thông báo chung" }).click();
  await expect(panel.getByRole("button", { name: "Đã gửi" })).toBeVisible();
  await panel.getByRole("button", { name: "Tạo mới" }).click();
  await expect(panel.getByRole("menuitem", { name: "Tạo nhắc hẹn" })).toBeVisible();
  await expect(panel.getByRole("menuitem", { name: "Tạo thông báo chung" })).toBeVisible();
  const content = `Nhắc từ chuông ${p}`;
  await panel.getByRole("menuitem", { name: "Tạo nhắc hẹn" }).click();
  const d = lp.getByRole("dialog", { name: "Tạo nhắc hẹn" });
  await d.getByLabel("Nội dung").fill(content);
  await d.getByPlaceholder("dd/mm/yyyy hh:mm").fill(vnAfter(600));
  await d.getByRole("button", { name: "Đặt nhắc" }).click();
  await expect(lp.getByRole("dialog", { name: "Thông báo" }).getByTestId("reminder-item").filter({ hasText: content })).toBeVisible();

  const up = userS.page;
  await up.goto("/");
  await bell(userS).click();
  await up.getByRole("dialog", { name: "Thông báo" }).getByRole("button", { name: "Tạo mới" }).click();
  await expect(up.getByRole("menuitem", { name: "Tạo nhắc hẹn" })).toBeVisible();
  await expect(up.getByRole("menuitem", { name: "Tạo thông báo chung" })).toHaveCount(0);
});

test("Cài đặt thông báo: tắt một loại không bắt buộc, loại bắt buộc bị khoá", async () => {
  const page = userS.page;
  await page.goto("/tai-khoan/thong-bao");
  await expect(page.getByText("Luôn nhận:").first()).toBeVisible();
  const box = page.locator('input[type="checkbox"][data-testid^="type-"]:not([disabled])').first();
  await expect(box).toBeChecked();
  const id = await box.getAttribute("data-testid");
  await box.click();
  await expect(page.getByText("Đã lưu")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(id!)).not.toBeChecked();
  await page.getByTestId(id!).click();
  await expect(page.getByTestId(id!)).toBeChecked();
});
