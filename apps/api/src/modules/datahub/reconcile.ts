import { sql } from "drizzle-orm";
import { enqueueOutbox, writeAudit, SYSTEM_USER_ID, type Db } from "@soe/db";
import type { Logger } from "pino";
import { activeUsersWithRole } from "../../auth/access";
import { recalcColumn } from "./recalc";

/**
 * Nightly reconciliation (design module2 section 6.7, "Lưới an toàn"). Partial recalculation is an optimisation; this job
 * is the net under it. It recomputes WHOLE columns and compares with what is stored. A difference is a bug of the
 * partial path (or of a write that skipped the queue): the correct value is written, the Admin is told, and the bug must
 * be fixed at its root. The job is never a way to hide it.
 *
 * Rotation with a limit: columns are taken oldest-reconciled first (never reconciled = first) until a budget of rows is
 * used, so every column is reached in a few nights and a night never costs more than the budget.
 */

/** Rows (table size of the columns taken) one night may recompute. A single column bigger than this is still taken alone. */
export const RECONCILE_ROW_BUDGET = 1_000_000;
export const RECONCILE_EVENT = "datahub.reconcile.mismatch";

export interface Mismatch {
  table_id: string;
  column_key: string;
  column_name: string;
  cells: number;
}

export interface ReconcileResult {
  columns: number;
  rows: number;
  mismatches: Mismatch[];
}

type Raw = Record<string, unknown>;

/**
 * Reconciles the next columns in rotation. Only columns at rest are taken (`ready`, nothing queued, no TODAY()/NOW()
 * which legitimately change); a column that is written to while it is being checked is not judged (its values are
 * corrected anyway, but a difference may come from that write).
 */
export async function reconcileColumns(db: Db, opts: { rowBudget?: number; now?: Date; log?: Logger } = {}): Promise<ReconcileResult> {
  const budget = opts.rowBudget ?? RECONCILE_ROW_BUDGET;
  const now = opts.now ?? new Date();
  const cand = await db.execute(sql`SELECT c.id, c.table_id, c.key, c.name, t.row_count
    FROM dh_columns c JOIN dh_tables t ON t.id = c.table_id JOIN dh_datahubs d ON d.id = t.datahub_id
    WHERE /*scope:system*/ c.deleted_at IS NULL AND t.deleted_at IS NULL AND d.deleted_at IS NULL
      AND c.type IN ('formula', 'lookup', 'rollup') AND c.calc_status = 'ready' AND c.calc_volatile IS NULL
      AND NOT EXISTS (SELECT 1 FROM dh_change_queue q WHERE q.column_id = c.id)
    ORDER BY c.reconciled_at NULLS FIRST, c.id`);
  const out: ReconcileResult = { columns: 0, rows: 0, mismatches: [] };
  for (const c of cand.rows as Raw[]) {
    const rowCount = Number(c.row_count);
    if (out.columns > 0 && out.rows + rowCount > budget) continue; // a smaller column further down may still fit
    // Claim like the worker does; nothing to claim if a write got there first.
    const claim = await db.execute(sql`UPDATE dh_columns SET calc_status = 'running', calc_done = 0, calc_total = ${rowCount}::int
      WHERE /*scope:system*/ id = ${c.id as string}::uuid AND calc_status = 'ready' AND deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM dh_change_queue q WHERE q.column_id = ${c.id as string}::uuid)
      RETURNING clock_timestamp()::text AS claimed_at`);
    const claimedAt = (claim.rows[0] as { claimed_at: string } | undefined)?.claimed_at;
    if (!claimedAt) continue;
    let cells = 0;
    try {
      cells = (await recalcColumn(db, c.id as string, claimedAt, now, opts.log)).changedRows;
    } catch (e) {
      opts.log?.error({ err: e, column: c.id }, "reconciliation of a column failed");
      continue;
    }
    // Written to meanwhile (the column was requested again after the claim): the difference is not judged.
    const after = await db.execute(sql`SELECT calc_requested_at > ${claimedAt}::timestamptz AS touched FROM dh_columns WHERE /*scope:system*/ id = ${c.id as string}::uuid`);
    const touched = (after.rows[0] as { touched: boolean | null } | undefined)?.touched === true;
    await db.execute(sql`UPDATE dh_columns SET reconciled_at = now() WHERE /*scope:system*/ id = ${c.id as string}::uuid`);
    out.columns++;
    out.rows += rowCount;
    if (cells > 0 && !touched) out.mismatches.push({ table_id: c.table_id as string, column_key: c.key as string, column_name: c.name as string, cells });
    if (out.rows >= budget) break;
  }
  if (out.mismatches.length > 0) await report(db, out, now, opts.log);
  return out;
}

/** Tells every Admin (in-app notification through the outbox), writes the log and the audit entry. Names of columns, never values. */
async function report(db: Db, r: ReconcileResult, now: Date, log?: Logger): Promise<void> {
  const total = r.mismatches.reduce((a, m) => a + m.cells, 0);
  log?.error({ job: "datahub-reconcile", cells: total, mismatches: r.mismatches }, "reconciliation found stored values different from a full recomputation (bug in partial recalculation)");
  const admins = await activeUsersWithRole(db, "admin");
  await db.transaction(async (tx) => {
    await enqueueOutbox(tx, {
      event: RECONCILE_EVENT,
      aggregateType: "datahub",
      aggregateId: null,
      payload: { at: now.toISOString(), cells: total, columns: r.mismatches, checked_columns: r.columns, recipient_ids: admins.map((a) => a.id) },
    });
    await writeAudit(tx, {
      command: "datahub.reconcile",
      result: "success",
      actor: { userId: SYSTEM_USER_ID, via: "worker", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: "soe-worker" },
      details: { cells: total, columns: r.mismatches.map((m) => ({ table_id: m.table_id, column: m.column_key, cells: m.cells })), checked_columns: r.columns },
    });
  });
}
