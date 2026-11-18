import { equalityKey } from "../criteria";
import type { FnDef } from "../context";
import { err, flatten, isBlank, toNumber, type FType, type Scalar, type Value } from "../types";
import { collectNumbers, ensureArray, maskOf, numbersOf, pickWhere } from "./util";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const numRet = (t: FType[]): FType => (t.length > 0 && t.every((x) => x === "date") ? "date" : t.length > 0 && t.every((x) => x === "date" || x === "datetime") ? "datetime" : "number");

function percentile(xs: number[], k: number): number {
  if (xs.length === 0) throw err.num("Không có số nào.");
  if (k < 0 || k > 1) throw err.num("Tỉ lệ phải từ 0 đến 1.");
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * k;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** The pairs after the first argument of the *IFS family: (range, criteria, range, criteria...). */
function pairsOf(args: Value[], from: number): [Value, Value][] {
  const rest = args.slice(from);
  if (rest.length === 0 || rest.length % 2 !== 0) throw err.value("Cần các cặp (cột điều kiện, điều kiện).");
  const out: [Value, Value][] = [];
  for (let i = 0; i < rest.length; i += 2) out.push([rest[i]!, rest[i + 1]!]);
  return out;
}

export const statFns: FnDef[] = [
  { name: "COUNT", group: "Thống kê", syntax: "COUNT(giá_trị1, ...)", description: "Đếm số ô chứa số.", example: "COUNT([Doanh thu])", exampleResult: "12", min: 1, max: 254, returns: "number", impl: (a) => flatten(a).filter((v) => typeof v === "number").length },
  { name: "COUNTA", group: "Thống kê", syntax: "COUNTA(giá_trị1, ...)", description: "Đếm số ô không trống.", example: "COUNTA([Khách hàng].[Tên])", exampleResult: "30", min: 1, max: 254, returns: "number", impl: (a) => flatten(a).filter((v) => v !== null && v !== "").length },
  { name: "COUNTBLANK", group: "Thống kê", syntax: "COUNTBLANK(cột)", description: "Đếm số ô trống.", example: "COUNTBLANK([Khách hàng].[Email])", exampleResult: "4", min: 1, max: 1, returns: "number", impl: (a) => flatten(a).filter(isBlank).length },
  {
    name: "COUNTIF", group: "Thống kê", syntax: "COUNTIF(cột, điều_kiện)", description: "Đếm số dòng thoả điều kiện. Điều kiện kiểu Excel: \"Won\", \">=100\", \"POD*\".", example: 'COUNTIF([Deals].[Trạng thái], "Won")', exampleResult: "18", min: 2, max: 2, returns: "number",
    impl: (a) => maskOf([[a[0]!, a[1]!]]).filter(Boolean).length,
  },
  {
    name: "COUNTIFS", group: "Thống kê", syntax: "COUNTIFS(cột1, đk1, cột2, đk2, ...)", description: "Đếm số dòng thoả mọi điều kiện.", example: 'COUNTIFS([Deals].[Mã deal], [Mã deal], [Deals].[Trạng thái], "Won")', exampleResult: "2", min: 2, max: 254, returns: "number",
    impl: (a) => maskOf(pairsOf(a, 0)).filter(Boolean).length,
  },
  {
    name: "SUMIF", group: "Thống kê", syntax: "SUMIF(cột_điều_kiện, điều_kiện, [cột_cộng])", description: "Cộng các dòng thoả điều kiện (không có cột_cộng thì cộng chính cột điều kiện).", example: 'SUMIF([Deals].[Trạng thái], "Won", [Deals].[Doanh thu])', exampleResult: "5200000000", min: 2, max: 3, returns: "number",
    impl: (a) => {
      const mask = maskOf([[a[0]!, a[1]!]]);
      return sum(numbersOf(pickWhere(ensureArray(a[2] ?? a[0]!), mask)));
    },
  },
  {
    name: "SUMIFS", group: "Thống kê", syntax: "SUMIFS(cột_cộng, cột1, đk1, cột2, đk2, ...)", description: "Cộng các dòng thoả mọi điều kiện.", example: "SUMIFS([Thanh toán].[Số tiền], [Thanh toán].[Mã deal], [Mã deal])", exampleResult: "300000000", min: 3, max: 255, returns: "number",
    impl: (a) => sum(numbersOf(pickWhere(ensureArray(a[0]!), maskOf(pairsOf(a, 1))))),
  },
  {
    name: "AVERAGE", group: "Thống kê", syntax: "AVERAGE(số1, ...)", description: "Trung bình cộng của các số.", example: "AVERAGE([Doanh thu])", exampleResult: "250000000", min: 1, max: 254, returns: "number",
    impl: (a) => {
      const xs = collectNumbers(a);
      if (xs.length === 0) throw err.div0();
      return sum(xs) / xs.length;
    },
  },
  {
    name: "AVERAGEIF", group: "Thống kê", syntax: "AVERAGEIF(cột_điều_kiện, điều_kiện, [cột_tính])", description: "Trung bình các dòng thoả điều kiện.", example: 'AVERAGEIF([Deals].[Trạng thái], "Won", [Deals].[Doanh thu])', exampleResult: "280000000", min: 2, max: 3, returns: "number",
    impl: (a) => {
      const xs = numbersOf(pickWhere(ensureArray(a[2] ?? a[0]!), maskOf([[a[0]!, a[1]!]])));
      if (xs.length === 0) throw err.div0();
      return sum(xs) / xs.length;
    },
  },
  {
    name: "AVERAGEIFS", group: "Thống kê", syntax: "AVERAGEIFS(cột_tính, cột1, đk1, ...)", description: "Trung bình các dòng thoả mọi điều kiện.", example: 'AVERAGEIFS([Deals].[Doanh thu], [Deals].[Loại], "POD")', exampleResult: "210000000", min: 3, max: 255, returns: "number",
    impl: (a) => {
      const xs = numbersOf(pickWhere(ensureArray(a[0]!), maskOf(pairsOf(a, 1))));
      if (xs.length === 0) throw err.div0();
      return sum(xs) / xs.length;
    },
  },
  {
    name: "MIN", group: "Thống kê", syntax: "MIN(số1, ...)", description: "Số nhỏ nhất (ngày nhỏ nhất = ngày sớm nhất).", example: "MIN([Ngày bắt đầu])", exampleResult: "2026-01-05", min: 1, max: 254, returns: numRet,
    impl: (a) => {
      const xs = collectNumbers(a);
      return xs.length ? xs.reduce((m, x) => (x < m ? x : m)) : 0;
    },
  },
  {
    name: "MAX", group: "Thống kê", syntax: "MAX(số1, ...)", description: "Số lớn nhất (ngày lớn nhất = ngày muộn nhất).", example: "MAX([Doanh thu])", exampleResult: "900000000", min: 1, max: 254, returns: numRet,
    impl: (a) => {
      const xs = collectNumbers(a);
      return xs.length ? xs.reduce((m, x) => (x > m ? x : m)) : 0;
    },
  },
  {
    name: "MINIFS", group: "Thống kê", syntax: "MINIFS(cột_tính, cột1, đk1, ...)", description: "Giá trị nhỏ nhất trong các dòng thoả mọi điều kiện.", example: "MINIFS([Thanh toán].[Ngày], [Thanh toán].[Mã deal], [Mã deal])", exampleResult: "2026-02-01", min: 3, max: 255, returns: (t) => numRet(t.slice(0, 1)),
    impl: (a) => {
      const xs = numbersOf(pickWhere(ensureArray(a[0]!), maskOf(pairsOf(a, 1))));
      return xs.length ? xs.reduce((m, x) => (x < m ? x : m)) : 0;
    },
  },
  {
    name: "MAXIFS", group: "Thống kê", syntax: "MAXIFS(cột_tính, cột1, đk1, ...)", description: "Giá trị lớn nhất trong các dòng thoả mọi điều kiện.", example: "MAXIFS([Thanh toán].[Ngày], [Thanh toán].[Mã deal], [Mã deal])", exampleResult: "2026-05-01", min: 3, max: 255, returns: (t) => numRet(t.slice(0, 1)),
    impl: (a) => {
      const xs = numbersOf(pickWhere(ensureArray(a[0]!), maskOf(pairsOf(a, 1))));
      return xs.length ? xs.reduce((m, x) => (x > m ? x : m)) : 0;
    },
  },
  {
    name: "MEDIAN", group: "Thống kê", syntax: "MEDIAN(số1, ...)", description: "Số ở giữa khi sắp xếp.", example: "MEDIAN([Doanh thu])", exampleResult: "200000000", min: 1, max: 254, returns: "number",
    impl: (a) => {
      const xs = collectNumbers(a);
      if (xs.length === 0) throw err.num();
      return percentile(xs, 0.5);
    },
  },
  { name: "PERCENTILE", group: "Thống kê", syntax: "PERCENTILE(cột, k)", description: "Phân vị thứ k (k từ 0 đến 1).", example: "PERCENTILE([Doanh thu], 0.75)", exampleResult: "350000000", min: 2, max: 2, returns: "number", impl: (a) => percentile(numbersOf(a[0]!), toNumber(a[1]!)) },
  {
    name: "QUARTILE", group: "Thống kê", syntax: "QUARTILE(cột, phần_tư)", description: "Tứ phân vị: 0 = nhỏ nhất, 1, 2 = trung vị, 3, 4 = lớn nhất.", example: "QUARTILE([Doanh thu], 3)", exampleResult: "350000000", min: 2, max: 2, returns: "number",
    impl: (a) => {
      const q = toNumber(a[1]!);
      if (!Number.isInteger(q) || q < 0 || q > 4) throw err.num("Phần tư phải là 0 đến 4.");
      return percentile(numbersOf(a[0]!), q / 4);
    },
  },
  {
    name: "STDEV", group: "Thống kê", syntax: "STDEV(số1, ...)", description: "Độ lệch chuẩn mẫu.", example: "STDEV([Doanh thu])", exampleResult: "120000000", min: 1, max: 254, returns: "number",
    impl: (a) => {
      const xs = collectNumbers(a);
      if (xs.length < 2) throw err.div0();
      const m = sum(xs) / xs.length;
      return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
    },
  },
  {
    name: "MODE", group: "Thống kê", syntax: "MODE(số1, ...)", description: "Số xuất hiện nhiều nhất (có nhiều số bằng nhau thì lấy số xuất hiện trước).", example: "MODE([Số sao])", exampleResult: "4", min: 1, max: 254, returns: "number",
    impl: (a) => {
      const xs = collectNumbers(a);
      const counts = new Map<number, number>();
      for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
      let best: number | null = null;
      let bc = 1;
      for (const x of xs) {
        const c = counts.get(x)!;
        if (c > bc) {
          best = x;
          bc = c;
        }
      }
      if (best === null) throw err.na("Không có số nào lặp lại.");
      return best;
    },
  },
  {
    name: "RANK", group: "Thống kê", syntax: "RANK(số, cột, [thứ_tự])", description: "Thứ hạng của số trong cột (thứ tự 0 = từ lớn đến nhỏ, mặc định).", example: "RANK([Doanh thu], [Deals].[Doanh thu])", exampleResult: "3", min: 2, max: 3, returns: "number",
    impl: (a) => {
      const x = toNumber(a[0]!);
      const xs = numbersOf(a[1]!);
      if (!xs.includes(x)) throw err.na();
      const asc = a[2] !== undefined && a[2] !== null && toNumber(a[2]) !== 0;
      return 1 + xs.filter((y) => (asc ? y < x : y > x)).length;
    },
  },
  {
    name: "LARGE", group: "Thống kê", syntax: "LARGE(cột, k)", description: "Số lớn thứ k.", example: "LARGE([Doanh thu], 2)", exampleResult: "800000000", min: 2, max: 2, returns: "number",
    impl: (a) => {
      const xs = numbersOf(a[0]!).sort((x, y) => y - x);
      const k = toNumber(a[1]!);
      if (!Number.isInteger(k) || k < 1 || k > xs.length) throw err.num();
      return xs[k - 1]!;
    },
  },
  {
    name: "SMALL", group: "Thống kê", syntax: "SMALL(cột, k)", description: "Số nhỏ thứ k.", example: "SMALL([Doanh thu], 1)", exampleResult: "10000000", min: 2, max: 2, returns: "number",
    impl: (a) => {
      const xs = numbersOf(a[0]!).sort((x, y) => x - y);
      const k = toNumber(a[1]!);
      if (!Number.isInteger(k) || k < 1 || k > xs.length) throw err.num();
      return xs[k - 1]!;
    },
  },
  {
    name: "COUNTUNIQUE", group: "Thống kê", syntax: "COUNTUNIQUE(giá_trị1, ...)", description: "Đếm số giá trị khác nhau (bỏ ô trống).", example: "COUNTUNIQUE([Deals].[Khách hàng])", exampleResult: "22", min: 1, max: 254, returns: "number",
    impl: (a) => new Set(flatten(a).filter((v) => v !== null && v !== "").map((v) => equalityKey(v as Scalar))).size,
  },
];
