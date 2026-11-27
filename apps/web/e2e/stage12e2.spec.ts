import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 12E-2: the public form page in the new look (frosted bar with progress, cover strip, question cards, wide choice rows, question map and
 * draft note on a desktop, submit bar pinned to the bottom on a phone, thank-you page), the grading screen, and the lower type picker.
 * The public flow runs in both projects (desktop and 375px); no horizontal overflow on a phone.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-12e2-${p}-6603`;
const RUN = Date.now().toString(36);
const email = (who: string) => `${p}.f${who}${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const SHOTS = process.env.FORM_SHOTS ?? path.join(process.cwd(), "e2e/results/stage12e2");

let mgrApi: ApiClient;
let userApi: ApiClient;
let datahubId = "";
let publicForm: { id: string; code: string };
const sessions: Session[] = [];

const shot = async (s: Session, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.page.screenshot({ path: path.join(SHOTS, `${s.project}-${name}.png`), fullPage: false });
};

async function makeForm(name: string, blocks: unknown[], access: "public" | "all_accounts", quiz?: Record<string, unknown>) {
  const f = await mgrApi.call<{ id: string; code: string }>("POST", "/forms", { name, datahub_id: datahubId });
  await mgrApi.call("PUT", `/forms/${f.id}/draft`, { config: { title: name, description: "Khảo sát ngắn về trải nghiệm dùng sản phẩm. Điền đủ các câu bắt buộc rồi gửi.", appearance: { thank_you: { text: "Đã nhận, cảm ơn bạn!" } }, ...(quiz ? { quiz } : {}), blocks } });
  await mgrApi.call("POST", `/forms/${f.id}/create-columns`, {});
  await mgrApi.call("PATCH", `/forms/${f.id}`, { access });
  await mgrApi.call("POST", `/forms/${f.id}/publish`, {});
  return f;
}

test.beforeAll(async ({ browser: _b }, info) => {
  p = info.project.name as ProjectName;
  const admin = await createAdmin(API, email("admin"), `Admin 12E2 ${RUN}`, PASSWORD(), ROOT);
  await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 12E2 ${RUN}`, roles: ["manager"] },
      { email: email("u1"), name: `Thành viên 12E2 ${RUN}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  userApi = await new ApiClient(API).login(email("u1"), PASSWORD());
  datahubId = (await mgrApi.call<{ id: string }>("POST", "/datahubs", { name: `Khảo sát 12E2 ${RUN}`})).id;
  const kinds = [{ id: "oa", label: "Doanh nghiệp" }, { id: "ob", label: "Cá nhân" }, { id: "oc", label: "Tổ chức khác" }];
  publicForm = await makeForm(`Khảo sát 12E2 ${p} ${RUN}`, [
    { id: "g1", type: "group", title: "Thông tin chung", blocks: [
      { id: "name", type: "question", input: "text", label: "Họ tên", required: true },
      { id: "mail", type: "question", input: "email", label: "Email liên hệ" },
      { id: "kind", type: "question", input: "single_select", label: "Loại khách", options: kinds },
    ] },
    { id: "g2", type: "group", title: "Đánh giá", blocks: [
      { id: "roles", type: "question", input: "multi_select", label: "Tính năng bạn dùng", description: "Chọn tất cả đáp án đúng.", options: kinds },
      { id: "star", type: "question", input: "rating", label: "Mức độ hài lòng" },
      { id: "nps", type: "question", input: "scale", label: "Khả năng giới thiệu", scale: { min: 1, max: 10, min_label: "Thấp", max_label: "Cao" } },
    ] },
    { id: "pb", type: "page_break" },
    { id: "day", type: "question", input: "date", label: "Ngày bắt đầu dùng" },
    { id: "num", type: "question", input: "number", label: "Số người dùng" },
    { id: "ok", type: "question", input: "checkbox", label: "Tôi đồng ý được liên hệ lại" },
    { id: "note", type: "question", input: "long_text", label: "Góp ý thêm" },
  ], "public");
});
test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => { for (const s of sessions) await s.close(); });

