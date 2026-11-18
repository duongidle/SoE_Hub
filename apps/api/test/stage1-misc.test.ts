import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { apiTokens, auditLog, files, newId, users, writeAudit } from "@soe/db";
import { ownedBy, systemScope } from "../src/auth/access";
import { UnscopedQueryError, checkScopedQuery, ownedTables } from "../src/auth/query-guard";
import { maskAuditDetails, registerPrivateAuditTarget } from "../src/core/audit-privacy";
import { dispatchOutboxOnce } from "../src/core/outbox-dispatcher";
import { createSseFanout } from "../src/core/subscribers";
import { SseHub } from "../src/http/sse";
import { guestCanAccess, registerGrantDataType, unregisterGrantDataType } from "../src/modules/guest";
import { createNotificationSubscriber } from "../src/modules/notification";
import { activeToken, login, seedOrg, type Org, type WebSession } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let o: Org;
let adm: WebSession;
beforeAll(async () => {
  t = await makeApp();
  o = await seedOrg(t);
  adm = await login(t, o.admin.email);
});
afterAll(async () => {
  await t.close();
});

const req = (method: string, url: string, headers: Record<string, string>, payload?: unknown) =>
  t.app.inject({ method: method as "GET", url: `/api/v1${url}`, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function addFile(ownerId: string, name: string) {
  const id = newId();
  await t.c.db.db.execute(sql`INSERT INTO files (id, owner_id, storage_key, filename, content_type, size_bytes, status, created_by, updated_by)
    VALUES (${id}, ${ownerId}, ${`files/${id}`}, ${name}, 'text/plain', 3, 'ready', ${ownerId}, ${ownerId})`);
  return id;
}

describe("scoped queries are enforced (module1 10)", () => {
  it("a direct query on an owned table fails; scoped and system-marked ones pass", async () => {
    expect(ownedTables()).toEqual(expect.arrayContaining(["files", "notifications"]));
    const err = await t.c.db.db.select().from(files).limit(1).catch((e: { cause?: unknown }) => e.cause);
    expect(err).toBeInstanceOf(UnscopedQueryError);
    await expect(t.c.db.pool.query("SELECT * FROM notifications")).rejects.toThrow(UnscopedQueryError);
    await expect(t.c.db.pool.query('UPDATE "files" SET filename = filename')).rejects.toThrow(UnscopedQueryError);
    await expect(t.c.db.db.select().from(files).where(ownedBy(files.ownerId, o.userA1.id))).resolves.toBeDefined();
    await expect(t.c.db.db.select().from(files).where(systemScope()).limit(1)).resolves.toBeDefined();
    expect(() => checkScopedQuery('insert into "files" ("id") values ($1)')).not.toThrow();
    expect(() => checkScopedQuery("select * from files_archive")).not.toThrow();
    expect(() => checkScopedQuery('select 1 from users u join "files" f on f.owner_id = u.id')).toThrow(UnscopedQueryError);
  });

  it("source code: every query on an owned table carries a scope (static check)", () => {
    const root = path.resolve(__dirname, "../src");
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    const offenders: string[] = [];
    for (const f of walk(root).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(f, "utf8");
      // Drizzle builder: `.from(files)` / `.update(files)` must have ownedBy/scopeSql/systemScope in the same statement.
      for (const m of src.matchAll(/\.(from|update)\((files|notifications)\)[\s\S]{0,400}?;/g)) {
        if (!/ownedBy|scopeSql|systemScope/.test(m[0])) offenders.push(`${path.relative(root, f)}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("data transfer (module1 8)", () => {
  it("preview lists files (move) and tokens (revoke); execute moves, audits each object, locks the source", async () => {
    const f1 = await addFile(o.userA2.id, "bao-cao.pdf");
    const f2 = await addFile(o.userA2.id, "ghi-chu.txt");
    const tk = await activeToken(t, o.userA2.id, ["system:whoami"]);
    const prev = (await req("GET", `/admin/transfer/preview?from_user_id=${o.userA2.id}&to_user_id=${o.userA1.id}`, adm.read)).json().data;
    const g = Object.fromEntries(prev.groups.map((x: { handler: string; items: unknown[] }) => [x.handler, x.items]));
    expect((g.files as { id: string; action: string }[]).map((i) => i.id).sort()).toEqual([f1, f2].sort());
    expect((g.tokens as { action: string }[])[0]!.action).toBe("revoke");
    // Not for managers, not to a guest, not to oneself.
    expect((await req("POST", "/admin/transfer", (await login(t, o.mgrA.email)).write, { from_user_id: o.userA2.id, to_user_id: o.userA1.id })).statusCode).toBe(403);
    expect((await req("POST", "/admin/transfer", adm.write, { from_user_id: o.userA2.id, to_user_id: o.guestData.id })).statusCode).toBe(400);
    const r = await req("POST", "/admin/transfer", adm.write, { from_user_id: o.userA2.id, to_user_id: o.userA1.id });
    expect(r.statusCode).toBe(200);
    const owners = await t.c.db.db.select({ owner: files.ownerId }).from(files).where(and(systemScope(), sql`${files.id} IN (${f1}, ${f2})`));
    expect(owners.map((x) => x.owner)).toEqual([o.userA1.id, o.userA1.id]);
    const [token] = await t.c.db.db.select().from(apiTokens).where(eq(apiTokens.id, tk.id));
    expect(token!.status).toBe("revoked");
    const [src] = await t.c.db.db.select().from(users).where(eq(users.id, o.userA2.id));
    expect(src!.status).toBe("locked");
    const items = await t.c.db.db.select().from(auditLog).where(eq(auditLog.command, "data.transfer.item"));
    expect(items.filter((i) => [f1, f2, tk.id].includes(i.targetId!))).toHaveLength(3);
  });

  it("a whole tree moves to another manager, keeping its leaders and history", async () => {
    const mgrC = (await req("POST", "/org/members", adm.write, { email: `mgrc.${o.tag}@base.vn`, full_name: "Manager C", roles: ["manager"] })).json().data;
    const r = await req("POST", `/admin/trees/${o.mgrB.id}/transfer`, adm.write, { to_manager_id: mgrC.id });
    expect(r.json().data.moved).toBeGreaterThanOrEqual(2);
    const u = (await req("GET", `/org/members/${o.userB1.id}`, adm.read)).json().data;
    expect(u).toMatchObject({ manager_id: mgrC.id, leader_id: o.leaderB.id });
    const h = (await req("GET", `/org/members/${o.userB1.id}/history`, adm.read)).json().data;
    expect(h.map((x: { manager_id: string }) => x.manager_id)).toEqual([o.mgrB.id, mgrC.id]);
  });
});

describe("SSE: signals only to people allowed to see the object (module1 10)", () => {
  it("a notification signal reaches its recipient only; setting changes reach every signed-in person; org changes stay in the tree", async () => {
    const hub = new SseHub(t.c.config.DATABASE_URL, t.c.logger);
    await hub.start();
    const { buildApp } = await import("../src/http/app");
    const server = await buildApp({ ...t.c, sse: hub });
    await server.listen({ port: 0, host: "127.0.0.1" });
    const port = (server.server.address() as { port: number }).port;
    const ctl = new AbortController();
    const open = async (s: WebSession) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/events`, { signal: ctl.signal, headers: s.read });
      const reader = res.body!.getReader();
      const buf = { text: "" };
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf.text += new TextDecoder().decode(value);
          }
        } catch {
          /* aborted */
        }
      })();
      return buf;
    };
    const subs = [createNotificationSubscriber(t.c.config.AUTH_SECRET), createSseFanout(t.c.events)];
    // Drain events of earlier tests first.
    for (let i = 0; i < 3; i++) await dispatchOutboxOnce(t.c.db.db, subs, t.c.logger, { batchSize: 500 });
    try {
      const leader = await open(await login(t, o.leaderA.email));
      const userB = await open(await login(t, o.userB1.email));
      const mgrA = await open(await login(t, o.mgrA.email));
      await new Promise((r) => setTimeout(r, 300));
      // A code request by userA1 (whose leader is leaderA) -> notifications for leaderA, mgrA, admins.
      const email = `sse.${o.tag}@base.vn`;
      const [u] = await t.c.db.db.insert(users).values({ email, fullName: "SSE", roles: ["user"], status: "inactive" }).returning();
      await t.c.db.db.execute(sql`INSERT INTO org_memberships (id, user_id, manager_id, leader_id) VALUES (gen_random_uuid(), ${u!.id}, ${o.mgrA.id}, ${o.leaderA.id})`);
      await req("POST", "/auth/codes", {}, { email, purpose: "activate" });
      await req("PUT", `/system/settings/test.sse${o.tag}`, adm.write, { value: 1 });
      for (let i = 0; i < 3; i++) await dispatchOutboxOnce(t.c.db.db, subs, t.c.logger, { batchSize: 500 });
      await new Promise((r) => setTimeout(r, 800));
      expect(leader.text).toContain("notification.notification.created");
      expect(mgrA.text).toContain("notification.notification.created");
      expect(userB.text).not.toContain("notification.notification.created");
      expect(userB.text).not.toContain("auth.code.requested");
      expect(leader.text).toContain("system.setting.changed");
      expect(userB.text).toContain("system.setting.changed");
      // The audience never leaks to clients.
      expect(leader.text).not.toContain("audience");
      // An org change in tree A: seen in tree A, not in tree B.
      const v = (await req("GET", `/org/members/${o.userA1.id}`, adm.read)).json().data.version;
      await req("PATCH", `/org/members/${o.userA1.id}`, adm.write, { version: v, title: "SSE" });
      await dispatchOutboxOnce(t.c.db.db, subs, t.c.logger, { batchSize: 500 });
      await new Promise((r) => setTimeout(r, 800));
      expect(mgrA.text).toContain("org.member.changed");
      expect(userB.text).not.toContain(o.userA1.id);
    } finally {
      ctl.abort();
      await server.close();
      await hub.stop();
    }
  });
});

