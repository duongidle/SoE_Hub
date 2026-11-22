import { sql, type SQL } from "drizzle-orm";
import { AppError, DH_AUTO_INDEX_MIN_ROWS, type FilterNode, type SortItem } from "@soe/shared";
import { compileFilter, listPage, type Executor } from "@soe/db";
import type { ListOutput } from "../../core/types";
import type { TableAccess } from "./access";
import { sourceOf } from "./column-source";
import { columnTypeDef } from "./column-types";
import { effectiveType } from "./cell-values";
import { assertColumnKey } from "./types";
import { META_FIELDS, normName, type TableSchema } from "./table-schema";
import { exposeErrors } from "./cell-values";
import { pendingCells, wantedSeq, waitConsistent, type Consistency } from "./consistency";
import { readSetting } from "../system/settings-catalog";
import { DH_SETTINGS } from "./limits";
import { hasAttrs } from "./user-values";
import { andFilter, timeFilterNode } from "./time-filter";

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
  /** Time filter of the table (design module2 section 5.4), combined with `filter` by AND. */
  timeFilter?: unknown;
  /**
   * Colour rules of the view: filters whose match is reported per row as `marks` (indexes of the rules the row satisfies), so the
   * screen never evaluates a condition itself.
   */
  marks?: FilterNode[];
  /** Window read: skip this many rows instead of following `cursor` (a jump to a far position). */
  offset?: number;
  /** With `offset`: count from the END of the list (the page still comes back in normal order). */
  reverse?: boolean;
  /** Wait until the computed columns have incorporated this change sequence (design module2 section 6.7). */
  consistentAfter?: number;
  /** Wait for the newest change sequence at the time of the call. */
  consistent?: boolean;
}

export interface ConsistencyOpts {
  consistentAfter?: number;
  consistent?: boolean;
}

/** Waits (bounded by the setting `datahub.consistent_wait_ms`) when the caller asked for it. `null` = not asked. */
async function awaitConsistency(db: Executor, tableId: string, o: ConsistencyOpts): Promise<Consistency | null> {
  const seq = await wantedSeq(db, o);
  if (seq === null) return null;
  return waitConsistent(db, tableId, seq, await readSetting(db, DH_SETTINGS.consistentWaitMs));
}

const DEFAULT_META = ["id", "row_no", "version", "created_at", "created_by", "updated_at", "updated_by"];
/** Who created or changed a row is another person's id: a Guest does not get it, on any channel (web, API, export). */
const GUEST_HIDDEN_META = new Set(["created_by", "updated_by"]);
const metaOf = (access: TableAccess, sel: ReturnType<TableSchema["parseSelect"]>): string[] => {
  const meta = sel ? ["id", ...sel.meta.filter((m) => m !== "id")] : DEFAULT_META;
  return access.guest ? meta.filter((m) => !GUEST_HIDDEN_META.has(m)) : meta;
};

/** Builds the `data` select for the chosen columns (`fields=`), or the whole JSONB when none is chosen. */
function dataSelect(schema: TableSchema, sel: ReturnType<TableSchema["parseSelect"]>): SQL {
  if (!sel) {
    // Columns this person does not see (another team's, a Guest's ungranted ones) stay out of the cells, not only out of the schema.
    if (schema.hiddenKeys.size === 0) return sql`data AS cells`;
    const strip = [...schema.hiddenKeys].flatMap((k) => [`'${assertColumnKey(k)}'`, `'!${assertColumnKey(k)}'`]).join(",");
    return sql`(data - ${sql.raw(`ARRAY[${strip}]::text[]`)}) AS cells`;
  }
  if (sel.columns.length === 0) return sql`'{}'::jsonb AS cells`;
  const parts = sel.columns.map((c) => sql`${sql.raw(`'${assertColumnKey(c.key)}'`)}, ${sourceOf(c).readExpr(c)}`);
  void schema;
  return sql`jsonb_strip_nulls(jsonb_build_object(${sql.join(parts, sql`, `)})) AS cells`;
}

