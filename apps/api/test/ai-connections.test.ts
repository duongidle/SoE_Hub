import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeToken, login, seedOrg, setAiPolicy, type Org, type WebSession } from "./fixtures";
import { actorOf, as, drainOutbox, fails, makeTable, unlimit } from "./dh-helpers";
import { makeApp, type TestApp } from "./helpers";
import { BUILTIN_DEFAULT_SET, ensureTreeTemplates } from "../src/modules/deal";
import { workerEmit } from "../src/modules/datahub/template-sync";
import { AI_GROUPS, resolveAiPolicy } from "../src/core/ai-policy";

/**
 * Stage 5A1: connections (design module5 2, 3, 5, 12). Who may do what through a personal token or `/mcp`:
 * owner's permission ∩ menus and level of the connection ∩ Admin's policy ∩ the operation's own flags.
 * Invented data only. Tree A: MgrA > LeaderA > UserA1.
 */
let t: TestApp;
let org: Org;
let adm: WebSession;
let mgrA: ReturnType<typeof as>;
let dealTable: string;
let dealDatahub: string;
type Menus = Record<string, "read" | "write" | "full">;

/** A connection (active personal token) of one person and a caller that goes through the executor with it. */
async function conn(userId: string, menus: Menus, o: { via?: "api" | "mcp"; status?: "pending" | "active"; name?: string } = {}) {
  const tk = await activeToken(t, userId, [], { menus, ...(o.status ? { status: o.status } : {}), ...(o.name ? { name: o.name } : {}) });
  const actor = { ...actorOf(userId, o.via ?? "mcp"), connectionId: tk.id, connectionKind: "personal" as const, connectionName: o.name ?? "test" };
  const call = async (name: string, input: Record<string, unknown> = {}) => (await t.c.executor.execute(name, input, { actor, requestId: randomUUID() })).result as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { tk, call };
}

beforeAll(async () => {
  t = await makeApp();
  org = await seedOrg(t);
  adm = await login(t, org.admin.email);
  for (const p of [org.userA1, org.leaderA, org.mgrA, org.admin]) await unlimit(t, p.id);
  mgrA = as(t, org.mgrA.id);
  await ensureTreeTemplates(t.c.db.db, workerEmit(t.c.db.db), org.mgrA.id);
  await drainOutbox(t);
  const deals = (await mgrA("datahub.template.list")).find((x: { name: string }) => x.name === BUILTIN_DEFAULT_SET[0]!.name);
  dealTable = deals.master_table_id;
  const r = await t.c.db.db.execute(sql`/*scope:system*/ SELECT datahub_id FROM dh_tables WHERE id = ${dealTable}::uuid`);
  dealDatahub = (r.rows[0] as { datahub_id: string }).datahub_id;
});
afterAll(async () => {
  await setAiPolicy(t, adm, { groups: [], killed: false });
  await t.close();
});

describe("every operation declares what a connection may do (module5 3.5)", () => {
  it("an operation open to AI has a menu and a level; the hard ones are closed", () => {
    for (const op of t.c.registry.list()) {
      if (op.aiAllowed) expect(op.ai, `${op.name} thiếu menu/access cho kết nối`).not.toBeNull();
      if (op.aiAllowed && op.ai!.forbidden !== "hard") {
        expect(["deal", "datahub", "form", "knowledge", "aihub", "workspace", "onboarding", "notify", "feedback", "admin", "none", "by_target"]).toContain(op.ai!.menu);
        if (op.kind === "query") expect(op.ai!.access, op.name).toBe("read");
      }
      if (op.ai?.forbidden && op.ai.forbidden !== "hard") expect(AI_GROUPS).toContain(op.ai.forbidden);
    }
    // A made-up operation with no rule is closed, and the test above would flag it if it were AI-allowed.
    expect(resolveAiPolicy({ name: "zzz.thing.get", kind: "query", aiAllowed: true })).toBeNull();
    const byName = (n: string) => t.c.registry.get(n)!;
    for (const n of ["auth.token.create", "auth.token.approve", "auth.password.change", "auth.session.revoke", "auth.service_account.create"]) expect(byName(n).ai?.forbidden, n).toBe("hard");
    // Big operations are web only for now (module5 section 12, "Dời" 3).
    for (const n of ["period.close", "period.reopen", "period.confirm_received", "datahub.template.update", "datahub.template.column.set_role"]) expect(byName(n).aiAllowed, n).toBe(false);
    expect(byName("datahub.table.delete").ai!.access).toBe("full");
    expect(byName("datahub.row.list").ai).toMatchObject({ menu: "by_target", access: "read" });
    expect(byName("system.setting.set").ai).toMatchObject({ menu: "admin", forbidden: "settings" });
  });
});

