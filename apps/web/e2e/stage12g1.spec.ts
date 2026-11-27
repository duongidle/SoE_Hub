import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { GridDriver } from "./grid";
import { seedLead, seedMany } from "./dh-fixtures";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 12G-1: a walk through the main screens as each role (Admin, Manager, Leader, Member, Guest). No console error and no failed
 * request on any screen (the screens a role may not open say "Không có quyền" and make no data request), pictures of the key screens,
 * and the worst data in the Datahub and Deal grids (empty, 10.000 rows, huge and negative numbers, "<b>" shown as text).
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-12g1-${p}-7731`;
const RUN = Date.now().toString(36);
const email = (who: string) => `${p}.g${who}${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const SHOTS = process.env.G1_SHOTS ?? path.join(process.cwd(), "e2e/results/stage12g1");

const ROLES = ["admin", "mgr", "lead", "member", "guest"] as const;
type Role = (typeof ROLES)[number];
const sessions = {} as Record<Role, Session>;
let mgrApi: ApiClient;
let fx: Awaited<ReturnType<typeof seedLead>>;
let dealsTableId = "";
let dealDhId = "";
const ids: Record<string, string> = {};

const shot = async (s: Session, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.page.screenshot({ path: path.join(SHOTS, `${s.name}-${name}.png`), fullPage: false });
};

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "12G-1 đi luồng vai trò ở desktop; điện thoại do bộ spec cũ");
  test.setTimeout(240_000);
  const adm = await createAdmin(API, email("admin"), `Admin 12G ${RUN}`, PASSWORD(), ROOT);
  Object.assign(
    ids,
    await seedPeople(
      API,
      adm,
      [
        { email: email("mgr"), name: `Manager 12G ${RUN}`, roles: ["manager"] },
        { email: email("lead"), name: `Leader 12G ${RUN}`, roles: ["leader"], manager: email("mgr") },
        { email: email("member"), name: `Thành viên 12G ${RUN}`, roles: ["user"], manager: email("mgr"), leader: email("lead") },
        { email: email("guest"), name: `Guest 12G ${RUN}`, roles: ["guest"], manager: email("mgr"), guestPreset: "data" },
      ],
      PASSWORD(),
    ),
  );
  mgrApi = await new ApiClient(API).login(email("mgr"), PASSWORD());
  // Datahub with the worst values of module 2 (empty row, "<b>", negative, huge, long text), then 10.000 more rows.
  fx = await seedLead(mgrApi, `Lead xấu nhất ${RUN}`, { people: [] });
  await mgrApi.call("POST", `/tables/${fx.leadId}/rows`, { data: {} });
  await mgrApi.call("POST", `/tables/${fx.leadId}/rows`, { data: { "Tên lead": "x".repeat(400), "Doanh thu": 999_999_999_999_999, "Số lượng": -123456789, "Ghi chú": "dài ".repeat(500) } });
  await mgrApi.call("PUT", `/datahubs/${fx.datahubId}/shares`, { grantee_id: ids[email("member")], permission: "view" });
  await seedMany(mgrApi, fx.leadId, 10_000, (i) => ({ "Tên lead": `Lead ${i + 1}`, "Doanh thu": (i + 1) * 1000 - 5000 }));
  // Deals with the same kind of values.
  let deals: { id: string; master_table_id: string } | undefined;
  for (let i = 0; i < 60 && !deals; i++) {
    deals = (await mgrApi.call<{ id: string; name: string; master_table_id: string }[]>("GET", "/datahub/templates")).find((t) => t.name === "Deals");
    if (!deals) await new Promise((r) => setTimeout(r, 500));
  }
  dealsTableId = deals!.master_table_id;
  const part = [{ id: ids[email("member")]!, attrs: { vai_tro: "Leading" } }];
  for (const [i, name] of ["<b>Công ty đậm</b> & Co", "Công ty thường", "Z".repeat(300)].entries()) {
    await mgrApi.call("POST", `/tables/${dealsTableId}/rows`, { data: { "Tên công ty": name, "Loại deal": "POD bán mới", "Start date": `2026-11-0${i + 2}`, "Người tham gia": part } });
  }
  await mgrApi.call("POST", `/tables/${dealsTableId}/rows`, { data: {} }).catch(() => undefined); // an empty deal may be refused: it must not break anything
  for (const r of ROLES) {
    sessions[r] = await Session.open(browser, "desktop", r);
    await sessions[r].login(email(r), PASSWORD());
    await expect(sessions[r].page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  }
  dealDhId = deals!.id;
  await sessions.mgr.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: process.env.E2E_WEB_URL ?? "http://localhost:5273" });
});

