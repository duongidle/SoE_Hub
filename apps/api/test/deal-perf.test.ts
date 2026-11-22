import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, drainOutbox, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, DEAL_DASHBOARD_NAME, ensureTreeTemplates } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";

/**
 * Stage 4.8 load test: 20,000 deals (a few people each), two instalments per deal. Invented data only.
 * The rows are cloned by SQL from one deal made by the real commands (so the shapes are the real ones); the commands then run on that volume.
 * Only wide limits are asserted (3 s); the numbers go to progress.md.
 */
const DEALS = 20_000;
/** A valid (version 4) uuid made from a text, so the clones have the same ids on every run. */
const uid = (x: string) => `(substr(md5(${x}), 1, 12) || '4' || substr(md5(${x}), 14, 3) || '8' || substr(md5(${x}), 18, 15))::uuid`;
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
const tables: Record<string, string> = {};
const col = async (table: string, pick: (c: { key: string; name: string; role: string | null }) => boolean) => ((await mgrA("datahub.table.get", { table_id: table })).columns as { key: string; name: string; role: string | null }[]).find(pick)!.key;
const ms = async <T>(label: string, fn: () => Promise<T>): Promise<{ r: T; ms: number }> => {
  const s = performance.now();
  const r = await fn();
  const d = Math.round(performance.now() - s);
  console.warn(`[perf] ${label}: ${d} ms`);
  return { r, ms: d };
};
let payIds: string[] = [];

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id);
  await drainOutbox(t);
  const list = await mgrA("datahub.template.list");
  for (const d of BUILTIN_DEFAULT_SET) tables[d.name] = list.find((x: { name: string }) => x.name === d.name).master_table_id;
  const person = (id: string, attrs: Record<string, unknown>) => ({ id, attrs });
  const d0 = await mgrA("datahub.row.create", {
    table_id: tables["Deals"]!,
    data: { "Tên công ty": "Công ty Mẫu", "Loại deal": "POD bán mới", "Start date": "2026-06-10", "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.15 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.05 })] },
  });
  const s = await mgrA("payment.schedule", { deal_id: d0.id, payments: [{ legal_entity: "CT Mẫu", amount: 100_000_000, due: "2026-07-01" }, { legal_entity: "CT Mẫu", amount: 100_000_000, due: "2026-08-01" }] });
  await drainOutbox(t);
  const nameK = await col(tables["Deals"]!, (c) => c.name === "Tên công ty");
  const startK = await col(tables["Deals"]!, (c) => c.name === "Start date");
  const dealK = await col(tables["Đợt thanh toán"]!, (c) => c.role === "deal");
  const isArr = Array.isArray(((await mgrA("datahub.row.get", { table_id: tables["Đợt thanh toán"]!, row_id: s.payments[0].id })).data as Record<string, unknown>)[dealK]);
  const db = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await db.connect();
  const base = (table: string) => `SELECT COALESCE(max(row_no), 0) AS n FROM dh_rows WHERE table_id = '${table}'::uuid`;
  const nd = Number((await db.query(base(tables["Deals"]!))).rows[0].n);
  const np = Number((await db.query(base(tables["Đợt thanh toán"]!))).rows[0].n);
  // Deals
  await db.query(
    `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
     SELECT ${uid("'d' || g")}, r.table_id, $2::int + g,
       r.data || jsonb_build_object($3::text, 'Công ty ' || g, $4::text, to_char(date '2026-01-01' + (g % 300), 'YYYY-MM-DD')), '', r.created_by, r.updated_by
     FROM dh_rows r, generate_series(1, ${DEALS}) g WHERE r.id = $1::uuid`,
    [d0.id, nd, nameK, startK],
  );
  await db.query(
    `INSERT INTO dh_person_cells (row_id, user_id, table_id, data)
     SELECT ${uid("'d' || g")}, c.user_id, c.table_id, c.data FROM dh_person_cells c, generate_series(1, ${DEALS}) g WHERE c.row_id = $1::uuid`,
    [d0.id],
  );
  // Two instalments per deal
  for (const [i, pid] of (s.payments as { id: string }[]).entries()) {
    await db.query(
      `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
       SELECT ${uid(`'p${i}' || g`)}, r.table_id, $2::int + $3::int * ${DEALS} + g,
         r.data || jsonb_build_object($4::text, ${isArr ? `jsonb_build_array(${uid("'d' || g")}::text)` : `to_jsonb(${uid("'d' || g")}::text)`}), '', r.created_by, r.updated_by
       FROM dh_rows r, generate_series(1, ${DEALS}) g WHERE r.id = $1::uuid`,
      [pid.id, np, i, dealK],
    );
    await db.query(
      `INSERT INTO dh_person_cells (row_id, user_id, table_id, data)
       SELECT ${uid(`'p${i}' || g`)}, c.user_id, c.table_id, c.data FROM dh_person_cells c, generate_series(1, ${DEALS}) g WHERE c.row_id = $1::uuid`,
      [pid.id],
    );
  }
  await db.query(`UPDATE dh_tables SET row_count = row_count + ${DEALS}, next_row_no = next_row_no + ${DEALS} WHERE id = $1::uuid`, [tables["Deals"]]);
  await db.query(`UPDATE dh_tables SET row_count = row_count + ${2 * DEALS}, next_row_no = next_row_no + ${2 * DEALS} WHERE id = $1::uuid`, [tables["Đợt thanh toán"]]);
  await db.query(`ANALYZE dh_rows`);
  await db.query(`ANALYZE dh_person_cells`);
  await db.end();
  payIds = [0, 1, 2, 3].map((g) => `${g}`); // placeholder, replaced below
  const md5 = async (k: string) => {
    const c = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
    await c.connect();
    const r = await c.query(`SELECT ${uid("$1::text")} AS id`, [k]);
    await c.end();
    return r.rows[0].id as string;
  };
  payIds = [await md5("p01"), await md5("p02"), await md5("p11")];
}, 600_000);
afterAll(async () => {
  await t.close();
});

