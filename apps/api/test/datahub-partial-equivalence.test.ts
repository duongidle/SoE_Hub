import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { seedOrg, type Org } from "./fixtures";
import { markPending } from "../src/modules/datahub/recalc";

/**
 * The safety net of partial recalculation (design module2 section 6.7): thousands of random edits (inserts, deletes,
 * restores, key changes, relation edits, chains). After EVERY batch the stored values of every computed column, produced
 * by the partial recalculation, must equal exactly what a full recomputation of every column produces.
 */
const EDITS = Number(process.env.DH_EQUIV_EDITS ?? 2500);
const SEED = Number(process.env.DH_EQUIV_SEED ?? 20261118);

let t: TestApp;
let org: Org;
let a: ReturnType<typeof as>;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  a = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Keys that are different texts but the same group for the engine: case, spaces, accents, numeric text, blanks.
const KEYS = ["K1", "k1", "K2", " K2 ", "K3", "007", "7", "7.0", " 7", "Ab Á", "ab á", "Z", null, null];
const TYPES = ["A", "B", "a", "C"];
const DATES = ["2026-01-05", "2026-01-06", "2026-02-01", "2026-02-02", null];
const GROUPS = ["G1", "g1", "G2", "G3", null];

describe(`${EDITS} random edits: partial recalculation == full recalculation`, () => {
  it("every batch", async () => {
    const rnd = prng(SEED);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const chance = (p: number) => rnd() < p;

    // ---- schema -------------------------------------------------------------------------------------
    const cust = await makeTable(a, { columns: [{ name: "Mã", type: "text" }, { name: "Nhóm", type: "text" }, { name: "Năm", type: "number" }, { name: "Hạn", type: "date" }] });
    const mkTable = async (name: string, cols: [string, string, unknown?][]) => {
      const tb = await a("datahub.table.create", { datahub_id: cust.dhId, name });
      for (const [n, type, config] of cols) await a("datahub.column.create", { table_id: tb.id, name: n, type, ...(config ? { config } : {}) });
      return tb.id as string;
    };
    const dealsId = await mkTable("Deals", [["Mã KH", "text"], ["Số tiền", "number"], ["Loại", "text"], ["Ngày", "date"], ["Năm", "number"], ["KH", "relation", { target_table_id: cust.tableId, multiple: true }]]);
    const groupsId = await mkTable("Nhóm", [["Nhóm", "text"]]);
    const cf = async (table: string, name: string, type: string, config: unknown) => (await a("datahub.column.create", { table_id: table, name, type, config })).key as string;
    const formulas: string[] = [];
    const on = (table: string, name: string, f: string) => cf(table, name, "formula", { formula: f }).then((k) => (formulas.push(k), k));
    // customers: equality groups of every aggregate family, one and two key columns, literal key, date key, chains, fallbacks
    await on(cust.tableId, "Tổng", "=SUMIFS([Deals].[Số tiền], [Deals].[Mã KH], [Mã])");
    await on(cust.tableId, "Số", "=COUNTIFS([Deals].[Mã KH], [Mã])");
    await on(cust.tableId, "Đầu", '=XLOOKUP([Mã], [Deals].[Mã KH], [Deals].[Loại], "-")');
    await on(cust.tableId, "Lớn nhất", "=MAXIFS([Deals].[Ngày], [Deals].[Mã KH], [Mã])");
    await on(cust.tableId, "Trung bình", "=IFERROR(AVERAGEIFS([Deals].[Số tiền], [Deals].[Mã KH], [Mã]), -1)");
    await on(cust.tableId, "Hai khoá", "=COUNTIFS([Deals].[Mã KH], [Mã], [Deals].[Năm], [Năm])");
    await on(cust.tableId, "Loại A", '=SUMIFS([Deals].[Số tiền], [Deals].[Mã KH], [Mã], [Deals].[Loại], "A")');
    await on(cust.tableId, "Theo hạn", "=SUMIFS([Deals].[Số tiền], [Deals].[Ngày], [Hạn])");
    await on(cust.tableId, "Cùng nhóm", "=COUNTIFS([Bảng 1].[Nhóm], [Nhóm])");
    await on(cust.tableId, "Biểu thức", '=SUMIFS([Deals].[Số tiền], [Deals].[Mã KH], [Mã] & "")');
    await on(cust.tableId, "Tra INDEX", "=IFERROR(INDEX([Deals].[Số tiền], MATCH([Mã], [Deals].[Mã KH], 0)), -1)");
    await on(cust.tableId, "Kết hợp", "=IFERROR([Tổng] / [Số], 0) + [Cùng nhóm]"); // API formula over worker columns (chain inside one table)
    // groups: a chain over a computed column of customers
    const groupSum = await on(groupsId, "Tổng nhóm", "=SUMIFS([Bảng 1].[Tổng], [Bảng 1].[Nhóm], [Nhóm])");
    await on(groupsId, "Số KH", "=COUNTIFS([Bảng 1].[Nhóm], [Nhóm])");
    // deals: lookups into customers, a rollup and a lookup through the relation, plus an API formula
    await on(dealsId, "Nhóm KH", "=XLOOKUP([Mã KH], [Bảng 1].[Mã], [Bảng 1].[Nhóm], \"?\")");
    await cf(dealsId, "Tên KH", "lookup", { relation: "KH", target_column: "Mã" });
    await cf(dealsId, "Tổng tổng", "rollup", { relation: "KH", target_column: "Tổng", fn: "sum" }); // a rollup over a computed column
    await on(dealsId, "Gấp đôi", "=[Số tiền] * 2");
    await on(dealsId, "Gấp đôi KH", "=[Gấp đôi] + IFERROR(VALUE([Tổng tổng]), 0)");

    // ---- state ---------------------------------------------------------------------------------------
    const tables = { cust: cust.tableId as string, deals: dealsId, groups: groupsId };
    type St = { live: Map<string, number>; trash: Set<string> };
    const st: Record<keyof typeof tables, St> = { cust: { live: new Map(), trash: new Set() }, deals: { live: new Map(), trash: new Set() }, groups: { live: new Map(), trash: new Set() } };
    const cells: Record<keyof typeof tables, () => Record<string, unknown>> = {
      cust: () => ({ Mã: pick(KEYS), Nhóm: pick(GROUPS), Năm: pick([1, 2, 3, null]), Hạn: pick(DATES) }),
      deals: () => ({
        "Mã KH": pick(KEYS),
        "Số tiền": pick([0, 5, 10, 25, 100, null]),
        Loại: pick(TYPES),
        Ngày: pick(DATES),
        Năm: pick([1, 2, 3, null]),
        KH: chance(0.5) ? [] : [...st.cust.live.keys()].filter(() => chance(0.15)).slice(0, 2),
      }),
      groups: () => ({ Nhóm: pick(GROUPS) }),
    };
    const partialCells = (k: keyof typeof tables) => {
      // a few of the columns only, so single-cell edits (an amount alone, a key alone) are common
      const all = cells[k]();
      const names = Object.keys(all);
      const n = 1 + Math.floor(rnd() * 2);
      return Object.fromEntries(names.filter(() => chance(n / names.length + 0.1)).map((c) => [c, all[c]]));
    };
    const track = (k: keyof typeof tables, results: { outcome: string; id: string; row: { version: number } | null }[]) => {
      for (const r of results) {
        if (r.outcome === "deleted") {
          st[k].live.delete(r.id);
          st[k].trash.add(r.id);
        } else if (r.row) st[k].live.set(r.id, r.row.version);
      }
    };
    for (const k of ["cust", "deals", "groups"] as const) {
      const n = k === "deals" ? 30 : 12;
      const res = await a("datahub.row.batch", { table_id: tables[k], ops: Array.from({ length: n }, () => ({ op: "create", data: cells[k]() })) });
      track(k, res.results);
    }
    await drainOutbox(t);

    const computedCols: Record<string, { key: string; name: string }[]> = {};
    for (const [k, id] of Object.entries(tables)) {
      computedCols[k] = ((await a("datahub.table.get", { table_id: id })).columns as { key: string; name: string; type: string }[]).filter((c) => ["formula", "lookup", "rollup"].includes(c.type));
    }
    const snapshot = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, id] of Object.entries(tables)) {
        const rows = (await a("datahub.row.list", { table_id: id, limit: 500 })).items as { id: string; data: Record<string, unknown> }[];
        for (const r of rows) for (const c of computedCols[k]!) out[`${k}/${r.id}/${c.name}`] = r.data[c.key] ?? null;
      }
      return out;
    };
    const allComputedIds = async () => {
      const res = await t.c.db.db.execute((await import("drizzle-orm")).sql`SELECT c.id FROM dh_columns c JOIN dh_tables tb ON tb.id = c.table_id WHERE /*scope:system*/ tb.datahub_id = ${cust.dhId}::uuid AND c.deleted_at IS NULL AND c.type IN ('formula', 'lookup', 'rollup')`);
      return (res.rows as { id: string }[]).map((r) => r.id);
    };
    const computedIds = await allComputedIds();

    // ---- random edits --------------------------------------------------------------------------------
    let edits = 0;
    let batches = 0;
    const stats = { create: 0, update: 0, delete: 0, restore: 0 };
    while (edits < EDITS) {
      const k = pick(["cust", "deals", "deals", "deals", "groups"] as const);
      const s = st[k];
      const size = 1 + Math.floor(rnd() * 5);
      const ops: Record<string, unknown>[] = [];
      const touched = new Set<string>();
      const restores: string[] = [];
      for (let i = 0; i < size; i++) {
        const r = rnd();
        const liveIds = [...s.live.keys()].filter((id) => !touched.has(id));
        if (r < 0.3 || liveIds.length === 0) {
          ops.push({ op: "create", data: cells[k]() });
          stats.create++;
        } else if (r < 0.75) {
          const id = pick(liveIds);
          touched.add(id);
          ops.push({ op: "update", id, version: s.live.get(id), data: partialCells(k) });
          stats.update++;
        } else if (r < 0.9) {
          const id = pick(liveIds);
          touched.add(id);
          ops.push({ op: "delete", id, version: s.live.get(id) });
          stats.delete++;
        } else if (s.trash.size) {
          restores.push(pick([...s.trash]));
        }
      }
      if (ops.length) {
        const res = await a("datahub.row.batch", { table_id: tables[k], ops });
        track(k, res.results);
        edits += ops.length;
      }
      for (const id of new Set(restores)) {
        const row = await a("datahub.row.restore", { table_id: tables[k], row_id: id });
        s.trash.delete(id);
        s.live.set(id, row.version);
        edits++;
        stats.restore++;
      }
      // Partial recalculation (always partial, or with the production ratio now and then), then the reference: every computed column in full.
      await drainOutbox(t, { maxRatio: chance(0.15) ? 0.2 : 1 });
      const partial = await snapshot();
      await markPending(t.c.db.db, computedIds);
      await drainOutbox(t);
      const full = await snapshot();
      batches++;
      const bad = Object.keys(full).filter((key) => JSON.stringify(partial[key]) !== JSON.stringify(full[key]));
      if (bad.length) {
        const head = bad.slice(0, 5).map((key) => `${key}: partial=${JSON.stringify(partial[key])} full=${JSON.stringify(full[key])}`);
        expect.fail(`seed ${SEED}, after ${edits} edits (${batches} batches), ${bad.length} cells differ:\n${head.join("\n")}`);
      }
    }
    console.warn(`[equivalence] seed ${SEED}: ${edits} edits in ${batches} batches (${JSON.stringify(stats)}), ${Object.keys(await snapshot()).length} computed cells compared after every batch, 0 differences; columns: ${computedIds.length}, groupSum=${groupSum}`);
    expect(edits).toBeGreaterThanOrEqual(EDITS);
  }, 900_000);
});
