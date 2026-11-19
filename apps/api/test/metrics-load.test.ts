import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { OutboxRow } from "@soe/db";
import type { MTable } from "@soe/metrics";
import { as, actorOf, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { SseHub, type SseSignal } from "../src/http/sse";
import { loadTableAccess, scopeKey } from "../src/modules/datahub/access";
import { metricCacheSubscriber, metricCacheStats, metricLimits, resetMetricCache, runSql, invalidateMetricCache } from "../src/modules/metrics";
import { peak, resetPeak } from "../src/modules/metrics/runner";

/**
 * Stage 3A-2 (sections 4 and 5): the answer cache (key = statement + scope of every table read), merging of identical statements in
 * flight, at most 6 statements at once per person, the 10 second limit, and clearing the cache (and telling open dashboards)
 * when rows, computed values, structure, sharing or the organization tree change.
 */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let hub: SseHub;
let x: Awaited<ReturnType<typeof makeTable>>;
let total: { id: string };
let derived: { id: string };

const DEFAULT_LIMITS = { ...metricLimits };
const value = (r: { rows: { value: number | null }[] }) => r.rows[0]!.value;
const fake = (scopeKeyValue: string | undefined, id: string = randomUUID()): MTable => ({ id, name: "x", columns: [], scope: () => sql`TRUE`, ...(scopeKeyValue ? { scopeKey: scopeKeyValue } : {}) });
const ctxOf = (userId: string) => ({ db: t.c.db.db, actor: actorOf(userId) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  t = await makeApp({}, { sse: true });
  hub = t.sse!;
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  owner = as(t, org.userA1.id);
  x = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }, { name: "Tiền", type: "number" }, { name: "Gấp đôi", type: "formula", config: { formula: "=[Tiền]*2" } }] });
  await owner("datahub.row.batch", { table_id: x.tableId, ops: [10, 20, 30].map((n, i) => ({ op: "create", data: { Tên: `K${i}`, Tiền: n } })) });
  await drainOutbox(t);
  total = await owner("metrics.metric.create", { datahub_id: x.dhId, metric: { name: "Tổng", source: x.tableId, measure: { agg: "sum", field: "Tiền" } } });
  await owner("metrics.metric.create", { datahub_id: x.dhId, metric: { name: "Số dòng", source: x.tableId, measure: { agg: "count" } } });
  derived = await owner("metrics.metric.create", { datahub_id: x.dhId, metric: { name: "Tổng trên số dòng", formula: "=[Tổng] / [Số dòng]" } });
}, 60_000);

afterEach(() => {
  Object.assign(metricLimits, DEFAULT_LIMITS);
  resetMetricCache();
});
afterAll(async () => {
  await t.close();
});

describe("scopeKey (datahub/access.ts)", () => {
  it("is the table and the level: another table or another level never shares a key", async () => {
    const a = await loadTableAccess({ db: t.c.db.db, actor: actorOf(org.userA1.id) }, x.tableId);
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    const b = await loadTableAccess({ db: t.c.db.db, actor: actorOf(org.userA2.id) }, x.tableId);
    expect(scopeKey(a)).toBe(`${x.tableId}:owner`);
    expect(scopeKey(b)).toBe(`${x.tableId}:view`);
    expect(scopeKey(a)).not.toBe(scopeKey(b));
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    expect(scopeKey(await loadTableAccess({ db: t.c.db.db, actor: actorOf(org.userA2.id) }, x.tableId))).toBe(`${x.tableId}:edit_data`);
  });
});

