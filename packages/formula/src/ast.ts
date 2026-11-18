import type { FormulaErrorCode } from "./types";

interface Pos {
  /** Offsets in the source text (start inclusive, end exclusive). */
  s: number;
  e: number;
}

export type Node =
  | ({ t: "num"; v: number } & Pos)
  | ({ t: "str"; v: string } & Pos)
  | ({ t: "bool"; v: boolean } & Pos)
  | ({ t: "err"; v: FormulaErrorCode } & Pos)
  | ({ t: "empty" } & Pos)
  /** A reference written with names: `[Cột]`, `[Bảng].[Cột]`, `[Datahub].[Bảng].[Cột]`. */
  | ({ t: "ref"; parts: string[] } & Pos)
  /** A reference written with keys (the stored form): `{c_ab12}` (cell of this row) or `{<table id>.c_ab12}` (a whole column). */
  | ({ t: "key"; table: string | null; key: string } & Pos)
  | ({ t: "call"; name: string; args: Node[]; id: number } & Pos)
  | ({ t: "un"; op: "-" | "+"; a: Node } & Pos)
  | ({ t: "pct"; a: Node } & Pos)
  | ({ t: "bin"; op: BinOp; l: Node; r: Node } & Pos);

export type BinOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | "<=" | ">" | ">=";

export interface ParseError {
  message: string;
  start: number;
  end: number;
}

export type ParseResult = { ok: true; ast: Node; text: string } | { ok: false; error: ParseError };

export function walk(n: Node, fn: (n: Node) => void): void {
  fn(n);
  switch (n.t) {
    case "call":
      n.args.forEach((a) => walk(a, fn));
      break;
    case "un":
    case "pct":
      walk(n.a, fn);
      break;
    case "bin":
      walk(n.l, fn);
      walk(n.r, fn);
      break;
    default:
  }
}
