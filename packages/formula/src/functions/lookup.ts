import { equalityKey, hasWildcard, wildcardToRegex } from "../criteria";
import type { FnDef } from "../context";
import { compareValues, err, FError, flatten, isArray, isBlank, materialize, toArray, toBool, toNumber, type FType, type Scalar, type Value } from "../types";
import { ensureArray, sameOrMixed } from "./util";

const scalarOf = (v: Value): Scalar => {
  const x = materialize(v);
  if (Array.isArray(x)) throw err.value("Cần một giá trị, nhưng nhận một danh sách.");
  return x as Scalar;
};

const optNum = (v: Value | undefined, dflt: number): number => (v === undefined || v === null ? dflt : toNumber(v));

/** Position (0-based) of `needle` in `hay`, or -1. Modes as Excel: 0 exact, -1 exact or next smaller, 1 exact or next larger, 2 wildcard. */
export function findPosition(needle: Scalar, hay: Value[], mode: number, fromEnd: boolean): number {
  if (needle instanceof FError) throw needle;
  const idx = (i: number) => (fromEnd ? hay.length - 1 - i : i);
  if (mode === 0 || mode === 2) {
    if (mode === 2 && typeof needle === "string" && hasWildcard(needle)) {
      const re = wildcardToRegex(needle);
      for (let i = 0; i < hay.length; i++) if (typeof hay[idx(i)] === "string" && re.test(hay[idx(i)] as string)) return idx(i);
      return -1;
    }
    const k = equalityKey(needle);
    for (let i = 0; i < hay.length; i++) {
      const c = hay[idx(i)] as Scalar;
      if (c instanceof FError) continue;
      if (c !== null && equalityKey(c) === k) return idx(i);
    }
    return -1;
  }
  // Nearest value: smaller (mode -1) or larger (mode 1) when no exact match.
  let best = -1;
  for (let i = 0; i < hay.length; i++) {
    const c = hay[idx(i)] as Scalar;
    if (c === null || c instanceof FError) continue;
    if (typeof c !== typeof needle) continue;
    const cmp = compareValues(c, needle);
    if (cmp === 0) return idx(i);
    if (mode === -1 && cmp < 0 && (best < 0 || compareValues(c, hay[best] as Scalar) > 0)) best = idx(i);
    if (mode === 1 && cmp > 0 && (best < 0 || compareValues(c, hay[best] as Scalar) < 0)) best = idx(i);
  }
  return best;
}

const returnsOf = (i: number) => (t: FType[]): FType => t[i] ?? "unknown";

