import { FError, parseNumberText, type Scalar, type Value } from "./types";

/**
 * Excel criteria (COUNTIF, SUMIFS...): `5`, `"Won"`, `">=100"`, `"<>Lost"`, `"POD*"` (wildcards `*` `?`, escape with `~`).
 * A criteria that is a number or a plain text means "equal to".
 */

export type Matcher = (cell: Value) => boolean;

export function wildcardToRegex(pattern: string, flags = "i"): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "~" && i + 1 < pattern.length) {
      re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "*") re += "[\\s\\S]*";
    else if (c === "?") re += "[\\s\\S]";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re + "$", flags);
}

export const hasWildcard = (s: string): boolean => /[*?]/.test(s);

/** Value of a cell as seen by "equal to": text that looks like a number counts as that number. */
function eqNumber(cell: Value): number | null {
  if (typeof cell === "number") return cell;
  if (typeof cell === "string") return parseNumberText(cell);
  return null;
}

function cmp(op: string, a: number | string, b: number | string): boolean {
  switch (op) {
    case ">":
      return a > b;
    case "<":
      return a < b;
    case ">=":
      return a >= b;
    default:
      return a <= b;
  }
}

/** Builds a matcher from a criteria value. An error criteria matches nothing (and propagates when used by the caller). */
export function buildMatcher(criteria: Scalar): Matcher {
  if (criteria instanceof FError) throw criteria;
  if (criteria === null) criteria = 0; // an empty criteria cell counts as 0 (Excel)
  if (typeof criteria === "boolean") return (cell) => cell === criteria;
  if (typeof criteria === "number") {
    const c = criteria;
    return (cell) => eqNumber(cell) === c;
  }
  const m = /^(<>|<=|>=|=|<|>)?([\s\S]*)$/.exec(criteria)!;
  const op = m[1] ?? "=";
  const rest = m[2]!;
  if (op === "=" || op === "<>") {
    const neg = op === "<>";
    if (rest === "") {
      // "=" matches empty cells; "<>" matches non-empty; "" matches empty cells.
      return (cell) => (cell === null || cell === "") !== neg;
    }
    const num = parseNumberText(rest);
    if (num !== null && !hasWildcard(rest)) return (cell) => (eqNumber(cell) === num) !== neg;
    const up = rest.toUpperCase();
    if (up === "TRUE" || up === "FALSE") {
      const b = up === "TRUE";
      return (cell) => (cell === b) !== neg;
    }
    if (hasWildcard(rest) || rest.includes("~")) {
      const re = wildcardToRegex(rest);
      return (cell) => (typeof cell === "string" && re.test(cell)) !== neg;
    }
    const lower = rest.toLowerCase();
    return (cell) => (typeof cell === "string" && cell.toLowerCase() === lower) !== neg;
  }
  const num = parseNumberText(rest);
  if (num !== null) return (cell) => typeof cell === "number" && cmp(op, cell, num);
  const lower = rest.toLowerCase();
  return (cell) => typeof cell === "string" && cmp(op, cell.toLowerCase(), lower);
}

/**
 * True when a criteria value means plain equality (no operator, no wildcard). Only those can be answered by the
 * grouped SQL path (design module2 section 6.6).
 */
export function isPlainEquality(criteria: Scalar): boolean {
  if (criteria instanceof FError) return false;
  if (criteria === null || typeof criteria === "number" || typeof criteria === "boolean") return true;
  if (/^(<>|<=|>=|=|<|>)/.test(criteria)) return false;
  if (hasWildcard(criteria) || criteria.includes("~")) return false;
  return criteria.trim() !== "";
}

/**
 * Key that makes two values "equal" for grouping: numbers and numeric text share a key, text is case-insensitive.
 * Must agree with `buildMatcher` equality for plain criteria.
 */
export function equalityKey(v: Scalar): string {
  if (v === null) return "b:";
  if (typeof v === "number") return `n:${v}`;
  if (typeof v === "boolean") return `t:${v}`;
  if (v instanceof FError) return `e:${v.code}`;
  const n = parseNumberText(v);
  if (n !== null) return `n:${n}`;
  const up = v.toUpperCase();
  if (up === "TRUE" || up === "FALSE") return `t:${up === "TRUE"}`;
  return `s:${v.toLowerCase()}`;
}
