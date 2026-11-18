import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { auditLog, auditMinRetentionDays, newId, purgeAuditBefore, recordRowHistory, writeAudit } from "../src/index";
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

describe("controlled audit purge (soe_purge_audit_before)", () => {
  it("refuses a cutoff newer than the minimum retention (2 years floor)", async () => {
    const { db } = appDb();
    expect(await auditMinRetentionDays(db)).toBe(730);
    await expect(purgeAuditBefore(db, new Date())).rejects.toThrow(/purge refused/);
    await expect(purgeAuditBefore(db, new Date(Date.now() - 700 * 86400_000))).rejects.toThrow(/purge refused/);
  });

  it("a lower setting cannot go below the floor; a higher one is respected", async () => {
    const c = await ownerClient();
    const { db } = appDb();
    try {
      await c.query(`INSERT INTO system_settings (id, key, value) VALUES (gen_random_uuid(), 'audit.retention_days', '30'::jsonb)`);
      expect(await auditMinRetentionDays(db)).toBe(730);
      await c.query(`UPDATE system_settings SET value = '1000'::jsonb WHERE key = 'audit.retention_days'`);
      expect(await auditMinRetentionDays(db)).toBe(1000);
      await expect(purgeAuditBefore(db, new Date(Date.now() - 800 * 86400_000))).rejects.toThrow(/purge refused/);
    } finally {
      await c.query(`DELETE FROM system_settings WHERE key = 'audit.retention_days'`);
      await c.end();
    }
  });

  it("deletes only rows older than the cutoff; the bypass does not leak outside the function", async () => {
    const c = await ownerClient();
    const { db, pool } = appDb();
    const oldId = newId();
    const newIdv = newId();
    try {
      // The owner inserts an old row directly (inserts are allowed, only change is blocked).
      await c.query(`INSERT INTO audit_log (id, at, command, result) VALUES ($1, now() - interval '3 years', 'test.old', 'success'), ($2, now(), 'test.new', 'success')`, [oldId, newIdv]);
      const n = await purgeAuditBefore(db, new Date(Date.now() - 731 * 86400_000));
      expect(n).toBeGreaterThanOrEqual(1);
      const left = await pool.query(`SELECT id FROM audit_log WHERE id = ANY($1)`, [[oldId, newIdv]]);
      expect(left.rows.map((r) => r.id)).toEqual([newIdv]);
      // The runtime role cannot use the flag to delete by itself.
      const cl = await pool.connect();
      try {
        await cl.query("BEGIN");
        await cl.query(`SELECT set_config('soe.audit_purge', 'on', true)`);
        await expect(cl.query(`DELETE FROM audit_log WHERE id = $1`, [newIdv])).rejects.toThrow(/permission denied/);
        await cl.query("ROLLBACK");
      } finally {
        cl.release();
      }
      // Outside the function the trigger still blocks the owner.
      await expect(c.query(`DELETE FROM audit_log WHERE id = $1`, [newIdv])).rejects.toThrow(/append-only/);
    } finally {
      await c.end();
    }
  });

  it("row_history is never purged by it", async () => {
    const c = await ownerClient();
    try {
      await expect(c.query(`DELETE FROM row_history`)).rejects.toThrow(/append-only/);
    } finally {
      await c.end();
    }
  });
});
