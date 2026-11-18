import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { API, Session, cliAdminCreate, type ProjectName } from "./helpers";

/**
 * Stage 1 flows on a real stack (empty database, api + worker + web), run once per project (desktop 1440x900 and
 * phone 390x844). Every project uses its own people, so both runs start from the same empty org chart.
 * Each test ends by asserting that no session saw a console error or a failed request (expected 401/403/423 excepted).
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
let sessions: Session[] = [];
let admin: Session;
let manager: Session;
let leader: Session;
let user: Session;
let guard: Session; // anonymous browser for registration, lockout and denied logins

const PASSWORD = () => `Kiem-thu-${p}-7391`;
const NEW_PASSWORD = () => `Mat-khau-moi-${p}-5520`;
const email = (who: string) => `${p}.${who}@base.vn`;
const nameOf = (who: string) => `${who[0]!.toUpperCase()}${who.slice(1)} ${p}`;

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  admin = await Session.open(browser, p, "admin");
  manager = await Session.open(browser, p, "manager");
  leader = await Session.open(browser, p, "leader");
  user = await Session.open(browser, p, "user");
  guard = await Session.open(browser, p, "anonymous");
  sessions = [admin, manager, leader, user, guard];
});

test.afterEach(async ({ browserName: _browserName }, info) => {
  // A picture of every browser when a step fails, to see what the person would have seen.
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});

test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

/** A person asks for a code in their own browser; an approver reads it in the inbox; the person finishes. */
async function activate(who: string, approver: Session, session: Session = guard) {
  await session.requestCode("activate", email(who));
  const code = await approver.readCode(email(who));
  await session.submitCode("activate", code, PASSWORD());
}

test("admin đầu tiên: lệnh CLI -> đăng ký bằng mã -> vào hệ thống", async () => {
  const code = await cliAdminCreate(email("admin"), nameOf("admin"));
  await admin.page.goto("/dang-ky");
  await admin.page.getByLabel("Email công ty").fill(email("admin"));
  await admin.page.getByRole("button", { name: "Tôi đã có mã" }).click();
  await admin.submitCode("activate", code, PASSWORD());
  await expect(admin.page.getByRole("heading", { name: `Xin chào, ${nameOf("admin")}` })).toBeVisible();
  await admin.shot("01-admin-home");
});

