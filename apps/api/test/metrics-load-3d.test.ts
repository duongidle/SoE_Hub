import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";
import { orgMemberships, users } from "@soe/db";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { metricCacheStats, resetMetricCache } from "../src/modules/metrics";
import { processPendingMerges } from "../src/modules/datahub";

/**
 * Stage 3D load test (design module3 section 6.1, point 5). Run it again with:
 *
 *   LOAD_TEST=1 pnpm exec vitest run apps/api/test/metrics-load-3d.test.ts
 *
 * (LOAD_USERS, LOAD_ROWS, LOAD_PARALLEL change the size; the default is the acceptance size: 100,000 rows, 20 people, 30 charts, six at a time.)
 * Rows are seeded with SQL (no examples/ data); everything else goes through the real executor like the web does: `metrics.dashboard.view`
 * then one `metrics.chart.data` per chart. The cache is emptied before every cold run. Pass: every chart under 3 s, no error.
 */
const ROWS = Number(process.env.LOAD_ROWS ?? 100_000);
const USERS = Number(process.env.LOAD_USERS ?? 20);
const PARALLEL = Number(process.env.LOAD_PARALLEL ?? 6); // what a browser opens at once to one host
const DISTINCT = Number(process.env.LOAD_DISTINCT ?? 0); // worst case: how many different common filters (0 = one per person)
const LIMIT_MS = 3000;
const RUN = !!process.env.LOAD_TEST;

let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let dhId = "";
let tableId = "";
let payId = "";
let dashId = "";
let viewers: ReturnType<typeof as>[] = [];
const viewerIds: string[] = [];
const charts: { id: string; type: string; title: string }[] = [];

/** vitest hides the console of passing tests in some reporters; the numbers are the point of this file, so write them straight out. */
const log = (m: string) => process.stderr.write(`${m}\n`);

type Row = { chart: string; type: string; ms: number; ok: boolean };
const pct = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]! : 0;
};
const summary = (label: string, rows: Row[], opens: number[]) => {
  const byType = new Map<string, number[]>();
  for (const r of rows) byType.set(r.type, [...(byType.get(r.type) ?? []), r.ms]);
  const lines = [...byType.entries()].map(([k, v]) => `${k.padEnd(10)} n=${String(v.length).padStart(3)} p50=${pct(v, 50)} p95=${pct(v, 95)} max=${Math.max(...v)}`);
  const all = rows.map((r) => r.ms);
  log(
    `[load] ${label}: charts n=${all.length} p50=${pct(all, 50)} p95=${pct(all, 95)} max=${Math.max(...all)} ms; dashboard open (all charts) p50=${pct(opens, 50)} p95=${pct(opens, 95)} max=${Math.max(...opens)} ms; errors=${rows.filter((r) => !r.ok).length}\n  ` +
      lines.join("\n  "),
  );
  const worst = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 5).map((r) => `${r.chart}=${r.ms}`);
  log(`[load] ${label}: slowest ${worst.join(", ")}`);
};

