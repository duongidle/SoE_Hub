import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, drainOutbox, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Performance of formulas over big tables (design module2 section 6.6): 100,000 x 100,000 rows. Every aggregate or
 * lookup with an equality condition is ONE grouped SQL query for the whole column, not one query per row.
 * Seeded with SQL (like datahub-perf.test.ts); numbers are printed so the run records them.
 */
const ROWS = 100_000;
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let src: { id: string };
let dst: { id: string };
let admin: pg.Client;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  owner = as(t, org.userA1.id);
  const dh = await owner("datahub.datahub.create", { name: "Hiệu năng công thức" });
  src = await owner("datahub.table.create", { datahub_id: dh.id, name: "Thanh toán" });
  dst = await owner("datahub.table.create", { datahub_id: dh.id, name: "Deals" });
  const sk: Record<string, string> = {};
  const dk: Record<string, string> = {};
  for (const [n, ty] of [["Mã deal", "text"], ["Số tiền", "currency"], ["Loại", "text"], ["Ngày", "date"]] as const) sk[n] = (await owner("datahub.column.create", { table_id: src.id, name: n, type: ty })).key;
  for (const [n, ty] of [["Mã deal", "text"], ["Doanh thu", "currency"]] as const) dk[n] = (await owner("datahub.column.create", { table_id: dst.id, name: n, type: ty })).key;
  admin = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await admin.connect();
  const s = Date.now();
  await admin.query(
    `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
     SELECT gen_random_uuid(), $1::uuid, g, jsonb_build_object($2::text, 'D' || (g % 50000), $3::text, (g * 7919)::bigint % 1000000, $4::text, (ARRAY['A','B','C'])[1 + g % 3], $5::text, to_char(date '2026-01-01' + g % 365, 'YYYY-MM-DD')), '', $6::uuid, $6::uuid
     FROM generate_series(1, ${ROWS}) g`,
    [src.id, sk["Mã deal"], sk["Số tiền"], sk["Loại"], sk["Ngày"], org.userA1.id],
  );
  await admin.query(
    `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
     SELECT gen_random_uuid(), $1::uuid, g, jsonb_build_object($2::text, 'D' || (g % 60000), $3::text, g::bigint * 1000), '', $4::uuid, $4::uuid
     FROM generate_series(1, ${ROWS}) g`,
    [dst.id, dk["Mã deal"], dk["Doanh thu"], org.userA1.id],
  );
  await admin.query(`UPDATE dh_tables SET row_count = ${ROWS}, next_row_no = ${ROWS + 1} WHERE id IN ($1, $2)`, [src.id, dst.id]);
  await admin.query("ANALYZE dh_rows");
  console.warn(`[perf] seeded 2 x ${ROWS} rows in ${Date.now() - s} ms`);
}, 180_000);
afterAll(async () => {
  await admin.end();
  await t.close();
});

async function recompute(label: string, name: string, formula: string) {
  const col = await owner("datahub.column.create", { table_id: dst.id, name, type: "formula", config: { formula } });
  const s = performance.now();
  const n = await processPendingColumns(t.c.db.db);
  const ms = performance.now() - s;
  console.warn(`[perf] ${label}: full-column recompute of ${ROWS} rows against ${ROWS} source rows = ${(ms / 1000).toFixed(2)} s (${n} column(s))`);
  return { col, ms };
}

describe("100,000 x 100,000: one grouped SQL query per column", () => {
  it.each([
    ["SUMIFS equality", "Tổng thanh toán", "=SUMIFS([Thanh toán].[Số tiền], [Thanh toán].[Mã deal], [Mã deal])"],
    ["COUNTIFS two equality conditions", "Số khoản loại A", '=COUNTIFS([Thanh toán].[Mã deal], [Mã deal], [Thanh toán].[Loại], "A")'],
    ["XLOOKUP exact", "Khoản đầu", '=XLOOKUP([Mã deal], [Thanh toán].[Mã deal], [Thanh toán].[Số tiền], 0)'],
    ["AVERAGEIFS", "Trung bình", '=IFERROR(AVERAGEIFS([Thanh toán].[Số tiền], [Thanh toán].[Mã deal], [Mã deal]), 0)'],
    ["MAXIFS on a date", "Ngày muộn nhất", "=MAXIFS([Thanh toán].[Ngày], [Thanh toán].[Mã deal], [Mã deal])"],
    ["composite (SUMIFS / COUNTIFS)", "Bình quân khoản", "=IFERROR(SUMIFS([Thanh toán].[Số tiền], [Thanh toán].[Mã deal], [Mã deal]) / COUNTIFS([Thanh toán].[Mã deal], [Mã deal]), 0)"],
  ])("%s", async (label, name, formula) => {
    const { ms, col } = await recompute(label, name, formula);
    expect(ms).toBeLessThan(30_000); // "a few seconds" on a dev machine; the bound is generous for slow CI disks
    const rows = (await owner("datahub.row.list", { table_id: dst.id, limit: 3 })).items as { data: Record<string, unknown> }[];
    expect(rows.every((r) => r.data[col.key] !== undefined)).toBe(true);
  }, 120_000);

  it("a change in the source table recomputes the dependent columns once, with unchanged values skipped", async () => {
    const row = (await owner("datahub.row.list", { table_id: src.id, limit: 1 })).items[0] as { id: string; version: number };
    const skey = (await owner("datahub.table.get", { table_id: src.id })).columns.find((c: { name: string }) => c.name === "Số tiền").key;
    const before = Number((await admin.query(`SELECT count(*) FROM row_history WHERE table_id = $1`, [dst.id])).rows[0].count);
    await owner("datahub.row.update", { table_id: src.id, row_id: row.id, data: { [skey]: 123 }, version: row.version });
    const s = performance.now();
    await drainOutbox(t);
    const ms = performance.now() - s;
    console.warn(`[perf] one source row edited -> dependent columns recomputed in the worker: ${(ms / 1000).toFixed(2)} s`);
    expect(Number((await admin.query(`SELECT count(*) FROM row_history WHERE table_id = $1`, [dst.id])).rows[0].count)).toBe(before);
    expect(ms).toBeLessThan(120_000);
  }, 180_000);
});
