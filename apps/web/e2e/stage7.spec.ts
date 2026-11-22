import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 7B1: the form list and the editor (add questions, drag and drop with the real mouse, link columns, conditions, publish),
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
    ],
    PASSWORD(),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  userApi = await new ApiClient(API).login(email("u1"), PASSWORD());
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
  test("tạo form, thêm câu, kéo thả đổi thứ tự, nối cột, điều kiện hiện, xuất bản", async () => {
    test.setTimeout(180_000);
    const page = mgr.page;
    const titles = () => page.getByTestId("canvas-block").getByTestId("block-title").allTextContents();
    const saved = () => expect(page.getByTestId("save-status")).toHaveText("Đã lưu nháp");

    await page.goto("/form");
    await page.getByTestId("new-form").click();
    await page.getByTestId("form-name").fill(`Khảo sát ${p}`);
    await page.getByTestId("form-target-datahub").selectOption(datahubId);
    await page.getByTestId("form-create-submit").click();
    await expect(page).toHaveURL(/\/form\/[0-9a-f-]{36}$/);
    const formId = page.url().split("/").pop()!;

    // three questions, then a fourth for the "choose an unlinked column" path
    for (const [kind, label] of [["text", "Họ tên"], ["single_select", "Bạn thích gì"], ["number", "Tuổi"]] as const) {
      await page.getByTestId(`add-${kind}`).click();
      await page.getByTestId("q-label").fill(label);
    }
    await expect.poll(titles).toEqual(["Họ tên", "Bạn thích gì", "Tuổi"]);
    await saved();

    // drag the third question to the top with the real mouse
    const handle = (title: string) => page.getByTestId("canvas-block").filter({ has: page.getByTestId("block-title").getByText(title, { exact: true }) }).getByTestId(/^drag-/).first();
    const from = (await handle("Tuổi").boundingBox())!;
    const to = (await handle("Họ tên").boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y - 4, { steps: 25 });
    await page.mouse.up();
    await expect.poll(titles).toEqual(["Tuổi", "Họ tên", "Bạn thích gì"]);
    await saved();
    await page.reload();
    await expect.poll(titles).toEqual(["Tuổi", "Họ tên", "Bạn thích gì"]);

    // the Down button moves it back one place
    await page.getByTestId("canvas-block").first().getByTestId("block-down").click();
    await expect.poll(titles).toEqual(["Họ tên", "Tuổi", "Bạn thích gì"]);

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
    await page.getByTestId("add-text").click();
    await page.getByTestId("q-label").fill("Ghi chú");
    await page.getByTestId("link-open").click();
    await page.getByTestId("link-pick").selectOption({ label: "Ghi chú" });
    await page.getByTestId("link-existing").click();
    await expect(page.getByTestId("link-status")).toContainText("Đã nối với cột Ghi chú");

    // the condition: show "Ghi chú" when "Bạn thích gì" is "Lựa chọn 1"
    await page.getByTestId("cond-add").click();
    const cond = page.getByTestId("cond-editor");
    await cond.getByLabel("Câu hỏi").selectOption({ label: "Bạn thích gì" });
    await cond.getByLabel("Giá trị").selectOption("Lựa chọn 1");
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
    await expect(note.locator("..")).toContainText("Sắp có");
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
    await page.getByRole("tab", { name: "Bài kiểm tra" }).click();
    await page.getByTestId("quiz-enabled").check();
    await page.getByTestId("quiz-pass").fill("50");
    await page.getByTestId("quiz-show").selectOption("score");
    await page.getByRole("tab", { name: "Soạn" }).click();
    await page.getByTestId("canvas-block").filter({ hasText: "Thủ đô" }).getByTestId("block-select").click();
    await page.getByTestId("q-points").fill("5");
    await page.getByTestId("q-answer").selectOption("Hà Nội");
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
