import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PASSWORD, seedOrg, type Org } from "./fixtures";
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

const rows = async (command: string, since: Date) =>
  (await t.c.db.db.execute(sql`SELECT via, ip, actor_user_id, result, details FROM audit_log WHERE command = ${command} AND at >= ${since.toISOString()}::timestamptz ORDER BY at`)).rows as {
    via: string | null;
    ip: string | null;
    actor_user_id: string | null;
    result: string;
    details: { email?: string; message?: string };
  }[];

describe("audit log noise and anonymous rows", () => {
  it("an anonymous read (auth.me before login) is not written to the audit log", async () => {
    const since = new Date(Date.now() - 1000);
    for (let i = 0; i < 3; i++) expect((await t.app.inject({ method: "GET", url: "/api/v1/auth/me" })).statusCode).toBe(401);
    expect(await rows("auth.me", since)).toEqual([]);
  });

  it("signed-in polling reads (me, unread count, settings, catalog) are not audited either", async () => {
    const since = new Date(Date.now() - 1000);
    const login = await t.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: o.admin.email, password: PASSWORD } });
    const cookie = (login.headers["set-cookie"] as string[]).map((c) => c.split(";")[0]).join("; ");
    for (const url of ["/auth/me", "/notifications/unread-count", "/system/settings?limit=5", "/system/settings-catalog"]) {
      expect((await t.app.inject({ method: "GET", url: `/api/v1${url}`, headers: { cookie } })).statusCode).toBe(200);
    }
    for (const c of ["auth.me", "notification.unread_count", "system.setting.list", "system.setting.catalog"]) expect(await rows(c, since), c).toEqual([]);
  });

  it("anonymous rows always have a channel and the IP, and keep the email that was tried (never the password)", async () => {
    const since = new Date(Date.now() - 1000);
    const bad = { email: o.userA1.email, password: "sai-mat-khau-12345" };
    await t.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: bad, headers: { "sec-fetch-site": "same-origin", "user-agent": "browser-test" } });
    await t.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: bad });
    const r = await rows("auth.login", since);
    const failed = r.filter((x) => x.result === "error");
    expect(failed.map((x) => x.via)).toEqual(["web", "api"]);
    for (const x of failed) {
      expect(x.actor_user_id).toBeNull();
      expect(x.ip).toBeTruthy();
      expect(x.details.message ?? "").not.toContain(bad.password);
      expect(JSON.stringify(x.details)).not.toContain(bad.password);
    }
    const code = await t.app.inject({ method: "POST", url: "/api/v1/auth/codes", payload: { email: o.userA1.email, purpose: "reset" }, headers: { "sec-fetch-site": "same-origin" } });
    expect(code.statusCode).toBeLessThan(300);
    const c = await rows("auth.code.request", since);
    expect(c[0]).toMatchObject({ via: "web", actor_user_id: null });
    expect(c[0]!.details.email).toBe(o.userA1.email);
  });

  it("an anonymous write that is refused is still audited, with its channel", async () => {
    const since = new Date(Date.now() - 1000);
    expect((await t.app.inject({ method: "POST", url: "/api/v1/auth/logout", payload: {} })).statusCode).toBe(401);
    const r = await rows("auth.logout", since);
    expect(r[0]).toMatchObject({ result: "denied", via: "api" });
  });
});
