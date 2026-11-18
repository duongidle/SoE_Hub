import { Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { AppError, COOKIES, ActorSchema, isAppError } from "@soe/shared";
import { recordRowHistory, users, writeAudit, type Db } from "@soe/db";
import { createSession, type NewSession } from "../../auth/sessions";
import type { Config } from "../../config";
import { SETTINGS, readSetting } from "../system/settings-catalog";
import { assertAllowedDomain, findPersonByEmail, normalizeEmail } from "../org/view";

/**
 * Optional Google login (design module1 section 6.7), off by default: needs the setting `auth.google_enabled` AND
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Google proves the email, so no code is needed; the email must still be in
 * the org chart (or match auto_guest_sale). The first Google login must set a password before anything else.
 */
export async function googleEnabled(db: Db, cfg: Config): Promise<boolean> {
  return !!cfg.GOOGLE_CLIENT_ID && !!cfg.GOOGLE_CLIENT_SECRET && (await readSetting(db, SETTINGS.googleEnabled));
}

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  sub: string;
}

/** Turns a verified Google identity into a session. Separate from the HTTP glue so it can be tested without Google. */
export async function googleSignIn(db: Db, cfg: Config, id: GoogleIdentity, req: { ip: string; userAgent: string | null }): Promise<{ userId: string; session: NewSession; mustSetPassword: boolean }> {
  if (!id.emailVerified) throw new AppError("forbidden", "Email Google chưa được xác minh.");
  const email = normalizeEmail(id.email);
  assertAllowedDomain(email, await readSetting(db, SETTINGS.allowedDomains));
  return db.transaction(async (tx) => {
    let u = await findPersonByEmail(tx, email);
    if (u?.status === "locked") throw new AppError("account_locked", "Tài khoản đã bị khoá. Liên hệ quản lý của bạn.");
    if (!u) {
      if (!(await readSetting(tx, SETTINGS.autoGuestSale))) throw new AppError("forbidden", "Email chưa có trong danh sách. Liên hệ quản lý của bạn.");
      const [created] = await tx
        .insert(users)
        .values({ email, fullName: email.split("@")[0]!, roles: ["guest"], guestPreset: "sale", status: "active", mustSetPassword: true, activatedAt: new Date(), googleSub: id.sub })
        .returning();
      u = created!;
      await recordRowHistory(tx, { tableId: "users", rowId: u.id, version: 1, op: "create", changes: [{ field: "roles", old: null, new: ["guest"] }], actor: null });
    } else {
      const mustSet = !u.passwordHash;
      const [upd] = await tx
        .update(users)
        .set({
          status: "active",
          activatedAt: u.activatedAt ?? new Date(),
          mustSetPassword: mustSet,
          googleSub: u.googleSub ?? id.sub,
          lastLoginAt: sql`now()`,
          failedLoginCount: 0,
          lockedUntil: null,
          ...(u.status !== "active" ? { version: sql`${users.version} + 1` } : {}),
        })
        .where(eq(users.id, u.id))
        .returning();
      u = upd!;
    }
    const session = await createSession(tx, cfg, { userId: u.id, method: "google", ip: req.ip, userAgent: req.userAgent });
    const actor = ActorSchema.parse({ userId: u.id, via: "web", sessionId: session.id, ip: req.ip, userAgent: req.userAgent });
    await writeAudit(tx, { command: "auth.google.login", result: "success", actor, targetType: "user", targetId: u.id, details: { email, must_set_password: u.mustSetPassword } });
    return { userId: u.id, session, mustSetPassword: u.mustSetPassword };
  });
}

const STATE_TTL_SECONDS = 600;

export async function registerGoogleRoutes(app: FastifyInstance, deps: { config: Config; db: Db }) {
  const { config, db } = deps;
  const client = () => new Google(config.GOOGLE_CLIENT_ID!, config.GOOGLE_CLIENT_SECRET!, config.GOOGLE_REDIRECT_URI ?? `${config.PUBLIC_URL}/api/auth/callback/google`);
  const cookieOpts = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: config.secureCookies };

  app.get("/api/auth/google/start", async (_req, reply) => {
    if (!(await googleEnabled(db, config))) throw new AppError("not_found", "Đăng nhập Google đang tắt.");
    const state = generateState();
    const verifier = generateCodeVerifier();
    const url = client().createAuthorizationURL(state, verifier, ["openid", "email", "profile"]);
    reply.setCookie(COOKIES.oauthState, `${state}.${verifier}`, { ...cookieOpts, maxAge: STATE_TTL_SECONDS });
    return reply.redirect(url.toString(), 302);
  });

  app.get("/api/auth/callback/google", async (req, reply) => {
    const q = req.query as { code?: string; state?: string };
    const fail = async (message: string, code = "forbidden") => {
      await writeAudit(db, { command: "auth.google.login", result: "denied", requestId: req.id, errorCode: code, details: { reason: message } }).catch(() => {});
      reply.clearCookie(COOKIES.oauthState, { path: "/" });
      return reply.redirect(`/dang-nhap?loi=${encodeURIComponent(message)}`, 302);
    };
    if (!(await googleEnabled(db, config))) return fail("Đăng nhập Google đang tắt.", "not_found");
    const [state, verifier] = (req.cookies[COOKIES.oauthState] ?? "").split(".");
    if (!q.code || !q.state || !state || !verifier || q.state !== state) return fail("Phiên đăng nhập Google không hợp lệ. Thử lại.");
    try {
      const tokens = await client().validateAuthorizationCode(q.code, verifier);
      // The ID token comes straight from Google's token endpoint over TLS, so its claims can be read without
      // re-verifying the signature (OpenID Connect Core 3.1.3.7).
      const claims = decodeIdToken(tokens.idToken()) as { email?: string; email_verified?: boolean; sub?: string };
      if (!claims.email || !claims.sub) return fail("Google không trả về email.");
      const ua = req.headers["user-agent"];
      const r = await googleSignIn(db, config, { email: claims.email, emailVerified: claims.email_verified === true, sub: claims.sub }, { ip: req.ip, userAgent: typeof ua === "string" ? ua : null });
      const maxAge = config.SESSION_ABSOLUTE_DAYS * 86400;
      reply.clearCookie(COOKIES.oauthState, { path: "/" });
      reply.setCookie(COOKIES.session, r.session.token, { ...cookieOpts, maxAge });
      reply.setCookie(COOKIES.csrf, r.session.csrf, { ...cookieOpts, httpOnly: false, maxAge });
      return reply.redirect(r.mustSetPassword ? "/dat-mat-khau" : "/", 302);
    } catch (e) {
      if (isAppError(e)) return fail(e.message, e.code);
      req.log.error({ err: e }, "google login failed");
      return fail("Không đăng nhập được bằng Google.", "internal_error");
    }
  });
}
