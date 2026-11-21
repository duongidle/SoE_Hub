import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueOutbox, orgMemberships, outbox } from "@soe/db";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { processJobs } from "../src/modules/datahub";
import { readerScopedColumns, readerScopedColumnsOfOrgChange } from "../src/modules/datahub/recalc";
import { datahubEvents } from "../src/modules/datahub/events";
import { invalidateMetricCache } from "../src/modules/metrics";

/**
 * Stage 4.1b: a Lookup, a Rollup or a formula that reads a table with the split lock is computed for each reader over the rows THEY see (design
 * module2 section 10). Owner = userA2 (under MgrA). Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2. Tree B: MgrB > LeaderB > UserB1.
 * Deals (split lock on `Phụ trách`): d1 UserA1 100 (K1), d2 UserA2 200 (K1), d3 LeaderA 400 (K1), d4 UserB1 800 (K2), d5 MgrA 1600 (K1).
 * Customers (no lock): K1, K2 with a rollup of the revenue of their deals, a SUMIFS, a lookup and a formula that reads the rollup.
 */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let mgrA: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userB1: ReturnType<typeof as>;
let cust: Awaited<ReturnType<typeof makeTable>>;
let dealsId: string;
const dealCols: Record<string, string> = {};
const col: Record<string, string> = {};
const rid: Record<string, string> = {};
const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });

const values = async (call: ReturnType<typeof as>, name: string, tableId = cust.tableId): Promise<Record<string, unknown>> => {
  const r = await call("datahub.row.list", { table_id: tableId, limit: 200 });
  return Object.fromEntries((r.items as { data: Record<string, unknown> }[]).map((i) => [i.data[col["Tên"]!] as string, i.data[col[name]!]]));
};
const all = async (call: ReturnType<typeof as>, name: string) => values(call, name);

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  owner = as(t, org.userA2.id);
  mgrA = as(t, org.mgrA.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
  userB1 = as(t, org.userB1.id);
  cust = await makeTable(owner, { name: "Khách khoá", columns: [{ name: "Tên", type: "text" }] });
  col.Tên = cust.cols["Tên"]!.key;
  const deals = await owner("datahub.table.create", { datahub_id: cust.dhId, name: "Deals" });
  dealsId = deals.id;
  for (const c of [{ name: "Khách", type: "text" }, { name: "Phụ trách", type: "user" }, { name: "Doanh thu", type: "number" }]) dealCols[c.name] = (await owner("datahub.column.create", { table_id: dealsId, ...c })).key;
  const rel = await owner("datahub.column.create", { table_id: cust.tableId, name: "Các deal", type: "relation", config: { target_table_id: dealsId, multiple: true } });
  for (const p of [org.mgrA, org.leaderA, org.userA1, org.userB1]) await owner("datahub.share.set", { datahub_id: cust.dhId, grantee_id: p.id, permission: "view" });
  const mk = async (khach: string, who: string, revenue: number) => (await owner("datahub.row.create", { table_id: dealsId, data: { Khách: khach, "Phụ trách": who, "Doanh thu": revenue } })).id as string;
  rid.d1 = await mk("K1", org.userA1.id, 100);
  rid.d2 = await mk("K1", org.userA2.id, 200);
  rid.d3 = await mk("K1", org.leaderA.id, 400);
  rid.d4 = await mk("K2", org.userB1.id, 800);
  rid.d5 = await mk("K1", org.mgrA.id, 1600);
  rid.k1 = (await owner("datahub.row.create", { table_id: cust.tableId, data: { Tên: "K1", "Các deal": [rid.d1, rid.d2, rid.d3, rid.d5] } })).id;
  rid.k2 = (await owner("datahub.row.create", { table_id: cust.tableId, data: { Tên: "K2", "Các deal": [rid.d4] } })).id;
  const roll = await owner("datahub.column.create", { table_id: cust.tableId, name: "Tổng rollup", type: "rollup", config: { relation: rel.key, target_column: "Doanh thu", fn: "sum" } });
  const sumifs = await owner("datahub.column.create", { table_id: cust.tableId, name: "Tổng SUMIFS", type: "formula", config: { formula: "=SUMIFS([Deals].[Doanh thu], [Deals].[Khách], [Tên])" } });
  const twice = await owner("datahub.column.create", { table_id: cust.tableId, name: "Gấp đôi", type: "formula", config: { formula: "=[Tổng rollup]*2" } });
  const count = await owner("datahub.column.create", { table_id: cust.tableId, name: "Số deal", type: "rollup", config: { relation: rel.key, target_column: "Doanh thu", fn: "count" } });
  Object.assign(col, { "Tổng rollup": roll.key, "Tổng SUMIFS": sumifs.key, "Gấp đôi": twice.key, "Số deal": count.key, "Các deal": rel.key });
  await owner("datahub.table.share_options.set", { table_id: dealsId, key_split: true, key_columns: ["Phụ trách"] });
  await drainOutbox(t);
});
afterAll(async () => {
  await t.close();
});

