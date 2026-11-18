import type { FnDef } from "../context";
import { compareValues, err, FError, flatten, isArray, materialize, toBool, toNumber, type Value } from "../types";
import { collectNumbers, ensureArray, round, sameOrMixed } from "./util";


/** Logic functions: arguments are evaluated on demand so the untaken branch never runs (and never fails). */
export const logicFns: FnDef[] = [
  {
    name: "IF", group: "Logic", syntax: "IF(điều_kiện, nếu_đúng, [nếu_sai])", description: "Trả về giá trị này nếu điều kiện đúng, giá trị kia nếu sai.",
    example: 'IF([Doanh thu] > 1000000000, "Trên 1 tỷ", "Dưới 1 tỷ")', exampleResult: "Trên 1 tỷ", min: 2, max: 3, returns: (t) => sameOrMixed([t[1] ?? "unknown", t[2] ?? "boolean"]),
    lazy: (n, ev) => {
      const c = ev(n[0]!);
      if (isArray(c)) {
        const cs = flatten([c]);
        return cs.map((x) => (toBool(x) ? ev(n[1]!) : n[2] ? ev(n[2]) : false));
      }
      if (toBool(c)) return ev(n[1]!);
      return n[2] ? ev(n[2]) : false;
    },
  },
  {
    name: "IFS", group: "Logic", syntax: "IFS(đk1, giá_trị1, đk2, giá_trị2, ...)", description: "Kiểm tra lần lượt các điều kiện, trả về giá trị của điều kiện đúng đầu tiên. Không có điều kiện nào đúng thì #N/A.",
    example: 'IFS([Doanh thu] > 1000000000, ">1 tỷ", [Doanh thu] > 0, "<1 tỷ")', exampleResult: ">1 tỷ", min: 2, max: 254,
    returns: (t) => sameOrMixed(t.filter((_, i) => i % 2 === 1)),
    lazy: (n, ev) => {
      if (n.length % 2 !== 0) throw err.na("IFS cần các cặp điều kiện và giá trị.");
      for (let i = 0; i < n.length; i += 2) if (toBool(ev(n[i]!))) return ev(n[i + 1]!);
      throw err.na("Không có điều kiện nào đúng.");
    },
  },
  {
    name: "SWITCH", group: "Logic", syntax: "SWITCH(giá_trị, khớp1, kết_quả1, ..., [mặc_định])", description: "So giá trị với các mục khớp, trả về kết quả của mục đầu tiên trùng; không trùng thì dùng mặc định.",
    example: 'SWITCH([Trạng thái], "Won", 1, "Lost", 0, -1)', exampleResult: "1", min: 3, max: 254,
    returns: (t) => sameOrMixed(t.slice(1).filter((_, i, a) => (a.length % 2 === 1 ? i % 2 === 1 || i === a.length - 1 : i % 2 === 1))),
    lazy: (n, ev) => {
      const v = materialize(ev(n[0]!));
      if (v instanceof FError) throw v;
      const rest = n.slice(1);
      const hasDefault = rest.length % 2 === 1;
      const pairs = hasDefault ? rest.length - 1 : rest.length;
      for (let i = 0; i < pairs; i += 2) {
        const m = materialize(ev(rest[i]!));
        if (m instanceof FError) throw m;
        if (!isArray(m) && !isArray(v) && compareValues(v as never, m as never) === 0) return ev(rest[i + 1]!);
      }
      if (hasDefault) return ev(rest[rest.length - 1]!);
      throw err.na("Không có giá trị nào khớp.");
    },
  },
  {
    name: "AND", group: "Logic", syntax: "AND(đk1, đk2, ...)", description: "TRUE khi mọi điều kiện đều đúng.", example: "AND([Doanh thu] > 0, [Trạng thái] = \"Won\")", exampleResult: "TRUE", min: 1, max: 254, returns: "boolean",
    impl: (a) => flatten(a).every((v) => toBool(v)),
  },
  {
    name: "OR", group: "Logic", syntax: "OR(đk1, đk2, ...)", description: "TRUE khi có ít nhất một điều kiện đúng.", example: 'OR([Trạng thái] = "Won", [Trạng thái] = "Pending")', exampleResult: "TRUE", min: 1, max: 254, returns: "boolean",
    impl: (a) => flatten(a).some((v) => toBool(v)),
  },
  { name: "NOT", group: "Logic", syntax: "NOT(điều_kiện)", description: "Đảo TRUE thành FALSE và ngược lại.", example: "NOT([Đã đóng])", exampleResult: "FALSE", min: 1, max: 1, returns: "boolean", impl: (a) => !toBool(a[0]!) },
  {
    name: "XOR", group: "Logic", syntax: "XOR(đk1, đk2, ...)", description: "TRUE khi số điều kiện đúng là số lẻ.", example: "XOR(TRUE, FALSE)", exampleResult: "TRUE", min: 1, max: 254, returns: "boolean",
    impl: (a) => flatten(a).filter((v) => toBool(v)).length % 2 === 1,
  },
  {
    name: "IFERROR", group: "Logic", syntax: "IFERROR(giá_trị, nếu_lỗi)", description: "Nếu giá trị bị lỗi (#DIV/0!, #N/A...) thì trả về giá trị thay thế.", example: 'IFERROR([Doanh thu] / [Số deal], 0)', exampleResult: "0", min: 2, max: 2, returns: (t) => sameOrMixed([t[0]!, t[1]!]),
    lazy: (n, ev) => {
      try {
        const v = materialize(ev(n[0]!));
        if (v instanceof FError) return ev(n[1]!);
        if (Array.isArray(v) && v.some((x) => x instanceof FError)) {
          const fallback = materialize(ev(n[1]!));
          return v.map((x) => (x instanceof FError ? (isArray(fallback) ? null : fallback) : x));
        }
        return v;
      } catch (e) {
        if (e instanceof FError) return ev(n[1]!);
        throw e;
      }
    },
  },
  {
    name: "IFNA", group: "Logic", syntax: "IFNA(giá_trị, nếu_N/A)", description: "Chỉ thay thế lỗi #N/A (không tìm thấy), các lỗi khác vẫn giữ nguyên.", example: 'IFNA(XLOOKUP([Mã KH], [Khách hàng].[Mã], [Khách hàng].[Tên]), "Chưa có")', exampleResult: "Chưa có", min: 2, max: 2, returns: (t) => sameOrMixed([t[0]!, t[1]!]),
    lazy: (n, ev) => {
      try {
        const v = materialize(ev(n[0]!));
        if (v instanceof FError && v.code === "#N/A") return ev(n[1]!);
        return v;
      } catch (e) {
        if (e instanceof FError && e.code === "#N/A") return ev(n[1]!);
        throw e;
      }
    },
  },
  {
    name: "ISBLANK", group: "Logic", syntax: "ISBLANK(giá_trị)", description: "TRUE khi ô trống.", example: "ISBLANK([Ngày chốt])", exampleResult: "TRUE", min: 1, max: 1, returns: "boolean",
    lazy: (n, ev) => {
      try {
        return materialize(ev(n[0]!)) === null;
      } catch (e) {
        if (e instanceof FError) return false;
        throw e;
      }
    },
  },
  {
    name: "ISNUMBER", group: "Logic", syntax: "ISNUMBER(giá_trị)", description: "TRUE khi giá trị là số (kể cả ngày).", example: "ISNUMBER([Doanh thu])", exampleResult: "TRUE", min: 1, max: 1, returns: "boolean",
    lazy: (n, ev) => {
      try {
        return typeof materialize(ev(n[0]!)) === "number";
      } catch (e) {
        if (e instanceof FError) return false;
        throw e;
      }
    },
  },
  {
    name: "ISTEXT", group: "Logic", syntax: "ISTEXT(giá_trị)", description: "TRUE khi giá trị là chữ.", example: "ISTEXT([Tên khách])", exampleResult: "TRUE", min: 1, max: 1, returns: "boolean",
    lazy: (n, ev) => {
      try {
        return typeof materialize(ev(n[0]!)) === "string";
      } catch (e) {
        if (e instanceof FError) return false;
        throw e;
      }
    },
  },
  {
    name: "ISERROR", group: "Logic", syntax: "ISERROR(giá_trị)", description: "TRUE khi giá trị là một lỗi.", example: "ISERROR([Doanh thu] / [Số deal])", exampleResult: "FALSE", min: 1, max: 1, returns: "boolean",
    lazy: (n, ev) => {
      try {
        return materialize(ev(n[0]!)) instanceof FError;
      } catch (e) {
        if (e instanceof FError) return true;
        throw e;
      }
    },
  },
];

