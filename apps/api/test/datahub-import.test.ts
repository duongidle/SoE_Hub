import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processJobs } from "../src/modules/datahub";
import { fetchGoogleSheet, parseGoogleSheetUrl } from "../src/modules/datahub/import-read";
import type { LocalStorageDriver } from "../src/storage";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA, org.admin]) await unlimit(t, p.id);
  a = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });

/** Uploads bytes the way the browser does (init, PUT, complete) and returns the file id. */
async function upload(call: ReturnType<typeof as>, bytes: Buffer, filename: string, type: string): Promise<string> {
  const init = await call("file.upload.init", { filename, content_type: type, size_bytes: bytes.length });
  await (t.c.storage as LocalStorageDriver).write(`files/${init.file.id}`, bytes);
  await call("file.upload.complete", { id: init.file.id });
  return init.file.id as string;
}

type Cell = string | number | boolean | Date | null | { formula: string; result?: string | number | boolean | Date };
async function xlsx(sheets: { name: string; rows: Cell[][]; fmts?: Record<number, string>; tables?: { name: string; ref: string; columns: string[] }[] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.rows.forEach((r) => ws.addRow(r));
    for (const [col, fmt] of Object.entries(s.fmts ?? {})) ws.getColumn(Number(col)).numFmt = fmt;
    for (const tb of s.tables ?? []) {
      ws.addTable({ name: tb.name, ref: tb.ref, headerRow: true, columns: tb.columns.map((n) => ({ name: n })), rows: s.rows.slice(1).map((r) => r.map((c) => (typeof c === "object" && c !== null && "formula" in c ? (c.result ?? null) : c))) as never });
      // addTable writes the plain values over the cells: put the formulas back.
      s.rows.forEach((r, ri) => r.forEach((c, ci) => typeof c === "object" && c !== null && "formula" in c && (ws.getCell(ri + 1, ci + 1).value = c as never)));
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function analyze(call: ReturnType<typeof as>, bytes: Buffer, name = "du-lieu.xlsx", type = XLSX) {
  const id = await upload(call, bytes, name, type);
  return call("datahub.import.analyze", { file_id: id });
}

async function finish(call: ReturnType<typeof as>, jobId: string) {
  await processJobs(env());
  await drainOutbox(t);
  return call("datahub.job.get", { job_id: jobId });
}

async function rowsOf(call: ReturnType<typeof as>, tableId: string) {
  const r = await call("datahub.row.list", { table_id: tableId, limit: 500, labels: "true", consistent: "true" });
  return r.items as { data: Record<string, unknown> }[];
}

/** Rows as plain objects by column NAME (key order of the JSON is not meaningful). */
async function named(call: ReturnType<typeof as>, tableId: string) {
  const cols = (await call("datahub.table.get", { table_id: tableId })).columns as { name: string; key: string }[];
  return (await rowsOf(call, tableId)).map((r) => Object.fromEntries(cols.filter((c) => r.data[c.key] !== undefined).map((c) => [c.name, r.data[c.key]])));
}

let n = 0;
const dhName = () => `Nhập ${++n} ${Date.now()}`;

describe("import: xlsx to a new table", () => {
  it("guesses types, creates the table and fills it; huge, negative, empty and <b> cells arrive intact", async () => {
    const rows: Cell[][] = [["Tên", "Doanh thu", "Tỉ lệ", "Ngày ký", "Đã gửi", "Email", "Mã"]];
    for (let i = 1; i <= 40; i++) rows.push([`Công ty ${i}`, i === 1 ? 123456789012345 : i === 2 ? -5.5 : i * 1000, 0.1, new Date(Date.UTC(2026, 10, (i % 28) + 1)), i % 2 === 0, `a${i}@x.vn`, i % 3 === 0 ? "Mới" : "Cũ"]);
    rows.push(["<b>Đậm</b>", null, null, null, null, null, null]);
    const bytes = await xlsx([{ name: "Deals", rows, fmts: { 3: "0%", 4: "dd/mm/yyyy" } }]);
    const an = await analyze(a, bytes);
    expect(an.job.status).toBe("draft");
    expect(an.sheets).toHaveLength(1);
    const sh = an.sheets[0];
    expect(sh.row_count).toBe(41);
    expect(sh.columns.map((c: { type: string }) => c.type)).toEqual(["text", "number", "percent", "date", "checkbox", "email", "single_select"]);
    expect(sh.preview[0].cells[0]).toBe("Tên");

    const mapping = { datahub: { name: dhName() }, sheets: [{ sheet: "Deals", table: { mode: "new", name: "Bảng deals" } }] };
    const pv = await a("datahub.import.preview", { job_id: an.job.id, mapping });
    expect(pv.ok).toBe(true);
    expect(pv.sheets[0]).toMatchObject({ rows_total: 41, valid: 41, invalid: 0, sampled: false });
    const started = await a("datahub.import.start", { job_id: an.job.id, mapping });
    expect(started.status).toBe("pending");
    const done = await finish(a, an.job.id);
    expect(done.status).toBe("done");
    expect(done.progress).toEqual({ done: 41, total: 41 });
    expect(done.report.sheets[0]).toMatchObject({ created: 41, skipped: 0, error_count: 0 });

    const tableId = done.report.sheets[0].table_id;
    const list = await rowsOf(a, tableId);
    expect(list).toHaveLength(41);
    const first = list[0]!.data;
    expect(first["c_" + "x"]).toBeUndefined();
    const tbl = await a("datahub.table.get", { table_id: tableId });
    const by = Object.fromEntries(tbl.columns.map((c: { name: string; key: string }) => [c.name, c.key]));
    expect(first[by["Doanh thu"]]).toBe(123456789012345);
    expect(list[1]!.data[by["Doanh thu"]]).toBe(-5.5);
    expect(first[by["Ngày ký"]]).toBe("2026-11-02");
    expect(first[by["Tỉ lệ"]]).toBeCloseTo(0.1);
    expect(first[by["Đã gửi"]]).toBe(false);
    expect(list[40]!.data[by["Tên"]]).toBe("<b>Đậm</b>");
    expect(list[40]!.data[by["Doanh thu"]]).toBeUndefined();
    expect(first[by["Mã"]]).toBe("Cũ"); // option names, not ids
    // The choice list came from the values in the file.
    const sel = tbl.columns.find((c: { name: string }) => c.name === "Mã");
    expect(sel.config.options.map((o: { name: string }) => o.name).sort()).toEqual(["Cũ", "Mới"]);
    // The datahub and table exist for the person.
    const dhs = await a("datahub.datahub.list", {});
    expect(JSON.stringify(dhs)).toContain("Bảng deals");
  });

  it("pasted text: tab separated (from Google Sheets), quoted cells with line breaks, comma decimal text stays text", async () => {
    const text = "Tên\tGhi chú\tSố\r\nAn\t\"dòng 1\nDòng 2\"\t10\r\nBình\t\"có \"\"ngoặc\"\"\"\t-3\r\n";
    const an = await a("datahub.import.analyze", { text, filename: "dán.csv" });
    expect(an.sheets[0].columns.map((c: { type: string }) => c.type)).toEqual(["text", "text", "number"]);
    const mapping = { datahub: { name: dhName() }, sheets: [{ sheet: "dán", table: { mode: "new", name: "Dán" } }] };
    await a("datahub.import.start", { job_id: an.job.id, mapping });
    const done = await finish(a, an.job.id);
    expect(done.status).toBe("done");
    const list = await named(a, done.report.sheets[0].table_id);
    expect(list[0]).toEqual({ "Tên": "An", "Ghi chú": "dòng 1\nDòng 2", "Số": 10 });
    expect(list[1]).toEqual({ "Tên": "Bình", "Ghi chú": 'có "ngoặc"', "Số": -3 });
  });

  it("semicolon CSV with BOM through an uploaded file; header row can be moved", async () => {
    const csv = "\uFEFFBáo cáo tháng 11\r\nTên;Điểm\r\nAn;9\r\nBình;8\r\n";
    const an = await analyze(a, Buffer.from(csv, "utf8"), "diem.csv", "text/csv");
    const sheet = await a("datahub.import.sheet", { job_id: an.job.id, sheet: an.sheets[0].name, header_row: 2 });
    expect(sheet.columns.map((c: { name: string }) => c.name)).toEqual(["Tên", "Điểm"]);
    expect(sheet.row_count).toBe(2);
    const mapping = { datahub: { name: dhName() }, sheets: [{ sheet: an.sheets[0].name, header_row: 2, table: { mode: "new", name: "Điểm" } }] };
    await a("datahub.import.start", { job_id: an.job.id, mapping });
    const done = await finish(a, an.job.id);
    expect(done.report.sheets[0].created).toBe(2);
  });
});

describe("import: into an existing table", () => {
  async function target() {
    return makeTable(a, { columns: [{ name: "Mã", type: "text", unique: true }, { name: "Giá", type: "number" }, { name: "Ngày", type: "date" }, { name: "Loại", type: "single_select", config: { options: [{ id: "o_aaaa", name: "A" }, { id: "o_bbbb", name: "B" }] } }] });
  }

  it("add: bad cells skip the row and are reported with the row number of the FILE; blank_cell keeps the row", async () => {
    const x = await target();
    const bytes = await xlsx([{ name: "S", rows: [["Mã", "Giá", "Ngày", "Loại"], ["m1", 10, "2026-11-01", "A"], ["m2", "abc", "2026-11-02", "A"], ["m3", 30, "31/02/2026", "B"], ["m4", 40, "2026-11-04", "Z"], ["m5", 50, "2026-11-05", "B"]] }]);
    const an = await analyze(a, bytes);
    const mapping = { datahub: { id: x.dhId }, sheets: [{ sheet: "S", table: { mode: "existing", table_id: x.tableId }, columns: [0, 1, 2, 3].map((i) => ({ index: i, target: ["Mã", "Giá", "Ngày", "Loại"][i] })) }] };
    const pv = await a("datahub.import.preview", { job_id: an.job.id, mapping });
    expect(pv.sheets[0]).toMatchObject({ valid: 2, invalid: 3 });
    expect(pv.sheets[0].errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
    await a("datahub.import.start", { job_id: an.job.id, mapping });
    const done = await finish(a, an.job.id);
    const rep = done.report.sheets[0];
    expect(rep).toMatchObject({ created: 2, skipped: 3, error_count: 3 });
    expect(rep.errors[0]).toMatchObject({ row: 3, column: "Giá" });
    expect(rep.new_table).toBe(false);
    expect((await named(a, x.tableId)).map((r) => r["Mã"])).toEqual(["m1", "m5"]);

    // blank_cell: the row is kept, the bad cell is empty.
    const y = await target();
    const an2 = await analyze(a, bytes);
    const m2 = { datahub: { id: y.dhId }, sheets: [{ ...mapping.sheets[0], table: { mode: "existing", table_id: y.tableId }, on_error: "blank_cell" }] };
    await a("datahub.import.start", { job_id: an2.job.id, mapping: m2 });
    const d2 = await finish(a, an2.job.id);
    expect(d2.report.sheets[0]).toMatchObject({ created: 5, skipped: 0, error_count: 3 });
  });

  it("a duplicate in a unique column is refused by the server for that row only; the other rows of the batch still go in", async () => {
    const x = await target();
    await a("datahub.row.create", { table_id: x.tableId, data: { "Mã": "dup" } });
    const bytes = await xlsx([{ name: "S", rows: [["Mã", "Giá"], ["n1", 1], ["dup", 2], ["n2", 3]] }]);
    const an = await analyze(a, bytes);
    const mapping = { datahub: { id: x.dhId }, sheets: [{ sheet: "S", table: { mode: "existing", table_id: x.tableId }, columns: [{ index: 0, target: "Mã" }, { index: 1, target: "Giá" }] }] };
    await a("datahub.import.start", { job_id: an.job.id, mapping });
    const done = await finish(a, an.job.id);
    expect(done.report.sheets[0]).toMatchObject({ created: 2, skipped: 1, error_count: 1 });
    expect(done.report.sheets[0].errors[0].row).toBe(3);
  });

  it("upsert by key updates existing rows and adds new ones; replace sends the old rows to the trash", async () => {
    const x = await target();
    await a("datahub.row.create", { table_id: x.tableId, data: { "Mã": "k1", "Giá": 1 } });
    const bytes = await xlsx([{ name: "S", rows: [["Mã", "Giá"], ["k1", 100], ["k2", 200]] }]);
    const an = await analyze(a, bytes);
    const base = { sheet: "S", table: { mode: "existing", table_id: x.tableId }, columns: [{ index: 0, target: "Mã" }, { index: 1, target: "Giá" }] };
    await a("datahub.import.start", { job_id: an.job.id, mapping: { datahub: { id: x.dhId }, sheets: [{ ...base, write: "upsert", key: "Mã" }] } });
    const done = await finish(a, an.job.id);
    expect(done.report.sheets[0]).toMatchObject({ created: 1, updated: 1 });
    expect(await named(a, x.tableId)).toEqual([{ "Mã": "k1", "Giá": 100 }, { "Mã": "k2", "Giá": 200 }]);

    const an2 = await analyze(a, await xlsx([{ name: "S", rows: [["Mã", "Giá"], ["z1", 9]] }]));
    await a("datahub.import.start", { job_id: an2.job.id, mapping: { datahub: { id: x.dhId }, sheets: [{ ...base, write: "replace" }] } });
    const d2 = await finish(a, an2.job.id);
    expect(d2.report.sheets[0]).toMatchObject({ created: 1, deleted: 2 });
    expect(await named(a, x.tableId)).toEqual([{ "Mã": "z1", "Giá": 9 }]);
    const trash = await a("datahub.trash.list", { table_id: x.tableId });
    expect(trash.rows).toHaveLength(2);
    expect((await fails(a("datahub.import.start", { job_id: an2.job.id, mapping: { datahub: { id: x.dhId }, sheets: [{ ...base, write: "replace" }] } }))).code).toBe("conflict"); // already started
  });

  it("refuses a column that cannot take file values, and an unknown target column", async () => {
    const x = await makeTable(a, { columns: [{ name: "Tính", type: "formula", config: { formula: "=1+1" } }, { name: "Mã", type: "text" }] });
    const an = await analyze(a, await xlsx([{ name: "S", rows: [["A"], ["1"]] }]));
    const mk = (target: string) => ({ datahub: { id: x.dhId }, sheets: [{ sheet: "S", table: { mode: "existing", table_id: x.tableId }, columns: [{ index: 0, target }] }] });
    expect((await fails(a("datahub.import.preview", { job_id: an.job.id, mapping: mk("Tính") }))).message).toContain("không nhập được");
    expect((await fails(a("datahub.import.preview", { job_id: an.job.id, mapping: mk("Không có") }))).message).toContain("không có cột");
  });
});

describe("import: limits", () => {
  it("columns over the limit, tables over the limit and a duplicate datahub name block the run, with the numbers in the message", async () => {
    const small = as(t, org.userA2.id);
    const { dhUserLimits } = await import("@soe/db");
    await t.c.db.db.insert(dhUserLimits).values({ userId: org.userA2.id, maxDatahubs: 2, maxTables: 2, maxColumns: 3 }).onConflictDoUpdate({ target: dhUserLimits.userId, set: { maxDatahubs: 2, maxTables: 2, maxColumns: 3 } });
    const an = await analyze(small, await xlsx([{ name: "S", rows: [["A", "B", "C", "D"], [1, 2, 3, 4]] }, { name: "T", rows: [["A"], [1]] }, { name: "U", rows: [["A"], [1]] }]));
    const mapping = { datahub: { name: dhName() }, sheets: [{ sheet: "S", table: { mode: "new", name: "S" } }, { sheet: "T", table: { mode: "new", name: "T" } }, { sheet: "U", table: { mode: "new", name: "U" } }] };
    const pv = await small("datahub.import.preview", { job_id: an.job.id, mapping });
    expect(pv.ok).toBe(false);
    expect(pv.blocking.join(" | ")).toContain("vượt giới hạn 3 cột");
    expect(pv.blocking.join(" | ")).toContain("vượt giới hạn 2 bảng");
    const e = await fails(small("datahub.import.start", { job_id: an.job.id, mapping }));
    expect(e.code).toBe("validation_error");
    expect(e.details.blocking.length).toBe(2);
    // Skipping a column brings it under the limit.
    const ok = { datahub: { name: dhName() }, sheets: [{ sheet: "S", table: { mode: "new", name: "S" }, columns: [{ index: 0 }, { index: 1 }, { index: 2 }] }] };
    expect((await small("datahub.import.preview", { job_id: an.job.id, mapping: ok })).ok).toBe(true);
    // A datahub name the person already has.
    const dup = await small("datahub.datahub.create", { name: "Có rồi" });
    const pv2 = await small("datahub.import.preview", { job_id: an.job.id, mapping: { ...ok, datahub: { name: dup.name } } });
    expect(pv2.blocking.join(" ")).toContain("đã có datahub tên");
  });
});

describe("import: formulas", () => {
  const dealsRows = (): Cell[][] => {
    const rows: Cell[][] = [["Loại", "Doanh thu", "Ngày", "Gấp đôi", "Khác nhau", "Thám số", "Hàm lạ", "Tháng"]];
    for (let r = 2; r <= 4; r++) {
      rows.push([r === 3 ? "PS" : "POD", r * 100, new Date(Date.UTC(2026, 8, r)), { formula: `B${r}*2`, result: r * 200 }, { formula: r === 2 ? `B${r}+1` : `B${r}*3`, result: 1 }, { formula: `B${r}*$J$1`, result: 1 }, { formula: `INDIRECT("B${r}")`, result: r * 100 }, { formula: `LEFT(C${r},2)`, result: "09" }]);
    }
    return rows;
  };

  it("translates same-row formulas, Table[Col] refs across sheets, and reports a reason for each column it cannot", async () => {
    const bytes = await xlsx([
      { name: "Deals", rows: dealsRows(), fmts: { 3: "mm/yyyy" }, tables: [{ name: "Deals", ref: "A1:H4", columns: ["Loại", "Doanh thu", "Ngày", "Gấp đôi", "Khác nhau", "Thám số", "Hàm lạ", "Tháng"] }] },
      { name: "Index", rows: [["Loại", "Số deal"], ["POD", { formula: 'COUNTIFS(Deals[Loại],A2)', result: 2 }], ["PS", { formula: 'COUNTIFS(Deals[Loại],A3)', result: 1 }]] },
    ]);
    const an = await analyze(a, bytes);
    const mapping = { datahub: { name: dhName() }, import_formulas: true, sheets: [{ sheet: "Deals", table: { mode: "new", name: "Deals" } }, { sheet: "Index", table: { mode: "new", name: "Index" } }] };
    const pv = await a("datahub.import.preview", { job_id: an.job.id, mapping });
    const dc = Object.fromEntries(pv.sheets[0].columns.map((c: { name: string; formula: unknown }) => [c.name, c.formula]));
    expect(dc["Gấp đôi"]).toMatchObject({ status: "formula" });
    expect(dc["Khác nhau"]).toMatchObject({ status: "value", code: "differs" });
    expect(dc["Thám số"]).toMatchObject({ status: "value", code: "fixed_cell" });
    expect(dc["Hàm lạ"]).toMatchObject({ status: "value", code: "unsupported_function" });
    expect(dc["Hàm lạ"].reason).toContain("INDIRECT");
    expect(dc["Tháng"]).toMatchObject({ status: "formula" });
    expect(dc["Tháng"].warnings[0]).toContain("LEFT()");
    expect(dc["Tháng"].warnings[0]).toContain("TEXT(ngày");
    expect(dc["Tháng"].warnings.some((w: string) => w.includes("Đã tự đổi"))).toBe(true);
    expect(pv.sheets[1].columns[1].formula).toMatchObject({ status: "formula" });

    await a("datahub.import.start", { job_id: an.job.id, mapping });
    const done = await finish(a, an.job.id);
    expect(done.status).toBe("done");
    const [deals, index] = done.report.sheets;
    const dtbl = await a("datahub.table.get", { table_id: deals.table_id });
    const types = Object.fromEntries(dtbl.columns.map((c: { name: string; type: string }) => [c.name, c.type]));
    expect(types).toMatchObject({ "Gấp đôi": "formula", "Khác nhau": "number", "Thám số": "number", "Hàm lạ": "number", "Tháng": "formula", "Doanh thu": "number" });
    // LEFT(ngày, 2) on a column shown as mm/yyyy became TEXT(ngày, "mm"): the same text Excel shows, computed from the date.
    expect(dtbl.columns.find((c: { name: string }) => c.name === "Tháng").config.formula).toBe('=TEXT([Ngày], "mm")');
    const dcol = dtbl.columns.find((c: { name: string }) => c.name === "Gấp đôi");
    expect(dcol.config.formula).toBe("=[Doanh thu]*2");
    const rows = await rowsOf(a, deals.table_id);
    expect(rows.map((r) => r.data[dcol.key])).toEqual([400, 600, 800]);
    // Value columns keep the numbers Excel had cached.
    const kcol = dtbl.columns.find((c: { name: string }) => c.name === "Hàm lạ");
    expect(rows.map((r) => r.data[kcol.key])).toEqual([200, 300, 400]);
    // The Index formula reads the Deals table of the same import.
    const itbl = await a("datahub.table.get", { table_id: index.table_id });
    const fcol = itbl.columns.find((c: { name: string }) => c.name === "Số deal");
    expect(fcol.type).toBe("formula");
    expect(fcol.config.formula).toBe("=COUNTIFS([Deals].[Loại],[Loại])");
    expect((await rowsOf(a, index.table_id)).map((r) => r.data[fcol.key])).toEqual([2, 1]);
  });

  it("without import_formulas every column is a value column and no reasons are asked for", async () => {
    const an = await analyze(a, await xlsx([{ name: "S", rows: [["A", "B"], [1, { formula: "A2*2", result: 2 }]] }]));
    const mapping = { datahub: { name: dhName() }, sheets: [{ sheet: "S", table: { mode: "new", name: "S" } }] };
    const pv = await a("datahub.import.preview", { job_id: an.job.id, mapping });
    expect(pv.sheets[0].columns.every((c: { formula: unknown }) => c.formula === null)).toBe(true);
    await a("datahub.import.start", { job_id: an.job.id, mapping });
    const done = await finish(a, an.job.id);
    const tbl = await a("datahub.table.get", { table_id: done.report.sheets[0].table_id });
    expect(tbl.columns.map((c: { type: string }) => c.type)).toEqual(["number", "number"]);
  });

  it("a formula that refers to a sheet that is not imported stays a value, with that reason", async () => {
    const bytes = await xlsx([{ name: "A", rows: [["X", "Y"], [1, { formula: "SUM(Plan!B:B)", result: 5 }]] }, { name: "Plan", rows: [["P", "Q"], [1, 5]] }]);
    const an = await analyze(a, bytes);
    const mapping = { datahub: { name: dhName() }, import_formulas: true, sheets: [{ sheet: "A", table: { mode: "new", name: "A" } }] };
    const pv = await a("datahub.import.preview", { job_id: an.job.id, mapping });
    expect(pv.sheets[0].columns[1].formula).toMatchObject({ status: "value", code: "missing_table" });
  });
});

describe("import: permissions and sources", () => {
  it("only the asker sees the job; a viewer cannot import into a table; an editor can add rows but not columns; Admin and strangers cannot", async () => {
    const x = await makeTable(a, { columns: [{ name: "Mã", type: "text" }] });
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.leaderA.id, permission: "edit_data" });
    const bytes = await xlsx([{ name: "S", rows: [["Mã", "Thêm"], ["1", "x"]] }]);
    const mapAll = { datahub: { id: x.dhId }, sheets: [{ sheet: "S", table: { mode: "existing", table_id: x.tableId } }] };
    const mapOne = { datahub: { id: x.dhId }, sheets: [{ sheet: "S", table: { mode: "existing", table_id: x.tableId }, columns: [{ index: 0, target: "Mã" }] }] };

    const viewer = as(t, org.userA2.id);
    const vAn = await analyze(viewer, bytes);
    expect((await fails(viewer("datahub.import.start", { job_id: vAn.job.id, mapping: mapOne }))).code).toBe("forbidden");

    const editor = as(t, org.leaderA.id);
    const eAn = await analyze(editor, bytes);
    const pv = await editor("datahub.import.preview", { job_id: eAn.job.id, mapping: mapAll });
    expect(pv.blocking.join(" ")).toContain("chỉ chủ datahub");
    expect((await fails(editor("datahub.import.start", { job_id: eAn.job.id, mapping: mapAll }))).code).toBe("validation_error");
    await editor("datahub.import.start", { job_id: eAn.job.id, mapping: mapOne });
    const done = await finish(editor, eAn.job.id);
    expect(done.report.sheets[0].created).toBe(1);

    expect((await fails(a("datahub.job.get", { job_id: eAn.job.id }))).code).toBe("not_found");
    expect((await fails(a("datahub.import.sheet", { job_id: eAn.job.id, sheet: "S", header_row: 1 }))).code).toBe("not_found");
    const stranger = as(t, org.userB1.id);
    const sAn = await analyze(stranger, bytes);
    expect((await fails(stranger("datahub.import.preview", { job_id: sAn.job.id, mapping: mapOne }))).code).toBe("not_found");
    // Admin has no business rights: no datahub of their own, and nobody else's table.
    const admin = as(t, org.admin.id);
    const adAn = await admin("datahub.import.analyze", { text: "a,b\n1,2" });
    expect((await fails(admin("datahub.import.start", { job_id: adAn.job.id, mapping: { datahub: { name: dhName() }, sheets: [{ sheet: adAn.sheets[0].name, table: { mode: "new", name: "X" } }] } }))).code).toBe("forbidden");
    expect((await fails(admin("datahub.import.preview", { job_id: adAn.job.id, mapping: mapOne }))).code).toBe("not_found");
    const guest = as(t, org.guestSale.id);
    expect((await fails(guest("datahub.import.analyze", { text: "a,b\n1,2" }))).code).toBe("forbidden");
  });

  it("refuses a file that is not a spreadsheet, a missing file, an unknown sheet and a non-Google link", async () => {
    const junk = await upload(a, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00]), "x.csv", "text/csv");
    expect((await fails(a("datahub.import.analyze", { file_id: junk }))).code).toBe("validation_error");
    expect((await fails(a("datahub.import.analyze", { file_id: "01900000-0000-7000-8000-0000000000ff" }))).code).toBe("not_found");
    expect((await fails(a("datahub.import.analyze", { url: "https://evil.example.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaaaa" }))).code).toBe("validation_error");
    expect((await fails(a("datahub.import.analyze", { file_id: junk, text: "x" }))).code).toBe("validation_error");
    const an = await a("datahub.import.analyze", { text: "a,b\n1,2" });
    expect((await fails(a("datahub.import.preview", { job_id: an.job.id, mapping: { datahub: { name: dhName() }, sheets: [{ sheet: "Không có", table: { mode: "new", name: "X" } }] } }))).message).toContain("Không có sheet");
  });
});

