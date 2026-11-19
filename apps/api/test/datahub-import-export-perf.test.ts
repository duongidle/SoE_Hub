import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processJobs } from "../src/modules/datahub";
import type { LocalStorageDriver } from "../src/storage";
import { as, drainOutbox, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Load test of import and export (design module2 sections 8, 9; "chịu được 100.000 dòng"): a made-up workbook of 100.000 rows is
 * imported, exported as XLSX and CSV. Times and peak memory of the process are printed so the run records them (and written into
 * design/module2-quyet-dinh-khi-code.md by hand).
 */
const ROWS = 100_000;
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Samples the resident memory while `fn` runs; returns its time and the highest value seen. */
async function measure<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number; peakMb: number; startMb: number }> {
  const mb = () => Math.round(process.memoryUsage().rss / 1024 / 1024);
  const startMb = mb();
  let peak = startMb;
  const timer = setInterval(() => (peak = Math.max(peak, mb())), 200);
  const t0 = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - t0, peakMb: Math.max(peak, mb()), startMb };
  } finally {
    clearInterval(timer);
  }
}

async function upload(bytes: Buffer, filename: string, type: string): Promise<string> {
  const init = await a("file.upload.init", { filename, content_type: type, size_bytes: bytes.length });
  await (t.c.storage as LocalStorageDriver).write(`files/${init.file.id}`, bytes);
  await a("file.upload.complete", { id: init.file.id });
  return init.file.id as string;
}

