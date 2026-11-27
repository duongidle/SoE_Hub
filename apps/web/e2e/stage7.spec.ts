import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName, chooseOption } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 7B1: the form list and the editor (add questions with the "+" line and the arrows, link columns, conditions, publish),
 * and the quiz (answers, hand grading screen). Every account is made up. Desktop only.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-7-${p}-5521`;
const email = (who: string) => `${p}.s7${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
let mgr: Session;
let mgrApi: ApiClient;
let userApi: ApiClient;
let guestApi: ApiClient;
let datahubId = "";
let sessions: Session[] = [];

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "Stage 7B1 chỉ chạy ở desktop");
  const admin = await createAdmin(API, email("admin"), `Admin 7 ${p}`, PASSWORD(), ROOT);
  await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 7 ${p}`, roles: ["manager"] },
      { email: email("u1"), name: `Thành viên 7 ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("g1"), name: `Guest 7 ${p}`, roles: ["guest"], guestPreset: "sale" },
    ],
    PASSWORD(),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  userApi = await new ApiClient(API).login(email("u1"), PASSWORD());
  guestApi = await new ApiClient(API).login(email("g1"), PASSWORD());
  datahubId = (await mgrApi.call<{ id: string }>("POST", "/datahubs", { name: `Khảo sát ${p}` })).id;
  mgr = await Session.open(browser, p, "mgr");
  sessions = [mgr];
  await mgr.login(email("mgr"), PASSWORD());
  await expect(mgr.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
});
test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

