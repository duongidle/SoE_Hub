import { describe, expect, it } from "vitest";
import { assertPeriodOpen, lockPeriod, unlockPeriod, newId, auditLog } from "../src/index";
import { eq } from "drizzle-orm";
import { actor, appDb } from "./helpers";

describe("period lock", () => {
  it("rejects writes whose date is inside a locked period, on both old and new dates", async () => {
    const { db } = appDb();
    const table = `locks-${newId()}`;
    await lockPeriod(db, { tableId: table, label: "Q3/2026", periodStart: "2026-07-01", periodEnd: "2026-09-30", actor });

    await expect(assertPeriodOpen(db, { tableId: table, dates: ["2026-08-15"] })).rejects.toMatchObject({
      code: "period_locked",
      details: { label: "Q3/2026", period_start: "2026-07-01", period_end: "2026-09-30" },
    });
    // Moving a row OUT of the locked period is also blocked (old date is inside).
    await expect(assertPeriodOpen(db, { tableId: table, dates: ["2026-08-15", "2026-11-01"] })).rejects.toMatchObject({ code: "period_locked" });
    // Moving a row INTO the locked period is blocked (new date is inside).
    await expect(assertPeriodOpen(db, { tableId: table, dates: ["2026-11-01", "2026-09-30"] })).rejects.toMatchObject({ code: "period_locked" });
    // Outside the period, or no date at all: fine.
    await expect(assertPeriodOpen(db, { tableId: table, dates: ["2026-10-01", null, undefined] })).resolves.toBeUndefined();
    await expect(assertPeriodOpen(db, { tableId: table, dates: [] })).resolves.toBeUndefined();
    // Other table: fine.
    await expect(assertPeriodOpen(db, { tableId: "other", dates: ["2026-08-15"] })).resolves.toBeUndefined();
  });

  it("respects scope: a scoped lock only blocks rows of that scope", async () => {
    const { db } = appDb();
    const table = `scope-${newId()}`;
    await lockPeriod(db, { tableId: table, scope: "mgr:A", periodStart: "2026-01-01", periodEnd: "2026-03-31", actor });
    await expect(assertPeriodOpen(db, { tableId: table, scope: "mgr:A", dates: ["2026-02-01"] })).rejects.toMatchObject({ code: "period_locked" });
    await expect(assertPeriodOpen(db, { tableId: table, scope: "mgr:B", dates: ["2026-02-01"] })).resolves.toBeUndefined();
    await expect(assertPeriodOpen(db, { tableId: table, dates: ["2026-02-01"] })).resolves.toBeUndefined();
  });

  it("unlock needs a reason, reopens the period, and both actions are audited", async () => {
    const { db } = appDb();
    const table = `unlock-${newId()}`;
    const lock = await lockPeriod(db, { tableId: table, periodStart: "2026-01-01", periodEnd: "2026-01-31", actor });
    await expect(unlockPeriod(db, { id: lock.id, reason: "  ", actor })).rejects.toMatchObject({ code: "validation_error" });
    await unlockPeriod(db, { id: lock.id, reason: "Nhập thiếu deal tháng 1", actor });
    await expect(assertPeriodOpen(db, { tableId: table, dates: ["2026-01-10"] })).resolves.toBeUndefined();

    const audits = await db.select().from(auditLog).where(eq(auditLog.targetId, lock.id));
    expect(audits.map((a) => a.command).sort()).toEqual(["system.period.lock", "system.period.unlock"]);
    // Unlocking twice fails.
    await expect(unlockPeriod(db, { id: lock.id, reason: "again", actor })).rejects.toMatchObject({ code: "not_found" });
  });

  it("reads a Date in Vietnam time, not UTC", async () => {
    const { db } = appDb();
    const table = `tz-${newId()}`;
    await lockPeriod(db, { tableId: table, periodStart: "2026-10-01", periodEnd: "2026-10-31", actor });
    // 2026-09-30T20:00Z is 2026-10-01 03:00 in Vietnam -> inside the lock.
    await expect(assertPeriodOpen(db, { tableId: table, dates: [new Date("2026-09-30T20:00:00Z")] })).rejects.toMatchObject({ code: "period_locked" });
  });
});
