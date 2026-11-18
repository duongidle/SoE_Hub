import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { SseHub, type SseSignal } from "../src/http/sse";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Change events and parallel recalculation (design module2 section 6.7): events of at most 500 cells `row, column,
 * old -> new`, the same event feeds SSE, independent columns run in parallel, a chain keeps its order, and the Admin
 * setting `datahub.recalc_parallel` (1-4).
 */
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

type Change = { row_id: string; column: string; old: unknown; new: unknown };
const changedEvents = async (tableId: string) =>
  (await q(`SELECT payload FROM outbox WHERE event = 'datahub.formula.recalculated' AND payload->>'state' = 'changed' AND payload->>'table_id' = $1 ORDER BY id`, [tableId])).map(
    (r) => r.payload as { columns: string[]; changes: Change[]; changed_rows: number; seq: number },
  );

describe("change events are batched by 500, with the full list", () => {
  it("1,234 changed cells -> 3 events of 500 / 500 / 234, each cell with old and new", async () => {
    const cust = await makeTable(a, { columns: [{ name: "Mã", type: "text" }] });
    const deals = await a("datahub.table.create", { datahub_id: cust.dhId, name: "Deals" });
    await a("datahub.column.create", { table_id: deals.id, name: "Mã KH", type: "text" });
    await a("datahub.column.create", { table_id: deals.id, name: "Tiền", type: "number" });
    const deal = await a("datahub.row.create", { table_id: deals.id, data: { "Mã KH": "X", Tiền: 10 } });
    // 1,234 customers with the same key: one deal edit changes all of them.
    const ck = cust.cols["Mã"]!.key;
    await q(
      `INSERT INTO dh_rows (id, table_id, row_no, data, search, created_by, updated_by)
       SELECT gen_random_uuid(), $1::uuid, g, jsonb_build_object($2::text, 'X'), '', $3::uuid, $3::uuid FROM generate_series(1, 1234) g`,
      [cust.tableId, ck, org.userA1.id],
    );
    await q(`UPDATE dh_tables SET row_count = 1234, next_row_no = 1235 WHERE id = $1`, [cust.tableId]);
    const sum = (await a("datahub.column.create", { table_id: cust.tableId, name: "Tổng", type: "formula", config: { formula: "=SUMIFS([Deals].[Tiền], [Deals].[Mã KH], [Mã])" } })).key as string;
    await drainOutbox(t);
    const before = (await changedEvents(cust.tableId)).length;
    await a("datahub.row.update", { table_id: deals.id, row_id: deal.id, data: { Tiền: 25 }, version: deal.version });
    await drainOutbox(t);
    const ev = (await changedEvents(cust.tableId)).slice(before);
    expect(ev.map((e) => e.changes.length)).toEqual([500, 500, 234]);
    expect(ev.map((e) => e.changed_rows)).toEqual([500, 500, 234]);
    const all = ev.flatMap((e) => e.changes);
    expect(new Set(all.map((c) => c.row_id)).size).toBe(1234);
    expect(all.every((c) => c.column === sum && c.old === 10 && c.new === 25)).toBe(true);
    // The final "done" event states the total.
    const done = await q(`SELECT payload FROM outbox WHERE event = 'datahub.formula.recalculated' AND payload->>'state' = 'done' AND payload->>'table_id' = $1 ORDER BY id DESC LIMIT 1`, [cust.tableId]);
    expect((done[0]!.payload as { changed_rows: number }).changed_rows).toBe(1234);
    // Same edit again: nothing changes, so no event of any kind with a list.
    const n1 = (await changedEvents(cust.tableId)).length;
    const cur = await a("datahub.row.get", { table_id: deals.id, row_id: deal.id });
    await a("datahub.row.update", { table_id: deals.id, row_id: deal.id, data: { Tiền: 25 }, version: cur.version });
    await drainOutbox(t);
    expect((await changedEvents(cust.tableId)).length).toBe(n1);
  }, 120_000);

  it("an error value is announced as {error} and a value that becomes an error has an old value", async () => {
    const o = await a("datahub.datahub.create", { name: `E ${Date.now()}` });
    const other = await a("datahub.table.create", { datahub_id: o.id, name: "Nguồn" });
    const nk = (await a("datahub.column.create", { table_id: other.id, name: "N", type: "number" })).key as string;
    const r1 = await a("datahub.row.create", { table_id: other.id, data: { N: 4 } });
    void nk;
    // A cross-table formula that divides by the source column.
    const tgt = await a("datahub.table.create", { datahub_id: o.id, name: "Đích" });
    await a("datahub.column.create", { table_id: tgt.id, name: "D", type: "number" });
    await a("datahub.row.create", { table_id: tgt.id, data: { D: 1 } });
    const f = (await a("datahub.column.create", { table_id: tgt.id, name: "Chia", type: "formula", config: { formula: "=[D]/SUM([Nguồn].[N])" } })).key as string;
    await drainOutbox(t);
    const n0 = (await changedEvents(tgt.id)).length;
    await a("datahub.row.update", { table_id: other.id, row_id: r1.id, data: { N: 0 }, version: r1.version });
    await drainOutbox(t);
    const ev = (await changedEvents(tgt.id)).slice(n0).flatMap((e) => e.changes);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ column: f, old: 0.25, new: { error: "#DIV/0!" } });
  });
});

