import { sql, type SQL } from "drizzle-orm";
import { AppError, type FilterNode } from "@soe/shared";
import { compileFilter, exprOf, type Executor } from "@soe/db";
import type { TableAccess } from "./access";
import { effectiveType } from "./cell-values";
import { columnTypeDef } from "./column-types";
import { assertColumnKey } from "./types";
import { andFilter, timeFilterNode } from "./time-filter";
import type { TableSchema } from "./table-schema";

export const GROUP_FNS = ["count", "sum", "avg", "min", "max"] as const;
export type GroupFn = (typeof GROUP_FNS)[number];
export const MAX_GROUP_LEVELS = 3;
/** Most groups one level may have. Past it the answer is cut and flagged `truncated`; the person filters or picks another column. */
export const MAX_GROUPS = 1000;
const MAX_AGG_COLUMNS = 30;

export interface GroupQuery {
  filter?: FilterNode;
  timeFilter?: unknown;
  search?: string;
  group: { field: string; dir?: "asc" | "desc" }[];
  /** Per column: which total to show on the group line. */
  aggs?: Record<string, GroupFn>;
}

export interface GroupRow {
  /** 0 = first grouping column. */
  depth: number;
  /** Key values of the groups from the first level down to this one (`null` = empty). */
  path: (string | number | boolean | null)[];
  /** Rows of the group under the current filter. */
  count: number;
  /** Totals by column key; a value is null when the group has no number in that column. */
  aggs: Record<string, number | string | null>;
}

