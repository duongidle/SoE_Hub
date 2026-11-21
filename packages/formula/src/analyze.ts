import { walk, type Node, type ParseError } from "./ast";
import { hasWildcard } from "./criteria";
import { getFunction } from "./functions";

/** What a formula reads, for the dependency graph (cycle check, recalculation) and for scheduling. */
export interface FormulaDeps {
  /** Columns of the current row (same table). */
  cells: string[];
  /** Whole columns of tables (including this table). */
  ranges: { table: string; key: string }[];
  /** Uses TODAY() (recalculated daily) or NOW() (hourly). */
  volatile: "today" | "now" | null;
  usesRowInfo: boolean;
  /** Uses ME() or ISME(): the value depends on who reads it (design module2 section 6.2, 10). */
  usesViewer: boolean;
}

export function collectDeps(ast: Node): FormulaDeps {
  const cells = new Set<string>();
  const ranges = new Map<string, { table: string; key: string }>();
  let volatile: FormulaDeps["volatile"] = null;
  let usesRowInfo = false;
  let usesViewer = false;
  walk(ast, (n) => {
    if (n.t === "key") {
      if (n.table === null) cells.add(n.key);
      else ranges.set(`${n.table}.${n.key}`, { table: n.table, key: n.key });
    } else if (n.t === "call") {
      const fn = getFunction(n.name);
      if (fn?.volatile === "now") volatile = "now";
      else if (fn?.volatile === "today" && volatile !== "now") volatile = "today";
      if (fn?.group === "Thông tin dòng") usesRowInfo = true;
      if (n.name === "ME" || n.name === "ISME") usesViewer = true;
    }
  });
  return { cells: [...cells], ranges: [...ranges.values()], volatile, usesRowInfo, usesViewer };
}

export interface Issue extends ParseError {
  /** Offsets of the offending text. */
  code: "unknown_function" | "arity";
}

/** Unknown functions and wrong argument counts, with the position of each (for the red underline of the editor). */
export function validateCalls(ast: Node): Issue[] {
  const out: Issue[] = [];
  walk(ast, (n) => {
    if (n.t !== "call") return;
    const fn = getFunction(n.name);
    if (!fn) {
      out.push({ code: "unknown_function", message: `Hàm ${n.name} không tồn tại.`, start: n.s, end: n.s + n.name.length });
      return;
    }
    if (n.args.length < fn.min || n.args.length > fn.max) {
      const need = fn.min === fn.max ? `${fn.min}` : `từ ${fn.min} đến ${fn.max >= 254 ? "nhiều" : fn.max}`;
      out.push({ code: "arity", message: `Hàm ${n.name} cần ${need} đối số, đang có ${n.args.length}. Cú pháp: ${fn.syntax}`, start: n.s, end: n.e });
    }
  });
  return out;
}

// ------------------------------------------------------------------------------------------------
// calls that one grouped SQL query can answer for a whole column (design module2 section 6.6)
// ------------------------------------------------------------------------------------------------

export type GroupAgg = "count" | "sum" | "avg" | "min" | "max" | "counta" | "count_num" | "lookup";

export interface GroupableCall {
  /** Id of the call node in the AST. */
  nodeId: number;
  fn: string;
  kind: "criteria" | "lookup";
  agg: GroupAgg;
  /** Table whose column(s) are grouped. */
  table: string;
  /** Columns of that table the criteria are applied to, in order. */
  keyColumns: string[];
  /** Expressions of the current row that give the key values, same order as `keyColumns`. */
  keyNodes: Node[];
  /** Column aggregated (SUMIFS...) or returned (XLOOKUP...). Null for COUNTIFS. */
  target: string | null;
  /** Index of the "if not found" argument of the call. */
  notFoundArg?: number;
  /** The column references (`{table.key}` nodes) this call reads as ranges; they need no scan when the call is grouped. */
  rangeNodes: Extract<Node, { t: "key" }>[];
}

const isRangeNode = (n: Node | undefined): n is Extract<Node, { t: "key" }> => !!n && n.t === "key" && n.table !== null;

function hasRange(n: Node): boolean {
  let found = false;
  walk(n, (x) => {
    if (x.t === "key" && x.table !== null) found = true;
  });
  return found;
}

/** Leading text literal of a `"..."&x&y` chain, if any. */
function leadingLiteral(n: Node): string | null {
  if (n.t === "str") return n.v;
  if (n.t === "bin" && n.op === "&") return leadingLiteral(n.l);
  return null;
}

/** False when the criteria is certainly not plain equality (operator or wildcard in the literal part). */
function maybePlainCriteria(n: Node): boolean {
  const lit = leadingLiteral(n);
  if (lit === null) return true;
  if (/^(<>|<=|>=|=|<|>)/.test(lit)) return false;
  if (n.t === "str") return lit.trim() !== "" && !hasWildcard(lit) && !lit.includes("~");
  return !hasWildcard(lit) && !lit.includes("~");
}

const isLiteral = (n: Node | undefined, v: number | boolean | string) => !!n && (n.t === "num" || n.t === "bool" || n.t === "str") && n.v === v;
const absentOrLiteral = (n: Node | undefined, v: number) => n === undefined || n.t === "empty" || isLiteral(n, v);

