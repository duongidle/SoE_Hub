import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { invalidateMetricCache, resetMetricCache } from "../src/modules/metrics";
import { gc, resetFolds, setFoldLogger } from "../src/modules/metrics/folds";

/**
 * Stage 4.1b-load: a key join onto a big table that every reader sees in full is folded once into a shared table (`mfold`), and every reader whose
 * base table is narrowed by the split lock joins that fold. The numbers must equal the ones without the shared fold, each reader sees only their own
 * rows, and a change of the joined table makes the next statement use a new fold.
 * Deals (split lock on `Phụ trách`): d1 UserA1 100 (D1), d2 UserA2 200 (D2), d3 LeaderA 400 (D3). Payments (no lock): D1 5, D1 7, D2 11, D3 13.
 */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let a1: ReturnType<typeof as>;
let leader: ReturnType<typeof as>;
let dealsId = "";
let payId = "";
let dhId = "";
const q = async (call: ReturnType<typeof as>, field: string) =>
  (await call("metrics.query", { metric: { name: "x", source: { table: dealsId, joins: [{ table: payId, as: "TT", on: [{ left: "Mã", right: "Mã" }] }] }, measure: { agg: "sum", field } } })).rows[0].value as number;
const folds = async () => ((await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'mfold'`)).rows[0] as { n: number }).n;

beforeAll(async () => {
  process.env.METRIC_FOLD_MIN_ROWS = "1";
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  owner = as(t, org.userA2.id);
  a1 = as(t, org.userA1.id);
  leader = as(t, org.leaderA.id);
  const deals = await makeTable(owner, { name: "Deals", columns: [{ name: "Mã", type: "text" }, { name: "Doanh thu", type: "number" }, { name: "Phụ trách", type: "user" }] });
  dhId = deals.dhId;
  dealsId = deals.tableId;
  payId = (await owner("datahub.table.create", { datahub_id: dhId, name: "Thanh toán" })).id;
  await owner("datahub.column.create", { table_id: payId, name: "Mã", type: "text" });
  await owner("datahub.column.create", { table_id: payId, name: "Tiền", type: "number" });

  for (const p of [org.userA1, org.leaderA]) await owner("datahub.share.set", { datahub_id: dhId, grantee_id: p.id, permission: "view" });
  for (const [m, v, who] of [["D1", 100, org.userA1.id], ["D2", 200, org.userA2.id], ["D3", 400, org.leaderA.id]] as const) await owner("datahub.row.create", { table_id: dealsId, data: { Mã: m, "Doanh thu": v, "Phụ trách": who } });
  for (const [m, v] of [["D1", 5], ["D1", 7], ["D2", 11], ["D3", 13]] as const) await owner("datahub.row.create", { table_id: payId, data: { Mã: m, Tiền: v } });
  await owner("datahub.table.share_options.set", { table_id: dealsId, key_split: true, key_columns: ["Phụ trách"] });
  await drainOutbox(t);
});
afterAll(async () => {
  delete process.env.METRIC_FOLD_MIN_ROWS;
  await t.close();
});

describe("shared fold of a joined table", () => {
  it("each reader gets their own numbers; both use one shared fold; the owner (whole table) does not need it", async () => {
    resetMetricCache();
    expect(await q(a1, "TT.Tiền")).toBe(12); // D1: 5 + 7
    expect(await q(leader, "TT.Tiền")).toBe(25); // the leader sees own rows and the team: D3 and UserA1 (D1)
    expect(await folds()).toBe(1);
    expect(await q(owner, "TT.Tiền")).toBe(36);
    expect(await folds()).toBe(1);
  });

  it("equals the answer without the shared fold", async () => {
    const withFold = [await q(a1, "TT.Tiền"), await q(leader, "TT.Tiền")];
    process.env.METRIC_FOLD_MIN_ROWS = "1000000";
    resetMetricCache();
    expect([await q(a1, "TT.Tiền"), await q(leader, "TT.Tiền")]).toEqual(withFold);
    process.env.METRIC_FOLD_MIN_ROWS = "1";
  });

  it("a change of the joined table makes the next statement use a new fold with the new values", async () => {
    const rows = (await owner("datahub.row.list", { table_id: payId, limit: 10 })).items as { id: string; version: number; data: Record<string, unknown> }[];
    const d1 = rows.find((r) => Object.values(r.data).includes(5))!;
    await owner("datahub.row.update", { table_id: payId, row_id: d1.id, data: { Tiền: 50 }, version: d1.version });
    await drainOutbox(t);
    invalidateMetricCache({ tables: [payId] }); // what the api process does when the worker tells it
    resetFolds();
    expect(await q(a1, "TT.Tiền")).toBe(57);
    expect(await folds()).toBeGreaterThanOrEqual(1);
  });

  it("the fold is a normal (logged) table: crash recovery cannot empty it behind the api's back", async () => {
    const r = await t.c.db.db.execute(sql`SELECT c.relpersistence AS p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'mfold' AND c.relkind = 'r'`);
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows as { p: string }[]) expect(row.p).toBe("p");
  });
});

describe("clean-up of old folds", () => {
  const ymd = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 10).replaceAll("-", "");
  const exists = async (name: string) => ((await t.c.db.db.execute(sql`SELECT to_regclass(${`mfold.${name}`}) AS t`)).rows[0] as { t: string | null }).t !== null;

  it("keeps today's and yesterday's tables, drops older ones, and says so in the log when it cannot drop", async () => {
    const mk = (name: string) => t.c.db.db.execute(sql.raw(`CREATE TABLE mfold.${name} (k text)`));
    const old = `f_${"a".repeat(20)}_${ymd(3 * 86_400_000)}`;
    const yesterday = `f_${"b".repeat(20)}_${ymd(86_400_000)}`;
    const today = `f_${"c".repeat(20)}_${ymd(0)}`;
    for (const n of [old, yesterday, today]) await mk(n);
    const warnings: unknown[][] = [];
    setFoldLogger({ warn: ((...a: unknown[]) => void warnings.push(a)) as never });
    await gc(t.c.db.db);
    expect(await exists(old)).toBe(false);
    expect(await exists(yesterday)).toBe(true);
    expect(await exists(today)).toBe(true);
    expect(warnings).toEqual([]);
    // a drop that fails is logged with the table name, and the clean-up goes on
    const failing = { execute: async (q: unknown) => { const text = JSON.stringify(q); if (text.includes("DROP TABLE")) throw new Error("boom"); return t.c.db.db.execute(q as never); } } as never;
    await mk(`f_${"d".repeat(20)}_${ymd(5 * 86_400_000)}`);
    await gc(failing);
    expect(JSON.stringify(warnings)).toContain(`f_${"d".repeat(20)}`);
    for (const n of [yesterday, today, `f_${"d".repeat(20)}_${ymd(5 * 86_400_000)}`]) await t.c.db.db.execute(sql.raw(`DROP TABLE IF EXISTS mfold.${n}`));
  });
});
