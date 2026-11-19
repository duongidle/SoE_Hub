import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LocalStorageDriver } from "../src/storage";
import { as, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Golden test of the Excel import on Base's sample workbook, read straight from `examples/` (real data: never copied or committed; the test skips
 * itself when the file is absent). It imports every sheet with "lấy công thức" and checks the report: what translated, what did not and why.
 */
const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples/Quản lý Deal SoE (Dương TVD).xlsx");
const present = fs.existsSync(FILE);

let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
beforeAll(async () => {
  if (!present) return;
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id, { datahubs: 10, tables: 30, columns: 200 });
  a = as(t, org.userA1.id);
});
afterAll(async () => {
  await t?.close();
});

describe.skipIf(!present)("golden: the sample workbook through the importer", () => {
  it("analyses every sheet and explains every formula column", async () => {
    const bytes = fs.readFileSync(FILE);
    const init = await a("file.upload.init", { filename: "mau.xlsx", content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size_bytes: bytes.length });
    await (t.c.storage as LocalStorageDriver).write(`files/${init.file.id}`, bytes);
    await a("file.upload.complete", { id: init.file.id });
    const an = await a("datahub.import.analyze", { file_id: init.file.id });
    const names = an.sheets.map((s: { name: string }) => s.name);
    expect(names).toContain("Index");
    const mapping = { datahub: { name: "Mẫu" }, import_formulas: true, sheets: an.sheets.filter((s: { columns: unknown[] }) => s.columns.length > 0).map((s: { name: string }) => ({ sheet: s.name, table: { mode: "new", name: s.name } })) };
    const pv = await a("datahub.import.preview", { job_id: an.job.id, mapping });
    const summary: Record<string, { formula: number; value: number; reasons: Record<string, number>; warnings: number }> = {};
    for (const sh of pv.sheets) {
      const s = (summary[sh.sheet as string] = { formula: 0, value: 0, reasons: {} as Record<string, number>, warnings: 0 });
      for (const c of sh.columns) {
        if (!c.formula) continue;
        if (c.formula.status === "formula") s.formula++;
        else {
          s.value++;
          s.reasons[c.formula.code as string] = (s.reasons[c.formula.code as string] ?? 0) + 1;
        }
        s.warnings += c.formula.warnings.length;
        if (process.env.GOLDEN_DEBUG && c.formula.status === "value") console.warn(`[import-golden] ${sh.sheet} / ${c.name}: ${c.formula.code} ${c.formula.reason}`);
      }
    }
    console.warn(`[import-golden] blocking=${JSON.stringify(pv.blocking)} ${JSON.stringify(summary)}`);
    expect(pv.sheets.length).toBeGreaterThan(5);
    const idx = pv.sheets.find((s: { sheet: string }) => s.sheet === "Index");
    // Index: every COUNTIFS column reads Deals[...] and the Deals sheet is imported with it.
    // The "LEFT(ngày, 2)" formulas of the file (324 of them) are flagged: Excel reads the text shown (MM/yyyy), the engine reads the date.
    expect(summary.Index!.warnings).toBeGreaterThan(0);
    expect(JSON.stringify(idx.columns)).toContain("LEFT()");
    expect(idx.columns.filter((c: { formula: { status: string } | null }) => c.formula?.status === "formula").length).toBeGreaterThan(10);
  }, 120_000);
});
