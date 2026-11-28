import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 12G-2 (break-ui): the main screens with the worst names a person can type (very long with no space, "<b>", emoji, a very long
 * email). The page must not scroll sideways, and no text may stick out of the card or box it sits in (a scroll box is allowed to scroll).
 */
let p: ProjectName;
const PASSWORD = () => `Kiem-thu-12g2-${p}-7731`;
const RUN = Date.now().toString(36);
const email = (who: string) => `${p}.h${who}${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const SHOTS = process.env.G2_SHOTS ?? path.join(process.cwd(), "e2e/results/stage12g2");
const WORST = `<b>Đậm</b>😀${"Đ".repeat(80)}`;
let s: Session;
const ids: Record<string, string> = {};

test.describe.configure({ mode: "default" });
test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "break-ui chạy ở desktop");
  test.setTimeout(240_000);
  const adm = await createAdmin(API, email("admin"), `Admin 12G2 ${RUN}`, PASSWORD(), ROOT);
  Object.assign(ids, await seedPeople(API, adm, [
    { email: email("mgr"), name: WORST, roles: ["manager"] },
    { email: `${"a".repeat(60)}.${email("lead")}`, name: "A", roles: ["leader"], manager: email("mgr") },
  ], PASSWORD()));
  const m = await new ApiClient(API).login(email("mgr"), PASSWORD());
  const dh = await m.call<{ id: string }>("POST", "/datahubs", { name: WORST });
  ids.dh = dh.id;
  ids.form = (await m.call<{ id: string }>("POST", "/forms", { name: WORST, datahub_id: dh.id })).id;
  const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Đối chiếu bảng công nợ cuối tháng với sổ của khách hàng, ghi lại chênh lệch và người phụ trách từng khoản để xử lý trong tuần kế tiếp. Khoản nào lệch quá ngưỡng thì báo Leader ngay trong ngày, khoản nhỏ thì gom lại và chốt vào cuối tuần cùng với bên kế toán." }] }] };
  await m.call("POST", "/knowledge/articles/submit", { title: WORST, summary: "x".repeat(300), body: doc, category: "business", type: "guide", tags: ["t".repeat(60), "😀"], for_sale: false, file_ids: [] });
  ids.article = (await m.call<{ id: string }[]>("GET", "/knowledge/search?limit=1"))[0]?.id ?? (await m.call<{ id: string }[]>("GET", "/knowledge/mine"))[0]?.id ?? "";
  s = await Session.open(browser, "desktop", "mgr");
  await s.login(email("mgr"), PASSWORD());
  await expect(s.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
});
test.afterAll(async () => { await s?.close(); });

/** A box whose content is wider than the box (text that sticks out or is cut with no ellipsis). A box that scrolls, or ends the text with "...", is fine. */
const bleed = () => {
  const out: string[] = [];
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    if (el.closest("svg, canvas, .sr-only, [data-radix-popper-content-wrapper]") || el.matches(".sr-only")) continue;
    const c = getComputedStyle(el);
    if (c.display === "inline" || c.overflowX === "auto" || c.overflowX === "scroll" || c.textOverflow === "ellipsis") continue;
    if (/sr-only/.test(String((el as HTMLElement).className)) || el.getAttribute("data-testid") === "bell-count") continue;
    if (el.scrollWidth > el.clientWidth + 2 && (el.textContent ?? "").trim()) out.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)} "${(el.textContent ?? "").trim().slice(0, 30)}" (${el.scrollWidth - el.clientWidth}px)`);
  }
  return out;
};

const SCREENS: [string, () => string][] = [
  ["tong-quan", () => "/"],
  ["datahub", () => "/datahub"],
  ["datahub-mo", () => `/datahub/${ids.dh}`],
  ["form", () => "/form"],
  ["form-soan", () => `/form/${ids.form}`],
  ["knowledge", () => "/knowledge"],
  ["knowledge-doc", () => `/knowledge/${ids.article}`],
  ["ai-hub", () => "/ai-hub"],
  ["to-chuc", () => "/to-chuc"],
  ["cai-dat", () => "/cai-dat"],
  ["tai-khoan", () => "/tai-khoan"],
  ["thong-bao", () => "/thong-bao"],
  ["deal", () => "/quan-ly-deal"],
  ["onboarding", () => "/onboarding"],
];
for (const [name, url] of SCREENS) {
  test(`dữ liệu xấu nhất: ${name}`, async () => {
    await s.page.goto(url());
    await s.page.waitForLoadState("networkidle");
    await s.page.waitForTimeout(400);
    fs.mkdirSync(SHOTS, { recursive: true });
    await s.page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    const out = await s.page.evaluate(bleed);
    expect.soft(out, `Chữ tràn khỏi khung ở ${name}`).toEqual([]);
    expect(s.problems).toEqual([]);
  });
}
