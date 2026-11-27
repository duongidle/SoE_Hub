import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 12E-1: the Dynamic Form list (empty state with a button, state chips, shortcut to the response table) and the editor in the new look
 * (three columns, only the sheet scrolls, the "+" line and the type picker, the four steps, the quiz switch in Thiết lập). Pictures at 1440 and 1280.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-12e1-${p}-4417`;
const RUN = Date.now().toString(36);
const email = (who: string) => `${p}.e${who}${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const SHOTS = process.env.FORM_SHOTS ?? path.join(process.cwd(), "e2e/results/stage12e1");

let mgr: Session;
let mgrApi: ApiClient;
let datahubId = "";
let formId = "";
const sessions: Session[] = [];

const shot = async (s: Session, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
};

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "12E-1 chỉ chạy ở desktop");
  const admin = await createAdmin(API, email("admin"), `Admin 12E1 ${RUN}`, PASSWORD(), ROOT);
  await seedPeople(API, admin, [{ email: email("mgr"), name: `Manager 12E1 ${RUN}`, roles: ["manager"] }], PASSWORD());
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  datahubId = (await mgrApi.call<{ id: string }>("POST", "/datahubs", { name: `Khảo sát 12E1 ${RUN}` })).id;
  mgr = await Session.open(browser, p, "mgr");
  sessions.push(mgr);
  await mgr.login(email("mgr"), PASSWORD());
  await expect(mgr.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
});
test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => { for (const s of sessions) await s.close(); });

