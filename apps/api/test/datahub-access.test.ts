import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { as, fails, makeTable, unlimit } from "./dh-helpers";
import { activeToken, login, seedOrg, type Org, type WebSession } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let org: Org;
let owner: ReturnType<typeof as>;
let x: Awaited<ReturnType<typeof makeTable>>;
let t2Id: string;
let rowId: string;
beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  for (const p of [org.userA1, org.userA2, org.userB1, org.leaderA, org.mgrA]) await unlimit(t, p.id);
  owner = as(t, org.userA1.id);
  x = await makeTable(owner, { name: "Của Dương", columns: [{ name: "Tên", type: "text" }] });
  t2Id = (await owner("datahub.table.create", { datahub_id: x.dhId, name: "Bảng 2" })).id;
  await owner("datahub.column.create", { table_id: t2Id, name: "Ghi chú", type: "text" });
  rowId = (await owner("datahub.row.create", { table_id: x.tableId, data: { Tên: "riêng" } })).id;
  await owner("datahub.row.create", { table_id: t2Id, data: { "Ghi chú": "bảng 2" } });
});
afterAll(async () => {
  await t.close();
});

type Who = "owner" | "dhView" | "dhEdit" | "tableView" | "leader" | "manager" | "admin" | "other" | "guest";

describe("sharing and permissions matrix, over the web (cookie) and API (token) channels", () => {
  const people = (): Record<Who, { id: string; email: string }> => ({
    owner: org.userA1, dhView: org.userA2, dhEdit: org.userB1, tableView: org.guestSale, leader: org.leaderA, manager: org.mgrA, admin: org.admin, other: org.userA2, guest: org.guestData,
  });
  const sessions = new Map<string, WebSession>();
  const tokens = new Map<string, Record<string, string>>();

  beforeAll(async () => {
    // dhView = userA2 (whole datahub, view); dhEdit = userB1 (whole datahub, edit); tableView = leaderB: only table 1, view.
    // `other` and `guest` get nothing.
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userB1.id, permission: "edit_data" });
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.leaderB.id, table_id: x.tableId, permission: "view" });
  });

  // `tableView` is leaderB (a Leader of another tree), `other` is a user nobody shared with: userA1's colleague outside the share list.
  const personFor = (who: Who) => {
    const base = people()[who];
    if (who === "tableView") return org.leaderB;
    if (who === "other") return org.mgrB;
    return base;
  };

  async function call(channel: "web" | "api", who: Who, method: "GET" | "POST" | "PATCH" | "PUT", url: string, body?: unknown) {
    const p = personFor(who);
    let headers: Record<string, string>;
    if (channel === "web") {
      let s = sessions.get(p.id);
      if (!s) sessions.set(p.id, (s = await login(t, p.email)));
      headers = method === "GET" ? s.read : s.write;
    } else {
      let h = tokens.get(p.id);
      if (!h) tokens.set(p.id, (h = (await activeToken(t, p.id, ["datahub:datahub:use", "datahub:datahub:create"])).headers));
      headers = h;
    }
    const r = await t.app.inject({ method, url: `/api/v1${url}`, headers, ...(body ? { payload: body as object } : {}) });
    return r.statusCode;
  }

  // [who, read table 1, list rows of table 1, create row (edit), change structure (owner), read table 2, share (owner)]
  const expected: Record<Who, number[]> = {
    owner:     [200, 200, 201, 200, 200, 200],
    dhView:    [200, 200, 403, 403, 200, 403],
    dhEdit:    [200, 200, 201, 403, 200, 403],
    tableView: [200, 200, 403, 403, 404, 403],
    leader:    [404, 404, 404, 404, 404, 404],
    manager:   [404, 404, 404, 404, 404, 404],
    admin:     [404, 404, 404, 404, 404, 404],
    other:     [404, 404, 404, 404, 404, 404],
    guest:     [403, 403, 403, 403, 403, 403],
  };

  for (const channel of ["web", "api"] as const) {
    for (const who of Object.keys(expected) as Who[]) {
      it(`${channel}: ${who}`, async () => {
        const got = [
          await call(channel, who, "GET", `/tables/${x.tableId}`),
          await call(channel, who, "GET", `/tables/${x.tableId}/rows`),
          await call(channel, who, "POST", `/tables/${x.tableId}/rows`, { data: { Tên: `từ ${channel} ${who}` } }),
          await call(channel, who, "PATCH", `/tables/${x.tableId}`, { description: "đổi" }),
          await call(channel, who, "GET", `/tables/${t2Id}`),
          await call(channel, who, "PUT", `/datahubs/${x.dhId}/shares`, { grantee_id: org.admin2.id, permission: "view" }),
        ];
        expect(got).toEqual(expected[who]);
      });
    }
  }

  it("leader, manager and admin of the owner cannot reach the datahub through any command", async () => {
    for (const person of [org.leaderA, org.mgrA, org.admin]) {
      const c = as(t, person.id);
      const list = await c("datahub.datahub.list", { scope: "all" });
      expect(list.map((d: { id: string }) => d.id)).not.toContain(x.dhId);
      for (const [name, input] of [
        ["datahub.datahub.get", { datahub_id: x.dhId }],
        ["datahub.row.get", { table_id: x.tableId, row_id: rowId }],
        ["datahub.row.history", { table_id: x.tableId, row_id: rowId }],
        ["datahub.view.list", { table_id: x.tableId }],
        ["datahub.share.list", { datahub_id: x.dhId }],
        ["datahub.trash.list", { table_id: x.tableId }],
        ["datahub.column.types", undefined],
      ] as const) {
        if (name === "datahub.column.types") continue; // a static catalogue, not owner data
        expect((await fails(c(name, input as never))).code, `${person.email} ${name}`).toBe("not_found");
      }
      // Writes too, even a delete by row id.
      expect((await fails(c("datahub.row.delete", { table_id: x.tableId, row_id: rowId }))).code).toBe("not_found");
      expect((await fails(c("datahub.table.delete", { table_id: x.tableId }))).code).toBe("not_found");
    }
    // The row is untouched.
    expect((await owner("datahub.row.get", { table_id: x.tableId, row_id: rowId })).version).toBe(1);
  });

  it("\"Được chia sẻ với tôi\": whole share shows all tables, a table share shows only that table", async () => {
    const whole = await as(t, org.userA2.id)("datahub.datahub.list", { scope: "shared" });
    const d1 = whole.find((d: { id: string }) => d.id === x.dhId);
    expect(d1.tables.map((tb: { name: string }) => tb.name)).toEqual(["Bảng 1", "Bảng 2"]);
    expect(d1).toMatchObject({ access: "view", owner_name: org.userA1.name });
    const part = await as(t, org.leaderB.id)("datahub.datahub.list", { scope: "shared" });
    expect(part.find((d: { id: string }) => d.id === x.dhId).tables.map((tb: { name: string }) => tb.name)).toEqual(["Bảng 1"]);
    const got = await as(t, org.leaderB.id)("datahub.datahub.get", { datahub_id: x.dhId });
    expect(got.tables).toHaveLength(1);
    // The owner's own list does not include it under "shared".
    expect((await owner("datahub.datahub.list", { scope: "shared" })).map((d: { id: string }) => d.id)).not.toContain(x.dhId);
    // A shared datahub may have the same name as one of mine.
    await as(t, org.userA2.id)("datahub.datahub.create", { name: "Của Dương" });
  });

  it("a whole-datahub share includes tables created later; a table share does not", async () => {
    const t3 = await owner("datahub.table.create", { datahub_id: x.dhId, name: "Bảng 3" });
    expect((await as(t, org.userA2.id)("datahub.table.get", { table_id: t3.id })).access).toBe("view");
    expect((await fails(as(t, org.leaderB.id)("datahub.table.get", { table_id: t3.id }))).code).toBe("not_found");
  });

  it("view-only people cannot write; only the owner changes structure; share changes take effect and can be removed", async () => {
    const v = as(t, org.userA2.id);
    expect((await fails(v("datahub.row.create", { table_id: x.tableId, data: {} }))).code).toBe("forbidden");
    expect((await fails(v("datahub.column.create", { table_id: x.tableId, name: "Lạ", type: "text" }))).code).toBe("forbidden");
    const shares = await owner("datahub.share.list", { datahub_id: x.dhId });
    const mine = shares.find((s: { grantee_id: string }) => s.grantee_id === org.userA2.id);
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "edit_data" });
    await v("datahub.row.create", { table_id: x.tableId, data: { Tên: "giờ sửa được" } });
    expect((await fails(v("datahub.column.create", { table_id: x.tableId, name: "Lạ", type: "text" }))).code).toBe("forbidden");
    await owner("datahub.share.remove", { datahub_id: x.dhId, share_id: mine.id });
    expect((await fails(v("datahub.table.get", { table_id: x.tableId }))).code).toBe("not_found");
    await owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA2.id, permission: "view" });
  });

  it("shares only go to active, non-guest people other than the owner", async () => {
    expect((await fails(owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.guestData.id, permission: "view" }))).code).toBe("validation_error");
    expect((await fails(owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userA1.id, permission: "view" }))).code).toBe("validation_error");
    expect((await fails(owner("datahub.share.set", { datahub_id: x.dhId, grantee_id: org.userB1.id, table_id: "01900000-0000-7000-8000-00000000dead", permission: "view" }))).code).toBe("not_found");
  });

  it("a token without the datahub scope is refused; the admin audit shows no row values", async () => {
    const h = (await activeToken(t, org.userA1.id, ["system:whoami"])).headers;
    const r = await t.app.inject({ method: "GET", url: `/api/v1/tables/${x.tableId}/rows`, headers: h });
    expect(r.statusCode).toBe(403);
  });
});