describe("cache", () => {
  it("answers the second identical call from the cache, with the same numbers", async () => {
    const first = await owner("metrics.query", { metric_id: total.id });
    const s1 = metricCacheStats();
    const second = await owner("metrics.query", { metric_id: total.id });
    const s2 = metricCacheStats();
    expect(value(first)).toBe(60);
    expect(value(second)).toBe(60);
    expect(s2.executed).toBe(s1.executed);
    expect(s2.hits).toBeGreaterThan(s1.hits);
    expect(second.ms).toBe(0);
  });

  it("two readers with different scope never share an answer; two with the same scope do", async () => {
    const same = sql`SELECT 1 AS v`;
    const ctx = ctxOf(org.userA1.id);
    const id = randomUUID();
    await runSql(ctx, same, [fake("t:owner", id)]);
    await runSql(ctx, same, [fake("t:view", id)]);
    expect(metricCacheStats().executed).toBe(2);
    await runSql(ctx, same, [fake("t:view", id)]);
    expect(metricCacheStats().executed).toBe(2);
    expect(metricCacheStats().hits).toBe(1);
    // a table without a scope key is never cached
    await runSql(ctx, same, [fake(undefined, id)]);
    await runSql(ctx, same, [fake(undefined, id)]);
    expect(metricCacheStats().executed).toBe(2);
  });

  it("through the API: the owner and a person shared at another level compute separately", async () => {
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    const viewer = as(t, org.userA2.id);
    await owner("metrics.query", { metric_id: total.id });
    const s1 = metricCacheStats();
    expect(value(await viewer("metrics.query", { metric_id: total.id }))).toBe(60);
    expect(metricCacheStats().executed).toBe(s1.executed + 1);
    await viewer("metrics.query", { metric_id: total.id });
    expect(metricCacheStats().executed).toBe(s1.executed + 1);
  });

  it("a person who lost access gets no cached answer (access is checked before the cache)", async () => {
    const viewer = as(t, org.userA2.id);
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    expect(value(await viewer("metrics.query", { metric_id: total.id }))).toBe(60);
    const shares = await owner("datahub.share.list", { datahub_id: x.dhId });
    const mine = shares.find((s: { grantee_id: string }) => s.grantee_id === org.userA2.id);
    await owner("datahub.share.remove", { datahub_id: x.dhId, share_id: mine.id });
    // No worker ran: the cache still holds the old answer, and still the person gets nothing.
    expect(metricCacheStats().entries).toBeGreaterThan(0);
    expect(["forbidden", "not_found"]).toContain((await fails(viewer("metrics.query", { metric_id: total.id }))).code);
    expect(["forbidden", "not_found"]).toContain((await fails(viewer("metrics.query", { metric: { name: "x", source: x.tableId, measure: { agg: "sum", field: "Tiền" } } }))).code);
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
  });

  it("parameters are part of the key: another target, comparison or filter is another answer", async () => {
    const q = (extra: Record<string, unknown>) => owner("metrics.query", { metric_id: total.id, ...extra });
    expect((await q({ target: JSON.stringify({ value: 100 }) })).rows[0].target).toBe(100);
    expect((await q({ target: JSON.stringify({ value: 200 }) })).rows[0].target).toBe(200);
    expect(value(await q({ filter: JSON.stringify({ field: "Tiền", op: "gt", value: 15 }) }))).toBe(50);
    expect(value(await q({}))).toBe(60);
    // a derived metric is its parts: both parts are in the key
    expect(value(await owner("metrics.query", { metric_id: derived.id }))).toBe(20);
    expect(value(await owner("metrics.query", { metric_id: derived.id, filter: JSON.stringify({ field: "Tiền", op: "gt", value: 15 }) }))).toBe(25);
  });

  it("today is part of the key: a relative range read on another day is another answer", async () => {
    const { runDefinition } = await import("../src/modules/metrics");
    const def = { name: "n", source: x.tableId, measure: { agg: "count" as const }, time: { field: "_created_at", range: "this_month" } };
    const ctx = ctxOf(org.userA1.id);
    const a = await runDefinition(ctx, def as never, {}, { now: new Date("2026-03-15T05:00:00Z") });
    const s1 = metricCacheStats();
    const b = await runDefinition(ctx, def as never, {}, { now: new Date("2026-04-15T05:00:00Z") });
    expect(metricCacheStats().executed).toBeGreaterThan(s1.executed);
    expect(a.diagnostics.range).not.toEqual(b.diagnostics.range);
  });

  it("a statement that was running while the table changed is not stored", async () => {
    const id = randomUUID();
    const ctx = ctxOf(org.userA1.id);
    const q = sql`SELECT pg_sleep(0.3) AS s`;
    const slow = runSql(ctx, q, [fake("t:owner", id)]);
    await sleep(100);
    invalidateMetricCache({ tables: [id] });
    await slow;
    expect(metricCacheStats().entries).toBe(0);
    await runSql(ctx, sql`SELECT pg_sleep(0) AS s`, [fake("t:owner", id)]);
    expect(metricCacheStats().entries).toBe(1);
  });

  it("drops the oldest answers beyond the limit and answers older than the safety TTL", async () => {
    const ctx = ctxOf(org.userA1.id);
    metricLimits.maxEntries = 3;
    for (let i = 0; i < 5; i++) await runSql(ctx, sql`SELECT ${i}::int AS v`, [fake("k")]);
    expect(metricCacheStats().entries).toBe(3);
    metricLimits.ttlMs = 1;
    await runSql(ctx, sql`SELECT 99 AS v`, [fake("k")]);
    await sleep(10);
    const before = metricCacheStats().executed;
    await runSql(ctx, sql`SELECT 99 AS v`, [fake("k")]);
    expect(metricCacheStats().executed).toBe(before + 1);
  });
});

