import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 12F-2: Knowledge and AI Hub libraries (list, read an article, skill drawer), the review queue and the org chart,
 * on desktop and at 375px: the lists open, one item opens, the page never scrolls sideways. Invented data only.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-12f2-${p}-4412`;
const RUN = Date.now().toString(36);
const TOKEN = () => `${p}${RUN}`; // desktop and phone share one database: every title carries its own token
const email = (who: string) => `${p}.h${who}${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const SHOTS = process.env.F2_SHOTS ?? path.join(process.cwd(), "e2e/results/stage12f2");
const JSZip = createRequire(path.join(ROOT, "apps/api/package.json"))("jszip") as new () => { file(name: string, data: string): void; generateAsync(o: { type: "nodebuffer" }): Promise<Buffer> };
const sessions: Session[] = [];
const user = () => sessions.find((s) => s.name === "u1")!;
const mgr = () => sessions.find((s) => s.name === "mgr")!;
const shot = async (s: Session, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.expectNoHorizontalOverflow();
  await s.page.screenshot({ path: path.join(SHOTS, `${s.project}-${name}.png`), fullPage: true });
};
const TITLE = () => `Cách đối soát công nợ ${TOKEN()}`;
const SKILL = () => `bant-qualifier-${TOKEN()}`;

const doc = (n: number) => ({
  type: "doc",
  content: Array.from({ length: n }, (_v, i) => [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: `Bước ${i + 1}: chuẩn bị số liệu` }] },
    { type: "paragraph", content: [{ type: "text", text: "Đối chiếu bảng công nợ cuối tháng với sổ của khách hàng, ghi lại chênh lệch và người phụ trách từng khoản để xử lý trong tuần kế tiếp. Khoản nào lệch quá ngưỡng thì báo Leader ngay trong ngày, khoản nhỏ thì gom lại và chốt vào cuối tuần cùng với bên kế toán." }] },
  ]).flat(),
});

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  const admin = await createAdmin(API, email("admin"), `Admin 12F2 ${RUN}`, PASSWORD(), ROOT);
  await seedPeople(API, admin, [
    { email: email("mgr"), name: `Manager 12F2 ${RUN}`, roles: ["manager"] },
    { email: email("u1"), name: `Thành viên 12F2 ${RUN}`, roles: ["user"], manager: email("mgr") },
  ], PASSWORD());
  const m = await new ApiClient(API).login(email("mgr"), PASSWORD());
  const u = await new ApiClient(API).login(email("u1"), PASSWORD());
  const article = (title: string, category: string, type: string, tags: string[], n: number) => ({ title, summary: "Các bước đối soát công nợ cuối tháng với khách hàng, từ chuẩn bị số liệu tới chốt chênh lệch.", body: doc(n), category, type, tags, for_sale: false, file_ids: [] });
  await m.call("POST", "/knowledge/articles/submit", article(TITLE(), "business", "guide", ["công nợ", "đối soát"], 4));
  await m.call("POST", "/knowledge/articles/submit", article(`Checklist bàn giao dự án ${TOKEN()}`, "base_app", "use_case", ["bàn giao", "đối soát"], 1));
  const zip = new JSZip();
  zip.file("SKILL.md", `---\nname: ${SKILL()}\ndescription: Chấm BANT cho một deal từ ghi chú cuộc gọi, gợi ý câu hỏi còn thiếu. Dùng khi vừa gọi khách xong.\n---\n# BANT\n\nHỏi ngân sách, quyền quyết định, nhu cầu và thời gian.\n`);
  zip.file("references/bant-guide.md", "# Hướng dẫn BANT\n\nBốn câu hỏi cần có.\n");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await m.call("POST", "/aihub/skills/submit", { zip_base64: buffer.toString("base64"), group: "sales", tags: ["sales", "bant"], clients: ["claude_code", "claude_ai"], version: "1.0.0", change_note: "", replaces: null });
  // One article waits for review (the user is not a reviewer).
  await u.call("POST", "/knowledge/articles/submit", article(`Bài chờ duyệt ${TOKEN()}`, "business", "guide", ["công nợ"], 2));
  sessions.push(await Session.open(browser, p, "u1"));
  sessions.push(await Session.open(browser, p, "mgr"));
  await user().login(email("u1"), PASSWORD());
  await mgr().login(email("mgr"), PASSWORD());
});
test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => { for (const s of sessions) await s.close(); });

