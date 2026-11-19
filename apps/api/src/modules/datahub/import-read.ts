import JSZip from "jszip";
import { AppError } from "@soe/shared";

/**
 * Readers for the import sources (design module2 section 8.1): `.xlsx` (own small reader: it keeps the formula text and the cached
 * value of every cell, shared formulas included, which the general libraries lose), `.csv` / pasted text, and the Google Sheets export.
 * Everything here works on bytes already in memory; nothing touches the database.
 */

export interface SrcCell {
  /** Cached value (formula cells: the value Excel stored). */
  v: string | number | boolean | null;
  /** A number shown as a date or date-time (the cell's number format says so): `v` is the Excel serial. */
  date?: boolean;
  /** Number format code (percent, money and date detection). */
  fmt?: string;
  /** Formula text without the leading `=` (shared formulas already expanded for this cell). */
  formula?: string;
  /** Error value (`#DIV/0!`) the cell shows. */
  error?: string;
}

export interface SrcRow {
  /** Row number in the sheet, 1-based. */
  n: number;
  /** Cells by 0-based column index (sparse: missing = empty). */
  cells: (SrcCell | undefined)[];
}

export interface SrcTable {
  name: string;
  /** Header names of the Excel table, in order. */
  headers: string[];
  /** First column (0-based) and the header row (1-based) of the table. */
  col0: number;
  headerRow: number;
}

export interface SrcSheet {
  name: string;
  hidden: boolean;
  tables: SrcTable[];
}

export interface SourceBook {
  kind: "xlsx" | "csv";
  sheets: SrcSheet[];
  rows(sheet: number): Generator<SrcRow>;
}

