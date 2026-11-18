import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { AppError, BUSINESS_TIMEZONE, type Actor } from "@soe/shared";
import type { Executor } from "../client";
import { periodLocks } from "../schema/period-locks";
import { writeAudit } from "./audit";

export type DateInput = string | Date | null | undefined;

/** Converts to `YYYY-MM-DD`. A Date is read in the business timezone (Vietnam), not UTC. */
export function toDateString(d: Exclude<DateInput, null | undefined>): string {
  if (typeof d === "string") {
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) throw new AppError("validation_error", `Ngày không hợp lệ: ${d}`);
    return d.slice(0, 10);
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export interface PeriodCheck {
  tableId: string;
  /** Scopes of the row (for example the manager tree). Locks with scope `global` always apply. */
  scope?: string | string[];
  /**
   * All period dates that matter for this write: the OLD value and the NEW value of the period column.
   * Checking both blocks moving a row out of (or into) a locked period.
   */
  dates: DateInput[];
}

/** Throws `period_locked` (423) when any date falls inside an active lock. Call from every write path. */
export async function assertPeriodOpen(ex: Executor, check: PeriodCheck): Promise<void> {
  const dates = [...new Set(check.dates.filter((d): d is Exclude<DateInput, null | undefined> => d != null).map(toDateString))];
  if (dates.length === 0) return;
  const scopes = ["global", ...(Array.isArray(check.scope) ? check.scope : check.scope ? [check.scope] : [])];

  const dateMatch = or(
    ...dates.map((d) => and(lte(periodLocks.periodStart, d), gte(periodLocks.periodEnd, d))),
  );
  const hit = await ex
    .select()
    .from(periodLocks)
    .where(
      and(
        eq(periodLocks.tableId, check.tableId),
        inArray(periodLocks.scope, scopes),
        isNull(periodLocks.unlockedAt),
        dateMatch,
      ),
    )
    .limit(1);

  const lock = hit[0];
  if (lock) {
    throw new AppError("period_locked", undefined, {
      lock_id: lock.id,
      label: lock.label,
      period_start: lock.periodStart,
      period_end: lock.periodEnd,
    });
  }
}

export interface LockPeriodInput {
  tableId: string;
  scope?: string;
  label?: string;
  periodStart: string;
  periodEnd: string;
  actor: Actor;
  requestId?: string;
}

export async function lockPeriod(ex: Executor, i: LockPeriodInput) {
  if (i.periodEnd < i.periodStart) throw new AppError("validation_error", "Ngày kết thúc kỳ phải sau ngày bắt đầu.");
  const [row] = await ex
    .insert(periodLocks)
    .values({
      tableId: i.tableId,
      scope: i.scope ?? "global",
      label: i.label ?? null,
      periodStart: toDateString(i.periodStart),
      periodEnd: toDateString(i.periodEnd),
      lockedBy: i.actor.userId,
    })
    .returning();
  await writeAudit(ex, {
    command: "system.period.lock",
    result: "success",
    actor: i.actor,
    requestId: i.requestId,
    targetType: "period_lock",
    targetId: row!.id,
    details: { table_id: i.tableId, scope: i.scope ?? "global", period_start: i.periodStart, period_end: i.periodEnd },
  });
  return row!;
}

export interface UnlockPeriodInput {
  id: string;
  /** Required: the reason is stored and audited. */
  reason: string;
  actor: Actor;
  requestId?: string;
}

export async function unlockPeriod(ex: Executor, i: UnlockPeriodInput) {
  const reason = i.reason.trim();
  if (!reason) throw new AppError("validation_error", "Mở lại kỳ phải ghi lý do.");
  const [row] = await ex
    .update(periodLocks)
    .set({ unlockedAt: sql`now()`, unlockedBy: i.actor.userId, unlockReason: reason, version: sql`${periodLocks.version} + 1` })
    .where(and(eq(periodLocks.id, i.id), isNull(periodLocks.unlockedAt)))
    .returning();
  if (!row) throw new AppError("not_found", "Không tìm thấy kỳ đang khoá.");
  await writeAudit(ex, {
    command: "system.period.unlock",
    result: "success",
    actor: i.actor,
    requestId: i.requestId,
    targetType: "period_lock",
    targetId: row.id,
    details: { reason, table_id: row.tableId, scope: row.scope },
  });
  return row;
}
