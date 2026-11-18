import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { authCodes, auditLog, notifications, sessions, systemSettings, users } from "@soe/db";
import { systemScope } from "../src/auth/access";
import { decrypt } from "../src/auth/crypto";
import { isCommonPassword } from "../src/auth/password";
import { adminCreate, authResetCode } from "../src/cli";
import { dispatchOutboxOnce } from "../src/core/outbox-dispatcher";
import { googleSignIn } from "../src/modules/auth/google";
import { createNotificationSubscriber, scrubExpiredCodes } from "../src/modules/notification";
import { PASSWORD, login, seedOrg, sessionFrom, type Org } from "./fixtures";
import { makeApp, type TestApp } from "./helpers";

let t: TestApp;
let o: Org;
beforeAll(async () => {
  t = await makeApp();
  o = await seedOrg(t);
});
afterAll(async () => {
  await t.close();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => t.app.inject({ method: "POST", url: `/api/v1${url}`, payload: payload as object, headers });
const get = (url: string, headers: Record<string, string> = {}) => t.app.inject({ method: "GET", url: `/api/v1${url}`, headers });

async function addPerson(roles: string[], managerId: string | null, leaderId: string | null = null, status = "inactive") {
  const email = `p${Math.random().toString(36).slice(2, 10)}@base.vn`;
  const [u] = await t.c.db.db.insert(users).values({ email, fullName: `Người ${email}`, roles, status, guestPreset: roles.includes("guest") ? "data" : null }).returning();
  if (managerId) await t.c.db.db.execute(sql`INSERT INTO org_memberships (id, user_id, manager_id, leader_id) VALUES (gen_random_uuid(), ${u!.id}, ${managerId}, ${leaderId})`);
  return u!;
}

/** Delivers pending code events into notifications, returns the code a recipient sees. */
async function deliver() {
  await dispatchOutboxOnce(t.c.db.db, [createNotificationSubscriber(t.c.config.AUTH_SECRET)], t.c.logger, { batchSize: 500 });
}

async function latestCodeFor(email: string): Promise<string> {
  const [c] = await t.c.db.db.select().from(authCodes).where(eq(authCodes.email, email)).orderBy(sql`created_at desc`).limit(1);
  await deliver();
  const [n] = await t.c.db.db
    .select()
    .from(notifications)
    .where(and(systemScope(), sql`${notifications.data}->>'code_id' = ${c!.id}`))
    .limit(1);
  return (n!.data as { code: string }).code;
}

async function setSetting(key: string, value: unknown) {
  await t.c.db.db.execute(sql`INSERT INTO system_settings (id, key, value) VALUES (gen_random_uuid(), ${key}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
}

describe("password rules", () => {
  it("blocks common passwords (case-insensitive), too short and too long", async () => {
    expect(isCommonPassword("123456")).toBe(true);
    expect(isCommonPassword("Base123")).toBe(true);
    expect(isCommonPassword("ngua-van-bay-42")).toBe(false);
    const u = await addPerson(["user"], o.mgrA.id);
    await post("/auth/codes", { email: u.email, purpose: "activate" });
    const code = await latestCodeFor(u.email!);
    for (const [pw, reason] of [["12345", "too_short"], ["password1", "common"], ["x".repeat(129), "too_long"]] as const) {
      const r = await post("/auth/codes/verify", { email: u.email, purpose: "activate", code, password: pw });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toMatchObject({ code: "password_rejected", details: { reason } });
    }
    // A rejected password does not burn an attempt.
    const [row] = await t.c.db.db.select().from(authCodes).where(eq(authCodes.email, u.email!)).orderBy(sql`created_at desc`).limit(1);
    expect(row!.attempts).toBe(0);
  });
});

describe("registration with a 6-digit code (module1 6.2, 6.4)", () => {
  it("only allowed domains; only emails in the org chart (unless auto_guest_sale)", async () => {
    const bad = await post("/auth/codes", { email: "someone@gmail.com", purpose: "activate" });
    expect(bad.statusCode).toBe(403);
    const missing = await post("/auth/codes", { email: "not.in.list@base.vn", purpose: "activate" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.message).toBe("Email chưa có trong danh sách. Liên hệ quản lý của bạn.");
    const active = await post("/auth/codes", { email: o.userA1.email, purpose: "activate" });
    expect(active.statusCode).toBe(400);
  });

  it("code goes to the right people, by the requester's role", async () => {
    const admins = (await t.c.db.db.select({ id: users.id }).from(users).where(sql`'admin' = ANY(roles) AND status = 'active' AND kind = 'person'`)).map((r) => r.id);
    const cases: [string, string[], string | null, string | null, string[]][] = [
      ["user", ["user"], o.mgrA.id, o.leaderA.id, [o.leaderA.id, o.mgrA.id]],
      ["leader", ["leader"], o.mgrA.id, null, [o.mgrA.id]],
      ["guest", ["guest"], o.mgrA.id, null, []],
    ];
    for (const [, roles, mgr, ldr, extra] of cases) {
      const u = await addPerson(roles, mgr, ldr);
      const r = await post("/auth/codes", { email: u.email, purpose: "activate" });
      expect(r.statusCode).toBe(201);
      await deliver();
      const got = (await t.c.db.db.select({ userId: notifications.userId }).from(notifications).where(and(systemScope(), sql`${notifications.data}->>'email' = ${u.email}`))).map((n) => n.userId);
      expect(got.sort()).toEqual([...new Set([...extra, ...admins])].sort());
    }
    // Admin: the other admins only (never themselves).
    const r = await post("/auth/codes", { email: o.admin.email, purpose: "reset" });
    expect(r.statusCode).toBe(201);
    await deliver();
    const got = (await t.c.db.db.select({ userId: notifications.userId }).from(notifications).where(and(systemScope(), sql`${notifications.data}->>'email' = ${o.admin.email}`))).map((n) => n.userId);
    expect(got).not.toContain(o.admin.id);
    expect(got).toContain(o.admin2.id);
  });

  it("the notification text names the requester; the code is encrypted in the outbox, hashed in auth_codes", async () => {
    const u = await addPerson(["user"], o.mgrA.id, o.leaderA.id);
    await post("/auth/codes", { email: u.email, purpose: "activate" });
    const [ev] = (await t.c.db.db.execute(sql`SELECT payload FROM outbox WHERE event = 'auth.code.requested' AND payload->>'email' = ${u.email}`)).rows as { payload: { code_enc: string } }[];
    const code = decrypt(t.c.config.AUTH_SECRET, ev!.payload.code_enc);
    expect(JSON.stringify(ev!.payload)).not.toContain(code);
    const [row] = await t.c.db.db.select().from(authCodes).where(eq(authCodes.email, u.email!));
    expect(row!.codeHash).not.toContain(code);
    await deliver();
    const leaderSession = await login(t, o.leaderA.email);
    const list = await get("/notifications?unread_only=true", leaderSession.read);
    const mine = list.json().data.find((n: { data: { email: string } }) => n.data.email === u.email);
    expect(mine.body).toContain(u.fullName);
    expect(mine.body).toContain(code);
    expect((await get("/notifications/unread-count", leaderSession.read)).json().data.unread).toBeGreaterThan(0);
    const mark = await post("/notifications/read", { ids: [mine.id] }, leaderSession.write);
    expect(mark.json().data.marked).toBe(1);
  });

  it("correct code + password activates the account and logs in", async () => {
    const u = await addPerson(["user"], o.mgrA.id, o.leaderA.id);
    await post("/auth/codes", { email: u.email, purpose: "activate" });
    const code = await latestCodeFor(u.email!);
    const r = await post("/auth/codes/verify", { email: u.email, purpose: "activate", code, password: PASSWORD });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.user.status).toBe("active");
    expect(JSON.stringify(r.json())).not.toContain(sessionFrom(r.headers["set-cookie"]).cookie.split("=")[1]!.split(";")[0]);
    const s = sessionFrom(r.headers["set-cookie"]);
    expect((await get("/auth/me", s.read)).json().data.user.email).toBe(u.email);
    // Single use.
    const again = await post("/auth/codes/verify", { email: u.email, purpose: "activate", code, password: PASSWORD });
    expect(again.json().error.code).toBe("code_invalid");
    const audits = await t.c.db.db.select().from(auditLog).where(and(eq(auditLog.command, "auth.code.verify"), eq(auditLog.targetId, u.id)));
    expect(audits.some((a) => a.result === "success")).toBe(true);
  });

  it("5 wrong tries kill the code; each wrong try is audited", async () => {
    const u = await addPerson(["user"], o.mgrA.id);
    await post("/auth/codes", { email: u.email, purpose: "activate" });
    const code = await latestCodeFor(u.email!);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await post("/auth/codes/verify", { email: u.email, purpose: "activate", code: wrong, password: PASSWORD });
      expect(r.json().error.code).toBe("code_invalid");
    }
    const r = await post("/auth/codes/verify", { email: u.email, purpose: "activate", code, password: PASSWORD });
    expect(r.json().error.code).toBe("code_invalid");
    const [row] = await t.c.db.db.select().from(authCodes).where(eq(authCodes.email, u.email!));
    expect(row).toMatchObject({ status: "dead", attempts: 5 });
    const fails = await t.c.db.db.select().from(auditLog).where(and(eq(auditLog.command, "auth.code.verify"), eq(auditLog.result, "error"), eq(auditLog.targetId, row!.id)));
    expect(fails.length).toBeGreaterThanOrEqual(5);
  });

  it("codes expire after 6 hours", async () => {
    const u = await addPerson(["user"], o.mgrA.id);
    const r = await post("/auth/codes", { email: u.email, purpose: "activate" });
    const exp = new Date(r.json().data.expires_at).getTime();
    expect(exp - Date.now()).toBeGreaterThan(5.9 * 3600_000);
    expect(exp - Date.now()).toBeLessThanOrEqual(6 * 3600_000);
    const code = await latestCodeFor(u.email!);
    await t.c.db.db.update(authCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authCodes.email, u.email!));
    const v = await post("/auth/codes/verify", { email: u.email, purpose: "activate", code, password: PASSWORD });
    expect(v.json().error.code).toBe("code_invalid");
  });

  it("3 requests per email per hour; a new request cancels the previous code", async () => {
    const u = await addPerson(["user"], o.mgrA.id);
    await post("/auth/codes", { email: u.email, purpose: "activate" });
    const first = await latestCodeFor(u.email!);
    await post("/auth/codes", { email: u.email, purpose: "activate" });
    const second = await latestCodeFor(u.email!);
    expect((await post("/auth/codes", { email: u.email, purpose: "activate" })).statusCode).toBe(201);
    const fourth = await post("/auth/codes", { email: u.email, purpose: "activate" });
    expect(fourth.statusCode).toBe(429);
    const statuses = (await t.c.db.db.select().from(authCodes).where(eq(authCodes.email, u.email!))).map((c) => c.status).sort();
    expect(statuses).toEqual(["cancelled", "cancelled", "pending"]);
    if (first !== second) {
      const old = await post("/auth/codes/verify", { email: u.email, purpose: "activate", code: first, password: PASSWORD });
      expect(old.json().error.code).toBe("code_invalid");
    }
  });

  it("auto_guest_sale: off rejects unknown emails; on creates a Guest Sale when the code is used", async () => {
    const email = `walkin.${o.tag}@base.vn`;
    expect((await post("/auth/codes", { email, purpose: "activate" })).statusCode).toBe(404);
    await setSetting("auth.auto_guest_sale", true);
    try {
      const r = await post("/auth/codes", { email, purpose: "activate" });
      expect(r.statusCode).toBe(201);
      expect(await t.c.db.db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
      const code = await latestCodeFor(email);
      const v = await post("/auth/codes/verify", { email, purpose: "activate", code, password: PASSWORD });
      expect(v.statusCode).toBe(200);
      expect(v.json().data.user).toMatchObject({ roles: ["guest"], guest_preset: "sale", status: "active" });
    } finally {
      await setSetting("auth.auto_guest_sale", false);
    }
  });

  it("the code in a notification is hidden after 6 hours (read and scrub job)", async () => {
    const u = await addPerson(["user"], o.mgrA.id, o.leaderA.id);
    await post("/auth/codes", { email: u.email, purpose: "activate" });
    const code = await latestCodeFor(u.email!);
    await t.c.db.db.execute(sql`UPDATE notifications SET created_at = now() - interval '7 hours' WHERE /*scope:system*/ data->>'email' = ${u.email}`);
    const s = await login(t, o.leaderA.email);
    const list = await get("/notifications?limit=500", s.read);
    const n = list.json().data.find((x: { data: { email: string } }) => x.data.email === u.email);
    expect(n.body).not.toContain(code);
    expect(n.data.code).toBeUndefined();
    expect(n.data.code_hidden).toBe(true);
    expect(await scrubExpiredCodes(t.c.db.db)).toBeGreaterThan(0);
    const [row] = await t.c.db.db.select().from(notifications).where(and(systemScope(), eq(notifications.id, n.id)));
    expect(row!.body).not.toContain(code);
    expect(row!.scrubbedAt).not.toBeNull();
  });
});

describe("forgot password (module1 6.3)", () => {
  it("reset code sets a new password and signs out every other session", async () => {
    const u = await addPerson(["user"], o.mgrB.id, o.leaderB.id);
    await post("/auth/codes", { email: u.email, purpose: "activate" });
    await post("/auth/codes/verify", { email: u.email, purpose: "activate", code: await latestCodeFor(u.email!), password: PASSWORD });
    const old = await login(t, u.email!);
    expect((await post("/auth/codes", { email: "unknown.x@base.vn", purpose: "reset" })).statusCode).toBe(404);
    await post("/auth/codes", { email: u.email, purpose: "reset" });
    const code = await latestCodeFor(u.email!);
    const r = await post("/auth/codes/verify", { email: u.email, purpose: "reset", code, password: "mot-mat-khau-moi" });
    expect(r.statusCode).toBe(200);
    expect((await get("/auth/me", old.read)).statusCode).toBe(401);
    await expect(login(t, u.email!)).rejects.toThrow();
    await login(t, u.email!, "mot-mat-khau-moi");
  });
});

describe("login lockout (module1 6.5)", () => {
  it("5 wrong passwords lock the account for 15 minutes, even for the right password", async () => {
    const email = o.userB1.email;
    for (let i = 0; i < 4; i++) expect((await post("/auth/login", { email, password: "sai-mat-khau" })).json().error.code).toBe("invalid_credentials");
    const fifth = await post("/auth/login", { email, password: "sai-mat-khau" });
    expect(fifth.statusCode).toBe(423);
    const right = await post("/auth/login", { email, password: PASSWORD });
    expect(right.json().error.code).toBe("account_locked");
    const [u] = await t.c.db.db.select().from(users).where(eq(users.email, email));
    const mins = (u!.lockedUntil!.getTime() - Date.now()) / 60000;
    expect(mins).toBeGreaterThan(14);
    expect(mins).toBeLessThanOrEqual(15);
    await t.c.db.db.update(users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(users.email, email));
    expect((await post("/auth/login", { email, password: PASSWORD })).statusCode).toBe(200);
    const fails = await t.c.db.db.select().from(auditLog).where(and(eq(auditLog.command, "auth.login"), eq(auditLog.result, "error"), eq(auditLog.targetId, u!.id)));
    expect(fails.length).toBeGreaterThanOrEqual(6);
  });

  it("unknown email and inactive account fail without saying which part was wrong", async () => {
    expect((await post("/auth/login", { email: "nobody@base.vn", password: "x" })).json().error.code).toBe("invalid_credentials");
    const u = await addPerson(["user"], o.mgrA.id);
    expect((await post("/auth/login", { email: u.email, password: "x" })).json().error.message).toContain("chưa kích hoạt");
  });
});

describe("sessions (module1 6.5)", () => {
  it("cookies are httpOnly + SameSite=Lax; the session token never appears in the body", async () => {
    const r = await post("/auth/login", { email: o.userA2.email, password: PASSWORD });
    const cookies = r.headers["set-cookie"] as string[];
    const sess = cookies.find((c) => c.startsWith("soe_session="))!;
    expect(sess).toMatch(/HttpOnly/i);
    expect(sess).toMatch(/SameSite=Lax/i);
    expect(cookies.find((c) => c.startsWith("soe_csrf="))).not.toMatch(/HttpOnly/i);
    const token = sess.split(";")[0]!.split("=")[1]!;
    expect(r.body).not.toContain(token);
  });

  it("expires after 7 days idle and after 30 days in all", async () => {
    const s1 = await login(t, o.userA2.email);
    expect((await get("/auth/me", s1.read)).statusCode).toBe(200);
    const sid1 = (await get("/auth/me", s1.read)).json();
    expect(sid1.data.via).toBe("web");
    await t.c.db.db.execute(sql`UPDATE sessions SET last_seen_at = now() - interval '7 days 1 minute' WHERE user_id = ${o.userA2.id} AND revoked_at IS NULL`);
    expect((await get("/auth/me", s1.read)).statusCode).toBe(401);
    const s2 = await login(t, o.userA2.email);
    await t.c.db.db.execute(sql`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = ${o.userA2.id} AND revoked_at IS NULL`);
    expect((await get("/auth/me", s2.read)).statusCode).toBe(401);
    const s3 = await login(t, o.userA2.email);
    const [row] = await t.c.db.db.select().from(sessions).where(and(eq(sessions.userId, o.userA2.id), sql`revoked_at IS NULL`)).orderBy(sql`created_at desc`).limit(1);
    const days = (row!.expiresAt.getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    expect((await get("/auth/me", s3.read)).statusCode).toBe(200);
  });

  it("list devices, sign out one device, logout, admin revokes everything", async () => {
    const a = await login(t, o.leaderB.email);
    const b = await login(t, o.leaderB.email);
    const list = (await get("/auth/sessions", a.read)).json().data;
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const other = list.find((s: { current: boolean }) => !s.current);
    expect((await t.app.inject({ method: "DELETE", url: `/api/v1/auth/sessions/${other.id}`, headers: a.write })).statusCode).toBe(200);
    expect((await get("/auth/me", b.read)).statusCode).toBe(401);
    // Someone else's session id: not found.
    const c = await login(t, o.userA1.email);
    expect((await t.app.inject({ method: "DELETE", url: `/api/v1/auth/sessions/${list.find((s: { current: boolean }) => s.current).id}`, headers: c.write })).statusCode).toBe(404);
    // Admin revokes all of leaderB.
    const adm = await login(t, o.admin.email);
    const rv = await post(`/admin/users/${o.leaderB.id}/sessions/revoke`, {}, adm.write);
    expect(rv.json().data.revoked).toBeGreaterThanOrEqual(1);
    expect((await get("/auth/me", a.read)).statusCode).toBe(401);
    // Logout clears cookies and kills the session.
    const out = await post("/auth/logout", {}, c.write);
    expect(out.statusCode).toBe(200);
    expect((await get("/auth/me", c.read)).statusCode).toBe(401);
  });

  it("change password: needs the current one; signs out other devices, keeps this one", async () => {
    const email = o.userA1.email;
    const a = await login(t, email);
    const b = await login(t, email);
    expect((await post("/auth/password", { current_password: "sai", new_password: "doi-mat-khau-1" }, a.write)).json().error.code).toBe("invalid_credentials");
    const ok = await post("/auth/password", { current_password: PASSWORD, new_password: "doi-mat-khau-1" }, a.write);
    expect(ok.json().data.other_sessions_revoked).toBeGreaterThanOrEqual(1);
    expect((await get("/auth/me", a.read)).statusCode).toBe(200);
    expect((await get("/auth/me", b.read)).statusCode).toBe(401);
    await post("/auth/password", { current_password: "doi-mat-khau-1", new_password: PASSWORD }, a.write);
  });
});

describe("CSRF double submit for cookie writes", () => {
  it("cookie write without / with a wrong header is refused; reads and bearer writes need none", async () => {
    const s = await login(t, o.userA2.email);
    const noHeader = await post("/notifications/read", { all: true }, s.read);
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json().error.code).toBe("csrf_failed");
    const wrong = await post("/notifications/read", { all: true }, { ...s.read, "x-csrf-token": "abc" });
    expect(wrong.json().error.code).toBe("csrf_failed");
    // Header equal to another session's token: still refused (bound to the session).
    const other = await login(t, o.userA2.email);
    const cross = await post("/notifications/read", { all: true }, { cookie: s.cookie, "x-csrf-token": other.csrf });
    expect(cross.json().error.code).toBe("csrf_failed");
    expect((await post("/notifications/read", { all: true }, s.write)).statusCode).toBe(200);
    expect((await get("/notifications/unread-count", s.read)).statusCode).toBe(200);
    const denied = await t.c.db.db.select().from(auditLog).where(and(eq(auditLog.command, "http.authenticate"), eq(auditLog.errorCode, "csrf_failed")));
    expect(denied.length).toBeGreaterThan(0);
  });
});

describe("Google login (module1 6.7)", () => {
  it("is off by default", async () => {
    expect((await get("/auth/config")).json().data.google_enabled).toBe(false);
    const r = await t.app.inject({ method: "GET", url: "/api/auth/google/start" });
    expect(r.statusCode).toBe(404);
  });

  it("activates an org-chart email without a code, and forces a password before anything else", async () => {
    const u = await addPerson(["user"], o.mgrA.id, o.leaderA.id);
    const r = await googleSignIn(t.c.db.db, t.c.config, { email: u.email!.toUpperCase(), emailVerified: true, sub: "g-1" }, { ip: "127.0.0.1", userAgent: "t" });
    expect(r.mustSetPassword).toBe(true);
    const cookie = `soe_session=${r.session.token}; soe_csrf=${r.session.csrf}`;
    const h = { cookie };
    expect((await get("/auth/me", h)).json().data.must_set_password).toBe(true);
    const blocked = await get("/org/members", h);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("password_setup_required");
    expect((await post("/auth/password/set", { new_password: PASSWORD }, { ...h, "x-csrf-token": r.session.csrf })).statusCode).toBe(200);
    expect((await get("/org/members", h)).statusCode).toBe(200);
    // Next time with password works.
    await login(t, u.email!);
  });

  it("refuses unknown emails, other domains, unverified emails and locked accounts", async () => {
    const req = { ip: "1.1.1.1", userAgent: null };
    await expect(googleSignIn(t.c.db.db, t.c.config, { email: "x@gmail.com", emailVerified: true, sub: "s" }, req)).rejects.toMatchObject({ code: "forbidden" });
    await expect(googleSignIn(t.c.db.db, t.c.config, { email: "ghost@base.vn", emailVerified: true, sub: "s" }, req)).rejects.toMatchObject({ code: "forbidden" });
    await expect(googleSignIn(t.c.db.db, t.c.config, { email: o.userA2.email, emailVerified: false, sub: "s" }, req)).rejects.toMatchObject({ code: "forbidden" });
    const locked = await addPerson(["user"], o.mgrA.id, null, "locked");
    await expect(googleSignIn(t.c.db.db, t.c.config, { email: locked.email!, emailVerified: true, sub: "s" }, req)).rejects.toMatchObject({ code: "account_locked" });
  });
});

describe("server commands (module1 6.6)", () => {
  it("admin:create prints an activation code that works; auth:reset-code prints a reset code; both audited via worker", async () => {
    const email = `first.admin.${o.tag}@base.vn`;
    const r = await adminCreate(t.c.db.db, t.c.config, email, "Admin đầu tiên");
    expect(r.code).toMatch(/^\d{6}$/);
    const v = await post("/auth/codes/verify", { email, purpose: "activate", code: r.code, password: PASSWORD });
    expect(v.json().data.user.roles).toEqual(["admin"]);
    const rc = await authResetCode(t.c.db.db, t.c.config, email);
    const v2 = await post("/auth/codes/verify", { email, purpose: "reset", code: rc.code, password: "mat-khau-admin-moi" });
    expect(v2.statusCode).toBe(200);
    const audits = await t.c.db.db.select().from(auditLog).where(sql`${auditLog.command} IN ('cli.admin.create', 'cli.auth.reset_code') AND details->>'email' = ${email}`);
    expect(audits.map((a) => a.via).sort()).toEqual(["worker", "worker"]);
    await expect(adminCreate(t.c.db.db, t.c.config, email)).rejects.toMatchObject({ code: "validation_error" });
  });
});

describe("settings", () => {
  it("known settings are validated", async () => {
    const adm = await login(t, o.admin.email);
    const bad = await t.app.inject({ method: "PUT", url: "/api/v1/system/settings/audit.retention_days", headers: adm.write, payload: { value: 30 } });
    expect(bad.statusCode).toBe(400);
    const badDomain = await t.app.inject({ method: "PUT", url: "/api/v1/system/settings/auth.allowed_domains", headers: adm.write, payload: { value: ["not a domain"] } });
    expect(badDomain.statusCode).toBe(400);
    const cat = await get("/system/settings-catalog", adm.read);
    expect(cat.json().data.map((d: { key: string }) => d.key)).toEqual(expect.arrayContaining(["auth.allowed_domains", "auth.auto_guest_sale", "auth.google_enabled", "trash.retention_days"]));
    const [s] = await t.c.db.db.select().from(systemSettings).where(eq(systemSettings.key, "audit.retention_days"));
    expect(s).toBeUndefined();
  });

  it("the list returns real JSON values (found by the browser tests)", async () => {
    const adm = await login(t, o.admin.email);
    const put = async (key: string, value: unknown) => {
      const cur = await get(`/system/settings/${key}`, adm.read); // other tests may have created it already
      const version = cur.statusCode === 200 ? cur.json().data.version : undefined;
      return t.app.inject({ method: "PUT", url: `/api/v1/system/settings/${key}`, headers: adm.write, payload: { value, ...(version ? { version } : {}) } });
    };
    expect((await put("auth.auto_guest_sale", true)).statusCode).toBe(200);
    expect((await put("trash.retention_days", 9)).statusCode).toBe(200);
    expect((await put("auth.allowed_domains", ["base.vn", "example.com"])).statusCode).toBe(200);
    const rows = (await get("/system/settings?limit=50", adm.read)).json().data as { key: string; value: unknown }[];
    const val = (k: string) => rows.find((r) => r.key === k)?.value;
    expect(val("auth.auto_guest_sale")).toBe(true);
    expect(val("trash.retention_days")).toBe(9);
    expect(val("auth.allowed_domains")).toEqual(["base.vn", "example.com"]);
    // Put the defaults back: the database is shared with later test files.
    expect((await put("auth.auto_guest_sale", false)).statusCode).toBe(200);
    expect((await put("trash.retention_days", 7)).statusCode).toBe(200);
    expect((await put("auth.allowed_domains", ["base.vn"])).statusCode).toBe(200);
  });

  it("org.member.list returns roles as an array, like org.member.get", async () => {
    const adm = await login(t, o.admin.email);
    const rows = (await get("/org/members?limit=50", adm.read)).json().data as { id: string; roles: unknown }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(Array.isArray(r.roles)).toBe(true);
    const admin = rows.find((r) => r.id === o.admin.id);
    expect(admin?.roles).toContain("admin");
  });
});