// ------------------------------------------------------------------------------------------------
// A1 helpers
// ------------------------------------------------------------------------------------------------

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function colLetters(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const unxml = (t: string) =>
  t
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/_x([0-9a-fA-F]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const attr = (s: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(s);
  return m ? unxml(m[1]!) : undefined;
};

// ------------------------------------------------------------------------------------------------
// shifting the relative references of a shared formula
// ------------------------------------------------------------------------------------------------

const REF_RE = /(?<![A-Za-z0-9_.$])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])|(?<![A-Za-z0-9_.$])(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![A-Za-z0-9_(])/g;

/** Moves the relative parts of every A1 reference by (dRow, dCol), as Excel does when a shared formula is filled down or across. */
export function shiftFormula(formula: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return formula;
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < formula.length && !(formula[j] === '"' && formula[j + 1] !== '"')) j += formula[j] === '"' ? 2 : 1;
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      // Quoted sheet name: copy it as is.
      let j = i + 1;
      while (j < formula.length && formula[j] !== "'") j++;
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Copy up to the next quote, shifting references in the plain stretch.
    let j = i;
    while (j < formula.length && formula[j] !== '"' && formula[j] !== "'") j++;
    out += formula.slice(i, j).replace(REF_RE, (m, d1: string | undefined, c1: string | undefined, d2: string | undefined, r: string | undefined, d3: string | undefined, c2: string | undefined, d4: string | undefined, c3: string | undefined) => {
      if (c1 !== undefined) {
        const col = d1 ? colIndex(c1) : colIndex(c1) + dCol;
        const row = d2 ? Number(r) : Number(r) + dRow;
        if (col < 0 || row < 1) return "#REF!";
        return `${d1}${colLetters(col)}${d2}${row}`;
      }
      void m;
      const a = d3 ? colIndex(c2!) : colIndex(c2!) + dCol;
      const b = d4 ? colIndex(c3!) : colIndex(c3!) + dCol;
      return `${d3}${colLetters(Math.max(0, a))}:${d4}${colLetters(Math.max(0, b))}`;
    });
    i = j;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// number formats
// ------------------------------------------------------------------------------------------------

const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN_FORMATS: Record<number, string> = { 9: "0%", 10: "0.00%", 14: "dd/mm/yyyy", 15: "d-mmm-yy", 22: "dd/mm/yyyy hh:mm", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0" };

/** True when a number format code shows a date or a time (letters d m y h s outside quotes, brackets and escapes). */
export function isDateFormat(code: string): boolean {
  const c = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "").replace(/_./g, "").replace(/\*./g, "");
  return /[dmyhs]/i.test(c) && !/^(general|@)/i.test(c.trim());
}

// ------------------------------------------------------------------------------------------------
// xlsx
// ------------------------------------------------------------------------------------------------

interface SheetEntry {
  name: string;
  path: string;
  hidden: boolean;
}

export class XlsxBook implements SourceBook {
  readonly kind = "xlsx" as const;
  readonly sheets: SrcSheet[] = [];
  private entries: SheetEntry[] = [];
  private shared: string[] = [];
  private xfDate: boolean[] = [];
  private xfFmt: string[] = [];
  private date1904 = false;
  private cache = new Map<number, string>();

  private constructor(private readonly zip: JSZip) {}

  static async open(bytes: Buffer): Promise<XlsxBook> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw new AppError("validation_error", "File không phải .xlsx hợp lệ (không mở được). Hãy lưu lại bằng Excel hoặc Google Sheets rồi thử lại.");
    }
    const book = new XlsxBook(zip);
    await book.load();
    return book;
  }

  private async text(p: string): Promise<string | null> {
    const f = this.zip.file(p);
    return f ? await f.async("string") : null;
  }

  private async load(): Promise<void> {
    const wbXml = await this.text("xl/workbook.xml");
    const relsXml = await this.text("xl/_rels/workbook.xml.rels");
    if (!wbXml || !relsXml) throw new AppError("validation_error", "File .xlsx thiếu workbook.xml, không đọc được.");
    this.date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wbXml);
    const rels = new Map<string, string>();
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = attr(m[0], "Id");
      const target = attr(m[0], "Target");
      if (id && target) rels.set(id, target);
    }
    const norm = (t: string) => (t.startsWith("/") ? t.slice(1) : `xl/${t}`);
    for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
      const name = attr(m[0], "name");
      const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
      const target = rid ? rels.get(rid) : undefined;
      if (!name || !target) continue;
      this.entries.push({ name, path: norm(target), hidden: /state="(hidden|veryHidden)"/.test(m[0]) });
    }
    if (this.entries.length === 0) throw new AppError("validation_error", "File .xlsx không có sheet nào.");

    const ss = await this.text("xl/sharedStrings.xml");
    if (ss) {
      for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
        const body = (si[1] ?? "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
        this.shared.push(unxml([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
      }
    }
    const styles = await this.text("xl/styles.xml");
    if (styles) {
      const custom = new Map<number, string>();
      for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
        const id = Number(attr(m[0], "numFmtId"));
        const code = attr(m[0], "formatCode");
        if (!Number.isNaN(id) && code !== undefined) custom.set(id, code);
      }
      const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
      for (const m of cellXfs.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)) {
        const id = Number(attr(m[0], "numFmtId") ?? 0);
        const code = custom.get(id) ?? BUILTIN_FORMATS[id] ?? "";
        this.xfFmt.push(code);
        this.xfDate.push(custom.has(id) ? isDateFormat(code) : BUILTIN_DATE_IDS.has(id));
      }
    }

    // Excel tables (`Deals[Start date]`): which sheet each lives on, its columns and where it starts.
    const tableByPath = new Map<string, SrcTable>();
    for (const e of this.entries) {
      const sheet: SrcSheet = { name: e.name, hidden: e.hidden, tables: [] };
      const relPath = e.path.replace(/([^/]+)$/, "_rels/$1.rels");
      const rx = await this.text(relPath);
      if (rx) {
        for (const m of rx.matchAll(/<Relationship\b[^>]*>/g)) {
          const target = attr(m[0], "Target");
          if (!target || !/table/i.test(attr(m[0], "Type") ?? "")) continue;
          const p = target.startsWith("/") ? target.slice(1) : new URL(target, `http://x/${e.path}`).pathname.slice(1);
          let t = tableByPath.get(p);
          if (!t) {
            const tx = await this.text(p);
            const ref = tx ? /<table\b[^>]*\sref="([A-Z]+)(\d+):[A-Z]+\d+"/.exec(tx) : null;
            const name = tx ? (/<table\b[^>]*\sname="([^"]+)"/.exec(tx)?.[1] ?? /<table\b[^>]*\sdisplayName="([^"]+)"/.exec(tx)?.[1]) : undefined;
            if (tx && ref && name) {
              const headers = [...tx.matchAll(/<tableColumn\b[^>]*>/g)].map((c) => attr(c[0], "name") ?? "");
              t = { name: unxml(name), headers, col0: colIndex(ref[1]!), headerRow: Number(ref[2]) };
              tableByPath.set(p, t);
            }
          }
          if (t) sheet.tables.push(t);
        }
      }
      this.sheets.push(sheet);
    }
  }

  private async sheetXml(i: number): Promise<string> {
    let x = this.cache.get(i);
    if (x === undefined) {
      x = (await this.text(this.entries[i]!.path)) ?? "";
      this.cache.clear();
      this.cache.set(i, x);
    }
    return x;
  }

  /** Reads a sheet's XML into memory (call once before `rows`). */
  async prepare(i: number): Promise<void> {
    await this.sheetXml(i);
  }

  *rows(sheet: number): Generator<SrcRow> {
    const xml = this.cache.get(sheet);
    if (xml === undefined) throw new Error("XlsxBook.prepare(sheet) must be awaited before rows()");
    const masters = new Map<string, { formula: string; row: number; col: number }>();
    let auto = 0;
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    for (let rm = rowRe.exec(xml); rm; rm = rowRe.exec(xml)) {
      const n = Number(attr(rm[1]!, "r") ?? auto + 1);
      auto = n;
      const cells: (SrcCell | undefined)[] = [];
      const body = rm[2];
      if (body) {
        const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let next = 0;
        for (let cm = cellRe.exec(body); cm; cm = cellRe.exec(body)) {
          const attrs = cm[1]!;
          const ref = /(?:^|\s)r="([A-Z]+)(\d+)"/.exec(attrs);
          const col = ref ? colIndex(ref[1]!) : next;
          next = col + 1;
          const inner = cm[2] ?? "";
          const t = attr(attrs, "t");
          const s = attr(attrs, "s");
          const xf = s === undefined ? -1 : Number(s);
          const cell: SrcCell = { v: null };
          const f = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner);
          if (f) {
            const fa = f[1] ?? "";
            let text = f[2] !== undefined ? unxml(f[2]) : "";
            if (attr(fa, "t") === "shared") {
              const si = attr(fa, "si") ?? "";
              if (text) masters.set(si, { formula: text, row: n, col });
              else {
                const m = masters.get(si);
                if (m) text = shiftFormula(m.formula, n - m.row, col - m.col);
              }
            }
            if (text) cell.formula = text;
          }
          const vTag = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
          if (t === "s") cell.v = vTag === undefined ? null : (this.shared[Number(vTag)] ?? null);
          else if (t === "inlineStr") cell.v = unxml([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
          else if (t === "str") {
            const v = vTag === undefined ? "" : unxml(vTag);
            if (/^#(DIV\/0!|N\/A|VALUE!|REF!|NUM!|NAME\?|NULL!)$/.test(v)) cell.error = v;
            else cell.v = v;
          } else if (t === "b") cell.v = vTag === "1";
          else if (t === "e") cell.error = vTag === undefined ? "#VALUE!" : unxml(vTag);
          else if (vTag !== undefined && vTag !== "") {
            const num = Number(vTag);
            cell.v = Number.isFinite(num) ? num : null;
            if (xf >= 0 && this.xfDate[xf]) {
              cell.date = true;
              if (this.date1904 && cell.v !== null) cell.v = (cell.v as number) + 1462;
            }
          }
          if (xf >= 0 && this.xfFmt[xf]) cell.fmt = this.xfFmt[xf];
          if (cell.v === null && !cell.formula && !cell.error) continue;
          cells[col] = cell;
        }
      }
      yield { n, cells };
    }
  }
}

// ------------------------------------------------------------------------------------------------
// csv / pasted text
// ------------------------------------------------------------------------------------------------

/**
 * The most likely field separator of a text table. Looks at the first lines (a quoted cell may span lines): the separator that splits
 * the most lines into the same, larger-than-one number of fields wins. A title line above the header does not decide it.
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 30_000);
  let best = ",";
  let bestScore = 0;
  for (const d of [",", "\t", ";", "|"]) {
    const counts: number[] = [];
    let q = false;
    let n = 0;
    for (const ch of sample) {
      if (ch === '"') q = !q;
      else if (!q && ch === d) n++;
      else if (!q && (ch === "\n" || ch === "\r")) {
        if (n > 0) counts.push(n);
        n = 0;
        if (counts.length >= 12) break;
      }
    }
    if (counts.length === 0) continue;
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = 0;
    let modeN = 0;
    for (const [c, k] of freq) if (k > modeN || (k === modeN && c > mode)) [mode, modeN] = [c, k];
    const score = modeN * 1000 + mode;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export class CsvBook implements SourceBook {
  readonly kind = "csv" as const;
  readonly sheets: SrcSheet[];
  private readonly text: string;
  private readonly delimiter: string;

  constructor(raw: string, name: string, delimiter?: string) {
    this.text = raw.replace(/^\uFEFF/, "");
    this.delimiter = delimiter ?? detectDelimiter(this.text);
    this.sheets = [{ name, hidden: false, tables: [] }];
  }

  *rows(): Generator<SrcRow> {
    const text = this.text;
    const d = this.delimiter;
    let field = "";
    let row: string[] = [];
    let inQ = false;
    let n = 0;
    let any = false;
    const flush = (): SrcRow | null => {
      row.push(field);
      field = "";
      const cur = row;
      row = [];
      n++;
      any = false;
      if (cur.length === 1 && cur[0] === "") return null; // blank line
      const cells: (SrcCell | undefined)[] = cur.map((v) => (v === "" ? undefined : { v }));
      return { n, cells };
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQ = false;
        } else field += ch;
        continue;
      }
      if (ch === '"' && field === "") {
        inQ = true;
        any = true;
      } else if (ch === d) {
        row.push(field);
        field = "";
        any = true;
      } else if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        const r = flush();
        if (r) yield r;
      } else {
        field += ch;
        any = true;
      }
    }
    if (any || field !== "" || row.length > 0) {
      const r = flush();
      if (r) yield r;
    }
  }
}

export type SourceKind = "xlsx" | "csv";

/** Opens the bytes as a workbook or a text table. The kind comes from the content first (a zip is an xlsx), then from the name. */
export async function openBook(bytes: Buffer, filename: string): Promise<SourceBook & { prepare?(i: number): Promise<void> }> {
  const isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return XlsxBook.open(bytes);
  if (/\.xlsx?$/i.test(filename) && !isZip) throw new AppError("validation_error", "File Excel cũ (.xls) hoặc bị hỏng. Hãy lưu lại thành .xlsx rồi thử lại.");
  const text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("\u0000")) throw new AppError("validation_error", "File không phải văn bản CSV hay .xlsx.");
  const base = filename.replace(/\.[^.]+$/, "") || "Sheet1";
  return new CsvBook(text, base.slice(0, 100));
}