describe("the grid's SSE is fed by the same event", () => {
  it("a recalculated cell reaches the people who see the table as a signal without values", async () => {
    const cust = await makeTable(a, { columns: [{ name: "Mã", type: "text" }] });
    const deals = await a("datahub.table.create", { datahub_id: cust.dhId, name: "Deals" });
    await a("datahub.column.create", { table_id: deals.id, name: "Mã KH", type: "text" });
    await a("datahub.column.create", { table_id: deals.id, name: "Tiền", type: "number" });
    await a("datahub.row.create", { table_id: cust.tableId, data: { Mã: "K" } });
    await a("datahub.column.create", { table_id: cust.tableId, name: "Tổng", type: "formula", config: { formula: "=SUMIFS([Deals].[Tiền], [Deals].[Mã KH], [Mã])" } });
    const d = await a("datahub.row.create", { table_id: deals.id, data: { "Mã KH": "K", Tiền: 5 } });
    await drainOutbox(t);
    await a("datahub.share.set", { datahub_id: cust.dhId, grantee_id: org.userA2.id, permission: "view" });
    await drainOutbox(t);
    const hub = new SseHub(t.c.config.DATABASE_URL, t.c.logger);
    await hub.start();
    try {
      const got: SseSignal[] = [];
      hub.subscribe((s) => got.push(s));
      await a("datahub.row.update", { table_id: deals.id, row_id: d.id, data: { Tiền: 9 }, version: d.version });
      await drainOutbox(t);
      await new Promise((r) => setTimeout(r, 400));
      const sig = got.filter((s) => s.event === "datahub.formula.recalculated" && s.aggregate_id === cust.tableId);
      expect(sig.length).toBeGreaterThanOrEqual(2); // changed + done
      expect(sig[0]!.audience!.users!.sort()).toEqual([org.userA1.id, org.userA2.id].sort());
      expect(JSON.stringify(sig)).not.toContain("changes");
    } finally {
      await hub.stop();
    }
  });
});