describe("level: Xem / Sửa / Toàn quyền", () => {
  it("a read-only connection reads but cannot write; Sửa writes but cannot delete a table", async () => {
    const x = await makeTable(as(t, org.userA1.id), { columns: [{ name: "Tên", type: "text" }] });
    const read = await conn(org.userA1.id, { datahub: "read" });
    expect((await read.call("datahub.row.list", { table_id: x.tableId })).items).toEqual([]);
    const e = await fails(read.call("datahub.row.create", { table_id: x.tableId, data: { Tên: "a" } }));
    expect(e.code).toBe("forbidden");
    expect(e.message).toContain("chỉ có mức Xem cho Datahub");
    expect(e.message).toContain("Kết nối AI");

    const write = await conn(org.userA1.id, { datahub: "write" });
    const row = await write.call("datahub.row.create", { table_id: x.tableId, data: { Tên: "a" } });
    expect(row.id).toBeTruthy();
    expect((await fails(write.call("datahub.table.delete", { table_id: x.tableId }))).message).toContain("cần mức Toàn quyền");
    // Many deletes at once need the top level; one delete is a Sửa.
    const batch = (n: number) => ({ table_id: x.tableId, ops: Array.from({ length: n }, () => ({ op: "delete", id: row.id })) });
    expect((await fails(write.call("datahub.row.batch", batch(2)))).code).toBe("forbidden");

    const full = await conn(org.userA1.id, { datahub: "full" });
    await full.call("datahub.table.delete", { table_id: x.tableId });
  });
});

describe("menu follows the target datahub, not the operation name (module5 3.1)", () => {
  it("a Datahub-only connection reaches neither the Deal tables nor their metrics; a Deal-only one reaches no ordinary table", async () => {
    const onlyDh = await conn(org.mgrA.id, { datahub: "full" });
    const e1 = await fails(onlyDh.call("datahub.row.list", { table_id: dealTable }));
    expect(e1.code).toBe("forbidden");
    expect(e1.message).toContain("chưa có menu Quản lý Deal");
    expect((await fails(onlyDh.call("datahub.row.create", { table_id: dealTable, data: {} }))).code).toBe("forbidden");
    expect((await fails(onlyDh.call("metrics.query", { datahub_id: dealDatahub, metric: { name: "x", source: dealTable, measure: { agg: "count" } } }))).message).toContain("chưa có menu Quản lý Deal");
    expect((await fails(onlyDh.call("metrics.dashboard.list", { datahub_id: dealDatahub }))).code).toBe("forbidden");
    // No id that names a target: closed by default.
    expect((await fails(onlyDh.call("datahub.row.list", {}))).code).toBe("validation_error"); // input validation comes first
    expect((await fails(onlyDh.call("metrics.query", { metric: { name: "x", source: "Nguồn bất kỳ", measure: { agg: "count" } } }))).message).toContain("Không xác định được datahub");
    // An inline metric that names a Deal table as its source is a Deal call even without datahub_id.
    expect((await fails(onlyDh.call("metrics.query", { metric: { name: "x", source: dealTable, measure: { agg: "count" } } }))).message).toContain("chưa có menu Quản lý Deal");

    const mine = await makeTable(mgrA, { columns: [{ name: "Tên", type: "text" }] });
    const onlyDeal = await conn(org.mgrA.id, { deal: "write" });
    expect((await fails(onlyDeal.call("datahub.row.list", { table_id: mine.tableId }))).message).toContain("chưa có menu Datahub");
    // Deal menu reads Deals (read level is enough to list; writing needs Sửa, which this one has).
    expect((await onlyDeal.call("datahub.row.list", { table_id: dealTable })).items).toBeDefined();
    const dealRead = await conn(org.mgrA.id, { deal: "read" });
    expect((await fails(dealRead.call("datahub.row.create", { table_id: dealTable, data: {} }))).message).toContain("chỉ có mức Xem cho Quản lý Deal");
    // The owner's own permission still applies on top (a User cannot reach another tree's table).
    const other = await conn(org.userB1.id, { datahub: "full", deal: "full" });
    expect((await fails(other.call("datahub.row.list", { table_id: dealTable }))).code).toBe("not_found");
  });
});

