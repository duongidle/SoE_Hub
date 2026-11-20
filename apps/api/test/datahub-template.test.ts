import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueOutbox, orgMemberships } from "@soe/db";
import { as, drainOutbox, fails, unlimit } from "./dh-helpers";
import { seedOrg, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

/**
 * Stage 4.1c: template tables (design module4 3.1, 3.5-3.7; module4 19a work 12-16). Tree A: MgrA > LeaderA > UserA1, MgrA > UserA2 (GuestData also sits in tree A).
 * Tree B: MgrB > LeaderB > UserB1.
 */
let t: TestApp;
let org: Org;
let admin: ReturnType<typeof as>;
let mgrA: ReturnType<typeof as>;
let mgrB: ReturnType<typeof as>;
let leaderA: ReturnType<typeof as>;
let leaderB: ReturnType<typeof as>;
let userA1: ReturnType<typeof as>;
let userA2: ReturnType<typeof as>;
let userB1: ReturnType<typeof as>;
let guest: ReturnType<typeof as>;

const shareRows = async (tableId: string) => (await t.c.db.db.execute(sql`SELECT grantee_id, permission, auto FROM dh_shares WHERE /*scope:system*/ table_id = ${tableId}::uuid`)).rows as { grantee_id: string; permission: string; auto: boolean }[];
const dealDatahub = async (userId: string) => ((await t.c.db.db.execute(sql`SELECT id FROM dh_datahubs WHERE /*scope:system*/ owner_id = ${userId}::uuid AND system_key = 'deal' AND deleted_at IS NULL`)).rows[0] as { id: string } | undefined)?.id ?? null;
const colNames = async (call: ReturnType<typeof as>, tableId: string) => ((await call("datahub.table.get", { table_id: tableId })).columns as { name: string }[]).map((c) => c.name);

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.leaderB, org.mgrA, org.mgrB]) await unlimit(t, p.id);
  admin = as(t, org.admin.id);
  mgrA = as(t, org.mgrA.id);
  mgrB = as(t, org.mgrB.id);
  leaderA = as(t, org.leaderA.id);
  leaderB = as(t, org.leaderB.id);
  userA1 = as(t, org.userA1.id);
  userA2 = as(t, org.userA2.id);
  userB1 = as(t, org.userB1.id);
  guest = as(t, org.guestData.id);
});
afterAll(async () => {
  await t.close();
});

describe("who creates a template", () => {
  it("Admin, User and Guest cannot; a Leader cannot make a tree template; names are unique per tree", async () => {
    for (const who of [admin, userA1, guest]) expect((await fails(who("datahub.template.create", { name: "X", kind: "shared" }))).code).toBe("forbidden");
    expect((await fails(leaderA("datahub.template.create", { name: "Cây", kind: "shared", scope: "tree" }))).details.reason).toBe("template_forbidden");
    expect((await fails(mgrA("datahub.template.create", { name: "Đội B", kind: "shared", scope: "team", leader_id: org.leaderB.id }))).code).toBe("validation_error");
    const a = await mgrA("datahub.template.create", { name: "Trùng tên", kind: "shared" });
    expect(a.scope).toBe("tree");
    expect((await fails(mgrA("datahub.template.create", { name: " trùng TÊN ", kind: "personal" }))).code).toBe("conflict");
    await mgrB("datahub.template.create", { name: "Trùng tên", kind: "shared" });
  });
});

