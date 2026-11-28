import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, ROLES, ROLE_PERMISSIONS, SUPPLEMENTARY_PERMISSIONS, listParamsShape, type Role } from "@soe/shared";
import { diffRows, listPage, orgMemberships, recordRowHistory, userPermissions, users, type FieldMap } from "@soe/db";
import { scopeIncludes, scopeSql, type Scope } from "../../auth/access";
import { revokeUserSessions, revokeUserTokens } from "../../auth/sessions";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx, ListOutput } from "../../core/types";
import { SETTINGS, readSetting } from "../system/settings-catalog";
import { assertNoOrphans, assertRoleSet, reconcileUserTokens, validatePlacement, writePlacement } from "./service";
import { UserOut, assertAllowedDomain, currentMembership, emailSchema, getPerson, getUserView, namesOf, toUserView } from "./view";
import type { Actor } from "@soe/shared";

const roleArray = z.array(z.enum(ROLES)).min(1).max(5).transform((r) => [...new Set(r)] as Role[]);
const ELEVATED: Role[] = ["admin", "manager"];

type Ctx = HandlerCtx<Actor>;

async function requireWritable(ctx: Ctx, userId: string): Promise<Scope> {
  const scope = await ctx.access.scope("org_write");
  if (!scopeIncludes(scope, userId)) throw new AppError("forbidden", "Người này không thuộc cây của bạn.");
  return scope;
}

function touchesElevated(before: Role[], after: Role[]): boolean {
  return ELEVATED.some((r) => before.includes(r) !== after.includes(r));
}

async function requireElevatedIfNeeded(ctx: Ctx, before: Role[], after: Role[]) {
  if (touchesElevated(before, after) && !(await ctx.access.can("org:role:elevated"))) {
    throw new AppError("forbidden", "Chỉ Admin được gán hoặc gỡ vai trò Manager, Admin.");
  }
}

/** A Manager may only place people inside their own tree. */
async function requirePlacementAllowed(ctx: Ctx, managerId: string | null) {
  const scope = await ctx.access.scope("org_write");
  if (scope.all) return;
  const me = await ctx.access.requirePrincipal();
  if (managerId !== me.userId) throw new AppError("forbidden", "Manager chỉ thêm và sắp xếp người trong cây của mình.");
}

const actorRefOf = (a: Actor) => ({ userId: a.userId, via: a.via, connectionId: a.connectionId, automationId: a.automationId });

const memberFields: FieldMap = {
  id: { type: "uuid", expr: sql`u.id` },
  email: { type: "text", expr: sql`u.email` },
  full_name: { type: "text", expr: sql`u.full_name` },
  title: { type: "text", expr: sql`u.title` },
  phone: { type: "text", expr: sql`u.phone`, sortable: false },
  roles: { type: "text", expr: sql`array_to_string(u.roles, ',')` },
  guest_preset: { type: "enum", expr: sql`u.guest_preset`, values: ["sale", "data"] },
  status: { type: "enum", expr: sql`u.status`, values: ["inactive", "active", "locked"] },
  manager_id: { type: "uuid", expr: sql`m.manager_id` },
  manager_name: { type: "text", expr: sql`mu.full_name` },
  leader_id: { type: "uuid", expr: sql`m.leader_id` },
  leader_name: { type: "text", expr: sql`lu.full_name` },
  last_login_at: { type: "datetime", expr: sql`u.last_login_at` },
  created_at: { type: "datetime", expr: sql`u.created_at` },
  version: { type: "number", expr: sql`u.version` },
};