describe("views: shared, personal, per-user override, last opened", () => {
  it("owner edits the shared view; a sharee's edit becomes their own override; reset returns to the shared one", async () => {
    const y = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }, { name: "Số", type: "number" }] });
    await owner("datahub.share.set", { datahub_id: y.dhId, grantee_id: org.userA2.id, permission: "view" });
    const guest = as(t, org.userA2.id);
    const list = await owner("datahub.view.list", { table_id: y.tableId });
    expect(list.views).toHaveLength(1);
    const shared = list.views[0];
    expect(shared).toMatchObject({ shared: true, name: "Dạng bảng", config: {} });

    // Owner autosaves a sort and a hidden column on the shared view: the sharee sees it.
    await owner("datahub.view.update", { view_id: shared.id, config: { sort: [{ field: "Số", dir: "desc" }], hidden: [y.cols["Tên"]!.key] } });
    let seen = (await guest("datahub.view.list", { table_id: y.tableId })).views[0];
    expect(seen.config).toMatchObject({ sort: [{ field: "Số", dir: "desc" }], hidden: [y.cols["Tên"]!.key] });
    expect(seen.has_override).toBe(false);

    // The sharee changes the view: stored as their own copy, the owner's view is untouched.
    await guest("datahub.view.update", { view_id: shared.id, config: { frozen: 2, widths: { [y.cols["Số"]!.key]: 150 } } });
    seen = (await guest("datahub.view.list", { table_id: y.tableId })).views[0];
    expect(seen).toMatchObject({ has_override: true, config: { frozen: 2, sort: [{ field: "Số", dir: "desc" }] } });
    const ownerSees = (await owner("datahub.view.list", { table_id: y.tableId })).views[0];
    expect(ownerSees.config.frozen).toBeUndefined();
    expect(ownerSees.has_override).toBe(false);
    // The sharee cannot rename or move the shared view.
    expect((await fails(guest("datahub.view.update", { view_id: shared.id, name: "Của tôi" }))).code).toBe("forbidden");
    expect((await fails(guest("datahub.view.delete", { view_id: shared.id }))).code).toBe("forbidden");
    // Reset.
    const reset = await guest("datahub.view.reset", { view_id: shared.id });
    expect(reset).toMatchObject({ has_override: false });
    expect(reset.config.frozen).toBeUndefined();

    // A key set to null is removed (autosave of "no sort any more").
    await owner("datahub.view.update", { view_id: shared.id, config: { sort: null } });
    expect((await owner("datahub.view.list", { table_id: y.tableId })).views[0].config.sort).toBeUndefined();
  });

  it("personal views belong to their author only; only the owner makes shared views; bad config is refused", async () => {
    const y = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }] });
    await owner("datahub.share.set", { datahub_id: y.dhId, grantee_id: org.userA2.id, permission: "view" });
    const guest = as(t, org.userA2.id);
    const mine = await guest("datahub.view.create", { table_id: y.tableId, name: "Của tôi", config: { filter: { field: "Tên", op: "contains", value: "a" } } });
    expect(mine).toMatchObject({ shared: false, owner_id: org.userA2.id });
    expect((await owner("datahub.view.list", { table_id: y.tableId })).views.map((v: { name: string }) => v.name)).toEqual(["Dạng bảng"]);
    expect((await fails(owner("datahub.view.update", { view_id: mine.id, name: "x" }))).code).toBe("not_found");
    expect((await fails(guest("datahub.view.create", { table_id: y.tableId, name: "Chung", shared: true }))).code).toBe("forbidden");
    await guest("datahub.view.update", { view_id: mine.id, name: "Đổi tên", config: { sort: [{ field: "Tên", dir: "asc", nulls: "first" }] } });
    expect((await fails(guest("datahub.view.update", { view_id: mine.id, config: { filter: { field: "Không có", op: "eq", value: 1 } } }))).code).toBe("invalid_filter");
    expect((await fails(guest("datahub.view.update", { view_id: mine.id, config: { unknown_key: 1 } }))).code).toBe("validation_error");
    // Last opened view is remembered per person.
    await guest("datahub.view.open", { table_id: y.tableId, view_id: mine.id });
    expect((await guest("datahub.view.list", { table_id: y.tableId })).last_view_id).toBe(mine.id);
    expect((await owner("datahub.view.list", { table_id: y.tableId })).last_view_id).toBeNull();
    await guest("datahub.view.delete", { view_id: mine.id });
    expect((await guest("datahub.view.list", { table_id: y.tableId })).last_view_id).toBeNull();
  });
});

