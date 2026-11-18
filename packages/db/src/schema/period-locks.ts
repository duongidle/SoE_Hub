import { date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { newId } from "./columns";

/**
 * Generic period lock (design section 11). A lock covers `[period_start, period_end]` (inclusive dates)
 * for one `table_id` and one `scope` (for example the manager tree that owns the rows).
 * A lock is active while `unlocked_at` is null. Locks are never deleted; unlocking keeps the reason.
 */
export const periodLocks = pgTable(
  "period_locks",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    tableId: text("table_id").notNull(),
    scope: text("scope").notNull().default("global"),
    label: text("label"),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lockedBy: uuid("locked_by"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true, mode: "date" }),
    unlockedBy: uuid("unlocked_by"),
    unlockReason: text("unlock_reason"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("period_locks_active_idx")
      .on(t.tableId, t.scope, t.periodStart, t.periodEnd)
      .where(sql`${t.unlockedAt} IS NULL`),
  ],
);