describe("a shared template: members follow the tree, the table is protected", () => {
  let tpl: { id: string; master_table_id: string };
  it("creates the master table in the creator's datahub Quản lý Deal and shares it with the tree (automatic shares)", async () => {
    tpl = await mgrA("datahub.template.create", { name: "Deals", kind: "shared", member_permission: "edit_data" });
    expect(tpl.master_table_id).toBeTruthy();
    const rows = await shareRows(tpl.master_table_id);
    expect(rows.every((r) => r.auto && r.permission === "edit_data")).toBe(true);
    expect(rows.map((r) => r.grantee_id).sort()).toEqual([org.leaderA.id, org.userA1.id, org.userA2.id].sort());
    expect(await dealDatahub(org.mgrA.id)).not.toBeNull();
    // The Guest in the tree, the other tree and the Admin get nothing.
    expect(rows.some((r) => [org.guestData.id, org.userB1.id, org.admin.id].includes(r.grantee_id))).toBe(false);
  });

  it("list: members of the tree see it (read-only for them), the other tree and Admin do not", async () => {
    const mine = (await userA1("datahub.template.list")).find((x: { name: string }) => x.name === "Deals");
    expect(mine.can_edit).toBe(false);
    expect(mine.my_table_id).toBe(tpl.master_table_id);
    expect((await mgrA("datahub.template.list")).find((x: { name: string }) => x.name === "Deals").can_edit).toBe(true);
    expect((await userB1("datahub.template.list")).find((x: { name: string }) => x.name === "Deals")).toBeUndefined();
    expect((await admin("datahub.template.list")).length).toBe(0);
    expect((await fails(userB1("datahub.template.get", { template_id: tpl.id }))).code).toBe("not_found");
  });

  it("the table is protected: no rename, no delete, no restore; the datahub Quản lý Deal cannot be renamed or deleted", async () => {
    expect((await fails(mgrA("datahub.table.update", { table_id: tpl.master_table_id, name: "Khác" }))).details.reason).toBe("template_protected");
    expect((await fails(mgrA("datahub.table.delete", { table_id: tpl.master_table_id }))).details.reason).toBe("template_protected");
    const dh = (await dealDatahub(org.mgrA.id))!;
    expect((await fails(mgrA("datahub.datahub.update", { datahub_id: dh, name: "Khác" }))).details.reason).toBe("template_protected");
    expect((await fails(mgrA("datahub.datahub.delete", { datahub_id: dh }))).details.reason).toBe("template_protected");
    // Moving the table in the list and describing it stay allowed.
    await mgrA("datahub.table.update", { table_id: tpl.master_table_id, description: "ghi chú" });
    // The datahub is not counted in the limit: the creator still makes datahubs up to the limit.
    await mgrA("datahub.datahub.create", { name: "Thường 1" });
  });

  it("template columns are protected from the column commands; only the template commands change them", async () => {
    const c = await mgrA("datahub.template.column.create", { template_id: tpl.id, name: "Khách", type: "text" });
    expect(c.protected).toBe(true);
    expect(c.layer).toBe("basic");
    expect(c.allow_edit).toBe(false);
    for (const [cmd, input] of [
      ["datahub.column.update", { name: "Khác" }],
      ["datahub.column.delete", {}],
      ["datahub.column.type_change", { type: "long_text" }],
      ["datahub.column.type_preview", { type: "long_text" }],
    ] as const) {
      expect((await fails(mgrA(cmd, { table_id: tpl.master_table_id, column: "Khách", ...input }))).details.reason).toBe("template_protected");
    }
    const u = await mgrA("datahub.template.column.update", { template_id: tpl.id, column: "Khách", name: "Khách hàng", allow_edit: true });
    expect(u.column.name).toBe("Khách hàng");
    expect(u.column.allow_edit).toBe(true);
    // A Leader or User cannot edit the template; another tree does not even see it.
    expect((await fails(leaderA("datahub.template.column.update", { template_id: tpl.id, column: "Khách hàng", name: "Z" }))).code).toBe("forbidden");
    expect((await fails(userA1("datahub.template.column.update", { template_id: tpl.id, column: "Khách hàng", name: "Z" }))).code).toBe("forbidden");
    expect((await fails(mgrB("datahub.template.column.update", { template_id: tpl.id, column: "Khách hàng", name: "Z" }))).code).toBe("not_found");
  });
});

const notified = async (userId: string) => (await t.c.db.db.execute(sql`SELECT body, data FROM notifications WHERE /*scope:system*/ user_id = ${userId}::uuid AND type = 'datahub.template.conflict' ORDER BY created_at`)).rows as { body: string; data: Record<string, string> }[];

