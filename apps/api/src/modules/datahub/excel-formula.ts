import { parseFormula, validateCalls } from "@soe/formula";
import { colIndex, type SrcTable } from "./import-read";

/**
 * Excel formula to engine formula (design module2 section 8.2). A column becomes a formula column only when EVERY formula cell of the
 * column, once its references are turned into column references, reads the same: `=P2*20%` on row 2, `=P3*20%` on row 3 -> `=[Doanh thu]*20%`.
 * Anything else stays a value column and the report says why, per column.
 */

export interface SheetMap {
  /** Sheet name in the file. */
  sheet: string;
  /** Name of the table the sheet becomes. */
  table: string;
  /** Header row and the data rows of the sheet (1-based, inclusive). */
  headerRow: number;
  firstData: number;
  lastData: number;
  /** Imported source column (0-based) -> name of the column it becomes. */
  cols: Map<number, string>;
  /** Excel tables on the sheet. */
  tables: SrcTable[];
}

export type ReasonCode =
  | "differs"
  | "mixed"
  | "missing_table"
  | "missing_data"
  | "fixed_cell"
  | "row_offset"
  | "other_sheet_cell"
  | "range_2d"
  | "range_partial"
  | "unsupported_function"
  | "source_error"
  | "syntax"
  | "named_range";

export type Translated = { ok: true; text: string } | { ok: false; code: ReasonCode; reason: string };

const fail = (code: ReasonCode, reason: string): Translated => ({ ok: false, code, reason });

const A1_CELL = /(?:'((?:[^']|'')+)'!|([A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/y;
const A1_RANGE = /(?:'((?:[^']|'')+)'!|([A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)(\d+):(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/y;
const COL_RANGE = /(?:'((?:[^']|'')+)'!|([A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![A-Za-z0-9_(])/y;
const IDENT = /[A-Za-z_][A-Za-z0-9_.]*/y;

