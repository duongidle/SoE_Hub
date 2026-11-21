import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { processJobs, processPendingColumns } from "../src/modules/datahub";

/**
 * Stage 4.6E: viewer functions ME(), ISME(), ATTR() (design module2 section 6.2). A column that uses ME or ISME (directly or through another column) is
 * reader-scoped: the owner's value is in `data`, each member's in `dh_personal_rows`, computed as THAT person. Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2.
 * `Deals` has the split lock; `Chung` (same columns) has none.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let tables: Record<"Deals" | "Chung", { id: string; master_table_id: string }>;
const key: Record<string, Record<string, string>> = { Deals: {}, Chung: {} };
const rid: Record<string, string> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });
const settle = async () => {
  await drainOutbox(t);
  await processPendingColumns(t.c.db.db);
  await drainOutbox(t);
};
type Call = ReturnType<typeof as>;
const valueOf = async (call: Call, tb: "Deals" | "Chung", row: string, name: string) => (await call("datahub.row.get", { table_id: tables[tb].master_table_id, row_id: row })).data[key[tb]![name]!];
const upd = async (call: Call, tb: "Deals" | "Chung", row: string, data: Record<string, unknown>) => {
  const cur = await call("datahub.row.get", { table_id: tables[tb].master_table_id, row_id: row });
  await call("datahub.row.update", { table_id: tables[tb].master_table_id, row_id: row, version: cur.version, data });
};

const ATTRS = [
  { key: "vai_tro", label: "Vai trò", kind: "select", options: ["Leading", "Associate"] },
  { key: "ty_le_com", label: "% com", kind: "percent", default: 0 },
];

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  const make = async (name: "Deals" | "Chung", split: boolean) => {
    const tpl = await mgrA("datahub.template.create", { name, kind: "shared", member_permission: "edit_data" });
    const col = async (n: string, type: string, extra: Record<string, unknown> = {}) => {
      key[name]![n] = (await mgrA("datahub.template.column.create", { template_id: tpl.id, name: n, type, ...extra })).key;
    };
    await col("Tên", "text");
    await col("Người tham gia", "user", { config: { attrs: ATTRS } });
    await col("Leading", "user");
    await col("Leading %", "percent");
    await col("Associate", "user");
    await col("Associate %", "percent");
    await col("Vai trò của tôi", "formula", { config: { formula: '=ATTR([Người tham gia], ME(), "Vai trò")', result_type: "text" } });
    await col("% com của tôi", "formula", { config: { formula: '=ATTR([Người tham gia], ME(), "% com")', result_type: "number" } });
    await col("Là tôi", "formula", { config: { formula: "=ISME([Người tham gia])", result_type: "checkbox" } });
    await col("Gấp đôi", "formula", { config: { formula: "=[% com của tôi]*2", result_type: "number" } });
    await col("% bốn cột", "formula", { config: { formula: "=IF([Leading]=ME(),[Leading %],IF([Associate]=ME(),[Associate %],0))", result_type: "number" } });
    await col("Người xem", "formula", { config: { formula: "=ME()", result_type: "text" } });
    if (split) await mgrA("datahub.table.share_options.set", { table_id: tpl.master_table_id, key_split: true, key_columns: ["Người tham gia"] });
    return tpl;
  };
  tables = { Deals: await make("Deals", true), Chung: await make("Chung", false) };
  for (const tb of ["Deals", "Chung"] as const) {
    const r = await mgrA("datahub.row.create", {
      table_id: tables[tb].master_table_id,
      data: {
        Tên: "d1",
        "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.3 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.1 })],
        Leading: org.userA1.id,
        "Leading %": 0.6,
        Associate: org.userA2.id,
        "Associate %": 0.4,
      },
    });
    rid[tb] = r.id;
  }
  await settle();
});
afterAll(async () => {
  await t.close();
});

describe.each(["Deals", "Chung"] as const)("viewer functions, table %s", (tb) => {
  it("two people on one row get two values; the owner gets the owner's", async () => {
    expect(await valueOf(userA1, tb, rid[tb]!, "% com của tôi")).toBeCloseTo(0.3, 9);
    expect(await valueOf(userA2, tb, rid[tb]!, "% com của tôi")).toBeCloseTo(0.1, 9);
    expect(await valueOf(userA1, tb, rid[tb]!, "Vai trò của tôi")).toBe("Leading");
    expect(await valueOf(userA2, tb, rid[tb]!, "Vai trò của tôi")).toBe("Associate");
    // The owner is not in the cell: blank (ATTR) and false (ISME).
    expect(await valueOf(mgrA, tb, rid[tb]!, "Vai trò của tôi")).toBeFalsy();
    expect(await valueOf(userA1, tb, rid[tb]!, "Là tôi")).toBe(true);
    expect(await valueOf(mgrA, tb, rid[tb]!, "Là tôi")).toBeFalsy();
    expect(await valueOf(userA1, tb, rid[tb]!, "Người xem")).toBe(org.userA1.id);
    expect(await valueOf(userA2, tb, rid[tb]!, "Người xem")).toBe(org.userA2.id);
    expect(await valueOf(mgrA, tb, rid[tb]!, "Người xem")).toBe(org.mgrA.id);
  });

  it("a column that reads a viewer column is per person too", async () => {
    expect(await valueOf(userA1, tb, rid[tb]!, "Gấp đôi")).toBeCloseTo(0.6, 9);
    expect(await valueOf(userA2, tb, rid[tb]!, "Gấp đôi")).toBeCloseTo(0.2, 9);
  });

  it("the four-column layout with IF(... ME() ...)", async () => {
    expect(await valueOf(userA1, tb, rid[tb]!, "% bốn cột")).toBeCloseTo(0.6, 9);
    expect(await valueOf(userA2, tb, rid[tb]!, "% bốn cột")).toBeCloseTo(0.4, 9);
    expect(await valueOf(mgrA, tb, rid[tb]!, "% bốn cột")).toBeCloseTo(0, 9);
  });

  it("changing the people cell changes the value of exactly the person changed", async () => {
    await upd(mgrA, tb, rid[tb]!, { "Người tham gia": [person(org.userA1.id, { vai_tro: "Leading", ty_le_com: 0.5 }), person(org.userA2.id, { vai_tro: "Associate", ty_le_com: 0.1 })] });
    await settle();
    expect(await valueOf(userA1, tb, rid[tb]!, "% com của tôi")).toBeCloseTo(0.5, 9);
    expect(await valueOf(userA2, tb, rid[tb]!, "% com của tôi")).toBeCloseTo(0.1, 9);
    await upd(mgrA, tb, rid[tb]!, { "Leading %": 0.7 });
    await settle();
    expect(await valueOf(userA1, tb, rid[tb]!, "% bốn cột")).toBeCloseTo(0.7, 9);
    expect(await valueOf(userA2, tb, rid[tb]!, "% bốn cột")).toBeCloseTo(0.4, 9);
  });

  it("export as each person writes that person's value", async () => {
    const read = async (call: Call): Promise<string> => {
      const job = await call("datahub.export.create", { table_id: tables[tb].master_table_id, format: "json" });
      await processJobs(env());
      const key2 = ((await t.c.db.db.execute(sql`SELECT result_key FROM dh_jobs WHERE /*scope:system*/ id = ${job.id}::uuid`)).rows[0] as { result_key: string }).result_key;
      const chunks: Buffer[] = [];
      for await (const c of (t.c.storage as unknown as { read(k: string): AsyncIterable<Buffer> }).read(key2)) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    };
    const a1 = await read(userA1);
    const a2 = await read(userA2);
    const row1 = (JSON.parse(a1) as { rows: Record<string, unknown>[] }).rows[0]!;
    const row2 = (JSON.parse(a2) as { rows: Record<string, unknown>[] }).rows[0]!;
    expect(row1["Người xem"]).not.toEqual(row2["Người xem"]);
    expect(row1["% com của tôi"]).toBeCloseTo(0.5, 9);
    expect(row2["% com của tôi"]).toBeCloseTo(0.1, 9);
  });
});

describe("viewer functions: columns and errors", () => {
  it("a column using ME() or ISME(), directly or through another, is flagged reader-scoped; the others are not", async () => {
    const res = await t.c.db.db.execute(sql`SELECT c.name, c.reader_scoped FROM dh_columns c WHERE /*scope:system*/ c.table_id = ${tables.Chung.master_table_id}::uuid AND c.deleted_at IS NULL`);
    const flag = Object.fromEntries((res.rows as { name: string; reader_scoped: boolean }[]).map((r) => [r.name, r.reader_scoped]));
    for (const n of ["Vai trò của tôi", "% com của tôi", "Là tôi", "Gấp đôi", "% bốn cột", "Người xem"]) expect(flag[n], n).toBe(true);
    for (const n of ["Tên", "Người tham gia", "Leading %"]) expect(flag[n], n).toBeFalsy();
  });

  it("ATTR checks its arguments when the column is saved", async () => {
    const tpl = tables.Chung;
    const bad = (formula: string) => fails(mgrA("datahub.template.column.create", { template_id: tpl.id, name: `x${Math.random()}`, type: "formula", config: { formula, result_type: "text" } }));
    expect((await bad('=ATTR([Tên], ME(), "Vai trò")')).message).toMatch(/Người dùng/);
    expect((await bad('=ATTR([Người tham gia], ME(), "Không có")')).message).toMatch(/không có thuộc tính/);
  });

  it("the function catalogue lists them", async () => {
    const f = await mgrA("datahub.formula.functions", {});
    expect(f.functions.filter((x: { group: string }) => x.group === "Người xem").map((x: { name: string }) => x.name).sort()).toEqual(["ATTR", "ISME", "ME"]);
  });
});