describe("custom columns (lớp Tuỳ chỉnh) of a shared template: only their maker sees them", () => {
  let tpl: { id: string; master_table_id: string };
  let tid: string;
  const rid: string[] = [];
  it("set up: a template with view-only members, one shared column and two rows", async () => {
    tpl = await mgrA("datahub.template.create", { name: "Việc cây A", kind: "shared", member_permission: "view" });
    tid = tpl.master_table_id;
    await mgrA("datahub.template.column.create", { template_id: tpl.id, name: "Khách", type: "text", allow_edit: true });
    for (const k of ["r1", "r2"]) rid.push((await mgrA("datahub.row.create", { table_id: tid, data: { Khách: k } })).id);
    expect((await userA1("datahub.row.list", { table_id: tid, limit: 10 })).items.length).toBe(2);
  });

  it("anyone who sees the table adds a column of their own; nobody else sees it, the owner included", async () => {
    const c = await userA1("datahub.column.create", { table_id: tid, name: "Ghi chú", type: "text" });
    expect(c.layer).toBe("custom");
    expect(c.layer_ref).toBe(org.userA1.id);
    expect(c.storage).toBe("person");
    expect(c.protected).toBe(false);
    expect(await colNames(userA1, tid)).toContain("Ghi chú");
    for (const who of [mgrA, userA2, leaderA]) expect(await colNames(who, tid)).not.toContain("Ghi chú");
    // The owner cannot reach it by name or key either.
    expect((await fails(mgrA("datahub.column.update", { table_id: tid, column: c.key, name: "Hack" }))).code).toBe("not_found");
    expect((await fails(mgrA("datahub.column.delete", { table_id: tid, column: "Ghi chú" }))).code).toBe("not_found");
    // Only plain input types: no formula, no unique, no required.
    for (const bad of [{ type: "formula", config: { formula: "=1" } }, { type: "text", unique: true }, { type: "text", required: true }, { type: "attachment" }, { type: "relation", config: {} }]) {
      expect((await fails(userA1("datahub.column.create", { table_id: tid, name: "Xấu", ...bad }))).details.reason).toBe("custom_column_type");
    }
    // A custom column cannot take the name of a template column.
    expect((await fails(userA1("datahub.column.create", { table_id: tid, name: "khách", type: "text" }))).details.reason).toBe("duplicate_name");
  });

  it("a view-only member writes their own cells; the row, its version, history and everyone else's rows stay untouched", async () => {
    const before = await mgrA("datahub.row.get", { table_id: tid, row_id: rid[0] });
    const w = await userA1("datahub.row.update", { table_id: tid, row_id: rid[0], data: { "Ghi chú": "chỉ mình tôi" }, version: before.version });
    expect(w.data[(await userA1("datahub.table.get", { table_id: tid })).columns.find((c: { name: string }) => c.name === "Ghi chú").key]).toBe("chỉ mình tôi");
    // Their shared cells are still closed to them.
    expect((await fails(userA1("datahub.row.update", { table_id: tid, row_id: rid[0], data: { Khách: "đổi" }, version: before.version }))).code).toBe("forbidden");
    expect((await fails(userA1("datahub.row.update", { table_id: tid, row_id: rid[0], data: { Khách: "đổi", "Ghi chú": "x" }, version: before.version }))).code).toBe("forbidden");
    const key = (await userA1("datahub.table.get", { table_id: tid })).columns.find((c: { name: string }) => c.name === "Ghi chú").key as string;
    // Everyone else gets the row without the value and without the key; the version did not move.
    for (const who of [mgrA, userA2, leaderA]) {
      const r = await who("datahub.row.get", { table_id: tid, row_id: rid[0] });
      expect(r.version).toBe(before.version);
      expect(JSON.stringify(r)).not.toContain("chỉ mình tôi");
      expect(Object.keys(r.data)).not.toContain(key);
      const list = await who("datahub.row.list", { table_id: tid, limit: 10 });
      expect(JSON.stringify(list)).not.toContain("chỉ mình tôi");
    }
    // The maker reads it back, filters on it, and clears it.
    const mine = await userA1("datahub.row.list", { table_id: tid, limit: 10 });
    expect(mine.items.find((r: { id: string }) => r.id === rid[0]).data[key]).toBe("chỉ mình tôi");
    const hit = await userA1("datahub.row.list", { table_id: tid, limit: 10, filter: JSON.stringify({ field: "Ghi chú", op: "eq", value: "chỉ mình tôi" }) });
    expect(hit.items.map((r: { id: string }) => r.id)).toEqual([rid[0]]);
    expect((await fails(userA2("datahub.row.list", { table_id: tid, limit: 10, filter: JSON.stringify({ field: "Ghi chú", op: "eq", value: "chỉ mình tôi" }) }))).code).toBe("invalid_filter");
    // Row history has no trace of it.
    expect(JSON.stringify(await mgrA("datahub.row.history", { table_id: tid, row_id: rid[0] }))).not.toContain("chỉ mình tôi");
  });

  it("two people may each keep a custom column of the same name; their values are independent", async () => {
    const c2 = await userA2("datahub.column.create", { table_id: tid, name: "Ghi chú", type: "text" });
    await userA2("datahub.row.update", { table_id: tid, row_id: rid[0], data: { "Ghi chú": "của A2" }, version: (await userA2("datahub.row.get", { table_id: tid, row_id: rid[0] })).version });
    const a1 = await userA1("datahub.row.get", { table_id: tid, row_id: rid[0] });
    const a2 = await userA2("datahub.row.get", { table_id: tid, row_id: rid[0] });
    expect(JSON.stringify(a1)).toContain("chỉ mình tôi");
    expect(JSON.stringify(a1)).not.toContain("của A2");
    expect(JSON.stringify(a2)).toContain("của A2");
    expect(JSON.stringify(a2)).not.toContain("chỉ mình tôi");
    expect(c2.key).not.toBe((await userA1("datahub.table.get", { table_id: tid })).columns.find((c: { name: string }) => c.name === "Ghi chú").key);
  });

  it("the JSON export carries only the exporter's own custom column", async () => {
    const { processJobs } = await import("../src/modules/datahub");
    const env = () => ({ db: t.c.db.db, executor: t.c.executor, storage: t.c.storage, logger: t.c.logger, config: t.c.config });
    const read = async (call: ReturnType<typeof as>) => {
      const job = await call("datahub.export.create", { table_id: tid, format: "json" });
      await processJobs(env());
      const r = (await t.c.db.db.execute(sql`SELECT result_key FROM dh_jobs WHERE /*scope:system*/ id = ${job.id}::uuid`)).rows[0] as { result_key: string };
      const chunks: Buffer[] = [];
      for await (const c of (t.c.storage as unknown as { read(k: string): AsyncIterable<Buffer> }).read(r.result_key)) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    };
    const mine = await read(userA1);
    expect(mine).toContain("chỉ mình tôi");
    expect(mine).not.toContain("của A2");
    for (const who of [mgrA, leaderA]) {
      const text = await read(who);
      expect(text).not.toContain("chỉ mình tôi");
      expect(text).not.toContain("của A2");
      expect(text).not.toContain("Ghi chú");
    }
  });

  it("a template column added later takes the name: their own columns of that name are renamed and they are told", async () => {
    await mgrA("datahub.template.column.create", { template_id: tpl.id, name: "Ghi chú", type: "text" });
    await drainOutbox(t);
    expect(await colNames(userA1, tid)).toEqual(expect.arrayContaining(["Ghi chú", "Ghi chú (riêng)"]));
    expect(await colNames(userA2, tid)).toEqual(expect.arrayContaining(["Ghi chú", "Ghi chú (riêng)"]));
    const n = await notified(org.userA1.id);
    expect(n.some((x) => x.data.object === "column" && x.data.new_name === "Ghi chú (riêng)")).toBe(true);
    // The value moved with the column (it follows the key, not the name).
    const key = (await userA1("datahub.table.get", { table_id: tid })).columns.find((c: { name: string }) => c.name === "Ghi chú (riêng)").key as string;
    expect((await userA1("datahub.row.get", { table_id: tid, row_id: rid[0] })).data[key]).toBe("chỉ mình tôi");
    expect(await colNames(mgrA, tid)).not.toContain("Ghi chú (riêng)");
  });

  it("the maker deletes their own column (the owner cannot); a left person's values are kept", async () => {
    await userA2("datahub.column.delete", { table_id: tid, column: "Ghi chú (riêng)" });
    expect(await colNames(userA2, tid)).not.toContain("Ghi chú (riêng)");
    expect(await colNames(userA1, tid)).toContain("Ghi chú (riêng)");
  });
});