export const lookupFns: FnDef[] = [
  {
    name: "XLOOKUP", group: "Tra cứu", syntax: "XLOOKUP(giá_trị_tìm, cột_tìm, cột_kết_quả, [nếu_không_thấy], [kiểu_khớp], [hướng_tìm])",
    description: "Tìm giá trị trong một cột rồi lấy giá trị cùng dòng ở cột khác. Kiểu khớp: 0 đúng (mặc định), -1 đúng hoặc nhỏ hơn gần nhất, 1 đúng hoặc lớn hơn gần nhất, 2 dùng ký tự đại diện * ?. Hướng tìm: 1 từ đầu (mặc định), -1 từ cuối.",
    example: "XLOOKUP([Mã KH], [Khách hàng].[Mã], [Khách hàng].[Tên], \"Chưa có\")", exampleResult: "Công ty A", min: 3, max: 6, returns: (t) => (t[3] === undefined ? (t[2] ?? "unknown") : sameOrMixed([t[2] ?? "unknown", t[3]])),
    impl: (a) => {
      const needle = scalarOf(a[0]!);
      const hay = ensureArray(a[1]!, "Cột tìm");
      const ret = ensureArray(a[2]!, "Cột kết quả");
      if (hay.length !== ret.length) throw err.value("Cột tìm và cột kết quả phải có cùng số dòng.");
      const mode = optNum(a[4], 0);
      const i = needle === null ? -1 : findPosition(needle, hay, mode, optNum(a[5], 1) < 0);
      if (i < 0) {
        if (a[3] !== undefined && a[3] !== null) return a[3];
        throw err.na("Không tìm thấy.");
      }
      return ret[i] as Value;
    },
  },
  {
    name: "VLOOKUP", group: "Tra cứu", syntax: "VLOOKUP(giá_trị_tìm, cột_tìm, cột_kết_quả, [gần_đúng])",
    description: "Tra cứu theo cột (dạng của hệ thống: nêu thẳng cột tìm và cột kết quả). Gần đúng = FALSE (mặc định) chỉ lấy khớp đúng; TRUE lấy giá trị nhỏ hơn gần nhất.",
    example: "VLOOKUP([Mã KH], [Khách hàng].[Mã], [Khách hàng].[Tên])", exampleResult: "Công ty A", min: 3, max: 4, returns: returnsOf(2),
    impl: (a) => {
      const needle = scalarOf(a[0]!);
      const hay = ensureArray(a[1]!, "Cột tìm");
      const ret = ensureArray(a[2]!, "Cột kết quả");
      if (hay.length !== ret.length) throw err.value("Cột tìm và cột kết quả phải có cùng số dòng.");
      const approx = a[3] !== undefined && a[3] !== null && toBool(a[3]);
      const i = needle === null ? -1 : findPosition(needle, hay, approx ? -1 : 0, false);
      if (i < 0) throw err.na("Không tìm thấy.");
      return ret[i] as Value;
    },
  },
  {
    name: "INDEX", group: "Tra cứu", syntax: "INDEX(cột, số_dòng)", description: "Lấy giá trị ở dòng thứ n của một cột (dòng đầu là 1).", example: "INDEX([Khách hàng].[Tên], 3)", exampleResult: "Công ty C", min: 2, max: 2, returns: returnsOf(0),
    impl: (a) => {
      const arr = ensureArray(a[0]!, "Cột");
      const n = toNumber(a[1]!);
      if (!Number.isInteger(n) || n < 1 || n > arr.length) throw err.ref("Số dòng nằm ngoài cột.");
      return arr[n - 1] as Value;
    },
  },
  {
    name: "MATCH", group: "Tra cứu", syntax: "MATCH(giá_trị_tìm, cột, [kiểu])", description: "Vị trí (từ 1) của giá trị trong cột. Kiểu 0: khớp đúng; 1 (mặc định): lớn nhất không vượt quá; -1: nhỏ nhất không dưới.", example: "MATCH([Mã KH], [Khách hàng].[Mã], 0)", exampleResult: "3", min: 2, max: 3, returns: "number",
    impl: (a) => {
      const needle = scalarOf(a[0]!);
      const arr = ensureArray(a[1]!, "Cột");
      const t = optNum(a[2], 1);
      const i = needle === null ? -1 : findPosition(needle, arr, t === 0 ? 0 : t > 0 ? -1 : 1, false);
      if (i < 0) throw err.na("Không tìm thấy.");
      return i + 1;
    },
  },
  {
    name: "XMATCH", group: "Tra cứu", syntax: "XMATCH(giá_trị_tìm, cột, [kiểu_khớp], [hướng_tìm])", description: "Vị trí (từ 1) của giá trị trong cột; kiểu khớp và hướng tìm như XLOOKUP.", example: "XMATCH([Mã KH], [Khách hàng].[Mã])", exampleResult: "3", min: 2, max: 4, returns: "number",
    impl: (a) => {
      const needle = scalarOf(a[0]!);
      const arr = ensureArray(a[1]!, "Cột");
      const i = needle === null ? -1 : findPosition(needle, arr, optNum(a[2], 0), optNum(a[3], 1) < 0);
      if (i < 0) throw err.na("Không tìm thấy.");
      return i + 1;
    },
  },
  {
    name: "FILTER", group: "Tra cứu", syntax: "FILTER(cột, điều_kiện, [nếu_rỗng])", description: "Giữ các giá trị của cột mà điều kiện (một cột TRUE/FALSE cùng số dòng) đúng. Dùng trong TEXTJOIN, COUNTA, SUM...", example: 'TEXTJOIN(", ", TRUE, FILTER([Deals].[Tên], [Deals].[Trạng thái] = "Won"))', exampleResult: "A, B", min: 2, max: 3, returns: returnsOf(0),
    impl: (a) => {
      const arr = ensureArray(a[0]!, "Cột");
      const inc = ensureArray(a[1]!, "Điều kiện");
      if (arr.length !== inc.length) throw err.value("Điều kiện phải có cùng số dòng với cột.");
      const out = arr.filter((_, i) => {
        const c = inc[i] as Value;
        return !isArray(c) && !(c instanceof FError) && c !== null && toBool(c as Scalar);
      });
      if (out.length === 0) {
        if (a[2] !== undefined) return a[2];
        throw err.na("Không có dòng nào thoả điều kiện.");
      }
      return out;
    },
  },
  {
    name: "UNIQUE", group: "Tra cứu", syntax: "UNIQUE(cột)", description: "Các giá trị khác nhau của cột (bỏ trùng, giữ thứ tự xuất hiện).", example: 'COUNTA(UNIQUE([Deals].[Khách hàng]))', exampleResult: "22", min: 1, max: 1, returns: returnsOf(0),
    impl: (a) => {
      const seen = new Set<string>();
      const out: Value[] = [];
      for (const v of flatten([a[0]!])) {
        const k = equalityKey(v as Scalar);
        if (!seen.has(k)) {
          seen.add(k);
          out.push(v);
        }
      }
      return out;
    },
  },
  {
    name: "SORT", group: "Tra cứu", syntax: "SORT(cột, [thứ_tự])", description: "Sắp xếp các giá trị của cột. Thứ tự 1 (mặc định) tăng dần, -1 giảm dần. Ô trống xếp cuối.", example: 'TEXTJOIN(", ", TRUE, SORT([Deals].[Tên]))', exampleResult: "A, B, C", min: 1, max: 2, returns: returnsOf(0),
    impl: (a) => {
      const desc = optNum(a[1], 1) < 0;
      const items = flatten([a[0]!]);
      const blanks = items.filter((v) => isBlank(v));
      const rest = items.filter((v) => !isBlank(v));
      for (const v of rest) if (v instanceof FError) throw v;
      rest.sort((x, y) => (desc ? -1 : 1) * compareValues(x as Scalar, y as Scalar));
      return [...rest, ...blanks];
    },
  },
];

