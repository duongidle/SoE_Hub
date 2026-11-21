import { z } from "zod";
import { AppError, DhNameSchema } from "@soe/shared";
import { serialToIso, serialToIsoDateTime } from "@soe/formula";
import { columnTypeDef } from "./column-types";
import { colLetters, type SourceBook, type SrcCell, type SrcRow } from "./import-read";
import { CellError } from "./types";
import { isRefType, splitTokens, type RefCell } from "./import-refs";

/** Column types an import can create or fill (no people, files, links or computed columns). */
export const IMPORT_TYPES = ["text", "long_text", "number", "currency", "percent", "date", "datetime", "checkbox", "rating", "single_select", "multi_select", "email", "phone", "url"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];
export const isImportType = (t: string): t is ImportType => (IMPORT_TYPES as readonly string[]).includes(t);

export const PREVIEW_ROWS = 20;
export const VALIDATE_SAMPLE = 5000;
export const MAX_ERRORS_KEPT = 200;

// ------------------------------------------------------------------------------------------------
// mapping (what the person decided)
// ------------------------------------------------------------------------------------------------

const ColMapSchema = z.object({
  index: z.number().int().min(0).max(1000).describe("Cột trong file, từ 0 (A = 0)."),
  skip: z.boolean().optional().describe("true = không nhập cột này."),
  target: z.string().max(100).optional().describe("Nhập vào cột có sẵn của bảng (mã hoặc tên cột). Bỏ trống = tạo cột mới."),
  name: DhNameSchema.optional().describe("Tên cột mới (mặc định lấy từ dòng tiêu đề)."),
  type: z.enum(IMPORT_TYPES).optional().describe("Kiểu cột mới (mặc định: hệ thống đoán)."),
  config: z.record(z.string(), z.unknown()).optional().describe("Cấu hình cột mới (ví dụ `{max: 5}` cho đánh giá sao). Lựa chọn của cột Một/Nhiều lựa chọn tự lấy từ các giá trị trong file."),
  formula: z.enum(["value", "formula"]).optional().describe("Cột có công thức trong file: `formula` = lấy công thức (nếu dịch được), `value` = chỉ lấy giá trị. Mặc định theo `import_formulas`."),
  link_by: z.string().max(100).optional().describe("Chỉ cho cột Liên kết có sẵn: cột của bảng đích để khớp giá trị trong file (tên hoặc mã). Bỏ trống = cột Duy nhất duy nhất của bảng đích."),
});

export const SheetMappingSchema = z.object({
  sheet: z.string().min(1).max(200).describe("Tên sheet trong file (file CSV hoặc dán: tên đã trả ở bước phân tích)."),
  header_row: z.number().int().min(1).max(1000).default(1),
  table: z.discriminatedUnion("mode", [z.object({ mode: z.literal("new"), name: DhNameSchema }), z.object({ mode: z.literal("existing"), table_id: z.uuid() })]),
  columns: z.array(ColMapSchema).max(500).optional().describe("Bỏ trống = nhập mọi cột có tiêu đề hoặc có dữ liệu, kiểu do hệ thống đoán."),
  write: z.enum(["add", "upsert", "replace"]).default("add").describe("`add` thêm dòng mới; `upsert` cập nhật theo cột khoá (chưa có thì thêm); `replace` xoá hết dòng cũ (vào thùng rác 7 ngày) rồi nhập."),
  key: z.string().max(100).optional().describe("Cột khoá cho `upsert`: tên hoặc mã cột của bảng (cột đó phải được nhập)."),
  on_error: z.enum(["skip_row", "blank_cell"]).default("skip_row").describe("Ô sai kiểu: `skip_row` bỏ cả dòng và báo lỗi (mặc định); `blank_cell` để ô trống, vẫn nhập dòng."),
});
export type SheetMapping = z.infer<typeof SheetMappingSchema>;

export const ImportMappingSchema = z.object({
  datahub: z.union([z.object({ id: z.uuid() }), z.object({ name: DhNameSchema })]).describe("Datahub nhập vào: có sẵn (`id`) hoặc tạo mới (`name`)."),
  import_formulas: z.boolean().default(false).describe("true = các cột có công thức trong file được thử dịch thành cột công thức; cột nào không dịch được thì nhập giá trị và báo lý do."),
  sheets: z.array(SheetMappingSchema).min(1).max(30),
});
export type ImportMapping = z.infer<typeof ImportMappingSchema>;

