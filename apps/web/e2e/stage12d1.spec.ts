import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 12D-1: the home page (Tổng quan): dashboard tabs ("Được chia sẻ" + the pinned ones, saved on the server), "Mở gần đây",
 * reminders, the right column's empty states, and the health card now in Cài đặt. Desktop only; the phone picture is taken here too.
 */
test.describe.configure({ mode: "serial" });

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-12d1-${p}-8842`;
const RUN = Date.now().toString(36);
const email = (who: string) => `${p}.h${who}${RUN}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const SHOTS = process.env.HOME_SHOTS ?? path.join(process.cwd(), "e2e/results/stage12d1");

let admin: Session;
let owner: Session;
let fresh: Session;
let ownerApi: ApiClient;
let hubId: string;
let dashA = "";
let dashB = "";
const NAME_A = `Doanh thu quý ${RUN}`;
const NAME_B = `Theo dõi lead ${RUN}`;
let sessions: Session[] = [];

const shot = async (s: Session, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
};

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "12D-1 chỉ chạy ở desktop");
  const adm = await createAdmin(API, email("admin"), `Admin 12D1 ${RUN}`, PASSWORD(), ROOT);
  await seedPeople(
    API,
    adm,
    [
      { email: email("mgr"), name: `Manager 12D1 ${RUN}`, roles: ["manager"] },
      { email: email("owner"), name: `Minh An ${RUN}`, roles: ["user"], manager: email("mgr") },
      { email: email("fresh"), name: `Người mới ${RUN}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  hubId = (await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: `Lead Q4 ${RUN}` })).id;
  const tableId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/tables`, { name: "Deals" })).id;
  await ownerApi.call("POST", `/tables/${tableId}/columns`, { name: "Số tiền", type: "number" });
  await ownerApi.call("POST", `/tables/${tableId}/rows/batch`, { ops: [100, 250, 400].map((n) => ({ op: "create", data: { "Số tiền": n } })) });
  const mk = async (name: string) => {
    const id = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${hubId}/dashboards`, { name })).id;
    await ownerApi.call("POST", `/dashboards/${id}/charts`, { chart: { type: "kpi", title: `Tổng của ${name}`, series: [{ metric: { name: "Tổng", source: tableId, measure: { agg: "sum", field: "Số tiền" } } }], layout: { x: 0, y: 0, w: 4, h: 3 } } });
    return id;
  };
  dashA = await mk(NAME_A);
  dashB = await mk(NAME_B);

  admin = await Session.open(browser, p, "admin");
  owner = await Session.open(browser, p, "owner");
  fresh = await Session.open(browser, p, "fresh");
  sessions = [admin, owner, fresh];
  for (const [s, who] of [[admin, "admin"], [owner, "owner"], [fresh, "fresh"]] as const) {
    await s.login(email(who), PASSWORD());
    await expect(s.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  }
});

test.afterEach(async ({ browserName: _b }, info) => {
  if (info.status !== info.expectedStatus) for (const s of sessions) await s.shot(`FAILED-${s.name}`).catch(() => undefined);
  for (const s of sessions) s.check();
});
test.afterAll(async () => {
  for (const s of sessions) await s.close();
});

test("Tổng quan: lời chào, không còn menu Dashboard chia sẻ, trạng thái rỗng có nút", async () => {
  const pg = fresh.page;
  await pg.goto("/");
  await expect(pg.getByRole("heading", { level: 1, name: /^Xin chào/ })).toBeAttached();
  await expect(pg.getByTestId("home-greeting")).toContainText(`Người mới ${RUN}`);
  expect(await fresh.hasMenu("Dashboard chia sẻ")).toBe(false);
  expect(await fresh.hasMenu("Tổng quan")).toBe(true);
  // the shared tab is first and open when nothing is pinned (the Manager's Deals dashboard is open to the whole tree)
  await expect(pg.getByRole("tab", { name: "Được chia sẻ" })).toHaveAttribute("aria-selected", "true");
  await expect(pg.getByTestId("shared-dashboard").filter({ hasText: "Deals" })).toBeVisible();
  await expect(pg.getByTestId("home-recent")).toContainText("Chưa có gì");
  await expect(pg.getByTestId("home-recent").getByRole("link", { name: /Mở Datahub/ })).toBeVisible();
  await expect(pg.getByTestId("home-reminders").getByRole("button", { name: "Tạo nhắc hẹn" })).toBeVisible();
  await expect(pg.getByTestId("home-announcement").getByRole("link", { name: /Mở hộp thông báo/ })).toBeVisible();
  await expect(pg.getByTestId("home-onboarding")).toHaveCount(0); // no running plan
  // "Ghim dashboard": a person without dashboards is told what to do
  await pg.getByTestId("pin-dashboard").click();
  await expect(pg.getByText("Bạn chưa có dashboard nào")).toBeVisible();
  await pg.keyboard.press("Escape");
  await shot(fresh, "desktop-empty.png");
  const ph = await Session.open(pg.context().browser()!, "phone", "phone-empty");
  sessions.push(ph);
  await ph.login(email("fresh"), PASSWORD());
  await expect(ph.page.getByTestId("home-greeting")).toBeVisible();
  await ph.expectNoHorizontalOverflow();
  await shot(ph, "phone-empty.png");
});

test("ghim dashboard của mình thành tab, đổi thứ tự bằng menu, giữ ở máy chủ (đổi trình duyệt vẫn thấy)", async () => {
  const pg = owner.page;
  await pg.goto("/");
  await pg.getByTestId("pin-dashboard").click();
  await pg.getByTestId("pin-option").filter({ hasText: NAME_A }).click();
  await expect(pg.getByRole("tab", { name: NAME_A })).toHaveAttribute("aria-selected", "true");
  await expect(pg.getByTestId("home-dashboard-canvas").getByTestId("kpi-value")).toHaveText("750");
  await pg.getByTestId("pin-dashboard").click();
  await expect(pg.getByTestId("pin-option").filter({ hasText: NAME_A })).toHaveCount(0); // already pinned
  await pg.getByTestId("pin-option").filter({ hasText: NAME_B }).click();
  await expect(pg.getByRole("tab", { name: NAME_B })).toHaveAttribute("aria-selected", "true");
  const order = () => pg.getByTestId("home-tab").allInnerTexts();
  expect(await order()).toEqual([NAME_A, NAME_B]);
  // keyboard / phone way: the menu of the open tab
  await pg.getByRole("button", { name: `Tuỳ chọn tab ${NAME_B}` }).click();
  await pg.getByRole("menuitem", { name: "Chuyển sang trái" }).click();
  await expect.poll(order).toEqual([NAME_B, NAME_A]);
  // the order lives on the server
  await expect.poll(async () => (await ownerApi.call<{ id: string }[]>("GET", "/me/home/tabs").catch(() => [])).map((t) => t.id)).toEqual([dashB, dashA]);
  // another browser (another machine) of the same person sees the same tabs; the first pinned tab opens by itself
  const other = await Session.open(pg.context().browser()!, "desktop", "owner-2");
  sessions.push(other);
  await other.login(email("owner"), PASSWORD());
  await expect(other.page.getByTestId("home-tab")).toHaveText([NAME_B, NAME_A]);
  await expect(other.page.getByRole("tab", { name: NAME_B })).toHaveAttribute("aria-selected", "true");
  await shot(owner, "desktop-pinned.png");
  const ph = await Session.open(pg.context().browser()!, "phone", "owner-phone");
  sessions.push(ph);
  await ph.login(email("owner"), PASSWORD());
  await expect(ph.page.getByTestId("home-dashboard-canvas").getByTestId("kpi-value")).toBeVisible();
  await ph.expectNoHorizontalOverflow();
  await shot(ph, "phone-pinned.png");
  // "Mở dashboard" goes to the editable one
  const noted = pg.waitForResponse((r) => r.url().endsWith("/me/recent") && r.request().method() === "POST");
  await pg.getByTestId("home-open-dashboard").click();
  await expect(pg).toHaveURL(new RegExp(`/datahub/${hubId}/dashboard/${dashB}$`));
  await noted;
  // un-pin
  await pg.goto("/");
  await pg.getByRole("tab", { name: NAME_B }).click();
  await pg.getByRole("button", { name: `Tuỳ chọn tab ${NAME_B}` }).click();
  await pg.getByRole("menuitem", { name: "Bỏ ghim" }).click();
  await expect(pg.getByTestId("home-tab")).toHaveText([NAME_A]);
  await expect.poll(async () => (await ownerApi.call<{ id: string }[]>("GET", "/me/home/tabs")).map((t) => t.id)).toEqual([dashA]);
});

test("Mở gần đây: ghi khi mở datahub và dashboard, mục bị xoá thì biến mất; nhắc hẹn và thông báo chung hiện ở cột phải", async () => {
  const pg = owner.page;
  // the page tells the server it was opened; wait for the answer before leaving (a request cut by navigation is a different thing)
  const noted = () => pg.waitForResponse((r) => r.url().endsWith("/me/recent") && r.request().method() === "POST");
  let wait = noted();
  await pg.goto(`/datahub/${hubId}`);
  await expect(pg.getByRole("tab", { name: "Deals" }).first()).toBeVisible();
  await wait;
  await expect.poll(async () => (await ownerApi.call<{ id: string }[]>("GET", "/me/recent")).some((e) => e.id === hubId)).toBe(true);
  wait = noted();
  await pg.goto(`/datahub/${hubId}/dashboard/${dashB}`);
  await expect(pg.getByText(`Tổng của ${NAME_B}`)).toBeVisible();
  await wait;
  await expect.poll(async () => (await ownerApi.call<{ id: string }[]>("GET", "/me/recent"))[0]?.id).toBe(dashB);
  const due = new Date(Date.now() + 36 * 3600_000).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  await ownerApi.call("POST", "/reminders", { content: `Gọi lại khách ${RUN}`, due_at: `${due}T09:00`, repeat: "none" });
  await pg.goto("/");
  const recent = pg.getByTestId("home-recent").getByTestId("recent-item");
  await expect(recent.first()).toContainText(NAME_B);
  await expect(recent.filter({ hasText: `Lead Q4 ${RUN}` })).toHaveCount(1);
  await expect(pg.getByTestId("home-reminders").getByTestId("home-reminder").filter({ hasText: `Gọi lại khách ${RUN}` })).toBeVisible();
  await pg.getByTestId("home-new-reminder").click();
  await expect(pg.getByRole("dialog", { name: "Nhắc mới" })).toBeVisible();
  await pg.keyboard.press("Escape");
  // a recent item opens its page
  wait = noted();
  await recent.filter({ hasText: NAME_B }).click();
  await expect(pg).toHaveURL(new RegExp(`/datahub/${hubId}/dashboard/${dashB}$`));
  await wait;
  // a deleted dashboard is not listed any more
  await pg.goto("/");
  await ownerApi.call("DELETE", `/dashboards/${dashB}`);
  await pg.reload();
  await expect(pg.getByTestId("home-recent")).not.toContainText(NAME_B);
  await expect(pg.getByTestId("home-recent")).toContainText(`Lead Q4 ${RUN}`);
});

test("tình trạng hệ thống nằm ở Cài đặt (Admin), không còn ở Tổng quan", async () => {
  const pg = admin.page;
  await pg.goto("/");
  await expect(pg.getByText("Tình trạng hệ thống")).toHaveCount(0);
  await (await admin.menuLink("Cài đặt hệ thống")).click();
  await pg.getByRole("navigation", { name: "Menu cài đặt" }).getByRole("link", { name: "Tình trạng hệ thống", exact: true }).click();
  await expect(pg).toHaveURL(/\/quan-tri\/he-thong$/);
  await expect(pg.getByText("Cơ sở dữ liệu")).toBeVisible();
  // a person without the right does not see the link and cannot open the page
  await (await owner.menuLink("Tổng quan")).click();
  await owner.page.goto("/cai-dat");
  await expect(owner.page.getByRole("navigation", { name: "Menu cài đặt" }).getByRole("link", { name: "Tình trạng hệ thống" })).toHaveCount(0);
});
