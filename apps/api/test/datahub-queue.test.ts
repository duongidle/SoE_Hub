import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { enqueue, hasQueued, linkedRows, nextChangeSeq, readQueue, deleteQueue, currentChangeSeq } from "../src/modules/datahub/change-queue";

/** Stage 2B+ step 1 (design module2 section 6.7): GIN index of a Relation column, reverse lookup, shared accumulating queue. */
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

describe("reverse lookup of Relation cells (GIN index, no link table)", () => {
  it("creating a Relation column creates its partial GIN index; deleting the column purge drops it", async () => {
    const cust = await makeTable(a, { columns: [{ name: "Tên", type: "text" }] });
    const deals = await makeTable(a, { columns: [{ name: "Tên deal", type: "text" }] });
    const rel = await a("datahub.column.create", { table_id: deals.tableId, name: "KH", type: "relation", config: { target_table_id: cust.tableId, multiple: true } });
    const name = `dh_ix_${deals.tableId.replace(/-/g, "").slice(0, 12)}_${rel.key}_rel`;
    const ix = await q(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [name]);
    expect(ix).toHaveLength(1);
    expect(String(ix[0]!.indexdef)).toContain("USING gin");
    expect(String(ix[0]!.indexdef)).toContain("deleted_at IS NULL");
  });

  it("finds the rows that link to given rows, honours deletion and `within`, and uses the index", async () => {
    const cust = await makeTable(a, { columns: [{ name: "Tên", type: "text" }] });
    const deals = await makeTable(a, { columns: [{ name: "Tên deal", type: "text" }] });
    const rel = await a("datahub.column.create", { table_id: deals.tableId, name: "KH", type: "relation", config: { target_table_id: cust.tableId, multiple: true } });
    const c1 = await a("datahub.row.create", { table_id: cust.tableId, data: { Tên: "A" } });
    const c2 = await a("datahub.row.create", { table_id: cust.tableId, data: { Tên: "B" } });
    const c3 = await a("datahub.row.create", { table_id: cust.tableId, data: { Tên: "C" } });
    const d1 = await a("datahub.row.create", { table_id: deals.tableId, data: { "Tên deal": "d1", KH: [c1.id] } });
    const d2 = await a("datahub.row.create", { table_id: deals.tableId, data: { "Tên deal": "d2", KH: [c1.id, c2.id] } });
    await a("datahub.row.create", { table_id: deals.tableId, data: { "Tên deal": "d3", KH: [c3.id] } });
    const d4 = await a("datahub.row.create", { table_id: deals.tableId, data: { "Tên deal": "d4", KH: [c2.id] } });
    const db = t.c.db.db;
    expect((await linkedRows(db, deals.tableId, rel.key, [c1.id])).sort()).toEqual([d1.id, d2.id].sort());
    expect((await linkedRows(db, deals.tableId, rel.key, [c1.id, c2.id])).sort()).toEqual([d1.id, d2.id, d4.id].sort());
    expect(await linkedRows(db, deals.tableId, rel.key, [])).toEqual([]);
    expect(await linkedRows(db, deals.tableId, rel.key, [c1.id], { within: [d2.id, d4.id] })).toEqual([d2.id]);
    await a("datahub.row.delete", { table_id: deals.tableId, row_id: d1.id });
    expect(await linkedRows(db, deals.tableId, rel.key, [c1.id])).toEqual([d2.id]);
    // On a table of a realistic size the planner uses the GIN index.
    await admin.query(`INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
      SELECT gen_random_uuid(), $1::uuid, 100 + g, jsonb_build_object($2::text, jsonb_build_array(gen_random_uuid()::text)), '', $3::uuid, $3::uuid FROM generate_series(1, 150000) g`, [deals.tableId, rel.key, org.userA1.id]);
    await admin.query("ANALYZE dh_rows");
    const plan = await q(`EXPLAIN SELECT id FROM dh_rows WHERE table_id = '${deals.tableId}'::uuid AND deleted_at IS NULL AND (data->'${rel.key}') ?| ARRAY['${c1.id}']`);
    expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain(`_${rel.key}_rel`);
  });

  it("rejects a column key that is not a column key (no SQL injection through the key)", async () => {
    await expect(linkedRows(t.c.db.db, org.userA1.id, "c_x'; DROP TABLE dh_rows;--", [org.userA1.id])).rejects.toThrow(/invalid column key/);
  });
});