describe("hard bans and groups the Admin switches on (module5 3.3)", () => {
  it("nothing opens a hard ban, not even an Admin with every group on", async () => {
    await setAiPolicy(t, adm, { groups: [...AI_GROUPS] });
    const a = await conn(org.admin.id, { admin: "full", datahub: "full", deal: "full" });
    for (const [name, input] of [["auth.token.create", { name: "x" }], ["auth.token.approve", { id: randomUUID() }], ["auth.password.change", { current_password: "a", new_password: "b" }], ["auth.session.list", {}]] as [string, Record<string, unknown>][]) {
      expect((await fails(a.call(name, input))).code, name).toBe("ai_not_allowed");
    }
    // The same through the API channel (a personal token on REST).
    const api = await conn(org.admin.id, { admin: "full" }, { via: "api" });
    expect((await fails(api.call("auth.token.create", { name: "x" }))).code).toBe("ai_not_allowed");
    // The Admin cannot even store a group name that does not exist.
    const bad = await t.app.inject({ method: "PUT", url: "/api/v1/system/settings/ai.groups_enabled", headers: adm.write, payload: { value: ["hard"], version: 1 } });
    expect(bad.statusCode).toBe(400);
  });

  it("a group is closed until the Admin switches it on, and off again closes it; the connection still needs the admin menu", async () => {
    await setAiPolicy(t, adm, { groups: [] });
    const a = await conn(org.admin.id, { admin: "read" });
    const e = await fails(a.call("org.member.list"));
    expect(e.code).toBe("ai_not_allowed");
    expect(e.message).toContain("Admin chưa bật nhóm Tổ chức");
    expect((await fails(a.call("system.audit.list"))).message).toContain("nhóm Nhật ký");
    await setAiPolicy(t, adm, { groups: ["org"] });
    expect((await a.call("org.member.list")).items.length).toBeGreaterThan(0);
    // Group on, but this one is for the audit log which is still off.
    expect((await fails(a.call("system.audit.list"))).code).toBe("ai_not_allowed");
    // Group on, but the connection has no admin menu.
    const noMenu = await conn(org.admin.id, { datahub: "full" });
    expect((await fails(noMenu.call("org.member.list"))).message).toContain("chưa có menu Tài khoản và quản trị");
    // Writing in the group needs more than Xem.
    expect((await fails(a.call("org.member.lock", { id: org.userB1.id }))).message).toContain("chỉ có mức Xem");
    await setAiPolicy(t, adm, { groups: [] });
    expect((await fails(a.call("org.member.list"))).code).toBe("ai_not_allowed");
  });

  it("a Manager's connection with the group on still cannot do what the Manager cannot do on the web", async () => {
    await setAiPolicy(t, adm, { groups: ["org"] });
    const m = await conn(org.mgrA.id, { admin: "full" });
    expect((await fails(m.call("org.member.lock", { id: org.admin.id }))).code).toBe("forbidden");
    await setAiPolicy(t, adm, { groups: [] });
  });
});

