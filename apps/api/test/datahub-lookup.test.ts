import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1]) await unlimit(t, p.id);
  owner = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

describe("datahub.people.lookup", () => {
  it("resolves ids to names, finds people by name without accents, and refuses bad ids", async () => {
    const byId = await owner("datahub.people.lookup", { ids: `${org.userA2.id},${org.userA1.id}` });
    expect(byId.map((p: { id: string }) => p.id).sort()).toEqual([org.userA1.id, org.userA2.id].sort());
    expect(byId[0]).toHaveProperty("full_name");
    const first = (await owner("datahub.people.lookup", { ids: org.userA2.id }))[0] as { full_name: string };
    // The test database is shared with other test files, so search by the whole name (upper case) to stay inside the 20 results.
    const byName = await owner("datahub.people.lookup", { q: first.full_name.toUpperCase(), limit: 50 });
    expect(byName.some((p: { id: string }) => p.id === org.userA2.id)).toBe(true);
    expect(await owner("datahub.people.lookup", {})).toEqual([]);
    expect((await fails(owner("datahub.people.lookup", { ids: "không-phải-uuid" }))).code).toBe("validation_error");
  });
});

describe("datahub.people.lookup: card fields and teams", () => {
  it("returns status, and roles and team only for people inside the viewer's org tree", async () => {
    const rows = (await owner("datahub.people.lookup", { ids: [org.leaderA.id, org.userB1.id, org.userA2.id].join(",") })) as { id: string; email: string | null; status: string; roles: string[] | null; team: string | null; team_id: string | null }[];
    const by = (id: string) => rows.find((r) => r.id === id)!;
    // Tree A (the viewer's): role and team visible; a Leader is their own team.
    expect(by(org.leaderA.id)).toMatchObject({ status: "active", roles: ["leader"], team_id: org.leaderA.id, team: org.leaderA.name });
    expect(by(org.userA2.id)).toMatchObject({ roles: ["user"], team_id: null, team: null }); // directly under the Manager: no team
    // Tree B: email as before, but no role or team.
    expect(by(org.userB1.id)).toMatchObject({ email: org.userB1.email, status: "active", roles: null, team_id: null, team: null });
    const inB = as(t, org.userB1.id);
    const seen = (await inB("datahub.people.lookup", { ids: org.userA1.id })) as { team: string | null; roles: string[] | null }[];
    expect(seen[0]).toMatchObject({ roles: null, team: null });
    const asAdmin = (await as(t, org.admin.id)("datahub.people.lookup", { ids: org.userB1.id })) as { team: string | null; roles: string[] | null }[];
    expect(asAdmin[0]).toMatchObject({ roles: ["user"], team: org.leaderB.name });
  });

  it("team_id returns the whole team inside the viewer's tree; teams lists them", async () => {
    const mine = (await owner("datahub.people.lookup", { team_id: org.leaderA.id })) as { id: string; team_id: string }[];
    expect(mine.map((p) => p.id).sort()).toEqual([org.leaderA.id, org.userA1.id].sort());
    expect(mine.every((p) => p.team_id === org.leaderA.id)).toBe(true);
    expect(await owner("datahub.people.lookup", { team_id: org.leaderB.id })).toEqual([]); // another tree: nothing
    const teams = (await owner("datahub.people.teams", {})) as { id: string; name: string; member_count: number }[];
    expect(teams).toEqual([{ id: org.leaderA.id, name: org.leaderA.name, member_count: 2 }]);
    const all = (await as(t, org.admin.id)("datahub.people.teams", {})) as { id: string }[];
    expect(all.map((x) => x.id)).toEqual(expect.arrayContaining([org.leaderA.id, org.leaderB.id]));
    expect((await fails(owner("datahub.people.lookup", { team_id: "không-phải-uuid" }))).code).toBe("validation_error");
  });

  it("with table_id, team_id keeps only the owner and members of the table", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Ai", type: "user" }] });
    const only = (await owner("datahub.people.lookup", { team_id: org.leaderA.id, table_id: x.tableId })) as { id: string }[];
    expect(only.map((p) => p.id)).toEqual([org.userA1.id]); // the owner; the Leader is not a member yet
  });

  it("Guest cannot look people up at all", async () => {
    expect((await fails(as(t, org.guestSale.id)("datahub.people.lookup", { ids: org.userA1.id }))).code).toBe("forbidden");
    expect((await fails(as(t, org.guestSale.id)("datahub.people.teams", {}))).code).toBe("forbidden");
  });
});

