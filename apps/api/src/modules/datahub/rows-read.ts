import { sql, type SQL } from "drizzle-orm";
import { AppError, DH_AUTO_INDEX_MIN_ROWS, type FilterNode, type SortItem } from "@soe/shared";
import { listPage, type Executor } from "@soe/db";
import type { ListOutput } from "../../core/types";
import type { TableAccess } from "./access";
import { sourceOf } from "./column-source";
import { columnTypeDef } from "./column-types";
import { effectiveType } from "./cell-values";
import { assertColumnKey } from "./types";
import { META_FIELDS, normName, type TableSchema } from "./table-schema";
import { exposeErrors } from "./cell-values";

export interface RowQuery {
  filter?: FilterNode;
  sort?: string;
  fields?: string;
  limit?: number;
  cursor?: string;
  includeTotal?: boolean;
  /** Table-wide text search: every word must appear in some text cell (accent and case insensitive). */
  search?: string;
  labels?: boolean;
}

const DEFAULT_META = ["id", "row_no", "version", "created_at", "created_by", "updated_at", "updated_by"];

/** Builds the `data` select for the chosen columns (`fields=`), or the whole JSONB when none is chosen. */
function dataSelect(schema: TableSchema, sel: ReturnType<TableSchema["parseSelect"]>): SQL {
  if (!sel) return sql`data AS cells`;
  if (sel.columns.length === 0) return sql`'{}'::jsonb AS cells`;
  const parts = sel.columns.map((c) => sql`${sql.raw(`'${assertColumnKey(c.key)}'`)}, ${sourceOf(c).readExpr(c)}`);
  void schema;
  return sql`jsonb_strip_nulls(jsonb_build_object(${sql.join(parts, sql`, `)})) AS cells`;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

type Shaped = Record<string, unknown> & { data: Record<string, unknown> };

function shape(items: Record<string, unknown>[], schema: TableSchema, labels: boolean): Shaped[] {
  return items.map((it) => {
    const { cells, ...meta } = it as { cells: Record<string, unknown> } & Record<string, unknown>;
    let data = exposeErrors(cells ?? {});
    if (labels) {
      const plain = data;
      data = {};
      for (const [k, v] of Object.entries(plain)) {
        const c = schema.tryResolve(k);
        const def = c ? columnTypeDef(c.type) : null;
        data[k] = c && def?.toLabel ? def.toLabel(v as never, c) : v;
      }
    }
    return { ...meta, data };
  });
}

/** Lists live rows: filter DSL, multi-level sort (option order, nulls first/last), keyset pages, `fields=`. */
export async function listRows(db: Executor, access: TableAccess, schema: TableSchema, q: RowQuery): Promise<ListOutput<Shaped>> {
  const filter = schema.normalizeFilter(q.filter);
  const sortItems = schema.normalizeSort(q.sort);
  const sel = schema.parseSelect(q.fields);
  const where: SQL[] = [access.scope(), sql`deleted_at IS NULL`];
  for (const tok of (q.search ?? "").split(/\s+/).filter(Boolean).slice(0, 8)) {
    where.push(sql`soe_unaccent(lower(search)) LIKE soe_unaccent(lower(${`%${escapeLike(tok)}%`})) ESCAPE '\\'`);
  }
  const page = await listPage<Record<string, unknown>>(db, {
    from: sql`dh_rows`,
    fields: schema.fieldMap(),
    baseWhere: sql.join(where, sql` AND `),
    filter,
    sortItems: sortItems.length ? sortItems : [{ field: "row_no", dir: "asc" }],
    defaultSort: [{ field: "row_no", dir: "asc" }],
    select: (sel ? ["id", ...sel.meta.filter((m) => m !== "id")] : DEFAULT_META).join(","),
    extraSelect: [dataSelect(schema, sel)],
    limit: q.limit,
    cursor: q.cursor,
    includeTotal: q.includeTotal,
  });
  // Best effort: never let index bookkeeping break a read.
  await noteIndexUse(db, access, schema, filter, sortItems).catch(() => {});
  return { ...page, items: shape(page.items, schema, q.labels ?? false) };
}

export async function getRow(db: Executor, access: TableAccess, schema: TableSchema, rowId: string, o: { fields?: string; labels?: boolean; includeDeleted?: boolean } = {}): Promise<Shaped> {
  const sel = schema.parseSelect(o.fields);
  const meta = sel ? ["id", ...sel.meta.filter((m) => m !== "id")] : DEFAULT_META;
  const res = await db.execute(sql`SELECT ${sql.join(meta.map((m) => sql.raw(m)), sql`, `)}, ${dataSelect(schema, sel)} FROM dh_rows WHERE ${access.scope()} AND id = ${rowId}::uuid ${o.includeDeleted ? sql`` : sql`AND deleted_at IS NULL`}`);
  const r = res.rows[0] as Record<string, unknown> | undefined;
  if (!r) throw new AppError("not_found", "Không tìm thấy dòng.");
  return shape([r], schema, o.labels ?? false)[0]!;
}

const seenRequests = new Set<string>();

type Kind = "num" | "text" | "date" | "ts" | "bool" | "uuid" | "trgm";

/**
 * Auto index (Module 0 section 6.2, design module2 section 3): a table above `DH_AUTO_INDEX_MIN_ROWS` rows that is
 * filtered or sorted on a column asks for an expression index; the worker job builds it. One request per
 * (table, column, kind), remembered in `dh_index_requests`; the process remembers what it already asked.
 */
export async function noteIndexUse(db: Executor, access: TableAccess, schema: TableSchema, filter: FilterNode | undefined, sort: SortItem[]): Promise<void> {
  if (access.table.rowCount < DH_AUTO_INDEX_MIN_ROWS) return;
  const uses = new Map<string, { key: string; kind: Kind }>();
  const add = (key: string, kind: Kind | null) => {
    if (kind) uses.set(`${access.tableId}:${key}:${kind}`, { key, kind });
  };
  const walk = (n: FilterNode | undefined) => {
    if (!n) return;
    if ("and" in n) return n.and.forEach(walk);
    if ("or" in n) return n.or.forEach(walk);
    const col = schema.tryResolve(n.field);
    if (!col || META_FIELDS.includes(n.field)) return;
    const def = columnTypeDef(effectiveType(col));
    if (def.virtual) return;
    add(col.key, def.fieldType === "text" && (n.op === "contains" || n.op === "starts_with") ? "trgm" : def.indexKind);
  };
  walk(filter);
  for (const s of sort) {
    const col = schema.tryResolve(s.field);
    if (!col) continue;
    const def = columnTypeDef(effectiveType(col));
    if (!def.virtual && !def.sortExpr?.(col)) add(col.key, def.indexKind);
  }
  for (const [ck, u] of uses) {
    if (seenRequests.has(ck)) continue;
    seenRequests.add(ck);
    await db.execute(sql`INSERT INTO dh_index_requests (table_id, column_key, kind, rows_at_request) VALUES (${access.tableId}::uuid, ${u.key}, ${u.kind}, ${access.table.rowCount}) ON CONFLICT DO NOTHING`);
  }
}

export interface HistoryItem {
  version: number;
  op: string;
  at: Date;
  actor: unknown;
  changes: { field: string; field_name: string | null; old: unknown; new: unknown }[];
}

/** History of one row (newest first). Keyset on `version`: `before` = last version of the previous page. */
export async function rowHistory(db: Executor, access: TableAccess, schema: TableSchema, rowId: string, o: { limit: number; before?: number }): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
  const res = await db.execute(sql`SELECT version, op, at, actor, changes FROM row_history
    WHERE table_id = ${access.tableId} AND row_id = ${rowId}::uuid ${o.before !== undefined ? sql`AND version < ${o.before}` : sql``}
    ORDER BY version DESC LIMIT ${o.limit + 1}`);
  const rows = res.rows as { version: number; op: string; at: Date; actor: unknown; changes: { field: string; old: unknown; new: unknown }[] }[];
  const more = rows.length > o.limit;
  const page = more ? rows.slice(0, o.limit) : rows;
  const items = page.map((r) => ({
    version: r.version,
    op: r.op,
    at: r.at,
    actor: r.actor,
    changes: r.changes.map((c) => ({ field: c.field, field_name: schema.all.find((x) => x.key === c.field)?.name ?? null, old: c.old, new: c.new })),
  }));
  return { items, nextCursor: more ? String(page[page.length - 1]!.version) : null };
}

export { normName };
