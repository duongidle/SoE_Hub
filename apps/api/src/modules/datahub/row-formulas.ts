import { collectDeps, evaluate, FError, parseFormula, type EvalContext, type Node } from "@soe/formula";
import { applyOutcome, cellValue, resultTypeOf, valueToStored } from "./cell-values";
import type { TableSchema } from "./table-schema";
import type { DhColumn, Stored } from "./types";

const parseCache = new Map<string, Node | null>();

export function parsedExpr(expr: string): Node | null {
  let ast = parseCache.get(expr);
  if (ast === undefined) {
    const r = parseFormula(expr);
    ast = r.ok ? r.ast : null;
    if (parseCache.size > 1000) parseCache.clear();
    parseCache.set(expr, ast);
  }
  return ast;
}

interface Compiled {
  col: DhColumn;
  ast: Node | null;
  cells: string[];
}

export interface RowMeta {
  id: string;
  rowNo: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

/**
 * Formulas that read only cells of their own row. The API computes them in the transaction that saves the row, so the
 * value is there at once (design module2 section 6.5). Formulas that read other tables or linked rows are left to the worker.
 */
export class RowFormulas {
  private constructor(
    private readonly formulas: Compiled[],
    private readonly byKey: Map<string, DhColumn>,
  ) {}

  /** Null when the table has no such formula. */
  static for(schema: TableSchema): RowFormulas | null {
    const compiled: Compiled[] = [];
    for (const c of schema.aliveAll) {
      if (c.type !== "formula" || typeof c.config.expr !== "string") continue;
      // A value that depends on who reads it cannot be computed here, from one row: the worker computes it for each reader.
      if (c.readerScoped) continue;
      const ast = parsedExpr(c.config.expr);
      if (ast && collectDeps(ast).ranges.length > 0) continue;
      compiled.push({ col: c, ast, cells: ast ? collectDeps(ast).cells : [] });
    }
    if (compiled.length === 0) return null;
    // Dependency order: a formula runs after the formulas of this row it reads.
    const keys = new Set(compiled.map((f) => f.col.key));
    const ordered: Compiled[] = [];
    const done = new Set<string>();
    const visit = (f: Compiled, path: Set<string>) => {
      if (done.has(f.col.key) || path.has(f.col.key)) return;
      path.add(f.col.key);
      for (const k of f.cells) {
        if (keys.has(k)) visit(compiled.find((x) => x.col.key === k)!, path);
      }
      done.add(f.col.key);
      ordered.push(f);
    };
    compiled.forEach((f) => visit(f, new Set()));
    return new RowFormulas(ordered, new Map(schema.aliveAll.map((c) => [c.key, c])));
  }

  /** Computes every formula for one row, writing values (and errors) into `data`. Returns the keys that changed. */
  compute(data: Record<string, Stored>, meta: RowMeta, now: Date): string[] {
    const changed: string[] = [];
    const row = { ...meta, data, version: 0 };
    const ctx: EvalContext = {
      now,
      cell: (key) => {
        const c = this.byKey.get(key);
        if (!c) throw new FError("#REF!", "Cột được tham chiếu đã bị xoá.");
        return cellValue(c, row);
      },
      range: () => {
        throw new FError("#REF!", "Công thức này đọc cả cột nên do worker tính.");
      },
      rowInfo: () => ({ id: meta.id, rowNo: meta.rowNo, createdAt: cellValue({ type: "created_time", key: "_", config: {} } as DhColumn, row) as number, modifiedAt: cellValue({ type: "modified_time", key: "_", config: {} } as DhColumn, row) as number }),
    };
    for (const f of this.formulas) {
      const out = f.ast ? valueToStored(resultTypeOf(f.col), evaluate(f.ast, ctx)) : ({ kind: "error", code: "#NAME?" } as const);
      if (applyOutcome(data, f.col, out)) changed.push(f.col.key);
    }
    return changed;
  }
}
