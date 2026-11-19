import { sql, type SQL } from "drizzle-orm";
import { AppError } from "@soe/shared";

/**
 * A column as the metric engine sees it: where its value lives and what it is. The API builds these from the Datahub columns
 * (a computed column counts as its result type), so this package never needs to know the column types of the Datahub.
 */
export type ValueKind = "number" | "date" | "datetime" | "text" | "enum" | "boolean" | "uuid" | "set";

export interface MColumn {
  /** Stable key inside `dh_rows.data` (or `_created_at`... for a standard field). */
  key: string;
  name: string;
  kind: ValueKind;
  /** A standard field of the row instead of a cell. Only the base table has them. */
  meta?: "id" | "row_no" | "created_at" | "updated_at" | "created_by" | "updated_by";
  /** `enum`: options, to turn stored ids into names. */
  options?: { id: string; name: string }[];
  /** Relation column: id of the table it links to. */
  relationTarget?: string;
  /** Name of the Datahub column type, for messages. */
  typeLabel?: string;
}

export interface MTable {
  id: string;
  name: string;
  columns: MColumn[];
  /** `table_id = <this table>` for rows aliased `alias`, with the scope marker (`TableAccess.scope`). */
  scope: (alias: string) => SQL;
}

const KEY_RE = /^[a-z_][a-z0-9_]{0,40}$/;
const assertKey = (k: string): string => {
  if (!KEY_RE.test(k)) throw new AppError("internal_error", "Mã cột không hợp lệ.");
  return k;
};

export const normRef = (s: string): string => s.normalize("NFC").trim().toLowerCase();

/** Finds a column by key or by name (not case sensitive). */
export function findColumn(t: MTable, ref: string): MColumn | null {
  const n = normRef(ref);
  return t.columns.find((c) => c.key === ref) ?? t.columns.find((c) => normRef(c.name) === n) ?? null;
}

const META_SQL: Record<NonNullable<MColumn["meta"]>, (a: string) => string> = {
  id: (a) => `${a}.id`,
  row_no: (a) => `${a}.row_no`,
  created_at: (a) => `${a}.created_at`,
  updated_at: (a) => `${a}.updated_at`,
  created_by: (a) => `${a}.created_by`,
  updated_by: (a) => `${a}.updated_by`,
};

/**
 * Where a table's rows are read from in a query: `alias` is the row alias of the base table (standard fields live there); the
 * cells are in `data` (`b.data` for the base table, `j1.data` for a joined table: the values folded per base row).
 */
export interface TableRef {
  alias: string;
  data: string;
  /** True for the base table (`dh_rows b`); only then standard fields exist. */
  isBase: boolean;
}

/** The typed SQL value of a column (the same conversions as the Datahub column types, so a metric and a filter agree). */
export function valueExpr(ref: TableRef, col: MColumn): SQL {
  if (col.meta) {
    if (!ref.isBase) throw new AppError("validation_error", `Cột "${col.name}" là trường chuẩn của dòng, chỉ dùng được ở bảng chính.`, { column: col.name });
    const e = sql.raw(META_SQL[col.meta](ref.alias));
    return col.meta === "row_no" ? sql`(${e})::numeric` : e;
  }
  const k = assertKey(col.key);
  const txt = sql.raw(`${ref.data}->>'${k}'`);
  switch (col.kind) {
    case "number": return sql`(${txt})::numeric`;
    case "date": return sql`soe_date(${txt})`;
    case "datetime": return sql`soe_ts(${txt})`;
    case "boolean": return sql`coalesce((${txt})::boolean, false)`;
    case "uuid": return sql`(${txt})::uuid`;
    case "set": return sql.raw(`${ref.data}->'${k}'`);
    default: return txt;
  }
}

/** Resolves an enum value typed as a name (or an id) to the stored option id. */
export function optionId(col: MColumn, v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const opts = col.options ?? [];
  const n = normRef(v);
  return (opts.find((o) => o.id === v) ?? opts.find((o) => normRef(o.name) === n))?.id;
}
