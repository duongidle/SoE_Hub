import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";
import { processPendingColumns } from "../src/modules/datahub";

/**
 * Stage 4.6A: a formula that reads a column with ONE VALUE PER PERSON (`storage: person`) is reader-scoped (design module4 3.4, module2 6.5):
 * the owner's value is in `data`, each member's in `dh_personal_rows`, computed with THEIR person cells. Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2.
 */
let t: TestApp;
let org: Org;
let mgrA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let userB1: ReturnType<typeof as>;
let deals: { id: string; master_table_id: string };
const key: Record<string, string> = {};
const rid: Record<string, string> = {};
const person = (id: string, attrs: Record<string, unknown> = {}) => ({ id, attrs });
const settle = async () => {
  await drainOutbox(t);
  await processPendingColumns(t.c.db.db);
  await drainOutbox(t);
};
const upd = async (call: ReturnType<typeof as>, data: Record<string, unknown>) => {
  const row = await call("datahub.row.get", { table_id: deals.master_table_id, row_id: rid.d1 });
  await call("datahub.row.update", { table_id: deals.master_table_id, row_id: rid.d1, version: row.version, data });
};
const valueOf = async (call: ReturnType<typeof as>, row: string, name: string) => (await call("datahub.row.get", { table_id: deals.master_table_id, row_id: row })).data[key[name]!];

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  userB1 = as(t, org.userB1.id);
  deals = await mgrA("datahub.template.create", { name: "Deals", kind: "shared", member_permission: "edit_data" });
  const col = async (name: string, type: string, extra: Record<string, unknown> = {}) => {
    key[name] = (await mgrA("datahub.template.column.create", { template_id: deals.id, name, type, ...extra })).key;
  };
  await col("Tên", "text");
  await col("Com", "number");
  await col("Người tham gia", "user", { config: { attrs: [{ key: "ty_le_com", label: "% com", kind: "percent", default: 0 }] } });
  await col("% Com cá nhân", "percent", { storage: "person", autofill: { column: "Người tham gia", attr: "ty_le_com" } });
  await col("Com dự kiến của tôi", "formula", { config: { formula: "=[Com]*[% Com cá nhân]" } });
  await col("Hệ số của tôi", "number", { storage: "person", allow_edit: true });
  await col("Com theo hệ số", "formula", { config: { formula: "=[Com]*[Hệ số của tôi]" } });
  await col("Gấp đôi", "formula", { config: { formula: "=[Com dự kiến của tôi]*2" } });
  await mgrA("datahub.table.share_options.set", { table_id: deals.master_table_id, key_split: true, key_columns: ["Người tham gia"] });
  const d = await mgrA("datahub.row.create", { table_id: deals.master_table_id, data: { Tên: "d1", Com: 1000, "Người tham gia": [person(org.userA1.id, { ty_le_com: 0.3 }), person(org.userA2.id, { ty_le_com: 0.1 })] } });
  rid.d1 = d.id;
  await settle();
});
afterAll(async () => {
  await t.close();
});

describe("a formula over a person-stored column", () => {
  it("each person sees their own value; the chain reads it per person too", async () => {
    expect(await valueOf(userA1, rid.d1!, "Com dự kiến của tôi")).toBeCloseTo(300, 9);
    expect(await valueOf(userA2, rid.d1!, "Com dự kiến của tôi")).toBeCloseTo(100, 9);
    expect(await valueOf(userA1, rid.d1!, "Gấp đôi")).toBeCloseTo(600, 9);
    expect(await valueOf(userA2, rid.d1!, "Gấp đôi")).toBeCloseTo(200, 9);
  });

  it("the owner sees the value of their own person cell (not in the deal: 0)", async () => {
    expect(await valueOf(mgrA, rid.d1!, "Com dự kiến của tôi")).toBeCloseTo(0, 9);
  });

  it("changing one person's % changes only their value", async () => {
    await upd(mgrA, { "Người tham gia": [person(org.userA1.id, { ty_le_com: 0.5 }), person(org.userA2.id, { ty_le_com: 0.1 })] });
    await settle();
    expect(await valueOf(userA1, rid.d1!, "Com dự kiến của tôi")).toBeCloseTo(500, 9);
    expect(await valueOf(userA2, rid.d1!, "Com dự kiến của tôi")).toBeCloseTo(100, 9);
  });

  it("changing the shared cell recomputes every person", async () => {
    await upd(mgrA, { Com: 2000 });
    await settle();
    expect(await valueOf(userA1, rid.d1!, "Com dự kiến của tôi")).toBeCloseTo(1000, 9);
    expect(await valueOf(userA2, rid.d1!, "Com dự kiến của tôi")).toBeCloseTo(200, 9);
  });

  it("a person's own cell is theirs alone: the formula over it differs per person", async () => {
    await upd(mgrA, { "Hệ số của tôi": 0.25 });
    await upd(userA1, { "Hệ số của tôi": 0.5 });
    await settle();
    expect(await valueOf(mgrA, rid.d1!, "Com theo hệ số")).toBeCloseTo(500, 9);
    expect(await valueOf(userA1, rid.d1!, "Com theo hệ số")).toBeCloseTo(1000, 9);
    expect(await valueOf(userA2, rid.d1!, "Com theo hệ số")).toBeCloseTo(0, 9);
    await upd(userA1, { "Hệ số của tôi": 0.1 });
    await settle();
    expect(await valueOf(userA1, rid.d1!, "Com theo hệ số")).toBeCloseTo(200, 9);
    expect(await valueOf(mgrA, rid.d1!, "Com theo hệ số")).toBeCloseTo(500, 9);
  });

  it("someone outside the tree does not see the deal or its values", async () => {
    expect((await fails(userB1("datahub.row.get", { table_id: deals.master_table_id, row_id: rid.d1 }))).code).toMatch(/not_found|forbidden/);
  });
});
