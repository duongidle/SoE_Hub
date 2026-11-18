import { sql, type SQL } from "drizzle-orm";
import { AppError, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, parseSortParam, type FilterNode, type SortItem } from "@soe/shared";
import type { Executor } from "../client";
import { compileFilter, exprOf, type FieldMap } from "./filter";

/**
 * Keyset pagination (design sections 6.2 and 7). No OFFSET: the cursor carries the sort-key values of the
 * last row, and the next page is `WHERE (keys) after cursor`. Stable under inserts; O(log n) per page.
 *
 * Sort keys are read back as text (`::text`) so that timestamps keep microsecond precision in the cursor.
 * Order: ASC puts NULLs last, DESC puts NULLs first (PostgreSQL defaults, stated explicitly).
 * The row id is always appended as the final tie-breaker.
 */

export interface ListPageParams {
  /** `FROM` clause, for example `sql\`audit_log\``. */
  from: SQL;
  fields: FieldMap;
  /** Condition always applied (for example `deleted_at IS NULL` or an owner restriction). */
  baseWhere?: SQL;
  filter?: FilterNode | null;
  /** Raw `?sort=` string. */
  sort?: string | null;
  /** Already parsed sort (wins over `sort`). Used by tables whose field names are not plain identifiers. */
  sortItems?: SortItem[] | null;
  /** Extra select expressions (already aliased), appended to the selected fields. */
  extraSelect?: SQL[];
  defaultSort: SortItem[];
  /** Raw `?fields=` string (comma separated). */
  select?: string | null;
  limit?: number;
  cursor?: string | null;
  /**
   * Window read: skip this many rows of the (filtered, sorted) list instead of following a cursor. For a jump to a far
   * position (the person drags the scroll bar). With `reverse` the count starts from the END of the list.
   */
  offset?: number;
  /** Reads the list from its end: every direction and null placement is flipped, and the page comes back in normal order. */
  reverse?: boolean;
  includeTotal?: boolean;
}

export interface ListPageResult<T = Record<string, unknown>> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

interface CursorPayload {
  s: string;
  k: (string | null)[];
}

export function encodeCursor(c: CursorPayload): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string): CursorPayload {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as CursorPayload;
    if (typeof c?.s !== "string" || !Array.isArray(c.k)) throw new Error("shape");
    return c;
  } catch {
    throw new AppError("invalid_filter", "Con trỏ phân trang không hợp lệ.");
  }
}

const ID_FIELD = "id";

function resolveSort(p: ListPageParams): SortItem[] {
  let items: SortItem[];
  if (p.sortItems && p.sortItems.length > 0) {
    items = p.sortItems;
  } else if (p.sort) {
    try {
      items = parseSortParam(p.sort);
    } catch (e) {
      throw new AppError("invalid_filter", (e as Error).message);
    }
  } else {
    items = p.defaultSort;
  }
  for (const s of items) {
    const spec = p.fields[s.field];
    if (!spec || spec.sortable === false) {
      throw new AppError("invalid_filter", `Không sắp xếp được theo cột "${s.field}".`, { field: s.field });
    }
  }
  if (!p.fields[ID_FIELD]) throw new Error("FieldMap must contain an `id` field for keyset pagination");
  return items.some((s) => s.field === ID_FIELD) ? items : [...items, { field: ID_FIELD, dir: "asc" }];
}

function resolveSelect(p: ListPageParams): string[] {
  if (p.select) {
    const names = [...new Set(p.select.split(",").map((s) => s.trim()).filter(Boolean))];
    for (const n of names) {
      if (!p.fields[n]) throw new AppError("invalid_filter", `Không có cột "${n}".`, { field: n });
    }
    return names;
  }
  return Object.entries(p.fields).filter(([, s]) => s.selectable !== false).map(([n]) => n);
}

/** Condition "strictly after the cursor row" for one key. `nullsFirst`: empty values come before all others. */
function after(expr: SQL, dir: "asc" | "desc", v: string | null, nullsFirst: boolean): SQL {
  if (v === null) {
    // First: after a null come all non-null values. Last: after a null there is nothing.
    return nullsFirst ? sql`${expr} IS NOT NULL` : sql`false`;
  }
  const cmp = dir === "asc" ? sql`${expr} > ${v}` : sql`${expr} < ${v}`;
  return nullsFirst ? cmp : sql`(${cmp} OR ${expr} IS NULL)`;
}

/** ASC puts NULLs last and DESC first unless the item says otherwise. */
export function nullsFirstOf(s: SortItem): boolean {
  return s.nulls ? s.nulls === "first" : s.dir === "desc";
}