/** `marks`: the indexes of the colour rules a row satisfies (empty when none), computed by the same filter compiler as `filter`. */
function marksSelect(schema: TableSchema, marks: FilterNode[] | undefined): SQL[] {
  if (!marks?.length) return [];
  const fields = schema.fieldMap();
  const parts = marks.map((m, i) => sql`CASE WHEN ${compileFilter(schema.normalizeFilter(m), fields) ?? sql`true`} THEN ${i}::int END`);
  return [sql`array_remove(ARRAY[${sql.join(parts, sql`, `)}]::int[], NULL) AS marks`];
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
  const consistency = await awaitConsistency(db, access.tableId, q);
  const filter = schema.normalizeFilter(andFilter(q.filter, q.timeFilter ? await timeFilterNode(db, schema, q.timeFilter) : undefined));
  const sortItems = schema.normalizeSort(q.sort);
  const sel = schema.parseSelect(q.fields);
  const where: SQL[] = [access.rows(), sql`deleted_at IS NULL`];
  // The search text holds every column, the ones a Guest may not read too: a Guest cannot search.
  if (access.guest && q.search) throw new AppError("validation_error", "Guest không dùng được ô tìm kiếm. Lọc theo cột được cấp.", { reason: "guest_search" });
  for (const tok of (q.search ?? "").split(/\s+/).filter(Boolean).slice(0, 8)) {
    where.push(sql`soe_unaccent(lower(search)) LIKE soe_unaccent(lower(${`%${escapeLike(tok)}%`})) ESCAPE '\\'`);
  }
  const page = await listPage<Record<string, unknown>>(db, {
    from: sql`${access.rel()} dh_rows`,
    fields: schema.fieldMap(),
    baseWhere: sql.join(where, sql` AND `),
    filter,
    sortItems: sortItems.length ? sortItems : [{ field: "row_no", dir: "asc" }],
    defaultSort: [{ field: "row_no", dir: "asc" }],
    select: metaOf(access, sel).join(","),
    extraSelect: [dataSelect(schema, sel), ...marksSelect(schema, q.marks)],
    limit: q.limit,
    cursor: q.cursor,
    offset: q.offset,
    reverse: q.reverse,
    includeTotal: q.includeTotal,
  });
  // Best effort: never let index bookkeeping break a read.
  await noteIndexUse(db, access, schema, filter, sortItems).catch(() => {});
  const items = shape(page.items, schema, q.labels ?? false);
  await attachPending(db, access.tableId, items, sel ? new Set(sel.columns.map((c) => c.key)) : undefined);
  await attachCanEdit(db, access, items);
  return { ...page, items, ...(consistency ? { extra: { consistency } } : {}) };
}

/**
 * Under the split lock a reader may see a row they cannot edit (a Leader's view of a team member's deal): `can_edit` says it per row, with the SAME rule the
 * server applies on write (`TableAccess.canEditRow`), so the grid can lock the cells instead of letting the person try and fail. Only rows of a locked
 * table read by a member carry it; for the owner, or a table without the lock, every row is editable (the Edit permission is the table's).
 */
async function attachCanEdit(db: Executor, access: TableAccess, items: Shaped[]): Promise<void> {
  if (!access.restricted || items.length === 0) return;
  const keys = access.table.split.keys;
  const res = await db.execute(sql`SELECT id, ${sql.join(keys.map((k, n) => sql`data->${sql.raw(`'${assertColumnKey(k)}'`)} AS ${sql.raw(`k${n}`)}`), sql`, `)} FROM dh_rows
    WHERE ${access.rows()} AND id = ANY(${`{${items.map((i) => i.id as string).join(",")}}`}::uuid[])`);
  const byId = new Map((res.rows as Record<string, unknown>[]).map((r) => [r.id as string, Object.fromEntries(keys.map((k, n) => [k, r[`k${n}`]]))]));
  for (const it of items) it.can_edit = access.canEditRow(byId.get(it.id as string) ?? {});
}

/** Adds `pending` (keys of the computed columns of the row that are being computed) to the rows that have any. */
async function attachPending(db: Executor, tableId: string, items: Shaped[], only?: Set<string>): Promise<void> {
  const map = await pendingCells(db, tableId, items.map((i) => i.id as string), only);
  for (const it of items) {
    const p = map[it.id as string];
    if (p?.length) it.pending = p;
  }
}

export async function getRow(db: Executor, access: TableAccess, schema: TableSchema, rowId: string, o: { fields?: string; labels?: boolean; includeDeleted?: boolean } & ConsistencyOpts = {}): Promise<Shaped> {
  const consistency = await awaitConsistency(db, access.tableId, o);
  const sel = schema.parseSelect(o.fields);
  const meta = metaOf(access, sel);
  const res = await db.execute(sql`SELECT ${sql.join(meta.map((m) => sql.raw(m)), sql`, `)}, ${dataSelect(schema, sel)} FROM ${access.rel()} dh_rows WHERE ${access.rows()} AND id = ${rowId}::uuid ${o.includeDeleted ? sql`` : sql`AND deleted_at IS NULL`}`);
  const r = res.rows[0] as Record<string, unknown> | undefined;
  if (!r) throw new AppError("not_found", "Không tìm thấy dòng.");
  const [row] = shape([r], schema, o.labels ?? false);
  await attachPending(db, access.tableId, [row!], sel ? new Set(sel.columns.map((c) => c.key)) : undefined);
  await attachCanEdit(db, access, [row!]);
  return { ...row!, ...(consistency ? { consistency } : {}) };
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
    add(col.key, def.fieldType === "text" && (n.op === "contains" || n.op === "starts_with") ? "trgm" : hasAttrs(col) ? null : def.indexKind);
  };
  walk(filter);
  for (const s of sort) {
    const col = schema.tryResolve(s.field);
    if (!col) continue;
    const def = columnTypeDef(effectiveType(col));
    if (!def.virtual && !def.sortExpr?.(col) && !hasAttrs(col)) add(col.key, def.indexKind);
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
  // The history belongs to the row: a row the reader may not see (split lock, or another table's id) has no history for them either.
  if (access.restricted) {
    const seen = await db.execute(sql`SELECT 1 FROM dh_rows WHERE ${access.rows()} AND id = ${rowId}::uuid`);
    if (seen.rows.length === 0) throw new AppError("not_found", "Không tìm thấy dòng.");
  }
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