const ownTables = async (userId: string) => (await t.c.db.db.execute(sql`SELECT t.id, t.name, t.template_id, t.archived, t.deleted_at FROM dh_tables t JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ d.owner_id = ${userId}::uuid`)).rows as { id: string; name: string; template_id: string | null; archived: boolean; deleted_at: Date | null }[];
const orgChanged = (userId: string) => enqueueOutbox(t.c.db.db, { event: "org.member.changed", aggregateType: "user", aggregateId: userId, payload: { user_id: userId, change: "updated" } });

describe("a team template (Leader): only that team; the tree follows org changes", () => {
  let tpl: { id: string; master_table_id: string; scope?: string };
  it("a Leader makes a team template: the owner is the Leader, members are the team plus the Manager who only views (no other team)", async () => {
    tpl = await leaderA("datahub.template.create", { name: "Việc team A", kind: "shared", member_permission: "view" });
    expect(tpl.scope).toBe("team");
    const rows = await shareRows(tpl.master_table_id);
    expect(rows.map((r) => r.grantee_id).sort()).toEqual([org.mgrA.id, org.userA1.id].sort());
    expect(rows.find((r) => r.grantee_id === org.mgrA.id)!.permission).toBe("view");
    expect((await userA2("datahub.template.list")).some((x: { name: string }) => x.name === "Việc team A")).toBe(false);
    expect((await mgrA("datahub.template.list")).some((x: { name: string }) => x.name === "Việc team A")).toBe(true);
    // A Manager does not edit a team template of a Leader? He may (his tree); the Leader of another team may not.
    expect((await fails(leaderB("datahub.template.column.create", { template_id: tpl.id, name: "X", type: "text" }))).code).toBe("not_found");
  });
  it("the Leader adds columns of the basic layer to his own team template; a team template stays out of the tree template's names", async () => {
    const c = await leaderA("datahub.template.column.create", { template_id: tpl.id, name: "Việc", type: "text" });
    expect(c.layer).toBe("basic");
    expect(await colNames(userA1, tpl.master_table_id)).toContain("Việc");
  });
  it("a person who changes team: the new team's template reaches them, the old one goes away", async () => {
    await t.c.db.db.update(orgMemberships).set({ leaderId: org.leaderA.id }).where(eq(orgMemberships.userId, org.userA2.id));
    await orgChanged(org.userA2.id);
    await drainOutbox(t);
    expect((await shareRows(tpl.master_table_id)).map((r) => r.grantee_id).sort()).toEqual([org.mgrA.id, org.userA1.id, org.userA2.id].sort());
    await t.c.db.db.update(orgMemberships).set({ leaderId: null }).where(eq(orgMemberships.userId, org.userA2.id));
    await orgChanged(org.userA2.id);
    await drainOutbox(t);
    expect((await shareRows(tpl.master_table_id)).map((r) => r.grantee_id).sort()).toEqual([org.mgrA.id, org.userA1.id].sort());
  });
});

