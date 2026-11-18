import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, SERVICE_ACCOUNT_PERMISSIONS, isTokenAllowedPermission, type Actor, type Permission } from "@soe/shared";
import { apiTokens, serviceAccounts, users, type Executor } from "@soe/db";
import { activeUsersWithRole, loadPrincipal } from "../../auth/access";
import { randomToken, sha256 } from "../../auth/crypto";
import { PAT_PREFIX, SVC_PREFIX, revokeUserTokens } from "../../auth/sessions";
import { defineCommand, defineQuery } from "../../core/registry";
import { currentMembership, namesOf } from "../org/view";

/** Design module1 section 7: personal tokens default to 90 days, at most one year. */
export const TOKEN_DEFAULT_DAYS = 90;
export const TOKEN_MAX_DAYS = 365;

const TokenOut = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  user_name: z.string().nullable(),
  user_email: z.string().nullable(),
  kind: z.enum(["personal", "service"]),
  name: z.string(),
  token_prefix: z.string(),
  scopes: z.array(z.string()),
  status: z.enum(["pending", "active", "rejected", "revoked"]),
  expires_at: z.date().or(z.string()),
  created_at: z.date().or(z.string()),
  decided_at: z.date().or(z.string()).nullable(),
  decided_by_name: z.string().nullable(),
  decision_note: z.string().nullable(),
  revoked_at: z.date().or(z.string()).nullable(),
  revoke_reason: z.string().nullable(),
  last_used_at: z.date().or(z.string()).nullable(),
  version: z.number().int(),
});

type TokenRow = typeof apiTokens.$inferSelect;

async function toOut(ex: Executor, rows: TokenRow[]) {
  const names = await namesOf(ex, rows.flatMap((r) => [r.userId, r.decidedBy ?? ""]));
  return rows.map((t) => ({
    id: t.id,
    user_id: t.userId,
    user_name: names.get(t.userId)?.full_name ?? null,
    user_email: names.get(t.userId)?.email ?? null,
    kind: t.kind as "personal" | "service",
    name: t.name,
    token_prefix: t.tokenPrefix,
    scopes: t.scopes,
    status: t.status as "pending" | "active" | "rejected" | "revoked",
    expires_at: t.expiresAt,
    created_at: t.createdAt,
    decided_at: t.decidedAt,
    decided_by_name: t.decidedBy ? (names.get(t.decidedBy)?.full_name ?? null) : null,
    decision_note: t.decisionNote,
    revoked_at: t.revokedAt,
    revoke_reason: t.revokeReason,
    last_used_at: t.lastUsedAt,
    version: t.version,
  }));
}

function newSecret(prefix: string) {
  const token = `${prefix}${randomToken(32)}`;
  return { token, hash: sha256(token), display: `${token.slice(0, prefix.length + 4)}…` };
}

const scopesSchema = z.array(z.string().min(3).max(100)).min(1).max(100).transform((s) => [...new Set(s)]);

async function loadToken(ex: Executor, id: string) {
  const [t] = await ex.select().from(apiTokens).where(eq(apiTokens.id, id)).limit(1).for("update");
  if (!t) throw new AppError("not_found", "Không tìm thấy token.");
  return t;
}

const SA_Out = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  scopes: z.array(z.string()),
  tree_manager_ids: z.array(z.uuid()),
  version: z.number().int(),
  tokens: z.array(TokenOut),
});

async function serviceAccountView(ex: Executor, userId: string) {
  const [row] = await ex
    .select({ u: users, sa: serviceAccounts })
    .from(users)
    .innerJoin(serviceAccounts, eq(serviceAccounts.userId, users.id))
    .where(and(eq(users.id, userId), eq(users.kind, "service")))
    .limit(1);
  if (!row) throw new AppError("not_found", "Không tìm thấy tài khoản hệ thống.");
  const tokens = await ex.select().from(apiTokens).where(eq(apiTokens.userId, userId)).orderBy(desc(apiTokens.createdAt));
  return {
    id: row.u.id,
    name: row.u.fullName,
    description: row.sa.description,
    status: row.u.status,
    scopes: row.sa.scopes,
    tree_manager_ids: row.sa.treeManagerIds,
    version: row.sa.version,
    tokens: await toOut(ex, tokens),
  };
}