test.describe("7B1", () => {
  test("tạo form, thêm câu, đổi thứ tự bằng nút lên/xuống và dấu +, nối cột, điều kiện hiện, xuất bản", async () => {
    test.setTimeout(180_000);
    const page = mgr.page;
    const titles = () => page.getByTestId("canvas-block").getByTestId("block-title").allTextContents();
    const saved = () => expect(page.getByTestId("save-status")).toHaveText("Đã lưu nháp");

    await page.goto("/form");
    await page.getByTestId("new-form").click();
    await page.getByTestId("form-name").fill(`Khảo sát ${p}`);
    await chooseOption(page.getByTestId("form-target-datahub"), datahubId);
    await page.getByTestId("form-create-submit").click();
    await expect(page).toHaveURL(/\/form\/[0-9a-f-]{36}$/);
    const formId = page.url().split("/").pop()!;

    // three questions, then a fourth for the "choose an unlinked column" path
    for (const [kind, label] of [["text", "Họ tên"], ["single_select", "Bạn thích gì"], ["number", "Tuổi"]] as const) {
      await page.getByTestId("add-question").click();
      await page.getByTestId(`add-${kind}`).click();
      await page.getByTestId("q-label").fill(label);
    }
    await expect.poll(titles).toEqual(["Họ tên", "Bạn thích gì", "Tuổi"]);
    await saved();

    // order changes with the arrows of the chosen block (no drag and drop): "Tuổi" up twice
    const pick = (title: string) => page.getByTestId("canvas-block").filter({ has: page.getByTestId("block-title").getByText(title, { exact: true }) }).getByTestId("block-select");
    await pick("Tuổi").click();
    await page.getByTestId("block-up").click();
    await page.getByTestId("block-up").click();
    await expect.poll(titles).toEqual(["Tuổi", "Họ tên", "Bạn thích gì"]);
    await expect(page.getByTestId("block-up")).toBeDisabled();
    await saved();
    await page.reload();
    await expect.poll(titles).toEqual(["Tuổi", "Họ tên", "Bạn thích gì"]);

    // the Down button moves it back one place
    await pick("Tuổi").click();
    await page.getByTestId("block-down").click();
    await expect.poll(titles).toEqual(["Họ tên", "Tuổi", "Bạn thích gì"]);

    // the "+" line between two blocks puts a new one exactly there; the copy of a block comes right after it
    await page.getByTestId("insert-root-1").click();
    await page.getByTestId("add-block-heading").click();
    await expect.poll(titles).toEqual(["Họ tên", "Tiêu đề mới", "Tuổi", "Bạn thích gì"]);
    await page.getByTestId("block-clone").click();
    await expect.poll(titles).toEqual(["Họ tên", "Tiêu đề mới", "Tiêu đề mới", "Tuổi", "Bạn thích gì"]);
    await page.getByTestId("block-delete").click(); // the copy is the chosen block
    await expect.poll(titles).toEqual(["Họ tên", "Tiêu đề mới", "Tuổi", "Bạn thích gì"]);
    await pick("Tiêu đề mới").click();
    await page.getByTestId("block-delete").click();
    await expect.poll(titles).toEqual(["Họ tên", "Tuổi", "Bạn thích gì"]);
    // the outline on the left jumps to a question
    await page.getByTestId("toc-item").filter({ hasText: "Bạn thích gì" }).click();
    await expect(page.getByTestId("q-label")).toHaveValue("Bạn thích gì");

    // link: make a new column for "Họ tên" and "Tuổi"
    for (const t of ["Họ tên", "Tuổi"]) {
      await page.getByTestId("canvas-block").filter({ has: page.getByTestId("block-title").getByText(t, { exact: true }) }).getByTestId("block-select").click();
      await page.getByTestId("link-open").click();
      await page.getByTestId("link-create").click();
      await expect(page.getByTestId("link-status")).toContainText(`Đã nối với cột ${t}`);
    }
    // a fourth question linked to an existing column of the table
    const tableId = (await mgrApi.call<{ table_id: string }>("GET", `/forms/${formId}`)).table_id;
    await mgrApi.call("POST", `/tables/${tableId}/columns`, { name: "Ghi chú", type: "text" });
    await page.getByTestId("canvas-block").filter({ has: page.getByTestId("block-title").getByText("Bạn thích gì", { exact: true }) }).getByTestId("block-select").click();
    await page.getByTestId("add-question").click();
    await page.getByTestId("add-text").click();
    await page.getByTestId("q-label").fill("Ghi chú");
    await page.getByTestId("link-open").click();
    await chooseOption(page.getByTestId("link-pick"), { label: "Ghi chú" });
    await page.getByTestId("link-existing").click();
    await expect(page.getByTestId("link-status")).toContainText("Đã nối với cột Ghi chú");

    // the condition: show "Ghi chú" when "Bạn thích gì" is "Lựa chọn 1"
    await page.getByTestId("cond-add").click();
    const cond = page.getByTestId("cond-editor");
    await chooseOption(cond.getByLabel("Câu hỏi"), { label: "Bạn thích gì" });
    await chooseOption(cond.getByLabel("Giá trị"), "Lựa chọn 1");
    await saved();

    // preview on a phone: the question shows only after the choice
    await page.getByTestId("view-phone").click();
    const frame = page.getByTestId("preview-frame");
    expect((await frame.boundingBox())!.width).toBeLessThanOrEqual(375);
    await expect(frame.getByLabel("Ghi chú")).toHaveCount(0);
    await frame.getByLabel("Lựa chọn 1").check();
    await expect(frame.getByLabel("Ghi chú")).toBeVisible();
    await page.getByTestId("view-edit").click();

    // publish: "Bạn thích gì" has no column yet (the 400 is the expected answer)
    mgr.allow(400, /\/publish$/);
    await page.getByTestId("publish").click();
    await expect(page.getByTestId("publish-issues")).toContainText("chưa nối cột");
    await page.getByTestId("create-columns").click();
    await expect(page.getByTestId("publish-issues")).toHaveCount(0);
    await page.getByTestId("publish").click();
    await expect(page.getByTestId("publish-bar")).toContainText("Đang nhận");
    await expect(page.getByTestId("unpublished-note")).toHaveCount(0);

    // a change after publishing raises the bar
    await page.getByTestId("canvas-block").first().getByTestId("block-select").click();
    await page.getByTestId("q-label").fill("Họ và tên");
    await expect(page.getByTestId("unpublished-note")).toBeVisible();

    // settings: the notification button is shown, off and dimmed
    await page.getByRole("tab", { name: "Thiết lập" }).click();
    const note = page.getByTestId("notify-new-response");
    await expect(note).toBeDisabled();
    await expect(note.locator("xpath=ancestor::label")).toContainText("Sắp có");
    await page.getByRole("tab", { name: "Chia sẻ" }).click();
    await expect(page.getByTestId("form-link")).toHaveValue(/\/f\/[A-Za-z0-9]{10}$/);

    // the list shows it with its state
    await page.goto("/form");
    await expect(page.getByTestId("form-row").filter({ hasText: `Khảo sát ${p}` })).toContainText("Đang nhận");
  });

  test("bài kiểm tra: bật, đáp án, câu tự luận; bài nộp chờ chấm, người chấm cho điểm, kết quả Đạt", async () => {
    test.setTimeout(180_000);
    const page = mgr.page;
    const f = await mgrApi.call<{ id: string; code: string; table_id: string }>("POST", "/forms", { name: `Bài thi ${p}`, datahub_id: datahubId });
    await mgrApi.call("PUT", `/forms/${f.id}/draft`, {
      config: {
        title: `Bài thi ${p}`,
        description: "",
        appearance: {},
        blocks: [
          { id: "q1", type: "question", input: "single_select", label: "Thủ đô của Việt Nam", options: [{ id: "oa", label: "Hà Nội" }, { id: "ob", label: "Huế" }] },
          { id: "q2", type: "question", input: "long_text", label: "Viết về team của bạn" },
        ],
      },
    });
    await mgrApi.call("POST", `/forms/${f.id}/create-columns`, {});
    await mgrApi.call("PATCH", `/forms/${f.id}`, { access: "all_accounts" });

    await page.goto(`/form/${f.id}`);
    await page.getByRole("tab", { name: "Thiết lập" }).click();
    await page.getByTestId("quiz-enabled").check();
    await page.getByTestId("quiz-pass").fill("50");
    await chooseOption(page.getByTestId("quiz-show"), "score");
    await page.getByRole("tab", { name: "Thiết kế" }).click();
    await page.getByTestId("canvas-block").filter({ hasText: "Thủ đô" }).getByTestId("block-select").click();
    await page.getByTestId("q-points").fill("5");
    await chooseOption(page.getByTestId("q-answer"), "Hà Nội");
    await page.getByTestId("canvas-block").filter({ hasText: "Viết về team" }).getByTestId("block-select").click();
    await page.getByTestId("q-points").fill("5");
    await expect(page.getByTestId("save-status")).toHaveText("Đã lưu nháp");
    await page.getByTestId("publish").click();
    await expect(page.getByTestId("publish-bar")).toContainText("Đang nhận");

    // a person fills it in (through the API of the web)
    const sub = await userApi.call<{ quiz: { result: string } }>("POST", `/fill/${f.code}/submit`, { attempt_id: randomUUID(), answers: { q1: "Hà Nội", q2: "Team nhỏ, làm việc chăm chỉ." } });
    expect(sub.quiz.result).toBe("Chờ chấm");

    // the grading screen
    await page.goto("/form/cham-bai");
    await page.getByTestId("grade-row").filter({ hasText: `Bài thi ${p}` }).click();
    await expect(page.getByTestId("grade-answer").filter({ hasText: "Team nhỏ" })).toBeVisible();
    await page.getByTestId("grade-points").fill("5");
    await page.getByTestId("grade-submit").click();
    await page.getByTestId("grade-filter-pending").click();
    await expect(page.getByTestId("grade-row").filter({ hasText: `Bài thi ${p}` })).toHaveCount(0);
    await page.getByRole("button", { name: "Tất cả" }).click();
    await expect(page.getByTestId("grade-row").filter({ hasText: `Bài thi ${p}` })).toContainText("Đạt");

    // what the person sees: the score and Đạt
    const mine = await userApi.call<{ attempts: { result: string; score: number }[] }>("GET", `/fill/${f.code}/mine`);
    expect(mine.attempts[0]).toMatchObject({ result: "Đạt", score: 100 });
    // the responses tab counts it and the table link is there
    await page.goto(`/form/${f.id}`);
    await page.getByRole("tab", { name: /Phản hồi/ }).click();
    await expect(page.getByTestId("response-count")).toContainText("1");
    await expect(page.getByTestId("open-table")).toBeVisible();
  });
});