describe("import through a connection (module5 12)", () => {
  const text = "Tên,Số\nA,1\nB,2";
  it("Datahub-only cannot import into the Deal table; Datahub write imports into a normal table", async () => {
    const c = await conn(org.mgrA.id, { datahub: "write" });
    const an = await c.call("datahub.import.analyze", { text });
    const sheet = an.sheets[0].name;
    expect((await c.call("datahub.import.preview", { job_id: an.job.id, mapping: { datahub: { name: "Nhập thử" }, sheets: [{ sheet, table: { mode: "new", name: "T" } }] } })).ok).toBe(true);
    // Into the Deal table: needs the Deal menu.
    const toDeal = await fails(c.call("datahub.import.start", { job_id: an.job.id, mapping: { datahub: { id: dealDatahub }, sheets: [{ sheet, table: { mode: "existing", table_id: dealTable } }] } }));
    expect(toDeal.code).toBe("forbidden");
    expect(toDeal.message).toContain("chưa có menu Quản lý Deal");
    // Into a normal table: fine at level Sửa; replacing needs Toàn quyền.
    const x = await makeTable(as(t, org.mgrA.id), { columns: [{ name: "Tên", type: "text" }] });
    const map = (write: string) => ({ datahub: { id: x.dhId }, sheets: [{ sheet, table: { mode: "existing", table_id: x.tableId }, write }] });
    expect((await fails(c.call("datahub.import.start", { job_id: an.job.id, mapping: map("replace") }))).message).toContain("chỉ có mức Sửa");
    const job = await c.call("datahub.import.start", { job_id: an.job.id, mapping: map("add") });
    expect(job.id).toBe(an.job.id);
    const ro = await conn(org.mgrA.id, { datahub: "read" });
    const an2 = await ro.call("datahub.import.analyze", { text });
    expect((await fails(ro.call("datahub.import.start", { job_id: an2.job.id, mapping: map("add") }))).message).toContain("chỉ có mức Xem");
  });
});