// ------------------------------------------------------------------------------------------------
// analysis
// ------------------------------------------------------------------------------------------------

export interface ColumnGuess {
  index: number;
  letter: string;
  header: string;
  name: string;
  type: ImportType;
  config: Record<string, unknown>;
  non_empty: number;
  formula_count: number;
  sample: string[];
  /** Display format of the date cells, as the file shows them (for rewriting LEFT/RIGHT/MID on a date). */
  date_fmt?: string;
}

export interface SheetAnalysis {
  name: string;
  hidden: boolean;
  header_row: number;
  row_count: number;
  col_count: number;
  has_formulas: boolean;
  columns: ColumnGuess[];
  /** First rows of the sheet as shown (header row included), with their row numbers. */
  preview: { row: number; cells: string[] }[];
}

/** Text a cell shows in the preview. */
export function cellText(c: SrcCell | undefined): string {
  if (!c) return "";
  if (c.error) return c.error;
  if (c.v === null) return "";
  if (c.date && typeof c.v === "number") return Number.isInteger(c.v) ? serialToIso(c.v) : serialToIsoDateTime(c.v).replace("T", " ").slice(0, 16);
  if (typeof c.v === "boolean") return c.v ? "TRUE" : "FALSE";
  return String(c.v);
}

/** A column name from a header cell: no `[ ]`, at most 100 characters, never empty, never repeated in the same table. */
export function cleanName(raw: string, index: number, used: Set<string>): string {
  let n = raw.normalize("NFC").replace(/\[/g, "(").replace(/\]/g, ")").replace(/\s+/g, " ").trim().slice(0, 100).trim();
  if (!n) n = `Cột ${colLetters(index)}`;
  let cand = n;
  for (let k = 2; used.has(cand.toLowerCase()); k++) cand = `${n.slice(0, 95)} (${k})`;
  used.add(cand.toLowerCase());
  return cand;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DMY_DATE = /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/;
const ISO_DT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URLRE = /^https?:\/\/\S+$/i;

interface Stat {
  nonEmpty: number;
  nums: number;
  ints: number;
  bools: number;
  strs: number;
  dates: number;
  dateTimes: number;
  isoDates: number;
  dmyDates: number;
  isoDts: number;
  emails: number;
  urls: number;
  numStrs: number;
  intStrs: number;
  boolStrs: number;
  maxLen: number;
  percentFmt: number;
  moneyFmt: number;
  /** Display format of the first date cell (module2: LEFT(ngày) is rewritten with it). */
  dateFmt: string | null;
  formulas: number;
  distinct: Set<string>;
  sample: string[];
}

const newStat = (): Stat => ({ nonEmpty: 0, nums: 0, ints: 0, bools: 0, strs: 0, dates: 0, dateTimes: 0, isoDates: 0, dmyDates: 0, isoDts: 0, emails: 0, urls: 0, numStrs: 0, intStrs: 0, boolStrs: 0, maxLen: 0, percentFmt: 0, moneyFmt: 0, dateFmt: null, formulas: 0, distinct: new Set(), sample: [] });

function observe(s: Stat, c: SrcCell | undefined): void {
  if (!c) return;
  if (c.formula) s.formulas++;
  if (c.error) {
    s.nonEmpty++;
    return;
  }
  if (c.v === null || c.v === "") {
    if (c.formula) s.nonEmpty++;
    return;
  }
  s.nonEmpty++;
  if (s.sample.length < 3) s.sample.push(cellText(c).slice(0, 60));
  if (typeof c.v === "boolean") s.bools++;
  else if (typeof c.v === "number") {
    if (c.date) {
      if (c.fmt && s.dateFmt === null) s.dateFmt = c.fmt;
      if (Number.isInteger(c.v)) s.dates++;
      else s.dateTimes++;
    } else {
      s.nums++;
      if (Number.isInteger(c.v)) s.ints++;
      if (c.fmt && /%/.test(c.fmt)) s.percentFmt++;
      if (c.fmt && /₫|VND|đ/i.test(c.fmt)) s.moneyFmt++;
    }
    const t = String(c.v);
    if (s.distinct.size <= 60) s.distinct.add(t);
    s.maxLen = Math.max(s.maxLen, t.length);
  } else {
    s.strs++;
    const t = c.v.trim();
    s.maxLen = Math.max(s.maxLen, c.v.length);
    if (ISO_DATE.test(t)) s.isoDates++;
    else if (DMY_DATE.test(t)) s.dmyDates++;
    else if (ISO_DT.test(t)) s.isoDts++;
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) s.numStrs++;
    if (/^(true|false)$/i.test(t)) s.boolStrs++;
    if (EMAIL.test(t)) s.emails++;
    if (URLRE.test(t)) s.urls++;
    if (s.distinct.size <= 60) s.distinct.add(t.toLowerCase());
  }
}

