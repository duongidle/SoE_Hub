import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { apiTokens, orgMemberships, rowHistory, users } from "@soe/db";
import { PASSWORD, activeToken, login, seedOrg, type Org, type WebSession } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let o: Org;
let adm: WebSession;
let mA: WebSession;
let mB: WebSession;
beforeAll(async () => {
  t = await makeApp();
  o = await seedOrg(t);
  adm = await login(t, o.admin.email);
  mA = await login(t, o.mgrA.email);
  mB = await login(t, o.mgrB.email);
});
afterAll(async () => {
  await t.close();
});

const req = (method: string, url: string, headers: Record<string, string>, payload?: unknown) =>
  t.app.inject({ method: method as "GET", url: `/api/v1${url}`, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
const uniqEmail = () => `n${Math.random().toString(36).slice(2, 10)}@base.vn`;

async function create(s: WebSession, body: Record<string, unknown>) {
  return req("POST", "/org/members", s.write, { email: uniqEmail(), full_name: "Người mới", ...body });
}

describe("org chart is the only way people are added (module1 2.1, 2.2)", () => {
  it("a new row is inactive, has an id at once and sits in the tree", async () => {
    const r = await create(mA, { roles: ["user"], manager_id: o.mgrA.id, leader_id: o.leaderA.id });
    expect(r.statusCode).toBe(201);
    const u = r.json().data;
    expect(u).toMatchObject({ status: "inactive", manager_id: o.mgrA.id, leader_id: o.leaderA.id, roles: ["user"] });
    const hist = await t.c.db.db.select().from(rowHistory).where(and(eq(rowHistory.tableId, "users"), eq(rowHistory.rowId, u.id)));
    expect(hist).toHaveLength(1);
  });

  it("Manager: only inside their own tree, only Leader/User/Guest roles", async () => {
    expect((await create(mA, { roles: ["manager"] })).statusCode).toBe(403);
    expect((await create(mA, { roles: ["admin"] })).statusCode).toBe(403);
    expect((await create(mA, { roles: ["user"], manager_id: o.mgrB.id })).statusCode).toBe(403);
    expect((await create(mA, { roles: ["user"], manager_id: o.mgrA.id, leader_id: o.leaderB.id })).statusCode).toBe(400);
    expect((await create(mA, { roles: ["guest"], guest_preset: "data", manager_id: o.mgrA.id })).statusCode).toBe(201);
    // Admin may add a Manager (root of a new tree) and an Admin outside the trees.
    const m = await create(adm, { roles: ["manager"] });
    expect(m.statusCode).toBe(201);
    expect(m.json().data.manager_id).toBe(m.json().data.id);
    expect((await create(adm, { roles: ["admin"] })).json().data.manager_id).toBeNull();
  });

  it("rejects bad role sets, wrong domains and duplicate emails", async () => {
    expect((await create(adm, { roles: ["guest", "user"], guest_preset: "data", manager_id: o.mgrA.id })).statusCode).toBe(400);
    expect((await create(adm, { roles: ["guest"] })).statusCode).toBe(400);
    expect((await create(adm, { roles: ["user"] })).statusCode).toBe(400); // a User must be in a tree
    expect((await req("POST", "/org/members", adm.write, { email: "a@gmail.com", full_name: "x", roles: ["admin"] })).statusCode).toBe(403);
    expect((await req("POST", "/org/members", adm.write, { email: o.userA1.email, full_name: "x", roles: ["admin"] })).statusCode).toBe(409);
  });

  it("Leader, User and Guest cannot edit the org chart", async () => {
    for (const p of [o.leaderA, o.userA1, o.guestData]) {
      const s = await login(t, p.email);
      expect((await create(s, { roles: ["user"], manager_id: o.mgrA.id })).statusCode).toBe(403);
    }
  });

  it("Manager cannot edit someone in another tree", async () => {
    const v = (await req("GET", `/org/members/${o.userB1.id}`, adm.read)).json().data.version;
    const r = await req("PATCH", `/org/members/${o.userB1.id}`, mA.write, { version: v, title: "x" });
    expect(r.statusCode).toBe(403);
    expect((await req("PATCH", `/org/members/${o.userB1.id}`, mB.write, { version: v, title: "Sale" })).statusCode).toBe(200);
  });
});

describe("tree history (module1 2.3)", () => {
  it("moving someone closes the old period and opens a new one at the same instant", async () => {
    const u = (await create(mA, { roles: ["user"], manager_id: o.mgrA.id, leader_id: o.leaderA.id })).json().data;
    const moved = await req("PATCH", `/org/members/${u.id}`, mA.write, { version: u.version, leader_id: null });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().data.leader_id).toBeNull();
    // Admin moves them to tree B.
    const toB = await req("PATCH", `/org/members/${u.id}`, adm.write, { version: moved.json().data.version, manager_id: o.mgrB.id, leader_id: o.leaderB.id });
    expect(toB.statusCode).toBe(200);
    const h = (await req("GET", `/org/members/${u.id}/history`, adm.read)).json().data;
    expect(h).toHaveLength(3);
    expect(h[0]).toMatchObject({ manager_id: o.mgrA.id, leader_id: o.leaderA.id });
    expect(h[1]).toMatchObject({ manager_id: o.mgrA.id, leader_id: null });
    expect(h[2]).toMatchObject({ manager_id: o.mgrB.id, leader_id: o.leaderB.id, valid_to: null });
    expect(h[0].valid_to).toEqual(h[1].valid_from);
    expect(h[1].valid_to).toEqual(h[2].valid_from);
    // Manager A no longer sees them; Manager B does.
    expect((await req("GET", `/org/members/${u.id}`, mA.read)).statusCode).toBe(404);
    expect((await req("GET", `/org/members/${u.id}`, mB.read)).statusCode).toBe(200);
  });

  it("a Leader with team members cannot lose the role or move until the team is moved", async () => {
    const ldr = (await create(mA, { roles: ["leader"], manager_id: o.mgrA.id })).json().data;
    const mem = (await create(mA, { roles: ["user"], manager_id: o.mgrA.id, leader_id: ldr.id })).json().data;
    const r = await req("PATCH", `/org/members/${ldr.id}`, mA.write, { version: ldr.version, roles: ["user"] });
    expect(r.statusCode).toBe(400);
    await req("PATCH", `/org/members/${mem.id}`, mA.write, { version: mem.version, leader_id: null });
    expect((await req("PATCH", `/org/members/${ldr.id}`, mA.write, { version: ldr.version, roles: ["user"] })).statusCode).toBe(200);
  });

  it("org.tree.get groups by manager and leader", async () => {
    const tree = (await req("GET", "/org/tree", mA.read)).json().data;
    expect(tree.trees).toHaveLength(1);
    expect(tree.trees[0].manager.id).toBe(o.mgrA.id);
    const la = tree.trees[0].leaders.find((l: { id: string }) => l.id === o.leaderA.id);
    expect(la.members.map((m: { id: string }) => m.id)).toContain(o.userA1.id);
    const all = (await req("GET", "/org/tree", adm.read)).json().data;
    expect(all.trees.length).toBeGreaterThanOrEqual(2);
  });
});

describe("visibility of the org chart (two managers never see each other)", () => {
  it("admin sees all, managers / members their own tree, guests only themselves", async () => {
    // All pages: the test database is shared by every file, so the list is longer than one page (a page of 500 cut off a person by name).
    const ids = async (s: WebSession) => {
      const out: string[] = [];
      for (let cursor = ""; ; ) {
        const body = (await req("GET", `/org/members?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, s.read)).json();
        out.push(...body.data.map((r: { id: string }) => r.id));
        if (!body.next_cursor) return out;
        cursor = body.next_cursor;
      }
    };
    const a = await ids(adm);
    expect(a).toEqual(expect.arrayContaining([o.userA1.id, o.userB1.id]));
    const ma = await ids(mA);
    expect(ma).toContain(o.userA1.id);
    expect(ma).not.toContain(o.userB1.id);
    expect(ma).not.toContain(o.mgrB.id);
    const ua = await ids(await login(t, o.userA1.email));
    expect(ua).toContain(o.userA2.id);
    expect(ua).not.toContain(o.userB1.id);
    const g = await login(t, o.guestSale.email);
    expect((await req("GET", "/org/members", g.read)).statusCode).toBe(403);
  });
});

describe("lock / unlock (module1 2.1: removing = locking)", () => {
  it("locking revokes sessions and tokens; unlock returns to active", async () => {
    const victim = o.userA2;
    const s = await login(t, victim.email);
    const tok = await activeToken(t, victim.id, ["system:whoami"]);
    expect((await req("GET", "/auth/me", tok.headers)).statusCode).toBe(200);
    const r = await req("POST", `/org/members/${victim.id}/lock`, mA.write, { reason: "Nghỉ việc" });
    expect(r.json().data.status).toBe("locked");
    expect((await req("GET", "/auth/me", s.read)).statusCode).toBe(401);
    expect((await req("GET", "/auth/me", tok.headers)).statusCode).toBe(401);
    expect((await req("POST", "/auth/login", {}, { email: victim.email, password: PASSWORD })).json().error.code).toBe("account_locked");
    const [tk] = await t.c.db.db.select().from(apiTokens).where(eq(apiTokens.id, tok.id));
    expect(tk!.status).toBe("revoked");
    expect((await req("POST", `/org/members/${victim.id}/unlock`, mA.write, {})).json().data.status).toBe("active");
    await login(t, victim.email);
  });

  it("a Manager cannot lock an Admin or someone outside the tree; nobody locks themselves", async () => {
    expect((await req("POST", `/org/members/${o.userB1.id}/lock`, mA.write, {})).statusCode).toBe(403);
    expect((await req("POST", `/org/members/${o.admin2.id}/lock`, mA.write, {})).statusCode).toBe(403);
    expect((await req("POST", `/org/members/${o.admin.id}/lock`, adm.write, {})).statusCode).toBe(400);
  });
});

describe("role change takes effect at once for tokens (module1 2.1, module5 3.5)", () => {
  it("a Leader demoted to User loses deal:column:push on their token at the next call", async () => {
    const ldr = (await create(mA, { roles: ["leader"], manager_id: o.mgrA.id })).json().data;
    await t.c.db.db.update(users).set({ status: "active" }).where(eq(users.id, ldr.id));
    const tk = await activeToken(t, ldr.id, []);
    expect((await req("GET", "/auth/me", tk.headers)).json().data.permissions).toContain("deal:column:push");
    const r = await req("PATCH", `/org/members/${ldr.id}`, mA.write, { version: ldr.version, roles: ["user"] });
    expect(r.statusCode).toBe(200);
    expect((await req("GET", "/auth/me", tk.headers)).json().data.permissions).not.toContain("deal:column:push");
    const [a] = await t.c.db.db.select().from(apiTokens).where(eq(apiTokens.id, tk.id));
    expect(a!.status).toBe("active");
  });
});

describe("supplementary permissions (module1 3.3)", () => {
  it("Manager grants 'export team deals' to a Leader of their tree only; Admin grants review rights; catalogue rules hold", async () => {
    const cat = (await req("GET", "/org/permissions/catalog", mA.read)).json().data;
    expect(cat.map((c: { permission: string }) => c.permission)).toEqual(expect.arrayContaining(["knowledge:article:review", "aihub:skill:review", "onboarding:path:create", "deal:team:export"]));
    expect((await req("POST", `/org/members/${o.leaderA.id}/permissions`, mA.write, { permission: "deal:team:export" })).json().data.granted).toBe(true);
    expect((await req("POST", `/org/members/${o.userA1.id}/permissions`, mA.write, { permission: "deal:team:export" })).statusCode).toBe(400);
    expect((await req("POST", `/org/members/${o.leaderB.id}/permissions`, mA.write, { permission: "deal:team:export" })).statusCode).toBe(403);
    expect((await req("POST", `/org/members/${o.leaderA.id}/permissions`, adm.write, { permission: "deal:team:export" })).statusCode).toBe(403);
    expect((await req("POST", `/org/members/${o.userB1.id}/permissions`, adm.write, { permission: "knowledge:article:review" })).statusCode).toBe(200);
    expect((await req("POST", `/org/members/${o.userA1.id}/permissions`, mA.write, { permission: "system:audit:read" })).statusCode).toBe(400);
    const me = (await req("GET", "/auth/me", (await login(t, o.leaderA.email)).read)).json().data;
    expect(me.permissions).toContain("deal:team:export");
    const list = (await req("GET", `/org/members/${o.leaderA.id}/permissions`, mA.read)).json().data;
    expect(list.map((p: { permission: string }) => p.permission)).toContain("deal:team:export");
    expect((await req("DELETE", `/org/members/${o.leaderA.id}/permissions/deal:team:export`, mA.write)).json().data.revoked).toBe(true);
    const me2 = (await req("GET", "/auth/me", (await login(t, o.leaderA.email)).read)).json().data;
    expect(me2.permissions).not.toContain("deal:team:export");
  });
});

describe("internal system account", () => {
  it("exists, cannot log in and cannot be changed or deleted", async () => {
    const [sys] = await t.c.db.db.select().from(users).where(eq(users.id, "00000000-0000-7000-8000-000000000000"));
    expect(sys).toMatchObject({ kind: "system", email: null });
    await expect(t.c.db.db.update(users).set({ fullName: "x" }).where(eq(users.id, sys!.id))).rejects.toThrow();
    await expect(t.c.db.pool.query(`DELETE FROM users WHERE id = $1`, [sys!.id])).rejects.toThrow(/permission denied/);
    const memberships = await t.c.db.db.select().from(orgMemberships).where(and(eq(orgMemberships.userId, sys!.id), sql`true`));
    expect(memberships).toHaveLength(0);
  });
});