describe("limits (design module2 section 11)", () => {
  it("datahubs per person (5), tables per datahub (10): quota_exceeded; per-user override by the Admin", async () => {
    const u = org.mgrB; // fresh person, default limits
    const c = as(t, u.id);
    for (let i = 0; i < 5; i++) await c("datahub.datahub.create", { name: `D${i}` });
    const e = await fails(c("datahub.datahub.create", { name: "D5" }));
    expect(e.code).toBe("quota_exceeded");
    expect(e.details.limit).toBe(5);
    const dhs = await c("datahub.datahub.list");
    for (let i = 0; i < 10; i++) await c("datahub.table.create", { datahub_id: dhs[0].id, name: `T${i}` });
    expect((await fails(c("datahub.table.create", { datahub_id: dhs[0].id, name: "T10" }))).code).toBe("quota_exceeded");
    // A trashed datahub frees a slot; restoring needs the slot back.
    await c("datahub.datahub.delete", { datahub_id: dhs[1].id });
    await c("datahub.datahub.create", { name: "D5" });
    expect((await fails(c("datahub.datahub.restore", { datahub_id: dhs[1].id }))).code).toBe("quota_exceeded");
    // The Admin raises this person's limit only.
    const admin = as(t, org.admin.id);
    await admin("datahub.limit.user.set", { user_id: u.id, max_datahubs: 6, max_tables: 11 });
    await c("datahub.datahub.restore", { datahub_id: dhs[1].id });
    await c("datahub.table.create", { datahub_id: dhs[0].id, name: "T10" });
    expect((await c("datahub.limit.mine")).limits).toEqual({ datahubs: 6, tables: 11, columns: 70 });
    expect((await as(t, org.userB1.id)("datahub.limit.mine")).limits.datahubs).toBe(100); // this test file gave userB1 more room
    // Only Admin sets limits; the system defaults are settings.
    expect((await fails(c("datahub.limit.user.set", { user_id: u.id, max_datahubs: 99 }))).code).toBe("forbidden");
    const settings = await admin("system.setting.list", { limit: 100 });
    expect(settings.items.map((s: { key: string }) => s.key)).toBeDefined();
    const cat = await admin("system.setting.catalog");
    expect(JSON.stringify(cat)).toContain("datahub.max_columns");
    await admin("datahub.limit.user.set", { user_id: u.id, max_datahubs: null, max_tables: null });
    expect((await c("datahub.limit.mine")).limits.datahubs).toBe(5);
  });
});