function guessType(s: Stat, rows: number): { type: ImportType; config: Record<string, unknown> } {
  const n = s.nonEmpty;
  if (n === 0) return { type: "text", config: {} };
  if (s.bools === n) return { type: "checkbox", config: {} };
  if (s.nums === n) {
    if (s.percentFmt === n) return { type: "percent", config: {} };
    if (s.ints === n && s.moneyFmt === n) return { type: "currency", config: {} };
    return { type: "number", config: {} };
  }
  if (s.dates + s.dateTimes === n) return { type: s.dateTimes > 0 ? "datetime" : "date", config: {} };
  if (s.strs === n) {
    // Text files (CSV, pasted) carry numbers and flags as text.
    if (s.boolStrs === n) return { type: "checkbox", config: {} };
    if (s.numStrs === n && s.maxLen < 16) return { type: "number", config: {} };
    if (s.isoDates + s.dmyDates === n) return { type: "date", config: {} };
    if (s.isoDts + s.isoDates === n && s.isoDts > 0) return { type: "datetime", config: {} };
    if (s.emails === n) return { type: "email", config: {} };
    if (s.urls === n) return { type: "url", config: {} };
    if (s.maxLen > 1000) return { type: "long_text", config: {} };
    // Few repeating values in a big column: a choice list (people can change it in the mapping step).
    if (n >= 30 && s.distinct.size <= 12 && s.distinct.size * 3 <= n && s.maxLen <= 50) return { type: "single_select", config: {} };
  }
  void rows;
  return { type: s.maxLen > 1000 ? "long_text" : "text", config: {} };
}

/** Reads one sheet once: counts, a preview and a type guess per column, for the given header row. */
export function analyzeSheet(book: SourceBook, sheetIndex: number, headerRow: number): SheetAnalysis {
  const sheet = book.sheets[sheetIndex]!;
  const stats = new Map<number, Stat>();
  const headers = new Map<number, string>();
  const preview: SheetAnalysis["preview"] = [];
  let rowCount = 0;
  let maxCol = 0;
  let hasFormulas = false;
  for (const row of book.rows(sheetIndex)) {
    if (preview.length < PREVIEW_ROWS) preview.push({ row: row.n, cells: Array.from(row.cells, (c) => cellText(c)) });
    if (row.n < headerRow) continue;
    if (row.n === headerRow) {
      row.cells.forEach((c, i) => c && headers.set(i, cellText(c)));
      maxCol = Math.max(maxCol, row.cells.length);
      continue;
    }
    if (!row.cells.some((c) => c)) continue;
    rowCount++;
    maxCol = Math.max(maxCol, row.cells.length);
    row.cells.forEach((c, i) => {
      if (!c) return;
      let st = stats.get(i);
      if (!st) stats.set(i, (st = newStat()));
      observe(st, c);
      if (c.formula) hasFormulas = true;
    });
  }
  const used = new Set<string>();
  const columns: ColumnGuess[] = [];
  for (let i = 0; i < maxCol; i++) {
    const header = headers.get(i) ?? "";
    const st = stats.get(i);
    if (!header && (!st || st.nonEmpty === 0)) continue;
    const g = guessType(st ?? newStat(), rowCount);
    columns.push({ index: i, letter: colLetters(i), header, name: cleanName(header, i, used), type: g.type, config: g.config, non_empty: st?.nonEmpty ?? 0, formula_count: st?.formulas ?? 0, sample: st?.sample ?? [], ...(st?.dateFmt ? { date_fmt: st.dateFmt } : {}) });
  }
  return { name: sheet.name, hidden: sheet.hidden, header_row: headerRow, row_count: rowCount, col_count: maxCol, has_formulas: hasFormulas, columns, preview };
}