test("danh sách rỗng có nút; có form thì thấy chip trạng thái và lối tắt mở bảng phản hồi", async () => {
  test.setTimeout(120_000);
  const page = mgr.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/form");
  await expect(page.getByRole("link", { name: "Dynamic Form" }).first()).toBeVisible();
  await expect(page.getByText("Chưa có form nào")).toBeVisible();
  await page.getByRole("button", { name: "Tạo form" }).last().click();
  await expect(page.getByTestId("form-name")).toBeVisible();
  await page.keyboard.press("Escape");

  const f = await mgrApi.call<{ id: string }>("POST", "/forms", { name: `Đánh giá năng lực ${RUN}`, datahub_id: datahubId });
  formId = f.id;
  const opts = [{ id: "oa", label: "Quản trị hệ thống" }, { id: "ob", label: "Quản lý dự án" }, { id: "oc", label: "Quản trị ứng dụng" }];
  const blocks: unknown[] = [
    { id: "h1", type: "heading", text: "Phần 1: Thông tin" },
    { id: "q1", type: "question", input: "text", label: "Họ và tên", required: true, description: "Điền đầy đủ họ tên." },
    { id: "q2", type: "question", input: "single_select", label: "Vai trò hiện tại của bạn", options: opts },
    { id: "q3", type: "question", input: "multi_select", label: "Các vai trò được phân quyền trong dự án", description: "Chọn tất cả các đáp án đúng.", required: true, options: opts },
    { id: "g1", type: "group", title: "Nhóm câu: Đánh giá", blocks: [{ id: "q4", type: "question", input: "rating", label: "Mức độ hài lòng" }, { id: "q5", type: "question", input: "scale", label: "Khả năng giới thiệu", scale: { min: 1, max: 10, min_label: "Thấp", max_label: "Cao" } }] },
    { id: "pb", type: "page_break" },
    { id: "q6", type: "question", input: "long_text", label: "Góp ý thêm" },
    { id: "q7", type: "question", input: "date", label: "Ngày bắt đầu" },
  ];
  await mgrApi.call("PUT", `/forms/${formId}/draft`, { config: { title: `Đánh giá năng lực ${RUN}`, description: "Biểu mẫu đánh giá năng lực vận hành. Vui lòng chọn đầy đủ.", appearance: {}, blocks } });
  await mgrApi.call("POST", `/forms/${formId}/create-columns`, {});
  await mgrApi.call("POST", `/forms/${formId}/publish`, {});
  await page.goto("/form");
  const row = page.getByTestId("form-row").filter({ hasText: RUN });
  await expect(row).toContainText("Đang nhận");
  await shot(mgr, "list-1440");
  await row.getByTestId("open-responses").click();
  await expect(page).toHaveURL(/\/datahub\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
});

for (const [w, h] of [[1440, 900], [1280, 800]] as const) {
  test(`trình soạn ${w}px: ba cột đứng yên, chỉ tờ form cuộn; bảng chọn loại câu; bốn bước`, async () => {
    test.setTimeout(120_000);
    const page = mgr.page;
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/form/${formId}`);
    await expect(page.getByTestId("canvas-block").first()).toBeVisible();
    await page.getByTestId("canvas-block").filter({ hasText: "Các vai trò được phân quyền" }).getByTestId("block-select").click();
    await expect(page.getByTestId("props-panel")).toContainText("Nhiều lựa chọn");
    // the page itself does not scroll; the outline and the properties stay where they are while the sheet scrolls
    const before = await page.getByTestId("props-panel").boundingBox();
    const scroll = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="canvas"]') as HTMLElement;
      sheet.scrollTop = 400;
      return { sheet: sheet.scrollTop, page: document.scrollingElement!.scrollTop, over: sheet.scrollHeight > sheet.clientHeight };
    });
    expect(scroll.over).toBe(true);
    expect(scroll.sheet).toBeGreaterThan(0);
    expect(scroll.page).toBe(0);
    const after = await page.getByTestId("props-panel").boundingBox();
    expect(after!.y).toBe(before!.y);
    await page.evaluate(() => { (document.querySelector('[data-testid="canvas"]') as HTMLElement).scrollTop = 0; });
    await shot(mgr, `editor-${w}`);
    // "+" between two blocks opens the picker: groups by color, two columns
    await page.getByTestId("insert-root-2").click();
    await expect(page.getByTestId("type-picker")).toBeVisible();
    await expect(page.getByTestId("type-picker").getByRole("button")).toHaveCount(24);
    await shot(mgr, `picker-${w}`);
    await page.getByTestId("add-url").click();
    await expect(page.getByTestId("canvas-block").nth(2)).toContainText("Đường dẫn");
    // the four steps, and the tool buttons of the chosen block
    for (const [tab, text] of [["Thiết lập", "Chế độ Bài kiểm tra"], ["Chia sẻ", "Ai điền được"], ["Phản hồi", "phản hồi"], ["Thiết kế", "Mục lục"]] as const) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByText(text).first()).toBeVisible();
    }
    await expect(page.getByTestId("open-table-bar")).toBeVisible();
    await mgrApi.call("PUT", `/forms/${formId}/draft`, { config: { ...(await mgrApi.call<{ draft: Record<string, unknown> }>("GET", `/forms/${formId}`)).draft } });
  });
}

test("Thiết lập: công tắc Chế độ Bài kiểm tra ẩn Mỗi người một phản hồi, ghi chú khác nhau của hai số", async () => {
  test.setTimeout(120_000);
  const page = mgr.page;
  await mgrApi.call("PATCH", `/forms/${formId}`, { access: "all_accounts" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/form/${formId}`);
  await page.getByRole("tab", { name: "Thiết lập" }).click();
  await expect(page.getByTestId("one-per-user")).toBeVisible();
  await expect(page.getByTestId("quiz-settings")).toHaveCount(0);
  await expect(page.getByText("Tổng số phản hồi của cả form")).toBeVisible();
  await page.getByTestId("quiz-enabled").check();
  await expect(page.getByTestId("quiz-settings")).toBeVisible();
  await expect(page.getByTestId("one-per-user")).toHaveCount(0);
  await expect(page.getByTestId("quiz-settings").getByText("Khác với “Số phản hồi tối đa”")).toBeVisible();
  await page.getByTestId("quiz-settings").scrollIntoViewIfNeeded();
  await shot(mgr, "settings-quiz-1440");
  await page.getByTestId("quiz-enabled").uncheck();
  await expect(page.getByTestId("one-per-user")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("Đã lưu nháp");
});