async function assertManagers(ex: Executor, ids: string[]) {
  for (const id of ids) {
    const [u] = await ex.select().from(users).where(eq(users.id, id)).limit(1);
    const m = u ? await currentMembership(ex, id) : null;
    if (!u || !u.roles.includes("manager") || m?.managerId !== id) throw new AppError("validation_error", "Cây được chọn phải là cây của một Manager.", { manager_id: id });
  }
}

function assertServiceScopes(scopes: string[]) {
  const bad = scopes.filter((s) => !SERVICE_ACCOUNT_PERMISSIONS.includes(s as Permission));
  if (bad.length) throw new AppError("validation_error", "Tài khoản hệ thống không được mang các quyền này.", { not_allowed: bad, allowed: SERVICE_ACCOUNT_PERMISSIONS });
}

const actorRefOf = (a: Actor) => ({ userId: a.userId, via: a.via, connectionId: a.connectionId, automationId: a.automationId });

export function tokenOperations() {
  return [
    defineQuery({
      name: "auth.token.list",
      summary: "Token cá nhân của mình.",
      permission: "auth:self",
      aiAllowed: false,
      input: z.object({}),
      output: z.array(TokenOut),
      http: { method: "GET", path: "/auth/tokens" },
      handler: async (ctx) => toOut(ctx.db, await ctx.db.select().from(apiTokens).where(and(eq(apiTokens.userId, ctx.actor.userId), eq(apiTokens.kind, "personal"))).orderBy(desc(apiTokens.createdAt))),
    }),

    defineCommand({
      name: "auth.token.create",
      summary: "Tạo token cá nhân (`soe_pat_…`). Token chỉ hiện một lần và chờ Admin duyệt mới dùng được.",
      description: "Scope không được rộng hơn quyền hiện có của chính mình. Hạn mặc định 90 ngày, tối đa 365 ngày. Token không mang được quyền `auth:*` và `onboarding:*`.",
      permission: "auth:self",
      aiAllowed: false,
      emits: ["auth.token.requested"],
      input: z.object({
        name: z.string().trim().min(1).max(100),
        scopes: scopesSchema,
        expires_in_days: z.number().int().min(1).max(TOKEN_MAX_DAYS).default(TOKEN_DEFAULT_DAYS),
      }),
      output: z.object({ token: z.string(), info: TokenOut }),
      http: { method: "POST", path: "/auth/tokens", status: 201 },
      handler: async (ctx, i) => {
        const p = await ctx.access.requirePrincipal();
        const notAllowed = i.scopes.filter((s) => !isTokenAllowedPermission(s) || !p.permissions.has(s as Permission));
        if (notAllowed.length) throw new AppError("validation_error", "Scope vượt quyền của bạn hoặc không dùng được cho token.", { not_allowed: notAllowed });
        const sec = newSecret(PAT_PREFIX);
        const [row] = await ctx.db
          .insert(apiTokens)
          .values({
            userId: ctx.actor.userId,
            kind: "personal",
            name: i.name,
            tokenPrefix: sec.display,
            tokenHash: sec.hash,
            scopes: i.scopes,
            status: "pending",
            expiresAt: new Date(Date.now() + i.expires_in_days * 86400_000),
            createdBy: ctx.actor.userId,
          })
          .returning();
        ctx.audit({ type: "api_token", id: row!.id, details: { name: i.name, scopes: i.scopes, expires_in_days: i.expires_in_days } });
        await ctx.emit("auth.token.requested", { aggregateType: "api_token", aggregateId: row!.id, payload: { token_id: row!.id, user_id: ctx.actor.userId, name: i.name } });
        return { token: sec.token, info: (await toOut(ctx.db, [row!]))[0]! };
      },
    }),

    defineCommand({
      name: "auth.token.revoke",
      summary: "Thu hồi một token (chủ token hoặc Admin).",
      permission: "auth:self",
      aiAllowed: false,
      emits: ["auth.token.decided"],
      input: z.object({ id: z.uuid(), reason: z.string().trim().max(300).optional() }),
      output: TokenOut,
      http: { method: "DELETE", path: "/auth/tokens/:id" },
      handler: async (ctx, i) => {
        const t = await loadToken(ctx.db, i.id);
        const own = t.userId === ctx.actor.userId;
        const canManage = t.kind === "service" ? await ctx.access.can("auth:service_account:manage") : await ctx.access.can("auth:token:approve");
        if (!own && !canManage) throw new AppError("not_found", "Không tìm thấy token.");
        if (t.status === "revoked") return (await toOut(ctx.db, [t]))[0]!;
        const [upd] = await ctx.db
          .update(apiTokens)
          .set({ status: "revoked", revokedAt: sql`now()`, revokedBy: ctx.actor.userId, revokeReason: i.reason ?? (own ? "Chủ token thu hồi" : "Admin thu hồi"), version: sql`${apiTokens.version} + 1` })
          .where(eq(apiTokens.id, t.id))
          .returning();
        ctx.audit({ type: "api_token", id: t.id, details: { owner: t.userId, reason: i.reason ?? null } });
        await ctx.emit("auth.token.decided", { aggregateType: "api_token", aggregateId: t.id, payload: { token_id: t.id, user_id: t.userId, status: "revoked" } });
        return (await toOut(ctx.db, [upd!]))[0]!;
      },
    }),

    defineQuery({
      name: "auth.token.review_list",
      summary: "Admin: danh sách token cá nhân (mặc định đang chờ duyệt).",
      permission: "auth:token:approve",
      aiAllowed: false,
      input: z.object({ status: z.enum(["pending", "active", "rejected", "revoked", "all"]).default("pending") }),
      output: z.array(TokenOut),
      http: { method: "GET", path: "/admin/tokens" },
      handler: async (ctx, i) =>
        toOut(
          ctx.db,
          await ctx.db
            .select()
            .from(apiTokens)
            .where(and(eq(apiTokens.kind, "personal"), i.status === "all" ? undefined : eq(apiTokens.status, i.status)))
            .orderBy(desc(apiTokens.createdAt))
            .limit(500),
        ),
    }),

    defineCommand({
      name: "auth.token.approve",
      summary: "Admin duyệt token cá nhân. Scope được cắt theo quyền hiện tại của chủ token.",
      description: "Admin không tự duyệt token của chính mình khi còn Admin khác.",
      permission: "auth:token:approve",
      aiAllowed: false,
      emits: ["auth.token.decided"],
      input: z.object({ id: z.uuid(), note: z.string().trim().max(500).optional() }),
      output: TokenOut,
      http: { method: "POST", path: "/admin/tokens/:id/approve" },
      handler: async (ctx, i) => {
        const t = await loadToken(ctx.db, i.id);
        if (t.kind !== "personal" || t.status !== "pending") throw new AppError("validation_error", "Chỉ duyệt được token cá nhân đang chờ.");
        if (t.userId === ctx.actor.userId) {
          const others = (await activeUsersWithRole(ctx.db, "admin")).filter((a) => a.id !== ctx.actor.userId);
          if (others.length > 0) throw new AppError("forbidden", "Token của bạn phải do một Admin khác duyệt.");
        }
        const owner = await loadPrincipal(ctx.db, t.userId);
        if (!owner || owner.status !== "active") throw new AppError("validation_error", "Chủ token không còn hoạt động.");
        const scopes = t.scopes.filter((s) => isTokenAllowedPermission(s) && owner.permissions.has(s as Permission));
        if (scopes.length === 0) throw new AppError("validation_error", "Chủ token không còn quyền nào trong scope của token.");
        const [upd] = await ctx.db
          .update(apiTokens)
          .set({ status: "active", scopes, decidedAt: sql`now()`, decidedBy: ctx.actor.userId, decisionNote: i.note ?? null, version: sql`${apiTokens.version} + 1` })
          .where(eq(apiTokens.id, t.id))
          .returning();
        ctx.audit({ type: "api_token", id: t.id, details: { owner: t.userId, scopes, note: i.note ?? null } });
        await ctx.emit("auth.token.decided", { aggregateType: "api_token", aggregateId: t.id, payload: { token_id: t.id, user_id: t.userId, status: "active" } });
        return (await toOut(ctx.db, [upd!]))[0]!;
      },
    }),

    defineCommand({
      name: "auth.token.reject",
      summary: "Admin từ chối token cá nhân đang chờ.",
      permission: "auth:token:approve",
      aiAllowed: false,
      emits: ["auth.token.decided"],
      input: z.object({ id: z.uuid(), note: z.string().trim().max(500).optional() }),
      output: TokenOut,
      http: { method: "POST", path: "/admin/tokens/:id/reject" },
      handler: async (ctx, i) => {
        const t = await loadToken(ctx.db, i.id);
        if (t.kind !== "personal" || t.status !== "pending") throw new AppError("validation_error", "Chỉ từ chối được token cá nhân đang chờ.");
        const [upd] = await ctx.db
          .update(apiTokens)
          .set({ status: "rejected", decidedAt: sql`now()`, decidedBy: ctx.actor.userId, decisionNote: i.note ?? null, version: sql`${apiTokens.version} + 1` })
          .where(eq(apiTokens.id, t.id))
          .returning();
        ctx.audit({ type: "api_token", id: t.id, details: { owner: t.userId, note: i.note ?? null } });
        await ctx.emit("auth.token.decided", { aggregateType: "api_token", aggregateId: t.id, payload: { token_id: t.id, user_id: t.userId, status: "rejected" } });
        return (await toOut(ctx.db, [upd!]))[0]!;
      },
    }),

    // ---- service accounts (design module1 section 7) --------------------------------------------------
    defineQuery({
      name: "auth.service_account.list",
      summary: "Admin: tài khoản hệ thống (cho hệ thống ngoài bắn dữ liệu vào) và token của chúng.",
      permission: "auth:service_account:manage",
      aiAllowed: false,
      input: z.object({}),
      output: z.array(SA_Out),
      http: { method: "GET", path: "/admin/service-accounts" },
      handler: async (ctx) => {
        const rows = await ctx.db.select({ id: users.id }).from(users).where(eq(users.kind, "service")).orderBy(users.fullName);
        return Promise.all(rows.map((r) => serviceAccountView(ctx.db, r.id)));
      },
    }),

    defineCommand({
      name: "auth.service_account.create",
      summary: "Admin tạo tài khoản hệ thống: tên, scope, giới hạn trong một hoặc vài cây.",
      permission: "auth:service_account:manage",
      aiAllowed: false,
      input: z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(500).optional(),
        scopes: scopesSchema,
        tree_manager_ids: z.array(z.uuid()).max(20).default([]),
      }),
      output: SA_Out,
      http: { method: "POST", path: "/admin/service-accounts", status: 201 },
      handler: async (ctx, i) => {
        assertServiceScopes(i.scopes);
        await assertManagers(ctx.db, i.tree_manager_ids);
        const [u] = await ctx.db
          .insert(users)
          .values({ kind: "service", email: null, fullName: i.name, roles: [], status: "active", createdBy: ctx.actor.userId, updatedBy: ctx.actor.userId })
          .returning();
        await ctx.db.insert(serviceAccounts).values({ userId: u!.id, description: i.description ?? null, scopes: i.scopes, treeManagerIds: i.tree_manager_ids, createdBy: ctx.actor.userId, updatedBy: ctx.actor.userId });
        ctx.audit({ type: "service_account", id: u!.id, details: { name: i.name, scopes: i.scopes, tree_manager_ids: i.tree_manager_ids } });
        return serviceAccountView(ctx.db, u!.id);
      },
    }),

    defineCommand({
      name: "auth.service_account.update",
      summary: "Admin sửa tài khoản hệ thống (mô tả, scope, cây).",
      permission: "auth:service_account:manage",
      aiAllowed: false,
      input: z.object({
        id: z.uuid(),
        version: z.number().int().min(1),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().trim().max(500).nullish(),
        scopes: scopesSchema.optional(),
        tree_manager_ids: z.array(z.uuid()).max(20).optional(),
      }),
      output: SA_Out,
      http: { method: "PATCH", path: "/admin/service-accounts/:id" },
      handler: async (ctx, i) => {
        const before = await serviceAccountView(ctx.db, i.id);
        if (before.version !== i.version) throw new AppError("conflict", undefined, { current_version: before.version, sent_version: i.version });
        if (i.scopes) assertServiceScopes(i.scopes);
        if (i.tree_manager_ids) await assertManagers(ctx.db, i.tree_manager_ids);
        await ctx.db
          .update(serviceAccounts)
          .set({
            description: i.description !== undefined ? i.description : before.description,
            scopes: i.scopes ?? before.scopes,
            treeManagerIds: i.tree_manager_ids ?? before.tree_manager_ids,
            version: sql`${serviceAccounts.version} + 1`,
            updatedAt: sql`now()`,
            updatedBy: ctx.actor.userId,
          })
          .where(eq(serviceAccounts.userId, i.id));
        if (i.name) await ctx.db.update(users).set({ fullName: i.name, version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: ctx.actor.userId }).where(eq(users.id, i.id));
        if (i.scopes) {
          // Tokens of the account carry the account scopes; narrow them too.
          await ctx.db.execute(sql`UPDATE api_tokens SET scopes = ARRAY(SELECT unnest(scopes) INTERSECT SELECT unnest(${`{${i.scopes.join(",")}}`}::text[])), version = version + 1 WHERE user_id = ${i.id} AND status IN ('pending', 'active')`);
        }
        const after = await serviceAccountView(ctx.db, i.id);
        ctx.audit({ type: "service_account", id: i.id, details: { before: { scopes: before.scopes, trees: before.tree_manager_ids }, after: { scopes: after.scopes, trees: after.tree_manager_ids } } });
        return after;
      },
    }),

    defineCommand({
      name: "auth.service_account.disable",
      summary: "Admin tắt tài khoản hệ thống; mọi token của nó bị thu hồi.",
      permission: "auth:service_account:manage",
      aiAllowed: false,
      input: z.object({ id: z.uuid() }),
      output: SA_Out,
      http: { method: "POST", path: "/admin/service-accounts/:id/disable" },
      handler: async (ctx, i) => {
        await serviceAccountView(ctx.db, i.id);
        await ctx.db.update(users).set({ status: "locked", version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: ctx.actor.userId }).where(eq(users.id, i.id));
        const n = await revokeUserTokens(ctx.db, i.id, { by: ctx.actor.userId, reason: "Tài khoản hệ thống bị tắt" });
        ctx.audit({ type: "service_account", id: i.id, details: { tokens_revoked: n } });
        return serviceAccountView(ctx.db, i.id);
      },
    }),

    defineCommand({
      name: "auth.service_account.enable",
      summary: "Admin bật lại tài khoản hệ thống (token cũ vẫn bị thu hồi; tạo token mới).",
      permission: "auth:service_account:manage",
      aiAllowed: false,
      input: z.object({ id: z.uuid() }),
      output: SA_Out,
      http: { method: "POST", path: "/admin/service-accounts/:id/enable" },
      handler: async (ctx, i) => {
        await serviceAccountView(ctx.db, i.id);
        await ctx.db.update(users).set({ status: "active", version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: ctx.actor.userId }).where(eq(users.id, i.id));
        ctx.audit({ type: "service_account", id: i.id });
        return serviceAccountView(ctx.db, i.id);
      },
    }),

    defineCommand({
      name: "auth.service_account.token_create",
      summary: "Admin tạo token `soe_svc_…` cho tài khoản hệ thống. Token chỉ hiện một lần, dùng được ngay.",
      permission: "auth:service_account:manage",
      aiAllowed: false,
      input: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100), expires_in_days: z.number().int().min(1).max(TOKEN_MAX_DAYS).default(TOKEN_MAX_DAYS) }),
      output: z.object({ token: z.string(), info: TokenOut }),
      http: { method: "POST", path: "/admin/service-accounts/:id/tokens", status: 201 },
      handler: async (ctx, i) => {
        const sa = await serviceAccountView(ctx.db, i.id);
        if (sa.status !== "active") throw new AppError("validation_error", "Tài khoản hệ thống đang tắt.");
        const sec = newSecret(SVC_PREFIX);
        const [row] = await ctx.db
          .insert(apiTokens)
          .values({
            userId: i.id,
            kind: "service",
            name: i.name,
            tokenPrefix: sec.display,
            tokenHash: sec.hash,
            scopes: sa.scopes,
            status: "active",
            expiresAt: new Date(Date.now() + i.expires_in_days * 86400_000),
            createdBy: ctx.actor.userId,
            decidedAt: new Date(),
            decidedBy: ctx.actor.userId,
          })
          .returning();
        ctx.audit({ type: "api_token", id: row!.id, details: { service_account: i.id, name: i.name, by: actorRefOf(ctx.actor).userId } });
        return { token: sec.token, info: (await toOut(ctx.db, [row!]))[0]! };
      },
    }),
  ];
}