export function findGroupable(ast: Node): GroupableCall[] {
  const out: GroupableCall[] = [];
  walk(ast, (n) => {
    if (n.t !== "call") return;
    const a = n.args;
    const base = { nodeId: n.id, fn: n.name };
    const family = (targetIdx: number | null, pairFrom: number, agg: GroupAgg): void => {
      const rest = a.slice(pairFrom);
      if (rest.length === 0 || rest.length % 2 !== 0) return;
      const tableOf = (x: Node | undefined) => (isRangeNode(x) ? x.table : undefined);
      const target = targetIdx === null ? null : a[targetIdx];
      const ranges: Node[] = [];
      const crits: Node[] = [];
      for (let i = 0; i < rest.length; i += 2) {
        ranges.push(rest[i]!);
        crits.push(rest[i + 1]!);
      }
      const table = tableOf(ranges[0]);
      if (!table || !ranges.every((r) => tableOf(r) === table)) return;
      if (target && tableOf(target) !== table) return;
      if (crits.some((c) => hasRange(c) || c.t === "empty" || !maybePlainCriteria(c))) return;
      out.push({ ...base, kind: "criteria", agg, table, keyColumns: ranges.map((r) => (r as { key: string }).key), keyNodes: crits, target: target ? (target as { key: string }).key : null, rangeNodes: [...ranges, ...(target ? [target] : [])] as Extract<Node, { t: "key" }>[] });
    };
    switch (n.name) {
      case "COUNTIFS":
        family(null, 0, "count");
        break;
      case "COUNTIF":
        if (a.length === 2) family(null, 0, "count");
        break;
      case "SUMIFS":
        family(0, 1, "sum");
        break;
      case "AVERAGEIFS":
        family(0, 1, "avg");
        break;
      case "MINIFS":
        family(0, 1, "min");
        break;
      case "MAXIFS":
        family(0, 1, "max");
        break;
      case "SUMIF":
      case "AVERAGEIF": {
        if (a.length === 2 && isRangeNode(a[0])) {
          const r = a[0];
          if (!hasRange(a[1]!) && maybePlainCriteria(a[1]!)) out.push({ ...base, kind: "criteria", agg: n.name === "SUMIF" ? "sum" : "avg", table: r.table!, keyColumns: [r.key], keyNodes: [a[1]!], target: r.key, rangeNodes: [r] });
        } else if (a.length === 3 && isRangeNode(a[0]) && isRangeNode(a[2]) && a[0].table === a[2].table) {
          if (!hasRange(a[1]!) && maybePlainCriteria(a[1]!)) out.push({ ...base, kind: "criteria", agg: n.name === "SUMIF" ? "sum" : "avg", table: a[0].table!, keyColumns: [a[0].key], keyNodes: [a[1]!], target: a[2].key, rangeNodes: [a[0], a[2]] });
        }
        break;
      }
      case "XLOOKUP":
        if (isRangeNode(a[1]) && isRangeNode(a[2]) && a[1].table === a[2].table && !hasRange(a[0]!) && absentOrLiteral(a[4], 0) && absentOrLiteral(a[5], 1)) {
          out.push({ ...base, kind: "lookup", agg: "lookup", table: a[1].table!, keyColumns: [a[1].key], keyNodes: [a[0]!], target: a[2].key, notFoundArg: 3, rangeNodes: [a[1], a[2]] });
        }
        break;
      case "VLOOKUP":
        if (isRangeNode(a[1]) && isRangeNode(a[2]) && a[1].table === a[2].table && !hasRange(a[0]!) && (a[3] === undefined || a[3].t === "empty" || isLiteral(a[3], false) || isLiteral(a[3], 0))) {
          out.push({ ...base, kind: "lookup", agg: "lookup", table: a[1].table!, keyColumns: [a[1].key], keyNodes: [a[0]!], target: a[2].key, rangeNodes: [a[1], a[2]] });
        }
        break;
      case "INDEX": {
        const m = a[1];
        if (isRangeNode(a[0]) && m?.t === "call" && m.name === "MATCH" && isRangeNode(m.args[1]) && m.args[1].table === a[0].table && !hasRange(m.args[0]!) && isLiteral(m.args[2], 0)) {
          out.push({ ...base, kind: "lookup", agg: "lookup", table: a[0].table!, keyColumns: [m.args[1].key], keyNodes: [m.args[0]!], target: a[0].key, rangeNodes: [a[0], m.args[1]] });
        }
        break;
      }
      case "SUM":
      case "COUNT":
      case "COUNTA":
      case "AVERAGE":
      case "MIN":
      case "MAX":
        if (a.length === 1 && isRangeNode(a[0])) {
          const agg: GroupAgg = n.name === "SUM" ? "sum" : n.name === "COUNT" ? "count_num" : n.name === "COUNTA" ? "counta" : n.name === "AVERAGE" ? "avg" : n.name === "MIN" ? "min" : "max";
          out.push({ ...base, kind: "criteria", agg, table: a[0].table!, keyColumns: [], keyNodes: [], target: a[0].key, rangeNodes: [a[0]] });
        }
        break;
      default:
    }
  });
  return out;
}