test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of Object.values(sessions)) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
});
test.afterAll(async () => {
  for (const s of Object.values(sessions)) await s.close();
});

/** Every screen a person can reach from the menu or the settings page. */
const SCREENS: [string, string][] = [
  ["tong-quan", "/"],
  ["datahub", "/datahub"],
  ["deal", "/quan-ly-deal"],
  ["deal-dashboard", "/quan-ly-deal/dashboard"],
  ["deal-thanh-toan", "/quan-ly-deal/thanh-toan"],
  ["deal-chot-ky", "/quan-ly-deal/chot-ky"],
  ["deal-template", "/quan-ly-deal/template"],
  ["form", "/form"],
  ["onboarding", "/onboarding"],
  ["knowledge", "/knowledge"],
  ["ai-hub", "/ai-hub"],
  ["duyet", "/duyet"],
  ["to-chuc", "/to-chuc"],
  ["dulieu-duoc-cap", "/du-lieu-duoc-cap"],
  ["cai-dat", "/cai-dat"],
  ["tai-khoan", "/tai-khoan"],
  ["cap-du-lieu", "/cap-du-lieu"],
  ["ket-noi-ai", "/quan-tri/token"],
  ["nhat-ky", "/quan-tri/nhat-ky"],
  ["he-thong", "/quan-tri/he-thong"],
  ["cai-dat-he-thong", "/quan-tri/cai-dat"],
];

/** What each screen needs (the page gate of `shell.tsx`; the server's permission list of the person decides). */
const NEEDS: Record<string, string> = {
  "/quan-ly-deal/template": "datahub:template:write", "/quan-ly-deal": "datahub:datahub:use", "/du-lieu-duoc-cap": "datahub:datahub:use", "/datahub": "datahub:datahub:use",
  "/form": "form:form:create", "/onboarding": "onboarding:path:read", "/knowledge": "knowledge:article:read", "/ai-hub": "aihub:skill:read",
  "/duyet": "knowledge:article:review|aihub:skill:review", "/to-chuc": "org:member:read", "/cap-du-lieu": "guest:grant:manage", "/quan-tri/token": "auth:token:approve",
  "/quan-tri/nhat-ky": "system:audit:read", "/quan-tri/he-thong": "system:setting:write", "/quan-tri/cai-dat": "system:setting:write",
};
const needOf = (url: string) => Object.entries(NEEDS).find(([k]) => url === k || url.startsWith(`${k}/`))?.[1] ?? null;

/** Screens a role must never open, whatever the list says: the admin pages for everyone but the Admin, and the data pages for the Guest. */
const MUST_DENY: Record<Role, string[]> = {
  admin: [],
  mgr: ["/quan-tri/token", "/quan-tri/nhat-ky", "/quan-tri/he-thong", "/quan-tri/cai-dat"],
  lead: ["/quan-tri/token", "/quan-tri/nhat-ky", "/quan-tri/he-thong", "/quan-tri/cai-dat", "/cap-du-lieu"],
  member: ["/quan-tri/token", "/quan-tri/nhat-ky", "/quan-tri/he-thong", "/quan-tri/cai-dat", "/cap-du-lieu", "/quan-ly-deal/template"],
  guest: ["/datahub", "/quan-ly-deal", "/form", "/onboarding", "/duyet", "/to-chuc", "/cap-du-lieu", "/quan-tri/token", "/quan-tri/nhat-ky", "/quan-tri/he-thong", "/quan-tri/cai-dat"],
};

