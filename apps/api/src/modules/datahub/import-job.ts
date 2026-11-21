import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, type Actor } from "@soe/shared";
import { dhJobs, files, newId, type Executor } from "@soe/db";
import { ownedBy } from "../../auth/access";
import type { Config } from "../../config";
import { defineCommand } from "../../core/registry";
import type { StorageDriver } from "../../storage/types";
import { loadDatahubAccess, loadTableAccess } from "./access";
import { newOptionId } from "./column-types";
import { FormulaTranslator, rewriteDateText, type ReasonCode, type SheetMap } from "./excel-formula";
import { colIndex } from "./import-read";
import { analyzeSheet, buildRow, ImportMappingSchema, MAX_ERRORS_KEPT, resolveSheet, VALIDATE_SAMPLE, type CellIssue, type ExistingColumn, type ImportMapping, type ResolvedCol, type ResolvedSheet, type SheetAnalysis } from "./import-plan";
import { fetchGoogleSheet, openBook, type SourceBook } from "./import-read";
import { bulkCreateOff } from "./errors";
import { assertJobRoom, callAs, cancelRequested, jobActor, JobCancelled, jobOut, JobOut, loadJob, patchJob, registerJobRunner, type JobEnv, type JobRow } from "./jobs";
import { getLimits } from "./limits";
import { Id } from "./shared";
import { TableSchema } from "./table-schema";

type Ctx = { db: Executor; actor: Actor };

// ------------------------------------------------------------------------------------------------
// source
// ------------------------------------------------------------------------------------------------

