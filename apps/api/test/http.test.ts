import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { auditLog, outbox, rowHistory } from "@soe/db";
import { eq } from "drizzle-orm";
import { DEV_USER, devHeaders, makeApp, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

const uniq = () => `t.${Math.random().toString(36).slice(2, 10)}`;

describe("standard error format", () => {
  it("unknown route: 404 not_found in the standard body", async () => {
    const r = await t.app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: { code: "not_found", message: expect.any(String), request_id: expect.any(String) } });
  });

  it("invalid input: 400 validation_error with issues", async () => {
    const r = await t.app.inject({ method: "PUT", url: `/api/v1/system/settings/BAD KEY`, headers: devHeaders(), payload: { value: 1 } });
    expect(r.statusCode).toBe(400);
    const b = r.json();
    expect(b.error.code).toBe("validation_error");
    expect(b.error.details.issues[0]).toMatchObject({ path: "key" });
  });

  it("broken JSON: 400 in the standard body", async () => {
    const r = await t.app.inject({ method: "PUT", url: `/api/v1/system/settings/a.b`, headers: { ...devHeaders(), "content-type": "application/json" }, payload: "{oops" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("validation_error");
  });

  it("wrong media type: 415", async () => {
    const r = await t.app.inject({ method: "PUT", url: `/api/v1/system/settings/a.b`, headers: { ...devHeaders(), "content-type": "text/plain" }, payload: "x" });
    expect(r.statusCode).toBe(415);
    expect(r.json().error.code).toBe("unsupported_media_type");
  });

  it("every response carries x-request-id; a sane client id is echoed", async () => {
    const r = await t.app.inject({ method: "GET", url: "/api/v1/system/ping", headers: { "x-request-id": "client-req-12345" } });
    expect(r.headers["x-request-id"]).toBe("client-req-12345");
    const r2 = await t.app.inject({ method: "GET", url: "/api/v1/system/ping", headers: { "x-request-id": "bad id with spaces" } });
    expect(r2.headers["x-request-id"]).not.toBe("bad id with spaces");
  });
});

describe("security headers", () => {
  it("sets helmet headers, noindex and no-store", async () => {
    const r = await t.app.inject({ method: "GET", url: "/api/v1/system/ping" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(r.headers["x-frame-options"]).toBeDefined();
    expect(r.headers["x-robots-tag"]).toContain("noindex");
    expect(r.headers["cache-control"]).toBe("no-store");
  });
});

describe("health", () => {
  it("/health is public and reports db ok", async () => {
    const r = await t.app.inject({ method: "GET", url: "/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "ok", db: "ok" });
  });
});

describe("permission check is pluggable and enforced at the server", () => {
  it("denied: 403 forbidden and an audit row with result=denied", async () => {
    const r = await t.app.inject({ method: "GET", url: "/api/v1/system/whoami", headers: devHeaders(DEV_USER, { "x-dev-scopes": "something:else" }) });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("forbidden");
    const rows = await t.c.db.db.select().from(auditLog).where(eq(auditLog.requestId, r.headers["x-request-id"] as string));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ command: "system.whoami", result: "denied", errorCode: "forbidden", actorUserId: DEV_USER });
  });

  it("the right scope passes", async () => {
    const r = await t.app.inject({ method: "GET", url: "/api/v1/system/whoami", headers: devHeaders(DEV_USER, { "x-dev-scopes": "system:whoami" }) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.user_id).toBe(DEV_USER);
  });

  it("AI channel (mcp) cannot call an operation with aiAllowed=false", async () => {
    const r = await t.c.executor
      .execute("system.setting.set", { key: uniq(), value: 1 }, { actor: { userId: DEV_USER, via: "mcp", connectionId: null, automationId: null, scopes: [], ip: null, userAgent: null }, requestId: "r-ai-0001" })
      .catch((e) => e);
    expect(r).toMatchObject({ code: "ai_not_allowed" });
    const rows = await t.c.db.db.select().from(auditLog).where(eq(auditLog.requestId, "r-ai-0001"));
    expect(rows[0]).toMatchObject({ result: "denied", errorCode: "ai_not_allowed", via: "mcp" });
  });
});

describe("production is locked until Stage 1", () => {
  it("every request that needs an actor is refused; public ones still work", async () => {
    const p = await makeApp({ NODE_ENV: "production", isProduction: true, devAuthEnabled: false, STORAGE_SIGNING_SECRET: "x".repeat(32) });
    try {
      const h = { "x-dev-actor": DEV_USER };
      for (const url of ["/api/v1/system/whoami", "/api/v1/system/settings", "/api/openapi.json", "/api/docs/", "/api/v1/events"]) {
        const r = await p.app.inject({ method: "GET", url, headers: h });
        expect(r.statusCode, url).toBe(401);
        expect(r.json().error.code).toBe("unauthenticated");
      }
      const w = await p.app.inject({ method: "PUT", url: "/api/v1/system/settings/a.b", headers: h, payload: { value: 1 } });
      expect(w.statusCode).toBe(401);
      expect((await p.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      expect((await p.app.inject({ method: "GET", url: "/api/v1/system/ping" })).statusCode).toBe(200);
      expect(p.c.auth.mode).toBe("locked");
    } finally {
      await p.close();
    }
  });

  it("production config refuses the default signing secret", async () => {
    const { loadConfig } = await import("../src/config");
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://x/y", STORAGE_DRIVER: "local" })).toThrow(/STORAGE_SIGNING_SECRET/);
  });
});

describe("settings: version, audit, history, outbox in one transaction", () => {
  it("create, update with version, conflict on stale version", async () => {
    const key = uniq();
    const url = `/api/v1/system/settings/${key}`;
    const created = await t.app.inject({ method: "PUT", url, headers: devHeaders(), payload: { value: { n: 1 } } });
    expect(created.statusCode).toBe(200);
    expect(created.json().data).toMatchObject({ key, version: 1, value: { n: 1 } });

    const noVersion = await t.app.inject({ method: "PUT", url, headers: devHeaders(), payload: { value: { n: 2 } } });
    expect(noVersion.statusCode).toBe(400);

    const ok = await t.app.inject({ method: "PUT", url, headers: devHeaders(), payload: { value: { n: 2 }, version: 1 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.version).toBe(2);

    const stale = await t.app.inject({ method: "PUT", url, headers: devHeaders(), payload: { value: { n: 3 }, version: 1 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: "conflict", details: { current_version: 2, sent_version: 1 } });

    const got = await t.app.inject({ method: "GET", url, headers: devHeaders() });
    expect(got.json().data.value).toEqual({ n: 2 });

    // audit (success x2, error x1), row history (create + update), outbox (2 events)
    const audits = await t.c.db.db.select().from(auditLog).where(sql`${auditLog.details}->>'key' = ${key} OR ${auditLog.details}::text LIKE ${"%" + key + "%"}`);
    expect(audits.filter((a) => a.result === "success")).toHaveLength(2);
    const hist = await t.c.db.db.select().from(rowHistory).where(sql`${rowHistory.rowId} = ${created.json().data ? (await t.c.db.db.execute(sql`select id from system_settings where key = ${key}`)).rows[0]!.id : ""}`);
    expect(hist.map((h) => h.op).sort()).toEqual(["create", "update"]);
    const ev = await t.c.db.db.select().from(outbox).where(sql`${outbox.payload}->>'key' = ${key}`);
    expect(ev).toHaveLength(2);
  });

  it("an error after emit rolls back data, event and success audit; the failure itself is audited", async () => {
    const { defineCommand } = await import("../src/core/registry");
    const { z } = await import("zod");
    const { systemSettings } = await import("@soe/db");
    const key = uniq();
    const bad = defineCommand({
      name: "test.boom.run",
      summary: "test",
      permission: "test:run",
      aiAllowed: true,
      emits: ["system.setting.changed"],
      input: z.object({}),
      http: { method: "POST", path: "/test/boom" },
      handler: async (ctx) => {
        await ctx.db.insert(systemSettings).values({ key, value: 1 });
        await ctx.emit("system.setting.changed", { aggregateType: "x", aggregateId: key, payload: { key, version: 1 } });
        throw new Error("boom after emit");
      },
    });
    t.c.registry.register(bad);
    const r = await t.c.executor.execute("test.boom.run", {}, { actor: { userId: DEV_USER, via: "api", connectionId: null, automationId: null, scopes: [], ip: null, userAgent: null }, requestId: "r-boom-0001" }).catch((e) => e);
    expect(r).toMatchObject({ code: "internal_error" });
    expect((await t.c.db.db.execute(sql`select 1 from system_settings where key = ${key}`)).rows).toHaveLength(0);
    expect(await t.c.db.db.select().from(outbox).where(eq(outbox.aggregateId, key))).toHaveLength(0);
    const audits = await t.c.db.db.select().from(auditLog).where(eq(auditLog.requestId, "r-boom-0001"));
    expect(audits.map((a) => a.result)).toEqual(["error"]);
  });

  it("emitting an event that the command did not declare is a programming error", async () => {
    const { defineCommand } = await import("../src/core/registry");
    const { z } = await import("zod");
    t.c.registry.register(
      defineCommand({
        name: "test.undeclared.run", summary: "t", permission: "t:x", aiAllowed: true, input: z.object({}), http: { method: "POST", path: "/test/undeclared" },
        handler: async (ctx) => { await ctx.emit("system.setting.changed", { payload: { key: "k", version: 1 } }); },
      }),
    );
    const err = await t.c.executor.execute("test.undeclared.run", {}, { actor: { userId: DEV_USER, via: "api", connectionId: null, automationId: null, scopes: [], ip: null, userAgent: null }, requestId: "r-undecl-001" }).catch((e) => e);
    expect(err).toMatchObject({ code: "internal_error" });
  });
});

describe("Idempotency-Key", () => {
  it("same key + same body: one execution, same response, replay header", async () => {
    const key = uniq();
    const headers = { ...devHeaders(), "idempotency-key": `idem-${key}-0001` };
    const url = `/api/v1/system/settings/${key}`;
    const a = await t.app.inject({ method: "PUT", url, headers, payload: { value: "x" } });
    const b = await t.app.inject({ method: "PUT", url, headers, payload: { value: "x" } });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(a.headers["idempotent-replayed"]).toBeUndefined();
    const ev = await t.c.db.db.select().from(outbox).where(sql`${outbox.payload}->>'key' = ${key}`);
    expect(ev).toHaveLength(1);
  });

  it("same key + different body: 422 idempotency_key_reuse", async () => {
    const key = uniq();
    const headers = { ...devHeaders(), "idempotency-key": `idem-${key}-0002` };
    const url = `/api/v1/system/settings/${key}`;
    await t.app.inject({ method: "PUT", url, headers, payload: { value: "x" } });
    const r = await t.app.inject({ method: "PUT", url, headers, payload: { value: "y" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("idempotency_key_reuse");
  });

  it("a malformed key is rejected", async () => {
    const r = await t.app.inject({ method: "PUT", url: `/api/v1/system/settings/${uniq()}`, headers: { ...devHeaders(), "idempotency-key": "short" }, payload: { value: 1 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("idempotency_key_invalid");
  });

  it("the same key from two different users does not collide", async () => {
    const k = `idem-${uniq()}-0003`;
    const key = uniq();
    const a = await t.app.inject({ method: "PUT", url: `/api/v1/system/settings/${key}`, headers: { ...devHeaders(), "idempotency-key": k }, payload: { value: 1 } });
    const b = await t.app.inject({ method: "PUT", url: `/api/v1/system/settings/${uniq()}`, headers: { ...devHeaders("01900000-0000-7000-8000-0000000000bb"), "idempotency-key": k }, payload: { value: 1 } });
    expect(a.headers["idempotent-replayed"]).toBeUndefined();
    expect(b.headers["idempotent-replayed"]).toBeUndefined();
    expect(b.statusCode).toBe(200);
  });
});

describe("audit list: filter DSL and keyset over HTTP", () => {
  it("filters, pages with next_cursor, and reports total on request", async () => {
    for (let i = 0; i < 6; i++) await t.app.inject({ method: "GET", url: "/api/v1/system/whoami", headers: devHeaders(DEV_USER, { "x-dev-scopes": "nope" }) });
    const filter = encodeURIComponent(JSON.stringify({ and: [{ field: "command", op: "eq", value: "system.whoami" }, { field: "result", op: "eq", value: "denied" }] }));
    const p1 = await t.app.inject({ method: "GET", url: `/api/v1/system/audit-log?filter=${filter}&limit=4&include_total=true`, headers: devHeaders() });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json();
    expect(b1.data).toHaveLength(4);
    expect(b1.next_cursor).toEqual(expect.any(String));
    expect(b1.total).toBeGreaterThanOrEqual(6);
    const p2 = await t.app.inject({ method: "GET", url: `/api/v1/system/audit-log?filter=${filter}&limit=4&cursor=${b1.next_cursor}`, headers: devHeaders() });
    const ids1 = new Set(b1.data.map((r: { id: string }) => r.id));
    expect(p2.json().data.every((r: { id: string }) => !ids1.has(r.id))).toBe(true);
  });

  it("bad filter gives 400 invalid_filter", async () => {
    const filter = encodeURIComponent(JSON.stringify({ field: "nope", op: "eq", value: 1 }));
    const r = await t.app.inject({ method: "GET", url: `/api/v1/system/audit-log?filter=${filter}`, headers: devHeaders() });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("invalid_filter");
  });

  it("limit above 500 is rejected", async () => {
    const r = await t.app.inject({ method: "GET", url: `/api/v1/system/audit-log?limit=501`, headers: devHeaders() });
    expect(r.statusCode).toBe(400);
  });
});

describe("rate limiting", () => {
  it("returns 429 rate_limited in the standard body after the limit", async () => {
    const p = await makeApp({ RATE_LIMIT_MAX: 3 });
    try {
      const codes: number[] = [];
      let last;
      for (let i = 0; i < 5; i++) {
        last = await p.app.inject({ method: "GET", url: "/api/v1/system/ping" });
        codes.push(last.statusCode);
      }
      expect(codes).toEqual([200, 200, 200, 429, 429]);
      expect(last!.json().error.code).toBe("rate_limited");
    } finally {
      await p.close();
    }
  });
});

describe("config", () => {
  it("treats empty environment variables as not set", async () => {
    const { loadConfig } = await import("../src/config");
    const c = loadConfig({ DATABASE_URL: "postgres://x/y", S3_ENDPOINT: "", STORAGE_SIGNING_SECRET: "" });
    expect(c.S3_ENDPOINT).toBeUndefined();
    expect(c.STORAGE_SIGNING_SECRET).toContain("dev-only");
  });
});
