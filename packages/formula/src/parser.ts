import type { BinOp, Node, ParseResult } from "./ast";
import { ERROR_CODES, type FormulaErrorCode } from "./types";

/**
 * Lexer and parser (design module2 section 6.1). Operators and precedence follow Excel: comparison < `&` < `+ -` <
 * `* /` < `^` < unary minus < postfix `%`. Arguments are separated by `,` or `;`. A leading `=` is optional.
 */

type Tok =
  | { k: "num"; v: number; s: number; e: number }
  | { k: "str"; v: string; s: number; e: number }
  | { k: "ident"; v: string; s: number; e: number }
  | { k: "ref"; parts: string[]; s: number; e: number }
  | { k: "key"; table: string | null; key: string; s: number; e: number }
  | { k: "err"; v: FormulaErrorCode; s: number; e: number }
  | { k: "op"; v: string; s: number; e: number }
  | { k: "eof"; s: number; e: number };

class SyntaxErr extends Error {
  constructor(
    msg: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(msg);
  }
}

const KEY_RE = /^(?:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.)?([a-z][a-z0-9_]{0,40})$/;

function lex(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const s = i;
    if (c === '"') {
      let v = "";
      i++;
      for (;;) {
        if (i >= n) throw new SyntaxErr("Chuỗi chữ thiếu dấu đóng ngoặc kép (\").", s, n);
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += text[i++];
      }
      out.push({ k: "str", v, s, e: i });
      continue;
    }
    if (c === "[") {
      const parts: string[] = [];
      for (;;) {
        const close = text.indexOf("]", i + 1);
        if (close < 0) throw new SyntaxErr("Thiếu dấu ']' để đóng tên cột.", i, n);
        const name = text.slice(i + 1, close);
        if (name.includes("[")) throw new SyntaxErr("Tên cột không được chứa '['.", i, close + 1);
        if (name.trim() === "") throw new SyntaxErr("Tên trong [ ] không được để trống.", i, close + 1);
        parts.push(name.trim());
        i = close + 1;
        if (text[i] === "." && text[i + 1] === "[") {
          i++;
          continue;
        }
        break;
      }
      if (parts.length > 3) throw new SyntaxErr("Tham chiếu tối đa 3 phần: [Datahub].[Bảng].[Cột].", s, i);
      out.push({ k: "ref", parts, s, e: i });
      continue;
    }
    if (c === "{") {
      const close = text.indexOf("}", i + 1);
      if (close < 0) throw new SyntaxErr("Thiếu dấu '}'.", i, n);
      const body = text.slice(i + 1, close);
      const m = KEY_RE.exec(body);
      if (!m) throw new SyntaxErr("Mã tham chiếu không hợp lệ.", i, close + 1);
      i = close + 1;
      out.push({ k: "key", table: m[1] ?? null, key: m[2]!, s, e: i });
      continue;
    }
    if (c === "#") {
      const m = /^#(?:DIV\/0!|N\/A|VALUE!|REF!|CYCLE!|PERM!|NAME\?|NUM!)/i.exec(text.slice(i));
      if (!m) throw new SyntaxErr("Mã lỗi không hợp lệ sau '#'.", i, i + 1);
      const code = m[0].toUpperCase() as FormulaErrorCode;
      if (!ERROR_CODES.includes(code)) throw new SyntaxErr("Mã lỗi không hợp lệ.", i, i + m[0].length);
      i += m[0].length;
      out.push({ k: "err", v: code, s, e: i });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i))!;
      i += m[0].length;
      out.push({ k: "num", v: Number(m[0]), s, e: i });
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      let j = i + 1;
      while (j < n && /[\p{L}\p{N}_.]/u.test(text[j]!)) j++;
      out.push({ k: "ident", v: text.slice(i, j), s, e: j });
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      out.push({ k: "op", v: two, s, e: i + 2 });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%(),;".includes(c)) {
      out.push({ k: "op", v: c === ";" ? "," : c, s, e: i + 1 });
      i++;
      continue;
    }
    throw new SyntaxErr(`Ký tự không hợp lệ: '${c}'.`, i, i + 1);
  }
  out.push({ k: "eof", s: n, e: n });
  return out;
}