export interface GroupResult {
  groups: GroupRow[];
  /** The deepest level had more than `MAX_GROUPS` groups; only the first ones are listed. */
  truncated: boolean;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Groups of the rows under the view's filter, with their totals, in display order (a group, then the groups inside it).
 * Every number comes from SQL aggregates over the same filtered set the list reads, so a group's count is the
 * number of rows `row.list` returns when it is filtered to that group's key. Empty keys sort last.
 */
export async function listGroups(db: Executor, access: TableAccess, schema: TableSchema, q: GroupQuery): Promise<GroupResult> {
  if (q.group.length === 0 || q.group.length > MAX_GROUP_LEVELS) throw new AppError("validation_error", `Nhóm theo 1 đến ${MAX_GROUP_LEVELS} cột.`);
  const fields = schema.fieldMap();
  const filter = schema.normalizeFilter(andFilter(q.filter, q.timeFilter ? await timeFilterNode(db, schema, q.timeFilter) : undefined));
  const where: SQL[] = [access.rows(), sql`deleted_at IS NULL`];
  for (const tok of (q.search ?? "").split(/\s+/).filter(Boolean).slice(0, 8)) {
    where.push(sql`soe_unaccent(lower(search)) LIKE soe_unaccent(lower(${`%${escapeLike(tok)}%`})) ESCAPE '\\'`);
  }
  const f = compileFilter(filter, fields);
  if (f) where.push(f);

  const keys = q.group.map((g) => {
    const key = schema.fieldFor(g.field);
    const spec = fields[key];
    const col = schema.tryResolve(key);
    const kind = col ? effectiveType(col) : null;
    if (!spec || spec.type === "set" || spec.type === "datetime" || kind === "long_text") {
      throw new AppError("invalid_filter", `Không nhóm được theo cột "${g.field}".`, { field: g.field });
    }
    return { key, spec, dir: g.dir ?? "asc", expr: exprOf(spec), order: spec.sortExpr ?? exprOf(spec) };
  });

  const aggCols = Object.entries(q.aggs ?? {}).slice(0, MAX_AGG_COLUMNS).map(([ref, fn]) => {
    const key = schema.fieldFor(ref);
    const spec = fields[key];
    const col = schema.tryResolve(key);
    if (!spec || !col || !columnTypeDef(effectiveType(col)).fieldType) throw new AppError("invalid_filter", `Không tính tổng được cho cột "${ref}".`, { field: ref });
    if ((fn === "sum" || fn === "avg") && spec.type !== "number") throw new AppError("invalid_filter", `Chỉ cộng hoặc lấy trung bình được cột số ("${ref}").`, { field: ref });
    if ((fn === "min" || fn === "max") && spec.type !== "number" && spec.type !== "date") throw new AppError("invalid_filter", `Chỉ lấy nhỏ nhất hoặc lớn nhất được cột số hoặc ngày ("${ref}").`, { field: ref });
    return { key: assertColumnKey(key), fn, expr: exprOf(spec), isNumber: spec.type === "number" };
  });

  const aggSelect = (): SQL[] =>
    aggCols.map((a, i) => {
      const alias = sql.raw(`"a${i}"`);
      if (a.fn === "count") return sql`count(${a.expr})::text AS ${alias}`;
      return sql`${sql.raw(a.fn)}(${a.expr})::text AS ${alias}`;
    });
  const whereSql = sql`WHERE ${sql.join(where, sql` AND `)}`;

  /** Groups of the first `depth` columns, ordered like the display. */
  const level = async (depth: number, limit: number) => {
    const ks = keys.slice(0, depth);
    const select = [...ks.map((k, i) => sql`to_jsonb(${k.expr}) AS ${sql.raw(`"k${i}"`)}`), sql`count(*)::int AS n`, ...aggSelect()];
    const groupBy = ks.flatMap((k) => (k.order === k.expr ? [k.expr] : [k.expr, k.order]));
    const orderBy = ks.map((k) => sql`${k.order} ${k.dir === "asc" ? sql`ASC` : sql`DESC`} NULLS LAST`);
    const res = await db.execute(sql`SELECT ${sql.join(select, sql`, `)} FROM dh_rows ${whereSql} GROUP BY ${sql.join(groupBy, sql`, `)} ORDER BY ${sql.join(orderBy, sql`, `)} LIMIT ${limit}`);
    return res.rows as Record<string, unknown>[];
  };
  const pathOf = (r: Record<string, unknown>, depth: number) => Array.from({ length: depth }, (_, i) => (r[`k${i}`] ?? null) as string | number | boolean | null);
  const aggsOf = (r: Record<string, unknown>): Record<string, number | string | null> => {
    const out: Record<string, number | string | null> = {};
    aggCols.forEach((a, i) => {
      const v = r[`a${i}`];
      out[a.key] = v === null || v === undefined ? null : a.isNumber || a.fn === "count" ? Number(v) : String(v);
    });
    return out;
  };

  const leafRows = await level(keys.length, MAX_GROUPS + 1);
  const truncated = leafRows.length > MAX_GROUPS;
  const leaves = truncated ? leafRows.slice(0, MAX_GROUPS) : leafRows;
  const parents: Map<string, Record<string, unknown>>[] = [];
  for (let d = 1; d < keys.length; d++) {
    const rows = await level(d, 100_000);
    parents.push(new Map(rows.map((r) => [JSON.stringify(pathOf(r, d)), r])));
  }

  const out: GroupRow[] = [];
  const lastPrefix: (string | undefined)[] = [];
  for (const leaf of leaves) {
    const full = pathOf(leaf, keys.length);
    for (let d = 1; d < keys.length; d++) {
      const prefix = JSON.stringify(full.slice(0, d));
      if (lastPrefix[d - 1] === prefix) continue;
      // A new group at this level: the groups inside it start over too.
      lastPrefix.length = d;
      lastPrefix[d - 1] = prefix;
      const p = parents[d - 1]!.get(prefix);
      if (p) out.push({ depth: d - 1, path: full.slice(0, d), count: p.n as number, aggs: aggsOf(p) });
    }
    out.push({ depth: keys.length - 1, path: full, count: leaf.n as number, aggs: aggsOf(leaf) });
  }
  return { groups: out, truncated };
}
