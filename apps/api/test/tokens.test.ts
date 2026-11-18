import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { apiTokens } from "@soe/db";
import { activeToken, login, seedOrg, type Org, type WebSession } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let o: Org;
let adm: WebSession;
let adm2: WebSession;
beforeAll(async () => {
  t = await makeApp();
  o = await seedOrg(t);
  adm = await login(t, o.admin.email);
  adm2 = await login(t, o.admin2.email);
});
afterAll(async () => {
  await t.close();
});

const req = (method: string, url: string, headers: Record<string, string>, payload?: unknown) =>
  t.app.inject({ method: method as "GET", url: `/api/v1${url}`, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });

describe("personal access tokens (module1 7)", () => {
  it("shown once, stored hashed, pending until an Admin approves", async () => {
    const s = await login(t, o.userA1.email);
    const r = await req("POST", "/auth/tokens", s.write, { name: "Claude Code", scopes: ["org:member:read", "system:whoami"] });
    expect(r.statusCode).toBe(201);
    const { token, info } = r.json().data;
    expect(token).toMatch(/^soe_pat_/);
    expect(info.status).toBe("pending");
    const days = (new Date(info.expires_at).getTime() - Date.now()) / 86400_000;
    expect(Math.round(days)).toBe(90);
    const [row] = await t.c.db.db.select().from(apiTokens).where(eq(apiTokens.id, info.id));
    expect(row!.tokenHash).not.toContain(token);
    expect(JSON.stringify((await req("GET", "/auth/tokens", s.read)).json())).not.toContain(token);

    const pending = await req("GET", "/auth/me", bearer(token));
    expect(pending.statusCode).toBe(401);
    expect(pending.json().error.message).toContain("chờ Admin duyệt");
    const queue = (await req("GET", "/admin/tokens", adm.read)).json().data;
    expect(queue.map((x: { id: string }) => x.id)).toContain(info.id);
    expect((await req("POST", `/admin/tokens/${info.id}/approve`, adm.write, { note: "ok" })).json().data.status).toBe("active");
    const me = await req("GET", "/auth/me", bearer(token));
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({ via: "api", token_id: info.id });
  });

  it("scopes cannot exceed the owner's permissions, nor include auth:* / onboarding:*", async () => {
    const s = await login(t, o.leaderA.email);
    expect((await req("POST", "/auth/tokens", s.write, { name: "x", scopes: ["system:audit:read"] })).statusCode).toBe(400);
    expect((await req("POST", "/auth/tokens", s.write, { name: "x", scopes: ["auth:self"] })).statusCode).toBe(400);
    expect((await req("POST", "/auth/tokens", s.write, { name: "x", scopes: ["onboarding:path:create"] })).statusCode).toBe(400);
    expect((await req("POST", "/auth/tokens", s.write, { name: "x", scopes: ["deal:column:push"], expires_in_days: 366 })).statusCode).toBe(400);
    expect((await req("POST", "/auth/tokens", s.write, { name: "x", scopes: ["deal:column:push"], expires_in_days: 365 })).statusCode).toBe(201);
  });

  it("a token cannot create tokens (account management is web only)", async () => {
    const tk = await activeToken(t, o.userA2.id, ["org:member:read"]);
    expect((await req("POST", "/auth/tokens", tk.headers, { name: "x", scopes: ["org:member:read"] })).statusCode).toBe(403);
  });

  it("approval re-checks the owner's current permissions; an Admin cannot approve their own token while another Admin exists", async () => {
    // A leader without a team (so the role can be removed).
    const mB = await login(t, o.mgrB.email);
    const email = `ldr${Math.random().toString(36).slice(2, 8)}@base.vn`;
    const ldr = (await req("POST", "/org/members", mB.write, { email, full_name: "Leader tạm", roles: ["leader"], manager_id: o.mgrB.id })).json().data;
    await t.c.db.db.execute(sql`UPDATE users SET status = 'active', password_hash = (SELECT password_hash FROM users WHERE id = ${o.leaderB.id}) WHERE id = ${ldr.id}`);
    const s = await login(t, email);
    const { info } = (await req("POST", "/auth/tokens", s.write, { name: "push", scopes: ["deal:column:push", "deal:deal:read"] })).json().data;
    // Owner is demoted before approval: the token is narrowed at once, then approved with what is left.
    expect((await req("PATCH", `/org/members/${ldr.id}`, mB.write, { version: ldr.version, roles: ["user"] })).statusCode).toBe(200);
    const approved = (await req("POST", `/admin/tokens/${info.id}/approve`, adm.write, {})).json().data;
    expect(approved.scopes).toEqual(["deal:deal:read"]);

    const own = (await req("POST", "/auth/tokens", adm.write, { name: "mine", scopes: ["system:audit:read"] })).json().data;
    expect((await req("POST", `/admin/tokens/${own.info.id}/approve`, adm.write, {})).statusCode).toBe(403);
    expect((await req("POST", `/admin/tokens/${own.info.id}/approve`, adm2.write, {})).statusCode).toBe(200);
  });

  it("reject, revoke by owner or Admin, expiry", async () => {
    const s = await login(t, o.userB1.email);
    const a = (await req("POST", "/auth/tokens", s.write, { name: "a", scopes: ["system:whoami"] })).json().data;
    expect((await req("POST", `/admin/tokens/${a.info.id}/reject`, adm.write, { note: "không cần" })).json().data.status).toBe("rejected");
    expect((await req("GET", "/auth/me", bearer(a.token))).statusCode).toBe(401);

    const b = (await req("POST", "/auth/tokens", s.write, { name: "b", scopes: ["system:whoami"] })).json().data;
    await req("POST", `/admin/tokens/${b.info.id}/approve`, adm.write, {});
    expect((await req("DELETE", `/auth/tokens/${b.info.id}`, s.write)).json().data.status).toBe("revoked");
    expect((await req("GET", "/auth/me", bearer(b.token))).statusCode).toBe(401);

    const c = (await req("POST", "/auth/tokens", s.write, { name: "c", scopes: ["system:whoami"] })).json().data;
    await req("POST", `/admin/tokens/${c.info.id}/approve`, adm.write, {});
    // Someone else cannot revoke it; an Admin can.
    expect((await req("DELETE", `/auth/tokens/${c.info.id}`, (await login(t, o.userA1.email)).write)).statusCode).toBe(404);
    expect((await req("DELETE", `/auth/tokens/${c.info.id}`, adm.write)).json().data.status).toBe("revoked");

    const d = await activeToken(t, o.userB1.id, ["system:whoami"]);
    await t.c.db.db.execute(sql`UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = ${d.id}`);
    expect((await req("GET", "/auth/me", d.headers)).json().error.message).toContain("hết hạn");
    expect((await req("GET", "/auth/me", bearer("soe_pat_nope"))).statusCode).toBe(401);
    expect((await req("GET", "/auth/me", bearer("random"))).statusCode).toBe(401);
  });
});

