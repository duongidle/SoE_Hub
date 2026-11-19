import { EMPTY, formatDate, formatDateTime, formatNumber, formatPercent } from "@soe/shared";
import { nameKey } from "./cells";

/**
 * Help while typing a formula (design module2 section 6.3): what to suggest at the caret, which function the caret is inside (to bold the
 * argument being typed), where the errors the server found sit, and the library of sample formulas. All pure: the server is the one that
 * checks and computes; nothing here decides whether a formula is right.
 */

export interface FnInfo {
  name: string;
  group: string;
  syntax: string;
  description: string;
  example: string;
  example_result: string;
  min_args: number;
  max_args: number;
}

export interface RefTable {
  id: string;
  name: string;
  /** Names of the columns, or null while they have not been loaded. */
  columns: string[] | null;
}

export interface RefDatahub {
  id: string;
  name: string;
  tables: RefTable[];
}

/** What a formula may refer to: the table it is in, its datahub and the other datahubs of the same owner. */
export interface FormulaScope {
  current: RefTable;
  datahub: RefDatahub;
  others: RefDatahub[];
}

export interface Suggestion {
  kind: "function" | "column" | "table" | "datahub";
  label: string;
  detail?: string;
  /** Text that replaces `from..to`. */
  insert: string;
  /** Put the caret before this many characters from the end of `insert` (inside the brackets). */
  back?: number;
}

export interface SuggestResult {
  from: number;
  to: number;
  items: Suggestion[];
  /** The columns of this table are needed to answer; ask for them. */
  needs?: string;
}

const MAX_ITEMS = 40;
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/;

/** The open `[` the caret is inside, and the bracket names written before it (`[A].[B].[` gives ["A", "B"]). */
function openBracket(text: string, caret: number): { start: number; chain: string[] } | null {
  const open = text.lastIndexOf("[", caret - 1);
  if (open < 0 || text.slice(open, caret).includes("]")) return null;
  // A `[` inside a string is not a reference.
  let inString = false;
  for (let i = 0; i < open; i++) if (text[i] === '"') inString = !inString;
  if (inString) return null;
  const chain: string[] = [];
  let pos = open;
  while (text.slice(Math.max(0, pos - 2), pos) === "].") {
    const close = pos - 2;
    const o = text.lastIndexOf("[", close - 1);
    if (o < 0) break;
    chain.unshift(text.slice(o + 1, close));
    pos = o;
  }
  return { start: open, chain };
}

const same = (a: string, b: string) => nameKey(a) === nameKey(b);
const matches = (name: string, typed: string) => typed === "" || nameKey(name).includes(nameKey(typed));

function sorted<T extends { label: string }>(items: T[], typed: string): T[] {
  const t = nameKey(typed);
  const rank = (s: string) => (t && nameKey(s).startsWith(t) ? 0 : 1);
  return [...items].sort((a, b) => rank(a.label) - rank(b.label)).slice(0, MAX_ITEMS);
}