describe("which columns are reader-scoped", () => {
  it("columns that read the locked table are, and so is the formula that reads one of them; plain columns are not", async () => {
    const r = await t.c.db.db.execute(sql`SELECT name, reader_scoped FROM dh_columns WHERE /*scope:system*/ table_id = ${cust.tableId}::uuid AND deleted_at IS NULL`);
    const flags = Object.fromEntries((r.rows as { name: string; reader_scoped: boolean }[]).map((x) => [x.name, x.reader_scoped]));
    expect(flags).toMatchObject({ "Tổng rollup": true, "Tổng SUMIFS": true, "Gấp đôi": true, "Số deal": true, Tên: false, "Các deal": false });
  });
});

describe("every reader gets their own value, in every channel", () => {
  it("list: owner over all rows; each member over the rows they see; one with no rows gets 0", async () => {
    expect(await all(owner, "Tổng rollup")).toEqual({ K1: 2300, K2: 800 });
    expect(await all(userA1, "Tổng rollup")).toEqual({ K1: 100, K2: 0 });
    expect(await all(leaderA, "Tổng rollup")).toEqual({ K1: 500, K2: 0 });
    expect(await all(mgrA, "Tổng rollup")).toEqual({ K1: 2300, K2: 0 });
    expect(await all(userB1, "Tổng rollup")).toEqual({ K1: 0, K2: 800 });
    expect(await all(userA1, "Số deal")).toEqual({ K1: 1, K2: 0 });
  });

  it("a formula with SUMIFS over the locked table, and a formula that reads the rollup, follow the same rule", async () => {
    expect(await all(owner, "Tổng SUMIFS")).toEqual({ K1: 2300, K2: 800 });
    expect(await all(leaderA, "Tổng SUMIFS")).toEqual({ K1: 500, K2: 0 });
    expect(await all(userB1, "Tổng SUMIFS")).toEqual({ K1: 0, K2: 800 });
    expect(await all(owner, "Gấp đôi")).toEqual({ K1: 4600, K2: 1600 });
    expect(await all(userA1, "Gấp đôi")).toEqual({ K1: 200, K2: 0 });
    expect(await all(leaderA, "Gấp đôi")).toEqual({ K1: 1000, K2: 0 });
  });

  it("one row (row.get), a filter on the value, a sort on it and the group totals use the reader's value", async () => {
    expect((await userA1("datahub.row.get", { table_id: cust.tableId, row_id: rid.k1! })).data[col["Tổng rollup"]!]).toBe(100);
    expect((await leaderA("datahub.row.get", { table_id: cust.tableId, row_id: rid.k1! })).data[col["Tổng rollup"]!]).toBe(500);
    const f = await leaderA("datahub.row.list", { table_id: cust.tableId, filter: JSON.stringify({ field: "Tổng rollup", op: "gte", value: 500 }) });
    expect(f.items.map((i: { id: string }) => i.id)).toEqual([rid.k1]);
    const none = await userA1("datahub.row.list", { table_id: cust.tableId, filter: JSON.stringify({ field: "Tổng rollup", op: "gte", value: 500 }) });
    expect(none.items).toHaveLength(0);
    const sorted = await userB1("datahub.row.list", { table_id: cust.tableId, sort: "Tổng rollup:desc" });
    expect(sorted.items[0].id).toBe(rid.k2);
    const g = await userA1("datahub.row.groups", { table_id: cust.tableId, group: JSON.stringify([{ field: "Tên" }]), aggs: JSON.stringify({ "Tổng rollup": "sum" }) });
    expect(g.groups.reduce((n: number, r: { aggs: Record<string, number> }) => n + (r.aggs[col["Tổng rollup"]!] ?? 0), 0)).toBe(100);
    const go = await owner("datahub.row.groups", { table_id: cust.tableId, group: JSON.stringify([{ field: "Tên" }]), aggs: JSON.stringify({ "Tổng rollup": "sum" }) });
    expect(go.groups.reduce((n: number, r: { aggs: Record<string, number> }) => n + (r.aggs[col["Tổng rollup"]!] ?? 0), 0)).toBe(3100);
  });

  it("export (a worker job as the person) writes the reader's value", async () => {
    const job = await leaderA("datahub.export.create", { table_id: cust.tableId, format: "json" });
    await processJobs(env());
    const done = await leaderA("datahub.job.get", { job_id: job.id });
    expect(done.status).toBe("done");
    const chunks: Buffer[] = [];
    const key = ((await t.c.db.db.execute(sql`SELECT result_key FROM dh_jobs WHERE /*scope:system*/ id = ${job.id}::uuid`)).rows[0] as { result_key: string }).result_key;
    for await (const c of (t.c.storage as unknown as { read(k: string): AsyncIterable<Buffer> }).read(key)) chunks.push(c as Buffer);
    const rows = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    const text = JSON.stringify(rows);
    expect(text).toContain("500");
    expect(text).not.toContain("2300");
  });

  it("a metric on the rollup is each reader's own number, and the cache never mixes readers", async () => {
    const m = await owner("metrics.metric.create", { datahub_id: cust.dhId, metric: { name: "Tổng DT khách", source: cust.tableId, measure: { agg: "sum", field: "Tổng rollup" } } });
    const val = async (c: ReturnType<typeof as>) => (await c("metrics.query", { metric_id: m.id })).rows[0].value as number;
    expect(await val(owner)).toBe(3100);
    expect(await val(userA1)).toBe(100);
    expect(await val(leaderA)).toBe(500);
    expect(await val(mgrA)).toBe(2300);
    expect(await val(userB1)).toBe(800);
    expect(await val(userA1)).toBe(100);
  });
});

