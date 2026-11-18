import { hasWildcard, wildcardToRegex } from "../criteria";
import type { FnDef } from "../context";
import { serialToYmd, dayOfWeek } from "../dates";
import { err, flatten, numberToText, parseNumberText, toNumber, toText, type Value } from "../types";

const optNum = (v: Value | undefined, dflt: number): number => (v === undefined || v === null ? dflt : toNumber(v));
const MAX_PATTERN = 300;
const MAX_REGEX_INPUT = 100_000;

function regexOf(pattern: string, flags = ""): RegExp {
  if (pattern.length > MAX_PATTERN) throw err.value("Biểu thức chính quy quá dài.");
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw err.value("Biểu thức chính quy không hợp lệ.");
  }
}

function checkInput(s: string): string {
  if (s.length > MAX_REGEX_INPUT) throw err.value("Chuỗi quá dài để tìm bằng biểu thức chính quy.");
  return s;
}

const MONTHS = ["", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/** `TEXT(value, format)`: numbers (`0`, `0.00`, `#,##0`, `0%`) and dates (`dd/mm/yyyy`, `yyyy-mm-dd`, `hh:mm`). */
export function formatText(value: number, fmt: string): string {
  const f = fmt;
  if (/yy|dd|mm|hh|ss/i.test(f.replace(/"[^"]*"/g, ""))) {
    const frac = value - Math.floor(value);
    const secs = Math.round(frac * 86400);
    const hh = Math.floor(secs / 3600) % 24;
    const mi = Math.floor((secs % 3600) / 60);
    const ss = secs % 60;
    const { y, m, d } = serialToYmd(value);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return f.replace(/yyyy|yy|mm|m|dd|d|hh|h|ss|s|"[^"]*"/gi, (tok, offset: number) => {
      const t = tok.toLowerCase();
      if (tok.startsWith('"')) return tok.slice(1, -1);
      if (t === "yyyy") return String(y).padStart(4, "0");
      if (t === "yy") return p2(y % 100);
      if (t === "dd") return p2(d);
      if (t === "d") return String(d);
      if (t === "hh") return p2(hh);
      if (t === "h") return String(hh);
      if (t === "ss") return p2(ss);
      if (t === "s") return String(ss);
      // "mm" / "m": minutes right after hours (or before seconds), otherwise month.
      const before = f.slice(0, offset).toLowerCase();
      const after = f.slice(offset + tok.length).toLowerCase();
      const isMinute = /h[^a-z]*$/.test(before) || /^[^a-z]*s/.test(after);
      if (isMinute) return t === "mm" ? p2(mi) : String(mi);
      return t === "mm" ? MONTHS[m]! : String(m);
    });
  }
  const pct = f.includes("%");
  let v = pct ? value * 100 : value;
  const decimals = (/\.([0#]+)/.exec(f)?.[1] ?? "").length;
  const thousands = f.includes(",");
  const neg = v < 0;
  v = Math.abs(v);
  let s = v.toFixed(decimals);
  const optionalDecimals = /\.([#]+)/.exec(f)?.[1]?.length ?? 0;
  if (optionalDecimals > 0 && s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  const [intRaw, dec] = s.split(".") as [string, string | undefined];
  let int = intRaw;
  const minInt = (f.split(".")[0]!.match(/0/g) ?? []).length;
  int = int.padStart(minInt, "0");
  if (thousands) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const lit = f.replace(/[#0.,%]/g, "");
  return (neg ? "-" : "") + int + (dec ? "." + dec : "") + (pct ? "%" : "") + lit;
}

export const textFns: FnDef[] = [
  { name: "CONCAT", group: "Chuỗi", syntax: "CONCAT(chữ1, chữ2, ...)", description: "Nối các chữ lại với nhau.", example: 'CONCAT([Họ], " ", [Tên])', exampleResult: "Nguyễn An", min: 1, max: 254, returns: "text", impl: (a) => flatten(a).map(toText).join("") },
  { name: "CONCATENATE", group: "Chuỗi", syntax: "CONCATENATE(chữ1, chữ2, ...)", description: "Nối các chữ lại với nhau (giống CONCAT).", example: 'CONCATENATE("PO-", [Mã])', exampleResult: "PO-123", min: 1, max: 254, returns: "text", impl: (a) => flatten(a).map(toText).join("") },
  {
    name: "TEXTJOIN", group: "Chuỗi", syntax: "TEXTJOIN(ngăn_cách, bỏ_trống, chữ1, ...)", description: "Nối nhiều chữ hoặc cả một cột, có ký tự ngăn cách. bỏ_trống = TRUE thì bỏ các ô trống.", example: 'TEXTJOIN(", ", TRUE, [Deals].[Khách hàng])', exampleResult: "A, B, C", min: 3, max: 254, returns: "text",
    impl: (a) => {
      const sep = toText(a[0]!);
      const skip = a[1] === null || a[1] === undefined ? true : toText(a[1]).toUpperCase() !== "FALSE";
      let items = flatten(a.slice(2));
      if (skip) items = items.filter((v) => v !== null && v !== "");
      return items.map(toText).join(sep);
    },
  },
  {
    name: "LEFT", group: "Chuỗi", syntax: "LEFT(chữ, [số_ký_tự])", description: "Lấy các ký tự đầu của chữ.", example: 'LEFT("POD Express", 3)', exampleResult: "POD", min: 1, max: 2, returns: "text",
    impl: (a) => {
      const n = optNum(a[1], 1);
      if (n < 0) throw err.value();
      return Array.from(toText(a[0]!)).slice(0, n).join("");
    },
  },
  {
    name: "RIGHT", group: "Chuỗi", syntax: "RIGHT(chữ, [số_ký_tự])", description: "Lấy các ký tự cuối của chữ.", example: 'RIGHT("PO-123", 3)', exampleResult: "123", min: 1, max: 2, returns: "text",
    impl: (a) => {
      const n = optNum(a[1], 1);
      if (n < 0) throw err.value();
      const chars = Array.from(toText(a[0]!));
      return n === 0 ? "" : chars.slice(-n).join("");
    },
  },
  {
    name: "MID", group: "Chuỗi", syntax: "MID(chữ, bắt_đầu, số_ký_tự)", description: "Lấy một đoạn chữ, vị trí đầu tiên là 1.", example: 'MID("PO-123-A", 4, 3)', exampleResult: "123", min: 3, max: 3, returns: "text",
    impl: (a) => {
      const start = toNumber(a[1]!);
      const len = toNumber(a[2]!);
      if (start < 1 || len < 0) throw err.value();
      return Array.from(toText(a[0]!)).slice(start - 1, start - 1 + len).join("");
    },
  },
  { name: "LEN", group: "Chuỗi", syntax: "LEN(chữ)", description: "Số ký tự của chữ.", example: 'LEN("Base")', exampleResult: "4", min: 1, max: 1, returns: "number", impl: (a) => Array.from(toText(a[0]!)).length },
  { name: "LOWER", group: "Chuỗi", syntax: "LOWER(chữ)", description: "Đổi thành chữ thường.", example: 'LOWER("POD")', exampleResult: "pod", min: 1, max: 1, returns: "text", impl: (a) => toText(a[0]!).toLowerCase() },
  { name: "UPPER", group: "Chuỗi", syntax: "UPPER(chữ)", description: "Đổi thành chữ HOA.", example: 'UPPER("pod")', exampleResult: "POD", min: 1, max: 1, returns: "text", impl: (a) => toText(a[0]!).toUpperCase() },
  {
    name: "PROPER", group: "Chuỗi", syntax: "PROPER(chữ)", description: "Viết hoa chữ cái đầu mỗi từ.", example: 'PROPER("nguyễn văn an")', exampleResult: "Nguyễn Văn An", min: 1, max: 1, returns: "text",
    impl: (a) => toText(a[0]!).toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase()),
  },
  { name: "TRIM", group: "Chuỗi", syntax: "TRIM(chữ)", description: "Bỏ khoảng trắng thừa ở đầu, cuối và giữa chữ.", example: 'TRIM("  A   B ")', exampleResult: "A B", min: 1, max: 1, returns: "text", impl: (a) => toText(a[0]!).trim().replace(/\s+/g, " ") },
  {
    name: "SUBSTITUTE", group: "Chuỗi", syntax: "SUBSTITUTE(chữ, tìm, thay, [lần_thứ])", description: "Thay chữ cũ bằng chữ mới (phân biệt hoa thường). Có lần_thứ thì chỉ thay lần đó.", example: 'SUBSTITUTE("a-b-c", "-", "/")', exampleResult: "a/b/c", min: 3, max: 4, returns: "text",
    impl: (a) => {
      const text = toText(a[0]!);
      const old = toText(a[1]!);
      const nw = toText(a[2]!);
      if (old === "") return text;
      if (a[3] === undefined || a[3] === null) return text.split(old).join(nw);
      const nth = toNumber(a[3]);
      if (nth < 1) throw err.value();
      let idx = -1;
      for (let i = 0; i < nth; i++) {
        idx = text.indexOf(old, idx + 1);
        if (idx < 0) return text;
      }
      return text.slice(0, idx) + nw + text.slice(idx + old.length);
    },
  },
  {
    name: "REPLACE", group: "Chuỗi", syntax: "REPLACE(chữ, bắt_đầu, số_ký_tự, chữ_mới)", description: "Thay một đoạn chữ theo vị trí.", example: 'REPLACE("PO-123", 1, 2, "SO")', exampleResult: "SO-123", min: 4, max: 4, returns: "text",
    impl: (a) => {
      const chars = Array.from(toText(a[0]!));
      const start = toNumber(a[1]!);
      const len = toNumber(a[2]!);
      if (start < 1 || len < 0) throw err.value();
      return chars.slice(0, start - 1).join("") + toText(a[3]!) + chars.slice(start - 1 + len).join("");
    },
  },
  {
    name: "FIND", group: "Chuỗi", syntax: "FIND(tìm, trong_chữ, [từ_vị_trí])", description: "Vị trí của chữ cần tìm (phân biệt hoa thường). Không thấy thì #VALUE!.", example: 'FIND("-", "PO-123")', exampleResult: "3", min: 2, max: 3, returns: "number",
    impl: (a) => {
      const start = optNum(a[2], 1);
      const i = toText(a[1]!).indexOf(toText(a[0]!), start - 1);
      if (start < 1 || i < 0) throw err.value("Không tìm thấy.");
      return i + 1;
    },
  },
  {
    name: "SEARCH", group: "Chuỗi", syntax: "SEARCH(tìm, trong_chữ, [từ_vị_trí])", description: "Như FIND nhưng không phân biệt hoa thường, hiểu ký tự đại diện * và ?.", example: 'SEARCH("pod", "Loại POD")', exampleResult: "6", min: 2, max: 3, returns: "number",
    impl: (a) => {
      const start = optNum(a[2], 1);
      const needle = toText(a[0]!);
      const hay = toText(a[1]!);
      if (start < 1) throw err.value();
      const re = hasWildcard(needle) ? new RegExp(wildcardToRegex(needle).source.slice(1, -1), "i") : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const m = re.exec(hay.slice(start - 1));
      if (!m) throw err.value("Không tìm thấy.");
      return m.index + start;
    },
  },
  {
    name: "TEXT", group: "Chuỗi", syntax: "TEXT(giá_trị, định_dạng)", description: "Đổi số hoặc ngày thành chữ theo định dạng: \"dd/mm/yyyy\", \"0.00\", \"#,##0\", \"0%\".", example: 'TEXT([Ngày chốt], "dd/mm/yyyy")', exampleResult: "18/11/2026", min: 2, max: 2, returns: "text",
    impl: (a) => formatText(toNumber(a[0]!), toText(a[1]!)),
  },
  {
    name: "VALUE", group: "Chuỗi", syntax: "VALUE(chữ)", description: "Đổi chữ dạng số thành số.", example: 'VALUE("12.5")', exampleResult: "12.5", min: 1, max: 1, returns: "number",
    impl: (a) => {
      const t = toText(a[0]!).replace(/,/g, "");
      const n = parseNumberText(t);
      if (n === null) throw err.value(`"${t.slice(0, 30)}" không phải là số.`);
      return n;
    },
  },
  { name: "REPT", group: "Chuỗi", syntax: "REPT(chữ, số_lần)", description: "Lặp chữ nhiều lần.", example: 'REPT("*", 3)', exampleResult: "***", min: 2, max: 2, returns: "text", impl: (a) => { const n = toNumber(a[1]!); if (n < 0 || n > 10000) throw err.value(); return toText(a[0]!).repeat(Math.floor(n)); } },
  { name: "EXACT", group: "Chuỗi", syntax: "EXACT(chữ1, chữ2)", description: "TRUE khi hai chữ giống hệt nhau (phân biệt hoa thường).", example: 'EXACT("a", "A")', exampleResult: "FALSE", min: 2, max: 2, returns: "boolean", impl: (a) => toText(a[0]!) === toText(a[1]!) },
  {
    name: "REGEXMATCH", group: "Chuỗi", syntax: "REGEXMATCH(chữ, biểu_thức)", description: "TRUE khi chữ khớp biểu thức chính quy (không phân biệt hoa thường).", example: 'REGEXMATCH([Mã], "^PO-[0-9]+$")', exampleResult: "TRUE", min: 2, max: 2, returns: "boolean",
    impl: (a) => regexOf(toText(a[1]!), "i").test(checkInput(toText(a[0]!))),
  },
  {
    name: "REGEXEXTRACT", group: "Chuỗi", syntax: "REGEXEXTRACT(chữ, biểu_thức)", description: "Lấy đoạn đầu tiên khớp biểu thức (nếu có nhóm ( ) thì lấy nhóm 1). Không khớp thì #N/A.", example: 'REGEXEXTRACT("PO-123", "[0-9]+")', exampleResult: "123", min: 2, max: 2, returns: "text",
    impl: (a) => {
      const m = regexOf(toText(a[1]!), "i").exec(checkInput(toText(a[0]!)));
      if (!m) throw err.na("Không khớp.");
      return m[1] ?? m[0];
    },
  },
  {
    name: "REGEXREPLACE", group: "Chuỗi", syntax: "REGEXREPLACE(chữ, biểu_thức, thay_bằng)", description: "Thay mọi đoạn khớp biểu thức bằng chữ khác ($1 là nhóm 1).", example: 'REGEXREPLACE("a1b22", "[0-9]+", "#")', exampleResult: "a#b#", min: 3, max: 3, returns: "text",
    impl: (a) => checkInput(toText(a[0]!)).replace(regexOf(toText(a[1]!), "gi"), toText(a[2]!)),
  },
];

void numberToText;
void dayOfWeek;
