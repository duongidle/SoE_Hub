import { sql } from "drizzle-orm";
import { AppError, type FilterNode, type SortItem } from "@soe/shared";
import type { Executor, FieldMap, FieldSpec } from "@soe/db";
import { sourceOf, type LoadedRow } from "./column-source";
import { CellError, type DhColumn, type Stored } from "./types";
import { columnTypeDef, type ColCtx } from "./column-types";
import type { TableAccess } from "./access";
import { exposeErrors } from "./cell-values";

type Raw = Record<string, unknown>;

export function columnFromDb(r: Raw): DhColumn {
  return {
    id: r.id as string,
    tableId: r.table_id as string,
    key: r.key as string,
    name: r.name as string,
    type: r.type as DhColumn["type"],
    config: (r.config as DhColumn["config"]) ?? {},
    position: r.position as number,
    required: !!r.required,
    allowEdit: r.allow_edit === undefined ? true : !!r.allow_edit,
    readerScoped: !!r.reader_scoped,
    layer: (r.layer as DhColumn["layer"] | undefined) ?? null,
    layerRef: (r.layer_ref as string | null | undefined) ?? null,
    layerRoles: (r.layer_roles as string[] | null | undefined) ?? null,
    storage: r.storage === "person" ? "person" : "shared",
    role: (r.role as string | null | undefined) ?? null,
    autofill: (r.autofill as DhColumn["autofill"] | undefined) ?? null,
    protected: !!r.protected,
    isUnique: !!r.is_unique,
    defaultValue: r.default_value ?? null,
    description: (r.description as string | null) ?? null,
    display: (r.display as Record<string, unknown>) ?? {},
    version: r.version as number,
    deletedAt: (r.deleted_at as Date | null) ?? null,
    calcStatus: (r.calc_status as string | undefined) ?? "ready",
    calcDone: (r.calc_done as number | null | undefined) ?? null,
    calcTotal: (r.calc_total as number | null | undefined) ?? null,
    calcAt: (r.calc_at as Date | null | undefined) ?? null,
    calcSeq: Number((r.calc_seq as string | number | null | undefined) ?? 0),
  };
}

