import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 3A-1, who may do what with metrics: only the owner of the datahub writes definitions; a person who was given the datahub
 * or a table reads numbers computed inside what they may read; everyone else (Leader, Manager, Admin, Guest, other trees) gets nothing.
 * (Sharing a dashboard so that numbers are computed with the owner's rights is Stage 3C-2.)
 */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let dhId: string;
let t1: string;
let t2: string;
let m1: { id: string; version: number };
let m2: { id: string };
let m12: { id: string };

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  await unlimit(t, org.userA1.id);
  owner = as(t, org.userA1.id);
  const x = await makeTable(owner, { columns: [{ name: "Mã", type: "text" }, { name: "Số", type: "number" }] });
  dhId = x.dhId;
  t1 = x.tableId;
  const y = await owner("datahub.table.create", { datahub_id: dhId, name: "Bảng hai" });
  t2 = y.id;
  for (const c of [{ name: "Mã", type: "text" }, { name: "Tiền", type: "number" }]) await owner("datahub.column.create", { table_id: t2, ...c });
  await owner("datahub.row.batch", { table_id: t1, ops: [10, 20, 30].map((n, i) => ({ op: "create", data: { Mã: `K${i}`, Số: n } })) });
  await owner("datahub.row.batch", { table_id: t2, ops: [1, 2, 3].map((n, i) => ({ op: "create", data: { Mã: `K${i}`, Tiền: n } })) });
  m1 = await owner("metrics.metric.create", { datahub_id: dhId, metric: { name: "Tổng số", source: t1, measure: { agg: "sum", field: "Số" } } });
  m2 = await owner("metrics.metric.create", { datahub_id: dhId, metric: { name: "Tổng tiền", source: t2, measure: { agg: "sum", field: "Tiền" } } });
  m12 = await owner("metrics.metric.create", { datahub_id: dhId, metric: { name: "Ghép", source: { table: t1, joins: [{ table: t2, as: "Hai", on: [{ left: "Mã", right: "Mã" }] }] }, measure: { agg: "sum", field: "Hai.Tiền" } } });
}, 60_000);
afterAll(async () => {
  await t.close();
});

const value = (r: { rows: { value: number }[] }) => r.rows[0]!.value;
const denied = async (p: Promise<unknown>) => expect(["forbidden", "not_found"]).toContain((await fails(p)).code);

describe("the owner", () => {
  it("computes, lists, reads, updates (with the version) and deletes", async () => {
    expect(value(await owner("metrics.query", { metric_id: m1.id }))).toBe(60);
    expect(value(await owner("metrics.query", { metric_id: m12.id }))).toBe(6);
    expect((await owner("metrics.metric.list", { datahub_id: dhId })).items.map((m: { name: string }) => m.name)).toEqual(["Ghép", "Tổng số", "Tổng tiền"]);
    const up = await owner("metrics.metric.update", { metric_id: m1.id, version: m1.version, metric: { name: "Tổng số", source: t1, measure: { agg: "avg", field: "Số" } } });
    expect(up.version).toBe(m1.version + 1);
    expect(value(await owner("metrics.query", { metric_id: m1.id }))).toBe(20);
    expect((await fails(owner("metrics.metric.update", { metric_id: m1.id, version: m1.version, metric: { name: "Tổng số", source: t1, measure: { agg: "count" } } }))).code).toBe("conflict");
    m1.version = up.version;
    const tmp = await owner("metrics.metric.create", { datahub_id: dhId, metric: { name: "Tạm", source: t1, measure: { agg: "count" } } });
    expect((await fails(owner("metrics.metric.create", { datahub_id: dhId, metric: { name: " tạm ", source: t1, measure: { agg: "count" } } }))).code).toBe("conflict");
    await owner("metrics.metric.delete", { metric_id: tmp.id });
    expect((await fails(owner("metrics.metric.get", { metric_id: tmp.id }))).code).toBe("not_found");
    expect((await owner("metrics.metric.list", { datahub_id: dhId })).items.map((m: { name: string }) => m.name)).not.toContain("Tạm");
    // The name is free again.
    await owner("metrics.metric.create", { datahub_id: dhId, metric: { name: "Tạm", source: t1, measure: { agg: "count" } } });
  });

  it("writes an audit entry for each change without any row value", async () => {
    const res = await t.c.db.db.execute(sql`SELECT command, target_type, details FROM audit_log WHERE command LIKE 'metrics.%' AND result = 'success' AND actor_user_id = ${org.userA1.id}::uuid`);
    expect(res.rows.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(res.rows)).not.toContain("K1");
  });
});

