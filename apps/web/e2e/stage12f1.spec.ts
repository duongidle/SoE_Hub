import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 12F-1: Onboarding as a journey. The person sees the road (Hành trình), a week drawer, Hôm nay with a tick, and Kết quả của tôi (desktop and 375px);
 * a Leader sees Theo dõi (a row with a mini road per person), the person's page, the plan list and the editor (desktop).
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-12f1-${p}-7714`;
const RUN = Date.now().toString(36);
const email = (who: string) => `${p}.g${who}${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const SHOTS = process.env.ONB_SHOTS ?? path.join(process.cwd(), "e2e/results/stage12f1");
const USER_NAME = () => `Nhân sự 12F1 ${RUN}`;

const vnToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
const dayOfWeek = () => { const d = new Date(`${vnToday()}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const mondayOfWeek = (back = 0) => new Date(new Date(`${vnToday()}T00:00:00Z`).getTime() - (dayOfWeek() - 1 + back) * 86400000).toISOString().slice(0, 10);

let leadApi: ApiClient;
let planId = "";
const sessions: Session[] = [];
const shot = async (s: Session, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.expectNoHorizontalOverflow();
  await s.page.screenshot({ path: path.join(SHOTS, `${s.project}-${name}.png`), fullPage: true });
};

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  const admin = await createAdmin(API, email("admin"), `Admin 12F1 ${RUN}`, PASSWORD(), ROOT);
  const ids = await seedPeople(API, admin, [
    { email: email("mgr"), name: `Manager 12F1 ${RUN}`, roles: ["manager"] },
    { email: email("lead"), name: `Leader 12F1 ${RUN}`, roles: ["leader"], manager: email("mgr") },
    { email: email("u1"), name: USER_NAME(), roles: ["user"], manager: email("mgr"), leader: email("lead") },
  ], PASSWORD());
  leadApi = await new ApiClient(API).login(email("lead"), PASSWORD());
  // A form whose rows count for the checkpoints (the person fills it), then a 6-week plan that started two weeks ago: today is in week 3.
  const dh = await leadApi.call<{ id: string }>("POST", "/datahubs", { name: `Onboarding 12F1 ${RUN}` });
  const f = await leadApi.call<{ id: string }>("POST", "/forms", { name: `Báo cáo 12F1 ${RUN}`, datahub_id: dh.id });
  await leadApi.call("PUT", `/forms/${f.id}/draft`, { config: { title: "Báo cáo", blocks: [
    { id: "nguoi", type: "question", input: "user", label: "Người điền", hidden: true, fill_self: true },
    { id: "nd", type: "question", input: "long_text", label: "Nội dung" },
  ] } });
  await leadApi.call("POST", `/forms/${f.id}/create-columns`, {});
  await leadApi.call("PATCH", `/forms/${f.id}`, { access: "all_accounts" });
  await leadApi.call("POST", `/forms/${f.id}/publish`, {});
  const d = dayOfWeek();
  const plan = await leadApi.call<{ id: string }>("POST", "/onboarding/plans", {
    name: `Lộ trình 12F1 ${RUN}`,
    structure: { stages: [
      { name: "Nền tảng", weeks: [
        { name: "Làm quen", goal: "Biết sản phẩm và quy trình", items: [{ name: "Đọc tài liệu nền tảng", kind: "self_study", weekday: 1 }] },
        { name: "Học phần mềm", items: [{ name: "Session với CS", kind: "session_cs", weekday: 3, due_time: "14:00" }] },
      ] },
      { name: "Thực chiến", weeks: [
        { name: "Đi demo cùng Sale", goal: "Tự demo được luồng cơ bản", items: [
          { name: "Báo cáo hôm nay", kind: "other", weekday: d, due_time: "18:00", form_id: f.id, share_table: true },
          { name: "Làm bài test Work+", kind: "test", weekday: d, due_time: "17:00", form_id: f.id },
          { name: "Review 1-1 với Leader", kind: "review_1_1", weekday: 5 },
        ] },
        { name: "Tự chạy deal", items: [{ name: "Gửi báo cáo tuần", kind: "other", weekday: 5 }] },
        { name: "Chuẩn bị mockup", items: [] },
        { name: "Đánh giá thử việc", items: [] },
      ] },
    ] },
    checkpoints: [
      { week_no: 2, name: "Q&A tuần 2", group: "qna", conditions: [{ type: "metric", form_id: f.id, agg: "count", range: "week", threshold: 3 }] },
      { week_no: 3, name: "Báo cáo tuần 3", group: "daily", conditions: [{ type: "metric", form_id: f.id, agg: "count", range: "week", threshold: 3 }, { type: "manual", label: "Leader xác nhận demo" }] },
      { week_no: null, is_final: true, name: "Đánh giá cuối", conditions: [{ type: "manual", label: "Leader xác nhận" }] },
    ],
  });
  planId = plan.id;
  await leadApi.call("POST", `/onboarding/plans/${plan.id}/assign`, { staff_id: ids[email("u1")], start_date: mondayOfWeek(14) });
  sessions.push(await Session.open(browser, p, "lead"));
  sessions.push(await Session.open(browser, p, "u1"));
  for (const s of sessions) await s.login(email(s.name === "lead" ? "lead" : "u1"), PASSWORD());
});
test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => { for (const s of sessions) await s.close(); });

const user = () => sessions.find((s) => s.name === "u1")!;

test("Nhân sự: Hành trình có con đường theo tuần, mốc tiếp theo, mở tuần trong ngăn kéo", async () => {
  const up = user().page;
  await up.goto("/onboarding");
  await expect(up.getByTestId("onb-hero")).toBeVisible();
  await expect(up.getByTestId("onb-hero-week")).toHaveText("Tuần 3");
  await expect(up.getByTestId("onb-next")).toContainText("Báo cáo tuần 3");
  await expect(up.getByTestId("onb-week")).toHaveCount(6);
  await expect(up.locator('[data-testid="onb-week"][aria-current="step"]')).toHaveCount(1);
  await expect(up.getByTestId("onb-week").first()).toHaveAttribute("data-state", "late");
  await expect(up.getByTestId("onb-flag")).toHaveCount(3);
  await expect(up.getByTestId("onb-week-tasks")).toContainText("Báo cáo hôm nay");
  await expect(up.getByTestId("onb-week-tasks").getByTestId("occ-form").first()).toHaveAttribute("href", /\/f\//);
  await shot(user(), "hanh-trinh");
  await up.getByTestId("onb-week").nth(2).click();
  await expect(up.getByTestId("onb-week-drawer")).toContainText("Báo cáo tuần 3");
  await expect(up.getByRole("dialog")).toContainText("Đi demo cùng Sale");
  await up.waitForTimeout(500); // the drawer slides in
  await shot(user(), "ngan-keo-tuan");
  await up.keyboard.press("Escape");
  await expect(up.getByTestId("onb-week-drawer")).toHaveCount(0);
  // a week that is past with work left opens too
  await up.getByTestId("onb-week").first().click();
  await expect(up.getByTestId("onb-week-drawer")).toContainText("Đọc tài liệu nền tảng");
  await up.keyboard.press("Escape");
});

test("Nhân sự: Hôm nay tick xong một việc (giữ sau khi tải lại), Kết quả của tôi", async () => {
  const up = user().page;
  await up.goto("/onboarding");
  await up.getByRole("tab", { name: "Hôm nay" }).click();
  await expect(up).toHaveURL(/muc=today/);
  await expect(up.getByTestId("onb-today")).toBeVisible();
  const occ = up.getByTestId("onb-occ").filter({ hasText: "Báo cáo hôm nay" }).first();
  await expect(occ).toBeVisible();
  await occ.getByTestId("occ-tick").click();
  await expect(occ.getByTestId("occ-tick")).toBeChecked();
  await up.reload();
  await expect(up.getByTestId("onb-occ").filter({ hasText: "Báo cáo hôm nay" }).first().getByTestId("occ-tick")).toBeChecked();
  await expect(up.getByTestId("onb-late")).toBeVisible();
  await shot(user(), "hom-nay");
  await up.getByRole("tab", { name: "Kết quả của tôi" }).click();
  await expect(up.getByTestId("onb-results")).toBeVisible();
  await expect(up.getByTestId("onb-cp").filter({ hasText: "Báo cáo tuần 3" })).toBeVisible();
  await expect(up.getByTestId("onb-final")).toBeVisible();
  await shot(user(), "ket-qua");
});

test("Leader: Theo dõi có dải lộ trình thu nhỏ mỗi người, mở trang nhân sự, danh sách và trình sửa lộ trình", async () => {
  const lp = sessions.find((s) => s.name === "lead")!.page;
  await lp.goto("/onboarding/theo-doi");
  const row = lp.getByTestId("onb-row").filter({ hasText: USER_NAME() });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("onb-miniroad")).toBeVisible();
  await expect(row.getByTestId("onb-row-progress")).toContainText("%");
  // Column titles over the numbers (wide screens; a phone labels each number inside the card).
  if (p === "desktop") await expect(lp.getByTestId("onb-follow-head")).toContainText("Checkpoint");
  await shot(sessions.find((s) => s.name === "lead")!, "theo-doi");
  await row.click();
  await expect(lp.getByTestId("onb-plan-view")).toBeVisible();
  expect(lp.url()).toContain(planId);
  await expect(lp.getByTestId("onb-hero")).toBeVisible();
  await shot(sessions.find((s) => s.name === "lead")!, "nhan-su");
  await lp.goto("/onboarding/lo-trinh");
  await expect(lp.getByTestId("plan-row").first()).toBeVisible();
  await shot(sessions.find((s) => s.name === "lead")!, "danh-sach-lo-trinh");
  await lp.goto(`/onboarding/lo-trinh/${planId}`);
  await expect(lp.getByTestId("onb-editor")).toBeVisible();
  await lp.getByTestId("ed-item-more").first().click();
  await shot(sessions.find((s) => s.name === "lead")!, "trinh-sua");
});