/** Suggestions for the text at the caret, or null when there is nothing to suggest. */
export function suggest(text: string, caret: number, scope: FormulaScope, fns: FnInfo[]): SuggestResult | null {
  const br = openBracket(text, caret);
  if (br) {
    const typed = text.slice(br.start + 1, caret);
    const from = br.start + 1;
    const closeAhead = text[caret] === "]";
    const to = closeAhead ? caret + 1 : caret;
    const col = (c: string): Suggestion => ({ kind: "column", label: c, insert: `${c}]` });
    const tableTo = (t: RefTable): Suggestion => ({ kind: "table", label: t.name, detail: "bảng", insert: `${t.name}].[` });
    const dhTo = (d: RefDatahub): Suggestion => ({ kind: "datahub", label: d.name, detail: "datahub", insert: `${d.name}].[` });
    let items: Suggestion[] = [];
    let needs: string | undefined;
    if (br.chain.length === 0) {
      items = [
        ...(scope.current.columns ?? []).filter((c) => matches(c, typed)).map(col),
        ...scope.datahub.tables.filter((t) => matches(t.name, typed)).map(tableTo),
        ...scope.others.filter((d) => matches(d.name, typed)).map(dhTo),
      ];
    } else if (br.chain.length === 1) {
      const t = scope.datahub.tables.find((x) => same(x.name, br.chain[0]!));
      const d = !t ? scope.others.find((x) => same(x.name, br.chain[0]!)) : undefined;
      if (t) {
        if (t.columns) items = t.columns.filter((c) => matches(c, typed)).map(col);
        else needs = t.id;
      } else if (d) items = d.tables.filter((x) => matches(x.name, typed)).map(tableTo);
    } else if (br.chain.length === 2) {
      const d = [scope.datahub, ...scope.others].find((x) => same(x.name, br.chain[0]!));
      const t = d?.tables.find((x) => same(x.name, br.chain[1]!));
      if (t) {
        if (t.columns) items = t.columns.filter((c) => matches(c, typed)).map(col);
        else needs = t.id;
      }
    }
    if (needs) return { from, to, items: [], needs };
    items = sorted(items, typed);
    return items.length ? { from, to, items } : null;
  }

  // A function name: letters just before the caret, not inside a string or after a bracket.
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_]/.test(text[start - 1]!)) start--;
  const word = text.slice(start, caret);
  if (!word || !IDENT.test(word) || /^[0-9]/.test(word)) return null;
  let inString = false;
  for (let i = 0; i < start; i++) if (text[i] === '"') inString = !inString;
  if (inString) return null;
  const up = word.toUpperCase();
  const hits = fns.filter((f) => f.name.startsWith(up));
  if (hits.length === 0 || (hits.length === 1 && hits[0]!.name === up && text[caret] === "(")) return null;
  let end = caret;
  while (end < text.length && /[A-Za-z0-9_]/.test(text[end]!)) end++;
  const hasParen = text[end] === "(";
  return {
    from: start,
    to: end,
    items: hits.slice(0, MAX_ITEMS).map((f) => ({ kind: "function", label: f.name, detail: f.description, insert: hasParen ? f.name : `${f.name}(`, ...(f.max_args === 0 && !hasParen ? { insert: `${f.name}()` } : {}) })),
  };
}

/** The text with the suggestion put in, and where the caret goes. */
export function applySuggestion(text: string, r: SuggestResult, s: Suggestion): { text: string; caret: number } {
  const next = text.slice(0, r.from) + s.insert + text.slice(r.to);
  return { text: next, caret: r.from + s.insert.length - (s.back ?? 0) };
}

// ---- the function the caret is in -----------------------------------------------------------------------------------------------

export interface ActiveCall {
  name: string;
  /** Index of the argument the caret is in (0 = first). */
  arg: number;
}

/** The innermost function call that contains the caret, ignoring text inside strings and `[ ]` references. */
export function activeCall(text: string, caret: number): ActiveCall | null {
  const stack: ActiveCall[] = [];
  let i = 0;
  let inString = false;
  let inRef = false;
  while (i < caret) {
    const ch = text[i]!;
    if (inString) {
      if (ch === '"') {
        if (text[i + 1] === '"') i++;
        else inString = false;
      }
    } else if (inRef) {
      if (ch === "]") inRef = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[") inRef = true;
    else if (ch === "(") {
      const m = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(text.slice(0, i));
      stack.push({ name: m ? m[1]!.toUpperCase() : "", arg: 0 });
    } else if (ch === ")") stack.pop();
    else if ((ch === "," || ch === ";") && stack.length) stack[stack.length - 1]!.arg++;
    i++;
  }
  for (let k = stack.length - 1; k >= 0; k--) if (stack[k]!.name) return stack[k]!;
  return null;
}

export interface SyntaxPart {
  text: string;
  active: boolean;
}

/** `IF(điều_kiện, nếu_đúng, [nếu_sai])` cut into pieces; the argument being typed is marked. */
export function syntaxParts(syntax: string, arg: number): SyntaxPart[] {
  const open = syntax.indexOf("(");
  const close = syntax.lastIndexOf(")");
  if (open < 0 || close < open) return [{ text: syntax, active: false }];
  const params: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of syntax.slice(open + 1, close)) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      params.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) params.push(cur.trim());
  // A trailing "..." means the previous argument repeats: past the end, the last real one stays marked.
  const hasMore = params[params.length - 1] === "...";
  const real = hasMore ? params.length - 1 : params.length;
  const at = arg < params.length ? arg : hasMore ? Math.max(0, real - 1) : -1;
  const parts: SyntaxPart[] = [{ text: `${syntax.slice(0, open)}(`, active: false }];
  params.forEach((p, i) => {
    if (i > 0) parts.push({ text: ", ", active: false });
    parts.push({ text: p, active: i === at });
  });
  parts.push({ text: ")", active: false });
  return parts;
}

