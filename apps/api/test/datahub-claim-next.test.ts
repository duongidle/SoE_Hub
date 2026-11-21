import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg } from "./fixtures";
import { CLAIM_BATCH, claimBatchQuery, claimNext } from "../src/modules/datahub/recalc";

/**
 * `claimNext` picks the oldest pending column whose inputs are all ready. With thousands of pending columns (a tree build queues 500-1,000) it
 * compared every pending column with every input still not ready: 100 ms per claim at 1,500 pending, 4,000 here, and a build of 1,000 columns waited
 * 20-60 s (4.6C). It now walks the pending columns in order through `dh_columns_calc_order_idx` and stops at the first one that is free.
 */
let t: TestApp;
let x: { tableId: string };
beforeAll(async () => {
  t = await makeApp();
  const org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  const a = as(t, org.userA1.id);
  x = await makeTable(a, { columns: [{ name: "A", type: "number" }] });
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

/** Rows a plan node produced, summed over every scan of `relation` (rows x loops). */
function scanned(node: any, relation: string): number { // eslint-disable-line @typescript-eslint/no-explicit-any
  let n = node["Relation Name"] === relation ? node["Actual Rows"] * node["Actual Loops"] : 0;
  for (const c of node.Plans ?? []) n += scanned(c, relation);
  return n;
}

// Not a clock test: how long a claim takes depends on the machine. What does not depend on it is how many rows the claim has to look at.
describe("claimNext with many pending columns", () => {
  it("looks at one batch of pending columns, not all 4,000", async () => {
    const res = await t.c.db.db.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${claimBatchQuery(null)}`);
    const plan = (res.rows[0] as Record<string, any>)["QUERY PLAN"][0].Plan; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(plan["Actual Rows"]).toBeLessThanOrEqual(CLAIM_BATCH);
    // Each test column has one input; the old query compared the inputs of every pending column (4,000).
    expect(scanned(plan, "dh_formula_deps")).toBeLessThanOrEqual(CLAIM_BATCH * 2);
  });

  it("claims 100 different columns, oldest request first", async () => {
    const seen: string[] = [];
    for (let i = 0; i < 100; i++) {
      const c = await claimNext(t.c.db.db);
      expect(c).not.toBeNull();
      seen.push(c!.id);
    }
    expect(new Set(seen).size).toBe(100);
    const order = (await t.c.db.db.execute(sql`SELECT id FROM dh_columns /*scope:system*/ WHERE calc_status = 'running' ORDER BY calc_bulk, calc_requested_at, id`)).rows.map((r) => (r as { id: string }).id);
    expect(new Set(order)).toEqual(new Set(seen));
  });

  it("walks past a batch whose columns wait for an input", async () => {
    // Make the first CLAIM_BATCH pending columns wait for a column that is not ready, so the free one lies in a later batch.
    await t.c.db.db.execute(sql`UPDATE dh_columns SET calc_status = 'ready' /*scope:system*/ WHERE calc_status = 'running'`);
    await t.c.db.db.execute(sql`UPDATE dh_columns /*scope:system*/ SET calc_status = 'running' WHERE table_id = ${x.tableId}::uuid AND type = 'formula' AND key NOT LIKE 'f%'`);
    const first = (await t.c.db.db.execute(sql`SELECT id FROM dh_columns /*scope:system*/ WHERE calc_status = 'pending' AND key LIKE 'f%' ORDER BY calc_bulk, calc_requested_at, id LIMIT ${CLAIM_BATCH + 5}`)).rows.map((r) => (r as { id: string }).id);
    const blocked = first.slice(0, CLAIM_BATCH + 4);
    await t.c.db.db.execute(sql`UPDATE dh_formula_deps SET src_key = (SELECT key FROM dh_columns WHERE table_id = ${x.tableId}::uuid AND type = 'formula' AND key NOT LIKE 'f%') /*scope:system*/ WHERE column_id = ANY(${`{${blocked.join(",")}}`}::uuid[])`);
    const c = await claimNext(t.c.db.db);
    expect(c?.id).toBe(first[CLAIM_BATCH + 4]);
  });
});