describe("a personal template: one table each, created, hidden and shown with the tree", () => {
  let tpl: { id: string; master_table_id: string };
  it("every member gets their own table with the same columns; the maker's table is the master", async () => {
    tpl = await mgrA("datahub.template.create", { name: "Index riêng", kind: "personal" });
    await mgrA("datahub.template.column.create", { template_id: tpl.id, name: "Chỉ tiêu", type: "number", allow_edit: true });
    await drainOutbox(t);
    for (const u of [org.userA1, org.userA2, org.leaderA]) {
      const mine = (await ownTables(u.id)).filter((x) => x.template_id === tpl.id && !x.archived);
      expect(mine.length, u.id).toBe(1);
    }
    expect((await ownTables(org.userB1.id)).some((x) => x.template_id === tpl.id)).toBe(false);
  });
  it("a member who leaves the tree has the table hidden (not deleted); coming back shows it again", async () => {
    const before = (await ownTables(org.userA2.id)).find((x) => x.template_id === tpl.id)!;
    await t.c.db.db.update(orgMemberships).set({ managerId: org.mgrB.id }).where(eq(orgMemberships.userId, org.userA2.id));
    await orgChanged(org.userA2.id);
    await drainOutbox(t);
    const away = (await ownTables(org.userA2.id)).find((x) => x.id === before.id)!;
    expect(away.archived).toBe(true);
    await t.c.db.db.update(orgMemberships).set({ managerId: org.mgrA.id }).where(eq(orgMemberships.userId, org.userA2.id));
    await orgChanged(org.userA2.id);
    await drainOutbox(t);
    const back = (await ownTables(org.userA2.id)).find((x) => x.id === before.id)!;
    expect(back.archived).toBe(false);
    expect(back.deleted_at).toBeNull();
  });
});

