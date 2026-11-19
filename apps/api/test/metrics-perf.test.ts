import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";

/**
 * Stage 3A-1 performance (design module3 section 6): a metric over 100,000 rows grouped by month and one more column in under 1 second.
 * Rows are seeded with one SQL statement; the metric goes through the real executor (permissions, validation, SQL, shaping).
 */
const ROWS = 100_000;
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
let x: Awaited<ReturnType<typeof makeTable>>;
let payId: string;

const timed = async (m: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const t0 = performance.now();
  const r = await a("metrics.query", { metric: { name: "p", source: x.tableId, ...m }, ...extra });
  return { r, ms: Math.round(performance.now() - t0) };
};

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
  x = await makeTable(a, {
    columns: [
      { name: "Mã deal", type: "text" },
      { name: "Doanh thu", type: "number" },
      { name: "Mức", type: "single_select", config: { options: ["P1", "P2", "P3", "P4", "P5"].map((name) => ({ name })) } },
      { name: "Ngày chốt", type: "date" },
      { name: "Giờ", type: "datetime" },
    ],
  });
  const pay = await a("datahub.table.create", { datahub_id: x.dhId, name: "Thanh toán" });
  payId = pay.id;
  await a("datahub.column.create", { table_id: payId, name: "Mã deal", type: "text" });
  await a("datahub.column.create", { table_id: payId, name: "Số tiền", type: "number" });
  const key = async (table: string, name: string) => ((await a("datahub.table.get", { table_id: table })).columns as { name: string; key: string; config: { options?: { id: string }[] } }[]).find((c) => c.name === name)!;
  const opts = (await key(x.tableId, "Mức")).config.options!.map((o) => o.id);
  const k = { code: (await key(x.tableId, "Mã deal")).key, rev: (await key(x.tableId, "Doanh thu")).key, lvl: (await key(x.tableId, "Mức")).key, day: (await key(x.tableId, "Ngày chốt")).key, ts: (await key(x.tableId, "Giờ")).key, pcode: (await key(payId, "Mã deal")).key, amt: (await key(payId, "Số tiền")).key };
  const db = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await db.connect();
  await db.query(
    `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
     SELECT gen_random_uuid(), $1::uuid, g,
       jsonb_strip_nulls(jsonb_build_object($2::text, 'D' || g, $3::text, (g::bigint * 7919) % 100000000 - 20000000,
         $4::text, CASE WHEN g % 9 = 0 THEN NULL ELSE ($7::text[])[1 + g % 5] END,
         $5::text, to_char(date '2024-01-01' + (g * 31) % 1000, 'YYYY-MM-DD'),
         $6::text, to_char(timestamptz '2024-01-01 00:00:00+00' + (g * 997 % 86400000) * interval '1 second', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
       '', $8::uuid, $8::uuid FROM generate_series(1, ${ROWS}) g`,
    [x.tableId, k.code, k.rev, k.lvl, k.day, k.ts, opts, org.userA1.id],
  );
  await db.query(
    `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
     SELECT gen_random_uuid(), $1::uuid, g, jsonb_build_object($2::text, 'D' || (1 + g % ${ROWS}), $3::text, g % 1000), '', $4::uuid, $4::uuid FROM generate_series(1, ${ROWS}) g`,
    [payId, k.pcode, k.amt, org.userA1.id],
  );
  await db.query(`UPDATE dh_tables SET row_count = ${ROWS}, next_row_no = ${ROWS + 1} WHERE id IN ($1, $2)`, [x.tableId, payId]);
  await db.query(`ANALYZE dh_rows`);
  await db.end();
}, 180_000);
afterAll(async () => {
  await t.close();
});

describe(`metrics over ${ROWS} rows`, () => {
  it("sum grouped by month and one more column: under 1 second", async () => {
    await timed({ measure: { agg: "count" } }); // warm up the pool and the plan cache
    const { r, ms } = await timed({ measure: { agg: "sum", field: "Doanh thu" }, time: { field: "Ngày chốt", bucket: "month" }, group_by: ["Mức"] });
    console.warn(`[perf] sum by month x level: ${r.rows.length} groups in ${ms} ms (sql ${r.ms} ms)`);
    expect(r.rows.length).toBeGreaterThan(100);
    expect(ms).toBeLessThan(1000);
  });

  it("each aggregate, ungrouped and by month", async () => {
    const out: string[] = [];
    for (const measure of [
      { agg: "count" }, { agg: "count_distinct", field: "Mã deal" }, { agg: "avg", field: "Doanh thu" }, { agg: "median", field: "Doanh thu" },
      { agg: "p90", field: "Doanh thu" }, { agg: "trimmed_mean", field: "Doanh thu" }, { agg: "stddev", field: "Doanh thu" },
    ]) {
      const flat = await timed({ measure });
      const grouped = await timed({ measure, time: { field: "Giờ", bucket: "month" } });
      out.push(`${measure.agg}: ${flat.ms} ms / by month ${grouped.ms} ms`);
      expect(flat.ms).toBeLessThan(2000);
      expect(grouped.ms).toBeLessThan(2000);
    }
    console.warn(`[perf] ${out.join("; ")}`);
  });

  it("a join by key columns with a payment per deal: answered with the diagnosis", async () => {
    const { r, ms } = await timed({ source: { table: x.tableId, joins: [{ table: payId, as: "TT", on: [{ left: "Mã deal", right: "Mã deal" }] }] }, measure: { agg: "sum", field: "TT.Số tiền" }, time: { field: "Ngày chốt", bucket: "year" } });
    console.warn(`[perf] join by key: ${ms} ms (sql ${r.ms} ms), matched ${r.diagnostics.joins[0].matched}/${r.diagnostics.joins[0].base_total}`);
    expect(r.diagnostics.joins[0]).toMatchObject({ matched: ROWS, base_total: ROWS });
    expect(ms).toBeLessThan(5000);
  });
});