// ------------------------------------------------------------------------------------------------
// resolved mapping
// ------------------------------------------------------------------------------------------------

export interface ExistingColumn {
  key: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  writable: boolean;
}

export interface ResolvedCol {
  index: number;
  header: string;
  /** Final column name (new column) or the existing column's name. */
  name: string;
  /** A column of the file becomes a new column of an import type, or fills an existing column (which may also be a Người dùng or Liên kết column: ids are found from emails, names or key values). */
  type: ImportType | "user" | "relation";
  /** `link_by` of the mapping (relation columns). */
  linkBy?: string;
  config: Record<string, unknown>;
  /** Key of the existing column the values go to (null = a new column). */
  existing: ExistingColumn | null;
  /** The file's formula for this column, to try (formula mode only). */
  wantsFormula: boolean;
  formulaCount: number;
  nonEmpty: number;
  dateFmt?: string;
}

export interface ResolvedSheet {
  mapping: SheetMapping;
  sheetIndex: number;
  analysis: SheetAnalysis;
  columns: ResolvedCol[];
  /** Columns of the target table that already exist (existing mode). */
  existingColumns: ExistingColumn[];
}

/** Applies the person's mapping to the analysis. Errors say which sheet and column. */
export function resolveSheet(
  book: SourceBook,
  m: SheetMapping,
  analysis: SheetAnalysis,
  existingColumns: ExistingColumn[],
  importFormulas: boolean,
): ResolvedSheet {
  const sheetIndex = book.sheets.findIndex((s) => s.name === m.sheet);
  const used = new Set<string>(existingColumns.map((c) => c.name.toLowerCase()));
  const byIndex = new Map(analysis.columns.map((c) => [c.index, c]));
  const wanted = m.columns ?? analysis.columns.map((c) => ({ index: c.index }) as NonNullable<SheetMapping["columns"]>[number]);
  const seenIdx = new Set<number>();
  const out: ResolvedCol[] = [];
  const loc = (c: { index: number }) => `Sheet "${m.sheet}", cột ${colLetters(c.index)}`;
  for (const cm of wanted) {
    if (cm.skip) continue;
    if (seenIdx.has(cm.index)) throw new AppError("validation_error", `${loc(cm)} được ghép hai lần.`);
    seenIdx.add(cm.index);
    const g = byIndex.get(cm.index);
    const header = g?.header ?? "";
    const wantsFormula = (cm.formula ?? (importFormulas ? "formula" : "value")) === "formula";
    if (cm.target) {
      const ex = existingColumns.find((c) => c.key === cm.target || c.name.toLowerCase() === cm.target!.trim().toLowerCase());
      if (!ex) throw new AppError("validation_error", `${loc(cm)}: không có cột "${cm.target}" trong bảng.`);
      if (["formula", "lookup", "rollup"].includes(ex.type)) throw new AppError("validation_error", `${loc(cm)}: cột "${ex.name}" là cột ${ex.type === "formula" ? "công thức" : ex.type === "lookup" ? "Lookup" : "Rollup"}, không nhập được (giá trị do hệ thống tính).`);
      if (!ex.writable || !(isImportType(ex.type) || isRefType(ex.type))) throw new AppError("validation_error", `${loc(cm)}: cột "${ex.name}" (kiểu ${columnTypeDef(ex.type).label}) không nhập được từ file.`);
      if (out.some((o) => o.existing?.key === ex.key)) throw new AppError("validation_error", `Cột "${ex.name}" được ghép từ hai cột của file.`);
      out.push({ index: cm.index, header, name: ex.name, type: ex.type as ResolvedCol["type"], ...(cm.link_by ? { linkBy: cm.link_by } : {}), config: ex.config, existing: ex, wantsFormula: false, formulaCount: g?.formula_count ?? 0, nonEmpty: g?.non_empty ?? 0, dateFmt: g?.date_fmt });
      continue;
    }
    const name = cm.name ? cm.name.normalize("NFC").trim() : cleanName(header, cm.index, used);
    if (cm.name) {
      if (used.has(name.toLowerCase())) throw new AppError("validation_error", `${loc(cm)}: tên cột "${name}" bị trùng (không phân biệt hoa thường).`);
      used.add(name.toLowerCase());
    }
    out.push({ index: cm.index, header, name, type: cm.type ?? g?.type ?? "text", config: cm.config ?? g?.config ?? {}, existing: null, wantsFormula, formulaCount: g?.formula_count ?? 0, nonEmpty: g?.non_empty ?? 0, dateFmt: g?.date_fmt });
  }
  if (out.length === 0) throw new AppError("validation_error", `Sheet "${m.sheet}": chưa chọn cột nào để nhập.`);
  if (m.write === "upsert") {
    if (!m.key) throw new AppError("validation_error", `Sheet "${m.sheet}": nhập kiểu "cập nhật theo cột khoá" cần chọn \`key\`.`);
    if (!out.some((c) => c.name.toLowerCase() === m.key!.trim().toLowerCase() || c.existing?.key === m.key)) throw new AppError("validation_error", `Sheet "${m.sheet}": cột khoá "${m.key}" phải là một cột được nhập.`);
  }
  return { mapping: m, sheetIndex, analysis, columns: out, existingColumns };
}

