import { sql } from "drizzle-orm";
import { businessDate } from "@soe/shared";
import { SYSTEM_USER_ID, newId, type Db } from "@soe/db";
import type { Logger } from "pino";
import { columnTx, nextChangeSeq } from "../datahub/change-queue";
import { recordChanges, type RowChange } from "../datahub/partial";

/**
 * The Index table (design module4 5): one row per month, and "worker thêm dòng tháng mới vào ngày 1". For every Index table (role set `index`, the column with
 * the role `thang`) that lacks the current month, adds the months after its last one up to the current month. The first run starts at the month of the
 * earliest Start date (role `ngay_bat_dau`) among the Deals of the tree the Index belongs to (at most `MAX_BACK_MONTHS` back; the current month when there is no deal). A system write, like a recalculation: the formulas of the new row are queued, no history, no audit.
 */
const MAX_BACK_MONTHS = 120;

/** The first month of a new Index: the earliest Start date among the Deals of its tree, or the current month. */
async function firstMonth(db: Db, tableId: string, current: string): Promise<string> {
  const r = await db.execute(sql`SELECT min(r.data->>dc.key) AS d
    FROM dh_tables it JOIN dh_templates tp ON tp.id = it.template_id
    JOIN dh_templates dtp ON dtp.manager_id = tp.manager_id AND dtp.scope = 'tree' AND dtp.role_set = 'deals' AND dtp.deleted_at IS NULL
    JOIN dh_columns dc ON dc.table_id = dtp.master_table_id AND dc.role = 'ngay_bat_dau' AND dc.deleted_at IS NULL
    JOIN dh_rows r ON r.table_id = dtp.master_table_id AND r.deleted_at IS NULL AND r.data ? dc.key
    WHERE /*scope:system*/ it.id = ${tableId}::uuid`);
  const d = (r.rows[0] as { d: string | null } | undefined)?.d;
  if (!d || !/^\d{4}-\d{2}/.test(d)) return current;
  let first = `${d.slice(0, 7)}-01`;
  const limit = backMonths(current, MAX_BACK_MONTHS);
  if (first < limit) first = limit;
  return first > current ? current : first;
}

function backMonths(ym: string, n: number): string {
  let y = Number(ym.slice(0, 4));
  let m = Number(ym.slice(5, 7)) - n;
  while (m < 1) {
    m += 12;
    y--;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export async function addIndexMonths(db: Db, now: Date = new Date(), log?: Logger): Promise<number> {
  const today = businessDate(now);
  const current = `${today.slice(0, 7)}-01`;
  const tables = await db.execute(sql`SELECT t.id, c.key AS month_key FROM dh_tables t
    JOIN dh_datahubs d ON d.id = t.datahub_id AND d.deleted_at IS NULL AND d.system_key = 'deal'
    JOIN dh_columns c ON c.table_id = t.id AND c.role = 'thang' AND c.deleted_at IS NULL
    WHERE /*scope:system*/ t.role_set = 'index' AND t.deleted_at IS NULL`);
  let added = 0;
  for (const tb of tables.rows as { id: string; month_key: string }[]) {
    const last = await db.execute(sql`SELECT max(data->>${tb.month_key}) AS m FROM dh_rows WHERE /*scope:system*/ table_id = ${tb.id}::uuid AND deleted_at IS NULL AND data ? ${tb.month_key}`);
    const lastMonth = (last.rows[0] as { m: string | null }).m;
    const months: string[] = [];
    const from = lastMonth ? nextMonth(lastMonth.slice(0, 7)) : (await firstMonth(db, tb.id, current)).slice(0, 7);
    for (let m = from; `${m}-01` <= current; m = nextMonth(m)) months.push(`${m}-01`);
    if (months.length === 0) continue;
    await columnTx(db, async (tx) => {
      const r = await tx.execute(sql`UPDATE dh_tables SET next_row_no = next_row_no + ${months.length}::int, row_count = row_count + ${months.length}::int WHERE /*scope:system*/ id = ${tb.id}::uuid RETURNING next_row_no - ${months.length}::int AS first_no`);
      const first = (r.rows[0] as { first_no: number }).first_no;
      const rows = months.map((m, i) => ({ id: newId(), row_no: first + i, data: { [tb.month_key]: m }, search: m }));
      await tx.execute(sql`INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
        SELECT v.id, ${tb.id}::uuid, v.row_no, v.data, v.search, ${SYSTEM_USER_ID}::uuid, ${SYSTEM_USER_ID}::uuid FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS v(id uuid, row_no int, data jsonb, search text)`);
      const seq = await nextChangeSeq(tx);
      const changes: RowChange[] = rows.map((x) => ({ rowId: x.id, kind: "insert", old: null, new: x.data }));
      await recordChanges(tx, tb.id, changes, seq, { includeApiFormulas: true });
    });
    added += months.length;
  }
  if (added) log?.info({ job: "deal-index-months", added }, "index months added");
  return added;
}

function nextMonth(ym: string): string {
  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