describe("audit log viewer for Admin (module0 9.3, module1 10)", () => {
  it("filters by person and result, shows detail, exports CSV with the exporter's name; others cannot", async () => {
    const f = encodeURIComponent(JSON.stringify({ and: [{ field: "actor_user_id", op: "eq", value: o.admin.id }] }));
    const list = (await req("GET", `/system/audit-log?filter=${f}&limit=5`, adm.read)).json().data;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].actor_email).toBe(o.admin.email);
    const detail = await req("GET", `/system/audit-log/${list[0].id}`, adm.read);
    expect(detail.json().data.id).toBe(list[0].id);
    const csv = await req("GET", `/system/audit-log/export?filter=${f}`, adm.read);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attachment");
    expect(csv.body).toContain(`Xuất bởi ${o.admin.name}`);
    expect(csv.body).toContain("at,actor_name,actor_email");
    const exported = await t.c.db.db.select().from(auditLog).where(and(eq(auditLog.command, "system.audit.export"), eq(auditLog.actorUserId, o.admin.id)));
    expect(exported.length).toBeGreaterThan(0);
    for (const p of [o.mgrA, o.userA1]) expect((await req("GET", "/system/audit-log", (await login(t, p.email)).read)).statusCode).toBe(403);
  });

  it("private data: values are never written for registered private targets (datahub rows later)", async () => {
    registerPrivateAuditTarget("test_private_row");
    const masked = maskAuditDetails("test_private_row", { changes: [{ field: "amount", old: 1, new: 2 }] }) as { changes: { field: string }[]; values_hidden: boolean };
    expect(masked).toEqual({ changes: [{ field: "amount" }], values_hidden: true });
    expect(maskAuditDetails("deal", { changes: [{ field: "amount", old: 1, new: 2 }] })).toEqual({ changes: [{ field: "amount", old: 1, new: 2 }] });
    // Read path masks too, even if a value slipped in.
    const id = newId();
    await writeAudit(t.c.db.db, { command: "test.private", result: "success", targetType: "test_private_row", targetId: id, details: { changes: [{ field: "x", old: "secret", new: "s2" }] } });
    const f = encodeURIComponent(JSON.stringify({ field: "target_id", op: "eq", value: id }));
    const row = (await req("GET", `/system/audit-log?filter=${f}`, adm.read)).json().data[0];
    expect(JSON.stringify(row.details)).not.toContain("secret");
  });
});