// ------------------------------------------------------------------------------------------------
// cells -> values
// ------------------------------------------------------------------------------------------------

/** The input the column type's own parser takes, from one source cell. Never throws. */
export function toInput(c: SrcCell | undefined, type: ResolvedCol["type"]): unknown {
  if (!c || c.error || c.v === null || c.v === "") return null;
  const v = c.v;
  switch (type) {
    case "date":
      if (typeof v === "number") return c.date ? serialToIso(Math.floor(v)) : v;
      return v;
    case "datetime":
      if (typeof v === "number") return c.date ? serialToIsoDateTime(v) : v;
      return v;
    case "checkbox":
      if (typeof v === "number") return v === 1 ? true : v === 0 ? false : v;
      return v;
    case "multi_select":
      return String(v)
        .split(/[,;|]/)
        .map((x) => x.trim())
        .filter(Boolean);
    case "number":
    case "currency":
    case "percent":
    case "rating":
      return c.date && typeof v === "number" ? serialToIso(v) : v;
    default:
      if (typeof v === "number") return c.date ? (Number.isInteger(v) ? serialToIso(v) : serialToIsoDateTime(v)) : String(v);
      if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
      return v;
  }
}

export interface CellIssue {
  row: number;
  column: string;
  message: string;
}

/**
 * Converts and checks one row with the real column parsers. Cells of people and links are not converted here (they need the database): they come back in
 * `refs` as the texts the file holds, for `RefResolver.resolve`.
 */
export function buildRow(r: SrcRow, cols: ResolvedCol[], onError: "skip_row" | "blank_cell"): { data: Record<string, unknown>; issues: CellIssue[]; empty: boolean; refs: RefCell[] } {
  const data: Record<string, unknown> = {};
  const issues: CellIssue[] = [];
  const refs: RefCell[] = [];
  for (const col of cols) {
    const cell = r.cells[col.index];
    const input = toInput(cell, col.type);
    if (input === null) continue;
    if (col.type === "user" || col.type === "relation") {
      const tokens = splitTokens(String(input));
      if (tokens.length) refs.push({ col, tokens });
      continue;
    }
    try {
      const parsed = columnTypeDef(col.type).parse(input, { key: col.existing?.key ?? "c_import", name: col.name, config: col.config });
      if (parsed !== null) data[col.existing?.key ?? col.name] = parsed;
    } catch (e) {
      if (!(e instanceof CellError)) throw e;
      issues.push({ row: r.n, column: col.name, message: e.message.replace(/^Cột "[^"]*" /, "") });
      if (onError === "blank_cell") continue;
    }
  }
  return { data, issues, empty: Object.keys(data).length === 0 && issues.length === 0 && refs.length === 0, refs };
}
