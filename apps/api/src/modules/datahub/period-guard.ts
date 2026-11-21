import { sql } from "drizzle-orm";
import { AppError } from "@soe/shared";
import type { Executor } from "@soe/db";
import type { TableAccess } from "./access";
import type { LoadedRow } from "./column-source";
import type { TableSchema } from "./table-schema";
import type { SelectOption, Stored } from "./types";

type Plan = { kind: "create" | "update" | "delete"; id: string; cells: Map<string, Stored> };
interface Lock {
  id: string;
  label: string | null;
  start: string;
  end: string;
}

/** The active period locks of one table (period closing, design module4 12). A lock is made by `period.close`, so any write path that goes through `applyRowOps` meets it here. */
export async function activeLocks(db: Executor, tableId: string): Promise<Lock[]> {
  const r = await db.execute(sql`SELECT id, label, period_start::text AS start, period_end::text AS "end" FROM period_locks WHERE table_id = ${tableId} AND unlocked_at IS NULL`);
  return r.rows as unknown as Lock[];
}
const inLock = (locks: Lock[], d: unknown): Lock | undefined => {
  const s = typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  return s ? locks.find((l) => l.start <= s && s <= l.end) : undefined;
};
const refuse = (l: Lock, reason: string, extra: Record<string, unknown> = {}) =>
  new AppError("period_locked", undefined, { lock_id: l.id, label: l.label, period_start: l.start, period_end: l.end, reason, ...extra });
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Freezes what a closed month froze, by ROLE (never by table name), for the three tables of the payment set (design module4 12):
 * - an instalment (role `ngay_tien_ve`) whose money arrived in a locked month: date, amounts, link to the receipt, commission split and the instalment itself stay;
 * - a deal (role `ngay_chot`) closed in a locked month: Status, manual closing date, deal type and each person's revenue share stay (people and commission share may still change);
 * - a ledger line (role `trang_thai_com`) that is `Đã chốt` or `Điều chỉnh`: never changed or deleted by a user. The system (`opts.system`, `period.close`) is exempt.
 * Locks are looked up only when the table has such a column, so an ordinary table costs nothing.
 */
export async function guardPeriod(db: Executor, access: TableAccess, schema: TableSchema, plans: Plan[], loaded: Map<string, LoadedRow>, system: boolean): Promise<void> {
  if (system) return;
  const role = (r: string) => schema.alive.find((c) => c.role === r);
  const dateCol = role("ngay_tien_ve");
  const closeCol = role("ngay_chot");
  const ledgerCol = role("trang_thai_com");
  if (!dateCol && !closeCol && !ledgerCol) return;
  const changed = (p: Plan, key: string) => p.cells.has(key) && !same(p.cells.get(key), loaded.get(p.id)?.data[key]);

  if (ledgerCol) {
    const options = (ledgerCol.config.options as SelectOption[] | undefined) ?? [];
    for (const p of plans) {
      if (p.kind === "create") continue;
      const cur = options.find((o) => o.id === loaded.get(p.id)?.data[ledgerCol.key]);
      if (cur?.meaning === "ledger_closed" || cur?.meaning === "ledger_adjust") {
        throw new AppError("conflict", "Dòng Sổ com đã chốt hoặc điều chỉnh không sửa, không xoá. Sai sót thì thêm dòng điều chỉnh vào kỳ đang mở.", { reason: "ledger_line_closed", row_id: p.id });
      }
    }
  }
  if (!dateCol && !closeCol) return;
  const locks = await activeLocks(db, access.tableId);
  if (!locks.length) return;

  if (dateCol) {
    const frozen = ["so_tien_du_kien", "so_tien_ve", "so_tien_nhan", "ngay_tien_ve", "tien_ve", "chia_com_dot", "deal"].map(role).filter((c): c is NonNullable<typeof c> => !!c);
    for (const p of plans) {
      if (p.kind === "create") continue;
      const lock = inLock(locks, loaded.get(p.id)?.data[dateCol.key]);
      if (!lock) continue;
      if (p.kind === "delete") throw refuse(lock, "payment_in_closed_period", { row_id: p.id });
      const hit = frozen.find((c) => changed(p, c.key));
      if (hit) throw refuse(lock, "payment_in_closed_period", { row_id: p.id, column: hit.name });
    }
  }
  if (closeCol) {
    const frozen = ["trang_thai", "loai_deal", "ngay_dong_tay"].map(role).filter((c): c is NonNullable<typeof c> => !!c);
    const people = role("nguoi_tham_gia");
    const share = (v: unknown) => JSON.stringify(((Array.isArray(v) ? v : []) as { id?: string; attrs?: Record<string, unknown> }[]).map((e) => [e.id, e.attrs?.ty_le_dt ?? null]).sort());
    for (const p of plans) {
      if (p.kind === "create") continue;
      const row = loaded.get(p.id);
      const lock = inLock(locks, row?.data[closeCol.key]);
      const target = inLock(locks, dateOfCell(p.cells, role("ngay_dong_tay")?.key));
      if (target && !lock) throw refuse(target, "deal_closing_into_closed_period", { row_id: p.id });
      if (!lock) continue;
      if (p.kind === "delete") throw refuse(lock, "deal_in_closed_period", { row_id: p.id });
      const hit = frozen.find((c) => changed(p, c.key));
      if (hit) throw refuse(lock, "deal_in_closed_period", { row_id: p.id, column: hit.name });
      if (people && changed(p, people.key) && share(p.cells.get(people.key)) !== share(row?.data[people.key])) throw refuse(lock, "deal_revenue_share_in_closed_period", { row_id: p.id, column: people.name });
    }
  }
}
const dateOfCell = (cells: Map<string, Stored>, key: string | undefined): unknown => (key ? cells.get(key) : undefined);
