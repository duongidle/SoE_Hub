import { evaluate, FError, parseFormula, RangeValue, toStoredFormula, ymdToSerial, type EvalContext, type GroupPlan, type Node, type Scalar, type Value } from "../src";

export const T1 = "11111111-1111-1111-1111-111111111111";
export const T2 = "22222222-2222-2222-2222-222222222222";
export const NOW = new Date("2026-11-18T10:30:00+07:00");

export const d = (y: number, m: number, day: number) => ymdToSerial(y, m, day);

export interface Fixture {
  cells?: Record<string, Value>;
  /** Columns by `table.key`; `t1.x` / `t2.x` are the two test tables. */
  ranges?: Record<string, Value[]>;
  plans?: Map<number, GroupPlan>;
  now?: Date;
  /** The viewer (ME). */
  me?: string;
  /** User cells with attributes by cell key: person id to attributes by label. */
  people?: Record<string, Record<string, Record<string, Scalar>>>;
  /** The ids in the viewer's scope (INSCOPE, ATTRSUM "của tôi"). */
  scope?: string[];
}

/** Names in tests: `[a_b]` is the cell `a_b`; `[T1].[x]` and `[T2].[x]` are columns of the two tables. */
export function compile(src: string): { ast: Node; stored: string } {
  const r = toStoredFormula(src, (parts) => {
    if (parts.length === 1) return { table: null, key: parts[0]!.toLowerCase().replace(/\s+/g, "_") };
    const table = parts[0] === "T1" ? T1 : parts[0] === "T2" ? T2 : null;
    if (!table) return { error: `Không có bảng ${parts[0]}` };
    return { table, key: parts[1]!.toLowerCase().replace(/\s+/g, "_") };
  });
  if (!r.ok) throw new Error(`compile: ${r.error.message}`);
  return { ast: r.ast, stored: r.stored };
}

export function ctxOf(f: Fixture = {}): EvalContext {
  return {
    now: f.now ?? NOW,
    cell: (k) => (f.cells && k in f.cells ? (f.cells[k] as Value) : null),
    range: (t, k) => {
      const name = `${t === T1 ? "t1" : "t2"}.${k}`;
      const col = f.ranges?.[name];
      if (!col) throw new FError("#REF!");
      return new RangeValue(t, k, () => col);
    },
    rowInfo: () => ({ id: "row-1", rowNo: 7, createdAt: d(2026, 11, 1), modifiedAt: d(2026, 11, 2) }),
    plans: f.plans,
    me: () => f.me ?? null,
    attr: (key, person, name) => f.people?.[key]?.[person]?.[name] ?? null,
    scope: () => f.scope ?? (f.me ? [f.me] : null),
    attrSum: (key, name, mine) => {
      const ids = String(f.cells?.[key] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const scope = f.scope ?? (f.me ? [f.me] : []);
      return ids.filter((id) => !mine || scope.includes(id)).reduce((a, id) => a + (Number(f.people?.[key]?.[id]?.[name]) || 0), 0);
    },
  };
}

/** Evaluates a formula; an error comes back as its code, e.g. "#DIV/0!". */
export function calc(src: string, f: Fixture = {}): Scalar | string {
  const { ast } = compile(src);
  const v = evaluate(ast, ctxOf(f));
  return v instanceof FError ? v.code : v;
}

export const parseOk = (src: string) => {
  const r = parseFormula(src);
  if (!r.ok) throw new Error(r.error.message);
  return r.ast;
};
