import { buildMatcher, type Matcher } from "../criteria";
import { err, FError, flatten, isArray, materialize, RangeValue, toArray, toNumber, toText, type FType, type Value } from "../types";

/** Numbers of the arguments: inside a list or column only real numbers count; a lone value is converted (blank skipped). */
export function collectNumbers(args: Value[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (isArray(a)) {
      for (const v of flatten([a])) {
        if (v instanceof FError) throw v;
        if (typeof v === "number") out.push(v);
      }
    } else if (a instanceof FError) throw a;
    else if (a !== null) out.push(toNumber(a));
  }
  return out;
}

/** Numbers of one list or column (everything that is not a number is ignored). */
export function numbersOf(v: Value): number[] {
  const out: number[] = [];
  for (const x of flatten([v])) {
    if (x instanceof FError) throw x;
    if (typeof x === "number") out.push(x);
  }
  return out;
}

export const ensureArray = (v: Value, what = "Đối số"): Value[] => {
  if (!isArray(v)) throw err.value(`${what} phải là một cột hoặc danh sách.`);
  return toArray(v);
};

/** Rows of several (range, criteria) pairs that satisfy every criteria: a boolean mask. */
export function maskOf(pairs: [Value, Value][]): boolean[] {
  const ranges = pairs.map(([r]) => ensureArray(r, "Vùng điều kiện"));
  const n = ranges[0]!.length;
  if (ranges.some((r) => r.length !== n)) throw err.value("Các cột điều kiện phải có cùng số dòng.");
  const matchers: Matcher[] = pairs.map(([, c]) => {
    const crit = materialize(c);
    if (isArray(crit)) throw err.value("Điều kiện phải là một giá trị, không phải danh sách.");
    return buildMatcher(crit as never);
  });
  const mask = new Array<boolean>(n).fill(true);
  for (let k = 0; k < ranges.length; k++) {
    const r = ranges[k]!;
    const m = matchers[k]!;
    for (let i = 0; i < n; i++) if (mask[i] && !m(r[i] as Value)) mask[i] = false;
  }
  return mask;
}

export function pickWhere(values: Value[], mask: boolean[]): Value[] {
  if (values.length !== mask.length) throw err.value("Cột kết quả phải có cùng số dòng với cột điều kiện.");
  const out: Value[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(values[i] as Value);
  return out;
}

export const sameOrMixed = (types: FType[]): FType => {
  const ts = types.filter((t) => t !== "unknown");
  if (types.some((t) => t === "unknown") && ts.length === 0) return "unknown";
  if (ts.length === 0) return "unknown";
  if (types.includes("unknown")) return "unknown";
  const first = ts[0]!;
  if (ts.every((t) => t === first)) return first;
  if (ts.every((t) => t === "date" || t === "datetime")) return "datetime";
  return "mixed";
};

export const isRange = (v: Value): v is RangeValue => v instanceof RangeValue;

export function textArg(v: Value): string {
  return toText(v);
}

export function round(n: number, digits: number, mode: "half" | "up" | "down"): number {
  const f = Math.pow(10, digits);
  const x = Math.abs(n) * f;
  // Guard against 1.005 * 100 = 100.49999999999999.
  const eps = x * 1e-12;
  let r: number;
  if (mode === "half") r = Math.floor(x + 0.5 + eps);
  else if (mode === "up") r = Math.ceil(x - eps);
  else r = Math.floor(x + eps);
  return (Math.sign(n) * r) / f;
}
