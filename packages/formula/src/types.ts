import { parseDateText } from "./dates";

/**
 * Values and errors of the formula engine (design module2 section 6). Pure TypeScript: no Node-only imports, so the same
 * code runs in the browser (preview) and on the server (official values).
 *
 * Dates are numbers, like in Excel: days since 1899-12-30 (a date-time has a fraction). The static type
 * inference (`infer.ts`) knows which numbers are dates, so a date column can be stored as `YYYY-MM-DD` again.
 */

export type FormulaErrorCode = "#DIV/0!" | "#N/A" | "#VALUE!" | "#REF!" | "#CYCLE!" | "#PERM!" | "#NAME?" | "#NUM!";

export const ERROR_CODES: readonly FormulaErrorCode[] = ["#DIV/0!", "#N/A", "#VALUE!", "#REF!", "#CYCLE!", "#PERM!", "#NAME?", "#NUM!"];

/** An Excel-like error value. It is also thrown inside functions and caught by the evaluator. */
export class FError {
  constructor(
    readonly code: FormulaErrorCode,
    readonly detail?: string,
  ) {}
  toString(): string {
    return this.code;
  }
}

export const isError = (v: unknown): v is FError => v instanceof FError;

/** A whole column of another table (or of this table). Loaded lazily, only by functions that need the values. */
export class RangeValue {
  constructor(
    readonly table: string,
    readonly key: string,
    private readonly load: () => Value[],
  ) {}
  private cache: Value[] | null = null;
  values(): Value[] {
    return (this.cache ??= this.load());
  }
}

export type Scalar = number | string | boolean | null | FError;
export type Value = Scalar | Value[] | RangeValue;

/**
 * Static result type of an expression. `mixed` = several types depending on the data; stored as text. `blank` = the empty
 * text `""`, which does not decide a type on its own: `IFERROR([a]/[b], "")` is still a number column.
 */
export type FType = "number" | "text" | "boolean" | "date" | "datetime" | "mixed" | "unknown" | "blank";

export const err = {
  div0: (d?: string) => new FError("#DIV/0!", d),
  na: (d?: string) => new FError("#N/A", d),
  value: (d?: string) => new FError("#VALUE!", d),
  ref: (d?: string) => new FError("#REF!", d),
  num: (d?: string) => new FError("#NUM!", d),
  name: (d?: string) => new FError("#NAME?", d),
};

/** Vietnamese explanation of an error code, for the formula editor and the cell tooltip. */
export const ERROR_MESSAGES: Record<FormulaErrorCode, string> = {
  "#DIV/0!": "Chia cho 0 hoặc cho ô trống.",
  "#N/A": "Không tìm thấy giá trị cần tra cứu.",
  "#VALUE!": "Sai kiểu dữ liệu, ví dụ cộng chữ với số.",
  "#REF!": "Cột hoặc bảng được tham chiếu đã bị xoá.",
  "#CYCLE!": "Công thức tham chiếu vòng tròn (A dùng B, B dùng A).",
  "#PERM!": "Công thức dùng dữ liệu không thuộc cùng chủ (bảng được người khác chia sẻ không dùng được trong công thức).",
  "#NAME?": "Tên hàm hoặc tên cột không tồn tại.",
  "#NUM!": "Số không hợp lệ cho phép tính này.",
};

// ------------------------------------------------------------------------------------------------
// coercion
// ------------------------------------------------------------------------------------------------

export function materialize(v: Value): Value {
  return v instanceof RangeValue ? v.values() : v;
}

export const isArray = (v: Value): v is Value[] => Array.isArray(v) || v instanceof RangeValue;

/** Array form of a value (a scalar becomes a one-element array). */
export function toArray(v: Value): Value[] {
  if (v instanceof RangeValue) return v.values();
  return Array.isArray(v) ? v : [v];
}

/** Flattens nested arrays and ranges (arguments of SUM, COUNT...). */
export function flatten(args: Value[]): Value[] {
  const out: Value[] = [];
  const walk = (v: Value) => {
    if (v instanceof RangeValue) v.values().forEach(walk);
    else if (Array.isArray(v)) v.forEach(walk);
    else out.push(v);
  };
  args.forEach(walk);
  return out;
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Text to number, or null when the text is not a number. Accepts `12.5`, `-3`, `10%`. */
export function parseNumberText(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  if (NUM_RE.test(t)) return Number(t);
  const p = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*%$/.exec(t);
  if (p) return Number(p[1]) / 100;
  return null;
}

export function toNumber(v: Value): number {
  const x = materialize(v);
  if (Array.isArray(x)) throw err.value("Cần một giá trị, nhưng nhận một danh sách.");
  if (x instanceof FError) throw x;
  if (x === null) return 0;
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return x ? 1 : 0;
  const n = parseNumberText(x as string);
  if (n !== null) return n;
  // Like Excel, text that reads as a date (`18/11/2026`, `2026-11-18`) is a date number in a calculation.
  const dt = parseDateText(x as string);
  if (dt !== null) return dt;
  throw err.value(`"${String(x).slice(0, 30)}" không phải là số.`);
}

/** Number or null for text that is not a number (no throw). Errors still throw. */
export function toNumberLoose(v: Value): number | null {
  const x = materialize(v);
  if (x instanceof FError) throw x;
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (x === null || Array.isArray(x)) return null;
  return parseNumberText(x as string);
}

/** Excel's text form of a number: at most 15 significant digits, no trailing zeros. */
export function numberToText(n: number): string {
  if (!Number.isFinite(n)) return "#NUM!";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  return String(Number(n.toPrecision(15)));
}

export function toText(v: Value): string {
  const x = materialize(v);
  if (Array.isArray(x)) throw err.value("Cần một giá trị, nhưng nhận một danh sách.");
  if (x instanceof FError) throw x;
  if (x === null) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number") return numberToText(x);
  return x ? "TRUE" : "FALSE";
}

export function toBool(v: Value): boolean {
  const x = materialize(v);
  if (Array.isArray(x)) throw err.value("Cần một giá trị, nhưng nhận một danh sách.");
  if (x instanceof FError) throw x;
  if (x === null) return false;
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return x !== 0;
  const t = (x as string).trim().toUpperCase();
  if (t === "TRUE") return true;
  if (t === "FALSE") return false;
  throw err.value(`"${String(x).slice(0, 30)}" không phải TRUE/FALSE.`);
}

export const isBlank = (v: Value): boolean => v === null || v === "";

/** Order of types when comparing different kinds: number < text < boolean (Excel). */
const rank = (v: Scalar): number => (typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);

/** Excel comparison: -1, 0, 1. Blank counts as the default of the other side (0, empty text, FALSE). Text is case-insensitive. */
export function compareValues(a: Scalar, b: Scalar): number {
  if (a instanceof FError) throw a;
  if (b instanceof FError) throw b;
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === "number" ? 0 : typeof b === "string" ? "" : false;
  if (b === null) b = typeof a === "number" ? 0 : typeof a === "string" ? "" : false;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === "number") return a < (b as number) ? -1 : a > (b as number) ? 1 : 0;
  if (typeof a === "string") {
    const x = a.toLowerCase();
    const y = (b as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a === b ? 0 : a ? 1 : -1;
}
