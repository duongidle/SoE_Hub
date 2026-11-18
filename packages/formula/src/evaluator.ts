import type { Node } from "./ast";
import { NOT_FOUND, type EvalContext, type FnCtx } from "./context";
import { isPlainEquality } from "./criteria";
import { getFunction } from "./functions";
import { compareValues, err, FError, isArray, materialize, numberToText, RangeValue, toNumber, toText, type Scalar, type Value } from "./types";

type Arith = (a: number, b: number) => number;

const ARITH: Record<string, Arith> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => {
    if (b === 0) throw err.div0();
    return a / b;
  },
  "^": (a, b) => {
    const r = Math.pow(a, b);
    if (!Number.isFinite(r)) throw err.num();
    return r;
  },
};

function checkFinite(n: number): number {
  if (!Number.isFinite(n)) throw err.num();
  return n;
}

function scalarBin(op: string, l: Value, r: Value): Scalar {
  if (op === "&") return toText(l) + toText(r);
  if (op === "=" || op === "<>" || op === "<" || op === "<=" || op === ">" || op === ">=") {
    const c = compareValues(l as Scalar, r as Scalar);
    switch (op) {
      case "=":
        return c === 0;
      case "<>":
        return c !== 0;
      case "<":
        return c < 0;
      case "<=":
        return c <= 0;
      case ">":
        return c > 0;
      default:
        return c >= 0;
    }
  }
  return checkFinite(ARITH[op]!(toNumber(l), toNumber(r)));
}

/** Applies an operator element by element when a side is a column or list (like an Excel array formula). */
function binary(op: string, l: Value, r: Value): Value {
  const lm = materialize(l);
  const rm = materialize(r);
  if (!Array.isArray(lm) && !Array.isArray(rm)) {
    if (lm instanceof FError) throw lm;
    if (rm instanceof FError) throw rm;
    return scalarBin(op, lm, rm);
  }
  const la = Array.isArray(lm) ? lm : null;
  const ra = Array.isArray(rm) ? rm : null;
  if (la && ra && la.length !== ra.length) throw err.value("Hai danh sách phải có cùng số dòng.");
  const n = (la ?? ra)!.length;
  const out: Value[] = new Array(n);
  for (let i = 0; i < n; i++) {
    try {
      const a = la ? (la[i] as Value) : lm;
      const b = ra ? (ra[i] as Value) : rm;
      if (a instanceof FError) throw a;
      if (b instanceof FError) throw b;
      out[i] = scalarBin(op, a, b);
    } catch (e) {
      if (e instanceof FError) out[i] = e;
      else throw e;
    }
  }
  return out;
}

function mapValue(v: Value, f: (x: Scalar) => Scalar): Value {
  const m = materialize(v);
  if (Array.isArray(m)) {
    return m.map((x) => {
      try {
        return f(x as Scalar);
      } catch (e) {
        if (e instanceof FError) return e;
        throw e;
      }
    });
  }
  if (m instanceof FError) throw m;
  return f(m as Scalar);
}

class Evaluator {
  constructor(private readonly ctx: EvalContext) {}

  ev = (n: Node): Value => {
    switch (n.t) {
      case "num":
      case "str":
      case "bool":
        return n.v;
      case "err":
        return new FError(n.v);
      case "empty":
        return null;
      case "ref":
        throw err.name(`Tham chiếu [${n.parts.join("].[")}] chưa được liên kết với cột nào.`);
      case "key":
        return n.table === null ? this.ctx.cell(n.key) : this.ctx.range(n.table, n.key);
      case "un":
        return n.op === "+" ? this.ev(n.a) : mapValue(this.ev(n.a), (x) => -toNumber(x));
      case "pct":
        return mapValue(this.ev(n.a), (x) => toNumber(x) / 100);
      case "bin":
        return binary(n.op, this.ev(n.l), this.ev(n.r));
      case "call":
        return this.call(n);
    }
  };

  private call(n: Extract<Node, { t: "call" }>): Value {
    const fn = getFunction(n.name);
    if (!fn) throw err.name(`Hàm ${n.name} không tồn tại.`);
    if (n.args.length < fn.min || n.args.length > fn.max) {
      throw err.value(`Hàm ${n.name} cần ${fn.min === fn.max ? fn.min : `từ ${fn.min} đến ${fn.max === Infinity ? "nhiều" : fn.max}`} đối số.`);
    }
    const plan = this.ctx.plans?.get(n.id);
    if (plan) {
      const keys = plan.keyNodes.map((k) => materialize(this.ev(k)));
      const usable = keys.every((k) => !isArray(k) && !(k instanceof FError) && (plan.kind === "lookup" ? k !== null && k !== "" : isPlainEquality(k as Scalar)));
      if (usable) {
        const norm = keys.map((k) => (plan.kind === "criteria" && k === null ? 0 : k)) as Scalar[];
        const r = plan.lookup(norm);
        if (r === NOT_FOUND) {
          const nf = plan.notFoundArg !== undefined ? n.args[plan.notFoundArg] : undefined;
          if (nf && nf.t !== "empty") return this.ev(nf);
          throw err.na("Không tìm thấy.");
        }
        if (r !== undefined) return r;
      }
    }
    const c = this.ctx as FnCtx;
    if (fn.lazy) return fn.lazy(n.args, this.ev, c);
    const args = n.args.map((a) => this.ev(a));
    return fn.impl!(args, c);
  }
}

/** A value for a cell: a list becomes its items joined with ", ". Errors are returned as values. */
export function scalarize(v: Value): Scalar {
  if (v instanceof RangeValue) v = v.values();
  if (Array.isArray(v)) {
    const items = v.map((x) => materialize(x as Value));
    const bad = items.find((x) => x instanceof FError);
    if (bad) return bad as FError;
    return items
      .filter((x) => x !== null && x !== "")
      .map((x) => (typeof x === "number" ? numberToText(x) : String(x)))
      .join(", ");
  }
  return v as Scalar;
}

/** Evaluates a parsed formula (references already in key form) for one row. Errors come back as `FError` values. */
export function evaluate(ast: Node, ctx: EvalContext): Scalar {
  try {
    return scalarize(new Evaluator(ctx).ev(ast));
  } catch (e) {
    if (e instanceof FError) return e;
    if (e instanceof RangeError) return err.value("Công thức quá phức tạp.");
    throw e;
  }
}
