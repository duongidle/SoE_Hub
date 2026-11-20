import { sql } from "drizzle-orm";
import { businessDate } from "@soe/shared";
import { SYSTEM_USER_ID, newId, type Db } from "@soe/db";
import type { Logger } from "pino";
import { nextChangeSeq } from "../datahub/change-queue";
import { recordChanges, type RowChange } from "../datahub/partial";

/**
 * The Index table (design module4 5): one row per month, and "worker thêm dòng tháng mới vào ngày 1". For every Index table (role set `index`, the column with
 * the role `thang`) that lacks the current month, adds the months after its last one up to the current month (the first run adds only the current month: the
 * earliest month with a deal is the dashboard's business). A system write, like a recalculation: the formulas of the new row are queued, no history, no audit.
 */
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
    if (!lastMonth) months.push(current);
    else for (let m = nextMonth(lastMonth.slice(0, 7)); `${m}-01` <= current; m = nextMonth(m)) months.push(`${m}-01`);
    if (months.length === 0) continue;
    await db.transaction(async (tx) => {
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
