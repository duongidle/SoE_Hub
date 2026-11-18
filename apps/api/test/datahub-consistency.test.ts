import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Waiting for the worker and "calculating" per cell (design module2 section 6.7): every write returns its change
 * sequence; reads accept `consistent_after` / `consistent=true`, wait a bounded time and report `stale`; rows carry
 * `pending` (the computed columns being calculated).
 */
let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;
let adm: ReturnType<typeof as>;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
  adm = as(t, org.admin.id);
});
afterAll(async () => {
  await t.close();
});


async function setWait(ms: number) {
  const cur = await adm("system.setting.list", { limit: 200 }).then((r) => (r.items as { key: string; version: number }[]).find((x) => x.key === "datahub.consistent_wait_ms"));
  await adm("system.setting.set", { key: "datahub.consistent_wait_ms", value: ms, ...(cur ? { version: cur.version } : {}) });
}

/** Customers (Mã) with SUMIFS over Deals (Mã KH, Tiền). Customers KH1..KH3; deal d1 for KH1, d2 for KH2. */
async function scenario() {
  const cust = await makeTable(a, { columns: [{ name: "Mã", type: "text" }] });
  const deals = await a("datahub.table.create", { datahub_id: cust.dhId, name: "Deals" });
  await a("datahub.column.create", { table_id: deals.id, name: "Mã KH", type: "text" });
  await a("datahub.column.create", { table_id: deals.id, name: "Tiền", type: "number" });
  const sum = await a("datahub.column.create", { table_id: cust.tableId, name: "Tổng", type: "formula", config: { formula: "=SUMIFS([Deals].[Tiền], [Deals].[Mã KH], [Mã])" } });
  const rows: Record<string, { id: string }> = {};
  for (const m of ["KH1", "KH2", "KH3"]) rows[m] = await a("datahub.row.create", { table_id: cust.tableId, data: { Mã: m } });
  const d1 = await a("datahub.row.create", { table_id: deals.id, data: { "Mã KH": "KH1", Tiền: 10 } });
  const d2 = await a("datahub.row.create", { table_id: deals.id, data: { "Mã KH": "KH2", Tiền: 20 } });
  await drainOutbox(t);
  return { cust, deals, sum: sum.key as string, sumId: sum.id as string, rows, d1, d2 };
}
type S = Awaited<ReturnType<typeof scenario>>;
const list = (s: S, extra: Record<string, unknown> = {}) => a("datahub.row.list", { table_id: s.cust.tableId, limit: 50, ...extra }) as Promise<{ items: { id: string; data: Record<string, unknown>; pending?: string[] }[]; extra?: { consistency?: { seq: number; stale: boolean; columns: string[] } } }>;
const sumOf = (res: Awaited<ReturnType<typeof list>>, s: S, code: string) => res.items.find((r) => r.id === s.rows[code]!.id)!.data[s.sum];

