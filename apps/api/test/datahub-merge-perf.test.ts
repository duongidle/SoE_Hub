import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { processPendingMerges } from "../src/modules/datahub";

/**
 * Stage 3B performance: the first sync of two source tables (100,000 + 50,000 rows, 30,000 keys shared) into one merged table, and the sync
 * after a one-row change (nothing else is rewritten). Rows are seeded with SQL; the merged table is made through the real executor.
 */
const A_ROWS = 100_000;
const B_ROWS = 50_000;
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  owner = as(t, org.userA1.id);
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe("sync of a big merged table", () => {
  it("first sync of 150,000 source rows and a resync after one edit are fast; the numbers add up", async () => {
    const a = await makeTable(owner, { columns: [{ name: "Mã", type: "text" }, { name: "Tiền", type: "number" }] });
    const b = await makeTable(owner, { columns: [{ name: "Mã", type: "text" }, { name: "Tiền", type: "number" }] });
    const keyOf = async (id: string, name: string) => ((await owner("datahub.table.get", { table_id: id })).columns as { name: string; key: string }[]).find((c) => c.name === name)!.key;
    const db = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
    await db.connect();
    const seed = async (tableId: string, from: number, rows: number) => {
      const code = await keyOf(tableId, "Mã");
      const amt = await keyOf(tableId, "Tiền");
      await db.query(
        `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
         SELECT gen_random_uuid(), $1::uuid, g, jsonb_build_object($2::text, 'K' || (${from} + g), $3::text, g), '', $4::uuid, $4::uuid FROM generate_series(1, ${rows}) g`,
        [tableId, code, amt, org.userA1.id],
      );
      await db.query(`UPDATE dh_tables SET row_count = ${rows}, next_row_no = ${rows + 1} WHERE id = $1`, [tableId]);
    };
    await seed(a.tableId, 0, A_ROWS); // K1..K100000
    await seed(b.tableId, 70_000, B_ROWS); // K70001..K120000: 30,000 keys shared with A
    await db.query("ANALYZE dh_rows");
    await db.end();

    const created = await owner("datahub.merge.create", { datahub_id: a.dhId, name: "Lớn", sources: [a.tableId, b.tableId], dedup: { columns: ["Mã"], strategy: "priority" } });
    const t0 = performance.now();
    await processPendingMerges(t.c.db.db);
    const first = Math.round(performance.now() - t0);
    const info = await owner("datahub.merge.get", { table_id: created.table.id });
    expect(info.status).toBe("ok");
    expect(info.diagnostics).toMatchObject({ total_read: A_ROWS + B_ROWS, total_kept: 120_000, dropped: 30_000, duplicate_groups: 30_000 });
    expect((await owner("datahub.table.get", { table_id: created.table.id })).row_count).toBe(120_000);
    expect(first).toBeLessThan(60_000);

    // one edit in a source -> a sync that writes one row
    await drainOutbox(t);
    const row = (await owner("datahub.row.list", { table_id: a.tableId, limit: 1 })).items[0];
    await owner("datahub.row.update", { table_id: a.tableId, row_id: row.id, data: { Tiền: 123456789 }, version: row.version });
    await t.c.db.db.execute(sql`SELECT 1`);
    const { dispatchOutboxOnce } = await import("../src/core/outbox-dispatcher");
    const { defaultSubscribers } = await import("../src/core/subscribers");
    await dispatchOutboxOnce(t.c.db.db, defaultSubscribers(t.c.events, t.c.config.AUTH_SECRET), t.c.logger, { batchSize: 500 });
    const t1 = performance.now();
    await processPendingMerges(t.c.db.db);
    const again = Math.round(performance.now() - t1);
    expect(again).toBeLessThan(30_000);
    const ev = await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM outbox WHERE aggregate_id = ${created.table.id} AND event = 'datahub.row.updated' AND status = 'pending'`);
    expect((ev.rows[0] as { n: number }).n).toBe(1);
  }, 240_000);
});