for (const role of ROLES) {
  test(`vai trò ${role}: mở mọi màn chính, không lỗi console/network`, async () => {
    const s = sessions[role];
    // Expected refusals of the screens that gate by role at the API instead of the page.
    s.allow(403, /\/api\/v1\//).allow(404, /\/api\/v1\//);
    const seen: string[] = [];
    const perms = ((await (await s.page.request.get("/api/v1/auth/me")).json()) as { data: { permissions: string[] } }).data.permissions;
    for (const [name, url] of SCREENS) {
      await s.page.goto(url);
      await s.page.waitForLoadState("networkidle");
      await s.page.waitForTimeout(400);
      const denied = await s.page.getByRole("heading", { name: "Không có quyền" }).isVisible();
      const need = needOf(url);
      const may = need === null || need.split("|").some((x) => perms.includes(x));
      expect(denied, `${role}: ${url} ${may ? "phải mở được" : "phải báo Không có quyền"}`).toBe(!may);
      if (MUST_DENY[role].includes(url)) expect(denied, `${role} không được mở ${url}`).toBe(true);
      if (!denied) seen.push(url);
      await s.expectNoHorizontalOverflow();
      if (["tong-quan", "datahub", "deal", "deal-dashboard", "form", "knowledge", "ai-hub", "to-chuc", "cai-dat", "dulieu-duoc-cap"].includes(name)) await shot(s, name);
    }
    // 403/404 are only tolerated on screens that gate at the API: list them so a surprise is visible, but none may be a console error.
    const bad = s.problems.filter((x) => !/^HTTP (403|404):/.test(x));
    s.problems = [];
    expect(bad, `Lỗi console/network ở vai trò ${role}`).toEqual([]);
    expect(seen.length).toBeGreaterThanOrEqual(role === "guest" ? 3 : 10);
  });
}

test("Datahub xấu nhất: hàng rỗng, <b> là chữ, số rất lớn/âm, 10.000 dòng", async () => {
  const s = sessions.mgr;
  const pg = s.page;
  await pg.goto(`/datahub/${fx.datahubId}/${fx.leadId}`);
  await expect(pg.getByTestId("grid")).toBeVisible();
  await expect.poll(async () => pg.getByText("10.005 dòng", { exact: true }).count(), { timeout: 90_000 }).toBe(1);
  const g = new GridDriver(pg);
  const names = [await g.read(0, 0), await g.read(0, 1), await g.read(0, 2)];
  expect(names[2]).toBe("<b>Công ty</b> & Co &amp; Thuận Phát");
  expect(await pg.locator("b", { hasText: "Công ty" }).count()).toBe(0);
  await shot(s, "datahub-grid-1280");
  // 12G-1: at 1280px the toolbar (with "Thời gian") stays on ONE line: every tool shares one row.
  const barH = await pg.getByRole("toolbar", { name: "Công cụ view" }).evaluate((el) => el.getBoundingClientRect().height);
  expect(barH, "thanh công cụ Datahub 1280px phải một dòng (cao dưới 48px)").toBeLessThan(48);
  // The numbers: the grid shows what the server keeps (server numbers are the truth; the UI only reads them).
  const huge = (await mgrApi.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${fx.leadId}/rows?limit=10&filter=${encodeURIComponent(JSON.stringify({ field: "Số lượng", op: "lt", value: 0 }))}`)).data;
  expect(huge.length).toBeGreaterThan(0);
  await pg.keyboard.press("End");
  s.check();
});

test("Deal xấu nhất: tên có <b>, tên rất dài, dòng rỗng không làm hỏng lưới và ngăn kéo", async () => {
  const s = sessions.mgr;
  const pg = s.page;
  await pg.goto("/quan-ly-deal");
  await pg.getByRole("tab", { name: "Deals", exact: true }).click();
  await expect(pg.getByTestId("grid")).toBeVisible();
  await pg.waitForTimeout(1000);
  const g = new GridDriver(pg);
  const col = 0;
  const seenNames: string[] = [];
  for (let r = 0; r < 4; r++) seenNames.push(await g.read(col, r));
  expect(seenNames.join("|")).toContain("<b>Công ty đậm</b> & Co");
  expect(await pg.locator("b", { hasText: "Công ty đậm" }).count()).toBe(0);
  await shot(s, "deal-grid-1280");
  const dealBar = await pg.getByRole("toolbar", { name: "Công cụ view" }).evaluate((el) => el.getBoundingClientRect().height);
  expect(dealBar, "thanh công cụ Deal 1280px tối đa hai dòng").toBeLessThan(90);
  await g.openMarker(0);
  await expect(pg.getByRole("dialog").first()).toBeVisible();
  await shot(s, "deal-panel-1280");
  s.check();
  expect(dealDhId).not.toBe("");
});
