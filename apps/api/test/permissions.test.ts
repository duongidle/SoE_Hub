import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, isTokenAllowedPermission, permissionsFor, type Actor } from "@soe/shared";
import { AccessContext, computeScope, loadPrincipal } from "../src/auth/access";
import { activeToken, login, seedOrg, setAiPolicy, type Org, type Person } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let o: Org;
beforeAll(async () => {
  t = await makeApp();
  o = await seedOrg(t);
  // The matrix measures the OWNER's permissions over the API channel: every Admin-switchable group is on (module5 3.3).
  await setAiPolicy(t, await login(t, o.admin.email), { groups: ["org", "guest_grant", "transfer", "settings", "audit_log"] });
});
afterAll(async () => {
  await setAiPolicy(t, await login(t, o.admin.email), { groups: [], killed: false });
  await t.close();
});

type RoleKey = "admin" | "manager" | "leader" | "user" | "guestData" | "guestSale";
const who = (k: RoleKey): Person => ({ admin: o.admin, manager: o.mgrA, leader: o.leaderA, user: o.userA1, guestData: o.guestData, guestSale: o.guestSale })[k];
const ROLES: RoleKey[] = ["admin", "manager", "leader", "user", "guestData", "guestSale"];

interface Case {
  name: string;
  method: "GET" | "POST" | "PUT";
  url: () => string;
  body?: () => unknown;
  allowed: RoleKey[];
  /** Account-management operations are never usable with a token. */
  webOnly?: boolean;
}

const rnd = () => Math.random().toString(36).slice(2, 10);
const CASES: Case[] = [
  { name: "system.audit.list", method: "GET", url: () => "/api/v1/system/audit-log?limit=1", allowed: ["admin"] },
  { name: "system.setting.set", method: "PUT", url: () => `/api/v1/system/settings/test.${rnd()}`, body: () => ({ value: 1 }), allowed: ["admin"] },
  { name: "system.setting.list", method: "GET", url: () => "/api/v1/system/settings?limit=1", allowed: ROLES },
  { name: "docs (openapi)", method: "GET", url: () => "/api/openapi.json", allowed: ["admin", "manager", "leader", "user"] },
  { name: "org.member.list", method: "GET", url: () => "/api/v1/org/members?limit=1", allowed: ["admin", "manager", "leader", "user"] },
  { name: "org.member.create (in tree A)", method: "POST", url: () => "/api/v1/org/members", body: () => ({ email: `m${rnd()}@base.vn`, full_name: "Ma trận", roles: ["user"], manager_id: o.mgrA.id }), allowed: ["admin", "manager"] },
  { name: "auth.token.review_list", method: "GET", url: () => "/api/v1/admin/tokens", allowed: ["admin"], webOnly: true },
  { name: "auth.service_account.list", method: "GET", url: () => "/api/v1/admin/service-accounts", allowed: ["admin"], webOnly: true },
  { name: "data.transfer.preview", method: "GET", url: () => `/api/v1/admin/transfer/preview?from_user_id=${o.userA2.id}&to_user_id=${o.userA1.id}`, allowed: ["admin"] },
  { name: "guest.grant.list", method: "GET", url: () => "/api/v1/guest/grants", allowed: ["manager"] },
  { name: "notification.unread_count", method: "GET", url: () => "/api/v1/notifications/unread-count", allowed: ROLES },
  { name: "auth.session.list", method: "GET", url: () => "/api/v1/auth/sessions", allowed: ROLES, webOnly: true },
];