describe("partial recalculation for the readers affected", () => {
  const tamperPersonal = async (userId: string, rowId: string, key: string) =>
    t.c.db.db.execute(sql`UPDATE dh_personal_rows SET data = jsonb_set(data, ARRAY[${key}::text], '-999'::jsonb) WHERE /*scope:system*/ row_id = ${rowId}::uuid AND user_id = ${userId}::uuid`);

  it("editing a deal moves the value of the readers who see it, for the customers that link to it only", async () => {
    await tamperPersonal(org.userA1.id, rid.k2!, col["Tổng rollup"]!);
    const cur = (await owner("datahub.row.get", { table_id: dealsId, row_id: rid.d1! })).version;
    await owner("datahub.row.update", { table_id: dealsId, row_id: rid.d1!, data: { "Doanh thu": 150 }, version: cur });
    await drainOutbox(t, { maxRatio: 1 });
    expect(await all(userA1, "Tổng rollup")).toEqual({ K1: 150, K2: -999 }); // K2 was not recomputed
    expect(await all(leaderA, "Tổng rollup")).toEqual({ K1: 550, K2: 0 });
    expect(await all(owner, "Tổng rollup")).toEqual({ K1: 2350, K2: 800 });
    expect(await all(userB1, "Tổng rollup")).toEqual({ K1: 0, K2: 800 });
    expect(await all(userA1, "Gấp đôi")).toMatchObject({ K1: 300 });
    // The change made by the recalculation leaves no history and no version bump on the customer row.
    const h = await owner("datahub.row.history", { table_id: cust.tableId, row_id: rid.k1! });
    expect(JSON.stringify(h.items)).not.toContain("Tổng rollup");
    await t.c.db.db.execute(sql`UPDATE dh_personal_rows SET data = jsonb_set(data, ARRAY[${col["Tổng rollup"]!}::text], '0'::jsonb) WHERE /*scope:system*/ row_id = ${rid.k2!}::uuid AND user_id = ${org.userA1.id}::uuid`);
  });

  it("moving a deal to another person (the key column) moves it between their values", async () => {
    const cur = (await owner("datahub.row.get", { table_id: dealsId, row_id: rid.d1! })).version;
    await owner("datahub.row.update", { table_id: dealsId, row_id: rid.d1!, data: { "Phụ trách": org.userB1.id }, version: cur });
    await drainOutbox(t);
    expect(await all(userA1, "Tổng rollup")).toEqual({ K1: 0, K2: 0 });
    expect(await all(userB1, "Tổng rollup")).toEqual({ K1: 150, K2: 800 });
    expect(await all(leaderA, "Tổng rollup")).toEqual({ K1: 400, K2: 0 });
    expect(await all(owner, "Tổng rollup")).toEqual({ K1: 2350, K2: 800 });
  });

  it("a change in the organization tree changes what the managers see", async () => {
    // LeaderA takes UserA2's deals into the team: UserA2 now reports to LeaderA.
    await t.c.db.db.update(orgMemberships).set({ leaderId: org.leaderA.id }).where(eq(orgMemberships.userId, org.userA2.id));
    await enqueueOutbox(t.c.db.db, { event: "org.member.changed", aggregateType: "user", aggregateId: org.userA2.id, payload: { user_id: org.userA2.id, change: "updated" } });
    await drainOutbox(t);
    expect(await all(leaderA, "Tổng rollup")).toEqual({ K1: 600, K2: 0 });
    await t.c.db.db.update(orgMemberships).set({ leaderId: null }).where(eq(orgMemberships.userId, org.userA2.id));
    await enqueueOutbox(t.c.db.db, { event: "org.member.changed", aggregateType: "user", aggregateId: org.userA2.id, payload: { user_id: org.userA2.id, change: "updated" } });
    await drainOutbox(t);
    expect(await all(leaderA, "Tổng rollup")).toEqual({ K1: 400, K2: 0 });
  });

  it("a deal removed and restored, and a new deal linked to the customer, reach the readers who see it", async () => {
    await owner("datahub.row.delete", { table_id: dealsId, row_id: rid.d3! });
    await drainOutbox(t);
    expect(await all(leaderA, "Tổng rollup")).toEqual({ K1: 0, K2: 0 });
    expect(await all(owner, "Tổng rollup")).toEqual({ K1: 1950, K2: 800 });
    await owner("datahub.row.restore", { table_id: dealsId, row_id: rid.d3! });
    await drainOutbox(t);
    expect(await all(leaderA, "Tổng rollup")).toEqual({ K1: 400, K2: 0 });
    const d6 = (await owner("datahub.row.create", { table_id: dealsId, data: { Khách: "K1", "Phụ trách": org.userA1.id, "Doanh thu": 5 } })).id as string;
    const k1v = (await owner("datahub.row.get", { table_id: cust.tableId, row_id: rid.k1! })).version;
    await owner("datahub.row.update", { table_id: cust.tableId, row_id: rid.k1!, data: { "Các deal": [rid.d1, rid.d2, rid.d3, rid.d5, d6] }, version: k1v });
    await drainOutbox(t);
    expect(await all(userA1, "Tổng rollup")).toEqual({ K1: 5, K2: 0 });
    expect(await all(leaderA, "Tổng rollup")).toEqual({ K1: 405, K2: 0 });
  });
});

