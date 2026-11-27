import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** 12G-1: a screen cuts a list to one linked row ("Xem com" of a deal) with a server filter, so a line past the first page is never missing. */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userB1]) await unlimit(t, p.id);
  owner = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

describe("filter on a relation column", () => {
  it("finds the lines of one linked row beyond the first 500, with and without a second condition; refuses outsiders", async () => {
    const cust = await makeTable(owner, { name: "Khách", columns: [{ name: "Tên khách", type: "text" }] });
    const c1 = await owner("datahub.row.create", { table_id: cust.tableId, data: { "Tên khách": "A" } });
    const c2 = await owner("datahub.row.create", { table_id: cust.tableId, data: { "Tên khách": "B" } });
    const orders = await owner("datahub.table.create", { datahub_id: cust.dhId, name: "Sổ" });
    const link = await owner("datahub.column.create", { table_id: orders.id, name: "Khách", type: "relation", config: { target_table_id: cust.tableId } });
    await owner("datahub.column.create", { table_id: orders.id, name: "Ghi chú", type: "text" });
    const ops = Array.from({ length: 620 }, (_, i) => ({ op: "create", data: { "Ghi chú": i === 619 ? "cuối" : "x", Khách: [i === 619 ? c2.id : c1.id] } }));
    for (let i = 0; i < ops.length; i += 200) await owner("datahub.row.batch", { table_id: orders.id, ops: ops.slice(i, i + 200) });

    const first = await owner("datahub.row.list", { table_id: orders.id, limit: 500 });
    expect(first.items.length).toBe(500);
    const only = await owner("datahub.row.list", { table_id: orders.id, limit: 500, filter: JSON.stringify({ field: link.key, op: "eq", value: c2.id }) });
    expect(only.items.length).toBe(1);
    expect(Object.values(only.items[0].data)).toContain("cuối");
    const both = await owner("datahub.row.list", { table_id: orders.id, limit: 500, filter: JSON.stringify({ and: [{ field: link.key, op: "eq", value: c2.id }, { field: "Ghi chú", op: "eq", value: "x" }] }) });
    expect(both.items.length).toBe(0);
    const all1 = await owner("datahub.row.list", { table_id: orders.id, limit: 500, filter: JSON.stringify({ field: link.key, op: "eq", value: c1.id }) });
    expect(all1.items.length).toBe(500);
    expect(all1.nextCursor).toBeTruthy();
    expect((await fails(as(t, org.userB1.id)("datahub.row.list", { table_id: orders.id, filter: JSON.stringify({ field: link.key, op: "eq", value: c2.id }) }))).code).toBe("not_found");
  });
});