describe("permission matrix: role × operation × channel (web cookie / API token)", () => {
  for (const c of CASES) {
    for (const role of ROLES) {
      for (const channel of ["web", "api"] as const) {
        const expectAllowed = c.allowed.includes(role) && !(channel === "api" && c.webOnly);
        it(`${c.name} | ${role} | ${channel} → ${expectAllowed ? "allowed" : "denied"}`, async () => {
          const p = who(role);
          let headers: Record<string, string>;
          if (channel === "web") {
            const s = await login(t, p.email);
            headers = c.method === "GET" ? s.read : s.write;
          } else {
            // A token carrying everything a token may carry for this person.
            const pr = await loadPrincipal(t.c.db.db, p.id);
            const scopes = [...pr!.permissions].filter(isTokenAllowedPermission);
            headers = (await activeToken(t, p.id, scopes.length ? scopes : ["system:whoami"])).headers;
          }
          const r = await t.app.inject({ method: c.method, url: c.url(), headers, ...(c.body ? { payload: c.body() as object } : {}) });
          if (expectAllowed) expect(r.statusCode, r.body).toBeLessThan(300);
          else expect(r.statusCode, r.body).toBe(403);
        });
      }
    }
  }

  it("a token gets the intersection of the owner's permissions, the connection's menus and the Admin's groups", async () => {
    const adm = await login(t, o.admin.email);
    // A User owns a token with the admin menu: the menu is there, the owner's permission is not.
    const tk = await activeToken(t, o.userA1.id, [], { menus: { admin: "read" } });
    expect((await t.app.inject({ method: "GET", url: "/api/v1/system/audit-log", headers: tk.headers })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "GET", url: "/api/v1/org/members", headers: tk.headers })).statusCode).toBe(200);
    // An Admin token without the admin menu cannot read the log, although the Admin can.
    const at = await activeToken(t, o.admin.id, [], { menus: { datahub: "read" } });
    expect((await t.app.inject({ method: "GET", url: "/api/v1/system/audit-log", headers: at.headers })).statusCode).toBe(403);
    // With the menu but the group off, still refused; on again, allowed.
    const full = await activeToken(t, o.admin.id, [], { menus: { admin: "read" } });
    await setAiPolicy(t, adm, { groups: [] });
    expect((await t.app.inject({ method: "GET", url: "/api/v1/system/audit-log", headers: full.headers })).statusCode).toBe(403);
    await setAiPolicy(t, adm, { groups: ["org", "guest_grant", "transfer", "settings", "audit_log"] });
    expect((await t.app.inject({ method: "GET", url: "/api/v1/system/audit-log", headers: full.headers })).statusCode).toBe(200);
    const me = (await t.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: full.headers })).json().data;
    expect(me.permissions).toContain("system:audit:read");
    expect(me.via).toBe("api");
  });
});

describe("Admin is system administration only (module1 3.1)", () => {
  it("has no business permission except reading Deals", () => {
    const admin = new Set(ROLE_PERMISSIONS.admin);
    expect(admin.has("deal:deal:read")).toBe(true);
    for (const p of ["deal:deal:write", "deal:deal:assign", "deal:policy:write", "deal:period:lock", "deal:snapshot:create", "deal:column:push", "onboarding:path:create", "datahub:datahub:create", "form:form:create", "knowledge:article:post", "aihub:skill:post", "guest:grant:manage"] as const) {
      expect(admin.has(p), p).toBe(false);
    }
  });

  it("role table matches design 3.2", () => {
    const has = (r: keyof typeof ROLE_PERMISSIONS, p: string) => (ROLE_PERMISSIONS[r] as string[]).includes(p);
    expect(has("manager", "deal:deal:assign") && !has("leader", "deal:deal:assign")).toBe(true);
    expect(has("leader", "deal:column:push") && !has("user", "deal:column:push")).toBe(true);
    expect(has("manager", "deal:forecast:read") && has("leader", "deal:forecast:read") && !has("user", "deal:forecast:read") && !has("guest", "deal:forecast:read")).toBe(true);
    expect(has("leader", "onboarding:path:create") && !has("user", "onboarding:path:create")).toBe(true);
    expect(["manager", "leader", "user"].every((r) => has(r as "user", "datahub:datahub:create"))).toBe(true);
    expect(has("guest", "docs:read")).toBe(false);
    expect(has("guest", "system:setting:read") && has("guest", "file:read") && has("guest", "events:subscribe")).toBe(true);
    expect([...permissionsFor(["guest"], "sale")]).toContain("knowledge:article:read");
    expect([...permissionsFor(["guest"], "data")]).not.toContain("knowledge:article:read");
    expect(["system:audit:read", "system:setting:write"].every((p) => ROLES.every((r) => r === "admin" || !has((r.startsWith("guest") ? "guest" : r) as "user", p)))).toBe(true);
    // Every permission in a role map is in the catalogue.
    for (const list of Object.values(ROLE_PERMISSIONS)) for (const p of list) expect(ALL_PERMISSIONS).toContain(p);
  });
});

