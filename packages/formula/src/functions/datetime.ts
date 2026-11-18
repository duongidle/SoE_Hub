import type { FnDef } from "../context";
import { daysInMonth, dayOfWeek, instantToSerial, parseDateText, serialToYmd, todaySerial, ymdToSerial } from "../dates";
import { err, flatten, toNumber, toText, type Value } from "../types";

const d = (v: Value) => Math.floor(toNumber(v));
const optNum = (v: Value | undefined, dflt: number): number => (v === undefined || v === null ? dflt : toNumber(v));

function addMonths(serial: number, months: number): number {
  const { y, m, d: day } = serialToYmd(serial);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return ymdToSerial(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

function holidaysOf(v: Value | undefined): Set<number> {
  const out = new Set<number>();
  if (v === undefined || v === null) return out;
  for (const x of flatten([v])) if (typeof x === "number") out.add(Math.floor(x));
  return out;
}

const isWorkday = (serial: number, hol: Set<number>) => {
  const w = dayOfWeek(serial);
  return w !== 0 && w !== 6 && !hol.has(serial);
};

function datedif(start: number, end: number, unit: string): number {
  if (start > end) throw err.num("Ngày bắt đầu phải trước ngày kết thúc.");
  const a = serialToYmd(start);
  const b = serialToYmd(end);
  const months = (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0);
  switch (unit) {
    case "D":
      return end - start;
    case "M":
      return months;
    case "Y":
      return Math.floor(months / 12);
    case "YM":
      return months % 12;
    case "MD": {
      // Days since the last whole-month anniversary of the start date (clamped to the month end).
      const anchor = addMonths(start, months);
      return end - anchor;
    }
    case "YD": {
      let anchor = ymdToSerial(b.y, a.m, Math.min(a.d, daysInMonth(b.y, a.m)));
      if (anchor > end) anchor = ymdToSerial(b.y - 1, a.m, Math.min(a.d, daysInMonth(b.y - 1, a.m)));
      return end - anchor;
    }
    default:
      throw err.num("Đơn vị phải là Y, M, D, MD, YM hoặc YD.");
  }
}

function weekNum(serial: number, type: number): number {
  const { y } = serialToYmd(serial);
  if (type === 21) {
    // ISO 8601: weeks start Monday, week 1 contains the first Thursday.
    const wd = (dayOfWeek(serial) + 6) % 7; // Monday = 0
    const thursday = Math.floor(serial) - wd + 3;
    const ty = serialToYmd(thursday).y;
    const jan1 = ymdToSerial(ty, 1, 1);
    return Math.floor((thursday - jan1) / 7) + 1;
  }
  const startDay = type === 2 || type === 11 ? 1 : type === 12 ? 2 : type === 13 ? 3 : type === 14 ? 4 : type === 15 ? 5 : type === 16 ? 6 : 0;
  const jan1 = ymdToSerial(y, 1, 1);
  const offset = (dayOfWeek(jan1) - startDay + 7) % 7;
  return Math.floor((Math.floor(serial) - jan1 + offset) / 7) + 1;
}

export const dateFns: FnDef[] = [
  { name: "TODAY", group: "Ngày", syntax: "TODAY()", description: "Ngày hôm nay (giờ Việt Nam). Cột dùng TODAY() được tính lại lúc 00:05 mỗi ngày.", example: "TODAY()", exampleResult: "2026-11-18", min: 0, max: 0, returns: "date", volatile: "today", impl: (_a, c) => todaySerial(c.now) },
  { name: "NOW", group: "Ngày", syntax: "NOW()", description: "Ngày giờ hiện tại. Cột dùng NOW() được tính lại mỗi giờ.", example: "NOW()", exampleResult: "2026-11-18 09:30", min: 0, max: 0, returns: "datetime", volatile: "now", impl: (_a, c) => instantToSerial(c.now.getTime()) },
  {
    name: "DATE", group: "Ngày", syntax: "DATE(năm, tháng, ngày)", description: "Tạo ngày từ năm, tháng, ngày (tháng 13 = tháng 1 năm sau).", example: "DATE(2026, 11, 18)", exampleResult: "2026-11-18", min: 3, max: 3, returns: "date",
    impl: (a) => {
      const y = d(a[0]!);
      if (y < 0 || y > 9999) throw err.num();
      return ymdToSerial(y < 100 ? 1900 + y : y, d(a[1]!), d(a[2]!));
    },
  },
  {
    name: "DATEVALUE", group: "Ngày", syntax: "DATEVALUE(chữ)", description: "Đổi chữ dạng dd/mm/yyyy hoặc yyyy-mm-dd thành ngày.", example: 'DATEVALUE("18/11/2026")', exampleResult: "2026-11-18", min: 1, max: 1, returns: "date",
    impl: (a) => {
      const s = parseDateText(toText(a[0]!));
      if (s === null) throw err.value("Không đọc được ngày.");
      return s;
    },
  },
  { name: "YEAR", group: "Ngày", syntax: "YEAR(ngày)", description: "Năm của ngày.", example: "YEAR([Ngày chốt])", exampleResult: "2026", min: 1, max: 1, returns: "number", impl: (a) => serialToYmd(toNumber(a[0]!)).y },
  { name: "MONTH", group: "Ngày", syntax: "MONTH(ngày)", description: "Tháng của ngày (1-12).", example: "MONTH([Ngày chốt])", exampleResult: "11", min: 1, max: 1, returns: "number", impl: (a) => serialToYmd(toNumber(a[0]!)).m },
  { name: "DAY", group: "Ngày", syntax: "DAY(ngày)", description: "Ngày trong tháng (1-31).", example: "DAY([Ngày chốt])", exampleResult: "18", min: 1, max: 1, returns: "number", impl: (a) => serialToYmd(toNumber(a[0]!)).d },
  { name: "QUARTER", group: "Ngày", syntax: "QUARTER(ngày)", description: "Quý của ngày (1-4).", example: "QUARTER([Ngày chốt])", exampleResult: "4", min: 1, max: 1, returns: "number", impl: (a) => Math.ceil(serialToYmd(toNumber(a[0]!)).m / 3) },
  {
    name: "WEEKDAY", group: "Ngày", syntax: "WEEKDAY(ngày, [kiểu])", description: "Thứ trong tuần. Kiểu 1 (mặc định): Chủ nhật = 1 ... Thứ bảy = 7; kiểu 2: Thứ hai = 1 ... Chủ nhật = 7; kiểu 3: Thứ hai = 0.", example: "WEEKDAY([Ngày chốt], 2)", exampleResult: "3", min: 1, max: 2, returns: "number",
    impl: (a) => {
      const w = dayOfWeek(toNumber(a[0]!));
      const type = optNum(a[1], 1);
      if (type === 1) return w + 1;
      if (type === 2) return ((w + 6) % 7) + 1;
      if (type === 3) return (w + 6) % 7;
      throw err.num("Kiểu phải là 1, 2 hoặc 3.");
    },
  },
  { name: "WEEKNUM", group: "Ngày", syntax: "WEEKNUM(ngày, [kiểu])", description: "Số tuần trong năm. Kiểu 1: tuần bắt đầu Chủ nhật; kiểu 2: bắt đầu Thứ hai; kiểu 21: tuần ISO.", example: "WEEKNUM([Ngày chốt], 2)", exampleResult: "47", min: 1, max: 2, returns: "number", impl: (a) => weekNum(toNumber(a[0]!), optNum(a[1], 1)) },
  {
    name: "EOMONTH", group: "Ngày", syntax: "EOMONTH(ngày, số_tháng)", description: "Ngày cuối cùng của tháng, cách ngày đã cho một số tháng.", example: "EOMONTH([Ngày chốt], 0)", exampleResult: "2026-11-30", min: 2, max: 2, returns: "date",
    impl: (a) => {
      const s = addMonths(toNumber(a[0]!), d(a[1]!));
      const { y, m } = serialToYmd(s);
      return ymdToSerial(y, m, daysInMonth(y, m));
    },
  },
  { name: "EDATE", group: "Ngày", syntax: "EDATE(ngày, số_tháng)", description: "Ngày cách ngày đã cho một số tháng (cùng ngày trong tháng).", example: "EDATE([Ngày bắt đầu], 3)", exampleResult: "2027-02-18", min: 2, max: 2, returns: "date", impl: (a) => addMonths(toNumber(a[0]!), d(a[1]!)) },
  {
    name: "DATEDIF", group: "Ngày", syntax: "DATEDIF(bắt_đầu, kết_thúc, đơn_vị)", description: "Khoảng cách giữa hai ngày. Đơn vị: \"D\" ngày, \"M\" tháng tròn, \"Y\" năm tròn, \"YM\" tháng lẻ, \"MD\" ngày lẻ, \"YD\" ngày lẻ trong năm.", example: 'DATEDIF([Ngày bắt đầu], [Ngày chốt], "D")', exampleResult: "45", min: 3, max: 3, returns: "number",
    impl: (a) => datedif(Math.floor(toNumber(a[0]!)), Math.floor(toNumber(a[1]!)), toText(a[2]!).toUpperCase()),
  },
  { name: "DAYS", group: "Ngày", syntax: "DAYS(ngày_cuối, ngày_đầu)", description: "Số ngày giữa hai ngày.", example: "DAYS([Ngày chốt], [Ngày bắt đầu])", exampleResult: "45", min: 2, max: 2, returns: "number", impl: (a) => Math.floor(toNumber(a[0]!)) - Math.floor(toNumber(a[1]!)) },
  {
    name: "NETWORKDAYS", group: "Ngày", syntax: "NETWORKDAYS(bắt_đầu, kết_thúc, [ngày_nghỉ])", description: "Số ngày làm việc (bỏ thứ bảy, chủ nhật và các ngày nghỉ) giữa hai ngày, tính cả hai đầu.", example: "NETWORKDAYS([Ngày bắt đầu], [Ngày chốt])", exampleResult: "32", min: 2, max: 3, returns: "number",
    impl: (a) => {
      const s = d(a[0]!);
      const e = d(a[1]!);
      const hol = holidaysOf(a[2]);
      const [lo, hi, sign] = s <= e ? [s, e, 1] : [e, s, -1];
      let n = 0;
      for (let x = lo; x <= hi; x++) if (isWorkday(x, hol)) n++;
      return n * sign;
    },
  },
  {
    name: "WORKDAY", group: "Ngày", syntax: "WORKDAY(bắt_đầu, số_ngày, [ngày_nghỉ])", description: "Ngày làm việc sau (hoặc trước, nếu số âm) một số ngày làm việc.", example: "WORKDAY([Ngày bắt đầu], 10)", exampleResult: "2026-12-02", min: 2, max: 3, returns: "date",
    impl: (a) => {
      let x = d(a[0]!);
      let n = d(a[1]!);
      const hol = holidaysOf(a[2]);
      const step = n >= 0 ? 1 : -1;
      n = Math.abs(n);
      while (n > 0) {
        x += step;
        if (isWorkday(x, hol)) n--;
      }
      return x;
    },
  },
  {
    name: "HOUR", group: "Ngày", syntax: "HOUR(ngày_giờ)", description: "Giờ của ngày giờ (0-23, giờ Việt Nam).", example: "HOUR(NOW())", exampleResult: "9", min: 1, max: 1, returns: "number",
    impl: (a) => {
      const v = toNumber(a[0]!);
      return Math.floor(Math.round((v - Math.floor(v)) * 86400) / 3600) % 24;
    },
  },
  {
    name: "MINUTE", group: "Ngày", syntax: "MINUTE(ngày_giờ)", description: "Phút của ngày giờ.", example: "MINUTE(NOW())", exampleResult: "30", min: 1, max: 1, returns: "number",
    impl: (a) => {
      const v = toNumber(a[0]!);
      return Math.floor((Math.round((v - Math.floor(v)) * 86400) % 3600) / 60);
    },
  },
];