describe("pending, narrowing, narrower approval and the emergency switch", () => {
  it("a pending connection answers connection_pending (executor and REST); approval makes it work", async () => {
    const s = await login(t, org.userA1.email);
    const made = (await t.app.inject({ method: "POST", url: "/api/v1/auth/tokens", headers: s.write, payload: { name: "Claude Code", menus: { datahub: "write", deal: "write" } } })).json().data;
    const rest = await t.app.inject({ method: "GET", url: "/api/v1/datahubs", headers: { authorization: `Bearer ${made.token}` } });
    expect(rest.statusCode).toBe(401);
    expect(rest.json().error).toMatchObject({ code: "connection_pending" });
    expect(rest.json().error.message).toContain("chờ Admin duyệt");
    // The executor refuses a pending connection too (the AI channel gets here with a token a client already holds).
    const pend = await conn(org.userA1.id, { datahub: "write" }, { status: "pending" });
    expect((await fails(pend.call("datahub.datahub.list"))).code).toBe("connection_pending");

    const ok = await t.app.inject({ method: "POST", url: `/api/v1/admin/tokens/${made.info.id}/approve`, headers: adm.write, payload: { menus: { datahub: "read" } } });
    expect(ok.json().data.menus).toEqual({ datahub: "read" });
    const after = await t.app.inject({ method: "GET", url: "/api/v1/datahubs", headers: { authorization: `Bearer ${made.token}` } });
    expect(after.statusCode).toBe(200);
    // Approved with less: Deal is not there any more.
    const x = await makeTable(as(t, org.userA1.id), { columns: [{ name: "Tên", type: "text" }] });
    const wr = await t.app.inject({ method: "POST", url: `/api/v1/tables/${x.tableId}/rows`, headers: { authorization: `Bearer ${made.token}` }, payload: { data: { Tên: "a" } } });
    expect(wr.statusCode).toBe(403);
    expect(wr.json().error.message).toContain("chỉ có mức Xem cho Datahub");
  });

  it("the owner narrows a connection at once (REST); the next call sees it", async () => {
    const s = await login(t, org.userA1.email);
    const x = await makeTable(as(t, org.userA1.id), { columns: [{ name: "Tên", type: "text" }] });
    const c = await conn(org.userA1.id, { datahub: "write", notify: "write" });
    await c.call("datahub.row.create", { table_id: x.tableId, data: { Tên: "a" } });
    const r = await t.app.inject({ method: "PATCH", url: `/api/v1/auth/tokens/${c.tk.id}`, headers: s.write, payload: { menus: { datahub: "read" } } });
    expect(r.statusCode).toBe(200);
    expect((await fails(c.call("datahub.row.create", { table_id: x.tableId, data: { Tên: "b" } }))).code).toBe("forbidden");
    expect((await fails(c.call("notification.unread_count"))).message).toContain("chưa có menu Thông báo và nhắc hẹn");
  });

  it("the emergency switch stops every connection, and only connections; a revoked or expired one is refused", async () => {
    const c = await conn(org.userA1.id, { notify: "read" });
    expect((await c.call("notification.unread_count")).unread).toBeDefined();
    await setAiPolicy(t, adm, { killed: true });
    const e = await fails(c.call("notification.unread_count"));
    expect(e).toMatchObject({ code: "ai_not_allowed" });
    expect(e.message).toContain("tạm tắt");
    expect((await as(t, org.userA1.id, "web")("notification.unread_count")).unread).toBeDefined();
    await setAiPolicy(t, adm, { killed: false });
    expect((await c.call("notification.unread_count")).unread).toBeDefined();
    await t.c.db.db.execute(sql`UPDATE api_tokens SET status = 'revoked' WHERE id = ${c.tk.id}`);
    expect((await fails(c.call("notification.unread_count"))).code).toBe("unauthenticated");
  });
});

describe("rate limit, audit name", () => {
  it("120 calls and 30 writes a minute per connection, then 429", async () => {
    const c = await conn(org.userA1.id, { notify: "write" });
    for (let i = 0; i < 30; i++) await c.call("notification.mark_read", { ids: [] }).catch(() => undefined);
    const w = await fails(c.call("notification.mark_read", { ids: [] }));
    expect(w.code).toBe("rate_limited");
    expect(w.details.retry_after_seconds).toBeGreaterThan(0);
    const r = await conn(org.userA1.id, { notify: "read" });
    for (let i = 0; i < 120; i++) await r.call("notification.unread_count");
    expect((await fails(r.call("notification.unread_count"))).code).toBe("rate_limited");
    // Another connection of the same person has its own counters.
    const r2 = await conn(org.userA1.id, { notify: "read" });
    expect((await r2.call("notification.unread_count")).unread).toBeDefined();
  });

  it("a write through a connection records its name and channel in the audit log", async () => {
    const x = await makeTable(as(t, org.userA1.id), { columns: [{ name: "Tên", type: "text" }] });
    const c = await conn(org.userA1.id, { datahub: "write" }, { name: "Claude Desktop máy công ty" });
    await c.call("datahub.row.create", { table_id: x.tableId, data: { Tên: "a" } });
    const rows = (await t.c.db.db.execute(sql`SELECT via, connection_id, details FROM audit_log WHERE command = 'datahub.row.create' AND connection_id = ${c.tk.id}::uuid`)).rows as { via: string; details: { connection_name: string } }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ via: "mcp" });
    expect(rows[0]!.details.connection_name).toBe("Claude Desktop máy công ty");
  });
});