// ---- errors ---------------------------------------------------------------------------------------------------------------------

export interface FormulaIssue {
  message: string;
  start: number;
  end: number;
}

export interface Segment {
  text: string;
  issue: string | null;
}

/**
 * Splits the text so every part the server marked as wrong can be underlined. Positions come from the server for the text it was sent;
 * `offset` is how many characters the leading `=` shifts them when the editor shows the formula without it.
 */
export function segments(text: string, issues: FormulaIssue[], offset = 0): Segment[] {
  const marks = issues
    .map((i) => ({ start: Math.max(0, Math.min(text.length, i.start - offset)), end: Math.max(0, Math.min(text.length, i.end - offset)), message: i.message }))
    .filter((m) => m.end > m.start || m.start < text.length)
    .map((m) => (m.end > m.start ? m : { ...m, end: Math.min(text.length, m.start + 1) }))
    .sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue; // overlapping: the first one wins
    if (m.start > at) out.push({ text: text.slice(at, m.start), issue: null });
    out.push({ text: text.slice(m.start, m.end), issue: m.message });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), issue: null });
  return out;
}

// ---- sample formulas ------------------------------------------------------------------------------------------------------------

/** A blank in a sample the person fills from a list the screen builds (columns of this table, other tables, columns of that table). */
export type SampleSlot =
  | { id: string; label: string; kind: "col"; types?: string[] }
  | { id: string; label: string; kind: "table" }
  | { id: string; label: string; kind: "tcol"; of: string; types?: string[] };

export interface Sample {
  id: string;
  title: string;
  description: string;
  /** Formula with `{slot}` placeholders; a placeholder becomes `Name` and sits inside the brackets of the sample. */
  template: string;
  slots: SampleSlot[];
}

const NUM = ["number", "currency", "percent", "formula", "rollup", "auto_number"];
const DATE = ["date", "datetime", "created_time", "modified_time", "formula"];
const TEXTY = ["text", "long_text", "single_select", "email", "phone", "url", "formula", "lookup", "auto_number", "number"];

