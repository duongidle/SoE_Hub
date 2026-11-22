import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { createAdmin, seedPeople } from "./seed";

/**
 * Stage 5B: connection screens. A person creates a connection (menus + levels) and gets the install commands; the Admin approves it with less;
 * the Admin's emergency switch stops it on `/mcp`. Every account is made up. Desktop only.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-5-${p}-4417`;
const email = (who: string) => `${p}.s5${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
let adminS: Session;
let userS: Session;
let sessions: Session[] = [];
let token = "";

/** One `tools/call` on /mcp with the token; true when the tool answered without an error. */
async function callWhoami(): Promise<boolean> {
  const res = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "soe_whoami", arguments: {} } }),
  });
  const body = (await res.json()) as { error?: unknown; result?: { isError?: boolean } };
  return res.ok && !body.error && body.result?.isError !== true;
}

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "Stage 5B chỉ chạy ở desktop");
  const admin = await createAdmin(API, email("admin"), `Admin 5 ${p}`, PASSWORD(), ROOT);
  await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 5 ${p}`, roles: ["manager"] },
      { email: email("u1"), name: `Thành viên 5 ${p}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  adminS = await Session.open(browser, p, "admin");
  userS = await Session.open(browser, p, "u1");
  sessions = [adminS, userS];
  await adminS.login(email("admin"), PASSWORD());
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

test("người dùng tạo kết nối chọn menu và thấy lệnh cài điền sẵn", async () => {
  const page = userS.page;
  await page.goto("/tai-khoan/token");
  await page.getByLabel("Tên kết nối").fill(`Claude Code ${p}`);
  await page.getByRole("button", { name: "Tạo kết nối" }).click();
  const box = page.getByTestId("new-connection");
  await expect(box).toBeVisible();
  token = ((await box.locator("code.font-mono").textContent()) ?? "").trim();
  expect(token).toMatch(/^soe_pat_/);
  await expect(page.getByTestId("cmd-Claude Code")).toContainText("claude mcp add --transport http soe");
  await expect(page.getByTestId("cmd-Claude Code")).toContainText("/mcp");
  await expect(page.getByTestId("cmd-Codex")).toContainText("[mcp_servers.soe]");
  await expect(page.getByTestId("cmd-REST")).toContainText("curl");
  const row = page.getByRole("row", { name: new RegExp(`Claude Code ${p}`) });
  await expect(row).toContainText("Quản lý Deal: Sửa");
  await expect(row).toContainText("Chờ duyệt");
  expect(await callWhoami(), "chưa duyệt không dùng được").toBe(false);
});

test("Admin duyệt bớt quyền: bỏ menu Quản lý Deal", async () => {
  const page = adminS.page;
  await page.goto("/quan-tri/token");
  const row = page.getByRole("row", { name: new RegExp(`Claude Code ${p}`) });
  await expect(row).toContainText("Quản lý Deal: Sửa");
  await row.getByRole("button", { name: "Duyệt bớt quyền" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Quản lý Deal").uncheck();
  await d.getByRole("button", { name: "Duyệt với quyền này" }).click();
  await page.getByRole("tab", { name: "Đang dùng" }).click();
  const active = page.getByRole("row", { name: new RegExp(`Claude Code ${p}`) });
  await expect(active).toContainText("Datahub: Sửa");
  await expect(active).not.toContainText("Quản lý Deal");
  expect(await callWhoami(), "đã duyệt dùng được").toBe(true);
});

test("công tắc khẩn cấp chặn /mcp, tắt thì dùng lại được", async () => {
  const page = adminS.page;
  await page.goto("/quan-tri/token");
  const sw = page.getByTestId("ai-killed");
  await sw.click();
  await expect(sw).toBeChecked();
  expect(await callWhoami(), "đang tắt khẩn cấp").toBe(false);
  await sw.click();
  await expect(sw).not.toBeChecked();
  expect(await callWhoami(), "đã bật lại").toBe(true);
});
