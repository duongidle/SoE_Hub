import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { processIndexRequests } from "../src/modules/datahub/export-views";

/**
 * Performance smoke (Module 0 section 1): 100,000 rows, filter + sort + first page under 300 ms.
 * The rows are seeded with one SQL statement; the reads go through the real executor (permissions, schema, DSL, keyset).
 * Numbers are printed so the run records them.
 */
const ROWS = 100_000;
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let x: Awaited<ReturnType<typeof makeTable>>;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  owner = as(t, org.userA1.id);
  x = await makeTable(owner, {
    columns: [
      { name: "Khách hàng", type: "text" },
      { name: "Doanh thu", type: "currency" },
      { name: "Mức", type: "single_select", config: { options: ["P1", "P2", "P3", "Chưa đủ dữ liệu", "Không đánh giá"].map((name) => ({ name })) } },
      { name: "Hạn", type: "date" },
      { name: "Nhãn", type: "multi_select", config: { options: [{ name: "x" }, { name: "y" }, { name: "z" }] } },
      { name: "Ghi chú", type: "long_text" },
    ],
  });
  const cols = (await owner("datahub.table.get", { table_id: x.tableId })).columns as { name: string; key: string; config: { options?: { id: string }[] } }[];
  const key = (n: string) => cols.find((c) => c.name === n)!.key;
  const opts = cols.find((c) => c.name === "Mức")!.config.options!.map((o) => o.id);
  const tags = cols.find((c) => c.name === "Nhãn")!.config.options!.map((o) => o.id);
  const db = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
  await db.connect();
  const t0 = Date.now();
  await db.query(
    `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
     SELECT gen_random_uuid(), $1::uuid, g,
       jsonb_strip_nulls(jsonb_build_object(
         $2::text, (ARRAY['Nguyễn','Trần','Lê','Phạm','Hoàng','Vũ'])[1 + g % 6] || ' ' || (ARRAY['Văn Thuận','Thị Hà','Minh Đức','Quang Huy','Thu Trang'])[1 + g % 5] || ' ' || g,
         $3::text, (g::bigint * 7919 * 2531) % 2000000000,
         $4::text, CASE WHEN g % 9 = 0 THEN NULL ELSE ($7::text[])[1 + g % 5] END,
         $5::text, CASE WHEN g % 11 = 0 THEN NULL ELSE to_char(date '2026-01-01' + (g * 31) % 700, 'YYYY-MM-DD') END,
         $6::text, CASE WHEN g % 4 = 3 THEN NULL ELSE to_jsonb(($8::text[])[1 + g % 2:2 + g % 3]) END,
         $9::text, 'Ghi chú số ' || g)),
       'Khách hàng số ' || g, $10::uuid, $10::uuid
     FROM generate_series(1, ${ROWS}) g`,
    [x.tableId, key("Khách hàng"), key("Doanh thu"), key("Mức"), key("Hạn"), key("Nhãn"), opts, tags, key("Ghi chú"), org.userA1.id],
  );
  await db.query(`UPDATE dh_tables SET row_count = ${ROWS}, next_row_no = ${ROWS + 1} WHERE id = $1`, [x.tableId]);
  await db.query(`ANALYZE dh_rows`);
  console.warn(`[perf] seeded ${ROWS} rows in ${Date.now() - t0} ms`);
  await db.end();
}, 120_000);
afterAll(async () => {
  await t.close();
});

async function time(label: string, input: Record<string, unknown>, runs = 7) {
  const ms: number[] = [];
  let last: { items: unknown[]; next_cursor?: string | null; nextCursor?: string | null } | null = null;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    last = await owner("datahub.row.list", { table_id: x.tableId, ...input });
    ms.push(performance.now() - s);
  }
  ms.sort((a, b) => a - b);
  console.warn(`[perf] ${label}: median ${ms[Math.floor(runs / 2)]!.toFixed(1)} ms, max ${ms[runs - 1]!.toFixed(1)} ms, first run ${"-"}`);
  return { median: ms[Math.floor(runs / 2)]!, max: ms[runs - 1]!, last: last! };
}

const f = (o: unknown) => JSON.stringify(o);

