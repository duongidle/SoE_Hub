import { sql } from "drizzle-orm";
import type { Executor } from "@soe/db";
import { entriesOf } from "./user-values";
import { columnFromDb } from "./table-schema";
import { markPending } from "./recalc";
import type { DhColumn, Stored } from "./types";

/**
 * "Gửi xuống" (design module4 4.5): a column of storage `person` with `autofill: { column, attr, sum? }` is filled by the SYSTEM from the people named
 * in a user column of the same row, so a member reads "my role", "my share" without a function that knows who reads. One place computes it; the grid,
 * export, API and formulas only read the stored person cells.
 *
 * - `attr` only: each person named gets the value of their own attribute (a person without a value has the cell removed).
 * - `sum: "team"`: a Leader gets the total of the attribute over the people of their team who are named in the row (a Leader named in it counts for themselves);
 *   `sum: "tree"`: a Manager the total over their tree. Numbers only (percent, number).
 * People who are no longer named lose the value.
 *
 * It is a system write, like a formula recalculation: no row history, no audit entry, no change of `version` or "Ngày sửa". The caller marks the
 * formulas that read the changed columns for recalculation.
 */
type Raw = Record<string, unknown>;
type Cells = Map<string, Record<string, Stored>>; // user id -> key -> value

interface Org {
  leader: Map<string, string | null>;
  manager: Map<string, string | null>;
  roles: Map<string, string[]>;
}