describe("guest data grants framework (module1 5)", () => {
  it("Manager grants data of their tree to a Guest; checks follow tree/team, channel, expiry; Admin cannot grant", async () => {
    registerGrantDataType({ key: "test_deals", label: "Deals (test)", channels: ["web", "export", "api"] });
    try {
      const mA = await login(t, o.mgrA.email);
      expect((await req("GET", "/guest/data-types", mA.read)).json().data.map((d: { key: string }) => d.key)).toContain("test_deals");
      expect((await req("POST", "/guest/grants", mA.write, { guest_user_id: o.userA1.id, data_type: "test_deals", channels: ["web"] })).statusCode).toBe(400);
      expect((await req("POST", "/guest/grants", mA.write, { guest_user_id: o.guestData.id, data_type: "nope", channels: ["web"] })).statusCode).toBe(400);
      expect((await req("POST", "/guest/grants", mA.write, { guest_user_id: o.guestData.id, data_type: "test_deals", scope_leader_id: o.leaderB.id, channels: ["web"] })).statusCode).toBe(400);
      expect((await req("POST", "/guest/grants", adm.write, { guest_user_id: o.guestData.id, data_type: "test_deals", channels: ["web"] })).statusCode).toBe(403);
      const g = (await req("POST", "/guest/grants", mA.write, { guest_user_id: o.guestData.id, data_type: "test_deals", scope_leader_id: o.leaderA.id, channels: ["api", "export"] })).json().data;
      expect(g).toMatchObject({ columns: "system_and_shared", scope_leader_id: o.leaderA.id });
      const can = (owner: string, channel: "web" | "export" | "api") => guestCanAccess(t.c.db.db, { guestUserId: o.guestData.id, dataType: "test_deals", channel, ownerUserId: owner });
      expect(await can(o.userA1.id, "api")).toBe(true); // in leaderA's team
      expect(await can(o.leaderA.id, "export")).toBe(true);
      expect(await can(o.userA1.id, "web")).toBe(false); // channel not granted
      expect(await can(o.mgrA.id, "api")).toBe(false); // outside the team
      expect(await can(o.userB1.id, "api")).toBe(false); // other tree
      const mine = (await req("GET", "/guest/my-grants", (await login(t, o.guestData.email)).read)).json().data;
      expect(mine.map((x: { id: string }) => x.id)).toContain(g.id);
      expect((await req("GET", "/guest/grants", (await login(t, o.mgrB.email)).read)).json().data.map((x: { id: string }) => x.id)).not.toContain(g.id);
      await t.c.db.db.execute(sql`UPDATE data_grants SET expires_at = now() - interval '1 minute' WHERE id = ${g.id}`);
      expect(await can(o.userA1.id, "api")).toBe(false);
      await t.c.db.db.execute(sql`UPDATE data_grants SET expires_at = NULL WHERE id = ${g.id}`);
      expect((await req("POST", `/guest/grants/${g.id}/revoke`, mA.write, { version: g.version })).json().data.revoked_at).not.toBeNull();
      expect(await can(o.userA1.id, "api")).toBe(false);
    } finally {
      unregisterGrantDataType("test_deals");
    }
  });
});