describe("parallel recalculation", () => {
  /** Two tables, each with an independent computed column over its own source (so the two jobs do not depend on each other). */
  async function pair() {
    const mk = async () => {
      const cust = await makeTable(a, { columns: [{ name: "Mã", type: "text" }] });
      const deals = await a("datahub.table.create", { datahub_id: cust.dhId, name: "Deals" });
      await a("datahub.column.create", { table_id: deals.id, name: "Mã KH", type: "text" });
      await a("datahub.column.create", { table_id: deals.id, name: "Tiền", type: "number" });
      await a("datahub.row.create", { table_id: cust.tableId, data: { Mã: "K" } });
      const col = await a("datahub.column.create", { table_id: cust.tableId, name: "Tổng", type: "formula", config: { formula: "=SUMIFS([Deals].[Tiền], [Deals].[Mã KH], [Mã])" } });
      const d = await a("datahub.row.create", { table_id: deals.id, data: { "Mã KH": "K", Tiền: 1 } });
      await drainOutbox(t);
      return { cust, deals, col, d };
    };
    return [await mk(), await mk()] as const;
  }

  it("with 2 lanes both independent columns are in 'running' at the same moment", async () => {
    const [p1, p2] = await pair();
    for (const p of [p1, p2]) await a("datahub.row.update", { table_id: p.deals.id, row_id: p.d.id, data: { Tiền: 7 }, version: p.d.version });
    // Hold both columns in `running` through a lock: a lane that reaches a locked column's row waits, so both lanes are observed claimed.
    const lock = new pg.Client({ connectionString: process.env.TEST_OWNER_URL });
    await lock.connect();
    await lock.query("BEGIN");
    await lock.query(`SELECT 1 FROM dh_rows WHERE table_id IN ($1, $2) FOR UPDATE`, [p1.cust.tableId, p2.cust.tableId]);
    const { dispatchOutboxOnce } = await import("../src/core/outbox-dispatcher");
    const { defaultSubscribers } = await import("../src/core/subscribers");
    await dispatchOutboxOnce(t.c.db.db, defaultSubscribers(t.c.events, t.c.config.AUTH_SECRET), t.c.logger, { batchSize: 500 });
    const run = processPendingColumns(t.c.db.db, { parallel: 2 });
    let both = false;
    for (let i = 0; i < 100 && !both; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const r = await q(`SELECT count(*)::int AS n FROM dh_columns WHERE id = ANY($1::uuid[]) AND calc_status = 'running'`, [[p1.col.id, p2.col.id]]);
      both = r[0]!.n === 2;
    }
    await lock.query("COMMIT");
    await lock.end();
    await run;
    expect(both).toBe(true);
    await drainOutbox(t);
    for (const p of [p1, p2]) {
      const rows = (await a("datahub.row.list", { table_id: p.cust.tableId })).items as { data: Record<string, unknown> }[];
      expect(rows[0]!.data[p.col.key]).toBe(7);
    }
  }, 60_000);

  it("with 1 lane the same two columns never run at the same time", async () => {
    const [p1, p2] = await pair();
    for (const p of [p1, p2]) await a("datahub.row.update", { table_id: p.deals.id, row_id: p.d.id, data: { Tiền: 3 }, version: p.d.version });
    const { dispatchOutboxOnce } = await import("../src/core/outbox-dispatcher");
    const { defaultSubscribers } = await import("../src/core/subscribers");
    await dispatchOutboxOnce(t.c.db.db, defaultSubscribers(t.c.events, t.c.config.AUTH_SECRET), t.c.logger, { batchSize: 500 });
    let maxRunning = 0;
    let stop = false;
    const watcher = (async () => {
      while (!stop) {
        const r = await q(`SELECT count(*)::int AS n FROM dh_columns WHERE id = ANY($1::uuid[]) AND calc_status = 'running'`, [[p1.col.id, p2.col.id]]);
        maxRunning = Math.max(maxRunning, r[0]!.n as number);
        await new Promise((r2) => setTimeout(r2, 2));
      }
    })();
    await processPendingColumns(t.c.db.db, { parallel: 1 });
    stop = true;
    await watcher;
    expect(maxRunning).toBeLessThanOrEqual(1);
    await drainOutbox(t);
  }, 60_000);

  it("a chain A -> B keeps its order under 4 lanes: B is computed from the NEW A", async () => {
    const cust = await makeTable(a, { columns: [{ name: "Mã", type: "text" }] });
    const deals = await a("datahub.table.create", { datahub_id: cust.dhId, name: "Deals" });
    await a("datahub.column.create", { table_id: deals.id, name: "Mã KH", type: "text" });
    await a("datahub.column.create", { table_id: deals.id, name: "Tiền", type: "number" });
    await a("datahub.row.create", { table_id: cust.tableId, data: { Mã: "K" } });
    const A = await a("datahub.column.create", { table_id: cust.tableId, name: "A", type: "formula", config: { formula: "=SUMIFS([Deals].[Tiền], [Deals].[Mã KH], [Mã])" } });
    // B reads the whole column A of the same table through a cross-row read, so it is computed by the worker after A.
    const B = await a("datahub.column.create", { table_id: cust.tableId, name: "B", type: "formula", config: { formula: "=SUM([Bảng 1].[A])*2" } });
    const d = await a("datahub.row.create", { table_id: deals.id, data: { "Mã KH": "K", Tiền: 2 } });
    await drainOutbox(t);
    await a("datahub.row.update", { table_id: deals.id, row_id: d.id, data: { Tiền: 11 }, version: d.version });
    const { dispatchOutboxOnce } = await import("../src/core/outbox-dispatcher");
    const { defaultSubscribers } = await import("../src/core/subscribers");
    await dispatchOutboxOnce(t.c.db.db, defaultSubscribers(t.c.events, t.c.config.AUTH_SECRET), t.c.logger, { batchSize: 500 });
    await processPendingColumns(t.c.db.db, { parallel: 4 });
    const rows = (await a("datahub.row.list", { table_id: cust.tableId })).items as { data: Record<string, unknown> }[];
    expect(rows[0]!.data[A.key]).toBe(11);
    expect(rows[0]!.data[B.key]).toBe(22);
  }, 60_000);
});

describe("Admin setting datahub.recalc_parallel", () => {
  it("only an Admin changes it, and only to 1-4", async () => {
    const adm = as(t, org.admin.id);
    const set = (u: ReturnType<typeof as>, value: unknown, version?: number) => u("system.setting.set", { key: "datahub.recalc_parallel", value, ...(version ? { version } : {}) });
    const first = await set(adm, 3);
    expect(first.value).toBe(3);
    expect((await fails(set(adm, 5, first.version))).code).toBe("validation_error");
    expect((await fails(set(adm, 0, first.version))).code).toBe("validation_error");
    expect((await fails(set(a, 2, first.version))).code).toBe("forbidden");
    const second = await set(adm, 4, first.version);
    expect(second.value).toBe(4);
    const cat = (await adm("system.setting.catalog")) as { key: string; default: unknown }[];
    expect(cat.find((c) => c.key === "datahub.recalc_parallel")?.default).toBe(2);
    await set(adm, 2, second.version);
  });
});