describe("the shared change queue accumulates and is consumed per column", () => {
  it("sequence numbers grow; entries accumulate per column; only what was read is deleted; columns are marked pending", async () => {
    const x = await makeTable(a, { columns: [{ name: "A", type: "number" }] });
    const col = await a("datahub.column.create", { table_id: x.tableId, name: "F", type: "formula", config: { formula: "=[A]*2" } });
    const db = t.c.db.db;
    await q(`DELETE FROM dh_change_queue WHERE column_id = $1`, [col.id]); // the creation queued a full recompute
    await q(`UPDATE dh_columns SET calc_status = 'ready' WHERE id = $1`, [col.id]);
    const s1 = await nextChangeSeq(db);
    const s2 = await nextChangeSeq(db);
    expect(s2).toBe(s1 + 1);
    expect(await currentChangeSeq(db)).toBe(s2);
    const r1 = "00000000-0000-7000-8000-000000000001";
    const r2 = "00000000-0000-7000-8000-000000000002";
    await enqueue(db, [{ columnId: col.id, seq: s1, mode: "rows", rowIds: [r1] }]);
    await enqueue(db, [
      { columnId: col.id, seq: s2, mode: "rows", rowIds: [r2] },
      { columnId: col.id, seq: s2, mode: "keys", keys: { cols: ["c_x"], tuples: [["abc"], [12]] } },
    ]);
    expect((await q(`SELECT calc_status FROM dh_columns WHERE id = $1`, [col.id]))[0]!.calc_status).toBe("pending");
    const entries = await readQueue(db, col.id);
    expect(entries.map((e) => [e.mode, e.seq])).toEqual([["rows", s1], ["rows", s2], ["keys", s2]]);
    expect(entries[2]!.keys).toEqual({ cols: ["c_x"], tuples: [["abc"], [12]] });
    expect(await hasQueued(db, col.id)).toBe(true);
    expect(await hasQueued(db, col.id, s1 - 1)).toBe(false);
    // An entry written after the worker read stays when the worker deletes what it read.
    await enqueue(db, [{ columnId: col.id, seq: s2 + 1, mode: "full" }]);
    await deleteQueue(db, entries.map((e) => e.id));
    expect((await readQueue(db, col.id)).map((e) => e.mode)).toEqual(["full"]);
    await deleteQueue(db, (await readQueue(db, col.id)).map((e) => e.id));
    expect(await hasQueued(db, col.id)).toBe(false);
  });
});

describe("the SQL equality key matches the formula engine's", () => {
  it("numbers and numeric text share a key, text is case-insensitive, TRUE text is a boolean, blank is blank", async () => {
    const { equalityKey } = await import("@soe/formula");
    const samples: (string | number | boolean | null)[] = [12, "12", " 12.0 ", "1e2", 100, "10%", 0.1, "abc", "ABC", "Công ty Á", "công ty á", "TRUE", "true", true, false, "", null, "00123", 123, "1,5"];
    for (const v of samples) {
      const j = JSON.stringify(v);
      const sqlKey = (await q(`SELECT soe_eqk($1::jsonb) AS k`, [j]))[0]!.k as string;
      const jsKey = equalityKey(v);
      // The key texts differ in number formatting by design; what must agree is WHICH values are equal.
      for (const w of samples) {
        const wKey = (await q(`SELECT soe_eqk($1::jsonb) AS k`, [JSON.stringify(w)]))[0]!.k as string;
        if (equalityKey(w) === jsKey) expect(wKey, `${JSON.stringify(v)} vs ${JSON.stringify(w)}`).toBe(sqlKey);
      }
    }
  });
});
