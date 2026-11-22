import { sql } from "drizzle-orm";
import type { Executor } from "@soe/db";
import { entriesOf, userAttrs } from "./user-values";
import type { DhColumn, Stored } from "./types";

/**
 * The limit that comes from DATA (design module4 4.5): the total of a percent attribute over the people of one cell may not exceed a parameter of the
 * "Tham số com" table of the same datahub (for example `Tỉ lệ SoE`). Found by ROLE (`com_params`: `hieu_luc_tu`, `ten_tham_so`, `gia_tri`), never by table
 * name. The version in force today counts (latest `Hiệu lực từ` not after today). No table, no parameter or no value: no limit (decision of 4.2:
 * a tree that has not entered the parameter yet is not blocked).
 */
export async function capFor(db: Executor, datahubId: string, name: string, today: string): Promise<number | null> {
  const t = await db.execute(sql`SELECT t.id, (SELECT c.key FROM dh_columns c WHERE c.table_id = t.id AND c.role = 'hieu_luc_tu' AND c.deleted_at IS NULL) AS k_from,
      (SELECT c.key FROM dh_columns c WHERE c.table_id = t.id AND c.role = 'ten_tham_so' AND c.deleted_at IS NULL) AS k_name,
      (SELECT c.key FROM dh_columns c WHERE c.table_id = t.id AND c.role = 'gia_tri' AND c.deleted_at IS NULL) AS k_value
    FROM dh_tables t WHERE /*scope:system*/ t.datahub_id = ${datahubId}::uuid AND t.role_set = 'com_params' AND t.deleted_at IS NULL LIMIT 1`);
  const r = t.rows[0] as { id: string; k_from: string | null; k_name: string | null; k_value: string | null } | undefined;
  if (!r || !r.k_from || !r.k_name || !r.k_value) return null;
  const res = await db.execute(sql`SELECT (data->>${r.k_value})::numeric AS v FROM dh_rows
    WHERE /*scope:system*/ table_id = ${r.id}::uuid AND deleted_at IS NULL AND lower(btrim(data->>${r.k_name})) = lower(btrim(${name})) AND data ? ${r.k_value}
      AND substr(data->>${r.k_from}, 1, 10) <= ${today} ORDER BY data->>${r.k_from} DESC LIMIT 1`);
  const v = (res.rows[0] as { v: string | null } | undefined)?.v;
  return v === null || v === undefined ? null : Number(v);
}

export interface PeopleCell {
  /** Id of the row (to read the row as it will be saved, for `cap_role`). */
  rowId?: string;
  row: number;
  col: DhColumn;
  value: Stored;
}

/** Checks the data-driven limits of the user cells just written; adds one issue per cell that is over. */
export async function checkPeopleCaps(
  db: Executor,
  datahubId: string,
  cells: PeopleCell[],
  today: string,
  issues: { row: number; column: string; message: string }[],
  /** For `cap_role`: the key of the column holding a role, and the row as it will be saved (formulas computed). */
  rowRead?: { keyOfRole: (role: string) => string | undefined; data: (rowId: string) => Record<string, Stored> | undefined },
): Promise<void> {
  const cache = new Map<string, number | null>();
  for (const c of cells) {
    for (const a of userAttrs(c.col)) {
      let cap: number | null | undefined;
      let param = a.cap_param;
      const roleKey = a.cap_role && rowRead ? rowRead.keyOfRole(a.cap_role) : undefined;
      if (roleKey && c.rowId) {
        // the cap of this row (a formula column): not computed yet or empty = no limit here; the money commands check it again from the stored value
        const v = rowRead!.data(c.rowId)?.[roleKey];
        cap = typeof v === "number" ? v : null;
        param = a.cap_role;
      } else {
        if (!param) continue;
        if (!cache.has(param)) cache.set(param, await capFor(db, datahubId, param, today));
        cap = cache.get(param);
      }
      if (cap === null || cap === undefined) continue;
      const total = entriesOf(c.value).reduce((s, e) => s + (typeof e.attrs[a.key] === "number" ? (e.attrs[a.key] as number) : 0), 0);
      if (total > cap + 1e-9) issues.push({ row: c.row, column: c.col.name, message: `Tổng "${a.label}" của cột "${c.col.name}" là ${Math.round(total * 10000) / 100}%, vượt "${param}" (${Math.round(cap * 10000) / 100}%).` });
    }
  }
}
