import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { API, Session, type ProjectName, chooseOption, moreAction, expectMore, moreActions } from "./helpers";
import { GridDriver } from "./grid";
import { ApiClient, createAdmin, seedPeople } from "./seed";
import { seedMany } from "./dh-fixtures";

/**
 * Stage 2E-2: the final functional test of Stage 2 on the real stack, by role, with the worst data.
 *  1. datahub list (empty, shared, same name, 100 characters with markup)
 *  2. a 10.000-row table: scroll, jump to the end, edit, filter + sort + group agree with the server
 *  3. formula columns on the worst numbers: server, grid and export show one value
 *  4. roles: owner, viewer, editor, leader, manager, admin, guest, outsider (screen and API)
 *  5. import of a generated xlsx, then export XLSX and CSV, cell by cell
 *  6. duplicates on 10.000 rows (many groups) and the trash
 * Desktop only. Pictures of the key screens go to `e2e/results/stage2e/` (ignored by git). The invented data here
 * is all made in this file.
 */
test.describe.configure({ mode: "serial" });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExcelJS: any = createRequire(path.join(process.cwd(), "../api/package.json"))("exceljs");
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ROOT = path.join(process.cwd(), "../..");
const SHOTS = path.join(process.cwd(), "e2e/results/stage2e");
const ORIGIN = process.env.E2E_WEB_URL ?? "http://localhost:5273";

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-2e-${p}-9047`;
const email = (who: string) => `${p}.e2${who}@base.vn`;
const PEOPLE = ["mgr", "leader", "owner", "viewer", "editor", "outsider", "newbie"] as const;
const NAMES: Record<string, string> = {};
const personName = (who: string) => `${who[0]!.toUpperCase()}${who.slice(1)} 2E ${p}`;

let adminApi: ApiClient;
let ids: Record<string, string> = {};
const api: Record<string, ApiClient> = {};
const sessions: Record<string, Session> = {};
let ownerApi: ApiClient;

/** 100 characters, markup, `&`, an accent: the worst name a datahub can have. */
const LONG_NAME = () => `<b>Dữ liệu</b> & "kinh doanh" <script>x</script> ${"đ".repeat(100)}`.slice(0, 100);

const dialog = (page: Page, name?: string | RegExp): Locator => page.getByRole("dialog", name ? { name } : undefined).last();
const dotted = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const rowsOf = async (a: ApiClient, id: string, extra = "") => (await a.raw<{ data: { id: string; data: Record<string, unknown>; version: number }[] }>(`/tables/${id}/rows?${/limit=/.test(extra) ? "" : "limit=500"}${extra}`)).data;
const tableOf = async (a: ApiClient, id: string) => (await a.call<{ columns: { name: string; type: string; key: string }[] }>("GET", `/tables/${id}`)).columns;
async function statusOf(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
    return 200;
  } catch (e) {
    return Number(/-> (\d{3})/.exec((e as Error).message)?.[1] ?? 0);
  }
}
async function shot(s: Session, label: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await s.page.screenshot({ path: path.join(SHOTS, `${label}.png`) });
}
/** The text a grid cell shows -> the number it stands for (Vietnamese format: dots group, comma is the decimal mark). */
const numOf = (t: string): number => Number(t.replace(/[^\d,-]/g, "").replace(",", "."));
const rpc = <T>(who: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown) => api[who]!.call<T>(method, url, body);

async function sessionOf(browser: Browser, who: string, expected: { status: number; url: RegExp }[] = []): Promise<Session> {
  if (sessions[who]) return sessions[who]!;
  const s = await Session.open(browser, p, who);
  for (const e of expected) s.allow(e.status, e.url);
  await s.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  await s.login(email(who), PASSWORD());
  await expect(s.page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  sessions[who] = s;
  return s;
}
const DENIED = [{ status: 403, url: /\/api\/v1\// }, { status: 404, url: /\/api\/v1\/(tables|datahubs)\// }];

test.beforeAll(async ({ browserName: _b }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "2E-2 chỉ chạy ở desktop");
  adminApi = await createAdmin(API, email("admin"), `Admin 2E ${p}`, PASSWORD(), ROOT);
  const people = [
    { email: email("mgr"), name: personName("mgr"), roles: ["manager" as const] },
    { email: email("leader"), name: personName("leader"), roles: ["leader" as const], manager: email("mgr") },
    ...(["owner", "viewer", "editor", "outsider", "newbie"] as const).map((w) => ({ email: email(w), name: personName(w), roles: ["user" as const], manager: email("mgr"), leader: email("leader") })),
    { email: email("guest"), name: personName("guest"), roles: ["guest" as const], manager: email("mgr"), guestPreset: "data" as const },
  ];
  ids = await seedPeople(API, adminApi, people, PASSWORD());
  api.admin = adminApi;
  for (const w of [...PEOPLE, "guest"]) api[w] = await new ApiClient(API).login(email(w), PASSWORD());
  ownerApi = api.owner!;
  void NAMES;
});

test.afterEach(async ({ browserName: _b }, info) => {
  const failed = info.status !== info.expectedStatus;
  for (const s of Object.values(sessions)) {
    if (failed) await shot(s, `FAILED-${s.name}`).catch(() => undefined);
    s.check();
  }
});
test.afterAll(async () => {
  for (const s of Object.values(sessions)) await s.close();
});

// ------------------------------------------------------------------------------------------------
// 1. datahub list
// ------------------------------------------------------------------------------------------------

test("danh sách datahub: người mới thấy trạng thái rỗng; tên 100 ký tự có markup hiện là chữ; datahub chia sẻ trùng tên có tên chủ", async ({ browser }) => {
  const newbie = await sessionOf(browser, "newbie");
  const pg = newbie.page;
  await pg.goto("/datahub");
  await expect(pg.getByRole("heading", { level: 1, name: "Datahub" })).toBeVisible();
  await expect(pg.getByText("Bạn chưa có datahub nào")).toBeVisible();
  await expect(pg.getByRole("tab", { name: "Của tôi (0)" })).toBeVisible();
  await pg.getByRole("tab", { name: /^Được chia sẻ với tôi/ }).click();
  await expect(pg.getByText("Chưa có datahub nào được chia sẻ với bạn")).toBeVisible();
  await shot(newbie, "1-danh-sach-rong");

  // The owner and the editor both name a datahub with the same text; the editor shares his with the owner.
  const name = LONG_NAME();
  expect(name).toHaveLength(100);
  const mine = await rpc<{ id: string }>("owner", "POST", "/datahubs", { name });
  const theirs = await rpc<{ id: string }>("editor", "POST", "/datahubs", { name });
  await rpc("editor", "PUT", `/datahubs/${theirs.id}/shares`, { grantee_id: ids[email("owner")], permission: "view" });
  const owner = await sessionOf(browser, "owner");
  const op = owner.page;
  await op.goto("/datahub");
  await expect(op.getByRole("tab", { name: /^Của tôi \(\d+\)/ })).toBeVisible();
  // "Tất cả" (the default tab) holds both datahubs of the same name; the two other tabs split them.
  await expect(op.getByRole("link", { name: `Mở datahub ${name}` })).toHaveCount(2);
  await op.getByRole("tab", { name: /^Của tôi/ }).click();
  await expect(op.getByRole("link", { name: `Mở datahub ${name}` })).toHaveCount(1);
  // The name is text: no <b> or <script> element was made out of it.
  await expect(op.locator("main b, main script")).toHaveCount(0);
  await expect(op.getByText(name, { exact: true })).toBeVisible();
  await op.getByRole("tab", { name: /^Được chia sẻ với tôi \(1\)/ }).click();
  await expect(op.getByRole("link", { name: `Mở datahub ${name}` })).toHaveCount(1);
  await expect(op.getByText(`Chủ: ${personName("editor")}`)).toBeVisible();
  await shot(owner, "1-danh-sach-chia-se");
  // The two datahubs are two different ones and each opens its own.
  await op.getByRole("link", { name: `Mở datahub ${name}` }).click();
  await expect(op).toHaveURL(new RegExp(`/datahub/${theirs.id}`));
  expect(mine.id).not.toBe(theirs.id);
  await expect(op.getByRole("heading", { level: 1, name })).toBeVisible();
  await rpc("owner", "DELETE", `/datahubs/${mine.id}`);
});

// ------------------------------------------------------------------------------------------------
// 2. 10.000 rows
// ------------------------------------------------------------------------------------------------

let bigDh: string;
let bigId: string;
const bigKeys: Record<string, string> = {};
const bigRow = (i: number): Record<string, unknown> => ({
  Tên: i % 1000 === 0 ? `Dòng ${i + 1} <b>đậm</b>` : `Dòng ${i + 1}`,
  Tiền: i === 0 ? 999_999_999_999_999 : i === 1 ? -999_999_999_999_999 : ((i * 7919) % 10_000) * 1000,
  ...(i === 2 ? {} : { Số: ((i * 37) % 100_000) - 50_000 }),
  ...(i % 7 === 0 ? {} : { "Ngày ký": `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}` }),
  Nhóm: "ABCD"[i % 4],
});

test("bảng 10.000 dòng: cuộn, nhảy tới cuối, sửa ô, giá trị xấu nhất đúng; lọc, sắp xếp, nhóm khớp truy vấn server", async ({ browser }) => {
  test.setTimeout(240_000);
  const dh = await rpc<{ id: string }>("owner", "POST", "/datahubs", { name: `Mười nghìn dòng ${p}` });
  bigDh = dh.id;
  bigId = (await rpc<{ id: string }>("owner", "POST", `/datahubs/${dh.id}/tables`, { name: "Dữ liệu lớn" })).id;
  const defs: [string, string, object?][] = [
    ["Tên", "text"],
    ["Tiền", "currency"],
    ["Số", "number"],
    ["Ngày ký", "date"],
    ["Nhóm", "single_select", { options: ["A", "B", "C", "D"].map((name) => ({ name })) }],
    ["Ghi chú", "text"],
  ];
  for (const [name, type, config] of defs) bigKeys[name] = (await rpc<{ key: string }>("owner", "POST", `/tables/${bigId}/columns`, { name, type, ...(config ? { config } : {}) })).key;
  await seedMany(ownerApi, bigId, 10_000, bigRow);

  const owner = await sessionOf(browser, "owner");
  const pg = owner.page;
  await pg.goto(`/datahub/${bigDh}/${bigId}`);
  await expect(pg.getByText("10.000 dòng", { exact: true })).toBeVisible({ timeout: 60_000 });
  const g = new GridDriver(pg);
  const total = async (q = "") => (await ownerApi.raw<{ total: number }>(`/tables/${bigId}/rows?limit=1&include_total=true${q}`)).total;
  expect(await total()).toBe(10_000);

  // The worst values at the top: what the grid shows equals what the server holds.
  const top = await rowsOf(ownerApi, bigId, "&limit=5");
  const expectCell = async (c: number, r: number, key: string, kind: "text" | "num" | "date") => {
    const shown = await g.read(c, r);
    const v = top[r]!.data[bigKeys[key]!];
    if (v === undefined || v === null) return expect(shown, `${key} dòng ${r}`).toBe("");
    if (kind === "text") return expect(shown, `${key} dòng ${r}`).toBe(String(v));
    if (kind === "num") return expect(numOf(shown), `${key} dòng ${r}: "${shown}"`).toBe(Number(v));
    const [y, m, d] = String(v).split("-");
    return expect(shown, `${key} dòng ${r}`).toBe(`${d}/${m}/${y}`);
  };
  for (let r = 0; r < 5; r++) {
    await expectCell(0, r, "Tên", "text");
    await expectCell(1, r, "Tiền", "num");
    await expectCell(2, r, "Số", "num");
    await expectCell(3, r, "Ngày ký", "date");
  }
  expect(top[0]!.data[bigKeys.Tiền!]).toBe(999_999_999_999_999);
  expect(top[1]!.data[bigKeys.Tiền!]).toBe(-999_999_999_999_999);
  expect(top[2]!.data[bigKeys.Số!] ?? null).toBeNull();
  await shot(owner, "2-bang-10000-dong-dau-bang");

  // Scroll to the middle and the end: each position shows the row the server has there.
  const jump = async (fraction: number): Promise<number> => {
    const answer = pg.waitForResponse((r) => /\/rows\?/.test(r.url()) && /offset=/.test(r.url()) && r.ok(), { timeout: 8000 }).catch(() => null);
    await pg.evaluate((f) => {
      const el = document.querySelector(".dvn-scroller") as HTMLElement;
      el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
    }, fraction);
    await answer;
    let k = 0;
    await expect.poll(async () => (k = Number(/^Dòng (\d+)/.exec(await g.read(0, 2).catch(() => ""))?.[1] ?? 0)), { timeout: 8000 }).toBeGreaterThan(0);
    const server = await rowsOf(ownerApi, bigId, `&limit=1&offset=${k - 1}`);
    expect(String(server[0]!.data[bigKeys.Tên!]).startsWith(`Dòng ${k}`), `vị trí ${k}`).toBe(true);
    return k;
  };
  expect(await jump(0.5)).toBeGreaterThan(4000);
  expect(await jump(1)).toBeGreaterThan(9_900);
  await shot(owner, "2-bang-10000-dong-cuoi-bang");

  // Edit a cell at the top, with markup in it.
  await pg.evaluate(() => ((document.querySelector(".dvn-scroller") as HTMLElement).scrollTop = 0));
  await expect.poll(() => g.read(0, 0), { timeout: 8000 }).toBe("Dòng 1 <b>đậm</b>");
  await g.type(5, 0, "Sửa <b>tay</b> & thử");
  await expect.poll(async () => (await rowsOf(ownerApi, bigId, "&limit=1"))[0]!.data[bigKeys["Ghi chú"]!]).toBe("Sửa <b>tay</b> & thử");
  expect((await rowsOf(ownerApi, bigId, "&limit=1"))[0]!.version).toBe(2);
  await expect.poll(() => g.read(5, 0)).toBe("Sửa <b>tay</b> & thử");

  // Filter + sort + group on the shared view: the numbers the page shows are the numbers of the server.
  const view = ((await ownerApi.call("GET", `/tables/${bigId}/views`)) as { views: { id: string }[] }).views[0]!;
  const filter = { field: bigKeys.Tiền, op: "gt", value: 5_000_000 };
  await ownerApi.call("PATCH", `/views/${view.id}`, { config: { filter, sort: [{ field: "Tiền", dir: "desc" }] } });
  const filtered = await total(`&filter=${encodeURIComponent(JSON.stringify(filter))}`);
  expect(filtered).toBeGreaterThan(4000);
  expect(filtered).toBeLessThan(5000);
  await pg.reload();
  await expect(pg.getByText(`${dotted(filtered)} dòng`, { exact: true })).toBeVisible({ timeout: 30_000 });
  const sorted = await rowsOf(ownerApi, bigId, `&limit=3&filter=${encodeURIComponent(JSON.stringify(filter))}&sort=${encodeURIComponent(JSON.stringify([{ field: "Tiền", dir: "desc" }]))}`);
  expect(sorted[0]!.data[bigKeys.Tiền!]).toBe(999_999_999_999_999);
  expect(sorted[1]!.data[bigKeys.Tiền!]).toBe(9_999_000);
  for (let r = 0; r < 3; r++) await expect.poll(async () => numOf(await g.read(1, r)), { timeout: 10_000 }).toBe(Number(sorted[r]!.data[bigKeys.Tiền!]));
  // Every row on screen satisfies the filter.
  for (let r = 0; r < 5; r++) expect(numOf(await g.read(1, r))).toBeGreaterThan(5_000_000);
  await shot(owner, "2-loc-sap-xep");

  await ownerApi.call("PATCH", `/views/${view.id}`, { config: { filter, sort: null, group: [{ field: "Nhóm" }] } });
  const groups = (await ownerApi.call("GET", `/tables/${bigId}/row-groups?filter=${encodeURIComponent(JSON.stringify(filter))}&group=${encodeURIComponent(JSON.stringify([{ field: bigKeys.Nhóm }]))}`)) as { groups: { count: number }[] };
  expect(groups.groups.reduce((a, x) => a + x.count, 0)).toBe(filtered);
  await pg.reload();
  await expect.poll(async () => Number(await g.root.getAttribute("data-lines")), { timeout: 30_000 }).toBe(filtered + groups.groups.length);
  await shot(owner, "2-nhom");
  await ownerApi.call("PATCH", `/views/${view.id}`, { config: { filter: null, sort: null, group: null } });
});

// ------------------------------------------------------------------------------------------------
// 3. formulas on the worst numbers: one value in server, grid and export
// ------------------------------------------------------------------------------------------------

/** The simplest CSV reader that is enough for what the export writes (BOM, quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

async function exportFile(s: Session, format: "csv" | "xlsx", scope: "table" | "view" = "table"): Promise<string> {
  const pg = s.page;
  await moreAction(pg, "Xuất");
  const d = dialog(pg, "Xuất dữ liệu");
  await chooseOption(d.getByLabel("Phạm vi xuất"), scope);
  await chooseOption(d.getByLabel("Định dạng file"), format);
  const wait = pg.waitForEvent("download", { timeout: 60_000 });
  await d.getByRole("button", { name: "Xuất file" }).click();
  const dl = await wait;
  const file = path.join(SHOTS, `xuat-${Date.now()}-${dl.suggestedFilename().replace(/[^\w.-]/g, "_")}`);
  fs.mkdirSync(SHOTS, { recursive: true });
  await dl.saveAs(file);
  await expect(d).toContainText("Đã xuất xong");
  await d.getByRole("button", { name: "Đóng", exact: true }).first().click();
  return file;
}

test("cột công thức trên số lớn, số âm, chia cho 0, ô trống: server, grid và file xuất cùng một giá trị", async ({ browser }) => {
  test.setTimeout(120_000);
  const dh = await rpc<{ id: string }>("owner", "POST", "/datahubs", { name: `Công thức xấu ${p}` });
  const bad = (await rpc<{ id: string }>("owner", "POST", `/datahubs/${dh.id}/tables`, { name: "Số xấu" })).id;
  const sum = (await rpc<{ id: string }>("owner", "POST", `/datahubs/${dh.id}/tables`, { name: "Tổng hợp" })).id;
  const col = (t: string, body: object) => rpc<{ key: string }>("owner", "POST", `/tables/${t}/columns`, body);
  await col(bad, { name: "Tên", type: "text" });
  await col(bad, { name: "Số", type: "number" });
  await col(bad, { name: "Tiền", type: "currency" });
  await col(bad, { name: "Mẫu", type: "number" });
  const fk: Record<string, string> = {};
  for (const [n, f] of [["Gấp đôi", "=[Tiền]*2"], ["Chia", "=[Số]/[Mẫu]"], ["Cộng", "=[Số]+[Mẫu]"]] as const) fk[n] = (await col(bad, { name: n, type: "formula", config: { formula: f } })).key;
  const data = [
    { Tên: "Lớn", Số: 999_999_999_999_999, Tiền: 999_999_999_999_999, Mẫu: 3 },
    { Tên: "Âm lớn <b>x</b>", Số: -999_999_999_999_999, Tiền: -123_456_789, Mẫu: 0 },
    { Tên: "Âm nhỏ", Số: -0.5, Tiền: -1, Mẫu: 2 },
    { Tên: "Trống" },
    { Tên: "Lẻ", Số: 123_456_789.123, Tiền: 1_000_000, Mẫu: 7 },
  ];
  for (const d of data) await rpc("owner", "POST", `/tables/${bad}/rows`, { data: d });
  const tk: Record<string, string> = {};
  for (const [n, f] of [["Tổng Số", "=SUM([Số xấu].[Số])"], ["Tổng Tiền", "=SUM([Số xấu].[Tiền])"], ["Trung bình Số", "=AVERAGE([Số xấu].[Số])"], ["Số dòng", "=COUNTA([Số xấu].[Tên])"]] as const) tk[n] = (await col(sum, { name: n, type: "formula", config: { formula: f } })).key;
  await rpc("owner", "POST", `/tables/${sum}/rows`, { data: {} });

  const serverBad = async () => rowsOf(ownerApi, bad);
  const serverSum = async () => (await rowsOf(ownerApi, sum))[0]!.data;
  await expect.poll(async () => (await serverSum())[tk["Số dòng"]!]).toBe(5);
  const s = await serverSum();
  // Independent arithmetic of the same numbers.
  const nums = data.map((d) => ("Số" in d ? (d as { Số: number }).Số : null)).filter((x): x is number => x !== null);
  const money = data.map((d) => ("Tiền" in d ? (d as { Tiền: number }).Tiền : null)).filter((x): x is number => x !== null);
  expect(Number(s[tk["Tổng Số"]!])).toBeCloseTo(nums.reduce((a, b) => a + b, 0), 6);
  expect(Number(s[tk["Tổng Tiền"]!])).toBeCloseTo(money.reduce((a, b) => a + b, 0), 3);
  expect(Number(s[tk["Trung bình Số"]!])).toBeCloseTo(nums.reduce((a, b) => a + b, 0) / nums.length, 6);
  const rows = await serverBad();
  const byName = (n: string) => rows.find((r) => r.data[Object.keys(r.data)[0]!] === n || Object.values(r.data).includes(n))!;
  expect(byName("Âm lớn <b>x</b>").data[fk.Chia!]).toBe("#DIV/0!");
  expect(byName("Lớn").data[fk["Gấp đôi"]!]).toBe(1_999_999_999_999_998);
  expect(Number(byName("Âm nhỏ").data[fk.Chia!])).toBe(-0.25);

  const owner = await sessionOf(browser, "owner");
  const pg = owner.page;
  // Grid: every cell of both tables equals the server value.
  const check = async (tableId: string, cells: { key: string; c: number }[], nRows: number) => {
    await pg.goto(`/datahub/${dh.id}/${tableId}`);
    await expect(pg.getByTestId("grid")).toBeVisible();
    const g = new GridDriver(pg);
    const server = await rowsOf(ownerApi, tableId);
    await expect.poll(() => g.read(0, 0).catch(() => "x")).not.toBe("x");
    for (let r = 0; r < nRows; r++)
      for (const { key, c } of cells) {
        const shown = await g.read(c, r);
        const v = server[r]!.data[key];
        if (v === undefined || v === null) expect(shown, `ô (${c},${r})`).toBe("");
        else if (typeof v === "string") expect(shown, `ô (${c},${r})`).toBe(v);
        // A whole number is shown exactly; a fraction is shown to 15 significant digits (the display drops float noise).
        else if (Number.isInteger(v)) expect(numOf(shown), `ô (${c},${r}) hiện "${shown}", server ${v}`).toBe(Number(v));
        else expect(Math.abs(numOf(shown) - Number(v)) / Math.max(1, Math.abs(Number(v))), `ô (${c},${r}) hiện "${shown}", server ${v}`).toBeLessThan(1e-14);
      }
  };
  await check(bad, [{ key: fk["Gấp đôi"]!, c: 4 }, { key: fk.Chia!, c: 5 }, { key: fk["Cộng"]!, c: 6 }], 5);
  await shot(owner, "3-cong-thuc-bang-xau");
  await check(sum, Object.values(tk).map((key, c) => ({ key, c })), 1);
  await shot(owner, "3-cong-thuc-tong-hop");

  // Export: CSV of both tables, and the XLSX of the table with the errors.
  await pg.goto(`/datahub/${dh.id}/${bad}`);
  const csv = parseCsv(fs.readFileSync(await exportFile(owner, "csv"), "utf8"));
  const head = csv[0]!;
  expect(head).toEqual(["Tên", "Số", "Tiền", "Mẫu", "Gấp đôi", "Chia", "Cộng"]);
  const server = await serverBad();
  for (let r = 0; r < 5; r++)
    for (const [name, key] of [["Gấp đôi", fk["Gấp đôi"]!], ["Chia", fk.Chia!], ["Cộng", fk["Cộng"]!]] as const) {
      const v = server[r]!.data[key];
      const cell = csv[r + 1]![head.indexOf(name)]!;
      if (v === undefined || v === null) expect(cell).toBe("");
      else if (typeof v === "string") expect(cell).toBe(v);
      else expect(Number(cell), `CSV ${name} dòng ${r}`).toBe(v);
    }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await exportFile(owner, "xlsx"));
  const ws = wb.getWorksheet("Số xấu");
  for (let r = 0; r < 5; r++)
    for (const [name, key, c] of [["Gấp đôi", fk["Gấp đôi"]!, 5], ["Chia", fk.Chia!, 6], ["Cộng", fk["Cộng"]!, 7]] as const) {
      const v = server[r]!.data[key];
      const cell = ws.getRow(r + 2).getCell(c).value;
      const shown = cell && typeof cell === "object" && "error" in cell ? (cell as { error: string }).error : cell;
      if (v === undefined || v === null) expect(shown ?? null, `XLSX ${name} dòng ${r}`).toBeNull();
      else expect(shown, `XLSX ${name} dòng ${r}`).toBe(v);
    }
  await pg.goto(`/datahub/${dh.id}/${sum}`);
  const csv2 = parseCsv(fs.readFileSync(await exportFile(owner, "csv"), "utf8"));
  const ss = await serverSum();
  for (const [n, key] of Object.entries(tk)) expect(Number(csv2[1]![csv2[0]!.indexOf(n)]), `CSV tổng hợp ${n}`).toBe(ss[key]);
});

// ------------------------------------------------------------------------------------------------
// 4. roles
// ------------------------------------------------------------------------------------------------

test("phân quyền theo vai trò: chủ, người Xem, người Sửa, Leader, Manager, Admin, Guest, người ngoài (màn hình và API)", async ({ browser }) => {
  test.setTimeout(180_000);
  const dh = await rpc<{ id: string }>("owner", "POST", "/datahubs", { name: `Phân quyền ${p}` });
  const t = (await rpc<{ id: string }>("owner", "POST", `/datahubs/${dh.id}/tables`, { name: "Riêng tư" })).id;
  await rpc("owner", "POST", `/tables/${t}/columns`, { name: "Tên", type: "text" });
  await rpc("owner", "POST", `/tables/${t}/columns`, { name: "Gấp", type: "formula", config: { formula: "=LEN([Tên])" } });
  await rpc("owner", "POST", `/tables/${t}/rows`, { data: { Tên: "Bí mật <b>riêng</b>" } });
  await rpc("owner", "PUT", `/datahubs/${dh.id}/shares`, { grantee_id: ids[email("viewer")], permission: "view" });
  await rpc("owner", "PUT", `/datahubs/${dh.id}/shares`, { grantee_id: ids[email("editor")], permission: "edit_data" });
  const [row] = await rowsOf(ownerApi, t);

  // API: who can do what.
  const can = {
    read: (w: string) => statusOf(() => rpc(w, "GET", `/tables/${t}/rows?limit=5`)),
    readDh: (w: string) => statusOf(() => rpc(w, "GET", `/datahubs/${dh.id}`)),
    write: (w: string) => statusOf(() => rpc(w, "POST", `/tables/${t}/rows`, { data: { Tên: `viết bởi ${w}` } })),
    edit: (w: string) => statusOf(() => rpc(w, "PATCH", `/tables/${t}/rows/${row!.id}`, { data: { Tên: `sửa bởi ${w}` }, version: row!.version })),
    structure: (w: string) => statusOf(() => rpc(w, "POST", `/tables/${t}/columns`, { name: `Cột của ${w}`, type: "text" })),
    shares: (w: string) => statusOf(() => rpc(w, "GET", `/datahubs/${dh.id}/shares`)),
    share: (w: string) => statusOf(() => rpc(w, "PUT", `/datahubs/${dh.id}/shares`, { grantee_id: ids[email(w)], permission: "view" })),
    del: (w: string) => statusOf(() => rpc(w, "DELETE", `/datahubs/${dh.id}`)),
  };
  expect(await can.readDh("owner")).toBe(200);
  expect(await can.read("viewer")).toBe(200);
  expect(await can.read("editor")).toBe(200);
  for (const w of ["leader", "mgr", "admin", "guest", "outsider"]) {
    expect(await can.readDh(w), `${w} đọc datahub`).toBeGreaterThanOrEqual(403);
    expect(await can.read(w), `${w} đọc dòng`).toBeGreaterThanOrEqual(403);
    expect(await can.write(w), `${w} ghi dòng`).toBeGreaterThanOrEqual(403);
    expect(await can.edit(w), `${w} sửa dòng`).toBeGreaterThanOrEqual(403);
  }
  expect(await can.write("viewer")).toBe(403);
  expect(await can.edit("viewer")).toBe(403);
  expect(await can.edit("editor")).toBe(200);
  expect(await can.write("editor")).toBe(200);
  for (const w of ["viewer", "editor", "leader", "mgr", "admin", "guest", "outsider"]) {
    expect(await can.structure(w), `${w} sửa cấu trúc`).toBeGreaterThanOrEqual(403);
    expect(await can.shares(w), `${w} xem danh sách chia sẻ`).toBeGreaterThanOrEqual(403);
    expect(await can.del(w), `${w} xoá datahub`).toBeGreaterThanOrEqual(403);
  }
  expect(await can.share("editor")).toBeGreaterThanOrEqual(403);
  // The list a person gets never holds the datahub unless it was shared with them.
  for (const [w, sees] of [["owner", true], ["viewer", true], ["editor", true], ["leader", false], ["mgr", false], ["admin", false], ["outsider", false]] as const) {
    const list = await rpc<{ id: string }[]>(w, "GET", "/datahubs?scope=all").catch(() => [] as { id: string }[]);
    expect(list.some((d) => d.id === dh.id), `${w} thấy datahub trong danh sách`).toBe(sees);
  }
  // The Guest has no right to the module at all.
  expect(await statusOf(() => rpc("guest", "GET", "/datahubs?scope=all"))).toBeGreaterThanOrEqual(403);
  expect(await statusOf(() => rpc("guest", "POST", "/datahubs", { name: "Guest tạo" }))).toBeGreaterThanOrEqual(403);
  // The viewer cannot see the formula text; the others are not asked.
  const vcols = await rpc<{ columns: { name: string; config?: { formula?: string } }[] }>("viewer", "GET", `/tables/${t}`);
  expect(JSON.stringify(vcols)).not.toContain("LEN(");
  expect(JSON.stringify(await rpc("owner", "GET", `/tables/${t}`))).toContain("LEN(");

  // Screen: the buttons that a role does not have are not there.
  const url = `/datahub/${dh.id}/${t}`;
  // "Chia sẻ" is a button of the top bar; the others are items of the "..." menu of the table toolbar.
  const present = async (s: Session) => {
    const out: string[] = [];
    if ((await s.page.getByRole("button", { name: "Chia sẻ", exact: true }).count()) > 0) out.push("Chia sẻ");
    const items = await moreActions(s.page);
    for (const name of ["Thêm cột", "Tìm dòng trùng", "Thùng rác", "Nhập"]) if (items.includes(name)) out.push(name);
    return out;
  };
  const open = async (s: Session) => {
    await s.page.goto(url);
    await expect(s.page.getByRole("heading", { level: 1, name: `Phân quyền ${p}` })).toBeVisible();
    await expect(s.page.getByTestId("grid")).toBeVisible();
    await expectMore(s.page, "Xuất", true);
  };
  const owner = await sessionOf(browser, "owner");
  const viewer = await sessionOf(browser, "viewer", DENIED);
  const editor = await sessionOf(browser, "editor", DENIED);
  await open(owner);
  expect(await present(owner)).toEqual(["Chia sẻ", "Thêm cột", "Tìm dòng trùng", "Thùng rác", "Nhập"]);
  await shot(owner, "4-chu");
  await open(viewer);
  expect(await present(viewer)).toEqual([]);
  await shot(viewer, "4-nguoi-xem");
  await open(editor);
  expect(await present(editor)).toEqual(["Tìm dòng trùng", "Thùng rác", "Nhập"]); // the editor restores rows he deleted; no Chia sẻ, no Thêm cột
  // Viewer and editor see the value of the formula but never the formula text.
  for (const s of [viewer, editor]) await expect(s.page.getByText("=LEN(")).toHaveCount(0);
  await shot(editor, "4-nguoi-sua");

  // The leader, the manager, the outsider: the datahub of someone else is closed, on the list and by address.
  for (const who of ["leader", "mgr", "outsider"]) {
    const s = await sessionOf(browser, who, DENIED);
    await s.page.goto("/datahub");
    await expect(s.page.getByRole("heading", { level: 1, name: "Datahub" })).toBeVisible();
    await expect(s.page.getByRole("link", { name: `Mở datahub Phân quyền ${p}` })).toHaveCount(0);
    await s.page.getByRole("tab", { name: /^Được chia sẻ với tôi/ }).click();
    await expect(s.page.getByRole("link", { name: `Mở datahub Phân quyền ${p}` })).toHaveCount(0);
    await s.page.goto(url);
    await expect(s.page.getByRole("heading", { level: 1, name: `Phân quyền ${p}` })).toHaveCount(0);
    await expect(s.page.getByText("Bí mật")).toHaveCount(0);
    await expect(s.page.getByTestId("grid")).toHaveCount(0);
    await shot(s, `4-${who}-khong-thay`);
  }

  // Admin: the private datahub is closed, but the limits page works.
  const admin = await sessionOf(browser, "admin", DENIED);
  await admin.page.goto(url);
  await expect(admin.page.getByTestId("grid")).toHaveCount(0);
  await expect(admin.page.getByText("Bí mật")).toHaveCount(0);
  await admin.clickMenu("Giới hạn Datahub");
  await expect(admin.page.getByRole("heading", { level: 1, name: "Giới hạn Datahub theo người" })).toBeVisible();
  await expect(admin.page.getByTestId("limit-save")).toBeVisible();
  await shot(admin, "4-admin-gioi-han");
  // ...and the others do not see the limits page.
  const o2 = owner.page;
  await o2.goto("/quan-tri/datahub-gioi-han");
  await expect(o2.getByRole("heading", { level: 1, name: "Giới hạn Datahub theo người" })).toHaveCount(0);

  // Guest: no Datahub in the menu, and the page by address says there is no right.
  const guest = await sessionOf(browser, "guest", DENIED);
  expect(await guest.hasMenu("Datahub")).toBe(false);
  await guest.page.goto(url);
  await expect(guest.page.getByRole("heading", { level: 1, name: "Không có quyền" })).toBeVisible();
  await expect(guest.page.getByText("Bí mật")).toHaveCount(0);
  await shot(guest, "4-guest");

  // After the share is taken away the viewer loses it at once, by API.
  const shares = await rpc<{ id: string; grantee_id?: string }[]>("owner", "GET", `/datahubs/${dh.id}/shares`);
  for (const sh of shares) await rpc("owner", "DELETE", `/datahubs/${dh.id}/shares/${sh.id}`);
  expect(await can.read("viewer")).toBeGreaterThanOrEqual(403);
  expect(await can.read("editor")).toBeGreaterThanOrEqual(403);
});

// ------------------------------------------------------------------------------------------------
// 5. import then export
// ------------------------------------------------------------------------------------------------

test("nhập xlsx tự sinh (số lớn, số âm, ngày, ô trống, <b>) rồi xuất XLSX và CSV: từng ô khớp", async ({ browser }) => {
  test.setTimeout(180_000);
  const N = 60;
  const source: { name: string; big: number | null; neg: number | null; money: number | null; day: string | null; note: string | null }[] = [];
  for (let i = 0; i < N; i++)
    source.push({
      name: i % 10 === 0 ? `<b>Khách ${i}</b> & "Co", dòng` : `Khách ${i}`,
      big: i === 0 ? 999_999_999_999_999 : i % 9 === 0 ? null : i * 123_456_789,
      neg: i % 5 === 0 ? null : -(i * 1000) - (i % 3 === 0 ? 0.25 : 0),
      money: i % 4 === 0 ? null : (i * 7_000_003) % 1_000_000_000,
      day: i % 6 === 0 ? null : `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      note: i % 8 === 0 ? null : i % 7 === 0 ? "dòng 1\ndòng 2" : `Ghi chú <i>${i}</i>`,
    });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Dữ liệu xấu");
  ws.addRow(["Tên", "Số lớn", "Số âm", "Tiền", "Ngày", "Ghi chú"]);
  for (const r of source) {
    const row = ws.addRow([r.name, r.big, r.neg, r.money, r.day ? new Date(`${r.day}T00:00:00Z`) : null, r.note]);
    row.getCell(5).numFmt = "dd/mm/yyyy";
  }
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());

  const owner = await sessionOf(browser, "owner");
  const pg = owner.page;
  const dhName = `Nhập xuất xấu ${p}`;
  await pg.goto("/datahub");
  await pg.getByRole("button", { name: "Nhập dữ liệu" }).click();
  const d = dialog(pg, "Nhập dữ liệu");
  await d.getByLabel("Chọn file").setInputFiles({ name: "du-lieu-xau.xlsx", mimeType: XLSX, buffer: bytes });
  await d.getByRole("button", { name: "Đọc dữ liệu" }).click();
  await expect(d.getByTestId("import-sheets")).toContainText(`${N} dòng`);
  await d.getByRole("button", { name: "Ghép cột" }).click();
  await d.getByLabel("Tên datahub mới").fill(dhName);
  await expect(d.getByTestId("import-mapping")).toBeVisible();
  await d.getByRole("button", { name: "Kiểm tra" }).click();
  await expect(d.getByTestId("import-report-sheet")).toContainText(String(N));
  await shot(owner, "5-nhap-bao-cao");
  await d.getByRole("button", { name: "Bắt đầu nhập" }).click();
  await expect(d.getByTestId("import-result")).toContainText("Đã nhập xong", { timeout: 60_000 });
  await shot(owner, "5-nhap-xong");
  await d.getByRole("link", { name: /^Mở bảng/ }).click();
  await expect(pg.getByRole("heading", { level: 1, name: dhName })).toBeVisible();
  await expect(pg.getByText(`${N} dòng`, { exact: true })).toBeVisible();

  // The server: cell by cell the same as the file.
  const list = await rpc<{ id: string; name: string }[]>("owner", "GET", "/datahubs");
  const imported = list.find((x) => x.name === dhName)!;
  const full = await rpc<{ tables: { id: string; name: string }[] }>("owner", "GET", `/datahubs/${imported.id}`);
  const tableId = full.tables[0]!.id;
  const cols = await tableOf(ownerApi, tableId);
  const key = (n: string) => cols.find((c) => c.name === n)!.key;
  expect(Object.fromEntries(cols.map((c) => [c.name, c.type]))).toMatchObject({ Tên: "text", "Số lớn": "number", "Số âm": "number", Ngày: "date" });
  const server = await rowsOf(ownerApi, tableId, "&limit=500");
  expect(server).toHaveLength(N);
  const near = (a: unknown, b: number | null) => (b === null ? expect(a ?? null).toBeNull() : expect(Number(a)).toBeCloseTo(b, 6));
  source.forEach((s, i) => {
    const r = server[i]!.data;
    expect(r[key("Tên")], `Tên dòng ${i}`).toBe(s.name);
    near(r[key("Số lớn")], s.big);
    near(r[key("Số âm")], s.neg);
    near(r[key("Tiền")], s.money);
    expect(r[key("Ngày")] ?? null, `Ngày dòng ${i}`).toBe(s.day);
    // an empty note is empty, never the text "null" or "undefined"
    expect(r[key("Ghi chú")] ?? null, `Ghi chú dòng ${i}`).toBe(s.note);
  });

  // Export CSV and XLSX of the table and compare with the source again.
  await pg.goto(`/datahub/${imported.id}/${tableId}`);
  await expectMore(pg, "Xuất", true);
  const csv = parseCsv(fs.readFileSync(await exportFile(owner, "csv"), "utf8"));
  expect(csv[0]).toEqual(["Tên", "Số lớn", "Số âm", "Tiền", "Ngày", "Ghi chú"]);
  expect(csv.length).toBe(N + 1);
  const numCell = (c: string, v: number | null) => (v === null ? expect(c).toBe("") : expect(Number(c)).toBeCloseTo(v, 6));
  source.forEach((s, i) => {
    const c = csv[i + 1]!;
    expect(c[0], `CSV tên ${i}`).toBe(s.name);
    numCell(c[1]!, s.big);
    numCell(c[2]!, s.neg);
    numCell(c[3]!, s.money);
    expect(c[4], `CSV ngày ${i}`).toBe(s.day ?? "");
    expect(c[5], `CSV ghi chú ${i}`).toBe(s.note ?? "");
  });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(await exportFile(owner, "xlsx"));
  const w2 = wb2.getWorksheet("Dữ liệu xấu");
  expect(w2.rowCount).toBe(N + 1);
  const toDay = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? null : String(v));
  source.forEach((s, i) => {
    const row = w2.getRow(i + 2);
    expect(row.getCell(1).value, `XLSX tên ${i}`).toBe(s.name);
    for (const [c, v] of [[2, s.big], [3, s.neg], [4, s.money]] as const) {
      const cell = row.getCell(c).value;
      if (v === null) expect(cell ?? null).toBeNull();
      else expect(Number(cell)).toBeCloseTo(v, 6);
    }
    expect(toDay(row.getCell(5).value), `XLSX ngày ${i}`).toBe(s.day);
    expect(row.getCell(6).value ?? null, `XLSX ghi chú ${i}`).toBe(s.note);
  });
  await shot(owner, "5-bang-da-nhap");
});

