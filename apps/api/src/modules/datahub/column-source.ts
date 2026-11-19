import { sql, type SQL } from "drizzle-orm";
import type { FieldSpec } from "@soe/db";
import { AppError } from "@soe/shared";
import { columnTypeDef } from "./column-types";
import { effectiveType, errKey, isComputedType } from "./cell-values";
import { assertColumnKey, type DhColumn, type Stored } from "./types";

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
  | { source: "jsonb"; key: string; value: Stored };
// TODO(Stage 4, Module 4): add `{ source: "physical"; column: string; value: Stored }`.
// TODO(Stage 4, Module 4): add `{ source: "personal"; key: string; userId: string; value: Stored }`.

/**
 * Where a column's values live (design module2 section 3, "Ba nguồn cột"). The engine reads, writes, filters and
 * sorts every column through this interface, so a column that lives elsewhere behaves like the others:
 *  - `jsonb`: inside `dh_rows.data` under the column key (default, implemented here).
 *  - `physical`: a real Postgres column of a system table such as Deals (Stage 4).
 *  - `personal`: a value per person, kept in its own table, visible to the owner and their leader (Stage 4).
 */
export interface ColumnSource {
  readonly kind: "jsonb" | "physical" | "personal";
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

const notYet = (what: string) => (): never => {
  throw new AppError("internal_error", `Nguồn cột "${what}" chưa được cài đặt (làm ở Stage 4).`);
};

/**
 * TODO(Stage 4): cột thật của bảng hệ thống (Deals). `fieldSpec` trả biểu thức là cột Postgres (có index sẵn),
 * `readExpr` là `to_jsonb(cột)`, `planWrite` là `UPDATE ... SET cột = ?` trên bảng của Deals.
 */
export class PhysicalSource implements ColumnSource {
  readonly kind = "physical" as const;
  fieldSpec = notYet("physical");
  readExpr = notYet("physical");
  cellExpr = notYet("physical");
  readCell = notYet("physical");
  planWrite = notYet("physical");
}

/**
 * TODO(Stage 4): giá trị riêng theo từng người (cột cá nhân). Đọc/ghi bảng giá trị theo (dòng, người);
 * lọc và sắp xếp join theo người đang xem; Guest không bao giờ đọc được nguồn này.
 */
export class PersonalSource implements ColumnSource {
  readonly kind = "personal" as const;
  fieldSpec = notYet("personal");
  readExpr = notYet("personal");
  cellExpr = notYet("personal");
  readCell = notYet("personal");
  planWrite = notYet("personal");
}

const sources = { jsonb: new JsonbSource(), physical: new PhysicalSource(), personal: new PersonalSource() };

/** The source of a column. Stage 4 records physical/personal columns with `config.__source`; today all are JSONB. */
export function sourceOf(col: DhColumn): ColumnSource {
  const k = (col.config?.__source as keyof typeof sources | undefined) ?? "jsonb";
  return sources[k] ?? sources.jsonb;
}