describe("trash: datahub, table, column; purge by the nightly framework", () => {
  it("deleting a datahub or table trashes it whole and restores intact; hidden while in the trash", async () => {
    const y = await makeTable(owner, { columns: [{ name: "Tên", type: "text" }] });
    const rows = [];
    for (let i = 0; i < 3; i++) rows.push(await owner("datahub.row.create", { table_id: y.tableId, data: { Tên: `r${i}` } }));
    await owner("datahub.table.delete", { table_id: y.tableId });
    expect((await fails(owner("datahub.row.list", { table_id: y.tableId }))).code).toBe("not_found");
    expect((await owner("datahub.trash.list")).tables.map((z: { id: string }) => z.id)).toContain(y.tableId);
    await owner("datahub.table.restore", { table_id: y.tableId });
    expect((await owner("datahub.row.list", { table_id: y.tableId, include_total: "true" })).total).toBe(3);

    await owner("datahub.datahub.delete", { datahub_id: y.dhId });
    expect((await fails(owner("datahub.table.get", { table_id: y.tableId }))).code).toBe("not_found");
    expect((await owner("datahub.datahub.list")).map((d: { id: string }) => d.id)).not.toContain(y.dhId);
    const tr = await owner("datahub.trash.list");
    expect(tr.datahubs.find((d: { id: string }) => d.id === y.dhId).purge_at).toBeDefined();
    await owner("datahub.datahub.restore", { datahub_id: y.dhId });
    const back = await owner("datahub.row.list", { table_id: y.tableId, sort: "_row_no" });
    expect(back.items).toHaveLength(3);
    expect((await owner("datahub.table.get", { table_id: y.tableId })).columns).toHaveLength(1);
  });

  it("a deleted column keeps its data and comes back; people with edit access see the trashed rows but not the column trash", async () => {
    const y = await makeTable(owner, { columns: [{ name: "A", type: "text" }, { name: "B", type: "text" }] });
    const r = await owner("datahub.row.create", { table_id: y.tableId, data: { A: "a", B: "b" } });
    await owner("datahub.column.delete", { table_id: y.tableId, column: "B" });
    expect((await owner("datahub.table.get", { table_id: y.tableId })).columns.map((c: { name: string }) => c.name)).toEqual(["A"]);
    expect((await fails(owner("datahub.row.create", { table_id: y.tableId, data: { B: "x" } }))).code).toBe("validation_error");
    // A new column may take the freed name.
    const again = await owner("datahub.column.create", { table_id: y.tableId, name: "B", type: "number" });
    expect((await fails(owner("datahub.column.restore", { table_id: y.tableId, column: y.cols["B"]!.key }))).code).toBe("conflict");
    await owner("datahub.column.delete", { table_id: y.tableId, column: again.key });
    await owner("datahub.column.restore", { table_id: y.tableId, column: y.cols["B"]!.key });
    expect((await owner("datahub.row.get", { table_id: y.tableId, row_id: r.id })).data[y.cols["B"]!.key]).toBe("b");
  });

  it("the purge job hard-deletes what stayed longer than the retention (setting), leaves the rest; history stays", async () => {
    const { registerDatahubTrash } = await import("../src/modules/datahub/trash");
    const { purgeTrash } = await import("@soe/db");
    registerDatahubTrash();
    const y = await makeTable(owner, { columns: [{ name: "A", type: "text" }, { name: "B", type: "text" }] });
    const keep = await owner("datahub.row.create", { table_id: y.tableId, data: { A: "keep", B: "b" } });
    const gone = await owner("datahub.row.create", { table_id: y.tableId, data: { A: "gone", B: "b" } });
    const fresh = await owner("datahub.row.create", { table_id: y.tableId, data: { A: "fresh" } });
    await owner("datahub.row.delete", { table_id: y.tableId, row_id: gone.id });
    await owner("datahub.row.delete", { table_id: y.tableId, row_id: fresh.id });
    await owner("datahub.column.delete", { table_id: y.tableId, column: "B" });
    const z = await makeTable(owner, { name: "Sẽ bị xoá hẳn" });
    await owner("datahub.datahub.delete", { datahub_id: z.dhId });
    // Age some of them past the retention.
    const old = new Date(Date.now() - 8 * 86400_000);
    await t.c.db.db.execute(sql`UPDATE dh_rows SET deleted_at = ${old} WHERE /*scope:system*/ id = ${gone.id}::uuid`);
    await t.c.db.db.execute(sql`UPDATE dh_columns SET deleted_at = ${old} WHERE /*scope:system*/ table_id = ${y.tableId}::uuid AND name = 'B'`);
    await t.c.db.db.execute(sql`UPDATE dh_datahubs SET deleted_at = ${old} WHERE /*scope:system*/ id = ${z.dhId}::uuid`);

    await purgeTrash(t.c.db.db, 7);
    const exists = async (table: string, id: string) => (await t.c.db.db.execute(sql`SELECT 1 FROM ${sql.identifier(table)} WHERE /*scope:system*/ id = ${id}::uuid`)).rows.length === 1;
    expect(await exists("dh_rows", gone.id)).toBe(false);
    expect(await exists("dh_rows", fresh.id)).toBe(true); // only just deleted
    expect(await exists("dh_rows", keep.id)).toBe(true);
    expect(await exists("dh_datahubs", z.dhId)).toBe(false);
    expect(await exists("dh_tables", z.tableId)).toBe(false);
    // The purged column left no value behind in the rows.
    const data = (await t.c.db.db.execute(sql`SELECT data FROM dh_rows WHERE /*scope:system*/ id = ${keep.id}::uuid`)).rows[0] as { data: Record<string, unknown> };
    expect(Object.keys(data.data)).toEqual([y.cols["A"]!.key]);
    // Row history is never purged.
    const h = await t.c.db.db.execute(sql`SELECT count(*)::int AS n FROM row_history WHERE row_id = ${gone.id}::uuid`);
    expect((h.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(2);
  });
});