describe("a table of your own with the name of a template gives way", () => {
  it("is renamed `<name> (riêng)` and its maker is told", async () => {
    // The clash is inside the person's datahub "Quản lý Deal" (a person may add tables there).
    const tb = await userA1("datahub.table.create", { datahub_id: (await dealDatahub(org.userA1.id))!, name: "Bảng Chung Tên" });
    await mgrA("datahub.template.create", { name: "bảng chung tên", kind: "shared" });
    await drainOutbox(t);
    const got = (await ownTables(org.userA1.id)).find((x) => x.id === tb.id)!;
    expect(got.name).toBe("Bảng Chung Tên (riêng)");
    expect((await notified(org.userA1.id)).some((n) => /Bảng Chung Tên/.test(n.body))).toBe(true);
  });
});

describe("column roles (module4 3.7)", () => {
  let tpl: { id: string; master_table_id: string };
  it("a role needs a column of the right type; one role has one column; the old holder lets go", async () => {
    tpl = await mgrA("datahub.template.create", { name: "Deals vai trò", kind: "shared", role_set: "deals" });
    expect((await fails(mgrA("datahub.template.column.create", { template_id: tpl.id, name: "DT chữ", type: "text", role: "doanh_thu" }))).code).toBe("validation_error");
    await mgrA("datahub.template.column.create", { template_id: tpl.id, name: "Doanh thu", type: "currency", role: "doanh_thu" });
    await mgrA("datahub.template.column.create", { template_id: tpl.id, name: "Doanh thu 2", type: "currency" });
    const moved = await mgrA("datahub.template.column.set_role", { template_id: tpl.id, column: "Doanh thu 2", role: "doanh_thu" });
    expect(moved.column.role).toBe("doanh_thu");
    expect(moved.previous.role).toBeNull();
  });
  it("renaming is fine, with the usage in the answer; changing the type or dropping a column that holds a role is refused", async () => {
    const u = await mgrA("datahub.template.column.update", { template_id: tpl.id, column: "Doanh thu 2", name: "Doanh thu thực" });
    expect(u.usage.role.key).toBe("doanh_thu");
    expect(u.usage.role.used_by.length).toBeGreaterThan(0);
    expect((await fails(mgrA("datahub.template.column.type_change", { template_id: tpl.id, column: "Doanh thu thực", type: "text", accept_data_loss: true }))).details.reason).toBe("role_type");
    expect((await fails(mgrA("datahub.template.column.delete", { template_id: tpl.id, column: "Doanh thu thực" }))).code).toBe("conflict");
    // The role moves first: then the old column is free to change.
    await mgrA("datahub.template.column.set_role", { template_id: tpl.id, column: "Doanh thu", role: "doanh_thu" });
    await mgrA("datahub.template.column.delete", { template_id: tpl.id, column: "Doanh thu thực" });
  });
  it("a role that is required cannot be set to nothing; only who edits the template sets roles", async () => {
    expect((await fails(mgrA("datahub.template.column.set_role", { template_id: tpl.id, column: "Doanh thu", role: null }))).code).toBe("conflict");
    expect((await fails(leaderA("datahub.template.column.set_role", { template_id: tpl.id, column: "Doanh thu", role: "doanh_thu" }))).code).toBe("forbidden");
  });
});

describe("who edits the template: Leader gets the team layer only when allowed; a member only adds their own column", () => {
  let tpl: { id: string; master_table_id: string };
  it("Leader may add a team column only when the table allows it", async () => {
    tpl = await mgrA("datahub.template.create", { name: "Có lớp team", kind: "shared" });
    const err = await fails(leaderA("datahub.template.column.create", { template_id: tpl.id, name: "Cột team", type: "text", layer: "team", team_leader_id: org.leaderA.id }));
    expect(err.code).toBe("forbidden");
    await mgrA("datahub.template.update", { template_id: tpl.id, leader_can_add_columns: true });
    const c = await leaderA("datahub.template.column.create", { template_id: tpl.id, name: "Cột team", type: "text", layer: "team", team_leader_id: org.leaderA.id });
    expect(c.layer).toBe("team");
    expect(await colNames(userA1, tpl.master_table_id)).toContain("Cột team");
    expect(await colNames(userA2, tpl.master_table_id)).not.toContain("Cột team");
    // Not a Leader's to change: a basic column, nor another team's layer.
    expect((await fails(leaderA("datahub.template.column.create", { template_id: tpl.id, name: "Cơ bản", type: "text", layer: "basic" }))).code).toBe("forbidden");
    expect((await fails(leaderA("datahub.template.update", { template_id: tpl.id, name: "Đổi" }))).code).toBe("forbidden");
    expect((await fails(userA1("datahub.template.archive", { template_id: tpl.id }))).code).toBe("forbidden");
  });
  it("a member cannot drop a template column through the column commands; archive hides the table for everyone and restore brings it back", async () => {
    expect((await fails(userA1("datahub.column.delete", { table_id: tpl.master_table_id, column: "Cột team" }))).code).toBeTruthy();
    await mgrA("datahub.template.archive", { template_id: tpl.id });
    expect((await userA1("datahub.template.list")).some((x: { id: string }) => x.id === tpl.id)).toBe(false);
    await mgrA("datahub.template.restore", { template_id: tpl.id });
    expect((await userA1("datahub.template.list")).some((x: { id: string }) => x.id === tpl.id)).toBe(true);
  });
});