describe("an organization event marks only the columns it can move (4.6C)", () => {
  it("only a move or a role change of someone who is, or is under, a member marks the datahub's reader-scoped columns", async () => {
    const mine = await readerScopedColumns(t.c.db.db, cust.dhId);
    expect(mine.length).toBeGreaterThan(0);
    const marked = async (user: string, change: string) => new Set(await readerScopedColumnsOfOrgChange(t.c.db.db, { user_id: user, change }));
    // A new person is in no row yet; lock, permission and a template build do not change the tree.
    for (const change of ["created", "activated", "locked", "unlocked", "permission_granted", "default_templates"]) expect((await marked(org.userA2.id, change)).size).toBe(0);
    // UserA2 reports to MgrA, who is a member: the move changes what MgrA (and UserA2) read.
    const moved = await marked(org.userA2.id, "updated");
    for (const id of mine) expect(moved.has(id)).toBe(true);
    // MgrB and tree B's people are not members of this datahub and are not under one except UserB1 (a member himself).
    const stranger = await marked(org.mgrB.id, "updated");
    for (const id of mine) expect(stranger.has(id)).toBe(false);
    // An event without a person keeps the wide mark.
    expect(new Set(await readerScopedColumnsOfOrgChange(t.c.db.db, null)).has(mine[0]!)).toBe(true);
  });
});