describe("data scope → owners (module1 4.1): own / team / other tree", () => {
  const actorOf = (id: string): Actor => ({ userId: id, via: "web", connectionId: null, automationId: null, sessionId: null, scopes: [], ip: null, userAgent: null });
  const scopeOf = async (p: Person, kind: "deal" | "org" | "org_write" | "owner") => computeScope(t.c.db.db, (await loadPrincipal(t.c.db.db, p.id))!, kind);

  it("deal: User = self, Leader = self + team, Manager = whole tree, Admin = all; never the other tree", async () => {
    const u = await scopeOf(o.userA1, "deal");
    expect(u).toEqual({ all: false, userIds: [o.userA1.id] });
    const l = await scopeOf(o.leaderA, "deal");
    expect(!l.all && l.userIds.sort()).toEqual([o.leaderA.id, o.userA1.id].sort());
    const m = await scopeOf(o.mgrA, "deal");
    expect(!m.all && m.userIds).toEqual(expect.arrayContaining([o.mgrA.id, o.leaderA.id, o.userA1.id, o.userA2.id]));
    expect(!m.all && m.userIds).not.toContain(o.userB1.id);
    expect(!m.all && m.userIds).not.toContain(o.mgrB.id);
    expect(await scopeOf(o.admin, "deal")).toEqual({ all: true });
  });

  it("owner (datahub, files): only yourself, for every role including Admin and Manager", async () => {
    for (const p of [o.admin, o.mgrA, o.leaderA, o.userA1]) expect(await scopeOf(p, "owner")).toEqual({ all: false, userIds: [p.id] });
  });

  it("org_write: Admin all, Manager own tree, others nobody", async () => {
    expect(await scopeOf(o.admin, "org_write")).toEqual({ all: true });
    const m = await scopeOf(o.mgrB, "org_write");
    expect(!m.all && m.userIds).toEqual(expect.arrayContaining([o.leaderB.id, o.userB1.id]));
    expect(!m.all && m.userIds).not.toContain(o.userA1.id);
    expect(await scopeOf(o.leaderA, "org_write")).toEqual({ all: false, userIds: [] });
  });

  it("AccessContext caches per request", async () => {
    const ac = new AccessContext(actorOf(o.userA1.id), t.c.db.db, t.c.auth.principals);
    const [a, b] = await Promise.all([ac.scope("deal"), ac.scope("deal")]);
    expect(a).toBe(b);
    expect(await ac.can("deal:deal:read")).toBe(true);
    expect(await ac.can("deal:deal:assign")).toBe(false);
  });

  it("editing in the org chart follows the scope: self / team / other tree", async () => {
    const mA = await login(t, o.mgrA.email);
    const lA = await login(t, o.leaderA.email);
    const get = async (id: string) => (await t.app.inject({ method: "GET", url: `/api/v1/org/members/${id}`, headers: (await login(t, o.admin.email)).read })).json().data.version;
    const patch = async (s: { write: Record<string, string> }, id: string) => (await t.app.inject({ method: "PATCH", url: `/api/v1/org/members/${id}`, headers: s.write, payload: { version: await get(id), title: `t${rnd()}` } })).statusCode;
    expect(await patch(mA, o.mgrA.id)).toBe(200); // own row
    expect(await patch(mA, o.userA1.id)).toBe(200); // team / tree
    expect(await patch(mA, o.userB1.id)).toBe(403); // other tree
    expect(await patch(lA, o.userA1.id)).toBe(403); // Leader never edits the org chart
    expect(await patch(lA, o.leaderA.id)).toBe(403);
  });
});
