import { evaluate, parseFormula, err, isError, type Node, type Scalar } from "@soe/formula";
import { AppError } from "@soe/shared";
import { normRef } from "./columns";
import type { MetricRow, MetricTable } from "./build";
import type { CompareKind } from "./schema";

/**
 * Steps that work on the table a metric returned (design module3 sections 5.2 to 5.4): derived metrics, running totals, comparison
 * with an earlier period, targets and the IQR bounds. Pure: the API runs the SQL and feeds the tables in, so each number is computed
 * in one place.
 */

const SEP = "\u001f";
export const groupKey = (r: Pick<MetricRow, "groups">): string => r.groups.map((g) => (g.value === null ? "" : String(g.value))).join(SEP);

/** Text a label is matched by (accents and case do not matter). */
export const normLabel = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").trim().toLowerCase();

// ------------------------------------------------------------------------------------------------
// derived metric
// ------------------------------------------------------------------------------------------------

export interface ParsedFormula {
  ast: Node;
  /** Names of the metrics the formula reads, in order of first use (`m0`, `m1`... inside the tree). */
  names: string[];
}

function rewrite(n: Node, f: (n: Node) => Node | null): Node {
  const r = f(n);
  if (r) return r;
  switch (n.t) {
    case "call": return { ...n, args: n.args.map((a) => rewrite(a, f)) };
    case "un":
    case "pct": return { ...n, a: rewrite(n.a, f) };
    case "bin": return { ...n, l: rewrite(n.l, f), r: rewrite(n.r, f) };
    default: return n;
  }
}

/** Parses a derived metric: `[Tên chỉ số]` are the other metrics of the datahub. Errors say where in the text the problem is. */
export function parseDerived(formula: string): ParsedFormula {
  const pr = parseFormula(formula);
  if (!pr.ok) throw new AppError("validation_error", `Công thức "${formula}" sai cú pháp: ${pr.error.message}`, { reason: "bad_formula", start: pr.error.start, end: pr.error.end });
  const names: string[] = [];
  const ast = rewrite(pr.ast, (n) => {
    if (n.t === "key") throw new AppError("validation_error", "Công thức của chỉ số phái sinh chỉ tham chiếu chỉ số bằng [Tên chỉ số].", { reason: "bad_formula" });
    if (n.t !== "ref") return null;
    if (n.parts.length !== 1) throw new AppError("validation_error", `"${n.parts.join(".")}" không phải tên một chỉ số. Chỉ số phái sinh viết [Tên chỉ số], không kèm bảng hay cột.`, { reason: "bad_formula", start: n.s, end: n.e });
    const name = n.parts[0]!;
    let i = names.findIndex((x) => normRef(x) === normRef(name));
    if (i < 0) i = names.push(name) - 1;
    return { t: "key", table: null, key: `m${i}`, s: n.s, e: n.e };
  });
  if (!names.length) throw new AppError("validation_error", "Công thức phải dùng ít nhất một chỉ số, viết [Tên chỉ số].", { reason: "bad_formula" });
  return { ast, names };
}