describe("members and the lock itself", () => {
  it("a member added later gets their values; one who is removed loses them and the table", async () => {
    await owner("datahub.share.set", { datahub_id: cust.dhId, grantee_id: org.mgrB.id, permission: "view" });
    await drainOutbox(t);
    const mgrB = as(t, org.mgrB.id);
    expect(await all(mgrB, "Tổng rollup")).toEqual({ K1: 150, K2: 800 });
    const shares = await owner("datahub.share.list", { datahub_id: cust.dhId });
    const s = (shares.items ?? shares).find((x: { grantee_id: string }) => x.grantee_id === org.mgrB.id);
    await owner("datahub.share.remove", { datahub_id: cust.dhId, share_id: s.id });
    await drainOutbox(t);
    const left = await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM dh_personal_rows WHERE /*scope:system*/ user_id = ${org.mgrB.id}::uuid`);
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });

  it("the owner's own value is never laid over a member's, even before the member's value is computed", async () => {
    await t.c.db.db.execute(sql`DELETE FROM dh_personal_rows WHERE /*scope:system*/ user_id = ${org.userA1.id}::uuid`);
    const r = await userA1("datahub.row.list", { table_id: cust.tableId, limit: 10 });
    for (const i of r.items as { data: Record<string, unknown> }[]) expect(i.data[col["Tổng rollup"]!] ?? null).toBeNull();
    await owner("datahub.table.share_options.set", { table_id: dealsId, key_split: true, key_columns: ["Phụ trách"] });
    await drainOutbox(t);
    expect(await all(userA1, "Tổng rollup")).toEqual({ K1: 5, K2: 0 });
  });

  it("turning the lock off makes the columns plain again: every member gets the total; turning it on again splits them", async () => {
    await owner("datahub.table.share_options.set", { table_id: dealsId, key_split: false });
    await drainOutbox(t);
    const flags = await t.c.db.db.execute(sql`SELECT bool_or(reader_scoped) AS any FROM dh_columns WHERE /*scope:system*/ table_id = ${cust.tableId}::uuid AND deleted_at IS NULL`);
    expect((flags.rows[0] as { any: boolean }).any).toBe(false);
    const total = await all(owner, "Tổng rollup");
    expect(await all(userA1, "Tổng rollup")).toEqual(total);
    expect(await all(userB1, "Tổng rollup")).toEqual(total);
    await owner("datahub.table.share_options.set", { table_id: dealsId, key_split: true, key_columns: ["Phụ trách"] });
    await drainOutbox(t);
    expect(await all(userA1, "Tổng rollup")).toEqual({ K1: 5, K2: 0 });
    invalidateMetricCache({ tables: [cust.tableId] });
  });
});

describe("SSE of a reader's own value", () => {
  it("a recalculated cell of one member's own value goes to that member only", async () => {
    const r = await t.c.db.db.execute(sql`SELECT payload FROM outbox WHERE event = 'datahub.formula.recalculated' AND payload->>'reader' IS NOT NULL ORDER BY created_at DESC LIMIT 1`);
    const payload = (r.rows[0] as { payload: { table_id: string; reader: string; state: string } } | undefined)?.payload;
    expect(payload).toBeTruthy();
    const ev = datahubEvents.find((e) => e.name === "datahub.formula.recalculated")!;
    const aud = await ev.audience!(payload as never, t.c.db.db);
    expect(aud!.users).toEqual([payload!.reader]);
  });
});

describe("a merged table whose source is a table with the split lock (design module3 section 4.1)", () => {
  it("a member merges it and copies only the rows they see; a table without the lock is still refused; the copy follows a change of scope", async () => {
    const mine = await makeTable(userA1, { name: "Của A1", columns: [{ name: "Tên", type: "text" }] });
    const merged = await userA1("datahub.merge.create", { datahub_id: mine.dhId, name: "Gộp deal", sources: [dealsId] });
    await drainOutbox(t);
    const count = async (call: ReturnType<typeof as>) => ((await call("datahub.row.list", { table_id: merged.table.id, limit: 100 })).items as unknown[]).length;
    const visible = async () => ((await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM dh_rows WHERE /*scope:system*/ table_id = ${dealsId}::uuid AND deleted_at IS NULL AND data->>${dealCols["Phụ trách"]!} = ${org.userA1.id}`)).rows[0] as { n: number }).n;
    expect(await count(userA1)).toBe(await visible());
    expect(await count(userA1)).toBeLessThan(5);
    // another member's merged table: a plain shared table (no lock) is refused as before
    const refused = await userA1("datahub.merge.create", { datahub_id: mine.dhId, name: "Gộp khách", sources: [cust.tableId] }).catch((e: { code?: string }) => e);
    expect(refused).toMatchObject({ code: "validation_error" });
    // the scope changes: a deal moves to UserA1 -> the copy grows
    const d4v = (await owner("datahub.row.get", { table_id: dealsId, row_id: rid.d4! })).version;
    await owner("datahub.row.update", { table_id: dealsId, row_id: rid.d4!, data: { "Phụ trách": org.userA1.id }, version: d4v });
    await drainOutbox(t);
    expect(await count(userA1)).toBe(await visible());
    const text = JSON.stringify((await userA1("datahub.row.list", { table_id: merged.table.id, limit: 100 })).items);
    expect(text).toContain("800");
    await owner("datahub.row.update", { table_id: dealsId, row_id: rid.d4!, data: { "Phụ trách": org.userB1.id }, version: d4v + 1 });
    await drainOutbox(t);
    expect(JSON.stringify((await userA1("datahub.row.list", { table_id: merged.table.id, limit: 100 })).items)).not.toContain("800");
  });
});

describe("moving a whole tree (4.6D)", () => {
  it("org.tree.transfer announces each moved person like a single move, so the columns that read by person recompute", async () => {
    // Last in the file: tree B (LeaderB, UserB1) joins MgrA, who then sees UserB1's deal (K2, 800).
    const before = await all(mgrA, "Tổng rollup");
    const r = await as(t, org.admin.id)("org.tree.transfer", { manager_id: org.mgrB.id, to_manager_id: org.mgrA.id });
    expect(r.moved).toBe(2);
    const ev = await t.c.db.db.select().from(outbox).where(sql`${outbox.event} = 'org.member.changed' AND ${outbox.payload}->>'change' = 'updated' AND ${outbox.aggregateId} IN (${org.leaderB.id}, ${org.userB1.id})`);
    expect(new Set(ev.map((e) => e.aggregateId))).toEqual(new Set([org.leaderB.id, org.userB1.id]));
    await drainOutbox(t);
    expect(before.K2).toBe(0);
    expect((await all(mgrA, "Tổng rollup")).K2).toBe(800);
  });
});