test("đăng xuất xoá phiên; trang bảo vệ chuyển về đăng nhập và quay lại sau khi đăng nhập", async () => {
  await admin.logout();
  await admin.page.goto("/to-chuc");
  await expect(admin.page).toHaveURL(/\/dang-nhap\?next=%2Fto-chuc/);
  await admin.shot("02-login");
  await admin.login(email("admin"), PASSWORD(), "/to-chuc");
  await expect(admin.page).toHaveURL(/\/to-chuc$/);
  await expect(admin.page.getByRole("heading", { name: "Org chart" })).toBeVisible();
  // After logout the old session is really gone: a reload of a protected page asks for login again.
  await admin.logout();
  await admin.page.goto("/quan-tri/nhat-ky");
  await expect(admin.page).toHaveURL(/\/dang-nhap/);
  await admin.login(email("admin"), PASSWORD());
  await expect(admin.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
});

test("Admin thấy menu quản trị, không thấy menu của Manager", async () => {
  for (const label of ["Org chart", "Duyệt token", "Tài khoản hệ thống", "Nhật ký", "Chuyển giao", "Cài đặt hệ thống"]) {
    expect(await admin.hasMenu(label), label).toBe(true);
  }
  expect(await admin.hasMenu("Cấp dữ liệu Guest")).toBe(false);
  await admin.shot("03-admin-menu");
});

test("Admin thêm Manager, Leader, User và hai tài khoản phụ vào org chart", async () => {
  await admin.addMember({ email: email("manager"), name: nameOf("manager"), role: "Manager" });
  await admin.addMember({ email: email("leader"), name: nameOf("leader"), role: "Leader", manager: nameOf("manager") });
  await admin.addMember({ email: email("user"), name: nameOf("user"), role: "User", manager: nameOf("manager"), leader: nameOf("leader") });
  await admin.addMember({ email: email("lock"), name: nameOf("lock"), role: "User", manager: nameOf("manager"), leader: nameOf("leader") });
  await admin.addMember({ email: email("user2"), name: nameOf("user2"), role: "User", manager: nameOf("manager"), leader: nameOf("leader") });
  await admin.page.getByRole("button", { name: "Dạng cây" }).click();
  await expect(admin.page.getByText(`Cây của ${nameOf("manager")}`)).toBeVisible();
  await admin.shot("04-org-tree");
});

test("Manager đăng ký: mã về chuông của Admin ngay, không cần tải lại", async () => {
  await admin.page.goto("/");
  const before = await admin.bellCount();
  await guard.requestCode("activate", email("manager"));
  await expect.poll(() => admin.bellCount(), { message: "chuông Admin cập nhật qua SSE" }).toBeGreaterThan(before);
  await admin.shot("05-admin-bell");
  const code = await admin.readCode(email("manager"));
  await guard.submitCode("activate", code, PASSWORD());
  // The manager's own browser: they are signed in, so reuse that session for the next steps.
  await manager.login(email("manager"), PASSWORD());
  await expect(manager.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  await guard.logout();
});

test("Leader đăng ký: mã hiện ở chuông của Manager và Admin", async () => {
  await manager.page.goto("/");
  await admin.page.goto("/");
  const [mBefore, aBefore] = [await manager.bellCount(), await admin.bellCount()];
  await guard.requestCode("activate", email("leader"));
  await expect.poll(() => manager.bellCount()).toBeGreaterThan(mBefore);
  await expect.poll(() => admin.bellCount()).toBeGreaterThan(aBefore);
  const code = await manager.readCode(email("leader"));
  await guard.submitCode("activate", code, PASSWORD());
  await leader.login(email("leader"), PASSWORD());
  await expect(leader.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  await guard.logout();
});

test("User đăng ký: mã hiện ở chuông của Leader, Manager và Admin", async () => {
  for (const s of [leader, manager, admin]) await s.page.goto("/");
  const before = [await leader.bellCount(), await manager.bellCount(), await admin.bellCount()];
  await guard.requestCode("activate", email("user"));
  await expect.poll(() => leader.bellCount()).toBeGreaterThan(before[0]!);
  await expect.poll(() => manager.bellCount()).toBeGreaterThan(before[1]!);
  await expect.poll(() => admin.bellCount()).toBeGreaterThan(before[2]!);
  await leader.page.goto("/thong-bao");
  await leader.shot("06-leader-inbox");
  const code = await leader.readCode(email("user"));
  await guard.submitCode("activate", code, PASSWORD());
  await guard.logout();
  await user.login(email("user"), PASSWORD());
  await expect(user.page.getByRole("heading", { name: `Xin chào, ${nameOf("user")}` })).toBeVisible();
  await user.shot("07-user-home");
  await activate("lock", admin);
  await guard.logout();
  await activate("user2", admin);
  await guard.logout();
});

test("quên mật khẩu: xin mã -> Leader đọc mã -> đặt lại -> đăng nhập bằng mật khẩu mới", async () => {
  await user.logout();
  await user.requestCode("reset", email("user"));
  const code = await leader.readCode(email("user"));
  await user.submitCode("reset", code, NEW_PASSWORD());
  await user.logout();
  user.allow(401, /\/auth\/login$/);
  await user.login(email("user"), PASSWORD()); // the old password must fail
  await expect(user.page.getByRole("alert")).toBeVisible();
  await user.login(email("user"), NEW_PASSWORD());
  await expect(user.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
});

test("sai mật khẩu 5 lần thì khoá tài khoản", async () => {
  guard.allow(401, /\/auth\/login$/).allow(423, /\/auth\/login$/);
  await guard.page.goto("/dang-nhap");
  for (let i = 0; i < 5; i++) {
    await guard.page.getByLabel("Email").fill(email("lock"));
    await guard.page.getByLabel("Mật khẩu").fill(`sai-mat-khau-${i}-xyz`);
    await guard.page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(guard.page.getByRole("alert")).toBeVisible();
  }
  await expect(guard.page.getByRole("alert")).toContainText("khoá");
  // Even the right password is refused during the lock.
  await guard.page.getByLabel("Mật khẩu").fill(PASSWORD());
  await guard.page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(guard.page.getByRole("alert")).toContainText("quá nhiều lần");
  await guard.shot("08-lockout");
});

test("token cá nhân: tạo -> chờ duyệt -> Admin duyệt -> dùng được với API", async ({ request }) => {
  await user.page.goto("/tai-khoan/token");
  await user.page.getByLabel("Tên token").fill(`Claude Code ${p}`);
  await user.page.getByLabel(/system:whoami/).check();
  await user.page.getByRole("button", { name: "Tạo token" }).click();
  const shown = user.page.locator("code.font-mono");
  await expect(shown).toBeVisible();
  const token = ((await shown.textContent()) ?? "").trim();
  expect(token).toMatch(/^soe_pat_/);
  await expect(user.page.getByText("Chờ duyệt", { exact: true })).toBeVisible();
  await user.shot("09-token-pending");

  const pending = await request.get(`${API}/api/v1/system/whoami`, { headers: { authorization: `Bearer ${token}` } });
  expect(pending.status(), "token chưa duyệt không dùng được").toBe(401);

  await admin.clickMenu("Duyệt token");
  const row = admin.page.getByRole("row", { name: new RegExp(`Claude Code ${p}`) });
  await expect(row).toBeVisible();
  await admin.shot("10-token-approval");
  await row.getByRole("button", { name: "Duyệt" }).click();
  await expect(row).toBeHidden(); // the pending tab no longer lists it
  await admin.page.getByRole("button", { name: "Đang dùng" }).click();
  await expect(admin.page.getByRole("row", { name: new RegExp(`Claude Code ${p}`) })).toBeVisible();

  const ok = await request.get(`${API}/api/v1/system/whoami`, { headers: { authorization: `Bearer ${token}` } });
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { data: { via: string; scopes: string[] } };
  expect(body.data.via).toBe("api");
  expect(body.data.scopes).toEqual(["system:whoami"]);
  await user.page.reload();
  await expect(user.page.getByText("Đang dùng", { exact: true })).toBeVisible();
});

test("tài khoản hệ thống: tạo, cấp token (hiện một lần), dùng, thu hồi", async ({ request }) => {
  await admin.clickMenu("Tài khoản hệ thống");
  await admin.page.getByRole("button", { name: "Tạo tài khoản hệ thống" }).click();
  const d = admin.page.getByRole("dialog", { name: "Tạo tài khoản hệ thống" });
  await d.getByLabel("Tên", { exact: true }).fill(`Hệ thống ngoài ${p}`);
  await d.getByRole("checkbox", { name: /deal:deal:read/ }).check();
  await d.getByRole("checkbox", { name: new RegExp(nameOf("manager")) }).check();
  await d.getByRole("button", { name: "Lưu" }).click();
  await expect(d).toBeHidden();
  const card = admin.page.locator("div.rounded-xl", { hasText: `Hệ thống ngoài ${p}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText(nameOf("manager"));
  await card.getByRole("button", { name: "Cấp token" }).click();
  const t = admin.page.getByRole("dialog", { name: /Cấp token/ });
  await t.getByLabel("Tên token").fill("Đẩy deal");
  await t.getByRole("button", { name: "Tạo token" }).click();
  const token = ((await admin.page.getByTestId("new-token").textContent()) ?? "").trim();
  expect(token).toMatch(/^soe_svc_/);
  await admin.shot("11-service-account");
  expect((await request.get(`${API}/api/v1/system/whoami`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(200);
  await card.getByRole("button", { name: "Thu hồi" }).click();
  await expect(card.getByText("Đã thu hồi")).toBeVisible();
  expect((await request.get(`${API}/api/v1/system/whoami`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(401);
});

test("Manager: trang cấp dữ liệu Guest chỉ là khung, hiện trạng thái trống", async () => {
  await manager.page.goto("/");
  await manager.clickMenu("Cấp dữ liệu Guest");
  await expect(manager.page.getByTestId("grants-empty")).toContainText("Chưa có loại dữ liệu nào");
  await expect(manager.page.getByRole("button", { name: "Cấp dữ liệu" })).toBeDisabled();
  await expect(manager.page.getByText("Chưa cấp dữ liệu cho Guest nào.")).toBeVisible();
  await manager.shot("12-guest-grants-empty");
  expect(await manager.hasMenu("Nhật ký")).toBe(false);
});

test("User mở trang Admin bằng đường dẫn: thấy 'Không có quyền', API trả 403, menu không có mục Admin", async () => {
  await user.page.goto("/quan-tri/nhat-ky");
  await expect(user.page.getByRole("heading", { name: "Không có quyền" })).toBeVisible();
  await user.shot("13-forbidden");
  for (const url of ["/quan-tri/token", "/quan-tri/cai-dat", "/quan-tri/chuyen-giao", "/cap-du-lieu"]) {
    await user.page.goto(url);
    await expect(user.page.getByRole("heading", { name: "Không có quyền" }), url).toBeVisible();
  }
  for (const label of ["Nhật ký", "Duyệt token", "Cài đặt hệ thống", "Chuyển giao", "Tài khoản hệ thống"]) {
    expect(await user.hasMenu(label), label).toBe(false);
  }
  const res = await user.page.request.get("/api/v1/system/audit-log");
  expect(res.status()).toBe(403);
  const json = (await res.json()) as { error: { code: string } };
  expect(json.error.code).toBe("forbidden");
});

test("cài đặt hệ thống: đổi, lưu, tải lại vẫn giữ; giá trị sai báo lỗi dễ hiểu", async () => {
  admin.allow(400, /\/system\/settings\//);
  await admin.page.goto("/");
  await admin.clickMenu("Cài đặt hệ thống");
  const trash = admin.page.getByTestId("setting-trash.retention_days");
  const days = p === "desktop" ? "14" : "21"; // settings are shared by both projects: use a different value in each
  await trash.getByLabel("Số ngày giữ thùng rác").fill(days);
  await trash.getByRole("button", { name: "Lưu" }).click();
  await expect(trash.getByText("Đã lưu.")).toBeVisible();

  const audit = admin.page.getByTestId("setting-audit.retention_days");
  await expect(audit).toContainText("730");
  await audit.getByLabel("Số ngày giữ nhật ký hệ thống").fill("100");
  await audit.getByRole("button", { name: "Lưu" }).click();
  await expect(audit.getByRole("alert")).toContainText("tối thiểu là 730");

  const domains = admin.page.getByTestId("setting-auth.allowed_domains");

  // A value the browser cannot judge: the server's Vietnamese message is shown.
  await domains.getByLabel("Tên miền email được đăng ký").fill("khong hop le");
  await domains.getByRole("button", { name: "Lưu" }).click();
  await expect(domains.getByRole("alert")).toContainText("không hợp lệ");
  await domains.getByLabel("Tên miền email được đăng ký").fill("base.vn, example.com");
  await domains.getByRole("button", { name: "Lưu" }).click();
  await expect(domains.getByText("Đã lưu.")).toBeVisible();

  const guestSale = admin.page.getByTestId("setting-auth.auto_guest_sale").getByRole("checkbox");
  await guestSale.click();
  await expect(guestSale).toBeChecked();
  await expect(admin.page.getByTestId("setting-auth.google_enabled")).toContainText("Đang tắt");
  await admin.shot("14-settings");

  await admin.page.reload();
  await expect(admin.page.getByTestId("setting-trash.retention_days").getByLabel("Số ngày giữ thùng rác")).toHaveValue(days);
  await expect(admin.page.getByTestId("setting-auth.allowed_domains").getByLabel("Tên miền email được đăng ký")).toHaveValue("base.vn, example.com");
  await expect(admin.page.getByTestId("setting-auth.auto_guest_sale").getByRole("checkbox")).toBeChecked();
  // Put the shared settings back.
  const trash2 = admin.page.getByTestId("setting-trash.retention_days");
  await trash2.getByLabel("Số ngày giữ thùng rác").fill("7");
  await trash2.getByRole("button", { name: "Lưu" }).click();
  await expect(trash2.getByText("Đã lưu.")).toBeVisible();
  await admin.page.getByTestId("setting-auth.auto_guest_sale").getByRole("checkbox").click();
  await expect(admin.page.getByTestId("setting-auth.auto_guest_sale")).toContainText("Đang tắt");
  const d2 = admin.page.getByTestId("setting-auth.allowed_domains");
  await d2.getByLabel("Tên miền email được đăng ký").fill("base.vn");
  await d2.getByRole("button", { name: "Lưu" }).click();
  await expect(d2.getByText("Đã lưu.")).toBeVisible();
});

/** One audit entry: a table row on desktop, a card on phone. */
const auditRow = (re: RegExp) => (p === "phone" ? admin.page.getByTestId("audit-cards").locator("> div").filter({ hasText: re }) : admin.page.getByRole("row", { name: re }));

test("nhật ký: lọc theo hành động, người, kết quả; chi tiết cũ -> mới; phân trang; xuất CSV", async () => {
  await admin.clickMenu("Nhật ký");
  const form = admin.page.getByRole("form", { name: "Bộ lọc nhật ký" });

  // The personal token actions of the earlier flow.
  await form.getByLabel("Hành động").fill("auth.token");
  await form.getByRole("button", { name: "Lọc", exact: true }).click();
  await expect(auditRow(/auth\.token\.create/).first()).toBeVisible();
  await expect(auditRow(/auth\.token\.approve/).first()).toBeVisible();
  await admin.shot("15-audit-token");

  // The old -> new view of a settings change.
  await form.getByLabel("Hành động").fill("system.setting.set");
  await form.getByLabel("Người thực hiện").fill(email("admin"));
  await form.getByRole("button", { name: "Lọc", exact: true }).click();
  await auditRow(/system\.setting\.set/).first().getByRole("button", { name: "Chi tiết" }).click();
  const drawer = admin.page.getByRole("dialog", { name: "Chi tiết nhật ký" });
  await expect(drawer).toContainText("Thay đổi (cũ → mới)");
  await expect(drawer).toContainText("value");
  await admin.shot("16-audit-detail");
  await drawer.getByRole("button", { name: "Đóng" }).click();

  // The denied attempt of the User on the audit log.
  await form.getByLabel("Hành động").fill("system.audit");
  await form.getByLabel("Người thực hiện").fill(email("user"));
  await form.getByLabel("Kết quả").selectOption("denied");
  await form.getByRole("button", { name: "Lọc", exact: true }).click();
  await expect(auditRow(/system\.audit\.list/).first()).toBeVisible();
  await expect(auditRow(/Thành công/)).toHaveCount(0);

  // Dates are Vietnamese (dd/mm/yyyy, 24h) in inputs and in the list.
  await expect(form.getByLabel("Từ lúc")).toHaveAttribute("placeholder", "dd/mm/yyyy hh:mm");
  await form.getByLabel("Từ lúc").fill("31/02/2026");
  await expect(form.getByText("Nhập theo dạng dd/mm/yyyy")).toBeVisible();
  await form.getByLabel("Từ lúc").fill("");
  await expect(admin.page.getByText(/\b\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\b/).locator("visible=true").first()).toBeVisible();
  expect(await admin.page.locator('input[type="date"], input[type="datetime-local"]').count()).toBe(0);

  // Rows without a signed-in actor: channel filled, "Chưa đăng nhập", the email that was tried.
  await form.getByLabel("Hành động").fill("auth.login");
  await form.getByLabel("Người thực hiện").fill("");
  await form.getByLabel("Kết quả").selectOption("error");
  await form.getByRole("button", { name: "Lọc", exact: true }).click();
  const anon = auditRow(/auth\.login/).filter({ hasText: "Chưa đăng nhập" }).first();
  await expect(anon).toBeVisible();
  await expect(anon).toContainText(email("lock"));
  await expect(anon).toContainText("Web");
  await expect(anon).toContainText("IP");
  await form.getByLabel("Kết quả").selectOption("");

  // Channel and time range filters work and an empty result says so.
  await form.getByRole("button", { name: "Xoá lọc" }).click();
  await form.getByLabel("Kênh").selectOption("web");
  await form.getByLabel("Từ lúc").fill("01/01/2000 00:00");
  await form.getByLabel("Đến lúc").fill("02/01/2000");
  await form.getByRole("button", { name: "Lọc", exact: true }).click();
  await expect(admin.page.getByText("Không có dòng nhật ký nào khớp bộ lọc.").locator("visible=true")).toBeVisible();

  // Server pagination over the whole log.
  await form.getByRole("button", { name: "Xoá lọc" }).click();
  const next = admin.page.getByRole("button", { name: "Trang sau" });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(admin.page.getByText(/^Trang 2/)).toBeVisible();
  await admin.page.getByRole("button", { name: "Trang trước" }).click();
  await expect(admin.page.getByText(/^Trang 1/)).toBeVisible();

  // CSV export.
  const [download] = await Promise.all([admin.page.waitForEvent("download"), admin.page.getByRole("button", { name: "Xuất CSV" }).click()]);
  const csv = await readFile((await download.path()) ?? "", "utf8");
  expect(csv).toContain("# Xuất bởi");
  expect(csv).toContain("auth.token.approve");
  await admin.shot("17-audit-list");
});

test("chuyển giao dữ liệu: chọn nguồn + đích -> xem trước -> xác nhận -> kết quả; nguồn bị khoá", async () => {
  await admin.clickMenu("Chuyển giao");
  const pick = async (label: string, who: string) => {
    await admin.page.getByLabel(`${label}: tìm`).fill(email(who));
    const opt = admin.page.getByLabel(label, { exact: true }).locator("option", { hasText: email(who) });
    await expect(opt).toHaveCount(1);
    await admin.page.getByLabel(label, { exact: true }).selectOption({ label: `${nameOf(who)} (${email(who)})` });
  };
  await pick("Tài khoản nguồn", "user");
  await pick("Tài khoản nhận", "user2");
  await admin.page.getByRole("button", { name: "Xem trước" }).click();
  await expect(admin.page.getByText("Sẽ chuyển")).toBeVisible();
  await expect(admin.page.getByText(/Token cá nhân: 1/)).toBeVisible();
  await admin.shot("18-transfer-preview");
  await admin.page.getByRole("button", { name: "Xác nhận chuyển giao" }).click();
  await expect(admin.page.getByText("Đã chuyển giao xong")).toBeVisible();
  await admin.shot("19-transfer-result");

  guard.allow(423, /\/auth\/login$/);
  await guard.page.goto("/dang-nhap");
  await guard.login(email("user"), NEW_PASSWORD());
  await expect(guard.page.getByRole("alert")).toContainText("khoá");
  // The locked person's open session was revoked: their next request asks for login again.
  user.allow(401, /\/api\/v1\//);
  await user.page.goto("/tai-khoan");
  await expect(user.page).toHaveURL(/\/dang-nhap/);
});