describe("import: Google Sheets link", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
  it("reads the spreadsheet id and tab from the link and refuses other addresses", () => {
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=123`)).toEqual({ id, gid: "123" });
    expect(parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit?usp=sharing`)).toEqual({ id, gid: null });
    expect(parseGoogleSheetUrl(`http://docs.google.com/spreadsheets/d/${id}`)).toBeNull();
    expect(parseGoogleSheetUrl(`https://docs.google.com.evil.com/spreadsheets/d/${id}`)).toBeNull();
    expect(parseGoogleSheetUrl("https://example.com/a")).toBeNull();
  });

  it("downloads the xlsx export; a private sheet (login page) gets a clear message; a redirect to another host is refused", async () => {
    const bytes = await xlsx([{ name: "Trang tính", rows: [["Tên"], ["An"]] }]);
    const ok = await fetchGoogleSheet(`https://docs.google.com/spreadsheets/d/${id}/edit`, 1e6, async (url) => {
      expect(url).toBe(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
      return { ok: true, status: 200, url: "https://doc-0s-ak-sheets.googleusercontent.com/export/x", headers: { get: (n: string) => (n === "content-type" ? XLSX : null) }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer };
    });
    expect(ok.bytes.length).toBe(bytes.length);
    const html = async () => ({ ok: true, status: 200, url: "https://accounts.google.com/ServiceLogin", headers: { get: (n: string) => (n === "content-type" ? "text/html" : null) }, arrayBuffer: async () => new ArrayBuffer(10) });
    await expect(fetchGoogleSheet(`https://docs.google.com/spreadsheets/d/${id}`, 1e6, html)).rejects.toThrow(/Bất kỳ ai có đường liên kết/);
    const evil = async () => ({ ok: true, status: 200, url: "https://evil.example.com/x", headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(10) });
    await expect(fetchGoogleSheet(`https://docs.google.com/spreadsheets/d/${id}`, 1e6, evil)).rejects.toThrow(/địa chỉ lạ/);
    const big = async () => ({ ok: true, status: 200, url: "https://docs.google.com/x", headers: { get: (n: string) => (n === "content-length" ? "999999999" : XLSX) }, arrayBuffer: async () => new ArrayBuffer(10) });
    await expect(fetchGoogleSheet(`https://docs.google.com/spreadsheets/d/${id}`, 1e6, big)).rejects.toThrow(/quá lớn/);
  });
});

