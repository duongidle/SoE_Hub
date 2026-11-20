import { sql, type SQL } from "drizzle-orm";
import type { FieldSpec } from "@soe/db";
import { columnTypeDef } from "./column-types";
import { effectiveType, errKey, isComputedType } from "./cell-values";
import { assertColumnKey, type DhColumn, type Stored } from "./types";
import { hasAttrs } from "./user-values";

/** A row as the engine loads it (standard columns + the JSONB cells). */
export interface LoadedRow {
  id: string;
  rowNo: number;
  version: number;
  data: Record<string, Stored>;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

/** How a cell is written. The row writer groups cell writes by source. */
export type CellWrite =
  | { source: "jsonb"; key: string; value: Stored }
  /** One person's own value (the actor's): goes to `dh_person_cells`, never to `dh_rows.data`. */
  | { source: "personal"; key: string; value: Stored };

/**
 * Where a column's values live (design module2 section 3, "Hai nguồn cột"; the third source "cột thật của bảng hệ thống" was dropped 19/11/2026,
 * so Deals and every template table also live in `dh_rows`). The engine reads, writes, filters and sorts every column through this interface:
 *  - `jsonb`: inside `dh_rows.data` under the column key (default, implemented here).
 *  - `personal`: a value per person (Stage 4.1c, template columns). Not to be confused with the per-reader values of reader-scoped computed
 *    columns (`dh_personal_rows`, `reader-scope.ts`), which are laid over `data` by `TableAccess.rel()` so a column of this source still reads `data`.
 */
export interface ColumnSource {
  readonly kind: "jsonb" | "personal";
  /** Typed SQL expression for filter and sort, or null when the column cannot be filtered. */
  fieldSpec(col: DhColumn): FieldSpec | null;
  /** SQL that reads the cell as `jsonb` (for the list/get output and `fields=` selection). */
  readExpr(col: DhColumn): SQL;
  /**
   * SQL that reads the raw cell of a row whose data object is the SQL expression `data` (for example `b.data`, or `j1.data` for a
   * joined table folded per base row). `as: "text"` gives `->>` (to be cast by the caller), `"json"` gives `->`. Used by the metric
   * engine, which does not know where a column lives.
   */
  cellExpr(col: DhColumn, data: string, as: "text" | "json"): SQL;
  /** Reads the stored cell from an already loaded row. */
  readCell(row: LoadedRow, col: DhColumn): Stored;
  /** Describes how to write one cell. */
  planWrite(col: DhColumn, value: Stored): CellWrite;
}

export class JsonbSource implements ColumnSource {
  readonly kind = "jsonb" as const;

  fieldSpec(col: DhColumn): FieldSpec | null {
    // A computed column filters, sorts and indexes like the plain type of its result.
    const def = columnTypeDef(effectiveType(col));
    if (!def.fieldType) return null;
    // A list of people with attributes filters as a set of ids ("contains this person"), never as one uuid.
    if (hasAttrs(col)) return { type: "set", expr: sql.raw(`to_jsonb(soe_dh_ids(data->'${assertColumnKey(col.key)}'))`), sortable: false, selectable: false };
    return {
      type: def.fieldType,
      expr: def.expr(col.key),
      ...(def.sortExpr?.(col) ? { sortExpr: def.sortExpr(col)! } : {}),
      sortable: def.sortable,
      selectable: false,
    };
  }

  readExpr(col: DhColumn): SQL {
    const def = columnTypeDef(col.type);
    if (def.virtual) return sql`to_jsonb(${def.expr(col.key)})`;
    // The error of a computed cell (`#DIV/0!`) lives under its own key and is shown in place of the value.
    if (isComputedType(col.type)) return sql.raw(`coalesce(data->'${assertColumnKey(col.key)}', to_jsonb(data->>'${errKey(assertColumnKey(col.key))}'))`);
    return sql.raw(`data->'${assertColumnKey(col.key)}'`);
  }

  cellExpr(col: DhColumn, data: string, as: "text" | "json"): SQL {
    return sql.raw(`${data}${as === "text" ? "->>" : "->"}'${assertColumnKey(col.key)}'`);
  }

  readCell(row: LoadedRow, col: DhColumn): Stored {
    return row.data[col.key] ?? null;
  }

  planWrite(col: DhColumn, value: Stored): CellWrite {
    return { source: "jsonb", key: col.key, value };
  }
}

/**
 * A value per person (design module2 section 3, module4 3.4): custom columns and "mỗi người một giá trị" template columns. The values live in
 * `dh_person_cells` and `TableAccess.rel()` lays the reader's own over `data`, so filter, sort, read and the metric engine see them exactly like a
 * JSONB cell and only the WRITE differs: it goes to the person's own row of values, never to `dh_rows`. Nobody reads another person's value.
 */
export class PersonalSource implements ColumnSource {
  readonly kind = "personal" as const;
  private readonly inner = new JsonbSource();
  fieldSpec = (col: DhColumn) => this.inner.fieldSpec(col);
  readExpr = (col: DhColumn) => this.inner.readExpr(col);
  cellExpr = (col: DhColumn, data: string, as: "text" | "json") => this.inner.cellExpr(col, data, as);
  readCell = (row: LoadedRow, col: DhColumn) => this.inner.readCell(row, col);
  planWrite(col: DhColumn, value: Stored): CellWrite {
    return { source: "personal", key: col.key, value };
  }
}

const sources = { jsonb: new JsonbSource(), personal: new PersonalSource() };

/** The source of a column: `dh_columns.storage` (`person` = the personal source, everything else JSONB). */
export function sourceOf(col: DhColumn): ColumnSource {
  return col.storage === "person" ? sources.personal : sources.jsonb;
}