describe("every write returns its change sequence", () => {
  it("create, update, delete, restore, upsert and batch return `seq`; it only grows", async () => {
    const x = await makeTable(a, { columns: [{ name: "Mã", type: "text", unique: true }, { name: "N", type: "number" }] });
    const c = await a("datahub.row.create", { table_id: x.tableId, data: { Mã: "a", N: 1 } });
    const u = await a("datahub.row.update", { table_id: x.tableId, row_id: c.id, data: { N: 2 }, version: c.version });
    const up = await a("datahub.row.upsert", { table_id: x.tableId, key: "Mã", data: { Mã: "b", N: 3 } });
    const b = await a("datahub.row.batch", { table_id: x.tableId, ops: [{ op: "create", data: { Mã: "c" } }, { op: "create", data: { Mã: "d" } }] });
    const del = await a("datahub.row.delete", { table_id: x.tableId, row_id: c.id });
    const res = await a("datahub.row.restore", { table_id: x.tableId, row_id: c.id });
    const seqs = [c.seq, u.seq, up.seq, b.seq, del.seq, res.seq];
    for (const s of seqs) expect(Number.isInteger(s) && s > 0).toBe(true);
    expect([...seqs].sort((p, q2) => p - q2)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(b.results.every((r: { seq: number }) => r.seq === b.seq)).toBe(true);
  });
});

describe("consistent_after / consistent", () => {
  it("waits for the worker and returns the new value (not stale)", async () => {
    const s = await scenario();
    const w = await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d1.id, data: { Tiền: 500 }, version: s.d1.version });
    // Without waiting the value is still the old one.
    expect(sumOf(await list(s), s, "KH1")).toBe(10);
    setTimeout(() => void processPendingColumns(t.c.db.db), 300);
    const t0 = Date.now();
    const res = await list(s, { consistent_after: w.seq });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(res.extra?.consistency).toEqual({ seq: w.seq, stale: false, columns: [] });
    expect(sumOf(res, s, "KH1")).toBe(500);
    expect(res.items.every((r) => !r.pending)).toBe(true);
    // Reading with a sequence that is already done does not wait.
    const t1 = Date.now();
    expect((await list(s, { consistent_after: w.seq })).extra?.consistency?.stale).toBe(false);
    expect(Date.now() - t1).toBeLessThan(250);
    // Plain reads carry no consistency block.
    expect((await list(s)).extra).toBeUndefined();
  });

  it("consistent=true waits for the newest sequence at the time of the call", async () => {
    const s = await scenario();
    await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d2.id, data: { Tiền: 7 }, version: s.d2.version });
    setTimeout(() => void processPendingColumns(t.c.db.db), 200);
    const res = await list(s, { consistent: "true" });
    expect(res.extra!.consistency!.stale).toBe(false);
    expect(sumOf(res, s, "KH2")).toBe(7);
  });

  it("times out: the current values come back with stale=true and the unfinished columns", async () => {
    const s = await scenario();
    await setWait(150);
    try {
      const w = await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d1.id, data: { Tiền: 99 }, version: s.d1.version });
      const t0 = Date.now();
      const res = await list(s, { consistent_after: w.seq });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(res.extra!.consistency).toEqual({ seq: w.seq, stale: true, columns: [s.sum] });
      expect(sumOf(res, s, "KH1")).toBe(10); // the old value, honestly flagged
      const one = await a("datahub.row.get", { table_id: s.cust.tableId, row_id: s.rows["KH1"]!.id, consistent: "true" });
      expect(one.consistency).toMatchObject({ stale: true, columns: [s.sum] });
      expect(one.data[s.sum]).toBe(10);
    } finally {
      await setWait(5000);
    }
    await drainOutbox(t);
  });

  it("a column that no write of the sequence touched does not hold the read", async () => {
    const s = await scenario();
    await setWait(150);
    try {
      // A write to an UNRELATED table: it queues nothing for the SUMIFS column.
      const other = await makeTable(a, { columns: [{ name: "N", type: "number" }] });
      const w = await a("datahub.row.create", { table_id: other.tableId, data: { N: 1 } });
      expect((await list(s, { consistent_after: w.seq })).extra!.consistency).toEqual({ seq: w.seq, stale: false, columns: [] });
    } finally {
      await setWait(5000);
    }
  });

  it("a chain: a read waits for the SECOND column, whose entries appear only when the first is done", async () => {
    const s = await scenario();
    const b = await a("datahub.column.create", { table_id: s.cust.tableId, name: "Gấp đôi", type: "formula", config: { formula: "=SUMIFS([Deals].[Tiền], [Deals].[Mã KH], [Mã])*2" } });
    // A column that reads another computed column of the same table (through the whole column) is queued when that one finishes.
    const c = await a("datahub.column.create", { table_id: s.cust.tableId, name: "Tổng chung", type: "formula", config: { formula: "=SUM([Bảng 1].[Tổng])" } });
    await drainOutbox(t);
    const w = await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d1.id, data: { Tiền: 40 }, version: s.d1.version });
    await setWait(150);
    try {
      const res = await list(s, { consistent_after: w.seq });
      expect(res.extra!.consistency!.stale).toBe(true);
      expect(res.extra!.consistency!.columns).toEqual(expect.arrayContaining([s.sum, c.key, b.key]));
    } finally {
      await setWait(5000);
    }
    setTimeout(() => void processPendingColumns(t.c.db.db), 100);
    const ok = await list(s, { consistent_after: w.seq });
    expect(ok.extra!.consistency).toMatchObject({ stale: false });
    expect(ok.items[0]!.data[c.key]).toBe(40 + 20); // the final column of the chain is already up to date
  });

  it("the column reports the sequence it has incorporated", async () => {
    const s = await scenario();
    const w = await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d1.id, data: { Tiền: 11 }, version: s.d1.version });
    await drainOutbox(t);
    const col = (await a("datahub.table.get", { table_id: s.cust.tableId })).columns.find((c: { key: string }) => c.key === s.sum);
    expect(col.calc.seq).toBeGreaterThanOrEqual(w.seq);
  });
});