describe("merging identical requests in flight", () => {
  it("runs one statement for many identical concurrent requests", async () => {
    const ctx = ctxOf(org.userA1.id);
    const tbl = fake("t:owner");
    const q = () => runSql(ctx, sql`SELECT pg_sleep(0.3) AS s, 7 AS v`, [tbl]);
    const all = await Promise.all([q(), q(), q(), q(), q()]);
    expect(all.map((r) => r.rows[0]!.v)).toEqual([7, 7, 7, 7, 7]);
    const s = metricCacheStats();
    expect(s.executed).toBe(1);
    expect(s.joined).toBe(4);
  });

  it("a failing statement fails every request that waited for it, and is not cached", async () => {
    const ctx = ctxOf(org.userA1.id);
    const tbl = fake("t:owner");
    const q = () => runSql(ctx, sql`SELECT pg_sleep(0.1), 1/0 AS v`, [tbl]);
    const res = await Promise.allSettled([q(), q(), q()]);
    expect(res.every((r) => r.status === "rejected")).toBe(true);
    expect(metricCacheStats().entries).toBe(0);
  });

  it("through the API: ten dashboards' worth of the same metric compute it once", async () => {
    const before = metricCacheStats();
    const rs = await Promise.all(Array.from({ length: 10 }, () => owner("metrics.query", { metric_id: total.id })));
    expect(rs.every((r) => value(r) === 60)).toBe(true);
    expect(metricCacheStats().executed - before.executed).toBe(1);
  });
});

describe("limits", () => {
  it("runs at most 6 statements at once for one person; the rest wait; another person has their own six", async () => {
    resetPeak();
    const ctx = ctxOf(org.userA1.id);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 12 }, (_, i) => runSql(ctx, sql`SELECT pg_sleep(0.2), ${i}::int AS v`, [fake("k")])));
    expect(peak.value).toBe(6);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(380); // two waves of 0.2 s
    resetPeak();
    await Promise.all(Array.from({ length: 6 }, (_, i) => runSql(ctxOf(org.userA2.id), sql`SELECT pg_sleep(0.1), ${i + 100}::int AS v`, [fake("k")])));
    expect(peak.value).toBe(6);
  });

  it("a statement that runs over the limit is cancelled with a message that says how to narrow it; the connection stays usable", async () => {
    metricLimits.timeoutMs = 150;
    const ctx = ctxOf(org.userA1.id);
    const e = await fails(runSql(ctx, sql`SELECT pg_sleep(2) AS s`, [fake("k")]));
    expect(e.code).toBe("validation_error");
    expect(e.details.reason).toBe("query_too_heavy");
    expect(e.message).toContain("Truy vấn quá nặng");
    expect(e.details.hint).toBeTruthy();
    expect(metricCacheStats().entries).toBe(0);
    metricLimits.timeoutMs = DEFAULT_LIMITS.timeoutMs;
    expect((await runSql(ctx, sql`SELECT 1 AS v`, [fake("k")])).rows[0]!.v).toBe(1);
    // the limit was set for that statement alone
    const r = await runSql(ctx, sql`SELECT current_setting('statement_timeout') AS s`, [fake("k2")]);
    expect(r.rows[0]!.s).toBe("10s");
  });

  it("the slot is given back after a failure (no leak)", async () => {
    const ctx = ctxOf(org.userA1.id);
    for (let i = 0; i < 8; i++) await runSql(ctx, sql`SELECT 1/0 AS v`, [fake("k")]).catch(() => {});
    resetPeak();
    await Promise.all(Array.from({ length: 6 }, (_, i) => runSql(ctx, sql`SELECT pg_sleep(0.05), ${i + 500}::int AS v`, [fake("k")])));
    expect(peak.value).toBe(6);
  });
});

