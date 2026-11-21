import { sql, type SQL } from "drizzle-orm";
import type { Executor } from "@soe/db";
import { assertColumnKey } from "./types";
import { loadReader } from "./access";

/**
 * Columns whose value depends on who reads it (design module2 section 10, "Lookup, Rollup và công thức đọc sang bảng có khoá phân chia được
 * tính theo từng người đọc"). A computed column is READER-SCOPED when it
 *  - reads other rows (a range of a formula, the target of a lookup/rollup) of a table whose split lock is on, or
 *  - reads a column that is itself reader-scoped, or
 *  - reads a column with one value per person (`storage = 'person'`, module4 3.4: "Com dự kiến của tôi" reads "% Com cá nhân"): every reader has their own cell.
 * The owner's value lives in `dh_rows.data` as always (computed over every row). Each other member's value lives in `dh_personal_rows`, computed
 * over the rows of the split-lock tables THAT member sees. The flag `dh_columns.reader_scoped` is the single place that says which columns.
 */

type Raw = Record<string, unknown>;

/**
 * Marker dependency of a column that uses ME() or ISME(): a `cell` dependency on the pseudo column `~viewer` of its own table (no real column has this key).
 * `refreshReaderScoped` reads it as "the value depends on who reads it", directly or through a column that reads this one.
 */
export const VIEWER_DEP_KEY = "~viewer";

/**
 * `FROM` fragment for the rows of a table as ONE person reads them: `dh_rows` with the person's own values of the reader-scoped columns laid
 * over `data` (the owner's values of those columns are dropped first), then their own values of the person-stored columns (`dh_person_cells`, `withPerson`). `keep` = extra condition on alias `r` (the split lock of the table, kept
 * inside so the key indexes still apply). Used as `FROM ${overlayRel(...)} <alias>`.
 */
export function overlayRel(tableId: string, userId: string, scopedKeys: string[], keep: SQL | null = null, withPerson = false): SQL {
  const strip = sql.raw(`ARRAY[${scopedKeys.flatMap((k) => [`'${assertColumnKey(k)}'`, `'!${assertColumnKey(k)}'`]).join(",")}]::text[]`);
  const base = scopedKeys.length ? sql`(r.data - ${strip})` : sql`r.data`;
  const joins = [scopedKeys.length ? sql`LEFT JOIN dh_personal_rows p ON p.row_id = r.id AND p.user_id = ${userId}::uuid` : sql``, withPerson ? sql`LEFT JOIN dh_person_cells pc ON pc.row_id = r.id AND pc.user_id = ${userId}::uuid` : sql``];
  const merged = sql`${base}${scopedKeys.length ? sql` || coalesce(p.data, '{}'::jsonb)` : sql``}${withPerson ? sql` || coalesce(pc.data, '{}'::jsonb)` : sql``}`;
  return sql`(SELECT r.id, r.table_id, r.row_no, r.version, r.search, r.created_at, r.created_by, r.updated_at, r.updated_by, r.deleted_at, r.deleted_by,
      ${merged} AS data
    FROM dh_rows r ${joins[0]} ${joins[1]}
    WHERE /*scope:rows*/ r.table_id = ${tableId}::uuid ${keep ? sql`AND ${keep}` : sql``})`;
}

/** The people who read a table without owning it: every grantee of its datahub (the whole datahub, or this table). */
export async function membersOf(db: Executor, tableId: string): Promise<string[]> {
  const res = await db.execute(sql`SELECT DISTINCT s.grantee_id AS id FROM dh_tables t JOIN dh_shares s ON s.datahub_id = t.datahub_id AND (s.table_id IS NULL OR s.table_id = t.id)
    WHERE /*scope:system*/ t.id = ${tableId}::uuid`);
  return (res.rows as { id: string }[]).map((r) => r.id);
}

/** Every member of every table of a datahub (for the columns of any of its tables). */
export async function membersOfDatahub(db: Executor, datahubId: string): Promise<string[]> {
  const res = await db.execute(sql`SELECT DISTINCT grantee_id AS id FROM dh_shares WHERE /*scope:system*/ datahub_id = ${datahubId}::uuid`);
  return (res.rows as { id: string }[]).map((r) => r.id);
}

/** The people a member sees rows of (themselves and the people they manage now), for the key columns of a split-lock table. */
export async function idsOf(db: Executor, userId: string): Promise<string[]> {
  return (await loadReader(db, userId)).ids;
}

/**
 * Recomputes `reader_scoped` for the computed columns of ONE owner (formulas only refer to the owner's own tables, so the owner is the unit).
 * Returns the columns whose flag changed. Called whenever dependencies or a split lock change. A column that stops being reader-scoped loses
 * its personal values.
 */