export const orgOperations = [
  defineQuery({
    name: "org.member.list",
    summary: "Danh sách org chart (theo phạm vi: Admin thấy tất cả, người khác thấy cây của mình).",
    permission: "org:member:read",
    aiAllowed: true,
    list: true,
    input: z.object(listParamsShape),
    output: z.record(z.string(), z.unknown()),
    http: { method: "GET", path: "/org/members" },
    handler: async (ctx, i): Promise<ListOutput> => {
      const scope = await ctx.access.scope("org");
      return listPage(ctx.db, {
        from: sql`users u
          LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL
          LEFT JOIN users mu ON mu.id = m.manager_id
          LEFT JOIN users lu ON lu.id = m.leader_id`,
        fields: memberFields,
        baseWhere: sql`u.kind = 'person' AND ${scopeSql(sql`u.id`, scope)}`,
        filter: i.filter,
        sort: i.sort,
        defaultSort: [{ field: "full_name", dir: "asc" }],
        select: i.fields,
        limit: i.limit,
        cursor: i.cursor,
        includeTotal: i.include_total,
      }).then((page) => ({
        ...page,
        // `roles` is filtered as text (comma list) but must come back as an array, like in org.member.get.
        items: page.items.map((r) => (typeof r.roles === "string" ? { ...r, roles: r.roles === "" ? [] : r.roles.split(",") } : r)),
      }));
    },
  }),

  defineQuery({
    name: "org.member.get",
    summary: "Xem một người trong org chart.",
    permission: "org:member:read",
    aiAllowed: true,
    input: z.object({ id: z.uuid() }),
    output: UserOut,
    http: { method: "GET", path: "/org/members/:id" },
    handler: async (ctx, i) => {
      const scope = await ctx.access.scope("org");
      const v = await getUserView(ctx.db, i.id);
      if (!v || v.kind !== "person" || !scopeIncludes(scope, v.id)) throw new AppError("not_found", "Không tìm thấy người này.");
      return v;
    },
  }),

  defineQuery({
    name: "org.tree.get",
    summary: "Cây tổ chức hiện tại: Manager → Leader → thành viên (theo phạm vi xem).",
    permission: "org:member:read",
    aiAllowed: true,
    input: z.object({}),
    output: z.object({
      trees: z.array(z.object({ manager: z.record(z.string(), z.unknown()), leaders: z.array(z.record(z.string(), z.unknown())), direct: z.array(z.record(z.string(), z.unknown())) })),
      outside: z.array(z.record(z.string(), z.unknown())),
    }),
    http: { method: "GET", path: "/org/tree" },
    handler: async (ctx) => {
      const scope = await ctx.access.scope("org");
      const rows = (
        await ctx.db.execute(sql`
          SELECT u.id, u.email, u.full_name, u.title, u.roles, u.status, u.guest_preset, m.manager_id, m.leader_id
          FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL
          WHERE u.kind = 'person' AND ${scopeSql(sql`u.id`, scope)}
          ORDER BY u.full_name`)
      ).rows as { id: string; roles: string[]; manager_id: string | null; leader_id: string | null }[];
      const managers = rows.filter((r) => r.manager_id === r.id);
      const trees = managers.map((mg) => {
        const inTree = rows.filter((r) => r.manager_id === mg.id && r.id !== mg.id);
        const leaders = inTree.filter((r) => r.roles.includes("leader")).map((l) => ({ ...l, members: inTree.filter((r) => r.leader_id === l.id) }));
        const direct = inTree.filter((r) => !r.roles.includes("leader") && !r.leader_id);
        return { manager: mg, leaders, direct };
      });
      const outside = rows.filter((r) => !r.manager_id);
      return { trees, outside };
    },
  }),

  defineCommand({
    name: "org.member.create",
    summary: "Thêm một người vào org chart (trạng thái Chưa kích hoạt). Đây là cách duy nhất để có tài khoản.",
    description: "Admin thêm được mọi người. Manager chỉ thêm người vào cây của mình, với vai trò Leader, User hoặc Guest.",
    permission: "org:member:write",
    aiAllowed: true,
    emits: ["org.member.changed"],
    input: z.object({
      email: emailSchema,
      full_name: z.string().trim().min(1).max(200),
      title: z.string().trim().max(200).nullish(),
      phone: z.string().trim().max(50).nullish(),
      roles: roleArray,
      guest_preset: z.enum(["sale", "data"]).nullish(),
      manager_id: z.uuid().nullish(),
      leader_id: z.uuid().nullish(),
    }),
    output: UserOut,
    http: { method: "POST", path: "/org/members", status: 201 },
    handler: async (ctx, i) => {
      assertAllowedDomain(i.email, await readSetting(ctx.db, SETTINGS.allowedDomains));
      assertRoleSet(i.roles, i.guest_preset);
      await requireElevatedIfNeeded(ctx, [], i.roles);
      const [dup] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, i.email)).limit(1);
      if (dup) throw new AppError("conflict", "Email này đã có trong org chart.", { user_id: dup.id });
      const [u] = await ctx.db
        .insert(users)
        .values({
          email: i.email,
          fullName: i.full_name,
          title: i.title ?? null,
          phone: i.phone ?? null,
          roles: i.roles,
          guestPreset: i.guest_preset ?? null,
          status: "inactive",
          createdBy: ctx.actor.userId,
          updatedBy: ctx.actor.userId,
        })
        .returning();
      const placement = await validatePlacement(ctx.db, u!.id, i.roles, { managerId: i.manager_id ?? null, leaderId: i.leader_id ?? null });
      await requirePlacementAllowed(ctx, placement.managerId);
      await writePlacement(ctx.db, u!.id, placement, ctx.actor.userId);
      const view = toUserView(u!, placement.managerId ? { managerId: placement.managerId, leaderId: placement.leaderId } : null);
      await recordRowHistory(ctx.db, { tableId: "users", rowId: u!.id, version: 1, op: "create", changes: diffRows(null, { email: i.email, fullName: i.full_name, roles: i.roles, managerId: placement.managerId, leaderId: placement.leaderId }), actor: actorRefOf(ctx.actor) });
      ctx.audit({ type: "user", id: u!.id, details: { email: i.email, roles: i.roles, manager_id: placement.managerId, leader_id: placement.leaderId } });
      await ctx.emit("org.member.changed", { aggregateType: "user", aggregateId: u!.id, payload: { user_id: u!.id, change: "created" } });
      return view;
    },
  }),

  defineCommand({
    name: "org.member.update",
    summary: "Sửa thông tin, vai trò và vị trí trong cây của một người.",
    description: "Đổi vai trò có hiệu lực ngay; token cá nhân vượt quyền mới bị thu hẹp hoặc thu hồi. Đổi cấp trên được lưu lịch sử.",
    permission: "org:member:write",
    aiAllowed: true,
    emits: ["org.member.changed"],
    input: z.object({
      id: z.uuid(),
      version: z.number().int().min(1),
      full_name: z.string().trim().min(1).max(200).optional(),
      title: z.string().trim().max(200).nullish(),
      phone: z.string().trim().max(50).nullish(),
      roles: roleArray.optional(),
      guest_preset: z.enum(["sale", "data"]).nullish(),
      manager_id: z.uuid().nullish(),
      leader_id: z.uuid().nullish(),
    }),
    output: UserOut,
    http: { method: "PATCH", path: "/org/members/:id" },
    handler: async (ctx, i) => {
      await requireWritable(ctx, i.id);
      const u = await getPerson(ctx.db, i.id, true);
      if (u.version !== i.version) throw new AppError("conflict", undefined, { current_version: u.version, sent_version: i.version });
      const cur = await currentMembership(ctx.db, u.id);
      const roles = (i.roles ?? u.roles) as Role[];
      const guestPreset = i.guest_preset !== undefined ? i.guest_preset : roles.includes("guest") ? u.guestPreset : null;
      assertRoleSet(roles, guestPreset);
      await requireElevatedIfNeeded(ctx, u.roles as Role[], roles);
      const wantPlace = i.manager_id !== undefined || i.leader_id !== undefined || i.roles !== undefined;
      let placement = { managerId: cur?.managerId ?? null, leaderId: cur?.leaderId ?? null };
      if (wantPlace) {
        placement = await validatePlacement(ctx.db, u.id, roles, {
          managerId: i.manager_id !== undefined ? i.manager_id : placement.managerId,
          leaderId: i.leader_id !== undefined ? i.leader_id : i.manager_id !== undefined && i.manager_id !== placement.managerId ? null : placement.leaderId,
        });
        if (placement.managerId !== (cur?.managerId ?? null)) await requirePlacementAllowed(ctx, placement.managerId);
        await assertNoOrphans(ctx.db, u, roles, placement);
      }
      const set: Partial<typeof users.$inferInsert> = {
        fullName: i.full_name ?? u.fullName,
        title: i.title !== undefined ? i.title : u.title,
        phone: i.phone !== undefined ? i.phone : u.phone,
        roles,
        guestPreset: guestPreset ?? null,
      };
      const [upd] = await ctx.db
        .update(users)
        .set({ ...set, version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: ctx.actor.userId })
        .where(eq(users.id, u.id))
        .returning();
      const moved = wantPlace ? await writePlacement(ctx.db, u.id, placement, ctx.actor.userId) : false;
      const changes = diffRows(
        { fullName: u.fullName, title: u.title, phone: u.phone, roles: u.roles, guestPreset: u.guestPreset, managerId: cur?.managerId ?? null, leaderId: cur?.leaderId ?? null },
        { ...set, managerId: placement.managerId, leaderId: placement.leaderId },
      );
      await recordRowHistory(ctx.db, { tableId: "users", rowId: u.id, version: upd!.version, op: "update", changes, actor: actorRefOf(ctx.actor) });
      const tokens = await reconcileUserTokens(ctx.db, u.id, ctx.actor.userId);
      ctx.audit({ type: "user", id: u.id, details: { changes, moved, tokens } });
      await ctx.emit("org.member.changed", { aggregateType: "user", aggregateId: u.id, payload: { user_id: u.id, change: "updated" } });
      return toUserView(upd!, placement.managerId ? { managerId: placement.managerId, leaderId: placement.leaderId } : null);
    },
  }),

  defineCommand({
    name: "org.member.lock",
    summary: "Khoá tài khoản (xoá khỏi org chart = khoá; dữ liệu giữ nguyên). Mọi phiên và token bị thu hồi.",
    permission: "org:member:write",
    aiAllowed: true,
    emits: ["org.member.changed"],
    input: z.object({ id: z.uuid(), reason: z.string().trim().max(500).optional() }),
    output: UserOut,
    http: { method: "POST", path: "/org/members/:id/lock" },
    handler: async (ctx, i) => {
      if (i.id === ctx.actor.userId) throw new AppError("validation_error", "Không tự khoá tài khoản của mình.");
      await requireWritable(ctx, i.id);
      const u = await getPerson(ctx.db, i.id, true);
      await requireElevatedIfNeeded(ctx, u.roles as Role[], (u.roles as Role[]).filter((r) => !ELEVATED.includes(r)));
      const [upd] = await ctx.db
        .update(users)
        .set({ status: "locked", version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: ctx.actor.userId })
        .where(eq(users.id, u.id))
        .returning();
      const sessionsRevoked = await revokeUserSessions(ctx.db, u.id, { by: ctx.actor.userId, reason: "Tài khoản bị khoá" });
      const tokensRevoked = await revokeUserTokens(ctx.db, u.id, { by: ctx.actor.userId, reason: "Tài khoản bị khoá" });
      await recordRowHistory(ctx.db, { tableId: "users", rowId: u.id, version: upd!.version, op: "update", changes: [{ field: "status", old: u.status, new: "locked" }], actor: actorRefOf(ctx.actor) });
      ctx.audit({ type: "user", id: u.id, details: { reason: i.reason ?? null, sessions_revoked: sessionsRevoked, tokens_revoked: tokensRevoked } });
      await ctx.emit("org.member.changed", { aggregateType: "user", aggregateId: u.id, payload: { user_id: u.id, change: "locked" } });
      return toUserView(upd!, await currentMembership(ctx.db, u.id));
    },
  }),

  defineCommand({
    name: "org.member.unlock",
    summary: "Mở khoá tài khoản. Người đã từng đặt mật khẩu trở lại Đang hoạt động; chưa thì Chưa kích hoạt.",
    permission: "org:member:write",
    aiAllowed: true,
    emits: ["org.member.changed"],
    input: z.object({ id: z.uuid() }),
    output: UserOut,
    http: { method: "POST", path: "/org/members/:id/unlock" },
    handler: async (ctx, i) => {
      await requireWritable(ctx, i.id);
      const u = await getPerson(ctx.db, i.id, true);
      await requireElevatedIfNeeded(ctx, u.roles as Role[], (u.roles as Role[]).filter((r) => !ELEVATED.includes(r)));
      const status = u.passwordHash ? "active" : "inactive";
      const [upd] = await ctx.db
        .update(users)
        .set({ status, failedLoginCount: 0, lockedUntil: null, version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: ctx.actor.userId })
        .where(eq(users.id, u.id))
        .returning();
      await recordRowHistory(ctx.db, { tableId: "users", rowId: u.id, version: upd!.version, op: "update", changes: [{ field: "status", old: u.status, new: status }], actor: actorRefOf(ctx.actor) });
      ctx.audit({ type: "user", id: u.id, details: { status } });
      await ctx.emit("org.member.changed", { aggregateType: "user", aggregateId: u.id, payload: { user_id: u.id, change: "unlocked" } });
      return toUserView(upd!, await currentMembership(ctx.db, u.id));
    },
  }),

  defineQuery({
    name: "org.member.history",
    summary: "Lịch sử vị trí trong cây của một người (valid_from → valid_to).",
    permission: "org:member:read",
    aiAllowed: true,
    input: z.object({ id: z.uuid() }),
    output: z.array(z.object({ manager_id: z.uuid(), manager_name: z.string().nullable(), leader_id: z.uuid().nullable(), leader_name: z.string().nullable(), valid_from: z.date().or(z.string()), valid_to: z.date().or(z.string()).nullable() })),
    http: { method: "GET", path: "/org/members/:id/history" },
    handler: async (ctx, i) => {
      const scope = await ctx.access.scope("org");
      if (!scopeIncludes(scope, i.id)) throw new AppError("not_found", "Không tìm thấy người này.");
      const rows = await ctx.db.select().from(orgMemberships).where(eq(orgMemberships.userId, i.id)).orderBy(asc(orgMemberships.validFrom));
      const names = await namesOf(ctx.db, rows.flatMap((r) => [r.managerId, r.leaderId ?? ""]));
      return rows.map((r) => ({
        manager_id: r.managerId,
        manager_name: names.get(r.managerId)?.full_name ?? null,
        leader_id: r.leaderId,
        leader_name: r.leaderId ? (names.get(r.leaderId)?.full_name ?? null) : null,
        valid_from: r.validFrom,
        valid_to: r.validTo,
      }));
    },
  }),

  // ---- supplementary permissions (design module1 section 3.3) ----------------------------------------
  defineQuery({
    name: "org.permission.catalog",
    summary: "Danh mục quyền bổ sung: quyền nào, ai được cấp, cấp cho vai trò nào.",
    permission: "org:member:read",
    aiAllowed: true,
    input: z.object({}),
    output: z.array(z.object({ permission: z.string(), label: z.string(), grantable_by: z.array(z.string()), eligible_roles: z.array(z.string()) })),
    http: { method: "GET", path: "/org/permissions/catalog" },
    handler: async () => SUPPLEMENTARY_PERMISSIONS.map((s) => ({ permission: s.permission, label: s.label, grantable_by: s.grantableBy, eligible_roles: s.eligibleRoles })),
  }),

  defineQuery({
    name: "org.permission.list",
    summary: "Quyền bổ sung đang có của một người.",
    permission: "org:member:read",
    aiAllowed: true,
    input: z.object({ id: z.uuid() }),
    output: z.array(z.object({ permission: z.string(), note: z.string().nullable(), granted_at: z.date().or(z.string()), granted_by: z.uuid().nullable(), granted_by_name: z.string().nullable() })),
    http: { method: "GET", path: "/org/members/:id/permissions" },
    handler: async (ctx, i) => {
      const scope = await ctx.access.scope("org");
      if (!scopeIncludes(scope, i.id)) throw new AppError("not_found", "Không tìm thấy người này.");
      const rows = await ctx.db.select().from(userPermissions).where(and(eq(userPermissions.userId, i.id), isNull(userPermissions.revokedAt)));
      const names = await namesOf(ctx.db, rows.map((r) => r.grantedBy ?? ""));
      return rows.map((r) => ({ permission: r.permission, note: r.note, granted_at: r.grantedAt, granted_by: r.grantedBy, granted_by_name: r.grantedBy ? (names.get(r.grantedBy)?.full_name ?? null) : null }));
    },
  }),

  defineQuery({
    name: "org.permission.holders",
    summary: "Mỗi quyền bổ sung: những người đang được cấp (trong phạm vi cây của bạn) và bạn có cấp/gỡ được không.",
    description: "`can_manage`: vai trò của bạn được cấp/gỡ quyền này. `holders[].writable`: người đó nằm trong phạm vi bạn sửa (Admin: tất cả; Manager: cây mình). `by_roles`: vai trò có quyền này sẵn (không cần cấp). Cấp/gỡ dùng `org.permission.grant` / `org.permission.revoke`.",
    permission: "org:permission:grant",
    aiAllowed: true,
    input: z.object({}),
    output: z.array(
      z.object({
        permission: z.string(),
        label: z.string(),
        grantable_by: z.array(z.string()),
        eligible_roles: z.array(z.string()),
        by_roles: z.array(z.string()),
        can_manage: z.boolean(),
        holders: z.array(z.object({ user_id: z.uuid(), full_name: z.string(), email: z.string().nullable(), roles: z.array(z.string()), note: z.string().nullable(), granted_at: z.date().or(z.string()), granted_by_name: z.string().nullable(), writable: z.boolean() })),
      }),
    ),
    http: { method: "GET", path: "/org/permissions/holders" },
    handler: async (ctx) => {
      const me = await ctx.access.requirePrincipal();
      const scope = await ctx.access.scope("org");
      const writeScope = await ctx.access.scope("org_write");
      const res = await ctx.db.execute(sql`SELECT up.permission, up.note, up.granted_at, u.id AS user_id, u.full_name, u.email, u.roles, gb.full_name AS granted_by_name
        FROM user_permissions up JOIN users u ON u.id = up.user_id LEFT JOIN users gb ON gb.id = up.granted_by
        WHERE up.revoked_at IS NULL AND u.kind = 'person' AND u.status <> 'locked' AND ${scopeSql(sql`u.id`, scope)}
        ORDER BY u.full_name, u.id`);
      const rows = res.rows as { permission: string; note: string | null; granted_at: Date | string; user_id: string; full_name: string; email: string | null; roles: string[]; granted_by_name: string | null }[];
      return SUPPLEMENTARY_PERMISSIONS.map((def) => {
        const canManage = def.grantableBy.some((r) => me.roles.includes(r));
        const adminGrant = me.roles.includes("admin") && def.grantableBy.includes("admin");
        return {
          permission: def.permission,
          label: def.label,
          grantable_by: def.grantableBy,
          eligible_roles: def.eligibleRoles,
          by_roles: ROLES.filter((r) => ROLE_PERMISSIONS[r].includes(def.permission)),
          can_manage: canManage,
          holders: rows
            .filter((r) => r.permission === def.permission)
            .map((r) => ({ user_id: r.user_id, full_name: r.full_name, email: r.email, roles: r.roles, note: r.note, granted_at: r.granted_at, granted_by_name: r.granted_by_name, writable: canManage && (adminGrant || scopeIncludes(writeScope, r.user_id)) })),
        };
      });
    },
  }),

  defineCommand({
    name: "org.permission.grant",
    summary: "Cấp một quyền bổ sung trong danh mục cho một người.",
    permission: "org:permission:grant",
    aiAllowed: true,
    emits: ["org.member.changed"],
    input: z.object({ id: z.uuid(), permission: z.string().min(3).max(100), note: z.string().trim().max(500).optional() }),
    output: z.object({ user_id: z.uuid(), permission: z.string(), granted: z.boolean() }),
    http: { method: "POST", path: "/org/members/:id/permissions" },
    handler: async (ctx, i) => {
      const def = SUPPLEMENTARY_PERMISSIONS.find((s) => s.permission === i.permission);
      if (!def) throw new AppError("validation_error", "Quyền này không có trong danh mục quyền bổ sung.");
      const me = await ctx.access.requirePrincipal();
      if (!def.grantableBy.some((r) => me.roles.includes(r))) throw new AppError("forbidden", `Bạn không được cấp quyền "${def.label}".`);
      // Admin grants anyone; a Manager only people of their own tree.
      const isAdminGrant = me.roles.includes("admin") && def.grantableBy.includes("admin");
      if (!isAdminGrant) await requireWritable(ctx, i.id);
      const u = await getPerson(ctx.db, i.id);
      if (!def.eligibleRoles.some((r) => u.roles.includes(r))) {
        throw new AppError("validation_error", `Quyền "${def.label}" chỉ cấp cho vai trò: ${def.eligibleRoles.join(", ")}.`);
      }
      const ins = await ctx.db
        .insert(userPermissions)
        .values({ userId: i.id, permission: i.permission, note: i.note ?? null, grantedBy: ctx.actor.userId })
        .onConflictDoNothing()
        .returning({ id: userPermissions.id });
      ctx.audit({ type: "user", id: i.id, details: { permission: i.permission, note: i.note ?? null } });
      await ctx.emit("org.member.changed", { aggregateType: "user", aggregateId: i.id, payload: { user_id: i.id, change: "permission_granted" } });
      return { user_id: i.id, permission: i.permission, granted: ins.length > 0 };
    },
  }),

  defineCommand({
    name: "org.permission.revoke",
    summary: "Thu hồi một quyền bổ sung.",
    permission: "org:permission:grant",
    aiAllowed: true,
    emits: ["org.member.changed"],
    input: z.object({ id: z.uuid(), permission: z.string().min(3).max(100) }),
    output: z.object({ user_id: z.uuid(), permission: z.string(), revoked: z.boolean() }),
    http: { method: "DELETE", path: "/org/members/:id/permissions/:permission" },
    handler: async (ctx, i) => {
      const def = SUPPLEMENTARY_PERMISSIONS.find((s) => s.permission === i.permission);
      if (!def) throw new AppError("validation_error", "Quyền này không có trong danh mục quyền bổ sung.");
      const me = await ctx.access.requirePrincipal();
      if (!def.grantableBy.some((r) => me.roles.includes(r))) throw new AppError("forbidden", `Bạn không được thu hồi quyền "${def.label}".`);
      if (!(me.roles.includes("admin") && def.grantableBy.includes("admin"))) await requireWritable(ctx, i.id);
      const res = await ctx.db
        .update(userPermissions)
        .set({ revokedAt: sql`now()`, revokedBy: ctx.actor.userId })
        .where(and(eq(userPermissions.userId, i.id), eq(userPermissions.permission, i.permission), isNull(userPermissions.revokedAt)));
      const tokens = await reconcileUserTokens(ctx.db, i.id, ctx.actor.userId);
      ctx.audit({ type: "user", id: i.id, details: { permission: i.permission, tokens } });
      await ctx.emit("org.member.changed", { aggregateType: "user", aggregateId: i.id, payload: { user_id: i.id, change: "permission_revoked" } });
      return { user_id: i.id, permission: i.permission, revoked: (res.rowCount ?? 0) > 0 };
    },
  }),
];
