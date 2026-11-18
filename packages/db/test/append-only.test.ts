import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { auditLog, recordRowHistory, writeAudit, newId } from "../src/index";
import { actor, actorRef, appDb, ownerClient } from "./helpers";

describe("audit_log is append-only", () => {
  it("the app role can insert and read", async () => {
    const { db } = appDb();
    await writeAudit(db, { command: "test.append", result: "success", actor, targetType: "x", targetId: "1" });
    const rows = await db.select().from(auditLog).where(sql`${auditLog.command} = 'test.append'`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("the app role cannot UPDATE, DELETE or TRUNCATE (privileges)", async () => {
    const { pool } = appDb();
    await expect(pool.query(`UPDATE audit_log SET result = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/permission denied/);
    await expect(pool.query(`TRUNCATE audit_log`)).rejects.toThrow(/permission denied/);
  });

  it("even the owner cannot change it (trigger)", async () => {
    const c = await ownerClient();
    try {
      await expect(c.query(`UPDATE audit_log SET result = 'x'`)).rejects.toThrow(/append-only/);
      await expect(c.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
      await expect(c.query(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);
    } finally {
      await c.end();
    }
  });
});

describe("row_history is append-only", () => {
  it("accepts inserts, rejects UPDATE/DELETE", async () => {
    const { db, pool } = appDb();
    await recordRowHistory(db, {
      tableId: "t",
      rowId: newId(),
      version: 1,
      op: "create",
      changes: [{ field: "name", old: null, new: "A" }],
      actor: actorRef,
    });
    await expect(pool.query(`UPDATE row_history SET op = 'x'`)).rejects.toThrow(/permission denied/);
    await expect(pool.query(`DELETE FROM row_history`)).rejects.toThrow(/permission denied/);
  });
});

describe("snapshots are insert-only", () => {
  it("rejects UPDATE/DELETE on snapshot_rows", async () => {
    const { pool } = appDb();
    await expect(pool.query(`UPDATE snapshot_rows SET data = '{}'`)).rejects.toThrow(/permission denied/);
    await expect(pool.query(`DELETE FROM snapshots`)).rejects.toThrow(/permission denied/);
  });
});