const cmpGroups = (a: MetricRow, b: MetricRow): number => {
  for (let i = 0; i < a.groups.length; i++) {
    const x = a.groups[i]!.value;
    const y = b.groups[i]!.value;
    if (x === y) continue;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
};

/**
 * Evaluates the formula for every group that appears in any of the tables (one table per name, same group columns). A metric with no
 * row for a group counts as empty there (0 in arithmetic, as in a sheet). An error of the formula (`#DIV/0!`...) is kept on the row and
 * its value is null.
 */
export function combineDerived(f: ParsedFormula, tables: MetricTable[], order: "group" | "value_desc" | "value_asc", limit: number, now: Date): MetricTable {
  const maps = tables.map((t) => new Map(t.rows.map((r) => [groupKey(r), r])));
  const keys = new Map<string, MetricRow>();
  for (const t of tables) for (const r of t.rows) if (!keys.has(groupKey(r))) keys.set(groupKey(r), r);
  let rows = [...keys.entries()].map(([k, first]): MetricRow => {
    const ctx = {
      now,
      cell: (key: string) => {
        const i = Number(key.slice(1));
        const v = maps[i]?.get(k)?.value ?? null;
        return typeof v === "string" ? err.value(`Chỉ số "${f.names[i]}" không phải số.`) : v;
      },
      range: () => {
        throw err.ref("Chỉ số phái sinh không dùng được cả cột.");
      },
      rowInfo: () => ({ id: "", rowNo: 0, createdAt: null, modifiedAt: null }),
    };
    const v: Scalar = evaluate(f.ast, ctx);
    const count = Math.max(...maps.map((m) => m.get(k)?.count ?? 0));
    if (isError(v)) return { groups: first.groups, value: null, count, error: v.code };
    if (typeof v !== "number" || !Number.isFinite(v)) return v === null ? { groups: first.groups, value: null, count } : { groups: first.groups, value: null, count, error: "#VALUE!" };
    return { groups: first.groups, value: v, count };
  });
  rows = rows.sort(order === "group" ? cmpGroups : (a, b) => {
    const x = a.value as number | null;
    const y = b.value as number | null;
    if (x === y) return cmpGroups(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return order === "value_desc" ? y - x : x - y;
  });
  const first = tables[0]!;
  return { columns: first.columns, value_type: "number", rows: rows.slice(0, limit), truncated: rows.length > limit || tables.some((t) => t.truncated) };
}

// ------------------------------------------------------------------------------------------------
// running total, comparison, target
// ------------------------------------------------------------------------------------------------

/** Running total over the time bucket (`timeIndex` = position of the bucket among the groups): for each combination of the other groups, in time order. */
export function cumulate(t: MetricTable, timeIndex: number): MetricTable {
  const run = new Map<string, number>();
  const rows = [...t.rows]
    .sort((a, b) => {
      const o = a.groups.filter((_, i) => i !== timeIndex).map((g) => String(g.value)).join(SEP);
      const p = b.groups.filter((_, i) => i !== timeIndex).map((g) => String(g.value)).join(SEP);
      if (o !== p) return o < p ? -1 : 1;
      return cmpGroups({ ...a, groups: [a.groups[timeIndex]!] }, { ...b, groups: [b.groups[timeIndex]!] });
    })
    .map((r): MetricRow => {
      if (r.groups[timeIndex]!.value === null) return r;
      const other = r.groups.filter((_, i) => i !== timeIndex).map((g) => String(g.value)).join(SEP);
      const total = (run.get(other) ?? 0) + (typeof r.value === "number" ? r.value : 0);
      run.set(other, total);
      return { ...r, value: total };
    });
  return { ...t, rows };
}

/** Puts the value of the same group in the earlier period next to each row (the earlier table was read with its buckets moved forward, so keys match). */
export function compareTables(cur: MetricTable, prev: MetricTable): MetricTable {
  const pm = new Map(prev.rows.map((r) => [groupKey(r), r]));
  const seen = new Set<string>();
  const rows = cur.rows.map((r): MetricRow => {
    const k = groupKey(r);
    seen.add(k);
    return withPrevious(r, pm.get(k)?.value ?? null);
  });
  for (const r of prev.rows) if (!seen.has(groupKey(r))) rows.push(withPrevious({ groups: r.groups, value: null, count: 0 }, r.value));
  return { ...cur, rows, truncated: cur.truncated || prev.truncated };
}

function withPrevious(r: MetricRow, prev: MetricRow["value"]): MetricRow {
  const both = typeof r.value === "number" && typeof prev === "number";
  const change = both ? (r.value as number) - (prev as number) : null;
  return { ...r, previous: prev, change, change_pct: change !== null && prev !== 0 ? change / Math.abs(prev as number) : null };
}

/** Adds the target of each group, the share reached and the gap. `targetFor` returns null when a group has no target. */
export function attachTarget(t: MetricTable, targetFor: (r: MetricRow) => number | null): MetricTable {
  return {
    ...t,
    rows: t.rows.map((r): MetricRow => {
      const target = targetFor(r);
      const v = typeof r.value === "number" ? r.value : null;
      return { ...r, target, achieved: v !== null && target !== null && target !== 0 ? v / target : null, gap: v !== null && target !== null ? target - v : null };
    }),
  };
}

/** Key a metric group and a row of the target table meet on: the time bucket by its start day, other columns by their label (accents and case ignored). */
export function targetKey(groups: MetricRow["groups"], timeIndex: number | null, drop: number[] = []): string {
  return groups
    .filter((_, i) => !drop.includes(i))
    .map((g, i) => (g.value === null ? "" : timeIndex !== null && i === timeIndex ? String(g.value) : normLabel(g.label)))
    .join(SEP);
}

// ------------------------------------------------------------------------------------------------
// outliers
// ------------------------------------------------------------------------------------------------

export interface IqrBounds {
  q1: number;
  q3: number;
  iqr: number;
  k: number;
  lower: number;
  upper: number;
  n: number;
}

/** Bounds `[Q1 - k*IQR, Q3 + k*IQR]` from the quartiles; null when there are too few values (fewer than 4) to tell what an outlier is. */
export function iqrBounds(q1: number | null, q3: number | null, n: number, k = 1.5): IqrBounds | null {
  if (q1 === null || q3 === null || n < 4) return null;
  const iqr = q3 - q1;
  return { q1, q3, iqr, k, lower: q1 - k * iqr, upper: q3 + k * iqr, n };
}

export type { CompareKind };
