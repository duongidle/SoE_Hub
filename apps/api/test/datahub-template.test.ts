import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notifications, orgMemberships } from "@soe/db";
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