export const rowInfoFns: FnDef[] = [
  { name: "ROW_ID", group: "Thông tin dòng", syntax: "ROW_ID()", description: "Mã (id) của dòng hiện tại.", example: "ROW_ID()", exampleResult: "0197c0e2-…", min: 0, max: 0, returns: "text", impl: (_a, c) => c.rowInfo().id },
  { name: "ROW_NO", group: "Thông tin dòng", syntax: "ROW_NO()", description: "Số thứ tự của dòng trong bảng (#1, #2...).", example: "ROW_NO()", exampleResult: "1024", min: 0, max: 0, returns: "number", impl: (_a, c) => c.rowInfo().rowNo },
  { name: "CREATED_TIME", group: "Thông tin dòng", syntax: "CREATED_TIME()", description: "Thời điểm dòng được tạo.", example: "CREATED_TIME()", exampleResult: "2026-11-18 09:30", min: 0, max: 0, returns: "datetime", impl: (_a, c) => c.rowInfo().createdAt },
  { name: "MODIFIED_TIME", group: "Thông tin dòng", syntax: "MODIFIED_TIME()", description: "Thời điểm dòng được sửa lần cuối (do người nhập, không tính lần tự tính lại).", example: "MODIFIED_TIME()", exampleResult: "2026-11-18 10:00", min: 0, max: 0, returns: "datetime", impl: (_a, c) => c.rowInfo().modifiedAt },
];

void toArray;