function same(expr: SQL, v: string | null): SQL {
  return v === null ? sql`${expr} IS NULL` : sql`${expr} IS NOT DISTINCT FROM ${v}`;
}

export function buildKeysetCondition(exprs: SQL[], dirs: ("asc" | "desc")[], values: (string | null)[], nullsFirst?: boolean[]): SQL {
  const ors: SQL[] = [];
  for (let i = 0; i < exprs.length; i++) {
    const ands: SQL[] = [];
    for (let j = 0; j < i; j++) ands.push(same(exprs[j]!, values[j]!));
    ands.push(after(exprs[i]!, dirs[i]!, values[i]!, nullsFirst?.[i] ?? dirs[i] === "desc"));
    ors.push(sql`(${sql.join(ands, sql` AND `)})`);
  }
  return sql`(${sql.join(ors, sql` OR `)})`;
}

export async function listPage<T = Record<string, unknown>>(ex: Executor, p: ListPageParams): Promise<ListPageResult<T>> {
  const limit = Math.min(Math.max(p.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  const sort = resolveSort(p);
  const selected = resolveSelect(p);
  const signature = sort.map((s) => `${s.field}:${s.dir}:${nullsFirstOf(s) ? "f" : "l"}`).join(",");

  const sortExprs = sort.map((s) => p.fields[s.field]!.sortExpr ?? exprOf(p.fields[s.field]!));
  const windowed = p.offset !== undefined;
  const flip = windowed && !!p.reverse;
  const dirs = sort.map((s) => (flip ? (s.dir === "asc" ? "desc" : "asc") : s.dir) as "asc" | "desc");
  const nullsFirst = sort.map(nullsFirstOf).map((f) => (flip ? !f : f));

  const filterSql = compileFilter(p.filter, p.fields);
  const where: SQL[] = [];
  if (p.baseWhere) where.push(p.baseWhere);
  if (filterSql) where.push(filterSql);

  const baseWhereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  const keysetWhere = [...where];
  if (p.cursor && !windowed) {
    const c = decodeCursor(p.cursor);
    if (c.s !== signature || c.k.length !== sort.length) {
      throw new AppError("invalid_filter", "Con trỏ không khớp với cách sắp xếp hiện tại.");
    }
    keysetWhere.push(buildKeysetCondition(sortExprs, dirs, c.k, nullsFirst));
  }
  const whereSql = keysetWhere.length ? sql`WHERE ${sql.join(keysetWhere, sql` AND `)}` : sql``;

  const selectList = selected.map((n) => sql`${exprOf(p.fields[n]!)} AS ${sql.identifier(n)}`);
  const keyList = sortExprs.map((e, i) => sql`(${e})::text AS ${sql.identifier(`__k${i}`)}`);
  const orderBy = sortExprs.map((e, i) => sql`${e} ${dirs[i] === "asc" ? sql`ASC` : sql`DESC`} ${nullsFirst[i] ? sql`NULLS FIRST` : sql`NULLS LAST`}`);

  const query = sql`SELECT ${sql.join([...selectList, ...(p.extraSelect ?? []), ...keyList], sql`, `)} FROM ${p.from} ${whereSql} ORDER BY ${sql.join(orderBy, sql`, `)} LIMIT ${limit + 1}${windowed ? sql` OFFSET ${Math.max(0, Math.floor(p.offset!))}` : sql``}`;
  const res = await ex.execute(query);
  const rows = res.rows as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  let page = hasMore ? rows.slice(0, limit) : rows;
  if (flip) page = [...page].reverse();

  let nextCursor: string | null = null;
  // A reversed window has no cursor: the client asks for the next window by position.
  if (hasMore && !flip) {
    const last = page[page.length - 1]!;
    nextCursor = encodeCursor({ s: signature, k: sort.map((_, i) => (last[`__k${i}`] as string | null) ?? null) });
  }
  const items = page.map((r) => {
    const out: Record<string, unknown> = {};
    for (const n of selected) out[n] = r[n];
    // Extra select expressions keep their alias.
    for (const k of Object.keys(r)) if (!k.startsWith("__k") && !(k in out)) out[k] = r[k];
    return out as T;
  });

  const result: ListPageResult<T> = { items, nextCursor };
  if (p.includeTotal) {
    const cnt = await ex.execute(sql`SELECT count(*)::int AS n FROM ${p.from} ${baseWhereSql}`);
    result.total = (cnt.rows[0] as { n: number }).n;
  }
  return result;
}
