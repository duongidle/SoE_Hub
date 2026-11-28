import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, chooseOption, Session, type ProjectName } from "./helpers";
import { createAdmin, seedPeople, type ApiClient } from "./seed";

/**
 * Stage 11 (11B): the "?" menu, the feedback form (Guest, with a picture), the inbox of the handler (status, reply), "Góp ý của tôi",
 * and the page of supplementary permissions. Every account is made up. Desktop only (one check opens the form at 375px).
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const RUN = Date.now().toString(36);
const PASSWORD = () => `Kiem-thu-11-${p}-5521`;
const email = (who: string) => `${p}.s11${who}.${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const TEXT = `Nút lưu bị đơ khi mở bảng lớn ${RUN}`;
let adminS: Session;
let guestS: Session;
let userS: Session;
let admin: ApiClient;
let sessions: Session[] = [];

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "Stage 11 chỉ chạy ở desktop");
  admin = await createAdmin(API, email("admin"), `Admin 11 ${RUN}`, PASSWORD(), ROOT);
  await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 11 ${RUN}`, roles: ["manager"] },
      { email: email("u1"), name: `Thành viên 11 ${RUN}`, roles: ["user"], manager: email("mgr") },
      { email: email("guest"), name: `Guest 11 ${RUN}`, roles: ["guest"], manager: email("mgr"), guestPreset: "data" },
    ],
    PASSWORD(),
  );
  adminS = await Session.open(browser, p, "admin");
  guestS = await Session.open(browser, p, "guest");
  userS = await Session.open(browser, p, "u1");
  sessions = [adminS, guestS, userS];
  await adminS.login(email("admin"), PASSWORD());
  await guestS.login(email("guest"), PASSWORD());
  await userS.login(email("u1"), PASSWORD());
  await expect(userS.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  await expect(adminS.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  await expect(guestS.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
});
test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

test("menu ?: ba mục, mọi người kể cả Guest", async () => {
  const page = guestS.page;
  await page.getByRole("button", { name: "Trợ giúp và góp ý" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Gửi góp ý" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Góp ý của tôi" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Hướng dẫn kết nối AI" })).toBeVisible();
  await guestS.shot("11-menu");
  await page.keyboard.press("Escape");
});

test("form gửi ở 375px không tràn ngang", async () => {
  const page = guestS.page;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Trợ giúp và góp ý" }).click();
  await page.getByRole("menuitem", { name: "Gửi góp ý" }).click();
  const dialog = page.getByRole("dialog", { name: "Gửi góp ý" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Yêu cầu tính năng" })).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await page.waitForTimeout(500); // the sheet rises for 240ms: shoot after it settles
  await guestS.shot("11-form-375");
  await dialog.getByRole("button", { name: "Huỷ" }).click();
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("Guest gửi góp ý có ảnh", async () => {
  const page = guestS.page;
  await page.getByRole("button", { name: "Trợ giúp và góp ý" }).click();
  await page.getByRole("menuitem", { name: "Gửi góp ý" }).click();
  const dialog = page.getByRole("dialog", { name: "Gửi góp ý" });
  await expect(dialog.getByRole("button", { name: "Gửi góp ý" })).toBeDisabled();
  await dialog.getByRole("radio", { name: "Báo lỗi" }).click();
  await dialog.getByLabel("Nội dung góp ý").fill(TEXT);
  await dialog.getByTestId("feedback-file-input").setInputFiles({ name: "loi.png", mimeType: "image/png", buffer: PNG });
  await expect(dialog.getByRole("img", { name: "loi.png" })).toBeVisible();
  await guestS.shot("11-form");
  await dialog.getByRole("button", { name: "Gửi góp ý" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Xem góp ý của tôi" }).click();
  await expect(page).toHaveURL(/\/gop-y/);
  const row = page.getByTestId("feedback-row").filter({ hasText: TEXT });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Mới");
  await expect(row).toContainText("1 ảnh");
});

test("Admin thấy ở Feedback, đổi trạng thái và nhắn", async () => {
  const page = adminS.page;
  await page.goto("/quan-tri/feedback");
  const row = page.getByTestId("feedback-row").filter({ hasText: TEXT });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`Guest 11 ${RUN}`);
  await row.click();
  const drawer = page.getByRole("dialog", { name: "Chi tiết góp ý" });
  await expect(drawer.getByTestId("feedback-body")).toHaveText(TEXT);
  await expect(drawer.getByTestId("feedback-image")).toBeVisible();
  await expect(drawer.getByTestId("feedback-context")).toContainText("Cỡ màn hình");
  await chooseOption(drawer.getByRole("combobox", { name: "Trạng thái" }), { label: "Đang xem" });
  await expect(drawer.getByText("Đã đổi trạng thái").or(page.getByText("Đã đổi trạng thái"))).toBeVisible();
  await drawer.getByLabel("Nội dung tin nhắn").fill("Đã nhận, đang xem lỗi này.");
  await drawer.getByRole("button", { name: "Gửi trả lời" }).click();
  await expect(drawer.getByTestId("feedback-message")).toContainText("Đã nhận, đang xem lỗi này.");
  await adminS.shot("11-inbox-drawer");
  await drawer.getByRole("button", { name: "Đóng" }).first().click();
  // The default filter is Mới + Đang xem: still listed. Done leaves it out.
  await expect(page.getByTestId("feedback-row").filter({ hasText: TEXT })).toContainText("Đang xem");
});

test("Guest thấy trạng thái và tin nhắn ở Góp ý của tôi", async () => {
  const page = guestS.page;
  await page.goto("/gop-y");
  const row = page.getByTestId("feedback-row").filter({ hasText: TEXT });
  await expect(row).toContainText("Đang xem");
  await row.click();
  const drawer = page.getByRole("dialog", { name: "Chi tiết góp ý" });
  await expect(drawer.getByTestId("feedback-message")).toContainText("Đã nhận, đang xem lỗi này.");
  await expect(drawer.getByRole("button", { name: "Rút lại" })).toHaveCount(0);
  await drawer.getByLabel("Nội dung tin nhắn").fill("Cảm ơn, mình chờ nhé.");
  await drawer.getByRole("button", { name: "Gửi tin nhắn" }).click();
  await expect(drawer.getByTestId("feedback-message")).toHaveCount(2);
  await guestS.shot("11-mine-drawer");
});

test("Phân quyền bổ sung: Admin cấp Xử lý feedback, người đó thấy mục Feedback", async () => {
  const user = userS.page;
  await user.goto("/cai-dat");
  await expect(user.getByRole("link", { name: "Feedback", exact: true })).toHaveCount(0);

  const page = adminS.page;
  await page.goto("/quan-tri/quyen-bo-sung");
  const card = page.getByTestId("perm-feedback:inbox:manage");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Cấp được cho");
  await card.getByRole("button", { name: /^Thêm người cho/ }).click();
  const picker = page.getByTestId("people-picker");
  await picker.getByLabel("Tìm người").fill(`Thành viên 11 ${RUN}`);
  await picker.getByRole("option", { name: new RegExp(`Thành viên 11 ${RUN}`) }).click();
  await picker.getByRole("button", { name: /^Xong/ }).click();
  await expect(card.getByTestId("perm-holder")).toContainText(`Thành viên 11 ${RUN}`);
  await adminS.shot("11-extra-permissions");

  await user.goto("/cai-dat");
  await expect(user.getByRole("link", { name: "Feedback", exact: true })).toBeVisible();
  await user.goto("/quan-tri/feedback");
  await expect(user.getByTestId("feedback-row").filter({ hasText: TEXT })).toBeVisible();
  await userS.shot("11-inbox-delegate");

  await card.getByRole("button", { name: `Gỡ quyền của Thành viên 11 ${RUN}` }).click();
  await page.getByRole("dialog", { name: "Gỡ quyền?" }).getByRole("button", { name: "Gỡ quyền" }).click();
  await expect(card.getByTestId("perm-holder")).toHaveCount(0);
});

test("trang cài đặt thông báo có nhóm Góp ý", async () => {
  const page = guestS.page;
  await page.goto("/tai-khoan/thong-bao");
  await expect(page.getByTestId("type-feedback.update")).toBeVisible();
  await expect(page.getByTestId("group-feedback")).toContainText("Góp ý của bạn có cập nhật");
  await guestS.shot("11-notification-settings");
});
