import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, COOKIES, type Actor } from "@soe/shared";
import { authCodes, enqueueOutbox, recordRowHistory, sessions, users, type Executor, type UserRow } from "@soe/db";
import { effectivePermissions } from "../../auth/access";
import { safeEqual } from "../../auth/crypto";
import { assertPasswordPolicy, hashPassword, verifyDummy, verifyPassword } from "../../auth/password";
import { createSession, csrfFor, revokeUserSessions, type NewSession } from "../../auth/sessions";
import type { Config } from "../../config";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HttpResponder } from "../../core/types";
import { SETTINGS, readSetting } from "../system/settings-catalog";
import { UserOut, assertAllowedDomain, emailSchema, findPersonByEmail, getUserView, toUserView, currentMembership } from "../org/view";
import { CODE_MAX_ATTEMPTS, codeHash, codeRecipients, issueCode, pendingCode } from "./codes";

/** Design module1 section 6.5: 5 wrong passwords in a row lock the account for 15 minutes. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

const passwordSchema = z.string().min(1).max(1000);

const SessionOut = z.object({ user: UserOut, csrf_token: z.string(), expires_at: z.date().or(z.string()) });

type SessionResult = { user: z.infer<typeof UserOut>; session: NewSession };

export function sessionCookies(cfg: Pick<Config, "SESSION_ABSOLUTE_DAYS">) {
  return (r: SessionResult, res: HttpResponder) => {
    const maxAgeSeconds = cfg.SESSION_ABSOLUTE_DAYS * 86400;
    res.setCookie(COOKIES.session, r.session.token, { httpOnly: true, maxAgeSeconds });
    res.setCookie(COOKIES.csrf, r.session.csrf, { httpOnly: false, maxAgeSeconds });
    // The session token never appears in the JSON body.
    return { user: r.user, csrf_token: r.session.csrf, expires_at: r.session.expiresAt };
  };
}

async function viewOf(ex: Executor, u: UserRow) {
  return toUserView(u, await currentMembership(ex, u.id));
}

function requireSession(actor: Actor): string {
  if (!actor.sessionId) throw new AppError("validation_error", "Thao tác này chỉ dùng cho phiên đăng nhập trên web.");
  return actor.sessionId;
}

const actorRefOf = (a: Actor | null) => (a ? { userId: a.userId, via: a.via, connectionId: a.connectionId, automationId: a.automationId } : null);

export function authOperations(cfg: Config) {
  const respondSession = sessionCookies(cfg);

  return [
    defineQuery({
      name: "auth.config",
      summary: "Cấu hình công khai cho trang đăng nhập (có bật Google không, tên miền cho phép).",
      permission: null,
      aiAllowed: false,
      input: z.object({}),
      output: z.object({ google_enabled: z.boolean(), allowed_domains: z.array(z.string()) }),
      http: { method: "GET", path: "/auth/config" },
      handler: async (ctx) => ({
        google_enabled: (await readSetting(ctx.db, SETTINGS.googleEnabled)) && !!cfg.GOOGLE_CLIENT_ID && !!cfg.GOOGLE_CLIENT_SECRET,
        allowed_domains: await readSetting(ctx.db, SETTINGS.allowedDomains),
      }),
    }),

    defineCommand({
      name: "auth.login",
      summary: "Đăng nhập bằng email + mật khẩu. Đặt cookie phiên (httpOnly) và cookie CSRF.",
      description: "Sai 5 lần liên tiếp thì khoá 15 phút. Kết quả không chứa token phiên; web gửi lại `csrf_token` trong header `X-CSRF-Token` cho mọi thao tác ghi.",
      permission: null,
      aiAllowed: false,
      input: z.object({ email: emailSchema, password: passwordSchema }),
      output: SessionOut,
      http: { method: "POST", path: "/auth/login", respond: respondSession },
      handler: async (ctx, i) => {
        ctx.audit({ type: "user", details: { email: i.email } });
        const u = await findPersonByEmail(ctx.db, i.email);
        if (!u || !u.passwordHash) {
          await verifyDummy(i.password);
          if (u?.status === "inactive") throw new AppError("invalid_credentials", "Tài khoản chưa kích hoạt. Vào Đăng ký để nhận mã kích hoạt.");
          throw new AppError("invalid_credentials");
        }
        ctx.audit({ type: "user", id: u.id, details: { email: i.email } });
        if (u.status === "locked") throw new AppError("account_locked", "Tài khoản đã bị khoá. Liên hệ quản lý của bạn.");
        if (u.status !== "active") throw new AppError("invalid_credentials", "Tài khoản chưa kích hoạt. Vào Đăng ký để nhận mã kích hoạt.");
        if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
          throw new AppError("account_locked", `Đăng nhập sai quá nhiều lần. Thử lại sau ${Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60000)} phút.`, { locked_until: u.lockedUntil });
        }
        if (!(await verifyPassword(u.passwordHash, i.password))) {
          // Counted outside the transaction: the command fails, the counter must stay.
          const fails = u.failedLoginCount + 1;
          if (fails >= LOGIN_MAX_FAILURES) {
            await ctx.outside.update(users).set({ failedLoginCount: 0, lockedUntil: sql`now() + make_interval(mins => ${LOGIN_LOCK_MINUTES})` }).where(eq(users.id, u.id));
            // The command fails, so the event goes outside its transaction (like the counter above).
            await enqueueOutbox(ctx.outside, { event: "auth.account.locked", aggregateType: "user", aggregateId: u.id, payload: { user_id: u.id, minutes: LOGIN_LOCK_MINUTES } });
            throw new AppError("account_locked", `Sai mật khẩu ${LOGIN_MAX_FAILURES} lần. Tài khoản tạm khoá ${LOGIN_LOCK_MINUTES} phút.`);
          }
          await ctx.outside.update(users).set({ failedLoginCount: fails }).where(eq(users.id, u.id));
          throw new AppError("invalid_credentials", undefined, { attempts_left: LOGIN_MAX_FAILURES - fails });
        }
        await ctx.db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: sql`now()` }).where(eq(users.id, u.id));
        const session = await createSession(ctx.db, cfg, { userId: u.id, method: "password", ip: ctx.actor?.ip ?? null, userAgent: ctx.actor?.userAgent ?? null });
        ctx.audit({ type: "user", id: u.id, details: { email: i.email, session_id: session.id } });
        return { user: await viewOf(ctx.db, u), session };
      },
    }),

    defineCommand({
      name: "auth.logout",
      summary: "Đăng xuất thiết bị đang dùng.",
      permission: "auth:self",
      aiAllowed: false,
      input: z.object({}),
      output: z.object({ logged_out: z.literal(true) }),
      http: {
        method: "POST",
        path: "/auth/logout",
        respond: (r, res) => {
          res.clearCookie(COOKIES.session);
          res.clearCookie(COOKIES.csrf);
          return r;
        },
      },
      handler: async (ctx) => {
        const sid = requireSession(ctx.actor);
        await ctx.db.update(sessions).set({ revokedAt: sql`now()`, revokedBy: ctx.actor.userId, revokeReason: "Đăng xuất" }).where(eq(sessions.id, sid));
        ctx.audit({ type: "session", id: sid });
        return { logged_out: true as const };
      },
    }),

    defineQuery({
      name: "auth.me",
      summary: "Tài khoản đang đăng nhập: thông tin, vai trò, quyền thực tế, có cần đặt mật khẩu không.",
      permission: "system:whoami",
      aiAllowed: true,
      input: z.object({}),
      output: z.object({
        user: UserOut,
        permissions: z.array(z.string()),
        must_set_password: z.boolean(),
        via: z.string(),
        token_id: z.uuid().nullable(),
        csrf_token: z.string().nullable(),
      }),
      http: { method: "GET", path: "/auth/me" },
      handler: async (ctx) => {
        const p = await ctx.access.requirePrincipal();
        const view = await getUserView(ctx.db, ctx.actor.userId);
        if (!view) throw new AppError("not_found");
        return {
          user: view,
          permissions: [...effectivePermissions(p, ctx.actor)].sort(),
          must_set_password: p.mustSetPassword,
          via: ctx.actor.via,
          token_id: ctx.actor.connectionId,
          csrf_token: ctx.actor.sessionId ? csrfFor(cfg.AUTH_SECRET, ctx.actor.sessionId) : null,
        };
      },
    }),

    defineCommand({
      name: "auth.code.request",
      summary: "Xin mã 6 số để kích hoạt tài khoản (activate) hoặc đặt lại mật khẩu (reset).",
      description:
        "Không gửi email. Mã được gửi qua thông báo trong ứng dụng cho leader trực tiếp, manager và Admin (module1 mục 6.4). " +
        "Người dùng tự liên hệ một người nhận để xin mã. Mã hiệu lực 6 giờ; mỗi email tối đa 3 yêu cầu mỗi giờ; yêu cầu mới huỷ mã cũ.",
      permission: null,
      aiAllowed: false,
      emits: ["auth.code.requested"],
      input: z.object({ email: emailSchema, purpose: z.enum(["activate", "reset"]) }),
      output: z.object({ requested: z.literal(true), expires_at: z.date().or(z.string()), recipients: z.array(z.string()), server_command_needed: z.boolean() }),
      http: { method: "POST", path: "/auth/codes", status: 201 },
      handler: async (ctx, i) => {
        ctx.audit({ type: "auth_code", details: { email: i.email, purpose: i.purpose } });
        assertAllowedDomain(i.email, await readSetting(ctx.db, SETTINGS.allowedDomains));
        const u = await findPersonByEmail(ctx.db, i.email);
        if (u?.status === "locked") throw new AppError("account_locked", "Tài khoản đã bị khoá. Liên hệ quản lý của bạn.");
        if (i.purpose === "activate") {
          if (u?.status === "active") throw new AppError("validation_error", "Tài khoản đã kích hoạt. Dùng Đăng nhập, hoặc Quên mật khẩu nếu cần.");
          if (!u && !(await readSetting(ctx.db, SETTINGS.autoGuestSale))) {
            throw new AppError("not_found", "Email chưa có trong danh sách. Liên hệ quản lý của bạn.");
          }
        } else {
          if (!u) throw new AppError("not_found", "Email chưa có trong danh sách. Liên hệ quản lý của bạn.");
          if (u.status !== "active") throw new AppError("validation_error", "Tài khoản chưa kích hoạt. Dùng Đăng ký để nhận mã kích hoạt.");
        }
        const issued = await issueCode(ctx.db, cfg.AUTH_SECRET, { purpose: i.purpose, email: i.email, userId: u?.id ?? null, source: "web", ip: ctx.actor?.ip ?? null });
        const recipients = await codeRecipients(ctx.db, u);
        ctx.audit({ type: "auth_code", id: issued.id, details: { email: i.email, purpose: i.purpose, user_id: u?.id ?? null, recipients: recipients.map((r) => r.id) } });
        await ctx.emit("auth.code.requested", {
          aggregateType: "auth_code",
          aggregateId: issued.id,
          payload: {
            code_id: issued.id,
            purpose: i.purpose,
            email: i.email,
            full_name: u?.fullName ?? i.email,
            requested_at: new Date().toISOString(),
            expires_at: issued.expiresAt.toISOString(),
            recipient_ids: recipients.map((r) => r.id),
            code_enc: issued.codeEnc,
          },
        });
        return { requested: true as const, expires_at: issued.expiresAt, recipients: recipients.map((r) => r.fullName), server_command_needed: recipients.length === 0 };
      },
    }),

    defineCommand({
      name: "auth.code.verify",
      summary: "Nhập mã 6 số và đặt mật khẩu: kích hoạt tài khoản hoặc đặt lại mật khẩu. Đăng nhập luôn.",
      description: "Sai 5 lần thì mã bị huỷ. Đặt lại mật khẩu đăng xuất mọi phiên cũ.",
      permission: null,
      aiAllowed: false,
      emits: ["org.member.changed"],
      input: z.object({ email: emailSchema, purpose: z.enum(["activate", "reset"]), code: z.string().trim().regex(/^\d{6}$/, "Mã gồm 6 chữ số."), password: passwordSchema }),
      output: SessionOut,
      http: { method: "POST", path: "/auth/codes/verify", respond: respondSession },
      handler: async (ctx, i) => {
        ctx.audit({ type: "auth_code", details: { email: i.email, purpose: i.purpose } });
        assertPasswordPolicy(i.password, { email: i.email });
        const row = await pendingCode(ctx.db, i.email, i.purpose);
        if (!row || row.expiresAt.getTime() <= Date.now()) throw new AppError("code_invalid", "Không có mã đang chờ hoặc mã đã hết hạn. Hãy xin mã mới.");
        ctx.audit({ type: "auth_code", id: row.id, details: { email: i.email, purpose: i.purpose } });
        if (!safeEqual(codeHash(cfg.AUTH_SECRET, row.id, i.code), row.codeHash)) {
          const attempts = row.attempts + 1;
          const dead = attempts >= CODE_MAX_ATTEMPTS;
          await ctx.outside.update(authCodes).set({ attempts, status: dead ? "dead" : "pending" }).where(eq(authCodes.id, row.id));
          throw new AppError("code_invalid", dead ? "Nhập sai mã quá 5 lần, mã đã bị huỷ. Hãy xin mã mới." : "Mã không đúng.", { attempts_left: CODE_MAX_ATTEMPTS - attempts });
        }
        const used = await ctx.db
          .update(authCodes)
          .set({ status: "used", usedAt: sql`now()` })
          .where(and(eq(authCodes.id, row.id), eq(authCodes.status, "pending")))
          .returning({ id: authCodes.id });
        if (used.length === 0) throw new AppError("code_invalid", "Mã vừa được dùng hoặc bị huỷ. Hãy xin mã mới.");
        const hash = await hashPassword(i.password);
        let u = row.userId ? ((await ctx.db.select().from(users).where(eq(users.id, row.userId)).limit(1).for("update"))[0] ?? null) : null;
        if (u?.status === "locked") throw new AppError("account_locked", "Tài khoản đã bị khoá. Liên hệ quản lý của bạn.");
        if (!u) {
          // Self-registering guest (auth.auto_guest_sale): the account is created now, when the email is proven.
          if (i.purpose !== "activate" || !(await readSetting(ctx.db, SETTINGS.autoGuestSale))) throw new AppError("code_invalid");
          if (await findPersonByEmail(ctx.db, i.email)) throw new AppError("code_invalid", "Email này vừa được thêm vào org chart. Hãy xin mã mới.");
          const [created] = await ctx.db
            .insert(users)
            .values({ email: i.email, fullName: i.email.split("@")[0]!, roles: ["guest"], guestPreset: "sale", status: "active", passwordHash: hash, passwordChangedAt: new Date(), activatedAt: new Date() })
            .returning();
          u = created!;
          await recordRowHistory(ctx.db, { tableId: "users", rowId: u.id, version: 1, op: "create", changes: [{ field: "roles", old: null, new: ["guest"] }, { field: "guestPreset", old: null, new: "sale" }], actor: actorRefOf(ctx.actor) });
        } else {
          if (i.purpose === "activate" && u.status !== "inactive") throw new AppError("code_invalid", "Tài khoản đã kích hoạt.");
          if (i.purpose === "reset" && u.status !== "active") throw new AppError("code_invalid", "Tài khoản chưa kích hoạt.");
          const [upd] = await ctx.db
            .update(users)
            .set({
              passwordHash: hash,
              passwordChangedAt: sql`now()`,
              mustSetPassword: false,
              status: "active",
              activatedAt: u.activatedAt ?? new Date(),
              failedLoginCount: 0,
              lockedUntil: null,
              version: sql`${users.version} + 1`,
              updatedAt: sql`now()`,
            })
            .where(eq(users.id, u.id))
            .returning();
          if (i.purpose === "reset") await revokeUserSessions(ctx.db, u.id, { by: null, reason: "Đặt lại mật khẩu" });
          await recordRowHistory(ctx.db, { tableId: "users", rowId: u.id, version: upd!.version, op: "update", changes: i.purpose === "activate" ? [{ field: "status", old: u.status, new: "active" }] : [{ field: "password", old: null, new: "(đã đổi)" }], actor: actorRefOf(ctx.actor) });
          u = upd!;
          // An active Manager gets the default templates of the tree (module4 3.1); the event also lets the members of the tree follow.
          if (i.purpose === "activate") await ctx.emit("org.member.changed", { aggregateType: "user", aggregateId: u.id, payload: { user_id: u.id, change: "activated" } });
        }
        await ctx.db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, u.id));
        const session = await createSession(ctx.db, cfg, { userId: u.id, method: "code", ip: ctx.actor?.ip ?? null, userAgent: ctx.actor?.userAgent ?? null });
        ctx.audit({ type: "user", id: u.id, details: { email: i.email, purpose: i.purpose, code_id: row.id } });
        return { user: await viewOf(ctx.db, u), session };
      },
    }),

    defineCommand({
      name: "auth.password.change",
      summary: "Đổi mật khẩu (nhập mật khẩu cũ). Mọi phiên khác bị đăng xuất.",
      permission: "auth:self",
      aiAllowed: false,
      input: z.object({ current_password: passwordSchema, new_password: passwordSchema }),
      output: z.object({ changed: z.literal(true), other_sessions_revoked: z.number().int() }),
      http: { method: "POST", path: "/auth/password" },
      handler: async (ctx, i) => {
        const [u] = await ctx.db.select().from(users).where(eq(users.id, ctx.actor.userId)).limit(1).for("update");
        if (!u?.passwordHash || !(await verifyPassword(u.passwordHash, i.current_password))) throw new AppError("invalid_credentials", "Mật khẩu hiện tại không đúng.");
        assertPasswordPolicy(i.new_password, { email: u.email });
        if (i.new_password === i.current_password) throw new AppError("password_rejected", "Mật khẩu mới phải khác mật khẩu cũ.");
        await ctx.db.update(users).set({ passwordHash: await hashPassword(i.new_password), passwordChangedAt: sql`now()`, version: sql`${users.version} + 1`, updatedAt: sql`now()` }).where(eq(users.id, u.id));
        const n = await revokeUserSessions(ctx.db, u.id, { except: ctx.actor.sessionId, by: u.id, reason: "Đổi mật khẩu" });
        ctx.audit({ type: "user", id: u.id, details: { other_sessions_revoked: n } });
        return { changed: true as const, other_sessions_revoked: n };
      },
    }),

    defineCommand({
      name: "auth.password.set",
      summary: "Đặt mật khẩu lần đầu sau khi đăng nhập Google (bắt buộc trước khi dùng hệ thống).",
      permission: "auth:self",
      aiAllowed: false,
      input: z.object({ new_password: passwordSchema }),
      output: z.object({ changed: z.literal(true) }),
      http: { method: "POST", path: "/auth/password/set" },
      handler: async (ctx, i) => {
        const [u] = await ctx.db.select().from(users).where(eq(users.id, ctx.actor.userId)).limit(1).for("update");
        if (!u?.mustSetPassword) throw new AppError("validation_error", "Tài khoản đã có mật khẩu. Dùng Đổi mật khẩu.");
        assertPasswordPolicy(i.new_password, { email: u.email });
        await ctx.db.update(users).set({ passwordHash: await hashPassword(i.new_password), passwordChangedAt: sql`now()`, mustSetPassword: false, version: sql`${users.version} + 1`, updatedAt: sql`now()` }).where(eq(users.id, u.id));
        ctx.audit({ type: "user", id: u.id });
        return { changed: true as const };
      },
    }),

    // ---- devices (sessions) ------------------------------------------------------------------------
    defineQuery({
      name: "auth.session.list",
      summary: "Thiết bị đang đăng nhập của mình.",
      permission: "auth:self",
      aiAllowed: false,
      input: z.object({}),
      output: z.array(z.object({ id: z.uuid(), current: z.boolean(), method: z.string(), ip: z.string().nullable(), user_agent: z.string().nullable(), created_at: z.date().or(z.string()), last_seen_at: z.date().or(z.string()), expires_at: z.date().or(z.string()) })),
      http: { method: "GET", path: "/auth/sessions" },
      handler: async (ctx) => {
        const rows = await ctx.db
          .select()
          .from(sessions)
          .where(and(eq(sessions.userId, ctx.actor.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`), gt(sessions.lastSeenAt, new Date(Date.now() - cfg.SESSION_IDLE_DAYS * 86400_000))))
          .orderBy(desc(sessions.lastSeenAt));
        return rows.map((s) => ({ id: s.id, current: s.id === ctx.actor.sessionId, method: s.method, ip: s.ip, user_agent: s.userAgent, created_at: s.createdAt, last_seen_at: s.lastSeenAt, expires_at: s.expiresAt }));
      },
    }),

    defineCommand({
      name: "auth.session.revoke",
      summary: "Đăng xuất một thiết bị của mình.",
      permission: "auth:self",
      aiAllowed: false,
      input: z.object({ id: z.uuid() }),
      output: z.object({ id: z.uuid(), revoked: z.boolean() }),
      http: { method: "DELETE", path: "/auth/sessions/:id" },
      handler: async (ctx, i) => {
        const res = await ctx.db
          .update(sessions)
          .set({ revokedAt: sql`now()`, revokedBy: ctx.actor.userId, revokeReason: "Người dùng đăng xuất thiết bị" })
          .where(and(eq(sessions.id, i.id), eq(sessions.userId, ctx.actor.userId), isNull(sessions.revokedAt)));
        if ((res.rowCount ?? 0) === 0) throw new AppError("not_found", "Không tìm thấy phiên này.");
        ctx.audit({ type: "session", id: i.id });
        return { id: i.id, revoked: true };
      },
    }),

    defineCommand({
      name: "auth.session.revoke_user",
      summary: "Admin thu hồi mọi phiên đăng nhập của một người.",
      permission: "auth:session:manage",
      aiAllowed: false,
      input: z.object({ user_id: z.uuid() }),
      output: z.object({ user_id: z.uuid(), revoked: z.number().int() }),
      http: { method: "POST", path: "/admin/users/:user_id/sessions/revoke" },
      handler: async (ctx, i) => {
        const n = await revokeUserSessions(ctx.db, i.user_id, { by: ctx.actor.userId, reason: "Admin thu hồi" });
        ctx.audit({ type: "user", id: i.user_id, details: { sessions_revoked: n } });
        return { user_id: i.user_id, revoked: n };
      },
    }),

    defineQuery({
      name: "auth.session.list_user",
      summary: "Admin xem các phiên đang hoạt động của một người.",
      permission: "auth:session:manage",
      aiAllowed: false,
      input: z.object({ user_id: z.uuid() }),
      output: z.array(z.object({ id: z.uuid(), method: z.string(), ip: z.string().nullable(), user_agent: z.string().nullable(), created_at: z.date().or(z.string()), last_seen_at: z.date().or(z.string()) })),
      http: { method: "GET", path: "/admin/users/:user_id/sessions" },
      handler: async (ctx, i) => {
        const rows = await ctx.db
          .select()
          .from(sessions)
          .where(and(eq(sessions.userId, i.user_id), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
          .orderBy(desc(sessions.lastSeenAt));
        return rows.map((s) => ({ id: s.id, method: s.method, ip: s.ip, user_agent: s.userAgent, created_at: s.createdAt, last_seen_at: s.lastSeenAt }));
      },
    }),
  ];
}