const norm = (s: string) => s.replace(/_x000[AD]_/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
const q = (name: string) => `[${name}]`;

export class FormulaTranslator {
  constructor(private readonly sheets: SheetMap[]) {}

  private find(name: string): SheetMap | undefined {
    return this.sheets.find((s) => norm(s.sheet) === norm(name));
  }

  /** `from` is the sheet the formula lives on and `row` its row. */
  translate(from: SheetMap, row: number, formulaText: string): Translated {
    const f = formulaText.replace(/_xlfn\.(_xlws\.)?/g, "").replace(/^=/, "");
    if (/#REF!/.test(f)) return fail("source_error", "Công thức lỗi trong file gốc (#REF!).");
    let out = "";
    let i = 0;
    while (i < f.length) {
      const ch = f[i]!;
      if (ch === '"') {
        let j = i + 1;
        while (j < f.length && !(f[j] === '"' && f[j + 1] !== '"')) j += f[j] === '"' ? 2 : 1;
        out += f.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      const prev = out[out.length - 1] ?? "";
      // A reference or a name starts at a boundary, never inside a number or another name.
      if (/[A-Za-z_$']/.test(ch) && !/[A-Za-z0-9_.$]/.test(prev)) {
        // (1) range A1:B2
        A1_RANGE.lastIndex = i;
        let m = A1_RANGE.exec(f);
        if (m) {
          const r = this.range(from, row, m[1] ?? m[2], colIndex(m[4]!), Number(m[6]), colIndex(m[8]!), Number(m[10]), `${m[3]}${m[4]}${m[5]}${m[6]}:${m[7]}${m[8]}${m[9]}${m[10]}`);
          if (typeof r !== "string") return r;
          out += r;
          i += m[0].length;
          continue;
        }
        COL_RANGE.lastIndex = i;
        m = COL_RANGE.exec(f);
        if (m) {
          const r = this.range(from, row, m[1] ?? m[2], colIndex(m[4]!), null, colIndex(m[6]!), null, `${m[3]}${m[4]}:${m[5]}${m[6]}`);
          if (typeof r !== "string") return r;
          out += r;
          i += m[0].length;
          continue;
        }
        A1_CELL.lastIndex = i;
        m = A1_CELL.exec(f);
        if (m) {
          const r = this.cell(from, row, m[1] ?? m[2], m[3] === "$", colIndex(m[4]!), m[5] === "$", Number(m[6]), m[0]);
          if (typeof r !== "string") return r;
          out += r;
          i += m[0].length;
          continue;
        }
        IDENT.lastIndex = i;
        const id = IDENT.exec(f);
        if (id) {
          const after = f[i + id[0].length];
          if (after === "[") {
            const t = this.tableRef(from, f, i, id[0]);
            if ("ok" in t) return t;
            out += t.text;
            i = t.end;
            continue;
          }
          if (after === "(") {
            out += id[0].toUpperCase();
            i += id[0].length;
            continue;
          }
          if (/^(TRUE|FALSE)$/i.test(id[0])) {
            out += id[0].toUpperCase();
            i += id[0].length;
            continue;
          }
          return fail("named_range", `Tên đã đặt "${id[0]}" (named range) hoặc tham chiếu không hiểu được.`);
        }
        if (ch === "'") return fail("syntax", "Tên sheet không đọc được.");
      }
      // `[@Col]` / `[Col]` without a table name: a column of the sheet's own table, this row.
      if (ch === "[" && !/[A-Za-z0-9_.\]]/.test(prev)) {
        const end = f.indexOf("]", i);
        if (end > 0) {
          const inner = f.slice(i + 1, end).replace(/^@/, "");
          const t = from.tables[0];
          const idx = t ? t.headers.findIndex((h) => norm(h) === norm(inner)) : -1;
          const name = t && idx >= 0 ? from.cols.get(t.col0 + idx) : undefined;
          if (!name) return fail("missing_data", `Tham chiếu cột "${inner}" không có trong lần import.`);
          out += q(name);
          i = end + 1;
          continue;
        }
      }
      out += ch;
      i++;
    }
    const parsed = parseFormula(out);
    if (!parsed.ok) return fail("syntax", `Công thức không đọc được: ${parsed.error.message}.`);
    const bad = validateCalls(parsed.ast).find((x) => x.code === "unknown_function");
    if (bad) {
      const fn = /Hàm (\S+) không tồn tại/.exec(bad.message)?.[1] ?? "?";
      return fail("unsupported_function", `Hàm không hỗ trợ: ${fn}.`);
    }
    return { ok: true, text: out };
  }

  private target(from: SheetMap, sheetName: string | undefined): SheetMap | { reason: Translated } {
    if (!sheetName) return from;
    const name = sheetName.replace(/''/g, "'");
    const s = this.find(name);
    if (!s) return { reason: fail("missing_table", `Tham chiếu bảng không tồn tại: sheet "${name}" không được chọn nhập.`) };
    return s;
  }

  private cell(from: SheetMap, row: number, sheetName: string | undefined, colAbs: boolean, col: number, rowAbs: boolean, r: number, text: string): string | Translated {
    const t = this.target(from, sheetName);
    if ("reason" in t) return t.reason;
    if (colAbs && rowAbs) return fail("fixed_cell", `Tham chiếu ô cố định ${text.replace(/^.*!/, "")} (một ô tham số, không phải một cột).`);
    if (rowAbs) return fail("fixed_cell", `Tham chiếu ô cố định ${text.replace(/^.*!/, "")} (một ô tham số, không phải một cột).`);
    if (t !== from) return fail("other_sheet_cell", `Tham chiếu một ô của sheet khác (${text}); chỉ nhập được tham chiếu cả cột.`);
    if (r !== row) return fail("row_offset", `Tham chiếu dòng khác (${text} ở dòng ${row}); công thức cột chỉ đọc cùng dòng.`);
    const name = t.cols.get(col);
    if (!name) return fail("missing_data", `Tham chiếu dữ liệu không tồn tại: cột ${text.replace(/^.*!/, "").replace(/[$\d]/g, "")} không có trong lần import.`);
    return q(name);
  }

  private range(from: SheetMap, _row: number, sheetName: string | undefined, c1: number, r1: number | null, c2: number, r2: number | null, text: string): string | Translated {
    const t = this.target(from, sheetName);
    if ("reason" in t) return t.reason;
    if (c1 !== c2) return fail("range_2d", `Vùng nhiều cột (${text}) chưa nhập được; chỉ nhập được vùng một cột.`);
    const name = t.cols.get(c1);
    if (!name) return fail("missing_data", `Tham chiếu dữ liệu không tồn tại: cột ${text.replace(/[$\d]/g, "").split(":")[0]} không có trong lần import.`);
    if (r1 !== null && r2 !== null && (r1 > t.firstData || r2 < t.lastData)) {
      return fail("range_partial", `Vùng ${text} chỉ lấy một phần của cột.`);
    }
    return `${q(t.table)}.${q(name)}`;
  }

  /** `Deals[Start date]`, `Deals[[#This Row],[Start date]]`, `Deals[@Col]`. */
  private tableRef(from: SheetMap, f: string, at: number, name: string): { text: string; end: number } | Translated {
    let depth = 0;
    let end = -1;
    for (let k = at + name.length; k < f.length; k++) {
      if (f[k] === "'" ) {
        k++;
        continue;
      }
      if (f[k] === "[") depth++;
      else if (f[k] === "]") {
        depth--;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    if (end < 0) return fail("syntax", `Tham chiếu bảng ${name}[…] không đóng ngoặc.`);
    const inner = f.slice(at + name.length + 1, end);
    const owner = this.sheets.flatMap((s) => s.tables.map((tb) => ({ s, tb }))).find((x) => norm(x.tb.name) === norm(name));
    if (!owner) {
      const exists = this.find(name);
      return fail("missing_table", exists ? `Bảng Excel "${name}" không đọc được.` : `Tham chiếu bảng không tồn tại: "${name}" không có trong file hoặc sheet chứa nó không được chọn nhập.`);
    }
    const clean = (s: string) => s.replace(/'([[\]#'])/g, "$1");
    let col: string;
    let thisRow = false;
    if (/^\[#this row\],\s*\[(.+)\]$/i.test(inner)) {
      col = clean(/^\[#this row\],\s*\[(.+)\]$/i.exec(inner)![1]!);
      thisRow = true;
    } else if (inner.startsWith("@")) {
      col = clean(inner.slice(1).replace(/^\[(.*)\]$/, "$1"));
      thisRow = true;
    } else if (/^\[[^[\]]+\]$/.test(inner) && !/^\[#/.test(inner)) col = clean(inner.slice(1, -1));
    else if (!/[[\]#@]/.test(inner.replace(/'[[\]#]/g, ""))) col = clean(inner);
    else return fail("syntax", `Tham chiếu bảng ${name}[${inner}] chưa nhập được.`);
    const idx = owner.tb.headers.findIndex((h) => norm(h) === norm(col));
    if (idx < 0) return fail("missing_data", `Tham chiếu dữ liệu không tồn tại: bảng ${name} không có cột "${col}".`);
    const colName = owner.s.cols.get(owner.tb.col0 + idx);
    if (!colName) return fail("missing_data", `Tham chiếu dữ liệu không tồn tại: cột "${col}" của bảng ${name} không có trong lần import.`);
    if (thisRow) {
      if (owner.s !== from) return fail("other_sheet_cell", `Tham chiếu một dòng của bảng ${name} từ sheet khác.`);
      return { text: q(colName), end: end + 1 };
    }
    return { text: `${q(owner.s.table)}.${q(colName)}`, end: end + 1 };
  }
}

/** Display-dependent text functions on a date column: Excel works on the SHOWN text ("09/2021"), the engine on the date value. */
export function displayWarnings(text: string, dateColumns: Set<string>): string[] {
  const out: string[] = [];
  const fn = /\b(LEFT|RIGHT|MID|LEN|FIND|SEARCH|SUBSTITUTE|REPLACE)\(\s*\[([^\]]+)\]/g;
  for (let m = fn.exec(text); m; m = fn.exec(text)) {
    if (dateColumns.has(norm(m[2]!))) out.push(`${m[1]}() dùng trên cột ngày "${m[2]}": Excel lấy chữ đang hiển thị (ví dụ 09/2021) còn hệ thống lấy số ngày nên kết quả sẽ khác. Dùng TEXT(ngày, "mm") hoặc MONTH(ngày) thay thế.`);
  }
  return [...new Set(out)];
}