export function rowFromDb(r: Raw): LoadedRow {
  return {
    id: r.id as string,
    rowNo: r.row_no as number,
    version: r.version as number,
    data: (r.data as Record<string, Stored>) ?? {},
    createdAt: r.created_at as Date,
    createdBy: (r.created_by as string | null) ?? null,
    updatedAt: r.updated_at as Date,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

/** Standard fields of a row that filters, sorts and `fields=` can address. API names start with an underscore. */
const META: Record<string, { field: string; spec: FieldSpec }> = {
  _id: { field: "id", spec: { type: "uuid", expr: sql`id`, selectable: true } },
  _row_no: { field: "row_no", spec: { type: "number", expr: sql`row_no`, selectable: true } },
  _version: { field: "version", spec: { type: "number", expr: sql`version`, selectable: true } },
  _created_at: { field: "created_at", spec: { type: "datetime", expr: sql`created_at`, selectable: true } },
  _updated_at: { field: "updated_at", spec: { type: "datetime", expr: sql`updated_at`, selectable: true } },
  _created_by: { field: "created_by", spec: { type: "uuid", expr: sql`created_by`, selectable: true } },
  _updated_by: { field: "updated_by", spec: { type: "uuid", expr: sql`updated_by`, selectable: true } },
};
export const META_FIELDS = Object.keys(META);

export const normName = (s: string) => s.normalize("NFC").trim().toLowerCase();

/** The columns of a table at one moment, with name/key resolution and the FieldMap built from the column sources. */
export class TableSchema {
  /** The live columns THIS person sees (template layers hide some: design module4 3.1). */
  readonly alive: DhColumn[];
  /** Every live column of the table, hidden ones included: what a write must keep whole (search text, same-row formulas), never what a person is shown. */
  readonly aliveAll: DhColumn[];
  /** Keys of the columns in `dh_rows.data` that this person does not see; their values are left out of every row shown. */
  readonly hiddenKeys: Set<string>;
  private readonly byKey = new Map<string, DhColumn>();
  private readonly byName = new Map<string, DhColumn>();

  constructor(
    readonly tableId: string,
    /** Live columns, then (when asked) trashed ones, by position. */
    readonly all: DhColumn[],
    hidden: DhColumn[] = [],
  ) {
    this.alive = all.filter((c) => !c.deletedAt);
    this.aliveAll = [...this.alive, ...hidden.filter((c) => !c.deletedAt && c.storage === "shared")];
    this.hiddenKeys = new Set(hidden.filter((c) => c.storage === "shared").map((c) => c.key));
    for (const c of all) this.byKey.set(c.key, c);
    for (const c of this.alive) this.byName.set(normName(c.name), c);
  }

  static async load(db: Executor, access: TableAccess): Promise<TableSchema> {
    const res = await db.execute(sql`SELECT * FROM dh_columns WHERE ${access.scope()} ORDER BY position, created_at, id`);
    const cols = (res.rows as Raw[]).map(columnFromDb);
    return new TableSchema(access.tableId, cols.filter((c) => access.canSeeColumn(c)), cols.filter((c) => !access.canSeeColumn(c)));
  }

  /** A column by key (also trashed ones) or by name (live ones only). Null when none matches. */
  tryResolve(ref: string): DhColumn | null {
    return this.byKey.get(ref) ?? this.byName.get(normName(ref)) ?? null;
  }

  /** Like `tryResolve` but a missing column is a validation error with a Vietnamese message. */
  resolve(ref: string, code: "validation_error" | "invalid_filter" = "validation_error"): DhColumn {
    const c = this.tryResolve(ref);
    if (!c || c.deletedAt) throw new AppError(code, `Không có cột "${ref}" trong bảng này.`, { column: ref });
    return c;
  }

  ctx(col: DhColumn): ColCtx {
    return col;
  }

  /** Column key for an API reference, or the standard field name when the reference is `_row_no`, `_created_at`... */
  fieldFor(ref: string): string {
    const m = META[ref];
    if (m && !this.byKey.has(ref)) return m.field;
    return this.resolve(ref, "invalid_filter").key;
  }

  /** FieldMap for the filter DSL, sort and keyset. Built from each column's source. */
  fieldMap(): FieldMap {
    const map: FieldMap = { id: META._id!.spec };
    for (const m of Object.values(META)) map[m.field] = m.spec;
    for (const c of this.alive) {
      const spec = sourceOf(c).fieldSpec(c);
      if (spec) map[c.key] = spec;
    }
    return map;
  }

  /**
   * Rewrites a filter from API references (key or name) to column keys, resolves select option names to ids, and turns
   * `eq null` into `is_empty`. The DSL compiler then checks types and operators.
   */
  normalizeFilter(node: FilterNode | undefined | null): FilterNode | undefined {
    if (!node) return undefined;
    const walk = (n: FilterNode): FilterNode => {
      if ("and" in n) return { and: n.and.map(walk) };
      if ("or" in n) return { or: n.or.map(walk) };
      const field = this.fieldFor(n.field);
      const { op } = n;
      let { value } = n;
      if ((op === "eq" || op === "neq") && value === null) {
        return { field, op: op === "eq" ? "is_empty" : "is_not_empty" };
      }
      const col = this.byKey.get(field);
      if (col && value !== undefined && value !== null && (col.type === "single_select" || col.type === "multi_select")) {
        const def = columnTypeDef(col.type);
        const one = (v: unknown) => {
          try {
            const r = def.type === "multi_select" ? (def.parse([v], col) as string[] | null)?.[0] : def.parse(v, col);
            if (typeof r !== "string") throw new CellError(`Lựa chọn không có trong cột "${col.name}".`);
            return r;
          } catch (e) {
            if (e instanceof CellError) throw new AppError("invalid_filter", e.message, { column: col.name });
            throw e;
          }
        };
        value = Array.isArray(value) ? value.map(one) : one(value);
      }
      return value === undefined ? { field, op } : { field, op, value };
    };
    return walk(node);
  }

  /**
   * Sort: a JSON array `[{field, dir, nulls}]` or `field:dir:nulls,...`. Field = column key or name, or a standard field
   * (`_row_no`, `_created_at`...). Returns items on column keys.
   */
  normalizeSort(raw: string | null | undefined): SortItem[] {
    if (!raw) return [];
    let items: SortItem[];
    const t = raw.trim();
    if (t.startsWith("[")) {
      let arr: unknown;
      try {
        arr = JSON.parse(t);
      } catch {
        throw new AppError("invalid_filter", "Sắp xếp phải là JSON hợp lệ.");
      }
      if (!Array.isArray(arr) || arr.length === 0 || arr.length > 5) throw new AppError("invalid_filter", "Sắp xếp gồm 1 đến 5 cột.");
      items = arr.map((x) => {
        const o = x as { field?: unknown; dir?: unknown; nulls?: unknown };
        if (typeof o?.field !== "string" || (o.dir !== undefined && o.dir !== "asc" && o.dir !== "desc") || (o.nulls !== undefined && o.nulls !== "first" && o.nulls !== "last")) {
          throw new AppError("invalid_filter", "Mỗi mục sắp xếp cần {field, dir?, nulls?}.");
        }
        return { field: o.field, dir: (o.dir as "asc" | "desc" | undefined) ?? "asc", ...(o.nulls ? { nulls: o.nulls as "first" | "last" } : {}) };
      });
    } else {
      // The plain form accepts references with spaces too: split on commas, then on the LAST colons.
      items = t.split(",").map((part) => {
        const bits = part.trim().split(":");
        let nulls: "first" | "last" | undefined;
        let dir: "asc" | "desc" = "asc";
        if (bits.length > 1 && (bits[bits.length - 1] === "first" || bits[bits.length - 1] === "last")) nulls = bits.pop() as "first" | "last";
        if (bits.length > 1 && (bits[bits.length - 1] === "asc" || bits[bits.length - 1] === "desc")) dir = bits.pop() as "asc" | "desc";
        const field = bits.join(":").trim();
        if (!field) throw new AppError("invalid_filter", `Sắp xếp không hợp lệ: "${part}".`);
        return { field, dir, ...(nulls ? { nulls } : {}) };
      });
      if (items.length > 5) throw new AppError("invalid_filter", "Sắp xếp tối đa 5 cột.");
    }
    return items.map((s) => ({ ...s, field: this.fieldFor(s.field) }));
  }

  /** References of `fields=`, resolved to live columns (keys) or standard field names. */
  parseSelect(raw: string | null | undefined): { columns: DhColumn[]; meta: string[] } | null {
    if (!raw) return null;
    const refs = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
    const columns: DhColumn[] = [];
    const meta: string[] = [];
    for (const r of refs) {
      if (META[r] && !this.byKey.has(r)) {
        meta.push(META[r]!.field);
        continue;
      }
      const c = this.tryResolve(r);
      if (!c || c.deletedAt) throw new AppError("invalid_filter", `Không có cột "${r}" trong bảng này.`, { column: r });
      columns.push(c);
    }
    return { columns, meta };
  }
}

export interface ApiRow {
  id: string;
  row_no: number;
  version: number;
  created_at: string | Date;
  created_by: string | null;
  updated_at: string | Date;
  updated_by: string | null;
  data: Record<string, unknown>;
}

/** Row in API shape. `labels=true` turns select option ids into names. */
export function toApiRow(row: LoadedRow, schema: TableSchema, labels = false): ApiRow {
  let data: Record<string, unknown> = exposeErrors(row.data);
  // A template column this person does not see (another team's, another role's) keeps its values out of their rows (module4 3.1).
  if (schema.hiddenKeys.size) data = Object.fromEntries(Object.entries(data).filter(([k]) => !schema.hiddenKeys.has(k.startsWith("!") ? k.slice(1) : k)));
  if (labels) {
    const plain = data;
    data = {};
    for (const [k, v] of Object.entries(plain)) {
      const c = schema.tryResolve(k);
      const def = c ? columnTypeDef(c.type) : null;
      data[k] = c && def?.toLabel ? def.toLabel(v as Stored, c) : v;
    }
  }
  return {
    id: row.id,
    row_no: row.rowNo,
    version: row.version,
    created_at: row.createdAt,
    created_by: row.createdBy,
    updated_at: row.updatedAt,
    updated_by: row.updatedBy,
    data,
  };
}