// ------------------------------------------------------------------------------------------------
// 6. duplicates on 10.000 rows, then the trash
// ------------------------------------------------------------------------------------------------

test("tìm dòng trùng trên bảng 10.000 dòng nhiều nhóm; xử lý hết rồi khôi phục từ thùng rác", async ({ browser }) => {
  test.setTimeout(240_000);
  const dh = await rpc<{ id: string }>("owner", "POST", "/datahubs", { name: `Trùng nhiều ${p}` });
  const t = (await rpc<{ id: string }>("owner", "POST", `/datahubs/${dh.id}/tables`, { name: "Nhiều nhóm" })).id;
  await rpc("owner", "POST", `/tables/${t}/columns`, { name: "Mã", type: "text" });
  await rpc("owner", "POST", `/tables/${t}/columns`, { name: "Số thứ tự", type: "number" });
  // 2.500 groups of 4 rows that differ only by case, accents and spaces; and 100 rows with no key (never duplicates).
  const variants = (g: number) => [`KH-${g} Đà`, `kh-${g}  đa`, ` KH-${g} ĐÀ `, `kh-${g} Đà`];
  await seedMany(ownerApi, t, 10_100, (i) => (i < 10_000 ? { Mã: variants(i % 2500)[Math.floor(i / 2500)], "Số thứ tự": i } : { "Số thứ tự": i }));
  const found = await ownerApi.raw<{ data: { total_groups: number; total_rows: number } }>(`/tables/${t}/duplicates?columns=${encodeURIComponent("Mã")}&limit=1`).then((r) => r.data ?? (r as never));
  expect((found as { total_groups: number }).total_groups).toBe(2500);
  expect((found as { total_rows: number }).total_rows).toBe(10_000);

  const owner = await sessionOf(browser, "owner");
  const pg = owner.page;
  await pg.goto(`/datahub/${dh.id}/${t}`);
  await expect(pg.getByText("10.100 dòng", { exact: true })).toBeVisible({ timeout: 60_000 });
  await moreAction(pg, "Tìm dòng trùng");
  const dd = dialog(pg, "Tìm dòng trùng");
  await dd.getByRole("checkbox", { name: "Mã" }).check();
  await dd.getByRole("button", { name: "Tìm dòng trùng" }).click();
  await expect(dd.getByText("2.500 nhóm trùng, 10.000 dòng")).toBeVisible({ timeout: 30_000 });
  await shot(owner, "6-tim-trung-nhieu-nhom");
  await dd.getByRole("button", { name: "Xử lý mọi nhóm" }).click();
  const bulk = dialog(pg, "Xử lý mọi nhóm trùng");
  await bulk.getByRole("button", { name: /^Xoá dòng thừa của 2\.500 nhóm/ }).click();
  await expect(dd.getByText("Không có dòng trùng")).toBeVisible({ timeout: 120_000 });
  // One row of every group stays (the first), the 100 rows without a key stay: 2.600 rows. 7.500 are in the trash.
  const live = (await ownerApi.raw<{ total: number }>(`/tables/${t}/rows?limit=1&include_total=true`)).total;
  expect(live).toBe(2600);
  const kept = await rowsOf(ownerApi, t, "&limit=3");
  expect(kept.map((r) => r.data[(Object.keys(r.data))[0]!] ?? null).length).toBe(3);
  const trash = await ownerApi.call<{ rows: unknown[]; total_rows?: number }>("GET", `/datahub/trash?table_id=${t}`);
  expect(trash.rows.length).toBeGreaterThan(0);
  await dd.getByRole("button", { name: "Đóng" }).first().click();
  await expect(pg.getByText("2.600 dòng", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Trash: a row deleted after the bulk clean-up comes back with its values, by the button of the dialog.
  const cell = await rpc<{ id: string }>("owner", "POST", `/tables/${t}/rows`, { data: { Mã: "Dòng sẽ xoá <b>x</b>", "Số thứ tự": 123_456_789_012 } });
  await rpc("owner", "DELETE", `/tables/${t}/rows/${cell.id}`);
  await pg.reload();
  await expect(pg.getByText("2.600 dòng", { exact: true })).toBeVisible({ timeout: 30_000 });
  const inTrash = await ownerApi.call<{ rows: { id: string; row_no: number }[] }>("GET", `/datahub/trash?table_id=${t}`);
  const mine = inTrash.rows.find((r) => r.id === cell.id);
  expect(mine, "dòng vừa xoá phải nằm trong thùng rác").toBeDefined();
  await moreAction(pg, "Thùng rác");
  const td = dialog(pg, "Thùng rác của bảng");
  await expect(td.getByTestId("trash-row").first()).toBeVisible();
  await shot(owner, "6-thung-rac");
  await td.getByRole("button", { name: `Khôi phục dòng #${mine!.row_no}` }).click();
  const byId = async () => (await ownerApi.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${t}/rows?limit=1&filter=${encodeURIComponent(JSON.stringify({ field: "_id", op: "eq", value: cell.id }))}`)).data;
  await expect.poll(async () => (await byId()).length, { timeout: 30_000 }).toBe(1);
  const back = (await byId())[0]!;
  expect(Object.values(back.data)).toEqual(expect.arrayContaining(["Dòng sẽ xoá <b>x</b>", 123_456_789_012]));
  expect((await ownerApi.raw<{ total: number }>(`/tables/${t}/rows?limit=1&include_total=true`)).total).toBe(2601);
});
