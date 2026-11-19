import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processJobs } from "../src/modules/datahub";
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

export const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });

/** Runs the worker's job loop once and returns the finished job. */
async function runJob(call: ReturnType<typeof as>, id: string) {
  await processJobs(env());
  return call("datahub.job.get", { job_id: id });
}

async function resultBytes(id: string): Promise<Buffer> {
  const r = (await t.c.db.db.execute(sql`SELECT result_key FROM dh_jobs WHERE id = ${id}::uuid`)).rows[0] as { result_key: string };
  const chunks: Buffer[] = [];
  for await (const c of (t.c.storage as unknown as { read(k: string): AsyncIterable<Buffer> }).read(r.result_key)) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function seed() {
  const x = await makeTable(a, {
    columns: [
      { name: "Tên", type: "text" },
      { name: "Doanh thu", type: "number" },
      { name: "Tỉ lệ", type: "percent" },
      { name: "Ngày ký", type: "date" },
      { name: "Giờ gọi", type: "datetime" },
      { name: "Đã gửi", type: "checkbox" },
      { name: "Giai đoạn", type: "single_select", config: { options: [{ id: "o_aaaa", name: "Mới" }, { id: "o_bbbb", name: "Chốt, có dấu phẩy" }] } },
      { name: "Nhãn", type: "multi_select", config: { options: [{ id: "o_cccc", name: "A" }, { id: "o_dddd", name: "B" }] } },
      { name: "Phụ trách", type: "user" },
      { name: "Gấp đôi", type: "formula", config: { formula: "=[Doanh thu]*2" } },
    ],
  });
  await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, table_id: x.tableId, permission: "view" }); // user cells take only members (module2 section 10)
  const rows: Record<string, unknown>[] = [
    { "Tên": "<b>Công ty Thuận Phát</b>", "Doanh thu": 123456789012345, "Tỉ lệ": 0.07, "Ngày ký": "2026-11-18", "Giờ gọi": "2026-11-18T09:30:00+07:00", "Đã gửi": true, "Giai đoạn": "Mới", "Nhãn": ["A", "B"], "Phụ trách": org.userA2.id },
    { "Tên": "Dòng, có \"ngoặc kép\"\nvà xuống dòng", "Doanh thu": -5.5, "Giai đoạn": "Chốt, có dấu phẩy" },
    { "Tên": "=HYPERLINK(\"http://x\")" },
    { "Tên": "Dòng trống" },
  ];
  for (const r of rows) await a("datahub.row.create", { table_id: x.tableId, data: r });
  await drainOutbox(t); // the worker's recalculation loop (the export waits for computed columns)
  return x;
}