export async function refreshReaderScoped(db: Executor, ownerId: string): Promise<{ became: string[]; stopped: string[] }> {
  const cols = await db.execute(sql`SELECT c.id, c.table_id, c.key, c.reader_scoped FROM dh_columns c JOIN dh_tables t ON t.id = c.table_id JOIN dh_datahubs d ON d.id = t.datahub_id
    WHERE /*scope:system*/ d.owner_id = ${ownerId}::uuid AND c.deleted_at IS NULL AND t.deleted_at IS NULL AND d.deleted_at IS NULL AND c.type IN ('formula', 'lookup', 'rollup')`);
  const rows = cols.rows as { id: string; table_id: string; key: string; reader_scoped: boolean }[];
  if (rows.length === 0) return { became: [], stopped: [] };
  const ids = rows.map((r) => r.id);
  // Only tables of this owner count: a column that reads a template table of ANOTHER owner is computed as this owner reads it, not per member (module4 19 work 5, 9).
  const deps = await db.execute(sql`SELECT f.column_id, f.src_table_id, f.src_key, f.kind, t.key_split,
      EXISTS (SELECT 1 FROM dh_columns sc WHERE sc.table_id = f.src_table_id AND sc.key = f.src_key AND sc.storage = 'person' AND sc.deleted_at IS NULL) AS src_person
    FROM dh_formula_deps f JOIN dh_tables t ON t.id = f.src_table_id
    JOIN dh_datahubs sd ON sd.id = t.datahub_id AND sd.owner_id = ${ownerId}::uuid
    WHERE /*scope:system*/ f.column_id = ANY(${`{${ids.join(",")}}`}::uuid[])`);
  const byCol = new Map<string, { table: string; key: string; kind: string; split: boolean; person: boolean }[]>();
  for (const d of deps.rows as Raw[]) {
    const l = byCol.get(d.column_id as string) ?? [];
    l.push({ table: d.src_table_id as string, key: d.src_key as string, kind: d.kind as string, split: !!d.key_split, person: !!d.src_person });
    byCol.set(d.column_id as string, l);
  }
  const idOf = new Map(rows.map((r) => [`${r.table_id}:${r.key}`, r.id]));
  const scoped = new Set<string>();
  for (const r of rows) if ((byCol.get(r.id) ?? []).some((d) => (d.person || (d.kind === "range" && d.split) || (d.key === VIEWER_DEP_KEY && d.table === r.table_id)))) scoped.add(r.id);
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of rows) {
      if (scoped.has(r.id)) continue;
      if ((byCol.get(r.id) ?? []).some((d) => scoped.has(idOf.get(`${d.table}:${d.key}`) ?? ""))) {
        scoped.add(r.id);
        changed = true;
      }
    }
  }
  const became = rows.filter((r) => scoped.has(r.id) && !r.reader_scoped).map((r) => r.id);
  const stopped = rows.filter((r) => !scoped.has(r.id) && r.reader_scoped);
  if (became.length) await db.execute(sql`UPDATE dh_columns SET reader_scoped = true WHERE /*scope:system*/ id = ANY(${`{${became.join(",")}}`}::uuid[])`);
  if (stopped.length) {
    await db.execute(sql`UPDATE dh_columns SET reader_scoped = false WHERE /*scope:system*/ id = ANY(${`{${stopped.map((r) => r.id).join(",")}}`}::uuid[])`);
    const byTable = new Map<string, string[]>();
    for (const r of stopped) byTable.set(r.table_id, [...(byTable.get(r.table_id) ?? []), r.key, `!${r.key}`]);
    for (const [tableId, keys] of byTable) await db.execute(sql`UPDATE dh_personal_rows SET data = data - ${`{${keys.join(",")}}`}::text[] WHERE /*scope:system*/ table_id = ${tableId}::uuid`);
  }
  return { became, stopped: stopped.map((r) => r.id) };
}

/** Owner of a datahub (system scope). */
export async function ownerOfTable(db: Executor, tableId: string): Promise<string | null> {
  const res = await db.execute(sql`SELECT d.owner_id FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ t.id = ${tableId}::uuid`);
  return (res.rows[0] as { owner_id: string } | undefined)?.owner_id ?? null;
}

/** Forgets what a person had computed in the tables of a datahub (their share was removed). */
export async function dropPersonalValues(db: Executor, datahubId: string, userId: string): Promise<void> {
  await db.execute(sql`DELETE FROM dh_personal_rows p USING dh_tables t WHERE /*scope:system*/ p.table_id = t.id AND t.datahub_id = ${datahubId}::uuid AND p.user_id = ${userId}::uuid`);
}