export const FORMULA_SAMPLES: Sample[] = [
  {
    id: "size",
    title: "Phân loại theo ngưỡng",
    description: "Ví dụ phân loại deal size: trên 1 tỷ hoặc dưới 1 tỷ.",
    template: '=IF([{num}] >= 1000000000, "Trên 1 tỷ", "Dưới 1 tỷ")',
    slots: [{ id: "num", label: "Cột số", kind: "col", types: NUM }],
  },
  {
    id: "days-since",
    title: "Số ngày từ một ngày đến nay",
    description: "Số ngày cycle tính đến hôm nay.",
    template: '=DATEDIF([{date}], TODAY(), "D")',
    slots: [{ id: "date", label: "Cột ngày", kind: "col", types: DATE }],
  },
  {
    id: "days-between",
    title: "Số ngày giữa hai ngày",
    description: "Ví dụ từ ngày bắt đầu đến ngày chốt.",
    template: "=DAYS([{end}], [{start}])",
    slots: [
      { id: "end", label: "Ngày cuối", kind: "col", types: DATE },
      { id: "start", label: "Ngày đầu", kind: "col", types: DATE },
    ],
  },
  {
    id: "quarter",
    title: "Quý của một ngày",
    description: "Ra chữ dạng Q4/2026.",
    template: '="Q"&QUARTER([{date}])&"/"&YEAR([{date}])',
    slots: [{ id: "date", label: "Cột ngày", kind: "col", types: DATE }],
  },
  {
    id: "month",
    title: "Tháng của một ngày",
    description: "Ra chữ dạng 11/2026, dùng để nhóm theo tháng.",
    template: '=TEXT([{date}], "mm/yyyy")',
    slots: [{ id: "date", label: "Cột ngày", kind: "col", types: DATE }],
  },
  {
    id: "safe-divide",
    title: "Chia hai cột, bỏ trống khi chia cho 0",
    description: "Ví dụ đơn giá = doanh thu / số lượng.",
    template: '=IFERROR([{a}] / [{b}], "")',
    slots: [
      { id: "a", label: "Cột số bị chia", kind: "col", types: NUM },
      { id: "b", label: "Cột số chia", kind: "col", types: NUM },
    ],
  },
  {
    id: "join",
    title: "Ghép hai cột chữ",
    description: "Ví dụ mã - tên.",
    template: '=CONCAT([{a}], " - ", [{b}])',
    slots: [
      { id: "a", label: "Cột thứ nhất", kind: "col", types: TEXTY },
      { id: "b", label: "Cột thứ hai", kind: "col", types: TEXTY },
    ],
  },
  {
    id: "lookup",
    title: "Tra cứu từ bảng khác",
    description: "Lấy giá trị ở bảng khác khi cột khoá khớp nhau.",
    template: "=XLOOKUP([{key}], [{table}].[{tkey}], [{table}].[{tval}])",
    slots: [
      { id: "key", label: "Cột khoá của bảng này", kind: "col", types: TEXTY },
      { id: "table", label: "Bảng cần tra", kind: "table" },
      { id: "tkey", label: "Cột khoá của bảng cần tra", kind: "tcol", of: "table" },
      { id: "tval", label: "Cột lấy giá trị", kind: "tcol", of: "table" },
    ],
  },
  {
    id: "count-if",
    title: "Đếm dòng của bảng khác theo điều kiện",
    description: "Đếm số dòng ở bảng khác có cùng giá trị khoá với dòng này.",
    template: "=COUNTIFS([{table}].[{tkey}], [{key}])",
    slots: [
      { id: "key", label: "Cột khoá của bảng này", kind: "col", types: TEXTY },
      { id: "table", label: "Bảng cần đếm", kind: "table" },
      { id: "tkey", label: "Cột khoá của bảng cần đếm", kind: "tcol", of: "table" },
    ],
  },
  {
    id: "sum-if",
    title: "Cộng số của bảng khác theo điều kiện",
    description: "Tổng một cột số ở bảng khác cho các dòng cùng khoá.",
    template: "=SUMIFS([{table}].[{tsum}], [{table}].[{tkey}], [{key}])",
    slots: [
      { id: "key", label: "Cột khoá của bảng này", kind: "col", types: TEXTY },
      { id: "table", label: "Bảng cần cộng", kind: "table" },
      { id: "tkey", label: "Cột khoá của bảng cần cộng", kind: "tcol", of: "table" },
      { id: "tsum", label: "Cột số cần cộng", kind: "tcol", of: "table", types: NUM },
    ],
  },
];

/** The formula of a sample with the picks put in. A blank without a pick stays as `{slot}` so the preview shows it as not yet filled. */
export function fillSample(sample: Sample, picks: Record<string, string>): string {
  return sample.template.replace(/\{(\w+)\}/g, (m, id: string) => picks[id] ?? m);
}

export function sampleReady(sample: Sample, picks: Record<string, string>): boolean {
  return sample.slots.every((s) => !!picks[s.id]);
}

// ---- preview values -------------------------------------------------------------------------------------------------------------

/** A previewed value as it will look in the column: the same formatters as the grid. */
export function previewText(resultType: string | null, v: unknown): string {
  if (v === null || v === undefined || v === "") return EMPTY;
  switch (resultType) {
    case "number":
      return typeof v === "number" ? formatNumber(v) : String(v);
    case "percent":
      return typeof v === "number" ? formatPercent(v) : String(v);
    case "date":
      return formatDate(String(v));
    case "datetime":
      return formatDateTime(String(v));
    case "checkbox":
      return v === true ? "Có" : "Không";
    default:
      return String(v);
  }
}