async function bigWorkbook(): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), "soe-perf-"));
  const file = path.join(dir, "big.xlsx");
  try {
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useSharedStrings: false });
    const ws = wb.addWorksheet("Deals");
    ws.addRow(["Mã", "Khách hàng", "Doanh thu", "Tỉ lệ", "Ngày ký", "Đã gửi", "Giai đoạn", "Ghi chú", "Gấp đôi"]).commit();
    const stages = ["Mới", "Đang chăm", "Chốt", "Mất"];
    for (let i = 1; i <= ROWS; i++) {
      const r = i + 1;
      ws.addRow([`D${i}`, `Công ty số ${i} <b>&</b>`, i % 7 === 0 ? -i * 1000 : i * 1000, (i % 100) / 100, new Date(Date.UTC(2026, i % 12, (i % 27) + 1)), i % 2 === 0, stages[i % 4], i % 10 === 0 ? `Ghi chú dài cho dòng ${i}` : null, { formula: `C${r}*2`, result: i * 2000 }]).commit();
    }
    ws.commit();
    await wb.commit();
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("import and export of 100.000 rows", () => {
  it("imports an xlsx (with a same-row formula column), then exports XLSX and CSV", async () => {
    const gen = await measure(bigWorkbook);
    const bytes = gen.value;
    console.warn(`[perf-io] made the test workbook: ${bytes.length} bytes, ${gen.ms} ms`);
    const fileId = await upload(bytes, "big.xlsx", XLSX);

    const an = await measure(() => a("datahub.import.analyze", { file_id: fileId }));
    console.warn(`[perf-io] analyze: ${an.ms} ms, rss ${an.value && an.startMb} -> ${an.peakMb} MB`);
    expect(an.value.sheets[0].row_count).toBe(ROWS);
    const mapping = { datahub: { name: "Tải lớn" }, import_formulas: true, sheets: [{ sheet: "Deals", table: { mode: "new", name: "Deals" } }] };
    const pv = await measure(() => a("datahub.import.preview", { job_id: an.value.job.id, mapping }));
    console.warn(`[perf-io] preview: ${pv.ms} ms, rss peak ${pv.peakMb} MB`);
    expect(pv.value.ok).toBe(true);
    expect(pv.value.sheets[0]).toMatchObject({ rows_total: ROWS, sampled: true, invalid: 0 });
    expect(pv.value.sheets[0].columns.find((c: { name: string }) => c.name === "Gấp đôi").formula.status).toBe("formula");

    await a("datahub.import.start", { job_id: an.value.job.id, mapping });
    const run = await measure(() => processJobs(env()));
    const job = await a("datahub.job.get", { job_id: an.value.job.id });
    console.warn(`[perf-io] import ${ROWS} rows: ${run.ms} ms (${Math.round(ROWS / (run.ms / 1000))} rows/s), rss ${run.startMb} -> peak ${run.peakMb} MB, status ${job.status}`);
    expect(job.status).toBe("done");
    expect(job.report.sheets[0]).toMatchObject({ created: ROWS, skipped: 0, error_count: 0 });
    const tableId = job.report.sheets[0].table_id as string;
    const n = (await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM dh_rows WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL`)).rows[0] as { n: number };
    expect(n.n).toBe(ROWS);
    await drainOutbox(t);

    // Values survived: the sum of the revenue column and a formula check.
    const tbl = await a("datahub.table.get", { table_id: tableId });
    const key = (name: string) => tbl.columns.find((c: { name: string }) => c.name === name).key as string;
    const sums = (await t.c.db.db.execute(sql.raw(`SELECT sum((data->>'${key("Doanh thu")}')::numeric) AS s, sum((data->>'${key("Gấp đôi")}')::numeric) AS f FROM dh_rows WHERE /*scope:system*/ table_id = '${tableId}' AND deleted_at IS NULL`))).rows[0] as { s: string; f: string };
    let expected = 0;
    for (let i = 1; i <= ROWS; i++) expected += i % 7 === 0 ? -i * 1000 : i * 1000;
    expect(Number(sums.s)).toBe(expected);
    expect(Number(sums.f)).toBe(expected * 2);
    expect(run.ms).toBeLessThan(180_000);

    let csvBytes: Buffer = Buffer.alloc(0);
    for (const format of ["xlsx", "csv"] as const) {
      const ex = await a("datahub.export.create", { table_id: tableId, format });
      const r = await measure(() => processJobs(env()));
      const done = await a("datahub.job.get", { job_id: ex.id });
      console.warn(`[perf-io] export ${format} ${ROWS} rows: ${r.ms} ms, rss ${r.startMb} -> peak ${r.peakMb} MB, file ${done.result?.size_bytes} bytes, status ${done.status}`);
      expect(done.status).toBe("done");
      expect(done.progress.done).toBe(ROWS);
      if (format === "csv") {
        const row = (await t.c.db.db.execute(sql`SELECT result_key FROM dh_jobs WHERE id = ${ex.id}::uuid`)).rows[0] as { result_key: string };
        const bytesOut = await readFile(path.join(t.c.config.STORAGE_LOCAL_DIR, row.result_key));
        expect(bytesOut.toString("utf8").split("\r\n").filter(Boolean).length).toBe(ROWS + 1);
        csvBytes = bytesOut;
      }
      expect(r.ms).toBeLessThan(120_000);
    }

    // Round trip: the CSV that was just exported is imported again (as text, new table) and gives the same rows and the same sum.
    const csvId = await upload(csvBytes, "lai.csv", "text/csv");
    const an2 = await a("datahub.import.analyze", { file_id: csvId });
    const map2 = { datahub: { name: "Vòng lại" }, sheets: [{ sheet: an2.sheets[0].name, table: { mode: "new", name: "Lai" } }] };
    await a("datahub.import.start", { job_id: an2.job.id, mapping: map2 });
    const run2 = await measure(() => processJobs(env()));
    const job2 = await a("datahub.job.get", { job_id: an2.job.id });
    console.warn(`[perf-io] import back the CSV ${ROWS} rows: ${run2.ms} ms (${Math.round(ROWS / (run2.ms / 1000))} rows/s), rss ${run2.startMb} -> peak ${run2.peakMb} MB, status ${job2.status}, skipped ${job2.report.sheets[0].skipped}`);
    expect(job2.status).toBe("done");
    expect(job2.report.sheets[0]).toMatchObject({ created: ROWS, skipped: 0 });
    const t2 = await a("datahub.table.get", { table_id: job2.report.sheets[0].table_id });
    const k2 = t2.columns.find((c: { name: string }) => c.name === "Doanh thu").key as string;
    const s2 = (await t.c.db.db.execute(sql.raw(`SELECT sum((data->>'${k2}')::numeric) AS s FROM dh_rows WHERE /*scope:system*/ table_id = '${job2.report.sheets[0].table_id}' AND deleted_at IS NULL`))).rows[0] as { s: string };
    expect(Number(s2.s)).toBe(expected);
  }, 900_000);
});
