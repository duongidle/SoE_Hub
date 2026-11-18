import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { reconcileColumns } from "../src/modules/datahub/reconcile";

/** Nightly reconciliation (design module2 section 6.7): a stored value that differs from a full recomputation is corrected, logged and reported to every Admin. */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
let admin: pg.Client;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
  admin = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await admin.connect();
});
afterAll(async () => {
  await admin.end();
  await t.close();
});

const q = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows as Record<string, unknown>[];

/** Customers with a SUMIFS over Deals; every other column of the shared test database is marked as just reconciled so this test only judges its own. */
async function scenario() {
  const cust = await makeTable(a, { columns: [{ name: "Mã", type: "text" }] });
  const deals = await a("datahub.table.create", { datahub_id: cust.dhId, name: "Deals" });
  await a("datahub.column.create", { table_id: deals.id, name: "Mã KH", type: "text" });
  await a("datahub.column.create", { table_id: deals.id, name: "Tiền", type: "number" });
  const sum = await a("datahub.column.create", { table_id: cust.tableId, name: "Tổng", type: "formula", config: { formula: "=SUMIFS([Deals].[Tiền], [Deals].[Mã KH], [Mã])" } });
  const r1 = await a("datahub.row.create", { table_id: cust.tableId, data: { Mã: "K1" } });
  const r2 = await a("datahub.row.create", { table_id: cust.tableId, data: { Mã: "K2" } });
  await a("datahub.row.create", { table_id: deals.id, data: { "Mã KH": "K1", Tiền: 10 } });
  await a("datahub.row.create", { table_id: deals.id, data: { "Mã KH": "K2", Tiền: 20 } });
  await drainOutbox(t);
  await q(`UPDATE dh_columns SET reconciled_at = now() WHERE id <> $1`, [sum.id]);
  await q(`UPDATE dh_columns SET reconciled_at = NULL WHERE id = $1`, [sum.id]);
  return { cust, sum, r1, r2 };
}

describe("nightly reconciliation", () => {
  it("clean data: nothing reported, the column is marked as reconciled", async () => {
    const s = await scenario();
    const before = Number((await q(`SELECT count(*) FROM outbox WHERE event = 'datahub.reconcile.mismatch'`))[0]!.count);
    const r = await reconcileColumns(t.c.db.db, { rowBudget: 2 }); // the budget fits one column of this table: its (never reconciled) column goes first
    expect(r.columns).toBe(1);
    expect(r.mismatches).toEqual([]);
    expect(Number((await q(`SELECT count(*) FROM outbox WHERE event = 'datahub.reconcile.mismatch'`))[0]!.count)).toBe(before);
    expect((await q(`SELECT reconciled_at FROM dh_columns WHERE id = $1`, [s.sum.id]))[0]!.reconciled_at).not.toBeNull();
  });

  it("a damaged stored value is corrected, logged, and every Admin is notified (no values in the message)", async () => {
    const s = await scenario();
    await q(`UPDATE dh_rows SET data = jsonb_set(data, $2::text[], '-999') WHERE id = $1`, [s.r1.id, `{${s.sum.key}}`]);
    const versionBefore = (await q(`SELECT version FROM dh_rows WHERE id = $1`, [s.r1.id]))[0]!.version;
    const r = await reconcileColumns(t.c.db.db, { rowBudget: 2 });
    expect(r.mismatches).toEqual([{ table_id: s.cust.tableId, column_key: s.sum.key, column_name: "Tổng", cells: 1 }]);
    // Corrected in place, without touching the row's version or history.
    const row = await a("datahub.row.get", { table_id: s.cust.tableId, row_id: s.r1.id });
    expect(row.data[s.sum.key]).toBe(10);
    expect((await q(`SELECT version FROM dh_rows WHERE id = $1`, [s.r1.id]))[0]!.version).toBe(versionBefore);
    // The audit log has the entry (names and counts only).
    const audit = await q(`SELECT details FROM audit_log WHERE command = 'datahub.reconcile' ORDER BY at DESC LIMIT 1`);
    expect(audit[0]!.details).toMatchObject({ cells: 1, columns: [{ table_id: s.cust.tableId, column: s.sum.key, cells: 1 }] });
    // Notifications reach both Admins through the outbox.
    await drainOutbox(t);
    const notes = await q(`SELECT user_id, title, body FROM notifications WHERE type = 'datahub.reconcile' AND data->'columns' @> $1::jsonb`, [JSON.stringify([{ table_id: s.cust.tableId }])]);
    expect(notes.map((n) => n.user_id as string)).toEqual(expect.arrayContaining([org.admin.id, org.admin2.id]));
    expect(notes[0]!.body).toContain("Tổng");
    expect(notes[0]!.body).toContain("1 ô");
    expect(notes[0]!.body).not.toContain("-999");
    expect(notes[0]!.body).not.toContain("K1");
    // The correction is also visible downstream: a second run finds nothing.
    await q(`UPDATE dh_columns SET reconciled_at = NULL WHERE id = $1`, [s.sum.id]);
    expect((await reconcileColumns(t.c.db.db, { rowBudget: 2 })).mismatches).toEqual([]);
  });

  it("rotation with a limit: oldest first, a column with queued changes or a refresh (TODAY) is skipped", async () => {
    const s = await scenario();
    const second = await a("datahub.column.create", { table_id: s.cust.tableId, name: "Số", type: "formula", config: { formula: "=COUNTIFS([Deals].[Mã KH], [Mã])" } });
    const today = await a("datahub.column.create", { table_id: s.cust.tableId, name: "Hôm nay", type: "formula", config: { formula: "=TODAY()" } });
    await drainOutbox(t);
    await q(`UPDATE dh_columns SET reconciled_at = now() WHERE id <> ALL($1::uuid[])`, [[s.sum.id, second.id]]);
    await q(`UPDATE dh_columns SET reconciled_at = now() - interval '2 days' WHERE id = $1`, [s.sum.id]);
    await q(`UPDATE dh_columns SET reconciled_at = now() - interval '1 day' WHERE id = $1`, [second.id]);
    // Budget of 1 row: only the oldest column (both tables have 2 rows, so one column fits the first slot).
    const r = await reconcileColumns(t.c.db.db, { rowBudget: 1 });
    expect(r.columns).toBe(1);
    const at = (id: string) => q(`SELECT reconciled_at > now() - interval '1 hour' AS fresh FROM dh_columns WHERE id = $1`, [id]).then((x) => x[0]!.fresh);
    expect(await at(s.sum.id)).toBe(true);
    expect(await at(second.id)).toBe(false);
    expect(await at(today.id)).toBe(true); // set to now() above, never taken: volatile columns are not reconciled
    // A column with queued changes is not at rest.
    await a("datahub.row.create", { table_id: s.cust.tableId, data: { Mã: "K9" } });
    await q(`UPDATE dh_columns SET reconciled_at = NULL WHERE id = $1`, [second.id]);
    await q(`UPDATE dh_columns SET calc_status = 'pending' WHERE id = $1`, [second.id]);
    await reconcileColumns(t.c.db.db, { rowBudget: 3 });
    expect((await q(`SELECT reconciled_at FROM dh_columns WHERE id = $1`, [second.id]))[0]!.reconciled_at).toBeNull();
    // The shared test database must not keep a TODAY() column: other tests count the volatile columns that are due.
    await a("datahub.column.delete", { table_id: s.cust.tableId, column: today.key });
    await drainOutbox(t);
  });
});
