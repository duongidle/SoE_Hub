import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { AppError, COOKIES, ActorSchema, HEADERS, type Actor } from "@soe/shared";
import { apiTokens, sessions, users, type Db, type Executor } from "@soe/db";
import fastifyCookie from "@fastify/cookie";
import type { Config } from "../config";
import type { ActorResolver, RequestInfo } from "../core/types";
import { hmac, randomToken, safeEqual, sha256 } from "./crypto";

export const PAT_PREFIX = "soe_pat_";
export const SVC_PREFIX = "soe_svc_";
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type SessionConfig = Pick<Config, "AUTH_SECRET" | "SESSION_IDLE_DAYS" | "SESSION_ABSOLUTE_DAYS">;

/** CSRF token bound to the session (signed double submit): HMAC(secret, session id). */
export function csrfFor(secret: string, sessionId: string): string {
  return hmac(secret, `csrf:${sessionId}`);
}

export interface NewSession {
  id: string;
  token: string;
  csrf: string;
  expiresAt: Date;
}

/** Creates a login session. The cookie gets `token`; only its SHA-256 is stored. */
export async function createSession(
  ex: Executor,
  cfg: SessionConfig,
  i: { userId: string; method: "password" | "google" | "code"; ip: string | null; userAgent: string | null },
): Promise<NewSession> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + cfg.SESSION_ABSOLUTE_DAYS * 86400_000);
  const [row] = await ex
    .insert(sessions)
    .values({ userId: i.userId, tokenHash: sha256(token), method: i.method, expiresAt, ip: i.ip, userAgent: i.userAgent?.slice(0, 500) ?? null })
    .returning({ id: sessions.id });
  return { id: row!.id, token, csrf: csrfFor(cfg.AUTH_SECRET, row!.id), expiresAt };
}

/** Revokes sessions of a user, optionally keeping one (the current device). Returns how many were revoked. */
export async function revokeUserSessions(ex: Executor, userId: string, o: { except?: string | null; by: string | null; reason: string }): Promise<number> {
  const res = await ex
    .update(sessions)
    .set({ revokedAt: sql`now()`, revokedBy: o.by, revokeReason: o.reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), o.except ? ne(sessions.id, o.except) : undefined));
  return res.rowCount ?? 0;
}

/** Revokes every usable token of a user (account locked, data transferred). */
export async function revokeUserTokens(ex: Executor, userId: string, o: { by: string | null; reason: string }): Promise<number> {
  const res = await ex
    .update(apiTokens)
    .set({ status: "revoked", revokedAt: sql`now()`, revokedBy: o.by, revokeReason: o.reason, version: sql`${apiTokens.version} + 1` })
    .where(and(eq(apiTokens.userId, userId), sql`${apiTokens.status} IN ('pending', 'active')`));
  return res.rowCount ?? 0;
}

function header(req: RequestInfo, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function readCookies(req: RequestInfo): Record<string, string | undefined> {
  const raw = header(req, "cookie");
  return raw ? fastifyCookie.parse(raw) : {};
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The real actor resolver (design module1 sections 6.5 and 7):
 * - `Authorization: Bearer soe_pat_…` personal token (must be approved, not expired, owner active), via `api`.
 * - `Authorization: Bearer soe_svc_…` service-account token, via `api`.
 * - `soe_session` cookie: login session (idle 7 days, absolute 30 days), via `web`. Writes need the CSRF header.
 */
export class SessionTokenResolver implements ActorResolver {
  constructor(
    private readonly db: Db,
    private readonly cfg: SessionConfig,
  ) {}

  async resolve(req: RequestInfo & { method?: string }): Promise<Actor | null> {
    const auth = header(req, "authorization");
    if (auth && /^bearer\s+/i.test(auth)) return this.fromToken(auth.replace(/^bearer\s+/i, "").trim(), req);
    const cookies = readCookies(req);
    const token = cookies[COOKIES.session];
    if (!token) return null;
    const actor = await this.fromSession(token, req);
    if (actor && req.method && UNSAFE.has(req.method.toUpperCase())) {
      const sent = header(req, HEADERS.csrf) ?? "";
      const expected = csrfFor(this.cfg.AUTH_SECRET, actor.sessionId!);
      // Signed double submit: the header must equal the cookie and the HMAC of the session.
      if (!sent || !safeEqual(sent, expected) || !safeEqual(cookies[COOKIES.csrf] ?? "", expected)) {
        throw new AppError("csrf_failed");
      }
    }
    return actor;
  }

  private async fromSession(token: string, req: RequestInfo): Promise<Actor | null> {
    const idleMs = this.cfg.SESSION_IDLE_DAYS * 86400_000;
    const [row] = await this.db
      .select({ id: sessions.id, userId: sessions.userId, lastSeenAt: sessions.lastSeenAt, status: users.status, kind: users.kind })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, sha256(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
          gt(sessions.lastSeenAt, new Date(Date.now() - idleMs)),
        ),
      )
      .limit(1);
    if (!row || row.status !== "active" || row.kind !== "person") return null;
    if (Date.now() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await this.db.update(sessions).set({ lastSeenAt: sql`now()`, ip: req.ip }).where(eq(sessions.id, row.id));
    }
    return ActorSchema.parse({ userId: row.userId, via: "web", sessionId: row.id, ip: req.ip, userAgent: req.userAgent });
  }

  private async fromToken(token: string, req: RequestInfo): Promise<Actor | null> {
    if (!token.startsWith(PAT_PREFIX) && !token.startsWith(SVC_PREFIX)) throw new AppError("unauthenticated", "Token không hợp lệ.");
    const [row] = await this.db
      .select({ t: apiTokens, status: users.status, kind: users.kind })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .where(eq(apiTokens.tokenHash, sha256(token)))
      .limit(1);
    if (!row) throw new AppError("unauthenticated", "Token không hợp lệ.");
    const t = row.t;
    if (t.status === "pending") throw new AppError("connection_pending", "Kết nối đang chờ Admin duyệt. Báo Admin của bạn rồi thử lại.");
    if (t.status !== "active") throw new AppError("unauthenticated", "Token đã bị thu hồi hoặc bị từ chối.");
    if (t.expiresAt.getTime() <= Date.now()) throw new AppError("unauthenticated", "Token đã hết hạn.");
    const expectedKind = t.kind === "service" ? "service" : "person";
    if (row.status !== "active" || row.kind !== expectedKind) throw new AppError("unauthenticated", "Tài khoản của token không hoạt động.");
    if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) {
      await this.db.update(apiTokens).set({ lastUsedAt: sql`now()`, lastUsedIp: req.ip }).where(eq(apiTokens.id, t.id));
    }
    const personal = t.kind === "personal";
    return ActorSchema.parse({ userId: t.userId, via: "api", connectionId: t.id, connectionKind: personal ? "personal" : "service", connectionName: t.name, scopes: personal ? [] : t.scopes, ip: req.ip, userAgent: req.userAgent });
  }
}

/** Removes sessions that can no longer be used (expired or revoked more than 30 days ago). Run by the worker. */
export async function purgeSessions(ex: Executor, idleDays: number): Promise<number> {
  const res = await ex.execute(sql`
    DELETE FROM sessions
    WHERE expires_at < now() - interval '30 days'
       OR last_seen_at < now() - make_interval(days => ${idleDays + 30})
       OR revoked_at < now() - interval '30 days'`);
  return res.rowCount ?? 0;
}