async function loadOrg(db: Executor, ids: string[]): Promise<Org> {
  const org: Org = { leader: new Map(), manager: new Map(), roles: new Map() };
  if (ids.length === 0) return org;
  const arr = `{${ids.join(",")}}`;
  const res = await db.execute(sql`SELECT u.id, u.roles, m.leader_id, m.manager_id FROM users u
    LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL WHERE /*scope:system*/ u.id = ANY(${arr}::uuid[])`);
  for (const r of res.rows as { id: string; roles: string[] | null; leader_id: string | null; manager_id: string | null }[]) {
    org.leader.set(r.id, r.leader_id);
    org.manager.set(r.id, r.manager_id);
    org.roles.set(r.id, r.roles ?? []);
  }
  return org;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** What each person's cells of the autofill columns should hold for one row. */
function desiredFor(data: Record<string, Stored>, cols: DhColumn[], org: Org): Cells {
  const out: Cells = new Map();
  const put = (user: string, key: string, v: Stored) => {
    const c = out.get(user) ?? {};
    c[key] = v;
    out.set(user, c);
  };
  for (const col of cols) {
    const a = col.autofill!;
    const entries = entriesOf(data[a.column]);
    if (!a.sum) {
      for (const e of entries) {
        const v = e.attrs[a.attr];
        if (v !== undefined) put(e.id, col.key, v);
      }
      continue;
    }
    const totals = new Map<string, number>();
    for (const e of entries) {
      const roles = org.roles.get(e.id) ?? [];
      const owner = a.sum === "team" ? (org.leader.get(e.id) ?? (roles.includes("leader") ? e.id : null)) : (org.manager.get(e.id) ?? (roles.includes("manager") ? e.id : null));
      const targets = new Set<string>();
      if (owner) targets.add(owner);
      // A Leader named in the row counts in their own team; a Manager in their own tree.
      if (a.sum === "team" && roles.includes("leader")) targets.add(e.id);
      if (a.sum === "tree" && roles.includes("manager")) targets.add(e.id);
      for (const t of targets) totals.set(t, (totals.get(t) ?? 0) + num(e.attrs[a.attr]));
    }
    for (const [user, total] of totals) put(user, col.key, Math.round(total * 1e9) / 1e9);
  }
  return out;
}

export const autofillColumns = (cols: DhColumn[]): DhColumn[] => cols.filter((c) => c.autofill && !c.deletedAt);

/**
 * Sets the autofilled person cells of `rows` (`id` + `data`). Returns the keys of the columns whose values really changed, so the caller recalculates only what
 * reads them. `rows` must be the rows as stored now (after the write).
 */
export async function pushDownRows(db: Executor, tableId: string, columns: DhColumn[], rows: { id: string; data: Record<string, Stored> }[]): Promise<string[]> {
  const cols = autofillColumns(columns);
  if (cols.length === 0 || rows.length === 0) return [];
  const keys = cols.map((c) => c.key);
  const people = new Set<string>();
  for (const r of rows) for (const c of cols) for (const e of entriesOf(r.data[c.autofill!.column])) people.add(e.id);
  const org = await loadOrg(db, [...people]);

  const before = new Map<string, Map<string, Record<string, Stored>>>(); // row -> user -> data
  const rowIds = rows.map((r) => r.id);
  const cur = await db.execute(sql`SELECT row_id, user_id, data FROM dh_person_cells WHERE /*scope:system*/ table_id = ${tableId}::uuid AND row_id = ANY(${`{${rowIds.join(",")}}`}::uuid[])`);
  for (const r of cur.rows as { row_id: string; user_id: string; data: Record<string, Stored> }[]) {
    const m = before.get(r.row_id) ?? new Map();
    m.set(r.user_id, r.data);
    before.set(r.row_id, m);
  }

  const sets: { row_id: string; user_id: string; set: Record<string, Stored> }[] = [];
  const unsets: { row_id: string; user_id: string; unset: string[] }[] = [];
  const changed = new Set<string>();
  for (const r of rows) {
    const want = desiredFor(r.data, cols, org);
    const had = before.get(r.id) ?? new Map<string, Record<string, Stored>>();
    const users = new Set([...want.keys(), ...had.keys()]);
    for (const u of users) {
      const w = want.get(u) ?? {};
      const h = had.get(u) ?? {};
      const set: Record<string, Stored> = {};
      const unset: string[] = [];
      for (const k of keys) {
        const nv = w[k];
        const ov = h[k];
        if (nv === undefined && ov !== undefined) {
          unset.push(k);
          changed.add(k);
        } else if (nv !== undefined && JSON.stringify(nv) !== JSON.stringify(ov)) {
          set[k] = nv;
          changed.add(k);
        }
      }
      if (Object.keys(set).length) sets.push({ row_id: r.id, user_id: u, set });
      if (unset.length) unsets.push({ row_id: r.id, user_id: u, unset });
    }
  }
  if (unsets.length) {
    await db.execute(sql`UPDATE dh_person_cells c SET data = c.data - v.unset
      FROM jsonb_to_recordset(${JSON.stringify(unsets)}::jsonb) AS v(row_id uuid, user_id uuid, unset text[])
      WHERE /*scope:system*/ c.table_id = ${tableId}::uuid AND c.row_id = v.row_id AND c.user_id = v.user_id`);
  }
  if (sets.length) {
    await db.execute(sql`INSERT INTO dh_person_cells (row_id, user_id, table_id, data)
      SELECT v.row_id, v.user_id, ${tableId}::uuid, v.set FROM jsonb_to_recordset(${JSON.stringify(sets)}::jsonb) AS v(row_id uuid, user_id uuid, set jsonb)
      ON CONFLICT (row_id, user_id) DO UPDATE SET data = dh_person_cells.data || EXCLUDED.data`);
  }
  return [...changed];
}

/** Every live row of a table (after a column is made, or the organization changed). Walks the table in batches of 2000. */
export async function pushDownTable(db: Executor, tableId: string, columns: DhColumn[]): Promise<string[]> {
  if (autofillColumns(columns).length === 0) return [];
  const changed = new Set<string>();
  let last = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const res = await db.execute(sql`SELECT id, data FROM dh_rows WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND id > ${last}::uuid ORDER BY id LIMIT 2000`);
    const rows = res.rows as { id: string; data: Record<string, Stored> }[];
    if (rows.length === 0) break;
    for (const k of await pushDownRows(db, tableId, columns, rows)) changed.add(k);
    last = rows[rows.length - 1]!.id;
    if (rows.length < 2000) break;
  }
  return [...changed];
}

/** The formula columns (any table) that read one of these columns of this table: they are recalculated after the values change. */
export async function dependentsOf(db: Executor, tableId: string, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const res = await db.execute(sql`SELECT DISTINCT f.column_id AS id FROM dh_formula_deps f JOIN dh_columns c ON c.id = f.column_id
    WHERE /*scope:system*/ c.deleted_at IS NULL AND f.src_table_id = ${tableId}::uuid AND f.src_key = ANY(${`{${keys.join(",")}}`}::text[])`);
  return (res.rows as Raw[]).map((r) => r.id as string);
}

/** A system change to the people of rows (transfer, organization change): load the table's autofill columns, refill, and queue the formulas that read them. */
export async function refillRows(db: Executor, tableId: string, rows: { id: string; data: Record<string, Stored> }[] | "all"): Promise<void> {
  const res = await db.execute(sql`SELECT * FROM dh_columns WHERE /*scope:system*/ table_id = ${tableId}::uuid AND deleted_at IS NULL AND autofill IS NOT NULL`);
  const cols = (res.rows as Raw[]).map(columnFromDb);
  if (cols.length === 0) return;
  const keys = rows === "all" ? await pushDownTable(db, tableId, cols) : await pushDownRows(db, tableId, cols, rows);
  await markPending(db, await dependentsOf(db, tableId, keys));
}