describe("datahub.relation.labels", () => {
  it("returns the first text column of the target row, or #row_no; hides it from people without access", async () => {
    const cust = await makeTable(owner, { name: "Khách hàng", columns: [{ name: "Tên khách", type: "text" }] });
    const ord = await makeTable(owner, { name: "Đơn" });
    const c1 = await owner("datahub.row.create", { table_id: cust.tableId, data: { "Tên khách": "Công ty Thuận Phát" } });
    const c2 = await owner("datahub.row.create", { table_id: cust.tableId, data: {} });
    // Same datahub required: put the order table beside the customers.
    const orders = await owner("datahub.table.create", { datahub_id: cust.dhId, name: "Đơn hàng" });
    const link = await owner("datahub.column.create", { table_id: orders.id, name: "Khách", type: "relation", config: { target_table_id: cust.tableId } });
    void ord;
    const labels = await owner("datahub.relation.labels", { table_id: orders.id, column: link.key, ids: `${c1.id},${c2.id}` });
    const byId = Object.fromEntries(labels.map((l: { id: string; label: string }) => [l.id, l.label]));
    expect(byId[c1.id]).toBe("Công ty Thuận Phát");
    expect(byId[c2.id]).toBe(`#${c2.row_no}`);
    // Not a relation column.
    expect((await fails(owner("datahub.relation.labels", { table_id: cust.tableId, column: "Tên khách", ids: c1.id }))).code).toBe("validation_error");
    // A person with no share cannot read it; a viewer can.
    const other = as(t, org.userB1.id);
    expect((await fails(other("datahub.relation.labels", { table_id: orders.id, column: link.key, ids: c1.id }))).code).toBe("not_found");
    await owner("datahub.share.set", { datahub_id: cust.dhId, grantee_id: org.userA2.id, permission: "view" });
    const viewer = as(t, org.userA2.id);
    expect((await viewer("datahub.relation.labels", { table_id: orders.id, column: link.key, ids: c1.id }))[0].label).toBe("Công ty Thuận Phát");
  });
});

describe("datahub.row.restore_batch", () => {
  it("restores many rows in one call; needs edit permission; unknown rows fail the whole call", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }] });
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: `R${i}` } }));
    const ops = rows.map((r) => ({ op: "delete", id: r.id }));
    await owner("datahub.row.batch", { table_id: x.tableId, ops });
    expect((await owner("datahub.row.list", { table_id: x.tableId })).items).toHaveLength(0);
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    expect((await fails(as(t, org.userA2.id)("datahub.row.restore_batch", { table_id: x.tableId, row_ids: rows.map((r) => r.id) }))).code).toBe("forbidden");
    expect((await fails(as(t, org.userB1.id)("datahub.row.restore_batch", { table_id: x.tableId, row_ids: rows.map((r) => r.id) }))).code).toBe("not_found");
    const res = await owner("datahub.row.restore_batch", { table_id: x.tableId, row_ids: rows.map((r) => r.id) });
    expect(res.rows).toHaveLength(3);
    expect(res.seq).toBeGreaterThan(0);
    expect((await owner("datahub.table.get", { table_id: x.tableId })).row_count).toBe(3);
    expect((await fails(owner("datahub.row.restore_batch", { table_id: x.tableId, row_ids: [rows[0].id] }))).code).toBe("not_found");
  });
});