test.describe("7B2", () => {
  /** A published form made through the API (blocks as the editor would save them), columns created for every question. */
  async function makeForm(name: string, blocks: unknown[], access: "public" | "all_accounts", quiz?: Record<string, unknown>) {
    const f = await mgrApi.call<{ id: string; code: string; table_id: string }>("POST", "/forms", { name, datahub_id: datahubId });
    await mgrApi.call("PUT", `/forms/${f.id}/draft`, { config: { title: name, description: "", appearance: { accent: "green", thank_you: { text: "Đã nhận, cảm ơn bạn!" } }, ...(quiz ? { quiz } : {}), blocks } });
    await mgrApi.call("POST", `/forms/${f.id}/create-columns`, {});
    await mgrApi.call("PATCH", `/forms/${f.id}`, { access });
    await mgrApi.call("POST", `/forms/${f.id}/publish`, {});
    return f;
  }
  const kinds = [{ id: "oa", label: "Doanh nghiệp" }, { id: "ob", label: "Cá nhân" }];
  const publicBlocks = () => [
    { id: "name", type: "question", input: "text", label: "Họ tên", required: true },
    { id: "kind", type: "question", input: "single_select", label: "Loại khách", param: "loai", options: kinds },
    { id: "corp", type: "question", input: "text", label: "Tên công ty", show_if: { field: "kind", op: "eq", value: "oa" } },
    { id: "pb", type: "page_break" },
    { id: "note", type: "question", input: "long_text", label: "Ghi chú" },
    { id: "src", type: "question", input: "text", label: "Nguồn", hidden: true, param: "nguon" },
  ];
  let publicForm: { id: string; code: string };

  test("form công khai ở máy tính: không đăng nhập, câu điều kiện, hai trang, gửi, trang cảm ơn, dòng ở tab Phản hồi, trường ẩn từ link", async ({ browser }) => {
    test.setTimeout(120_000);
    publicForm = await makeForm(`Liên hệ ${p}`, publicBlocks(), "public");
    const anon = await Session.open(browser, p, "anon");
    sessions.push(anon);
    anon.allow(401, /auth\/me/);
    const page = anon.page;
    await page.goto(`/f/${publicForm.code}?nguon=facebook`);
    await expect(page.getByTestId("form-renderer")).toBeVisible();
    await expect(page.getByTestId("form-progress")).toContainText("Trang 1 / 2");
    await expect(page.getByText("Tên công ty")).toHaveCount(0);
    await page.getByRole("radio", { name: "Doanh nghiệp" }).check();
    await expect(page.getByLabel("Tên công ty")).toBeVisible();
    await page.getByLabel("Họ tên").fill("Nguyễn An");
    await page.getByLabel("Tên công ty").fill("Công ty ABC");
    // a draft stays in the browser
    await page.reload();
    await expect(page.getByLabel("Họ tên")).toHaveValue("Nguyễn An");
    await page.getByTestId("form-next").click();
    await expect(page.getByTestId("form-progress")).toContainText("Trang 2 / 2");
    await page.getByLabel("Ghi chú").fill("Cần báo giá gấp");
    await page.waitForTimeout(3500); // a person needs at least 3 seconds
    await page.getByTestId("form-submit").click();
    await expect(page.getByTestId("fill-notice")).toContainText("Đã nhận, cảm ơn bạn!");
    await expect(page.getByTestId("fill-again")).toBeVisible();
    await anon.shot("form-cong-khai-cam-on");
    // the row shows in the Responses tab, the hidden field came from the link
    await mgr.page.goto(`/form/${publicForm.id}`);
    await mgr.page.getByRole("tab", { name: /Phản hồi/ }).click();
    await expect(mgr.page.getByTestId("response-table")).toContainText("Công ty ABC");
    await expect(mgr.page.getByTestId("response-table")).toContainText("facebook");
    await expect(mgr.page.getByTestId("response-table")).toContainText("Doanh nghiệp");
  });

  test("cùng form ở 375px: không tràn ngang, điền sẵn qua link (tên lựa chọn), gửi được", async ({ browser }) => {
    test.setTimeout(120_000);
    const anon = await Session.open(browser, p, "anon375");
    sessions.push(anon);
    anon.allow(401, /auth\/me/);
    const page = anon.page;
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/f/${publicForm.code}?loai=${encodeURIComponent("Cá nhân")}&nguon=dien-thoai`);
    await expect(page.getByTestId("form-renderer")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Cá nhân" })).toBeChecked();
    await anon.expectNoHorizontalOverflow();
    await page.getByLabel("Họ tên").fill("Trần Bình");
    await page.getByTestId("form-next").click();
    await anon.expectNoHorizontalOverflow();
    await page.getByLabel("Ghi chú").fill("Gửi từ điện thoại");
    await page.waitForTimeout(3500);
    await page.getByTestId("form-submit").click();
    await expect(page.getByTestId("fill-notice")).toContainText("Đã nhận, cảm ơn bạn!");
    await anon.expectNoHorizontalOverflow();
    await anon.shot("form-cong-khai-375");
  });

  test("gửi quá nhanh (dưới 3 giây) bị từ chối với câu báo; câu trả lời được giữ", async ({ browser }) => {
    test.setTimeout(60_000);
    const anon = await Session.open(browser, p, "anonfast");
    sessions.push(anon);
    anon.allow(401, /auth\/me/).allow(429, /public\/forms/);
    const page = anon.page;
    await page.goto(`/f/${publicForm.code}`);
    await page.getByLabel("Họ tên").fill("Gửi nhanh");
    await page.getByTestId("form-next").click();
    await page.getByLabel("Ghi chú").fill("Nhanh quá");
    await page.getByTestId("form-submit").click();
    await expect(page.getByTestId("fill-error")).toContainText("Bạn gửi quá nhanh");
    await expect(page.getByLabel("Ghi chú")).toHaveValue("Nhanh quá");
  });

  test("form nội bộ bài kiểm tra: người dùng làm bài trên web (Đạt theo đáp án, Chờ chấm khi có câu tự luận); Guest không mở được", async ({ browser }) => {
    test.setTimeout(120_000);
    const quiz = { enabled: true, scale: "100", pass: { type: "percent", value: 50 }, max_attempts: 2, show: "score" };
    const auto = await makeForm(`Trắc nghiệm ${p}`, [{ id: "c", type: "question", input: "single_select", label: "Thủ đô của Việt Nam", options: [{ id: "oa", label: "Hà Nội" }, { id: "ob", label: "Huế" }], answer: "Hà Nội", points: 5 }], "all_accounts", quiz);
    const manual = await makeForm(`Tự luận ${p}`, [{ id: "e", type: "question", input: "long_text", label: "Viết về team của bạn", points: 5 }], "all_accounts", quiz);
    const u = await Session.open(browser, p, "u1");
    sessions.push(u);
    u.allow(404, /fill\/|public\/forms/);
    await u.login(email("u1"), PASSWORD());
    await expect(u.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
    await u.page.goto(`/f/${auto.code}`);
    await u.page.getByRole("radio", { name: "Hà Nội" }).check();
    await u.page.getByTestId("form-submit").click();
    await expect(u.page.getByTestId("quiz-result")).toContainText("Đạt");
    await expect(u.page.getByTestId("my-quiz-link")).toBeVisible();
    await u.page.getByTestId("my-quiz-link").click();
    await expect(u.page.getByTestId("my-quiz-attempt")).toContainText("Đạt");
    await u.page.goto(`/f/${manual.code}`);
    await u.page.getByLabel("Viết về team của bạn").fill("Team nhỏ, chăm chỉ.");
    await u.page.getByTestId("form-submit").click();
    await expect(u.page.getByTestId("quiz-result")).toContainText("chờ chấm");
    // a Guest is not in "every account"
    await expect(guestApi.call("GET", `/fill/${auto.code}`)).rejects.toThrow();
  });
});