export const mathFns: FnDef[] = [
  { name: "SUM", group: "Toán", syntax: "SUM(số1, số2, ...)", description: "Cộng các số (cột, danh sách hoặc giá trị lẻ).", example: "SUM([Thanh toán].[Số tiền])", exampleResult: "1500000", min: 1, max: 254, returns: "number", impl: (a) => collectNumbers(a).reduce((x, y) => x + y, 0) },
  { name: "PRODUCT", group: "Toán", syntax: "PRODUCT(số1, số2, ...)", description: "Nhân các số với nhau.", example: "PRODUCT(2, 3, 4)", exampleResult: "24", min: 1, max: 254, returns: "number", impl: (a) => collectNumbers(a).reduce((x, y) => x * y, 1) },
  {
    name: "SUMPRODUCT", group: "Toán", syntax: "SUMPRODUCT(cột1, cột2, ...)", description: "Nhân từng cặp giá trị của các cột rồi cộng lại.", example: "SUMPRODUCT([Đơn giá], [Số lượng])", exampleResult: "5000", min: 1, max: 30, returns: "number",
    impl: (a) => {
      const cols = a.map((x) => ensureArray(x));
      const n = cols[0]!.length;
      if (cols.some((c) => c.length !== n)) throw err.value("Các cột phải có cùng số dòng.");
      let total = 0;
      for (let i = 0; i < n; i++) {
        let p = 1;
        for (const c of cols) {
          const v = c[i] as Value;
          if (v instanceof FError) throw v;
          p *= typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0;
        }
        total += p;
      }
      return total;
    },
  },
  { name: "ROUND", group: "Toán", syntax: "ROUND(số, [số_chữ_số])", description: "Làm tròn số đến số chữ số thập phân cho trước (âm = làm tròn hàng chục, trăm...).", example: "ROUND(1234.567, 1)", exampleResult: "1234.6", min: 1, max: 2, returns: "number", impl: (a) => round(toNumber(a[0]!), a[1] === undefined || a[1] === null ? 0 : toNumber(a[1]), "half") },
  { name: "ROUNDUP", group: "Toán", syntax: "ROUNDUP(số, [số_chữ_số])", description: "Làm tròn lên (xa số 0).", example: "ROUNDUP(3.2, 0)", exampleResult: "4", min: 1, max: 2, returns: "number", impl: (a) => round(toNumber(a[0]!), a[1] === undefined || a[1] === null ? 0 : toNumber(a[1]), "up") },
  { name: "ROUNDDOWN", group: "Toán", syntax: "ROUNDDOWN(số, [số_chữ_số])", description: "Làm tròn xuống (về phía số 0).", example: "ROUNDDOWN(3.9, 0)", exampleResult: "3", min: 1, max: 2, returns: "number", impl: (a) => round(toNumber(a[0]!), a[1] === undefined || a[1] === null ? 0 : toNumber(a[1]), "down") },
  { name: "INT", group: "Toán", syntax: "INT(số)", description: "Làm tròn xuống số nguyên gần nhất.", example: "INT(-3.2)", exampleResult: "-4", min: 1, max: 1, returns: "number", impl: (a) => Math.floor(toNumber(a[0]!)) },
  { name: "ABS", group: "Toán", syntax: "ABS(số)", description: "Giá trị tuyệt đối.", example: "ABS(-5)", exampleResult: "5", min: 1, max: 1, returns: "number", impl: (a) => Math.abs(toNumber(a[0]!)) },
  {
    name: "MOD", group: "Toán", syntax: "MOD(số, số_chia)", description: "Phần dư của phép chia (dấu theo số chia, như Excel).", example: "MOD(10, 3)", exampleResult: "1", min: 2, max: 2, returns: "number",
    impl: (a) => {
      const n = toNumber(a[0]!);
      const d = toNumber(a[1]!);
      if (d === 0) throw err.div0();
      return n - d * Math.floor(n / d);
    },
  },
  {
    name: "POWER", group: "Toán", syntax: "POWER(cơ_số, mũ)", description: "Luỹ thừa.", example: "POWER(2, 10)", exampleResult: "1024", min: 2, max: 2, returns: "number",
    impl: (a) => {
      const r = Math.pow(toNumber(a[0]!), toNumber(a[1]!));
      if (!Number.isFinite(r)) throw err.num();
      return r;
    },
  },
  {
    name: "SQRT", group: "Toán", syntax: "SQRT(số)", description: "Căn bậc hai.", example: "SQRT(16)", exampleResult: "4", min: 1, max: 1, returns: "number",
    impl: (a) => {
      const n = toNumber(a[0]!);
      if (n < 0) throw err.num("Không lấy căn của số âm.");
      return Math.sqrt(n);
    },
  },
  {
    name: "CEILING", group: "Toán", syntax: "CEILING(số, [bước])", description: "Làm tròn lên đến bội số gần nhất của bước.", example: "CEILING(2.3, 0.5)", exampleResult: "2.5", min: 1, max: 2, returns: "number",
    impl: (a) => {
      const n = toNumber(a[0]!);
      const s = a[1] === undefined || a[1] === null ? 1 : toNumber(a[1]);
      if (s === 0) return 0;
      return Math.ceil(n / s - 1e-12) * s;
    },
  },
  {
    name: "FLOOR", group: "Toán", syntax: "FLOOR(số, [bước])", description: "Làm tròn xuống đến bội số gần nhất của bước.", example: "FLOOR(2.7, 0.5)", exampleResult: "2.5", min: 1, max: 2, returns: "number",
    impl: (a) => {
      const n = toNumber(a[0]!);
      const s = a[1] === undefined || a[1] === null ? 1 : toNumber(a[1]);
      if (s === 0) throw err.div0();
      return Math.floor(n / s + 1e-12) * s;
    },
  },
  {
    name: "LOG", group: "Toán", syntax: "LOG(số, [cơ_số])", description: "Logarit (cơ số mặc định 10).", example: "LOG(100)", exampleResult: "2", min: 1, max: 2, returns: "number",
    impl: (a) => {
      const n = toNumber(a[0]!);
      const b = a[1] === undefined || a[1] === null ? 10 : toNumber(a[1]);
      if (n <= 0 || b <= 0 || b === 1) throw err.num();
      return Math.log(n) / Math.log(b);
    },
  },
  { name: "EXP", group: "Toán", syntax: "EXP(số)", description: "e luỹ thừa số.", example: "EXP(1)", exampleResult: "2.718281828", min: 1, max: 1, returns: "number", impl: (a) => Math.exp(toNumber(a[0]!)) },
  {
    name: "LN", group: "Toán", syntax: "LN(số)", description: "Logarit tự nhiên.", example: "LN(1)", exampleResult: "0", min: 1, max: 1, returns: "number",
    impl: (a) => {
      const n = toNumber(a[0]!);
      if (n <= 0) throw err.num();
      return Math.log(n);
    },
  },
  { name: "SIGN", group: "Toán", syntax: "SIGN(số)", description: "-1, 0 hoặc 1 theo dấu của số.", example: "SIGN(-7)", exampleResult: "-1", min: 1, max: 1, returns: "number", impl: (a) => Math.sign(toNumber(a[0]!)) },
  { name: "TRUNC", group: "Toán", syntax: "TRUNC(số, [số_chữ_số])", description: "Cắt bỏ phần thập phân (không làm tròn).", example: "TRUNC(8.9)", exampleResult: "8", min: 1, max: 2, returns: "number", impl: (a) => round(toNumber(a[0]!), a[1] === undefined || a[1] === null ? 0 : toNumber(a[1]), "down") },
]; 