describe(`Deals at ${DEALS} deals`, () => {
  it("home, first page of Deals (filter + sort), a dashboard metric, period.review, payment.confirm", async () => {
    const home = await ms("datahub.deal.home", () => mgrA("datahub.deal.home", {}));
    expect(home.ms).toBeLessThan(3000);
    const page = await ms("row.list Deals filter + sort, 50 rows", () => mgrA("datahub.row.list", { table_id: tables["Deals"]!, filter: JSON.stringify({ field: "Start date", op: "gte", value: "2026-03-01" }), sort: "Start date:desc", limit: 50 }));
    expect(page.r.items.length).toBe(50);
    expect(page.ms).toBeLessThan(3000);
    const metric = await ms("metrics.query sum role:doanh_thu", () => mgrA("metrics.query", { metric: { name: "m", source: tables["Deals"]!, measure: { agg: "sum", field: "role:doanh_thu" } } }));
    expect(metric.ms).toBeLessThan(3000);
    const dh = (await mgrA("datahub.table.get", { table_id: tables["Deals"]! })).datahub_id as string;
    const lst = (await mgrA("metrics.dashboard.list", { datahub_id: dh })) as { id: string; name: string }[] | { items: { id: string; name: string }[] };
    const id = (Array.isArray(lst) ? lst : lst.items).find((x) => x.name === DEAL_DASHBOARD_NAME)!.id;
    const dv = await ms("metrics.dashboard.view", () => mgrA("metrics.dashboard.view", { dashboard_id: id }));
    expect(dv.ms).toBeLessThan(3000);
    for (const c of (dv.r.charts as { id: string; chart: { title?: string } }[]).slice(0, 6)) {
      const r = await ms(`chart.data "${c.chart.title}"`, () => mgrA("metrics.chart.data", { chart_id: c.id }));
      expect(r.ms).toBeLessThan(3000);
    }
    const review = await ms("period.review 2026-07", () => mgrA("period.review", { month: "2026-07" }));
    expect(review.ms).toBeLessThan(3000);
    const conf = await ms("payment.confirm one instalment", () => mgrA("payment.confirm", { received_on: "2026-07-03", receipt: { amount: 100_000_000 }, allocations: [{ payment_id: payIds[0]!, amount: 100_000_000 }] }));
    expect(conf.ms).toBeLessThan(3000);
  }, 300_000);
});
