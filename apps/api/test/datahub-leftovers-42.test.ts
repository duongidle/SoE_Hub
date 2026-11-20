import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/** Stage 4.2 part 5: what 4.1 left for the Deals step (progress.md "Việc phải làm trong bước dựng Deals"). */
let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let mgrA: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  owner = as(t, org.userA2.id);
  mgrA = as(t, org.mgrA.id);
  leaderA = as(t, org.leaderA.id);
  userA1 = as(t, org.userA1.id);
});
afterAll(async () => {
  await t.close();
});

describe("can_edit per row (the grid locks the cells the server would refuse)", () => {
  it("a Leader reads a team member's row read-only until the member allows it; the Manager and the person edit; the owner has no flag", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }, { name: "Phụ trách", type: "user" }] });
    for (const [p, perm] of [[org.mgrA, "edit_data"], [org.leaderA, "edit_data"], [org.userA1, "edit_data"]] as const) await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: p.id, permission: perm });
    await owner("datahub.table.share_options.set", { table_id: x.tableId, key_split: true, key_columns: ["Phụ trách"] });
    await owner("datahub.column.update", { table_id: x.tableId, column: "Tên", allow_edit: true });
    const own = await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "a", "Phụ trách": org.userA1.id } });
    const leaders = await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "b", "Phụ trách": org.leaderA.id } });
    await drainOutbox(t);
    const flags = async (call: ReturnType<typeof as>) => Object.fromEntries(((await call("datahub.row.list", { table_id: x.tableId, limit: 10 })).items as { id: string; can_edit?: boolean }[]).map((r) => [r.id, r.can_edit]));
    let l = await flags(leaderA);
    expect(l[own.id]).toBe(false);
    expect(l[leaders.id]).toBe(true);
    expect((await fails(leaderA("datahub.row.update", { table_id: x.tableId, row_id: own.id, version: 1, data: { Tên: "z" } }))).details.reason).toBe("row_not_editable");
    expect((await flags(userA1))[own.id]).toBe(true);
    expect((await flags(mgrA))[own.id]).toBe(true);
    expect(Object.values(await flags(owner)).every((v) => v === undefined)).toBe(true);
    // The person lets their Leader edit: the flag follows, and so does the server.
    await userA1("datahub.prefs.set", { leader_can_edit: true });
    l = await flags(leaderA);
    expect(l[own.id]).toBe(true);
    const got = await leaderA("datahub.row.get", { table_id: x.tableId, row_id: own.id });
    expect(got.can_edit).toBe(true);
    await leaderA("datahub.row.update", { table_id: x.tableId, row_id: own.id, version: got.version, data: { Tên: "z" } });
    await userA1("datahub.prefs.set", { leader_can_edit: false });
  });
});

describe('deleting a column that "Ngày sửa của cột" watches', () => {
  it("leaves the tracker's list; refused, with the trackers named, when it is the last watched column", async () => {
    const x = await makeTable(owner, { columns: [{ name: "Status", type: "text" }, { name: "Ghi", type: "text" }] });
    const tr = await owner("datahub.column.create", { table_id: x.tableId, name: "Đổi", type: "field_modified", config: { watch: ["Status", "Ghi"] } });
    await owner("datahub.column.delete", { table_id: x.tableId, column: "Ghi" });
    const cols = (await owner("datahub.table.get", { table_id: x.tableId })).columns as { name: string; config: { watch?: string[] } }[];
    expect(cols.find((c) => c.name === "Đổi")!.config.watch).toEqual([x.cols["Status"]!.key]);
    const e = await fails(owner("datahub.column.delete", { table_id: x.tableId, column: "Status" }));
    expect(e.code).toBe("conflict");
    expect(e.details.reason).toBe("watched_by_tracker");
    expect(e.details.trackers).toEqual([{ id: tr.id, name: "Đổi" }]);
    // Free it by deleting the tracker first.
    await owner("datahub.column.delete", { table_id: x.tableId, column: "Đổi" });
    await owner("datahub.column.delete", { table_id: x.tableId, column: "Status" });
  });
});

describe('refilling "Ngày sửa của cột" from the history recomputes the formulas that read it', () => {
  it("the dates the refill writes reach the formula that reads the tracker", async () => {
    const x = await makeTable(owner, { columns: [{ name: "A", type: "text" }, { name: "B", type: "text" }] });
    // The row never had a B: a tracker on B stays empty; the formula says so.
    const r = await owner("datahub.row.create", { table_id: x.tableId, data: { A: "1" } });
    const tr = await owner("datahub.column.create", { table_id: x.tableId, name: "Đổi", type: "field_modified", config: { watch: ["B"] } });
    const f = await owner("datahub.column.create", { table_id: x.tableId, name: "Có đổi", type: "formula", config: { formula: '=IF([Đổi]="","chưa","rồi")', result_type: "text" } });
    await drainOutbox(t);
    expect((await owner("datahub.row.get", { table_id: x.tableId, row_id: r.id })).data[f.key]).toBe("chưa");
    // Watching A instead refills the tracker from the history (A was written when the row was made): the formula must follow, with no edit of the row.
    await owner("datahub.column.update", { table_id: x.tableId, column: tr.key, config: { watch: ["A"] } });
    await drainOutbox(t);
    const got = await owner("datahub.row.get", { table_id: x.tableId, row_id: r.id });
    expect(got.data[tr.key]).toBeTruthy();
    expect(got.data[f.key]).toBe("rồi");
    expect(got.version).toBe(1); // a system refill: no new version
  });
});