describe("a person given the whole datahub", () => {
  let viewer: ReturnType<typeof as>;
  beforeAll(async () => {
    viewer = as(t, org.userA2.id);
    await owner("datahub.share.set", { datahub_id: dhId, grantee_id: org.userA2.id, permission: "view" });
  });
  it("reads the same numbers, lists and gets definitions", async () => {
    expect(value(await viewer("metrics.query", { metric_id: m2.id }))).toBe(6);
    expect(value(await viewer("metrics.query", { metric_id: m12.id }))).toBe(6);
    expect(value(await viewer("metrics.query", { metric: { name: "x", source: t1, measure: { agg: "max", field: "Số" } } }))).toBe(30);
    expect((await viewer("metrics.metric.list", { datahub_id: dhId })).items).toHaveLength(4);
    expect((await viewer("metrics.metric.get", { metric_id: m2.id })).definition).toMatchObject({ name: "Tổng tiền" });
  });
  it("cannot create, change or delete anything", async () => {
    const m = { name: "Của tôi", source: t1, measure: { agg: "count" } };
    expect((await fails(viewer("metrics.metric.create", { datahub_id: dhId, metric: m }))).code).toBe("forbidden");
    expect((await fails(viewer("metrics.metric.update", { metric_id: m2.id, version: 1, metric: m }))).code).toBe("forbidden");
    expect((await fails(viewer("metrics.metric.delete", { metric_id: m2.id }))).code).toBe("forbidden");
    expect((await fails(viewer("metrics.source.create", { datahub_id: dhId, source: { name: "s", table: t1 } }))).code).toBe("forbidden");
    // Even with "edit data" the structure stays with the owner.
    await owner("datahub.share.set", { datahub_id: dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    expect((await fails(viewer("metrics.metric.create", { datahub_id: dhId, metric: m }))).code).toBe("forbidden");
  });
});

describe("a person given only one table", () => {
  let one: ReturnType<typeof as>;
  beforeAll(async () => {
    one = as(t, org.userB1.id);
    await owner("datahub.share.set", { datahub_id: dhId, grantee_id: org.userB1.id, table_id: t1, permission: "view" });
  });
  it("sees only the definitions that read tables they may read, and computes only on those", async () => {
    const list = await one("metrics.metric.list", { datahub_id: dhId });
    expect(list.items.map((m: { name: string }) => m.name)).toEqual(["Tạm", "Tổng số"]);
    expect(value(await one("metrics.query", { metric_id: m1.id }))).toBe(20);
    expect((await fails(one("metrics.query", { metric_id: m2.id }))).code).toBe("not_found");
    expect((await fails(one("metrics.metric.get", { metric_id: m12.id }))).code).toBe("not_found");
    expect((await fails(one("metrics.query", { metric: { name: "x", source: t2, measure: { agg: "count" } } }))).code).toBe("not_found");
  });
  it("cannot reach the other table through a join", async () => {
    const e = await fails(one("metrics.query", { metric: { name: "x", source: { table: t1, joins: [{ table: t2, on: [{ left: "Mã", right: "Mã" }] }] }, measure: { agg: "count" } } }));
    expect(e.code).toBe("not_found");
    expect(e.details.reason).toBe("join_table_not_found");
  });
});

describe("everyone else gets nothing", () => {
  const m = { name: "x", source: "", measure: { agg: "count" } };
  // userA2 and userB1 hold shares from the tests above, so everyone is tried on a datahub nobody was given.
  let priv: Awaited<ReturnType<typeof makeTable>>;
  let pm: { id: string };
  beforeAll(async () => {
    priv = await makeTable(owner, { name: "Riêng tư", columns: [{ name: "Số", type: "number" }] });
    await owner("datahub.row.create", { table_id: priv.tableId, data: { Số: 5 } });
    pm = await owner("metrics.metric.create", { datahub_id: priv.dhId, metric: { name: "Riêng", source: priv.tableId, measure: { agg: "sum", field: "Số" } } });
  });
  it.each([
    ["a user of another tree", () => org.userA2.id],
    ["the Leader of the owner", () => org.leaderA.id],
    ["the Manager of the owner", () => org.mgrA.id],
    ["a user of another Manager", () => org.userB1.id],
    ["an Admin", () => org.admin.id],
    ["a Guest", () => org.guestData.id],
    ["a sale Guest", () => org.guestSale.id],
  ])("%s", async (_n, who) => {
    const u = as(t, who());
    await denied(u("metrics.query", { metric_id: pm.id }));
    await denied(u("metrics.query", { metric: { ...m, source: priv.tableId } }));
    await denied(u("metrics.metric.get", { metric_id: pm.id }));
    await denied(u("metrics.metric.list", { datahub_id: priv.dhId }));
    await denied(u("metrics.metric.create", { datahub_id: priv.dhId, metric: { ...m, source: priv.tableId } }));
    await denied(u("metrics.metric.delete", { metric_id: pm.id }));
    await denied(u("metrics.source.diagnose", { source: { table: priv.tableId } }));
    await denied(u("metrics.source.unmatched", { source: { table: priv.tableId } }));
  });

  it("a trashed table or datahub cannot be computed", async () => {
    const x = await makeTable(owner, { name: "Sắp xoá", columns: [{ name: "Số", type: "number" }] });
    await owner("datahub.row.create", { table_id: x.tableId, data: { Số: 1 } });
    const mm = await owner("metrics.metric.create", { datahub_id: x.dhId, metric: { name: "A", source: x.tableId, measure: { agg: "count" } } });
    expect(value(await owner("metrics.query", { metric_id: mm.id }))).toBe(1);
    await owner("datahub.datahub.delete", { datahub_id: x.dhId });
    expect((await fails(owner("metrics.query", { metric_id: mm.id }))).code).toBe("not_found");
  });
});