describe("clearing the cache by outbox event + SSE", () => {
  const waitFor = async (cond: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await sleep(20);
    expect(cond()).toBe(true);
  };
  const signals: SseSignal[] = [];
  let off: () => void;
  beforeAll(() => {
    off = hub.subscribe((s) => signals.push(s));
  });
  afterAll(() => off());

  it("a changed row clears the answer, the next call reads the new number, open dashboards get a signal", async () => {
    expect(value(await owner("metrics.query", { metric_id: total.id }))).toBe(60);
    const rows = await owner("datahub.row.list", { table_id: x.tableId });
    const first = rows.items[0];
    signals.length = 0;
    await owner("datahub.row.update", { table_id: x.tableId, row_id: first.id, data: { Tiền: first.data?.[x.cols["Tiền"]!.key] === 10 ? 110 : 10 }, version: first.version });
    await drainOutbox(t);
    await waitFor(() => signals.some((s) => s.event === "metrics.data.changed"));
    const sig = signals.find((s) => s.event === "metrics.data.changed")!;
    expect(sig.aggregate_type).toBe("datahub");
    expect(sig.aggregate_id).toBe(x.dhId);
    expect(sig.audience!.users).toContain(org.userA1.id);
    expect(JSON.stringify(sig)).not.toContain("Tiền");
    expect(value(await owner("metrics.query", { metric_id: total.id }))).toBe(160);
    await owner("datahub.row.update", { table_id: x.tableId, row_id: first.id, data: { Tiền: 10 }, version: first.version + 1 });
    await drainOutbox(t);
    await sleep(150);
    expect(value(await owner("metrics.query", { metric_id: total.id }))).toBe(60);
  });

  it("a computed column that was recalculated clears the answers that read it", async () => {
    const m = await owner("metrics.metric.create", { datahub_id: x.dhId, metric: { name: "Tổng gấp đôi", source: x.tableId, measure: { agg: "sum", field: "Gấp đôi" } } });
    await drainOutbox(t);
    await sleep(150);
    expect(value(await owner("metrics.query", { metric_id: m.id }))).toBe(120);
    const rows = await owner("datahub.row.list", { table_id: x.tableId });
    const r = rows.items.find((i: { data: Record<string, unknown> }) => i.data[x.cols["Tiền"]!.key] === 20);
    await owner("datahub.row.update", { table_id: x.tableId, row_id: r.id, data: { Tiền: 25 }, version: r.version });
    await drainOutbox(t);
    await sleep(200);
    expect(value(await owner("metrics.query", { metric_id: m.id }))).toBe(130);
    await owner("datahub.row.update", { table_id: x.tableId, row_id: r.id, data: { Tiền: 20 }, version: r.version + 1 });
    await drainOutbox(t);
    await sleep(200);
    expect(value(await owner("metrics.query", { metric_id: m.id }))).toBe(120);
  });

  it("changing the sharing of the source clears the cache and tells the people concerned", async () => {
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    await drainOutbox(t);
    await sleep(150);
    await owner("metrics.query", { metric_id: total.id });
    expect(metricCacheStats().entries).toBeGreaterThan(0);
    signals.length = 0;
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    await drainOutbox(t);
    await waitFor(() => signals.some((s) => s.event === "metrics.data.changed"));
    await waitFor(() => metricCacheStats().entries === 0);
    const sig = signals.find((s) => s.event === "metrics.data.changed")!;
    expect(sig.audience!.users).toEqual(expect.arrayContaining([org.userA1.id, org.userA2.id]));
  });

  it("a change of the structure (a column renamed) clears the cache", async () => {
    await owner("metrics.query", { metric_id: total.id });
    expect(metricCacheStats().entries).toBeGreaterThan(0);
    await owner("datahub.column.update", { table_id: x.tableId, column: "Tên", name: "Họ tên" });
    await drainOutbox(t);
    await waitFor(() => metricCacheStats().entries === 0);
    await owner("datahub.column.update", { table_id: x.tableId, column: "Họ tên", name: "Tên" });
    await drainOutbox(t);
  });

  it("a change of the organization tree clears everything and tells everyone who may use datahubs", async () => {
    await owner("metrics.query", { metric_id: total.id });
    expect(metricCacheStats().entries).toBeGreaterThan(0);
    signals.length = 0;
    const ev = { id: randomUUID(), event: "org.member.changed", payload: { user_id: org.userA2.id, change: "updated" }, createdAt: new Date() } as unknown as OutboxRow;
    await metricCacheSubscriber.handle(ev, t.c.db.db);
    await waitFor(() => metricCacheStats().entries === 0);
    await waitFor(() => signals.some((s) => s.event === "metrics.data.changed"));
    expect(signals.find((s) => s.event === "metrics.data.changed")!.audience).toEqual({ permission: "datahub:datahub:use" });
  });

  it("the organization move through the real command clears the cache", async () => {
    const admin = as(t, org.admin.id);
    await owner("metrics.query", { metric_id: total.id });
    expect(metricCacheStats().entries).toBeGreaterThan(0);
    const m = await admin("org.member.get", { id: org.userA2.id });
    await admin("org.member.update", { id: org.userA2.id, version: m.version, full_name: `UserA2 ${org.tag} (moved)` });
    await drainOutbox(t);
    await waitFor(() => metricCacheStats().entries === 0);
  });

  it("when the notification connection is re-established, everything is dropped (messages sent while it was down are lost)", async () => {
    await owner("metrics.query", { metric_id: total.id });
    expect(metricCacheStats().entries).toBeGreaterThan(0);
    const h2 = new SseHub(t.c.config.DATABASE_URL, t.c.logger);
    h2.subscribeCache((m) => invalidateMetricCache(m as never));
    await h2.start();
    await h2.stop();
    expect(metricCacheStats().entries).toBe(0);
  });
});
