/**
 * One set of display formatters for the whole system (CLAUDE.md "Bảng, số liệu, biểu đồ"): numbers, money, percent, dates,
 * in `vi-VN` and Vietnam time. Grid, dashboard, export and notifications all call these, so one value reads the same everywhere.
 */

export const EMPTY = "—";
export const VN_TIMEZONE = "Asia/Ho_Chi_Minh";

/** Hard cap of fraction digits in `formatNumber` (a stored number has no more than 10 meaningful ones). */
const MAX_FRACTION = 10;

const numberFormats = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number, grouping: boolean): Intl.NumberFormat {
  const k = `${min}/${max}/${grouping}`;
  let f = numberFormats.get(k);
  if (!f) {
    f = new Intl.NumberFormat("vi-VN", { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: grouping ? "always" : false });
    numberFormats.set(k, f);
  }
  return f;
}

export interface NumberFormatOptions {
  /** Fixed number of decimals. Omitted = as many as the value has (up to 10), with float noise removed (0,1 + 0,2 shows 0,3). */
  decimals?: number;
  /** Thousands separator (default true). */
  thousands?: boolean;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** `1.234.567`, `12,5`, `-3`. Empty (null, undefined, NaN) gives "—", never "NaN" or a fake 0. */
export function formatNumber(v: number | null | undefined, o: NumberFormatOptions = {}): string {
  if (!isNum(v)) return EMPTY;
  const grouping = o.thousands !== false;
  if (o.decimals !== undefined) return nf(o.decimals, o.decimals, grouping).format(roundHalfAway(v, o.decimals)).replace("-0", "0");
  // Drop float noise (0.30000000000000004 -> 0.3) before choosing the digits to show.
  return nf(0, MAX_FRACTION, grouping).format(Number(v.toPrecision(12)));
}

/** Rounds half away from zero (Excel's ROUND), so 2,5 with 0 decimals shows 3 as the user expects. */
function roundHalfAway(v: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(Math.abs(v) * f * (1 + Number.EPSILON)) / f;
  return v < 0 ? -r : r;
}

/** `1.234.567 ₫`. Money in VND has no decimals. */
export function formatCurrency(v: number | null | undefined, o: { unit?: string } = {}): string {
  if (!isNum(v)) return EMPTY;
  return `${formatNumber(v, { decimals: 0 })} ${o.unit ?? "₫"}`;
}

/** The stored value is a fraction: 0,125 shows `12,5%`. */
export function formatPercent(fraction: number | null | undefined, o: { decimals?: number } = {}): string {
  if (!isNum(fraction)) return EMPTY;
  const pct = Number((fraction * 100).toPrecision(12));
  return `${formatNumber(pct, o.decimals !== undefined ? { decimals: o.decimals } : {})}%`;
}

const dtf = new Intl.DateTimeFormat("en-GB", { timeZone: VN_TIMEZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function vnParts(d: Date): { day: string; month: string; year: string; hour: string; minute: string } {
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: p.day!, month: p.month!, year: p.year!, hour: p.hour!, minute: p.minute! };
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `dd/mm/yyyy`. A date-only string (`2026-11-18`) is shown as written, with no timezone shift; a timestamp is shown in Vietnam time. */
export function formatDate(v: string | Date | null | undefined): string {
  if (v === null || v === undefined || v === "") return EMPTY;
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const p = vnParts(d);
  return `${p.day}/${p.month}/${p.year}`;
}

/** `dd/mm/yyyy HH:mm` in Vietnam time. */
export function formatDateTime(v: string | Date | null | undefined): string {
  if (v === null || v === undefined || v === "") return EMPTY;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const p = vnParts(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const DAY = 86_400_000;

/** "5 phút trước" within 7 days, a date and time after that (and for the future). */
export function formatRelative(v: string | Date | null | undefined, now: Date = new Date()): string {
  if (v === null || v === undefined || v === "") return EMPTY;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const diff = now.getTime() - d.getTime();
  if (diff < -60_000 || diff >= 7 * DAY) return formatDateTime(d);
  if (diff < 60_000) return "Vừa xong";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)} giờ trước`;
  return `${Math.floor(diff / DAY)} ngày trước`;
}

/** "0 dòng", "1 dòng", "1.284 dòng". Vietnamese has no plural form, only the number is formatted. */
export function formatCount(n: number, unit: string): string {
  return `${formatNumber(n, { decimals: 0 })} ${unit}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading what people type or paste
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Reads a number typed or pasted by a Vietnamese user or copied from Excel/Sheets:
 * `156,000,000` and `156.000.000` (thousands), `1.234.567,5` and `1,5` (decimal comma), `12.5` (decimal dot), `-3`, `(3)` is not accepted.
 * A lone group such as `1.234` is a decimal (as in the API); `1,234` is thousands (as in the API). Returns null when it is not a number.
 */
export function parseLocaleNumber(text: string): number | null {
  const t = text.trim().replace(/[\s ]/g, "").replace(/₫|đ$/i, "");
  if (t === "") return null;
  let s: string;
  if (/^-?\d+$/.test(t)) s = t;
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) s = t.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(t) || /^-?\d{1,3}(\.\d{3})+,\d+$/.test(t)) s = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+\.\d+$/.test(t)) s = t;
  else if (/^-?\d+,\d{1,2}$/.test(t) || /^-?\d+,\d{4,}$/.test(t)) s = t.replace(",", ".");
  else return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Reads `dd/mm/yyyy`, `d/m/yyyy`, `dd-mm-yyyy` or `yyyy-mm-dd` and returns `yyyy-mm-dd`, or null when it is not a real date. */
export function parseLocaleDate(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Reads `dd/mm/yyyy` or `dd/mm/yyyy HH:mm` (Vietnam time) or an ISO timestamp, and returns an ISO UTC string, or null. */
export function parseLocaleDateTime(text: string): string | null {
  const t = text.trim();
  const m = /^(.+?)(?:\s+(\d{1,2}):(\d{2}))?$/.exec(t);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) {
    const ms = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t.replace(" ", "T") : `${t.replace(" ", "T")}+07:00`);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  if (!m) return null;
  const date = parseLocaleDate(m[1]!);
  if (!date) return null;
  const hh = Number(m[2] ?? 0);
  const mm = Number(m[3] ?? 0);
  if (hh > 23 || mm > 59) return null;
  const ms = Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
