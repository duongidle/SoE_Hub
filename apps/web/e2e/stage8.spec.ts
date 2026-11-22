import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { createAdmin, seedPeople } from "./seed";

/** Stage 8C: Knowledge article and AI Hub skill, through the real screens: write or upload, review, find, download. Invented data only. Desktop only. */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-8-${p}-5521`;
const email = (who: string) => `${p}.s8${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
// jszip belongs to the API package, not the web one.
const JSZip = createRequire(path.join(ROOT, "apps/api/package.json"))("jszip") as new () => { file(name: string, data: string): void; generateAsync(o: { type: "nodebuffer" }): Promise<Buffer> };
let mgrS: Session;
let userS: Session;
let sessions: Session[] = [];
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "Stage 8C chỉ chạy ở desktop");
  const admin = await createAdmin(API, email("admin"), `Admin 8 ${p}`, PASSWORD(), ROOT);
  await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 8 ${p}`, roles: ["manager"] },
      { email: email("u1"), name: `Thành viên 8 ${p}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  mgrS = await Session.open(browser, p, "mgr");
  userS = await Session.open(browser, p, "u1");
  sessions = [mgrS, userS];
  await mgrS.login(email("mgr"), PASSWORD());
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

test("bài Knowledge: soạn, gửi duyệt, Manager duyệt, thành viên tìm không dấu và đọc được", async () => {
  const title = `Quy trình đối soát công nợ ${letters(6)}`;
  const up = userS.page;
  await up.goto("/knowledge/soan");
  await up.getByTestId("f-title").fill(title);
  await up.getByTestId("f-summary").fill("Các bước đối soát công nợ cuối tháng với khách hàng.");
  await up.getByTestId("f-category").selectOption("business");
  await up.getByTestId("f-type").selectOption("guide");
  await up.getByTestId("f-tags").fill("công nợ, đối soát");
  const text = "Cuối tháng kế toán xuất bảng công nợ, gửi cho từng khách để xác nhận số liệu. Khách phản hồi trong ba ngày làm việc. Nếu lệch số thì đối chiếu từng hoá đơn và phiếu thu, ghi chú lý do chênh lệch rồi cập nhật lại bảng. Sau khi hai bên thống nhất, kế toán khoá kỳ và lưu biên bản xác nhận vào hồ sơ khách hàng để tiện tra cứu sau này.";
  await up.getByTestId("body-editor").fill(text);
  await up.getByTestId("check").click();
  await expect(up.getByText("Đạt kiểm tra").first()).toBeVisible();
  await up.getByTestId("submit").click();
  await expect(up).toHaveURL(/\/knowledge\/cua-toi$/);
  await expect(up.getByTestId("mine-item").filter({ hasText: title })).toContainText("Chờ duyệt");

  const mp = mgrS.page;
  await mp.goto("/duyet");
  await mp.getByTestId("queue-item").filter({ hasText: title }).click();
  await expect(mp.getByTestId("review-detail")).toContainText("Cuối tháng kế toán");
  await mp.getByTestId("approve").click();
  await mp.getByRole("dialog").getByRole("button", { name: "Duyệt" }).click();
  await expect(mp.getByTestId("queue-item").filter({ hasText: title })).toHaveCount(0);

  await up.goto("/knowledge");
  await up.getByTestId("kn-search").fill("doi soat cong no");
  await up.getByTestId("kn-search-go").click();
  const card = up.getByTestId("kn-results").getByTestId("article-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("link", { name: title }).click();
  await expect(up.getByTestId("article-title")).toHaveText(title);
  await expect(up.getByTestId("rich-view")).toContainText("Cuối tháng kế toán");
});

test("skill AI Hub: tải zip có đường dẫn cá nhân, gửi kèm cảnh báo, Manager thấy cảnh báo ở đầu, duyệt, tải zip về", async () => {
  const name = `chao-hang-khach-${letters(8)}`;
  const zip = new JSZip();
  zip.file("SKILL.md", `---\nname: ${name}\ndescription: Soạn email chào hàng cho khách mới. Dùng khi sale cần viết email đầu tiên cho một khách.\n---\n# Email chào hàng\n\nMẫu lưu ở /Users/nguoi-nao-do/work/mau.md để tham khảo.\n`);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  const up = userS.page;
  await up.goto("/ai-hub/tai-len");
  await up.getByTestId("zip-input").setInputFiles({ name: `${name}.zip`, mimeType: "application/zip", buffer });
  await expect(up.getByTestId("pkg-name")).toContainText(`${name}.zip`);
  await up.getByTestId("f-group").selectOption("sales");
  await up.getByTestId("check").click();
  await expect(up.getByText("Đạt, có cảnh báo")).toBeVisible();
  await expect(up.getByTestId("issues-all")).toContainText("đường dẫn máy cá nhân");
  await up.getByTestId("submit").click();
  await expect(up).toHaveURL(/\/ai-hub\/cua-toi$/);
  await expect(up.getByTestId("mine-item").filter({ hasText: name })).toContainText("Chờ duyệt");

  const mp = mgrS.page;
  await mp.goto("/duyet");
  await mp.getByTestId("queue-item").filter({ hasText: name }).click();
  await expect(mp.getByTestId("review-warnings")).toContainText("đường dẫn máy cá nhân");
  await mp.getByTestId("approve").click();
  await mp.getByRole("dialog").getByRole("button", { name: "Duyệt" }).click();
  await expect(mp.getByTestId("queue-item").filter({ hasText: name })).toHaveCount(0);

  await up.goto("/ai-hub");
  await up.getByTestId("ah-search").fill(name);
  await up.getByRole("button", { name: "Tìm", exact: true }).click();
  await up.getByTestId("skill-card").filter({ hasText: name }).getByRole("link", { name }).click();
  await expect(up.getByTestId("skill-name")).toHaveText(name);
  await expect(up.getByTestId("install-cmd")).toContainText(`~/.claude/skills/${name}`);
  const dl = up.waitForEvent("download");
  await up.getByTestId("download-skill").click();
  expect((await dl).suggestedFilename()).toBe(`${name}.zip`);
  await expect(up.getByTestId("download-count")).toHaveText("1");
});