describe("export: values, formats", () => {
  it("CSV: UTF-8 BOM, header, quoting, huge and negative numbers, dates, empty cells, no formula injection", async () => {
    const x = await seed();
    const job = await a("datahub.export.create", { table_id: x.tableId, format: "csv" });
    expect(job.status).toBe("pending");
    const done = await runJob(a, job.id);
    expect(done.status).toBe("done");
    expect(done.result.name).toMatch(/\.csv$/);
    const text = (await resultBytes(job.id)).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toBe("Tên,Doanh thu,Tỉ lệ,Ngày ký,Giờ gọi,Đã gửi,Giai đoạn,Nhãn,Phụ trách,Gấp đôi");
    expect(text).toContain("<b>Công ty Thuận Phát</b>,123456789012345,7%,2026-11-18,2026-11-18T09:30:00+07:00,true,Mới,\"A, B\"");
    expect(text).toContain(`${org.userA2.name}`);
    expect(text).toContain('"Dòng, có ""ngoặc kép""\nvà xuống dòng",-5.5,,,,,"Chốt, có dấu phẩy"');
    expect(text).toContain("'=HYPERLINK"); // text starting with = is neutralised
    expect(text).toContain("246913578024690"); // the formula value is the stored one
    expect(done.report.rows).toBeTruthy();
    expect(done.progress.done).toBe(4);
  });

  it("XLSX: typed cells, Công thức and Thông tin xuất sheets for the owner", async () => {
    const x = await seed();
    const job = await a("datahub.export.create", { table_id: x.tableId, format: "xlsx" });
    await runJob(a, job.id);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await resultBytes(job.id)) as never);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(["Bảng 1", "Thông tin xuất", "Công thức"]);
    const ws = wb.getWorksheet("Bảng 1")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Tên", "Doanh thu", "Tỉ lệ", "Ngày ký", "Giờ gọi", "Đã gửi", "Giai đoạn", "Nhãn", "Phụ trách", "Gấp đôi"]);
    const r2 = ws.getRow(2);
    expect(r2.getCell(1).value).toBe("<b>Công ty Thuận Phát</b>");
    expect(r2.getCell(2).value).toBe(123456789012345);
    expect(r2.getCell(3).value).toBeCloseTo(0.07);
    expect((r2.getCell(4).value as Date).toISOString().slice(0, 10)).toBe("2026-11-18");
    expect(r2.getCell(6).value).toBe(true);
    expect(ws.getRow(3).getCell(2).value).toBe(-5.5);
    expect(ws.getRow(3).getCell(3).value).toBeNull();
    // A text cell that looks like a formula stays text in the file.
    expect(ws.getRow(4).getCell(1).value).toBe('=HYPERLINK("http://x")');
    expect(wb.getWorksheet("Công thức")!.getRow(2).values).toEqual([undefined, "Bảng 1", "Gấp đôi", "=[Doanh thu]*2"]);
    const info = wb.getWorksheet("Thông tin xuất")!;
    expect(info.getCell("A1").value).toBe("Người xuất");
  });

  it("JSON: metadata, column types and rows by column name", async () => {
    const x = await seed();
    const job = await a("datahub.export.create", { table_id: x.tableId, format: "json" });
    await runJob(a, job.id);
    const j = JSON.parse((await resultBytes(job.id)).toString("utf8"));
    expect(j.table).toBe("Bảng 1");
    expect(j.columns[0]).toEqual({ name: "Tên", type: "text" });
    expect(j.rows).toHaveLength(4);
    expect(j.rows[0]["Doanh thu"]).toBe(123456789012345);
    expect(j.rows[3]["Doanh thu"]).toBeNull();
  });

  it("by view: filter, sort, search and chosen columns in the chosen order", async () => {
    const x = await seed();
    const job = await a("datahub.export.create", {
      table_id: x.tableId,
      format: "csv",
      filter: { field: "Doanh thu", op: "gt", value: -10 },
      sort: "Doanh thu:asc",
      columns: ["Doanh thu", "Tên"],
    });
    await runJob(a, job.id);
    const lines = (await resultBytes(job.id)).toString("utf8").slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Doanh thu,Tên");
    expect(lines).toHaveLength(3);
    expect(lines[1]!.startsWith("-5.5,")).toBe(true);
    expect((await fails(a("datahub.export.create", { table_id: x.tableId, format: "csv", columns: ["Không có"] }))).code).toBe("validation_error");
  });

  it("whole datahub as XLSX: one sheet per table; CSV of a whole datahub is refused", async () => {
    const x = await seed();
    const t2 = await a("datahub.table.create", { datahub_id: x.dhId, name: "Bảng phụ" });
    await a("datahub.column.create", { table_id: t2.id, name: "Mã", type: "text" });
    await a("datahub.row.create", { table_id: t2.id, data: { "Mã": "X1" } });
    const job = await a("datahub.export.create", { datahub_id: x.dhId, format: "xlsx" });
    const done = await runJob(a, job.id);
    expect(done.status).toBe("done");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await resultBytes(job.id)) as never);
    expect(wb.worksheets.map((w) => w.name).slice(0, 2)).toEqual(["Bảng 1", "Bảng phụ"]);
    expect(wb.getWorksheet("Bảng phụ")!.getRow(2).getCell(1).value).toBe("X1");
    expect((await fails(a("datahub.export.create", { datahub_id: x.dhId, format: "csv" }))).code).toBe("validation_error");
    expect((await fails(a("datahub.export.create", { format: "csv" }))).code).toBe("validation_error");
  });

  it("an empty table exports a header only", async () => {
    const x = await makeTable(a, { columns: [{ name: "Cột", type: "text" }] });
    const job = await a("datahub.export.create", { table_id: x.tableId, format: "csv" });
    const done = await runJob(a, job.id);
    expect(done.status).toBe("done");
    expect((await resultBytes(job.id)).toString("utf8")).toBe("﻿Cột\r\n");
  });
});