class Parser {
  private p = 0;
  private callId = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly text: string,
  ) {}

  private get cur(): Tok {
    return this.toks[this.p]!;
  }
  private isOp(v: string): boolean {
    return this.cur.k === "op" && this.cur.v === v;
  }

  parseAll(): Node {
    if ((this.cur as Tok).k === "eof") throw new SyntaxErr("Công thức đang trống.", 0, 0);
    const n = this.comparison();
    if ((this.cur as Tok).k !== "eof") {
      const t = this.cur as Tok;
      if (t.k === "op" && t.v === ")") throw new SyntaxErr("Thừa dấu đóng ngoặc ')'.", t.s, t.e);
      throw new SyntaxErr(`Không hiểu "${this.text.slice(t.s, t.e)}" ở đây; có thể thiếu toán tử hoặc dấu phẩy.`, t.s, t.e);
    }
    return n;
  }

  private comparison(): Node {
    let l = this.concat();
    while (this.cur.k === "op" && ["=", "<>", "<", "<=", ">", ">="].includes(this.cur.v)) {
      const op = this.cur.v as BinOp;
      this.p++;
      const r = this.concat();
      l = { t: "bin", op, l, r, s: l.s, e: r.e };
    }
    return l;
  }
  private concat(): Node {
    let l = this.additive();
    while (this.isOp("&")) {
      this.p++;
      const r = this.additive();
      l = { t: "bin", op: "&", l, r, s: l.s, e: r.e };
    }
    return l;
  }
  private additive(): Node {
    let l = this.multiplicative();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.cur as { v: string }).v as BinOp;
      this.p++;
      const r = this.multiplicative();
      l = { t: "bin", op, l, r, s: l.s, e: r.e };
    }
    return l;
  }
  private multiplicative(): Node {
    let l = this.power();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.cur as { v: string }).v as BinOp;
      this.p++;
      const r = this.power();
      l = { t: "bin", op, l, r, s: l.s, e: r.e };
    }
    return l;
  }
  private power(): Node {
    let l = this.unary();
    while (this.isOp("^")) {
      this.p++;
      const r = this.unary();
      l = { t: "bin", op: "^", l, r, s: l.s, e: r.e };
    }
    return l;
  }
  private unary(): Node {
    if (this.isOp("-") || this.isOp("+")) {
      const t = this.cur as { v: string; s: number };
      this.p++;
      const a = this.unary();
      return { t: "un", op: t.v as "-" | "+", a, s: t.s, e: a.e };
    }
    return this.postfix();
  }
  private postfix(): Node {
    let a = this.primary();
    while (this.isOp("%")) {
      const t = this.cur;
      this.p++;
      a = { t: "pct", a, s: a.s, e: t.e };
    }
    return a;
  }

  private primary(): Node {
    const t = this.cur;
    switch (t.k) {
      case "num":
        this.p++;
        return { t: "num", v: t.v, s: t.s, e: t.e };
      case "str":
        this.p++;
        return { t: "str", v: t.v, s: t.s, e: t.e };
      case "err":
        this.p++;
        return { t: "err", v: t.v, s: t.s, e: t.e };
      case "ref":
        this.p++;
        return { t: "ref", parts: t.parts, s: t.s, e: t.e };
      case "key":
        this.p++;
        return { t: "key", table: t.table, key: t.key, s: t.s, e: t.e };
      case "ident": {
        this.p++;
        if (this.isOp("(")) return this.call(t);
        const u = t.v.toUpperCase();
        if (u === "TRUE" || u === "FALSE") return { t: "bool", v: u === "TRUE", s: t.s, e: t.e };
        throw new SyntaxErr(`"${t.v}" không phải hàm, cột hay giá trị. Tên cột phải đặt trong [ ], ví dụ [${t.v}].`, t.s, t.e);
      }
      case "op":
        if (t.v === "(") {
          this.p++;
          const n = this.comparison();
          if (!this.isOp(")")) throw new SyntaxErr("Thiếu dấu đóng ngoặc ')'.", this.cur.s, Math.max(this.cur.e, this.cur.s));
          const close = this.cur;
          this.p++;
          return { ...n, s: t.s, e: close.e } as Node;
        }
        throw new SyntaxErr(`Không mong đợi "${t.v}" ở đây; cần một giá trị, cột hoặc hàm.`, t.s, t.e);
      default:
        throw new SyntaxErr("Công thức chưa hoàn chỉnh: cần thêm một giá trị.", t.s, t.e);
    }
  }

  private call(nameTok: { v: string; s: number; e: number }): Node {
    this.p++; // (
    const args: Node[] = [];
    const id = this.callId++;
    if (this.isOp(")")) {
      const close = this.cur;
      this.p++;
      return { t: "call", name: nameTok.v.toUpperCase(), args, id, s: nameTok.s, e: close.e };
    }
    for (;;) {
      if (this.isOp(",") || this.isOp(")")) args.push({ t: "empty", s: this.cur.s, e: this.cur.s });
      else args.push(this.comparison());
      if (this.isOp(",")) {
        this.p++;
        continue;
      }
      if (this.isOp(")")) {
        const close = this.cur;
        this.p++;
        return { t: "call", name: nameTok.v.toUpperCase(), args, id, s: nameTok.s, e: close.e };
      }
      throw new SyntaxErr(`Thiếu dấu đóng ngoặc ')' cho hàm ${nameTok.v.toUpperCase()}.`, this.cur.s, Math.max(this.cur.e, this.cur.s + 1));
    }
  }
}

/** Parses a formula. The text may start with `=`. Offsets in the result refer to `text` exactly as given. */
export function parseFormula(source: string): ParseResult {
  const lead = /^\s*=/.exec(source);
  // Replace the leading "=" by a space so offsets stay those of the original text.
  const text = lead ? source.slice(0, lead[0].length - 1).replace(/=/g, " ") + " " + source.slice(lead[0].length) : source;
  try {
    const ast = new Parser(lex(text), text).parseAll();
    return { ok: true, ast, text: source };
  } catch (e) {
    if (e instanceof SyntaxErr) return { ok: false, error: { message: e.message, start: e.start, end: e.end } };
    throw e;
  }
}
