import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg } from "./fixtures";
import { claimNext } from "../src/modules/datahub/recalc";

/**
 * `claimNext` picks the oldest pending column whose inputs are all ready. With thousands of pending columns (a tree build queues 500-1,000) it
 * compared every pending column with every input still not ready: 100 ms per claim at 1,500 pending, 4,000 here, and a build of 1,000 columns waited
 * 20-60 s (4.6C). It now walks the pending columns in order through `dh_columns_calc_order_idx` and stops at the first one that is free.
 */
let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
  const org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  const a = as(t, org.userA1.id);
  const x = await makeTable(a, { columns: [{ name: "A", type: "number" }] });
  await a("datahub.column.create", { table_id: x.tableId, name: "B", type: "formula", config: { formula: "=[A]*2" } });
  await drainOutbox(t);
  // 4,000 copies of the formula column, all pending and each reading column A (its dependency, ready).
  const cols = (await t.c.db.db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'dh_columns' AND is_generated = 'NEVER' ORDER BY ordinal_position`)).rows.map((r) => `"${(r as { column_name: string }).column_name}"`).join(", ");
  await t.c.db.db.execute(sql`INSERT INTO dh_columns (${sql.raw(cols)}) SELECT ${sql.raw(cols.split(", ").map((c) => `r.${c}`).join(", "))} FROM (
    SELECT (jsonb_populate_record(NULL::dh_columns, (to_jsonb(b) - 'name_norm') || jsonb_build_object('id', gen_random_uuid(), 'key', 'f' || i, 'name', 'F' || i, 'calc_status', 'pending', 'calc_requested_at', now()))).*
    FROM dh_columns b, generate_series(1, 4000) i WHERE /*scope:system*/ b.table_id = ${x.tableId}::uuid AND b.type = 'formula') r`);
  await t.c.db.db.execute(sql`INSERT INTO dh_formula_deps (column_id, table_id, src_table_id, src_key, kind)
    SELECT c.id, d.table_id, d.src_table_id, d.src_key, d.kind FROM dh_columns c, dh_formula_deps d
    WHERE /*scope:system*/ c.table_id = ${x.tableId}::uuid AND c.key LIKE 'f%' AND d.column_id = (SELECT id FROM dh_columns WHERE table_id = ${x.tableId}::uuid AND type = 'formula' AND calc_status = 'ready')`);
  await t.c.db.db.execute(sql`ANALYZE dh_columns`);
});
afterAll(async () => {
  await t.close();
});

describe("claimNext with many pending columns", () => {
  it("claims 100 columns in fast (about 40 ms each with 4,000 pending before the index)", async () => {
    const t0 = Date.now();
    let claimed = 0;
    for (let i = 0; i < 100; i++) if (await claimNext(t.c.db.db)) claimed++;
    const ms = Date.now() - t0;
    expect(claimed).toBe(100);
    expect(ms).toBeLessThan(500);
  });
});