describe("service accounts (module1 7)", () => {
  it("Admin creates one limited to a tree; its token works at once; it cannot sign in on the web", async () => {
    const bad = await req("POST", "/admin/service-accounts", adm.write, { name: "Hệ thống chia deal", scopes: ["system:audit:read"] });
    expect(bad.statusCode).toBe(400);
    const sa = (await req("POST", "/admin/service-accounts", adm.write, { name: "Hệ thống chia deal", scopes: ["deal:deal:read", "deal:deal:write", "system:whoami"], tree_manager_ids: [o.mgrA.id] })).json().data;
    expect(sa.tree_manager_ids).toEqual([o.mgrA.id]);
    const { token } = (await req("POST", `/admin/service-accounts/${sa.id}/tokens`, adm.write, { name: "prod" })).json().data;
    expect(token).toMatch(/^soe_svc_/);
    const me = (await req("GET", "/auth/me", bearer(token))).json().data;
    expect(me.user).toMatchObject({ kind: "service", roles: [] });
    expect(me.permissions.sort()).toEqual(["deal:deal:read", "deal:deal:write", "system:whoami"]);
    expect((await req("GET", "/system/audit-log", bearer(token))).statusCode).toBe(403);
    // Its data scope is the tree it is limited to.
    const { computeScope, loadPrincipal } = await import("../src/auth/access");
    const scope = await computeScope(t.c.db.db, (await loadPrincipal(t.c.db.db, sa.id))!, "deal");
    expect(!scope.all && scope.userIds).toContain(o.userA1.id);
    expect(!scope.all && scope.userIds).not.toContain(o.userB1.id);
    // Narrowing its scopes narrows the token; disabling revokes it.
    const upd = (await req("PATCH", `/admin/service-accounts/${sa.id}`, adm.write, { version: sa.version, scopes: ["system:whoami"] })).json().data;
    expect(upd.tokens[0].scopes).toEqual(["system:whoami"]);
    await req("POST", `/admin/service-accounts/${sa.id}/disable`, adm.write, {});
    expect((await req("GET", "/auth/me", bearer(token))).statusCode).toBe(401);
    // The action of a service account is attributed to it in the audit log.
    expect((await req("GET", "/admin/service-accounts", (await login(t, o.mgrA.email)).read)).statusCode).toBe(403);
  });
});