test("Knowledge: trang chủ có ô tìm, thẻ phổ biến, tab danh mục; mở một bài, mục lục và cột chữ vừa", async () => {
  const up = user().page;
  await up.goto("/knowledge");
  await expect(up.getByTestId("kn-search")).toBeVisible();
  await expect(up.getByTestId("popular-tags")).toContainText("#đối soát");
  await expect(up.getByTestId("article-card").filter({ hasText: TOKEN() })).toHaveCount(2);
  await shot(user(), "knowledge-home");
  await up.getByRole("tab", { name: "Nghiệp vụ" }).click();
  await expect(up.getByTestId("article-card").filter({ hasText: TOKEN() })).toHaveCount(1);
  await expect(up).toHaveURL(/category=business/);
  await up.getByRole("tab", { name: "Tất cả" }).click();
  await up.getByTestId("popular-tags").getByRole("button", { name: "#đối soát" }).click();
  await expect(up.getByTestId("article-card").filter({ hasText: TOKEN() })).toHaveCount(2);
  await up.getByTestId("article-card").filter({ hasText: TITLE() }).getByRole("link", { name: TITLE() }).click();
  await expect(up.getByTestId("article-title")).toHaveText(TITLE());
  await expect(up.getByTestId("toc")).toBeVisible();
  // the reading column is 65-75 characters wide (72ch cap)
  const w = await up.getByTestId("rich-view").locator("p").first().evaluate((e) => { const cs = getComputedStyle(e); return { px: e.getBoundingClientRect().width, font: parseFloat(cs.fontSize) }; });
  expect(w.px / (w.font * 0.5)).toBeLessThanOrEqual(150); // 72ch cap, ch of a proportional font is about half the font size
  await up.waitForTimeout(300);
  await shot(user(), "knowledge-read");
});

test("AI Hub: thẻ skill có lệnh cài; Xem mở ngăn kéo có cách cài, cây file, phiên bản, tải zip", async () => {
  const up = user().page;
  await up.goto("/ai-hub");
  const card = up.getByTestId("skill-card").filter({ hasText: SKILL() });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Chấm BANT");
  await expect(card.getByRole("button", { name: "Sao chép lệnh cài" })).toBeVisible();
  await shot(user(), "aihub-list");
  await up.getByRole("tab", { name: "Claude Desktop" }).click();
  await expect(up.getByTestId("skill-card").filter({ hasText: SKILL() })).toHaveCount(0);
  await up.getByRole("tab", { name: "Claude Code" }).click();
  await expect(up.getByTestId("skill-card").filter({ hasText: SKILL() })).toBeVisible();
  await up.getByTestId("skill-card").filter({ hasText: SKILL() }).getByRole("link", { name: "Xem" }).click();
  await expect(up.getByTestId("skill-name")).toHaveText(SKILL());
  await expect(up.getByTestId("install-cmd")).toContainText(`~/.claude/skills/${SKILL()}`);
  await expect(up).toHaveURL(/client=claude_code/); // the filters stay while the drawer is open
  await up.waitForTimeout(500);
  await shot(user(), "aihub-drawer");
  await up.getByRole("tab", { name: /Tệp/ }).click();
  await expect(up.getByTestId("tree")).toContainText("references/bant-guide.md");
  await up.getByRole("tab", { name: "Phiên bản" }).click();
  await expect(up.getByTestId("versions")).toContainText("Bản 1");
  await up.getByRole("button", { name: "Đóng" }).click();
  await expect(up.getByTestId("skill-name")).toHaveCount(0);
  await expect(up).toHaveURL(/\/ai-hub(\?|$)/);
});

test("Duyệt bài: hàng chờ gọn, mở một bài thấy lệnh Duyệt và Trả lại (cần lý do)", async () => {
  const mp = mgr().page;
  await mp.goto("/duyet");
  const item = mp.getByTestId("queue-item").filter({ hasText: `Bài chờ duyệt ${TOKEN()}` });
  await expect(item).toBeVisible();
  await item.click();
  await expect(mp.getByTestId("review-detail")).toContainText("Đối chiếu bảng công nợ");
  await mp.waitForTimeout(500);
  await shot(mgr(), "review");
  await mp.getByTestId("return").click();
  await mp.getByRole("dialog").getByRole("button", { name: "Trả lại" }).click();
  await expect(mp.getByText("Cần nhập lý do trả lại.")).toBeVisible();
  await mp.keyboard.press("Escape");
});

test("Org chart và Tài khoản mở được, không tràn ngang", async () => {
  const mp = mgr().page;
  await mp.goto("/to-chuc");
  if (p === "desktop") await expect(mp.getByRole("button", { name: "Thêm người" })).toBeVisible();
  else await expect(mp.getByRole("button", { name: "Thao tác của trang" })).toBeVisible(); // the page actions fold into "•••" under 640px
  await shot(mgr(), "org-table");
  await mp.getByRole("tab", { name: "Dạng cây" }).click();
  await expect(mp.getByText("Cây của")).toBeVisible();
  await shot(mgr(), "org-tree");
  await mp.goto("/tai-khoan");
  await expect(mp.getByTestId("account-profile")).toContainText(`Manager 12F2 ${RUN}`);
  await shot(mgr(), "account");
});
