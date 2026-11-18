import { existsSync } from "node:fs";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import scalar from "@scalar/fastify-api-reference";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AppError, ERROR_CODES, HEADERS, isAppError, type Actor, type ErrorCode } from "@soe/shared";
import { getSetting, writeAudit, type DbHandle } from "@soe/db";
import type { Logger } from "pino";
import type { AuthKit } from "../auth";
import type { Config } from "../config";
import type { OperationExecutor } from "../core/executor";
import type { Registry } from "../core/registry";
import { LocalStorageDriver, type StorageDriver } from "../storage";
import { buildOpenApi } from "./openapi";
import { registerLocalStorageRoutes } from "./local-storage";
import { AccessContext, scopeIncludes } from "../auth/access";
import type { HttpResponder } from "../core/types";
import { registerGoogleRoutes } from "../modules/auth/google";
import type { SseHub, SseSignal } from "./sse";

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export interface AppDeps {
  config: Config;
  db: DbHandle;
  registry: Registry;
  executor: OperationExecutor;
  auth: AuthKit;
  storage: StorageDriver;
  sse: SseHub | null;
  logger: Logger;
}

const HEARTBEAT_KEY = "worker.last_heartbeat";
const WORKER_STALE_SECONDS = 180;

function statusToCode(status: number): ErrorCode {
  switch (status) {
    case 400: return "validation_error";
    case 401: return "unauthenticated";
    case 403: return "forbidden";
    case 404: return "not_found";
    case 413: return "payload_too_large";
    case 415: return "unsupported_media_type";
    case 429: return "rate_limited";
    default: return status >= 500 ? "internal_error" : "validation_error";
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, registry, executor, auth, logger } = deps;

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    requestIdHeader: false,
    genReqId: (req) => {
      const h = req.headers[HEADERS.requestId];
      return typeof h === "string" && /^[\w-]{8,64}$/.test(h) ? h : uuidv7();
    },
  });

  app.decorateRequest("actor", null);
  await app.register(fastifyCookie);

  // ---- security headers -------------------------------------------------------------------------
  await app.register(helmet, {
    hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
  });
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-robots-tag", "noindex, nofollow");
    reply.header(HEADERS.requestId, req.id);
    if (req.url.startsWith("/api/") || req.url === "/health") reply.header("cache-control", "no-store");
    return payload;
  });

  /** Channel, IP and user agent for audit rows of calls without an actor: a browser sends `sec-fetch-site`, a script does not. */
  const clientOf = (req: FastifyRequest) => ({
    via: req.headers["sec-fetch-site"] ? "web" : "api",
    ip: req.ip,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
  });

  // ---- identify the actor (pluggable) -----------------------------------------------------------
  // Session cookie or bearer token (auth/sessions.ts). Cookie writes must carry the CSRF header.
  app.addHook("onRequest", async (req) => {
    const ua = req.headers["user-agent"];
    try {
      req.actor = await auth.resolver.resolve({ method: req.method, headers: req.headers, ip: req.ip, userAgent: typeof ua === "string" ? ua : null });
    } catch (e) {
      if (isAppError(e)) {
        await writeAudit(deps.db.db, { command: "http.authenticate", result: "denied", requestId: req.id, client: clientOf(req), errorCode: e.code, details: { reason: e.message, method: req.method, url: req.url.split("?")[0] } }).catch(() => {});
      }
      throw e;
    }
  });

  // ---- rate limit: per actor when known, else per IP --------------------------------------------
  await app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    // Per token when a token is used, else per user, else per IP (design module0 section 7).
    keyGenerator: (req) => (req.actor?.connectionId ? `t:${req.actor.connectionId}` : req.actor ? `u:${req.actor.userId}` : `ip:${req.ip}`),
    allowList: (req) => req.url === "/health",
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: "Too Many Requests", message: `Gọi quá nhanh. Thử lại sau ${Math.ceil(ctx.ttl / 1000)} giây.` }),
  });

  // ---- errors in the standard format ------------------------------------------------------------
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send(err.toBody(req.id));
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, "unhandled error");
      return reply.code(500).send(new AppError("internal_error").toBody(req.id));
    }
    const code = statusToCode(status);
    const message = status === 429 || status === 413 || status === 415 ? err.message : "Yêu cầu không hợp lệ.";
    return reply.code(ERROR_CODES[code].status).send(new AppError(code, message).toBody(req.id));
  });
  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith("/api/") || req.url === "/health";
    if (!isApi && req.method === "GET" && spaIndex) return reply.type("text/html").sendFile("index.html");
    return reply.code(404).send(new AppError("not_found", "Không có đường dẫn này.").toBody(req.id));
  });

  // ---- access check shared by infrastructure endpoints -------------------------------------------
  async function requireAccess(req: FastifyRequest, permission: string, command: string): Promise<Actor> {
    const deny = async (code: "unauthenticated" | "forbidden", reason: string): Promise<never> => {
      await writeAudit(deps.db.db, { command, result: "denied", actor: req.actor, requestId: req.id, errorCode: code, details: { reason, permission } }).catch(() => {});
      throw new AppError(code, code === "forbidden" ? reason : undefined);
    };
    if (!req.actor) return deny("unauthenticated", "");
    const d = await auth.authorizer.authorize(req.actor, { name: command, kind: "query", permission });
    if (!d.allowed) return deny("forbidden", d.reason);
    return req.actor;
  }

  // ---- registry -> REST --------------------------------------------------------------------------
  for (const op of registry.list()) {
    app.route({
      method: op.http.method,
      url: `/api/v1${op.http.path}`,
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const query = (req.query ?? {}) as Record<string, unknown>;
        const params = (req.params ?? {}) as Record<string, unknown>;
        let body: Record<string, unknown> = {};
        if (req.body !== undefined && req.body !== null) {
          if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
            throw new AppError("unsupported_media_type", "API chỉ nhận body application/json.");
          }
          if (typeof req.body !== "object" || Array.isArray(req.body)) throw new AppError("validation_error", "Body phải là một object JSON.");
          body = req.body as Record<string, unknown>;
        }
        const input = op.http.method === "GET" || op.http.method === "DELETE" ? { ...query, ...params } : { ...query, ...body, ...params };
        const key = req.headers[HEADERS.idempotencyKey];
        const r = await executor.execute(op.name, input, {
          actor: req.actor,
          requestId: req.id,
          client: clientOf(req),
          idempotencyKey: typeof key === "string" ? key : null,
        });
        if (r.replayed) reply.header("idempotent-replayed", "true");
        reply.code(r.status);
        if (r.status === 204) return reply.send();
        if (op.http.respond) {
          let raw: { body: string; type: string; filename?: string } | null = null;
          const res: HttpResponder = {
            setCookie: (name, value, o) =>
              void reply.setCookie(name, value, { path: "/", httpOnly: o.httpOnly, sameSite: "lax", secure: config.secureCookies, ...(o.maxAgeSeconds ? { maxAge: o.maxAgeSeconds } : {}) }),
            clearCookie: (name) => void reply.clearCookie(name, { path: "/" }),
            sendRaw: (body, type, filename) => void (raw = { body, type, filename }),
          };
          const data = op.http.respond(r.result, res);
          if (raw) {
            const x = raw as { body: string; type: string; filename?: string };
            if (x.filename) reply.header("content-disposition", `attachment; filename="${x.filename}"`);
            return reply.type(x.type).send(x.body);
          }
          return { data };
        }
        if (op.list) {
          const l = r.result as { items: unknown[]; nextCursor: string | null; total?: number };
          return { data: l.items, next_cursor: l.nextCursor, ...(l.total !== undefined ? { total: l.total } : {}) };
        }
        return { data: r.result };
      },
    });
  }

  // ---- /health ------------------------------------------------------------------------------------
  app.get("/health", async (_req, reply) => {
    try {
      await deps.db.db.execute(sql`select 1`);
    } catch (e) {
      app.log.error({ err: e }, "health: database check failed");
      return reply.code(503).send(new AppError("unavailable", "Database không phản hồi.").toBody());
    }
    let worker: { status: "ok" | "stale" | "unknown"; last_heartbeat: string | null; age_seconds: number | null } = { status: "unknown", last_heartbeat: null, age_seconds: null };
    try {
      const hb = await getSetting<string>(deps.db.db, HEARTBEAT_KEY);
      if (hb) {
        const age = Math.round((Date.now() - new Date(hb).getTime()) / 1000);
        worker = { status: age <= WORKER_STALE_SECONDS ? "ok" : "stale", last_heartbeat: hb, age_seconds: age };
      }
    } catch {
      // The worker status is informational only.
    }
    return { status: "ok", db: "ok", worker, time: new Date().toISOString() };
  });

  // ---- OpenAPI + Scalar -----------------------------------------------------------------------------
  const spec = buildOpenApi(registry, config.PUBLIC_URL);
  app.get("/api/openapi.json", async (req) => {
    await requireAccess(req, "docs:read", "docs.openapi");
    return spec;
  });
  await app.register(async (docs) => {
    docs.addHook("onRequest", async (req) => {
      await requireAccess(req, "docs:read", "docs.view");
    });
    // The docs page needs inline script/style; relax CSP for this scope only.
    docs.addHook("onSend", async (_req, reply, payload) => {
      reply.header("content-security-policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
      return payload;
    });
    await docs.register(scalar, {
      routePrefix: "/api/docs",
      configuration: { content: spec, metaData: { title: "SoE Hub API" }, hideDownloadButton: false },
    });
  });

  // ---- SSE ----------------------------------------------------------------------------------------
  app.get("/api/v1/events", async (req, reply) => {
    const actor = await requireAccess(req, "events:subscribe", "events.subscribe");
    if (!deps.sse) throw new AppError("unavailable", "Luồng sự kiện chưa bật.");
    const topics = String((req.query as { topics?: string }).topics ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 3000\n`);
    res.write(`event: ready\ndata: ${JSON.stringify({ user_id: actor.userId })}\n\n`);
    const canSee = sseFilter(actor);
    const send = (s: SseSignal) => {
      if (topics.length > 0 && !topics.some((t) => s.event === t || s.event.startsWith(`${t}.`))) return;
      void canSee(s).then((ok) => {
        if (!ok || res.writableEnded) return;
        const { audience: _audience, ...pub } = s;
        res.write(`id: ${s.id}\nevent: ${s.event}\ndata: ${JSON.stringify(pub)}\n\n`);
      });
    };
    const unsubscribe = deps.sse.subscribe(send);
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  /**
   * SSE visibility (design module1 section 10): a signal goes only to people allowed to see the object.
   * Permission and scope answers are cached for 30 seconds per connection, so role changes apply quickly.
   */
  function sseFilter(actor: Actor) {
    let cache: { at: number; access: AccessContext } | null = null;
    const access = () => {
      if (!cache || Date.now() - cache.at > 30_000) {
        // A fresh actor object = a fresh principal cache entry.
        cache = { at: Date.now(), access: new AccessContext({ ...actor }, deps.db.db, auth.principals) };
      }
      return cache.access;
    };
    return async (s: SseSignal): Promise<boolean> => {
      const a = s.audience;
      if (!a) return false;
      if (a.users?.includes(actor.userId)) return true;
      try {
        const ac = access();
        const p = await ac.principal();
        if (!p || p.status !== "active") return false;
        if (a.permission && (await ac.can(a.permission as never))) return true;
        if (a.scope) {
          const scope = await ac.scope(a.scope.kind);
          if (a.scope.ownerIds.some((id) => scopeIncludes(scope, id))) return true;
        }
      } catch (e) {
        app.log.warn({ err: e }, "sse visibility check failed");
      }
      return false;
    };
  }

  // ---- Google login (optional) ----------------------------------------------------------------------
  await registerGoogleRoutes(app as unknown as FastifyInstance, { config, db: deps.db.db });

  // ---- local storage driver (dev) -------------------------------------------------------------------
  if (deps.storage instanceof LocalStorageDriver) {
    await app.register(registerLocalStorageRoutes(deps.storage, config.FILE_MAX_BYTES));
  }

  // ---- built web app (production) ---------------------------------------------------------------------
  const webDist = config.WEB_DIST_DIR ? path.resolve(config.WEB_DIST_DIR) : undefined;
  const spaIndex = webDist !== undefined && existsSync(path.join(webDist, "index.html"));
  if (webDist && spaIndex) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: ["index.html"] });
    app.get("/*", async (req, reply) => {
      if (req.url.startsWith("/api/")) throw new AppError("not_found", "Không có đường dẫn này.");
      return reply.type("text/html").sendFile("index.html");
    });
  }

  return app as unknown as FastifyInstance;
}