// ------------------------------------------------------------------------------------------------
// Google Sheets link
// ------------------------------------------------------------------------------------------------

/** The spreadsheet id (and tab id, if the link has one) in a Google Sheets link; null for any other address. */
export function parseGoogleSheetUrl(raw: string): { id: string; gid: string | null } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  const m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/.exec(u.pathname);
  if (!m) return null;
  const gid = /gid=(\d+)/.exec(u.hash)?.[1] ?? u.searchParams.get("gid");
  return { id: m[1]!, gid: gid ?? null };
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; redirect?: "follow" | "manual" }) => Promise<{ ok: boolean; status: number; url: string; headers: { get(n: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

/**
 * Downloads a Google Sheet that is shared as "anyone with the link can view" (no Google sign-in, design module2 section 8.1) as xlsx, so every
 * tab and every formula comes along. Only docs.google.com is contacted; the answer must come from a Google host.
 */
export async function fetchGoogleSheet(link: string, maxBytes: number, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<{ bytes: Buffer; filename: string }> {
  const p = parseGoogleSheetUrl(link);
  if (!p) throw new AppError("validation_error", "Đây không phải link Google Sheets (cần dạng https://docs.google.com/spreadsheets/d/…).");
  const url = `https://docs.google.com/spreadsheets/d/${p.id}/export?format=xlsx`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, redirect: "follow" });
    const host = (() => {
      try {
        return new URL(res.url).hostname;
      } catch {
        return "";
      }
    })();
    if (!/(^|\.)(google\.com|googleusercontent\.com)$/.test(host)) throw new AppError("validation_error", "Google trả về địa chỉ lạ, đã dừng.");
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || /text\/html/i.test(type)) {
      throw new AppError("validation_error", "Không tải được Google Sheet. Hãy đặt chia sẻ là \"Bất kỳ ai có đường liên kết đều có thể xem\", hoặc tải về .xlsx rồi nhập file.", { status: res.status });
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) throw new AppError("payload_too_large", `Google Sheet quá lớn (tối đa ${Math.floor(maxBytes / 1024 / 1024)} MB).`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > maxBytes) throw new AppError("payload_too_large", `Google Sheet quá lớn (tối đa ${Math.floor(maxBytes / 1024 / 1024)} MB).`);
    return { bytes, filename: `google-sheet-${p.id.slice(0, 8)}.xlsx` };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("validation_error", "Không kết nối được tới Google Sheets. Thử lại sau, hoặc tải về .xlsx rồi nhập file.");
  } finally {
    clearTimeout(timer);
  }
}