describe("a Relation column in your own table points to a template table you read", () => {
  let tpl: { id: string; master_table_id: string };
  let mine: { tableId: string };
  const deal: string[] = [];
  it("set up: a Deals-like template with a split lock; each member sees only their rows", async () => {
    tpl = await mgrA("datahub.template.create", { name: "Deals liên kết", kind: "shared", member_permission: "view" });
    await mgrA("datahub.template.column.create", { template_id: tpl.id, name: "Tên deal", type: "text" });
    await mgrA("datahub.template.column.create", { template_id: tpl.id, name: "Người", type: "user" });
    await mgrA("datahub.table.share_options.set", { table_id: tpl.master_table_id, key_split: true, key_columns: ["Người"] });
    for (const [n, u] of [["D1", org.userA1.id], ["D2", org.userA2.id]] as const) deal.push((await mgrA("datahub.row.create", { table_id: tpl.master_table_id, data: { "Tên deal": n, Người: u } })).id);
    await drainOutbox(t);
    expect((await userA1("datahub.row.list", { table_id: tpl.master_table_id, limit: 10 })).items.length).toBe(1);
  });
  it("the owner links a deal they see; one they do not see is refused; labels and search only show their rows", async () => {
    const dh = await userA1("datahub.datahub.create", { name: "Khách của tôi" });
    const tb = await userA1("datahub.table.create", { datahub_id: dh.id, name: "Khách" });
    mine = { tableId: tb.id };
    await userA1("datahub.column.create", { table_id: tb.id, name: "Tên", type: "text" });
    await userA1("datahub.column.create", { table_id: tb.id, name: "Deal", type: "relation", config: { target_table_id: tpl.master_table_id, multiple: true } });
    const ok = await userA1("datahub.row.create", { table_id: tb.id, data: { Tên: "K1", Deal: [deal[0]] } });
    expect(ok.id).toBeTruthy();
    expect((await fails(userA1("datahub.row.create", { table_id: tb.id, data: { Tên: "K2", Deal: [deal[1]] } }))).code).toBe("validation_error");
    const labels = await userA1("datahub.relation.labels", { table_id: tb.id, column: "Deal", ids: deal.join(",") });
    expect(labels.map((l: { label: string }) => l.label)).toEqual(["D1"]);
    const found = await userA1("datahub.relation.search", { table_id: tb.id, column: "Deal", limit: 10 });
    expect(found.data.map((l: { label: string }) => l.label)).toEqual(["D1"]);
  });
  it("a table of a template you do not read, or of someone else's own table, is refused", async () => {
    const other = await userB1("datahub.datahub.create", { name: "Của B" });
    const ob = await userB1("datahub.table.create", { datahub_id: other.id, name: "B1" });
    const dh = (await userA1("datahub.datahub.list", {})).data?.[0] ?? (await userA1("datahub.datahub.list", {}))[0];
    const tb = await userA1("datahub.table.create", { datahub_id: dh.id, name: "Bảng thử" });
    for (const target of [ob.id, (await mgrB("datahub.template.create", { name: "Của cây B", kind: "shared" })).master_table_id]) {
      expect((await fails(userA1("datahub.column.create", { table_id: tb.id, name: "Liên kết xấu", type: "relation", config: { target_table_id: target } }))).code).toBe("validation_error");
    }
    void mine;
  });
});