describe("`pending`: the cells being calculated", () => {
  it("only the rows in the column's queue are pending; none once the worker is done", async () => {
    const s = await scenario();
    await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d1.id, data: { Tiền: 5 }, version: s.d1.version });
    const mid = await list(s);
    const pend = Object.fromEntries(mid.items.map((r) => [r.id, r.pending ?? null]));
    expect(pend[s.rows["KH1"]!.id]).toEqual([s.sum]);
    expect(pend[s.rows["KH2"]!.id]).toBeNull();
    expect(pend[s.rows["KH3"]!.id]).toBeNull();
    // Same through `get`, and `fields=` without the computed column hides it.
    expect((await a("datahub.row.get", { table_id: s.cust.tableId, row_id: s.rows["KH1"]!.id })).pending).toEqual([s.sum]);
    expect((await a("datahub.row.get", { table_id: s.cust.tableId, row_id: s.rows["KH1"]!.id, fields: "Mã" })).pending).toBeUndefined();
    await drainOutbox(t);
    expect((await list(s)).items.every((r) => !r.pending)).toBe(true);
  });

  it("a whole-column recomputation marks every row; a lookup marks the rows linked to a changed target", async () => {
    const s = await scenario();
    await a("datahub.column.update", { table_id: s.cust.tableId, column: s.sum, config: { formula: "=SUMIFS([Deals].[Tiền], [Deals].[Mã KH], [Mã])+0" } });
    const all = await list(s);
    expect(all.items.every((r) => r.pending?.includes(s.sum))).toBe(true);
    await drainOutbox(t);

    const rel = await a("datahub.column.create", { table_id: s.cust.tableId, name: "Deal", type: "relation", config: { target_table_id: s.deals.id, multiple: true } });
    const lk = await a("datahub.column.create", { table_id: s.cust.tableId, name: "Tiền deal", type: "lookup", config: { relation: rel.key, target_column: "Tiền" } });
    await a("datahub.row.update", { table_id: s.cust.tableId, row_id: s.rows["KH1"]!.id, data: { Deal: [s.d1.id] }, version: (await a("datahub.row.get", { table_id: s.cust.tableId, row_id: s.rows["KH1"]!.id })).version });
    await a("datahub.row.update", { table_id: s.cust.tableId, row_id: s.rows["KH2"]!.id, data: { Deal: [s.d2.id] }, version: (await a("datahub.row.get", { table_id: s.cust.tableId, row_id: s.rows["KH2"]!.id })).version });
    await drainOutbox(t);
    await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d2.id, data: { Tiền: 77 }, version: (await a("datahub.row.get", { table_id: s.deals.id, row_id: s.d2.id })).version });
    const res = await list(s);
    const byId = Object.fromEntries(res.items.map((r) => [r.id, r.pending ?? []]));
    expect(byId[s.rows["KH2"]!.id]).toContain(lk.key);
    expect(byId[s.rows["KH1"]!.id]).not.toContain(lk.key);
    expect(byId[s.rows["KH3"]!.id]).not.toContain(lk.key);
    await drainOutbox(t);
    expect((await list(s)).items.every((r) => !r.pending)).toBe(true);
  });
});

describe("permissions are unchanged by the new options", () => {
  it("a stranger gets not_found with or without consistent options; a viewer may use them", async () => {
    const s = await scenario();
    const stranger = as(t, org.userB1.id);
    for (const extra of [{}, { consistent: "true" }, { consistent_after: 1 }]) {
      expect((await fails(stranger("datahub.row.list", { table_id: s.cust.tableId, ...extra }))).code).toBe("not_found");
      expect((await fails(stranger("datahub.row.get", { table_id: s.cust.tableId, row_id: s.rows["KH1"]!.id, ...extra }))).code).toBe("not_found");
    }
    await a("datahub.share.set", { datahub_id: s.cust.dhId, grantee_id: org.userA2.id, permission: "view" });
    const v = as(t, org.userA2.id);
    const w = await a("datahub.row.update", { table_id: s.deals.id, row_id: s.d1.id, data: { Tiền: 8 }, version: s.d1.version });
    setTimeout(() => void processPendingColumns(t.c.db.db), 150);
    const res = await v("datahub.row.list", { table_id: s.cust.tableId, consistent_after: w.seq });
    expect(res.extra.consistency.stale).toBe(false);
    // A pending flag shows the viewer only column keys, never the formula text.
    expect(JSON.stringify(res)).not.toContain("SUMIFS");
    // A viewer cannot write, so they never get a sequence.
    expect((await fails(v("datahub.row.create", { table_id: s.cust.tableId, data: {} }))).code).toBe("forbidden");
  });
});