async function readAll(storage: StorageDriver, key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of storage.read(key) as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

async function openJobBook(storage: StorageDriver, job: Pick<JobRow, "sourceKey" | "sourceName">): Promise<SourceBook & { prepare?(i: number): Promise<void> }> {
  if (!job.sourceKey) throw new AppError("not_found", "File nguồn đã hết hạn (giữ 24 giờ). Hãy tải lên lại.");
  return openBook(await readAll(storage, job.sourceKey), job.sourceName ?? "import.csv");
}

async function rowsOf(book: SourceBook & { prepare?(i: number): Promise<void> }, i: number) {
  await book.prepare?.(i);
  return book.rows(i);
}

// ------------------------------------------------------------------------------------------------
// scan: what a sheet holds that the mapping needs to know (select options, formulas, last data row)
// ------------------------------------------------------------------------------------------------

interface SheetScan {
  rows: number;
  firstData: number;
  lastData: number;
  options: Map<number, string[]>;
  formulas: Map<number, { row: number; formula: string }[]>;
  mixed: Set<number>;
}

async function scanSheet(book: SourceBook & { prepare?(i: number): Promise<void> }, rs: ResolvedSheet): Promise<SheetScan> {
  const header = rs.mapping.header_row;
  const scan: SheetScan = { rows: 0, firstData: header + 1, lastData: header, options: new Map(), formulas: new Map(), mixed: new Set() };
  const seen = new Map<number, Set<string>>();
  const selectCols = rs.columns.filter((c) => !c.existing && (c.type === "single_select" || c.type === "multi_select"));
  const formulaCols = rs.columns.filter((c) => !c.existing && c.wantsFormula && c.formulaCount > 0);
  for (const row of await rowsOf(book, rs.sheetIndex)) {
    if (row.n <= header || !row.cells.some((c) => c)) continue;
    scan.rows++;
    scan.lastData = row.n;
    for (const col of selectCols) {
      const c = row.cells[col.index];
      if (!c || c.v === null || c.v === "") continue;
      const raw = typeof c.v === "string" ? c.v : String(c.v);
      const parts = col.type === "multi_select" ? raw.split(/[,;|]/) : [raw];
      for (const p of parts) {
        const name = p.normalize("NFC").trim().slice(0, 100);
        if (!name) continue;
        let set = seen.get(col.index);
        if (!set) seen.set(col.index, (set = new Set()));
        const k = name.toLowerCase();
        if (set.has(k) || set.size >= 200) continue;
        set.add(k);
        const list = scan.options.get(col.index) ?? [];
        list.push(name);
        scan.options.set(col.index, list);
      }
    }
    for (const col of formulaCols) {
      const c = row.cells[col.index];
      if (!c) continue;
      if (c.formula) {
        const l = scan.formulas.get(col.index) ?? [];
        l.push({ row: row.n, formula: c.formula });
        scan.formulas.set(col.index, l);
      } else if (c.v !== null || c.error) scan.mixed.add(col.index);
    }
  }
  return scan;
}

// ------------------------------------------------------------------------------------------------
// formulas
// ------------------------------------------------------------------------------------------------

export interface FormulaDecision {
  status: "formula" | "value";
  /** Engine formula (no `=`) when status is `formula`. */
  text?: string;
  /** Why the column stays a value column (only when a formula was wanted). */
  code?: ReasonCode;
  reason?: string;
  warnings: string[];
}

function decideFormulas(sheets: { rs: ResolvedSheet; scan: SheetScan }[], tableNames: string[], book: SourceBook): Map<string, FormulaDecision> {
  const maps: SheetMap[] = sheets.map(({ rs, scan }, i) => ({
    sheet: rs.mapping.sheet,
    table: tableNames[i]!,
    headerRow: rs.mapping.header_row,
    firstData: scan.firstData,
    lastData: scan.lastData,
    cols: new Map(rs.columns.map((c) => [c.index, c.name])),
    tables: book.sheets[rs.sheetIndex]!.tables,
  }));
  const tr = new FormulaTranslator(maps);
  const out = new Map<string, FormulaDecision>();
  sheets.forEach(({ rs, scan }, si) => {
    const dateByIndex = new Map(rs.columns.filter((c) => c.type === "date" || c.type === "datetime").map((c) => [c.index, c.name]));
    // Text functions on a date column: Excel works on the text the cell SHOWS ("09/2021"), the engine on the date value (see module2 quyết định 2B).
    const dateFmts = new Map(rs.columns.filter((c) => (c.type === "date" || c.type === "datetime") && c.dateFmt).map((c) => [c.name.replace(/\s+/g, " ").trim().toLowerCase(), c.dateFmt]));
    const warn = (list: { formula: string }[]): string[] => {
      const found = new Map<string, string>();
      const re = /\b(LEFT|RIGHT|MID|LEN|FIND|SEARCH|SUBSTITUTE|REPLACE)\(\s*\$?([A-Z]{1,3})\$?\d+/g;
      for (const f of list.slice(0, 50)) {
        for (let m = re.exec(f.formula); m; m = re.exec(f.formula)) {
          const name = dateByIndex.get(colIndex(m[2]!));
          if (name) found.set(`${m[1]}:${name}`, `${list.length} công thức dùng ${m[1]}() trên cột ngày "${name}": Excel lấy chữ đang hiển thị (ví dụ 09/2021), hệ thống lấy số ngày nên kết quả khác khi tính lại. Nên viết lại bằng TEXT(ngày, "mm") hoặc MONTH(ngày).`);
        }
      }
      return [...found.values()];
    };
    for (const col of rs.columns) {
      if (col.existing || !col.wantsFormula || col.formulaCount === 0) continue;
      const key = `${si}:${col.index}`;
      const list = scan.formulas.get(col.index) ?? [];
      const warnings = warn(list);
      const valueOf = (code: ReasonCode, reason: string): FormulaDecision => ({ status: "value", code, reason, warnings });
      if (scan.mixed.has(col.index) || list.length < col.nonEmpty) {
        out.set(key, valueOf("mixed", "Cột có cả ô công thức và ô giá trị nhập tay."));
        continue;
      }
      let first: string | null = null;
      const rewrites = new Set<string>();
      let firstRaw = "";
      let verdict: FormulaDecision | null = null;
      for (const f of list) {
        const t = tr.translate(maps[si]!, f.row, f.formula);
        if (!t.ok) {
          verdict = valueOf(t.code, t.reason);
          break;
        }
        const rw = rewriteDateText(t.text, dateFmts);
        rw.rewritten.forEach((x) => rewrites.add(x));
        if (first === null) {
          first = rw.text;
          firstRaw = `dòng ${f.row}: =${f.formula}`;
        } else if (rw.text !== first) {
          verdict = valueOf("differs", `Công thức khác nhau giữa các dòng (${firstRaw.slice(0, 80)}; dòng ${f.row}: =${f.formula.slice(0, 80)}).`);
          break;
        }
      }
      out.set(key, verdict ?? { status: "formula", text: first ?? "", warnings: [...warnings, ...[...rewrites].slice(0, 3).map((x) => `Đã tự đổi sang TEXT cho khớp chữ Excel hiển thị: ${x}.`)] });
    }
  });
  return out;
}

// ------------------------------------------------------------------------------------------------
// preparing a mapping (shared by preview, start and the runner)
// ------------------------------------------------------------------------------------------------

async function existingColumnsOf(ctx: Ctx, tableId: string, need: "view" | "edit_data" | "owner"): Promise<{ cols: ExistingColumn[]; level: string; name: string; datahubId: string; bulkCreate: boolean }> {
  const acc = await loadTableAccess(ctx, tableId, need);
  const schema = await TableSchema.load(ctx.db, acc);
  return {
    cols: schema.alive.map((c) => ({ key: c.key, name: c.name, type: c.type, config: c.config, writable: !["auto_number", "formula", "lookup", "rollup", "relation", "row_id", "created_time", "created_by", "modified_time", "modified_by", "field_modified", "user", "attachment"].includes(c.type) })),
    level: acc.level,
    name: acc.table.name,
    datahubId: acc.datahub.id,
    bulkCreate: acc.bulkCreateAllowed(),
  };
}

interface Prepared {
  book: SourceBook & { prepare?(i: number): Promise<void> };
  sheets: { rs: ResolvedSheet; scan: SheetScan; existingTable?: { id: string; level: string; name: string } }[];
  tableNames: string[];
  decisions: Map<string, FormulaDecision>;
  blocking: string[];
  /** The import would write into a table whose owner does not let members add rows in bulk (a member is importing). */
  bulkOff: boolean;
  datahub: { id: string | null; level: string | null; name: string; tableCount: number; maxColumns: number };
  limits: Awaited<ReturnType<typeof getLimits>>;
}

async function prepare(ctx: Ctx, storage: StorageDriver, job: Pick<JobRow, "sourceKey" | "sourceName">, mapping: ImportMapping): Promise<Prepared> {
  const book = await openJobBook(storage, job);
  const blocking: string[] = [];
  let bulkOff = false;
  const limits = await getLimits(ctx.db, ctx.actor.userId);

  let datahub: Prepared["datahub"];
  if ("id" in mapping.datahub) {
    const dh = await loadDatahubAccess(ctx, mapping.datahub.id, "edit_data");
    const n = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_tables WHERE /*scope*/ datahub_id = ${dh.id}::uuid AND deleted_at IS NULL`)).rows[0] as { n: number };
    datahub = { id: dh.id, level: dh.level, name: dh.name, tableCount: n.n, maxColumns: limits.columns };
  } else {
    const n = (await ctx.db.execute(sql`SELECT count(*)::int AS n FROM dh_datahubs WHERE /*scope*/ owner_id = ${ctx.actor.userId}::uuid AND deleted_at IS NULL`)).rows[0] as { n: number };
    if (n.n >= limits.datahubs) blocking.push(`Đã đạt giới hạn ${limits.datahubs} datahub; không tạo thêm datahub mới được.`);
    const taken = (await ctx.db.execute(sql`SELECT 1 FROM dh_datahubs WHERE /*scope*/ owner_id = ${ctx.actor.userId}::uuid AND deleted_at IS NULL AND lower(btrim(name)) = lower(btrim(${mapping.datahub.name}))`)).rows.length > 0;
    if (taken) blocking.push(`Bạn đã có datahub tên "${mapping.datahub.name}". Chọn tên khác hoặc nhập vào datahub đó.`);
    datahub = { id: null, level: "owner", name: mapping.datahub.name, tableCount: 0, maxColumns: limits.columns };
  }

  const sheets: Prepared["sheets"] = [];
  const names = new Set<string>();
  let newTables = 0;
  for (const m of mapping.sheets) {
    const idx = book.sheets.findIndex((s) => s.name === m.sheet);
    if (idx < 0) throw new AppError("validation_error", `Không có sheet "${m.sheet}" trong file.`);
    await book.prepare?.(idx);
    const analysis = analyzeSheet(book, idx, m.header_row);
    let existing: ExistingColumn[] = [];
    let existingTable: { id: string; level: string; name: string } | undefined;
    if (m.table.mode === "existing") {
      const ex = await existingColumnsOf(ctx, m.table.table_id, "edit_data");
      if (datahub.id && ex.datahubId !== datahub.id) throw new AppError("validation_error", `Bảng của sheet "${m.sheet}" không thuộc datahub đã chọn.`);
      existing = ex.cols;
      existingTable = { id: m.table.table_id, level: ex.level, name: ex.name };
      // The owner may switch off "Thành viên được thêm dòng hàng loạt" (module2 section 10): importing is exactly that.
      if (!ex.bulkCreate) {
        bulkOff = true;
        blocking.push(`Sheet "${m.sheet}": chủ bảng không cho thành viên nhập dữ liệu hàng loạt vào bảng này.`);
      }
    } else {
      newTables++;
      const k = m.table.name.trim().toLowerCase();
      if (names.has(k)) blocking.push(`Tên bảng "${m.table.name}" bị dùng cho hai sheet.`);
      names.add(k);
      if (datahub.level !== "owner") blocking.push("Chỉ chủ datahub mới tạo được bảng mới.");
    }
    const rs = resolveSheet(book, m, analysis, existing, mapping.import_formulas);
    const newCols = rs.columns.filter((c) => !c.existing).length;
    if (newCols > 0 && existingTable && existingTable.level !== "owner") blocking.push(`Sheet "${m.sheet}": chỉ chủ datahub mới tạo được cột mới; hãy ghép mọi cột vào cột có sẵn.`);
    if (m.write === "replace" && existingTable && existingTable.level === "view") blocking.push(`Sheet "${m.sheet}": bạn chỉ có quyền xem bảng này.`);
    if (existing.length + newCols > limits.columns) {
      blocking.push(`Sheet "${m.sheet}": bảng sẽ có ${existing.length + newCols} cột, vượt giới hạn ${limits.columns} cột mỗi bảng. Bỏ bớt cột ở bước ghép cột.`);
    }
    const scan = await scanSheet(book, rs);
    for (const col of rs.columns) {
      if (col.existing || (col.type !== "single_select" && col.type !== "multi_select")) continue;
      const opts = scan.options.get(col.index) ?? [];
      col.config = { ...col.config, options: opts.map((name) => ({ id: newOptionId(), name })) };
    }
    sheets.push({ rs, scan, existingTable });
  }
  if (datahub.tableCount + newTables > limits.tables) blocking.push(`Datahub sẽ có ${datahub.tableCount + newTables} bảng, vượt giới hạn ${limits.tables} bảng mỗi datahub.`);
  const tableNames = mapping.sheets.map((m, i) => (m.table.mode === "new" ? m.table.name : (sheets[i]!.existingTable?.name ?? m.sheet)));
  const decisions = mapping.import_formulas || mapping.sheets.some((m) => m.columns?.some((c) => c.formula === "formula")) ? decideFormulas(sheets, tableNames, book) : new Map();
  return { book, sheets, tableNames, decisions, blocking, bulkOff, datahub, limits };
}

// ------------------------------------------------------------------------------------------------
// report shapes
// ------------------------------------------------------------------------------------------------

const ColReport = z.object({
  name: z.string(),
  type: z.string(),
  source: z.enum(["new", "existing", "formula"]),
  formula: z
    .object({ status: z.enum(["formula", "value"]), reason: z.string().nullable(), code: z.string().nullable(), warnings: z.array(z.string()) })
    .nullable()
    .describe("Có khi cột có công thức trong file và đã chọn lấy công thức."),
});
const IssueOut = z.object({ row: z.number().int(), column: z.string().nullable(), message: z.string() });

const PreviewSheet = z.object({
  sheet: z.string(),
  table: z.string(),
  new_table: z.boolean(),
  rows_total: z.number().int(),
  rows_checked: z.number().int(),
  sampled: z.boolean().describe("true = chỉ kiểm tra 5.000 dòng đầu; lỗi ở các dòng sau chỉ biết khi chạy."),
  valid: z.number().int(),
  invalid: z.number().int(),
  errors: z.array(IssueOut),
  columns: z.array(ColReport),
});
const PreviewOut = z.object({ ok: z.boolean(), blocking: z.array(z.string()), sheets: z.array(PreviewSheet) });

function colReports(rs: ResolvedSheet, si: number, decisions: Map<string, FormulaDecision>): z.infer<typeof ColReport>[] {
  return rs.columns.map((c) => {
    const d = decisions.get(`${si}:${c.index}`);
    return {
      name: c.name,
      type: d?.status === "formula" ? "formula" : c.type,
      source: c.existing ? ("existing" as const) : d?.status === "formula" ? ("formula" as const) : ("new" as const),
      formula: d ? { status: d.status, reason: d.reason ?? null, code: d.code ?? null, warnings: d.warnings } : null,
    };
  });
}

/** Value columns of a sheet: those whose values are read from the file (a column that became a formula column is not). */
function valueCols(rs: ResolvedSheet, si: number, decisions: Map<string, FormulaDecision>, failed: Set<string> = new Set()): ResolvedCol[] {
  return rs.columns.filter((c) => !(decisions.get(`${si}:${c.index}`)?.status === "formula" && !failed.has(`${si}:${c.index}`)));
}

// ------------------------------------------------------------------------------------------------
// runner
// ------------------------------------------------------------------------------------------------

interface SheetReport {
  sheet: string;
  table_id: string | null;
  table_name: string;
  new_table: boolean;
  rows_total: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  deleted: number;
  error_count: number;
  errors: { row: number; column: string | null; message: string }[];
  columns: z.infer<typeof ColReport>[];
}

const BATCH = 500;

async function runImport(env: JobEnv, job: JobRow): Promise<void> {
  const params = job.params as { mapping: ImportMapping };
  const mapping = ImportMappingSchema.parse(params.mapping);
  const owner = job.ownerId;
  const ctx: Ctx = { db: env.db, actor: jobActor(owner) };
  await patchJob(env.db, job.id, { phase: "reading" });
  const prep = await prepare(ctx, env.storage, job, mapping);
  if (prep.bulkOff) bulkCreateOff();
  if (prep.blocking.length) throw new AppError("validation_error", prep.blocking[0]!);
  const total = prep.sheets.reduce((n, s) => n + s.scan.rows, 0);
  await patchJob(env.db, job.id, { phase: "creating", progressTotal: total, progressDone: 0 });

  // 1. datahub and tables, then the value columns of every sheet.
  let datahubId = prep.datahub.id;
  if (!datahubId) {
    const dh = await callAs<{ id: string }>(env, owner, "datahub.datahub.create", { name: prep.datahub.name });
    datahubId = dh.id;
  }
  const reports: SheetReport[] = [];
  const tableIds: string[] = [];
  const keyOf = new Map<string, string>(); // `${sheetIdx}:${colIndex}` -> column key (for cells written by key)
  const failed = new Set<string>();
  for (let si = 0; si < prep.sheets.length; si++) {
    const { rs, existingTable } = prep.sheets[si]!;
    let tableId: string;
    if (existingTable) tableId = existingTable.id;
    else tableId = (await callAs<{ id: string }>(env, owner, "datahub.table.create", { datahub_id: datahubId, name: prep.tableNames[si] })).id;
    tableIds.push(tableId);
    for (const col of rs.columns) {
      if (col.existing) {
        keyOf.set(`${si}:${col.index}`, col.existing.key);
        continue;
      }
      const d = prep.decisions.get(`${si}:${col.index}`);
      if (d?.status === "formula") continue; // created below, after every table exists
      const created = await callAs<{ key: string }>(env, owner, "datahub.column.create", { table_id: tableId, name: col.name, type: col.type, config: col.config });
      keyOf.set(`${si}:${col.index}`, created.key);
    }
    reports.push({ sheet: rs.mapping.sheet, table_id: tableId, table_name: prep.tableNames[si]!, new_table: !existingTable, rows_total: prep.sheets[si]!.scan.rows, created: 0, updated: 0, unchanged: 0, skipped: 0, deleted: 0, error_count: 0, errors: [], columns: colReports(rs, si, prep.decisions) });
  }

  // 2. formula columns. A column whose formula the engine refuses falls back to a value column (nothing is lost).
  let todo: { si: number; col: ResolvedCol; text: string }[] = [];
  prep.sheets.forEach(({ rs }, si) => {
    for (const col of rs.columns) {
      const d = prep.decisions.get(`${si}:${col.index}`);
      if (d?.status === "formula") todo.push({ si, col, text: d.text! });
    }
  });
  const reasons = new Map<string, string>();
  while (todo.length) {
    const left: typeof todo = [];
    for (const t of todo) {
      try {
        const created = await callAs<{ key: string }>(env, owner, "datahub.column.create", { table_id: tableIds[t.si], name: t.col.name, type: "formula", config: { formula: `=${t.text}` } });
        keyOf.set(`${t.si}:${t.col.index}`, created.key);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        left.push(t);
        reasons.set(`${t.si}:${t.col.index}`, e.message);
      }
    }
    if (left.length === todo.length) {
      for (const t of left) {
        const k = `${t.si}:${t.col.index}`;
        failed.add(k);
        const created = await callAs<{ key: string }>(env, owner, "datahub.column.create", { table_id: tableIds[t.si], name: t.col.name, type: t.col.type, config: t.col.config });
        keyOf.set(k, created.key);
        const rep = reports[t.si]!.columns.find((c) => c.name === t.col.name);
        if (rep) {
          rep.source = "new";
          rep.type = t.col.type;
          rep.formula = { status: "value", code: "syntax", reason: `Hệ thống không tạo được cột công thức: ${reasons.get(k) ?? "lỗi không rõ"}`, warnings: [] };
        }
      }
      break;
    }
    todo = left;
  }

  // 3. rows.
  await patchJob(env.db, job.id, { phase: "importing" });
  let done = 0;
  for (let si = 0; si < prep.sheets.length; si++) {
    const { rs } = prep.sheets[si]!;
    const rep = reports[si]!;
    const tableId = tableIds[si]!;
    const cols = valueCols(rs, si, prep.decisions, failed);
    // Rows are sent by column key, so a name that looks like another column's key can never be mistaken.
    const keyed = cols.map((c) => ({ ...c, name: c.name, existing: { key: keyOf.get(`${si}:${c.index}`)!, name: c.name, type: c.type, config: c.config, writable: true } }));
    const keyRef = rs.mapping.write === "upsert" ? keyOf.get(`${si}:${rs.columns.find((c) => c.name.toLowerCase() === rs.mapping.key!.trim().toLowerCase() || c.existing?.key === rs.mapping.key)!.index}`)! : null;

    if (rs.mapping.write === "replace" && !rep.new_table) {
      for (;;) {
        if (await cancelRequested(env.db, job.id)) throw new JobCancelled();
        const page = await callAs<{ items: { id: string }[] }>(env, owner, "datahub.row.list", { table_id: tableId, limit: 500 });
        const items = page.items;
        if (items.length === 0) break;
        await callAs(env, owner, "datahub.row.batch", { table_id: tableId, ops: items.map((r) => ({ op: "delete", id: r.id })) });
        rep.deleted += items.length;
      }
    }

    let ops: { op: string; key?: string; data: Record<string, unknown> }[] = [];
    let srcRows: number[] = [];
    const note = (row: number, column: string | null, message: string) => {
      rep.error_count++;
      if (rep.errors.length < MAX_ERRORS_KEPT) rep.errors.push({ row, column, message });
    };
    const flush = async () => {
      if (ops.length === 0) return;
      const batchOps = ops;
      const batchRows = srcRows;
      ops = [];
      srcRows = [];
      const apply = (r: { outcome: string }) => {
        if (r.outcome === "created") rep.created++;
        else if (r.outcome === "updated") rep.updated++;
        else rep.unchanged++;
      };
      try {
        const res = await callAs<{ results: { outcome: string }[] }>(env, owner, "datahub.row.batch", { table_id: tableId, ops: batchOps });
        res.results.forEach(apply);
      } catch (e) {
        if (!(e instanceof AppError) || !["validation_error", "conflict", "quota_exceeded"].includes(e.code)) throw e;
        // One bad row must not stop the others: write them one by one and report the ones the server refuses.
        for (let k = 0; k < batchOps.length; k++) {
          try {
            const r = await callAs<{ results: { outcome: string }[] }>(env, owner, "datahub.row.batch", { table_id: tableId, ops: [batchOps[k]] });
            apply(r.results[0]!);
          } catch (e2) {
            if (!(e2 instanceof AppError) || !["validation_error", "conflict", "quota_exceeded"].includes(e2.code)) throw e2;
            rep.skipped++;
            note(batchRows[k]!, null, e2.message);
          }
        }
      }
    };
    for (const row of await rowsOf(prep.book, rs.sheetIndex)) {
      if (row.n <= rs.mapping.header_row || !row.cells.some((c) => c)) continue;
      const b = buildRow(row, keyed, rs.mapping.on_error);
      done++;
      for (const issue of b.issues) note(issue.row, issue.column, issue.message);
      if (b.issues.length && rs.mapping.on_error === "skip_row") {
        rep.skipped++;
      } else if (b.empty) {
        rep.skipped++;
      } else {
        ops.push(keyRef ? { op: "upsert", key: keyRef, data: b.data } : { op: "create", data: b.data });
        srcRows.push(row.n);
      }
      if (ops.length >= BATCH) {
        if (await cancelRequested(env.db, job.id)) throw new JobCancelled();
        await flush();
        await patchJob(env.db, job.id, { progressDone: done, report: { sheets: reports } });
      }
    }
    if (await cancelRequested(env.db, job.id)) throw new JobCancelled();
    await flush();
    await patchJob(env.db, job.id, { progressDone: done, report: { sheets: reports } });
  }
  await patchJob(env.db, job.id, { progressDone: total, progressTotal: total, report: { sheets: reports }, datahubId, tableId: tableIds[0] ?? null });
}

registerJobRunner("import", runImport);

// ------------------------------------------------------------------------------------------------
// commands
// ------------------------------------------------------------------------------------------------

const SheetAnalysisOut = z.object({
  name: z.string(),
  hidden: z.boolean(),
  header_row: z.number().int(),
  row_count: z.number().int().describe("Số dòng dữ liệu (dưới dòng tiêu đề, bỏ dòng trống)."),
  col_count: z.number().int(),
  has_formulas: z.boolean(),
  columns: z.array(z.object({ index: z.number().int(), letter: z.string(), header: z.string(), name: z.string(), type: z.string(), config: z.record(z.string(), z.unknown()), non_empty: z.number().int(), formula_count: z.number().int(), sample: z.array(z.string()) })),
  preview: z.array(z.object({ row: z.number().int(), cells: z.array(z.string()) })),
});

const MAX_TEXT = 5_000_000;

async function loadSourceJob(ctx: Ctx, id: string, status: "draft"): Promise<JobRow> {
  const job = await loadJob(ctx.db, id, ctx.actor.userId);
  if (job.kind !== "import") throw new AppError("not_found", "Không tìm thấy việc nhập.");
  if (job.status !== status) throw new AppError("conflict", job.status === "pending" || job.status === "running" ? "Việc nhập này đã bắt đầu." : "Việc nhập này đã xong. Hãy tải file lên lại để nhập lần nữa.");
  return job;
}

export function importOperations(cfg: Config, storage: StorageDriver) {
  return [
    defineCommand({
      name: "datahub.import.analyze",
      summary: "Bước 1–2 của import: nhận nguồn dữ liệu, trả danh sách sheet, số dòng, kiểu cột đoán được và 20 dòng xem trước.",
      description:
        "Nguồn là MỘT trong ba: `file_id` (file .xlsx hoặc .csv đã tải lên bằng `file.upload.init` + `file.upload.complete`), `url` (link Google Sheets đang để \"ai có link đều xem được\"; hệ thống tải về dạng xlsx, không dùng OAuth), hoặc `text` (dán từ Google Sheets/Excel hoặc CSV). " +
        "Trả một việc ở trạng thái `draft`. Gọi `datahub.import.sheet` để đổi dòng tiêu đề của một sheet, `datahub.import.preview` để xem báo cáo trước khi chạy, `datahub.import.start` để chạy nền.",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      input: z
        .object({
          file_id: Id.optional(),
          url: z.string().max(2000).optional(),
          text: z.string().min(1).max(MAX_TEXT).optional(),
          filename: z.string().max(200).optional().describe("Tên gợi ý cho nguồn `text` (đặt tên bảng mặc định)."),
        })
        .refine((v) => [v.file_id, v.url, v.text].filter((x) => x !== undefined).length === 1, "Gửi đúng một trong `file_id`, `url`, `text`."),
      output: z.object({ job: JobOut, sheets: z.array(SheetAnalysisOut) }),
      http: { method: "POST", path: "/datahub/imports", status: 201 },
      handler: async (ctx, i) => {
        await assertJobRoom(ctx.db, ctx.actor.userId);
        let sourceKey: string;
        let name: string;
        let bytes: Buffer;
        let own = true;
        if (i.file_id) {
          const [f] = await ctx.db.select().from(files).where(and(eq(files.id, i.file_id), ownedBy(files.ownerId, ctx.actor.userId), sql`${files.deletedAt} IS NULL`)).limit(1);
          if (!f || f.status !== "ready") throw new AppError("not_found", "Không tìm thấy file (chưa tải lên xong?).");
          if (f.sizeBytes > cfg.FILE_MAX_BYTES) throw new AppError("payload_too_large", "File quá lớn.");
          sourceKey = f.storageKey;
          name = f.filename;
          own = false;
          bytes = await readAll(storage, sourceKey);
        } else if (i.url) {
          const g = await fetchGoogleSheet(i.url, cfg.FILE_MAX_BYTES);
          bytes = g.bytes;
          name = g.filename;
          sourceKey = `files/dh-import/${newId()}`;
          await storage.put(sourceKey, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        } else {
          bytes = Buffer.from(i.text!, "utf8");
          name = i.filename?.trim() || "Dữ liệu dán.csv";
          sourceKey = `files/dh-import/${newId()}`;
          await storage.put(sourceKey, bytes, "text/csv");
        }
        let book;
        try {
          book = await openBook(bytes, name);
        } catch (e) {
          if (own) await storage.delete(sourceKey).catch(() => {});
          throw e;
        }
        const sheets: SheetAnalysis[] = [];
        for (let s = 0; s < book.sheets.length; s++) {
          await (book as { prepare?(i: number): Promise<void> }).prepare?.(s);
          sheets.push(analyzeSheet(book, s, 1));
        }
        const [job] = await ctx.db
          .insert(dhJobs)
          .values({ kind: "import", status: "draft", ownerId: ctx.actor.userId, params: { own_source: own }, sourceKey, sourceName: name, sourceKind: book.kind, report: { sheets: sheets.map((s) => ({ name: s.name, rows: s.row_count })) } })
          .returning();
        ctx.audit({ type: "datahub_import", id: job!.id, details: { source: i.file_id ? "file" : i.url ? "google_sheet" : "text", filename: name, sheets: sheets.length } });
        return { job: jobOut(job!), sheets };
      },
    }),

    defineCommand({
      name: "datahub.import.sheet",
      summary: "Đọc lại một sheet với dòng tiêu đề khác (khi dòng 1 không phải tiêu đề).",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      audit: "none",
      input: z.object({ job_id: Id, sheet: z.string().min(1).max(200), header_row: z.number().int().min(1).max(1000) }),
      output: SheetAnalysisOut,
      http: { method: "POST", path: "/datahub/imports/:job_id/sheet" },
      handler: async (ctx, i) => {
        const job = await loadSourceJob(ctx, i.job_id, "draft");
        const book = await openJobBook(storage, job);
        const idx = book.sheets.findIndex((s) => s.name === i.sheet);
        if (idx < 0) throw new AppError("validation_error", `Không có sheet "${i.sheet}" trong file.`);
        await book.prepare?.(idx);
        return analyzeSheet(book, idx, i.header_row);
      },
    }),

    defineCommand({
      name: "datahub.import.preview",
      summary: "Bước 5: báo cáo trước khi chạy: số dòng hợp lệ, dòng lỗi và lý do, cột công thức dịch được hay không, vượt giới hạn nào.",
      description:
        "Không ghi gì. Kiểm tra 5.000 dòng đầu của mỗi sheet bằng chính bộ kiểm tra kiểu cột của hệ thống (`sampled = true` nếu file dài hơn); lỗi ở các dòng sau chỉ biết khi chạy. `blocking` không rỗng = chưa chạy được (vượt giới hạn cột/bảng/datahub, trùng tên, thiếu quyền).",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      audit: "none",
      input: z.object({ job_id: Id, mapping: ImportMappingSchema }),
      output: PreviewOut,
      http: { method: "POST", path: "/datahub/imports/:job_id/preview" },
      handler: async (ctx, i) => {
        const job = await loadSourceJob(ctx, i.job_id, "draft");
        const prep = await prepare(ctx, storage, job, i.mapping);
        const sheets: z.infer<typeof PreviewSheet>[] = [];
        for (let si = 0; si < prep.sheets.length; si++) {
          const { rs, scan } = prep.sheets[si]!;
          const cols = valueCols(rs, si, prep.decisions);
          const errors: CellIssue[] = [];
          let checked = 0;
          let invalid = 0;
          let errorCount = 0;
          for (const row of await rowsOf(prep.book, rs.sheetIndex)) {
            if (row.n <= rs.mapping.header_row || !row.cells.some((c) => c)) continue;
            if (checked >= VALIDATE_SAMPLE) break;
            checked++;
            const b = buildRow(row, cols, rs.mapping.on_error);
            if (b.issues.length) {
              errorCount += b.issues.length;
              if (rs.mapping.on_error === "skip_row") invalid++;
              for (const is of b.issues) if (errors.length < 50) errors.push(is);
            }
          }
          void errorCount;
          sheets.push({
            sheet: rs.mapping.sheet,
            table: prep.tableNames[si]!,
            new_table: rs.mapping.table.mode === "new",
            rows_total: scan.rows,
            rows_checked: checked,
            sampled: scan.rows > checked,
            valid: checked - invalid,
            invalid,
            errors: errors.map((e) => ({ row: e.row, column: e.column, message: e.message })),
            columns: colReports(rs, si, prep.decisions),
          });
        }
        return { ok: prep.blocking.length === 0, blocking: prep.blocking, sheets };
      },
    }),

    defineCommand({
      name: "datahub.import.start",
      summary: "Bước 6: chạy import nền với cách ghép đã chọn. Theo dõi bằng `datahub.job.get` (tiến độ, báo cáo từng sheet, dòng lỗi).",
      description:
        "Tạo datahub/bảng/cột mới (theo giới hạn của bạn), nhập dòng theo lô 500, dòng sai kiểu bị bỏ và ghi vào báo cáo (hoặc để trống ô, theo `on_error`). " +
        "`import_formulas = true`: cột có công thức trong file được dịch thành cột công thức nếu mọi dòng cùng một công thức và mọi tham chiếu dịch được; không thì nhập giá trị và báo lý do từng cột. " +
        "Cần quyền: datahub mới cần quyền tạo datahub; bảng/cột mới cần là chủ datahub; nhập vào bảng có sẵn cần quyền Sửa dữ liệu.",
      permission: "datahub:datahub:use",
      aiAllowed: true,
      input: z.object({ job_id: Id, mapping: ImportMappingSchema }),
      output: JobOut,
      http: { method: "POST", path: "/datahub/imports/:job_id/start", status: 202 },
      handler: async (ctx, i) => {
        const job = await loadSourceJob(ctx, i.job_id, "draft");
        if (!("id" in i.mapping.datahub) && !(await ctx.access.can("datahub:datahub:create"))) throw new AppError("forbidden", "Bạn không có quyền tạo datahub.");
        const prep = await prepare(ctx, storage, job, i.mapping);
        if (prep.bulkOff) bulkCreateOff();
        if (prep.blocking.length) throw new AppError("validation_error", prep.blocking[0]!, { blocking: prep.blocking });
        const total = prep.sheets.reduce((n, s) => n + s.scan.rows, 0);
        const [upd] = await ctx.db
          .update(dhJobs)
          .set({ status: "pending", report: null, params: { ...(job.params as object), mapping: i.mapping }, progressTotal: total, progressDone: 0, datahubId: "id" in i.mapping.datahub ? i.mapping.datahub.id : null, updatedAt: new Date() })
          .where(and(eq(dhJobs.id, job.id), eq(dhJobs.status, "draft")))
          .returning();
        if (!upd) throw new AppError("conflict", "Việc nhập này đã bắt đầu.");
        ctx.audit({ type: "datahub_import", id: job.id, details: { sheets: i.mapping.sheets.map((s) => ({ sheet: s.sheet, write: s.write, new_table: s.table.mode === "new" })), import_formulas: i.mapping.import_formulas, rows: total } });
        return jobOut(upd);
      },
    }),
  ];
}