/** One person opens the dashboard like the web: the view call, then every chart with at most PARALLEL calls running. */
async function openDashboard(call: ReturnType<typeof as>, filters?: unknown): Promise<{ rows: Row[]; open: number }> {
  const t0 = performance.now();
  await call("metrics.dashboard.view", { dashboard_id: dashId });
  const rows: Row[] = [];
  let next = 0;
  const worker = async () => {
    while (next < charts.length) {
      const c = charts[next++]!;
      const s = performance.now();
      let ok = true;
      try {
        await call("metrics.chart.data", { chart_id: c.id, ...(filters ? { filters: JSON.stringify(filters) } : {}) });
      } catch (e) {
        ok = false;
        log(`[load] error on ${c.title}: ${(e as Error).message}`);
      }
      rows.push({ chart: c.title, type: c.type, ms: Math.round(performance.now() - s), ok });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return { rows, open: Math.round(performance.now() - t0) };
}

async function everyoneOpens(filtersOf?: (i: number) => unknown) {
  const res = await Promise.all([owner, ...viewers].map((c, i) => openDashboard(c, filtersOf?.(i))));
  return { rows: res.flatMap((r) => r.rows), opens: res.map((r) => r.open) };
}

beforeAll(async () => {
  if (!RUN) return;
  t = await makeApp({}, { sse: true });
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  owner = as(t, org.userA1.id);
  const x = await makeTable(owner, {
    columns: [
      { name: "Mã deal", type: "text" },
      { name: "Doanh thu", type: "number" },
      { name: "Điểm", type: "number" },
      { name: "Mức", type: "single_select", config: { options: ["P1", "P2", "P3", "P4", "P5"].map((name) => ({ name })) } },
      { name: "Trạng thái", type: "single_select", config: { options: ["Won", "Lost", "Open", "Hold"].map((name) => ({ name })) } },
      { name: "Loại", type: "single_select", config: { options: ["POD", "DCC", "SaaS"].map((name) => ({ name })) } },
      { name: "Người phụ trách", type: "text" },
      { name: "Ngày nhận", type: "date" },
      { name: "Ngày chốt", type: "date" },
      { name: "Gấp đôi", type: "formula", config: { formula: "=[Doanh thu]*2" } },
    ],
  });
  dhId = x.dhId;
  tableId = x.tableId;
  const pay = await owner("datahub.table.create", { datahub_id: dhId, name: "Thanh toán" });
  payId = pay.id;
  await owner("datahub.column.create", { table_id: payId, name: "Mã deal", type: "text" });
  await owner("datahub.column.create", { table_id: payId, name: "Số tiền", type: "number" });
  const keyOf = async (table: string) => Object.fromEntries(((await owner("datahub.table.get", { table_id: table })).columns as { name: string; key: string; config: { options?: { id: string }[] } }[]).map((c) => [c.name, c]));
  const k = await keyOf(tableId);
  const p = await keyOf(payId);
  const opt = (name: string) => k[name]!.config.options!.map((o) => o.id);
  const db = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await db.connect();
  await db.query(
    `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
     SELECT gen_random_uuid(), $1::uuid, g,
       jsonb_strip_nulls(jsonb_build_object($2::text, 'D' || g, $3::text, (g::bigint * 7919) % 100000000 - 20000000, $4::text, g % 100,
         $5::text, CASE WHEN g % 9 = 0 THEN NULL ELSE ($11::text[])[1 + g % 5] END,
         $6::text, ($12::text[])[1 + g % 4], $7::text, ($13::text[])[1 + g % 3], $8::text, 'NV' || (g % 40),
         $9::text, to_char(date '2024-01-01' + (g * 31) % 1000, 'YYYY-MM-DD'),
         $10::text, CASE WHEN g % 5 = 0 THEN NULL ELSE to_char(date '2024-01-01' + (g * 31) % 1000 + g % 90, 'YYYY-MM-DD') END,
         $14::text, ((g::bigint * 7919) % 100000000 - 20000000) * 2)),
       '', $15::uuid, $15::uuid FROM generate_series(1, ${ROWS}) g`,
    [tableId, k["Mã deal"]!.key, k["Doanh thu"]!.key, k["Điểm"]!.key, k["Mức"]!.key, k["Trạng thái"]!.key, k["Loại"]!.key, k["Người phụ trách"]!.key, k["Ngày nhận"]!.key, k["Ngày chốt"]!.key, opt("Mức"), opt("Trạng thái"), opt("Loại"), k["Gấp đôi"]!.key, org.userA1.id],
  );
  await db.query(
    `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
     SELECT gen_random_uuid(), $1::uuid, g, jsonb_build_object($2::text, 'D' || (1 + g % ${ROWS}), $3::text, g % 1000), '', $4::uuid, $4::uuid FROM generate_series(1, ${ROWS}) g`,
    [payId, p["Mã deal"]!.key, p["Số tiền"]!.key, org.userA1.id],
  );
  await db.query(`UPDATE dh_tables SET row_count = ${ROWS}, next_row_no = ${ROWS + 1} WHERE id IN ($1, $2)`, [tableId, payId]);
  await db.query(`ANALYZE dh_rows`);
  await db.end();

  // the people: the owner plus USERS - 1 members who get the dashboard shared (their numbers use the owner's rights)
  const hash = (await t.c.db.db.execute(sql`SELECT password_hash AS h FROM users WHERE id = ${org.userA1.id}::uuid`)).rows[0] as { h: string };
  for (let i = 1; i < USERS; i++) {
    const [u] = await t.c.db.db.insert(users).values({ email: `load${i}.${org.tag}@base.vn`, fullName: `Load ${i}`, roles: ["user"], status: "active", passwordHash: hash.h }).returning({ id: users.id });
    await t.c.db.db.insert(orgMemberships).values({ userId: u!.id, managerId: org.mgrA.id, leaderId: org.leaderA.id });
    viewerIds.push(u!.id);
  }
  viewers = viewerIds.map((id) => as(t, id));

  // ---- the dashboard: 30 charts, every type, with time buckets, comparison, running total, joins and a derived metric ----
  const M = (name: string, agg: string, field?: string, extra: Record<string, unknown> = {}) => ({ name, source: tableId, measure: { agg, ...(field ? { field } : {}) }, ...extra });
  const S = (metric: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ metric, ...extra });
  const mon = { field: "Ngày chốt", bucket: "month" };
  const join = { table: tableId, joins: [{ table: payId, as: "TT", on: [{ left: "Mã deal", right: "Mã deal" }] }] };
  await owner("metrics.metric.create", { datahub_id: dhId, metric: M("Tổng DT", "sum", "Doanh thu", { time: mon }) });
  await owner("metrics.metric.create", { datahub_id: dhId, metric: M("Số deal", "count", undefined, { time: mon }) });
  const derived = await owner("metrics.metric.create", { datahub_id: dhId, metric: { name: "DT trên deal", formula: "=[Tổng DT] / [Số deal]" } });
  const won = { field: "Trạng thái", op: "eq", value: "Won" };
  const defs: [string, string, Record<string, unknown>[], Record<string, unknown>?][] = [
    ["kpi", "KPI doanh thu so kỳ", [S(M("DT", "sum", "Doanh thu", { time: { field: "Ngày chốt", range: "this_year" } }), { compare: "previous_period" })], { sparkline: "month" }],
    ["kpi", "KPI trung bình", [S(M("TB", "avg", "Doanh thu", { time: { field: "Ngày chốt", range: "last_year" } }), { compare: "year_ago" })]],
    ["kpi", "KPI cột công thức", [S(M("Gấp đôi", "sum", "Gấp đôi", { time: { field: "Ngày chốt" } }))]],
    ["column", "Cột DT theo tháng × mức", [S(M("DT", "sum", "Doanh thu", { time: mon, group_by: ["Mức"] }))], { stack: "stack" }],
    ["column", "Cột số deal theo loại", [S(M("Số deal", "count", undefined, { group_by: ["Loại"] }))]],
    ["bar", "Thanh DT theo trạng thái", [S(M("DT", "sum", "Doanh thu", { group_by: ["Trạng thái"] }))]],
    ["line", "Đường luỹ kế", [S(M("DT", "sum", "Doanh thu", { time: mon }), { cumulative: true })]],
    ["line", "Đường số deal theo tuần", [S(M("Số deal", "count", undefined, { time: { field: "Ngày nhận", bucket: "week" } }))]],
    ["area", "Vùng DT theo quý × loại", [S(M("DT", "sum", "Doanh thu", { time: { field: "Ngày chốt", bucket: "quarter" }, group_by: ["Loại"] }))], { stack: "stack" }],
    ["combo", "Kết hợp DT và trung bình", [S(M("DT", "sum", "Doanh thu", { time: mon }), { kind: "bar", axis: "left" }), S(M("TB", "avg", "Doanh thu", { time: mon }), { kind: "line", axis: "right" })]],
    ["pie", "Tròn DT theo mức", [S(M("DT", "sum", "Doanh thu", { group_by: ["Mức"] }))]],
    ["donut", "Donut số deal theo trạng thái", [S(M("Số deal", "count", undefined, { group_by: ["Trạng thái"] }))]],
    ["table", "Bảng theo mức, loại, trạng thái", [S(M("DT", "sum", "Doanh thu", { group_by: ["Mức", "Loại", "Trạng thái"] }))]],
    ["table", "Bảng theo ngày", [S(M("DT", "sum", "Doanh thu", { time: { field: "Ngày chốt", bucket: "day" } }), { limit: 1000 })]],
    ["pivot", "Pivot loại × trạng thái", [S(M("DT", "sum", "Doanh thu", { group_by: ["Loại", "Trạng thái"] }))], { heat: true, totals: true }],
    ["pivot", "Pivot mức × tháng", [S(M("DT", "sum", "Doanh thu", { time: mon, group_by: ["Mức"] }))], { totals: true }],
    ["funnel", "Phễu", [S(M("Tất cả", "count"), { label: "Tất cả" }), S(M("Open", "count", undefined, { filter: { field: "Trạng thái", op: "eq", value: "Open" } }), { label: "Open" }), S(M("Won", "count", undefined, { filter: won }), { label: "Won" })]],
    ["waterfall", "Waterfall", [S(M("Won", "sum", "Doanh thu", { filter: won }), { step: "start" }), S(M("Mới", "sum", "Doanh thu", { filter: { field: "Trạng thái", op: "eq", value: "Open" } }), { step: "add" }), S(M("Thua", "sum", "Doanh thu", { filter: { field: "Trạng thái", op: "eq", value: "Lost" } }), { step: "subtract" })]],
    ["histogram", "Histogram doanh thu", [S(M("DT", "sum", "Doanh thu"))], { bins: 20 }],
    ["boxplot", "Box plot theo loại", [S(M("DT", "sum", "Doanh thu", { group_by: ["Loại"] }))]],
    ["scatter", "Scatter theo ngày nhận", [S(M("DT", "sum", "Doanh thu", { time: { field: "Ngày nhận", bucket: "day" } })), S(M("Điểm", "avg", "Điểm", { time: { field: "Ngày nhận", bucket: "day" } }))]],
    ["matrix", "Ma trận theo mức", [S(M("DT", "sum", "Doanh thu", { group_by: ["Người phụ trách"] })), S(M("Điểm", "avg", "Điểm", { group_by: ["Người phụ trách"] }))]],
    ["heatmap", "Heatmap loại × tháng", [S(M("DT", "sum", "Doanh thu", { time: mon, group_by: ["Loại"] }))]],
    ["ranking", "Xếp hạng người phụ trách", [S(M("DT", "sum", "Doanh thu", { group_by: ["Người phụ trách"] }))], { top_n: 10 }],
    ["cohort", "Cohort nhận → chốt", [S(M("Chốt", "count", undefined, { cohort: { start: "Ngày nhận", event: "Ngày chốt", bucket: "month" } }))]],
    ["gauge", "Đồng hồ", [S(M("DT", "sum", "Doanh thu", { target: { value: 1e12 } }))]],
    ["bullet", "Bullet", [S(M("DT", "sum", "Doanh thu", { time: { field: "Ngày chốt", range: "this_year" }, target: { value: 5e11 } }))], { bands: [{ label: "KPI", value: 3e11 }, { label: "Goal", value: 6e11 }] }],
    ["kpi", "KPI ghép bảng thanh toán", [S({ name: "Thu", source: join, measure: { agg: "sum", field: "TT.Số tiền" }, time: { field: "Ngày chốt", bucket: "year" } })]],
    ["column", "Cột ghép theo tháng × mức", [S({ name: "Thu", source: join, measure: { agg: "sum", field: "TT.Số tiền" }, time: mon, group_by: ["Mức"] })]],
  ];
  defs.push(["line", "Đường chỉ số phái sinh", [{ metric_id: derived.id }]] as never);
  dashId = (await owner("metrics.dashboard.create", { datahub_id: dhId, name: "Tải 30 biểu đồ" })).id;
  let i = 0;
  for (const [type, title, series, options] of defs) {
    const made = await owner("metrics.chart.create", { dashboard_id: dashId, chart: { type, title, series, ...(options ? { options } : {}), layout: { x: (i % 3) * 4, y: Math.floor(i / 3) * 4, w: 4, h: 4 } } });
    charts.push({ id: made.id, type, title });
    i++;
  }
  expect(charts.length).toBe(30);
  for (const id of viewerIds) await owner("metrics.dashboard.share.set", { dashboard_id: dashId, grantee_id: id });
  await drainOutbox(t);
}, 600_000);

afterAll(async () => {
  if (RUN) await t.close();
});

describe.skipIf(!RUN)(`dashboard load: ${ROWS} rows, ${USERS} people, 30 charts`, () => {
  it("cold: everyone opens the dashboard at once with an empty cache", async () => {
    resetMetricCache();
    const { rows, opens } = await everyoneOpens();
    summary("cold, shared answers", rows, opens);
    const s = metricCacheStats();
    log(`[load] cache after cold run: executed=${s.executed} joined=${s.joined} hits=${s.hits} entries=${s.entries}`);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    expect(Math.max(...rows.map((r) => r.ms))).toBeLessThan(LIMIT_MS);
  }, 300_000);

  it("warm: the same people open it again", async () => {
    const { rows, opens } = await everyoneOpens();
    summary("warm", rows, opens);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    expect(Math.max(...rows.map((r) => r.ms))).toBeLessThan(LIMIT_MS);
  }, 300_000);

  it("cold, worst case: each person has their own common filter, so nothing is shared (more than the acceptance test asks)", async () => {
    resetMetricCache();
    const sets = DISTINCT || USERS;
    const { rows, opens } = await everyoneOpens((i) => ({ range: { kind: "between", from: `2024-${String((i % sets % 12) + 1).padStart(2, "0")}-${String(1 + Math.floor((i % sets) / 12))}`.replace(/-(\d)$/, "-0$1"), to: "2026-12-31" } }));
    summary(`cold, ${sets} different filters`, rows, opens);
    const s = metricCacheStats();
    log(`[load] cache after distinct run: executed=${s.executed} joined=${s.joined} hits=${s.hits}`);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    // Every statement here is real work for Postgres (a full scan of 100,000 rows per statement and per different filter): the time grows with
    // the number of DIFFERENT filters. The 3 s limit is asserted by the shared-dashboard tests; this one only has to finish without an error or a timeout.
    expect(Math.max(...rows.map((r) => r.ms))).toBeLessThan(10_000);
  }, 600_000);

  it("cold while a few people edit source rows (the cache is cleared and recomputed under the load)", async () => {
    resetMetricCache();
    let stop = false;
    const rowsList = (await owner("datahub.row.list", { table_id: tableId, limit: 12 })).items as { id: string; version: number }[];
    const cols = (await owner("datahub.table.get", { table_id: tableId })).columns as { name: string; key: string }[];
    void cols;
    const writers = rowsList.slice(0, 6).map(async (r, w) => {
      let version = r.version;
      let n = 0;
      while (!stop) {
        const upd = await owner("datahub.row.update", { table_id: tableId, row_id: r.id, data: { "Doanh thu": 1000 + w * 10 + n }, version });
        version = upd.version;
        n++;
        await new Promise((res) => setTimeout(res, 250));
      }
      return n;
    });
    // the worker: delivers events (clears the cache, tells SSE) and recalculates
    const worker = (async () => {
      while (!stop) {
        await drainOutbox(t);
        await new Promise((res) => setTimeout(res, 100));
      }
    })();
    const { rows, opens } = await everyoneOpens();
    stop = true;
    const edits = (await Promise.all(writers)).reduce((a, b) => a + b, 0);
    await worker;
    summary(`cold with ${edits} source edits during the run`, rows, opens);
    expect(rows.filter((r) => !r.ok)).toEqual([]);
    expect(Math.max(...rows.map((r) => r.ms))).toBeLessThan(LIMIT_MS);
  }, 600_000);
});

describe.skipIf(!RUN)("merged table: many people edit a source at once", () => {
  it("edits to the sources of a 120,000 row merged table, delivered together, cost one sync each round", async () => {
    const mk = () => makeTable(owner, { columns: [{ name: "Mã", type: "text" }, { name: "Tiền", type: "number" }] });
    const a = await mk();
    const b = await mk();
    const keyOf = async (id: string, name: string) => ((await owner("datahub.table.get", { table_id: id })).columns as { name: string; key: string }[]).find((c) => c.name === name)!.key;
    const db = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
    await db.connect();
    const seed = async (tableId2: string, from: number, rows: number) => {
      await db.query(
        `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
         SELECT gen_random_uuid(), $1::uuid, g, jsonb_build_object($2::text, 'K' || (${from} + g), $3::text, g), '', $4::uuid, $4::uuid FROM generate_series(1, ${rows}) g`,
        [tableId2, await keyOf(tableId2, "Mã"), await keyOf(tableId2, "Tiền"), org.userA1.id],
      );
      await db.query(`UPDATE dh_tables SET row_count = ${rows}, next_row_no = ${rows + 1} WHERE id = $1`, [tableId2]);
    };
    await seed(a.tableId, 0, 100_000);
    await seed(b.tableId, 70_000, 50_000);
    await db.query("ANALYZE dh_rows");
    await db.end();
    const merged = await owner("datahub.merge.create", { datahub_id: a.dhId, name: "Gộp lớn", sources: [a.tableId, b.tableId], dedup: { columns: ["Mã"], strategy: "priority" } });
    const t0 = performance.now();
    await processPendingMerges(t.c.db.db);
    log(`[load] first sync of the merged table: ${Math.round(performance.now() - t0)} ms`);
    await drainOutbox(t);

    // many people keep editing for a few seconds while the worker syncs (the merged table is read again in full each time)
    {
      const { dispatchOutboxOnce } = await import("../src/core/outbox-dispatcher");
      const { defaultSubscribers } = await import("../src/core/subscribers");
      const rowsA = (await owner("datahub.row.list", { table_id: a.tableId, limit: 10 })).items as { id: string; version: number }[];
      let stop = false;
      let syncs = 0;
      let syncMs = 0;
      const worker = (async () => {
        while (!stop) {
          await dispatchOutboxOnce(t.c.db.db, defaultSubscribers(t.c.events, t.c.config.AUTH_SECRET), t.c.logger, { batchSize: 500 });
          const s0 = performance.now();
          const n = await processPendingMerges(t.c.db.db);
          if (n > 0) {
            syncs += n;
            syncMs += performance.now() - s0;
          }
          await new Promise((res) => setTimeout(res, 50));
        }
      })();
      let edits = 0;
      const t0b = performance.now();
      await Promise.all(
        rowsA.map(async (r, w) => {
          let version = r.version;
          while (performance.now() - t0b < 6000) {
            version = (await owner("datahub.row.update", { table_id: a.tableId, row_id: r.id, data: { Tiền: 5_000_000 + w * 1000 + edits }, version })).version;
            edits++;
            await new Promise((res) => setTimeout(res, 300));
          }
        }),
      );
      stop = true;
      await worker;
      log(`[load] 10 people editing for 6 s: ${edits} edits, ${syncs} merged-table syncs, ${Math.round(syncMs)} ms spent syncing (one sync reads the 150,000 source rows again)`);
      await drainOutbox(t);
      expect((await owner("datahub.merge.get", { table_id: merged.table.id })).status).toBe("ok");
    }

    for (const people of [1, 5, 20]) {
      const rowsA = (await owner("datahub.row.list", { table_id: a.tableId, limit: people })).items as { id: string; version: number; data: Record<string, unknown> }[];
      // everyone edits at the same time (different rows of the two sources)
      const e0 = performance.now();
      await Promise.all(rowsA.map((r, i) => owner("datahub.row.update", { table_id: a.tableId, row_id: r.id, data: { Tiền: 9_000_000 + i + people }, version: r.version })));
      const edit = Math.round(performance.now() - e0);
      const { dispatchOutboxOnce } = await import("../src/core/outbox-dispatcher");
      const { defaultSubscribers } = await import("../src/core/subscribers");
      const d0 = performance.now();
      while ((await dispatchOutboxOnce(t.c.db.db, defaultSubscribers(t.c.events, t.c.config.AUTH_SECRET), t.c.logger, { batchSize: 500 })) > 0) {
        /* keep delivering */
      }
      const dispatch = Math.round(performance.now() - d0);
      let syncs = 0;
      const s0 = performance.now();
      while ((await processPendingMerges(t.c.db.db)) > 0) syncs++;
      const sync = Math.round(performance.now() - s0);
      const info = await owner("datahub.merge.get", { table_id: merged.table.id });
      log(`[load] ${people} simultaneous source edits: edits ${edit} ms, events ${dispatch} ms, merged sync ${sync} ms in ${syncs} pass(es); status=${info.status}`);
      expect(info.status).toBe("ok");
      expect(sync).toBeLessThan(30_000);
    }
  }, 600_000);
});