describe(`100k rows: filter + sort + first page`, () => {
  const scenarios: [string, () => Record<string, unknown>][] = [
    ["filter(Mức in P1,P2 AND Doanh thu >= 1e9) + sort(Mức option order, Hạn asc nulls last)", () => ({ filter: f({ and: [{ field: "Mức", op: "in", value: ["P1", "P2"] }, { field: "Doanh thu", op: "gte", value: 1_000_000_000 }] }), sort: "Mức,Hạn:asc:last", limit: 50 })],
    ["filter(Hạn this_year) + sort(Doanh thu desc)", () => ({ filter: f({ field: "Hạn", op: "last_n_days", value: 400 }), sort: "Doanh thu:desc", limit: 50 })],
    ["filter(Nhãn in y) + sort(Hạn)", () => ({ filter: f({ field: "Nhãn", op: "in", value: ["y"] }), sort: "Hạn", limit: 50 })],
    ["sort only (Doanh thu desc), include_total", () => ({ sort: "Doanh thu:desc", limit: 50, include_total: "true" })],
    ["default order, first page of 500", () => ({ limit: 500 })],
    ["filter(Khách hàng contains 'thuan') + sort(Doanh thu desc)", () => ({ filter: f({ field: "Khách hàng", op: "contains", value: "thuan" }), sort: "Doanh thu:desc", limit: 50 })],
    ["search 'ha 9999' (table-wide trigram)", () => ({ search: "ha 9999", limit: 50 })],
  ];

  for (const [label, input] of scenarios) {
    it(`before auto index: ${label}`, async () => {
      const r = await time(`[no index] ${label}`, input());
      expect(r.last.items.length).toBeGreaterThan(0);
      expect(r.median).toBeLessThan(300);
    }, 60_000);
  }

  it("the auto index job builds indexes for the columns used; the same queries stay under 300 ms (numbers recorded)", async () => {
    const done = await processIndexRequests(t.c.db.db);
    console.warn(`[perf] auto index job: ${JSON.stringify(done)}`);
    expect(done.failed).toBe(0);
    for (const [label, input] of scenarios) {
      const r = await time(`[with index] ${label}`, input());
      expect(r.median).toBeLessThan(300);
    }
  }, 120_000);

  it("keyset second page and deep page stay fast", async () => {
    const first = await owner("datahub.row.list", { table_id: x.tableId, sort: "Doanh thu:desc", limit: 100 });
    let cursor = first.nextCursor as string;
    const s = performance.now();
    for (let i = 0; i < 10; i++) {
      const p = await owner("datahub.row.list", { table_id: x.tableId, sort: "Doanh thu:desc", limit: 100, cursor });
      cursor = p.nextCursor;
    }
    const per = (performance.now() - s) / 10;
    console.warn(`[perf] keyset page 2..11 of 100 rows: ${per.toFixed(1)} ms each`);
    expect(per).toBeLessThan(300);
  }, 60_000);
});

describe("100k rows: jump to any position (window read, design module2 section 5.1 / decisions of 2C-2)", () => {
  // The grid asks for a window of 200 rows at the position the person dragged to; the second half is read from the end.
  const cases: [string, Record<string, unknown>][] = [
    ["default order", {}],
    ["sort Doanh thu desc", { sort: "Doanh thu:desc" }],
    ["sort Mức (option order) then Hạn asc nulls last", { sort: "Mức,Hạn:asc:last" }],
    ["filter(Mức in P1,P2) + sort Hạn", { filter: JSON.stringify({ field: "Mức", op: "in", value: ["P1", "P2"] }), sort: "Hạn" }],
    ["filter(Khách hàng contains 'thuan') + sort Doanh thu desc", { filter: JSON.stringify({ field: "Khách hàng", op: "contains", value: "thuan" }), sort: "Doanh thu:desc" }],
  ];
  for (const [label, base] of cases) {
    it(`${label}: the last rows and the middle in under 1 s`, async () => {
      const total = (await owner("datahub.row.list", { table_id: x.tableId, ...base, limit: 1, include_total: "true" })).total as number;
      const read = async (name: string, input: Record<string, unknown>) => {
        const ms: number[] = [];
        let items = 0;
        for (let i = 0; i < 3; i++) {
          const s = performance.now();
          items = (await owner("datahub.row.list", { table_id: x.tableId, ...base, limit: 200, ...input })).items.length;
          ms.push(performance.now() - s);
        }
        ms.sort((p, q) => p - q);
        console.warn(`[perf] jump ${label} / ${name}: median ${ms[1]!.toFixed(0)} ms (total ${total})`);
        expect(items).toBeGreaterThan(0);
        expect(ms[1]!).toBeLessThan(1000);
      };
      await read("middle, offset", { offset: Math.floor(total / 2) });
      await read("near the end, offset", { offset: total - 200 });
      await read("near the end, from the end", { offset: 0, reverse: "true" });
      await read("80%, from the end", { offset: Math.floor(total * 0.2) - 200, reverse: "true" });
    }, 60_000);
  }
});
