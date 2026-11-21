import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { API, Session, type ProjectName } from "./helpers";
import { GridDriver } from "./grid";
import { ApiClient, createAdmin, seedPeople } from "./seed";

/**
 * Stage 2D: import (xlsx with several sheets, formulas, an existing table, pasted text, a bad link) and export (CSV, XLSX, by view,
 * what a viewer gets). Desktop only (quick test of this step); the phone runs in the final stage test.
 * The files used here are made in this test with invented data.
 */
test.describe.configure({ mode: "serial" });

// exceljs lives in the api package; the browser tests only need it to build and read test files.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExcelJS: any = createRequire(path.join(process.cwd(), "../api/package.json"))("exceljs");

let p: ProjectName;
const PASSWORD = () => `Kiem-thu-2d-${p}-7731`;
const email = (who: string) => `${p}.id${who}@base.vn`;
const ROOT = path.join(process.cwd(), "../..");
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let admin: ApiClient;
let owner: Session;
let viewer: Session;
let sessions: Session[] = [];
let ownerApi: ApiClient;
let ids: Record<string, string> = {};
let dhId: string;
let tableId: string;
const dhTitle = () => `Xuất nhập <b>${p}</b>`;
const ODD = "<b>Công ty</b> & Co";

const dialog = (page: Page, name?: string | RegExp): Locator => page.getByRole("dialog", name ? { name } : undefined).last();
const rowsOf = async (api: ApiClient, id: string) => (await api.raw<{ data: { id: string; data: Record<string, unknown> }[] }>(`/tables/${id}/rows?limit=500`)).data;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function xlsxBuffer(build: (wb: any) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function readXlsx(file: string): Promise<any> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

test.beforeAll(async ({ browser }, info) => {
  p = info.project.name as ProjectName;
  test.skip(p === "phone", "2D chỉ chạy ở desktop (điện thoại để kiểm thử cuối stage)");
  admin = await createAdmin(API, email("admin"), `Admin 2D ${p}`, PASSWORD(), ROOT);
  ids = await seedPeople(
    API,
    admin,
    [
      { email: email("mgr"), name: `Manager 2D ${p}`, roles: ["manager"] },
      { email: email("owner"), name: `Chủ 2D ${p}`, roles: ["user"], manager: email("mgr") },
      { email: email("viewer"), name: `Người Xem 2D ${p}`, roles: ["user"], manager: email("mgr") },
    ],
    PASSWORD(),
  );
  ownerApi = await new ApiClient(API).login(email("owner"), PASSWORD());
  const dh = await ownerApi.call<{ id: string }>("POST", "/datahubs", { name: dhTitle() });
  dhId = dh.id;
  tableId = (await ownerApi.call<{ id: string }>("POST", `/datahubs/${dh.id}/tables`, { name: "Deals" })).id;
  for (const c of [
    { name: "Tên", type: "text" },
    { name: "Doanh thu", type: "number" },
    { name: "Ngày ký", type: "date" },
    { name: "Đã gửi", type: "checkbox" },
    { name: "Gấp đôi", type: "formula", config: { formula: "=[Doanh thu]*2" } },
  ]) await ownerApi.call("POST", `/tables/${tableId}/columns`, c);
  const data = [
    { Tên: ODD, "Doanh thu": 123456789012345, "Ngày ký": "2026-11-18", "Đã gửi": true },
    { Tên: "Dòng, có \"ngoặc kép\"", "Doanh thu": -5.5 },
    { Tên: "Dòng trống" },
    { Tên: "Khách Thuận Phát", "Doanh thu": 2500000, "Ngày ký": "2026-12-01" },
  ];
  for (const d of data) await ownerApi.call("POST", `/tables/${tableId}/rows`, { data: d });
  await ownerApi.call("PUT", `/datahubs/${dh.id}/shares`, { grantee_id: ids[email("viewer")], permission: "view" });

  owner = await Session.open(browser, p, "owner");
  viewer = await Session.open(browser, p, "viewer");
  sessions = [owner, viewer];
  for (const s of sessions) await s.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: process.env.E2E_WEB_URL ?? "http://localhost:5273" });
  for (const [s, who] of [[owner, "owner"], [viewer, "viewer"]] as const) {
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

async function openTable(s: Session): Promise<void> {
  await s.page.goto(`/datahub/${dhId}/${tableId}`);
  await expect(s.page.getByRole("heading", { level: 1, name: dhTitle() })).toBeVisible();
  await expect(s.page.getByRole("button", { name: "Xuất", exact: true })).toBeVisible();
}

test("nhập xlsx hai sheet vào datahub mới, lấy công thức: dịch được, không dịch được và cảnh báo ngày", async () => {
  const bytes = await xlsxBuffer((wb) => {
    const deals = wb.addWorksheet("Deals");
    const head = ["Loại", "Doanh thu", "Ngày", "Gấp đôi", "Khác nhau", "Hàm lạ", "Tháng"];
    const formulas: Record<string, unknown>[][] = [];
    const plain: unknown[][] = [];
    for (let r = 2; r <= 5; r++) {
      const f = [{ formula: `B${r}*2`, result: r * 200 }, { formula: r === 2 ? `B${r}+1` : `B${r}*3`, result: r }, { formula: `INDIRECT("B${r}")`, result: r * 100 }, { formula: `LEFT(C${r},2)`, result: "09" }];
      formulas.push(f);
      plain.push([r === 3 ? "PS" : "POD", r * 100, new Date(Date.UTC(2026, 8, r)), ...f.map((x) => x.result)]);
    }
    deals.addTable({ name: "Deals", ref: "A1:G5", headerRow: true, columns: head.map((n) => ({ name: n })), rows: plain });
    // addTable writes plain values: put the formulas back on the cells.
    formulas.forEach((f, i) => f.forEach((v, k) => (deals.getCell(i + 2, k + 4).value = v)));
    deals.getColumn(3).numFmt = "mm/yyyy";
    const idx = wb.addWorksheet("Index");
    idx.addRow(["Loại", "Số deal"]);
    idx.addRow(["POD", { formula: "COUNTIFS(Deals[Loại],A2)", result: 3 }]);
    idx.addRow(["PS", { formula: "COUNTIFS(Deals[Loại],A3)", result: 1 }]);
  });
  const pg = owner.page;
  await pg.goto("/datahub");
  await pg.getByRole("button", { name: "Nhập dữ liệu" }).click();
  const d = dialog(pg, "Nhập dữ liệu");
  await expect(d.getByRole("button", { name: "Đọc dữ liệu" })).toBeDisabled();
  await d.getByLabel("Chọn file").setInputFiles({ name: "du-lieu.xlsx", mimeType: XLSX, buffer: bytes });
  await d.getByRole("button", { name: "Đọc dữ liệu" }).click();

  // Step 2: both sheets, with row and column counts and the formula badge; the preview shows the header row.
  const sheets = d.getByTestId("import-sheets");
  await expect(sheets.getByRole("listitem")).toHaveCount(2);
  await expect(sheets).toContainText("Deals");
  await expect(sheets).toContainText("4 dòng");
  await expect(sheets).toContainText("Có công thức");
  await expect(d.getByTestId("import-preview")).toContainText("Khác nhau");
  await owner.shot("import-step2");
  await d.getByRole("button", { name: "Ghép cột" }).click();

  // Step 3: a new datahub, formulas wanted.
  await d.getByLabel("Tên datahub mới").fill(`Nhập từ file ${p}`);
  await d.getByRole("checkbox", { name: /Lấy cả công thức/ }).check();
  await expect(d.getByTestId("import-mapping")).toBeVisible();
  await owner.shot("import-step3");
  await d.getByRole("button", { name: "Kiểm tra" }).click();

  // Step 4: the report says which columns became formulas and why the others did not.
  const sheet1 = d.getByTestId("import-report-sheet").first();
  await expect(sheet1).toContainText('Sheet "Deals"');
  await expect(sheet1).toContainText("4");
  const f = sheet1.getByTestId("import-formulas");
  await expect(f.locator("li", { hasText: "Gấp đôi" })).toContainText("Thành cột công thức");
  await expect(f.locator("li", { hasText: "Khác nhau" })).toContainText("Công thức khác nhau giữa các dòng");
  await expect(f.locator("li", { hasText: "Hàm lạ" })).toContainText("INDIRECT");
  // LEFT() over a date column: the warning stays, and the import now says it turned the columns into TEXT to match what Excel shows (4.5A).
  const warn = f.locator("li", { hasText: "Tháng" }).getByTestId("import-warning");
  await expect(warn.filter({ hasText: "LEFT()" })).toHaveCount(1);
  await expect(warn.filter({ hasText: "Đã tự đổi sang TEXT" })).toHaveCount(1);
  await owner.shot("import-step4");
  await d.getByRole("button", { name: "Bắt đầu nhập" }).click();

  // Step 5: progress, then the result and a link to the table.
  await expect(d.getByTestId("import-result")).toContainText("Đã nhập xong", { timeout: 30_000 });
  await expect(d.getByTestId("import-result")).toContainText('Sheet "Deals"');
  await owner.shot("import-done");
  await d.getByRole("link", { name: 'Mở bảng "Deals"' }).click();
  await expect(pg.getByRole("heading", { level: 1, name: `Nhập từ file ${p}` })).toBeVisible();

  // What the server holds: the formula is a real formula column, the others kept Excel's values.
  const list = await ownerApi.call<{ id: string; name: string }[]>("GET", "/datahubs");
  const dh = list.find((x) => x.name === `Nhập từ file ${p}`)!;
  const full = await ownerApi.call<{ tables: { id: string; name: string }[] }>("GET", `/datahubs/${dh.id}`);
  const deals = full.tables.find((t) => t.name === "Deals")!;
  const tbl = await ownerApi.call<{ columns: { name: string; type: string; key: string; config: { formula?: string } }[] }>("GET", `/tables/${deals.id}`);
  const types = Object.fromEntries(tbl.columns.map((c) => [c.name, c.type]));
  expect(types).toMatchObject({ "Gấp đôi": "formula", "Khác nhau": "number", "Hàm lạ": "number", Tháng: "formula", "Doanh thu": "number", "Ngày": "date" });
  expect(tbl.columns.find((c) => c.name === "Gấp đôi")!.config.formula).toBe("=[Doanh thu]*2");
  const gd = tbl.columns.find((c) => c.name === "Gấp đôi")!.key;
  await expect.poll(async () => (await rowsOf(ownerApi, deals.id)).map((r) => r.data[gd] as number).sort((a, b) => a - b)).toEqual([400, 600, 800, 1000]);
  const index = full.tables.find((t) => t.name === "Index")!;
  const itbl = await ownerApi.call<{ columns: { name: string; type: string; key: string }[] }>("GET", `/tables/${index.id}`);
  expect(itbl.columns.find((c) => c.name === "Số deal")!.type).toBe("formula");
  // The grid shows the imported rows.
  await expect(pg.getByRole("tab", { name: "Index" })).toBeVisible();
});

test("nhập vào bảng có sẵn từ bảng tính: dòng sai kiểu bị bỏ và báo đúng số dòng của dữ liệu dán", async () => {
  const before = (await rowsOf(ownerApi, tableId)).length;
  await openTable(owner);
  const pg = owner.page;
  await pg.getByRole("button", { name: "Nhập", exact: true }).click();
  const d = dialog(pg, "Nhập dữ liệu");
  await d.getByRole("tab", { name: "Dán dữ liệu" }).click();
  const text = ["Tên\tDoanh thu\tNgày ký", "Dòng A <i>nghiêng</i>\t100\t2026-01-05", "Dòng B\tabc\t2026-01-06", "Dòng C\t300\t31/02/2026", "Dòng D\t-45\t07/01/2026", "Dòng E\t\t"].join("\n");
  await d.getByLabel("Dữ liệu dán").fill(text);
  await d.getByRole("button", { name: "Đọc dữ liệu" }).click();
  await expect(d.getByTestId("import-sheets")).toContainText("5 dòng");
  await d.getByRole("button", { name: "Ghép cột" }).click();
  // The open table is the target and the columns with the same header are already mapped to it.
  await expect(d.getByLabel("Bảng có sẵn")).toHaveValue(tableId);
  await expect(d.getByLabel("Cột của bảng cho cột B")).not.toHaveValue("");
  await d.getByRole("button", { name: "Kiểm tra" }).click();
  await expect(d.getByTestId("import-report-sheet")).toContainText("3");
  const issues = d.getByTestId("import-issues");
  await expect(issues).toContainText("Dòng 3");
  await expect(issues).toContainText("Dòng 4");
  await owner.shot("import-report-errors");
  await d.getByRole("button", { name: "Bắt đầu nhập" }).click();
  await expect(d.getByTestId("import-result")).toContainText("Đã nhập xong", { timeout: 30_000 });
  await expect(d.getByTestId("import-result")).toContainText("Thêm 3");
  await expect(d.getByTestId("import-result")).toContainText("bỏ 2");
  await d.getByRole("button", { name: "Đóng", exact: true }).first().click();
  await expect.poll(async () => (await rowsOf(ownerApi, tableId)).length).toBe(before + 3);
  const names = (await rowsOf(ownerApi, tableId)).flatMap((r) => Object.values(r.data)).filter((v) => typeof v === "string");
  expect(names).toContain("Dòng A <i>nghiêng</i>");
  expect(names).toContain("Dòng D");
  expect(names).not.toContain("Dòng B");
  // The open grid picks up the new rows by itself and shows the markup as text.
  const grid = new GridDriver(pg);
  await expect.poll(() => grid.read(0, 4), { timeout: 15_000 }).toBe("Dòng A <i>nghiêng</i>");
});

test("link không phải Google Sheets và file không đọc được: báo lỗi rõ, không tạo gì", async () => {
  const pg = owner.page;
  owner.allow(400, /\/datahub\/imports$/); // the two refusals below are what the test is about
  await pg.goto("/datahub");
  await pg.getByRole("button", { name: "Nhập dữ liệu" }).click();
  const d = dialog(pg, "Nhập dữ liệu");
  await d.getByRole("tab", { name: "Link Google Sheets" }).click();
  await d.getByPlaceholder(/docs.google.com/).fill("https://example.com/khong-phai-google");
  await d.getByRole("button", { name: "Đọc dữ liệu" }).click();
  await expect(d.getByRole("alert").filter({ hasText: "Google Sheets" })).toBeVisible();
  await d.getByRole("tab", { name: "Tải file" }).click();
  await d.getByLabel("Chọn file").setInputFiles({ name: "hong.xlsx", mimeType: XLSX, buffer: Buffer.from("khong phai zip") });
  await d.getByRole("button", { name: "Đọc dữ liệu" }).click();
  // The alert of the link tab may still be on screen, so wait for the one about the file (the upload and the read have finished), not any alert.
  await expect(d.getByRole("alert").filter({ hasNotText: "Google Sheets" })).toBeVisible();
  await owner.shot("import-bad-source");
});

test("xuất CSV, XLSX, JSON: số rất lớn, số âm, ngày, ô trống, tên có <b> và công thức đúng; theo view khi có tìm kiếm", async () => {
  await openTable(owner);
  const pg = owner.page;
  const exportAs = async (format: string, scope?: "view" | "table" | "datahub") => {
    await pg.getByRole("button", { name: "Xuất", exact: true }).click();
    const d = dialog(pg, "Xuất dữ liệu");
    if (scope) await d.getByLabel("Phạm vi xuất").selectOption(scope);
    await d.getByLabel("Định dạng file").selectOption(format);
    const wait = pg.waitForEvent("download", { timeout: 30_000 });
    await d.getByRole("button", { name: "Xuất file" }).click();
    const dl = await wait;
    const file = path.join(process.cwd(), "e2e/results", `${p}-${Date.now()}-${dl.suggestedFilename().replace(/[^\w.-]/g, "_")}`);
    await dl.saveAs(file);
    await expect(d).toContainText("Đã xuất xong");
    await d.getByRole("button", { name: "Đóng", exact: true }).first().click();
    return { file, name: dl.suggestedFilename() };
  };

  const csv = await exportAs("csv", "table");
  expect(csv.name).toMatch(/\.csv$/);
  const text = fs.readFileSync(csv.file, "utf8");
  expect(text.startsWith("﻿")).toBe(true);
  expect(text).toContain("Tên,Doanh thu,Ngày ký,Đã gửi,Gấp đôi");
  expect(text).toContain(`${ODD},123456789012345,2026-11-18,true,246913578024690`);
  expect(text).toContain('"Dòng, có ""ngoặc kép""",-5.5,,,-11');
  expect(text).toContain("Dòng trống,,,,");

  const x = await exportAs("xlsx", "table");
  const wb = await readXlsx(x.file);
  expect(wb.worksheets.map((w: { name: string }) => w.name)).toEqual(["Deals", "Thông tin xuất", "Công thức"]);
  const ws = wb.getWorksheet("Deals");
  expect(ws.getRow(2).getCell(1).value).toBe(ODD);
  expect(ws.getRow(2).getCell(2).value).toBe(123456789012345);
  expect(ws.getRow(3).getCell(2).value).toBe(-5.5);
  expect(ws.getRow(2).getCell(5).value).toBe(246913578024690);
  expect(wb.getWorksheet("Công thức").getRow(2).values.slice(1)).toEqual(["Deals", "Gấp đôi", "=[Doanh thu]*2"]);

  const js = await exportAs("json", "table");
  const j = JSON.parse(fs.readFileSync(js.file, "utf8"));
  expect(j.rows).toHaveLength(7); // the four seeded rows and the three the import test added
  expect(j.rows[0]["Doanh thu"]).toBe(123456789012345);

  // By view: a search in the toolbar limits the file to the rows the person sees.
  await pg.getByRole("searchbox").first().fill("Thuận Phát").catch(async () => pg.getByPlaceholder(/Tìm/).first().fill("Thuận Phát"));
  await expect(pg.getByRole("button", { name: "Xuất", exact: true })).toBeVisible();
  await pg.waitForTimeout(600);
  const v = await exportAs("csv");
  const lines = fs.readFileSync(v.file, "utf8").slice(1).trimEnd().split("\r\n");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain("Khách Thuận Phát");
  await owner.shot("export-done");
});

test("người được chia sẻ Xem: xuất được dữ liệu nhưng file không có nội dung công thức, và không có nút Nhập", async () => {
  await openTable(viewer);
  const pg = viewer.page;
  await expect(pg.getByRole("button", { name: "Nhập", exact: true })).toHaveCount(0);
  await expect(pg.getByRole("button", { name: "Nhập dữ liệu" })).toHaveCount(0);
  await pg.getByRole("button", { name: "Xuất", exact: true }).click();
  const d = dialog(pg, "Xuất dữ liệu");
  await expect(d).toContainText("Bạn không được xem nội dung công thức");
  await d.getByLabel("Phạm vi xuất").selectOption("table");
  await d.getByLabel("Định dạng file").selectOption("xlsx");
  const wait = pg.waitForEvent("download", { timeout: 30_000 });
  await d.getByRole("button", { name: "Xuất file" }).click();
  const dl = await wait;
  const file = path.join(process.cwd(), "e2e/results", `${p}-viewer-${Date.now()}.xlsx`);
  await dl.saveAs(file);
  const wb = await readXlsx(file);
  expect(wb.worksheets.map((w: { name: string }) => w.name)).toEqual(["Deals", "Thông tin xuất"]);
  expect(wb.getWorksheet("Deals").getRow(2).getCell(5).value).toBe(246913578024690); // the value, yes
  expect(fs.readFileSync(file).toString("latin1")).not.toContain("Doanh thu]*2");
  // The viewer cannot start an import through the API either.
  const viewerApi = await new ApiClient(API).login(email("viewer"), PASSWORD());
  const an = await viewerApi.call<{ job: { id: string }; sheets: { name: string }[] }>("POST", "/datahub/imports", { text: "Tên\nX", filename: "x.csv" });
  await expect(
    viewerApi.call("POST", `/datahub/imports/${an.job.id}/start`, { mapping: { datahub: { id: dhId }, sheets: [{ sheet: an.sheets[0]!.name, table: { mode: "existing", table_id: tableId }, columns: [{ index: 0, target: "Tên" }] }] } }),
  ).rejects.toThrow(/403/);
});