describe("export: permissions", () => {
  it("owner, viewer (no formula text), editor; strangers, Admin, Guest are refused; job belongs to the asker", async () => {
    const x = await seed();
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.leaderA.id, permission: "edit_data" });
    const viewer = as(t, org.userA2.id);
    const editor = as(t, org.leaderA.id);

    const vj = await viewer("datahub.export.create", { table_id: x.tableId, format: "xlsx" });
    const done = await runJob(viewer, vj.id);
    expect(done.status).toBe("done");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await resultBytes(vj.id)) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bảng 1", "Thông tin xuất"]); // no Công thức sheet
    expect(wb.getWorksheet("Bảng 1")!.getRow(2).getCell(10).value).toBe(246913578024690); // but the value is there
    const raw = (await resultBytes(vj.id)).toString("latin1");
    expect(raw).not.toContain("Doanh thu]*2");

    const ej = await editor("datahub.export.create", { table_id: x.tableId, format: "csv" });
    expect((await runJob(editor, ej.id)).status).toBe("done");

    for (const [who, uid] of [["stranger", org.userA1.id === org.userB1.id ? "" : org.userB1.id], ["manager of another tree", org.mgrB.id], ["admin", org.admin.id], ["manager of the same tree", org.mgrA.id]] as const) {
      const c = as(t, uid);
      const e = await fails(c("datahub.export.create", { table_id: x.tableId, format: "csv" }));
      expect(["not_found", "forbidden"], who).toContain(e.code);
    }
    const guest = as(t, org.guestSale.id);
    expect((await fails(guest("datahub.export.create", { table_id: x.tableId, format: "csv" }))).code).toBe("forbidden");

    // Someone else's job is invisible.
    expect((await fails(editor("datahub.job.get", { job_id: vj.id }))).code).toBe("not_found");
    expect((await fails(editor("datahub.job.download_url", { job_id: vj.id }))).code).toBe("not_found");
    const link = await viewer("datahub.job.download_url", { job_id: vj.id });
    expect(link.filename).toMatch(/\.xlsx$/);
    const mine = await viewer("datahub.job.list", { kind: "export" });
    expect(mine.map((j: { id: string }) => j.id)).toContain(vj.id);
    expect((await editor("datahub.job.list", {})).map((j: { id: string }) => j.id)).not.toContain(vj.id);
  });

  it("a table the viewer was not shared is not exported; the datahub export carries only shared tables", async () => {
    const x = await seed();
    const t2 = await a("datahub.table.create", { datahub_id: x.dhId, name: "Bảng riêng" });
    await a("datahub.row.create", { table_id: t2.id, data: {} }).catch(() => {});
    await a("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, table_id: x.tableId, permission: "view" });
    const viewer = as(t, org.userA2.id);
    expect((await fails(viewer("datahub.export.create", { table_id: t2.id, format: "csv" }))).code).toBe("not_found");
    const job = await viewer("datahub.export.create", { datahub_id: x.dhId, format: "xlsx" });
    await runJob(viewer, job.id);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await resultBytes(job.id)) as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Bảng 1", "Thông tin xuất"]);
  });
});

describe("jobs: queue behaviour", () => {
  it("limits active jobs per person, cancel works, audit records the export", async () => {
    const x = await makeTable(a, { columns: [{ name: "C", type: "text" }] });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await a("datahub.export.create", { table_id: x.tableId, format: "csv" })).id);
    expect((await fails(a("datahub.export.create", { table_id: x.tableId, format: "csv" }))).code).toBe("quota_exceeded");
    const c = await a("datahub.job.cancel", { job_id: ids[0] });
    expect(c.status).toBe("cancelled");
    await processJobs(env());
    expect((await a("datahub.job.get", { job_id: ids[0] })).status).toBe("cancelled");
    expect((await a("datahub.job.get", { job_id: ids[1] })).status).toBe("done");
    const audit = await t.c.db.db.execute(sql`SELECT details FROM audit_log WHERE command = 'datahub.export.create' AND result = 'success' ORDER BY at DESC LIMIT 1`);
    expect(JSON.stringify(audit.rows[0])).toContain("csv");
  });
});
