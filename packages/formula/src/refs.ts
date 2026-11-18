import { walk, type Node, type ParseResult } from "./ast";
import { parseFormula } from "./parser";

/** What a named reference resolves to when the formula is saved. */
export type RefTarget = { table: string | null; key: string } | { error: string };

export type StoreResult = { ok: true; stored: string; ast: Node } | { ok: false; error: { message: string; start: number; end: number } };

const keyToken = (t: { table: string | null; key: string }) => `{${t.table ? `${t.table}.` : ""}${t.key}}`;

function splice(text: string, edits: { s: number; e: number; text: string }[]): string {
  let out = text;
  for (const ed of [...edits].sort((a, b) => b.s - a.s)) out = out.slice(0, ed.s) + ed.text + out.slice(ed.e);
  return out;
}

/**
 * Turns a formula written with names (`[Doanh thu]`, `[Bảng].[Cột]`) into the stored form with keys, so renaming a
 * column never breaks a formula. The leading `=` is dropped. `resolve` is given the name parts of every reference.
 */
export function toStoredFormula(source: string, resolve: (parts: string[], node: Extract<Node, { t: "ref" }>) => RefTarget): StoreResult {
  const parsed = parseFormula(source);
  if (!parsed.ok) return parsed;
  const edits: { s: number; e: number; text: string }[] = [];
  let failure: { message: string; start: number; end: number } | null = null;
  walk(parsed.ast, (n) => {
    if (n.t !== "ref" || failure) return;
    const t = resolve(n.parts, n);
    if ("error" in t) failure = { message: t.error, start: n.s, end: n.e };
    else edits.push({ s: n.s, e: n.e, text: keyToken(t) });
  });
  if (failure) return { ok: false, error: failure };
  const stored = splice(source, edits).replace(/^\s*=\s*/, "").trim();
  const re = parseFormula(stored);
  if (!re.ok) return { ok: false, error: re.error };
  return { ok: true, stored, ast: re.ast };
}

/**
 * Turns the stored form back into names for display, using the names that exist now. `nameOf` returns the name parts
 * of a reference (`["Cột"]`, `["Bảng", "Cột"]`, `["Datahub", "Bảng", "Cột"]`), or null when the target is gone.
 */
export function toDisplayFormula(stored: string, nameOf: (table: string | null, key: string) => string[] | null): string {
  const parsed = parseFormula(stored);
  if (!parsed.ok) return `=${stored}`;
  const edits: { s: number; e: number; text: string }[] = [];
  walk(parsed.ast, (n) => {
    if (n.t !== "key") return;
    const parts = nameOf(n.table, n.key);
    edits.push({ s: n.s, e: n.e, text: parts ? parts.map((p) => `[${p}]`).join(".") : "[#REF!]" });
  });
  return `=${splice(stored, edits)}`;
}

export function parseStored(stored: string): ParseResult {
  return parseFormula(stored);
}