test("form công khai: thanh tiến độ, thẻ câu, lưu nháp, bản đồ câu (máy tính), nút nộp ghim đáy (điện thoại), trang cảm ơn", async ({ browser }) => {
  test.setTimeout(150_000);
  const phone = p === "phone";
  const anon = await Session.open(browser, p, "anon");
  sessions.push(anon);
  anon.allow(401, /auth\/me/);
  const page = anon.page;
  if (!phone) await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/f/${publicForm.code}`);
  await expect(page.getByTestId("form-renderer")).toBeVisible();
  await expect(page.getByTestId("fill-bar")).toBeVisible();
  await expect(page.getByTestId("fill-progress")).toContainText("0/10");
  await expect(page.getByTestId("form-progress")).toContainText("Trang 1 / 2");
  await expect(page.getByText("PHẦN 1 / 2", { exact: false })).toBeVisible();
  await anon.expectNoHorizontalOverflow();
  await shot(anon, "fill-top");

  await page.getByLabel("Họ tên").fill("Nguyễn An");
  await page.getByLabel("Email liên hệ").fill("an@example.com");
  await page.getByRole("radio", { name: "Doanh nghiệp" }).check();
  await page.getByRole("checkbox", { name: "Cá nhân" }).check();
  await page.getByTestId("star-4").click();
  await page.getByTestId("nps-9").click();
  await expect(page.getByTestId("fill-progress")).toContainText("6/10");
  await page.getByTestId("star-4").scrollIntoViewIfNeeded();
  await anon.expectNoHorizontalOverflow();
  await shot(anon, "fill-middle");

  if (phone) {
    // no question map; the submit bar stays inside the screen, at the bottom
    await expect(page.getByTestId("question-map")).toBeHidden();
    const box = (await page.getByTestId("form-next").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(812);
    expect(box.y).toBeGreaterThan(812 - 120);
  } else {
    await expect(page.getByTestId("draft-note")).toContainText("Đã lưu nháp lúc");
    await expect(page.getByTestId("question-map").getByRole("button")).toHaveCount(10);
  }

  // the draft stays in the browser
  await page.reload();
  await expect(page.getByLabel("Họ tên")).toHaveValue("Nguyễn An");
  await expect(page.getByRole("radio", { name: "Doanh nghiệp" })).toBeChecked();

  if (!phone) {
    // the map jumps to a question of the other page
    await page.getByRole("button", { name: /Tới câu 8/ }).click();
    await expect(page.getByTestId("form-progress")).toContainText("Trang 2 / 2");
    await expect(page.getByLabel("Số người dùng")).toBeFocused();
    await shot(anon, "fill-page2");
  } else {
    await page.getByTestId("form-next").click();
    await expect(page.getByTestId("form-progress")).toContainText("Trang 2 / 2");
  }
  await page.getByLabel("Ngày bắt đầu dùng").fill("25/12/2026");
  await page.getByLabel("Số người dùng").fill("12");
  await page.getByRole("checkbox", { name: "Tôi đồng ý được liên hệ lại" }).check();
  await page.getByLabel("Góp ý thêm").fill("Rất ổn, mong có thêm báo cáo.");
  await anon.expectNoHorizontalOverflow();
  await page.waitForTimeout(3500); // a person needs at least 3 seconds
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("fill-notice")).toContainText("Đã nhận, cảm ơn bạn!");
  await expect(page.getByTestId("fill-again")).toBeVisible();
  await anon.expectNoHorizontalOverflow();
  await shot(anon, "fill-thanks");
});

test("form công khai: thiếu câu bắt buộc thì báo ở thẻ câu và nhảy tới câu đó", async ({ browser }) => {
  test.setTimeout(90_000);
  const anon = await Session.open(browser, p, "anon-missing");
  sessions.push(anon);
  anon.allow(401, /auth\/me/);
  const page = anon.page;
  await page.goto(`/f/${publicForm.code}`);
  await page.getByTestId("form-next").click();
  await expect(page.getByText("Câu này bắt buộc.")).toBeVisible();
  await expect(page.getByLabel("Họ tên")).toBeFocused();
  await anon.expectNoHorizontalOverflow();
  await shot(anon, "fill-error");
});

test("Chấm bài và bảng chọn loại câu (máy tính)", async ({ browser }) => {
  test.skip(p === "phone", "chỉ ở desktop");
  test.setTimeout(150_000);
  const quiz = { enabled: true, scale: "100", pass: { type: "percent", value: 50 }, max_attempts: 2, show: "score" };
  const exam = await makeForm(`Bài thi 12E2 ${RUN}`, [
    { id: "c", type: "question", input: "single_select", label: "Thủ đô của Việt Nam", options: [{ id: "oa", label: "Hà Nội" }, { id: "ob", label: "Huế" }], answer: "Hà Nội", points: 5 },
    { id: "e", type: "question", input: "long_text", label: "Viết về team của bạn", points: 5 },
  ], "all_accounts", quiz);
  await userApi.call("POST", `/fill/${exam.code}/submit`, { attempt_id: randomUUID(), answers: { c: "Hà Nội", e: "Team nhỏ, làm việc chăm chỉ." } });
  const mgr = await Session.open(browser, p, "mgr");
  sessions.push(mgr);
  await mgr.login(email("mgr"), PASSWORD());
  await expect(mgr.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  const page = mgr.page;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/form/cham-bai");
  const row = page.getByTestId("grade-row").filter({ hasText: `Bài thi 12E2 ${RUN}`});
  await expect(row).toContainText("Chờ chấm");
  await row.click();
  await expect(page.getByTestId("grade-form")).toBeVisible();
  await shot(mgr, "grading-1440");
  // a narrow page: the answer opens in a drawer
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/form/cham-bai");
  await page.getByTestId("grade-row").filter({ hasText: `Bài thi 12E2 ${RUN}`}).click();
  await expect(page.getByRole("dialog").getByTestId("grade-form")).toBeVisible();
  await page.waitForTimeout(500); // the drawer slides in
  await shot(mgr, "grading-800-drawer");
  await page.getByRole("dialog").getByTestId("grade-points").fill("5");
  await page.getByTestId("grade-submit").click();
  await expect(page.getByText("Đã lưu điểm")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Tất cả" }).click();
  await expect(page.getByTestId("grade-row").filter({ hasText: `Bài thi 12E2 ${RUN}`})).toContainText("Đạt");

  // the response tab in the new look
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/form/${exam.id}`);
  await page.getByRole("tab", { name: /Phản hồi/ }).click();
  await expect(page.getByTestId("response-table")).toContainText("Đạt");
  await shot(mgr, "responses-1440");

  // the type picker fits a 900px screen (and a 800px one) without scrolling
  for (const h of [900, 800]) {
    await page.setViewportSize({ width: 1440, height: h });
    await page.goto(`/form/${publicForm.id}`);
    await expect(page.getByTestId("canvas-block").first()).toBeVisible();
    await page.getByTestId("insert-root-1").click();
    await expect(page.getByTestId("type-picker")).toBeVisible();
    await expect(page.getByTestId("type-picker").getByRole("button")).toHaveCount(24);
    const box = (await page.getByTestId("type-picker").boundingBox())!;
    expect(box.y + box.height + 12, `bảng chọn loại cao quá ${h}px`).toBeLessThanOrEqual(h);
    if (h === 900) await shot(mgr, "picker-1440");
    await page.keyboard.press("Escape");
  }
});