describe("import: job housekeeping", () => {
  it("cancel while waiting; the source file of an upload is not deleted by the purge, a pasted one is", async () => {
    const an = await a("datahub.import.analyze", { text: "a,b\n1,2" });
    const key = (await t.c.db.db.execute(sql`SELECT source_key FROM dh_jobs WHERE id = ${an.job.id}::uuid`)).rows[0] as { source_key: string };
    expect(await t.c.storage.stat(key.source_key)).not.toBeNull();
    const c = await a("datahub.job.cancel", { job_id: an.job.id });
    expect(c.status).toBe("cancelled");
    const { purgeJobFiles } = await import("../src/modules/datahub");
    await t.c.db.db.execute(sql`UPDATE dh_jobs SET updated_at = now() - interval '2 days' WHERE id = ${an.job.id}::uuid`);
    await purgeJobFiles(t.c.db.db, t.c.storage);
    expect(await t.c.storage.stat(key.source_key)).toBeNull();

    const fileId = await upload(a, Buffer.from("a,b\n1,2"), "k.csv", "text/csv");
    const an2 = await a("datahub.import.analyze", { file_id: fileId });
    await t.c.db.db.execute(sql`UPDATE dh_jobs SET updated_at = now() - interval '2 days', status = 'cancelled' WHERE id = ${an2.job.id}::uuid`);
    await purgeJobFiles(t.c.db.db, t.c.storage);
    expect(await t.c.storage.stat(`files/${fileId}`)).not.toBeNull();
  });
});
