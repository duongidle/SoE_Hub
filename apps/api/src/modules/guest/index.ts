import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, type Actor } from "@soe/shared";
import { dataGrants, users, type Executor } from "@soe/db";
import type { EventDef } from "../../core/events";
import { defineCommand, defineQuery } from "../../core/registry";
import { currentMembership, namesOf } from "../org/view";

/**
 * Data grants for Guests (design module1 section 5.2). Stage 1 builds the frame: table, permission, checks.
 * The module that owns a kind of data registers it here (Deals in Stage 4) and calls `guestCanAccess` in its queries.
 * A grant never includes personal columns: only system + shared columns, whatever the data type.
 */
export const GRANT_CHANNELS = ["web", "export", "api"] as const;
export type GrantChannel = (typeof GRANT_CHANNELS)[number];

export interface GrantDataType {
  key: string;
  label: string;
  /** Channels that make sense for this data. */
  channels: GrantChannel[];
  /** A data type that needs more than the scope (which table, which columns): checks the options and returns them normalized. Without it a grant takes no options. */
  validateOptions?: (ctx: { db: Executor }, managerId: string, options: Record<string, unknown> | undefined) => Promise<Record<string, unknown>>;
}

const dataTypes = new Map<string, GrantDataType>();

export function registerGrantDataType(t: GrantDataType): void {
  dataTypes.set(t.key, t);
}

export function unregisterGrantDataType(key: string): void {
  dataTypes.delete(key);
}

export function listGrantDataTypes(): GrantDataType[] {
  return [...dataTypes.values()];
}

/**
 * Whether a guest may read data of `dataType` owned by `ownerUserId` through `channel`, by an active, unexpired grant
 * covering the owner's current place (whole tree, or the team of a leader). Modules call this in their scoped queries.
 */
export async function guestCanAccess(ex: Executor, i: { guestUserId: string; dataType: string; channel: GrantChannel; ownerUserId: string }): Promise<boolean> {
  const m = await currentMembership(ex, i.ownerUserId);
  if (!m) return false;
  const rows = await ex
    .select({ id: dataGrants.id, leaderId: dataGrants.scopeLeaderId })
    .from(dataGrants)
    .where(
      and(
        eq(dataGrants.guestUserId, i.guestUserId),
        eq(dataGrants.dataType, i.dataType),
        eq(dataGrants.scopeManagerId, m.managerId),
        isNull(dataGrants.revokedAt),
        isNull(dataGrants.deletedAt),
        or(isNull(dataGrants.expiresAt), gt(dataGrants.expiresAt, sql`now()`)),
        sql`${i.channel} = ANY(${dataGrants.channels})`,
      ),
    );
  return rows.some((g) => g.leaderId === null || g.leaderId === i.ownerUserId || g.leaderId === m.leaderId);
}

const GrantOut = z.object({
  id: z.uuid(),
  guest_user_id: z.uuid(),
  guest_name: z.string().nullable(),
  data_type: z.string(),
  scope_manager_id: z.uuid(),
  scope_leader_id: z.uuid().nullable(),
  scope_label: z.string(),
  channels: z.array(z.string()),
  columns: z.literal("system_and_shared"),
  expires_at: z.date().or(z.string()).nullable(),
  note: z.string().nullable(),
  options: z.record(z.string(), z.unknown()).nullable().describe("Loại `datahub_table`: `{ table_id, columns: [mã cột Guest được thấy] }`."),
  revoked_at: z.date().or(z.string()).nullable(),
  created_at: z.date().or(z.string()),
  version: z.number().int(),
});

async function toOut(ex: Executor, rows: (typeof dataGrants.$inferSelect)[]) {
  const names = await namesOf(ex, rows.flatMap((r) => [r.guestUserId, r.scopeManagerId, r.scopeLeaderId ?? ""]));
  return rows.map((g) => ({
    id: g.id,
    guest_user_id: g.guestUserId,
    guest_name: names.get(g.guestUserId)?.full_name ?? null,
    data_type: g.dataType,
    scope_manager_id: g.scopeManagerId,
    scope_leader_id: g.scopeLeaderId,
    scope_label: g.scopeLeaderId ? `Team ${names.get(g.scopeLeaderId)?.full_name ?? ""}` : `Cả cây ${names.get(g.scopeManagerId)?.full_name ?? ""}`,
    channels: g.channels,
    columns: "system_and_shared" as const,
    expires_at: g.expiresAt,
    note: g.note,
    options: g.options ?? null,
    revoked_at: g.revokedAt,
    created_at: g.createdAt,
    version: g.version,
  }));
}

async function myTree(ctx: { access: { requirePrincipal(): Promise<{ userId: string; managerId: string | null; roles: string[] }> } }) {
  const p = await ctx.access.requirePrincipal();
  if (!p.roles.includes("manager") || p.managerId !== p.userId) throw new AppError("forbidden", "Chỉ Manager cấp dữ liệu, với dữ liệu trong cây của mình.");
  return p.userId;
}

export const guestEvents: EventDef[] = [
  {
    name: "guest.grant.changed",
    version: 1,
    description: "Một quyền cấp dữ liệu cho Guest được tạo hoặc thu hồi.",
    schema: z.object({ grant_id: z.uuid(), guest_user_id: z.uuid(), scope_manager_id: z.uuid(), change: z.enum(["created", "revoked"]) }),
    audience: (p: { guest_user_id: string; scope_manager_id: string }) => ({ users: [p.guest_user_id, p.scope_manager_id] }),
  },
];

const actorRef = (a: Actor) => a.userId;

export const guestOperations = [
  defineQuery({
    name: "guest.data_type.list",
    summary: "Loại dữ liệu cấp được cho Guest (module sở hữu dữ liệu tự đăng ký; Deals có từ Stage 4).",
    permission: "guest:grant:manage",
    aiAllowed: true,
    input: z.object({}),
    output: z.array(z.object({ key: z.string(), label: z.string(), channels: z.array(z.string()) })),
    http: { method: "GET", path: "/guest/data-types" },
    handler: async () => listGrantDataTypes(),
  }),

  defineQuery({
    name: "guest.grant.list",
    summary: "Dữ liệu đã cấp cho Guest trong cây của mình.",
    permission: "guest:grant:manage",
    aiAllowed: true,
    input: z.object({ include_revoked: z.enum(["true", "false"]).default("false").transform((v) => v === "true") }),
    output: z.array(GrantOut),
    http: { method: "GET", path: "/guest/grants" },
    handler: async (ctx, i) => {
      const tree = await myTree(ctx);
      const rows = await ctx.db
        .select()
        .from(dataGrants)
        .where(and(eq(dataGrants.scopeManagerId, tree), isNull(dataGrants.deletedAt), i.include_revoked ? undefined : isNull(dataGrants.revokedAt)))
        .orderBy(desc(dataGrants.createdAt));
      return toOut(ctx.db, rows);
    },
  }),

  defineQuery({
    name: "guest.grant.mine",
    summary: "Guest xem dữ liệu mình đang được cấp.",
    permission: "system:whoami",
    aiAllowed: true,
    input: z.object({}),
    output: z.array(GrantOut),
    http: { method: "GET", path: "/guest/my-grants" },
    handler: async (ctx) => {
      const rows = await ctx.db
        .select()
        .from(dataGrants)
        .where(and(eq(dataGrants.guestUserId, ctx.actor.userId), isNull(dataGrants.revokedAt), isNull(dataGrants.deletedAt), or(isNull(dataGrants.expiresAt), gt(dataGrants.expiresAt, sql`now()`))));
      return toOut(ctx.db, rows);
    },
  }),

  defineCommand({
    name: "guest.grant.create",
    summary: "Manager cấp một phần dữ liệu trong cây của mình cho một Guest.",
    description: "Phạm vi: cả cây hoặc một team. Cột: luôn chỉ cột hệ thống + cột chung, không bao giờ có cột cá nhân. Kênh: web, export, api.",
    permission: "guest:grant:manage",
    aiAllowed: true,
    emits: ["guest.grant.changed"],
    input: z.object({
      guest_user_id: z.uuid(),
      data_type: z.string().min(1).max(100),
      scope_leader_id: z.uuid().nullish(),
      channels: z.array(z.enum(GRANT_CHANNELS)).min(1).transform((c) => [...new Set(c)]),
      expires_at: z.iso.datetime({ offset: true }).nullish(),
      note: z.string().trim().max(500).optional(),
      options: z.record(z.string(), z.unknown()).optional().describe("Tuỳ loại dữ liệu. `datahub_table`: `{ table_id, columns: [mã hoặc tên cột] }`, bắt buộc."),
    }),
    output: GrantOut,
    http: { method: "POST", path: "/guest/grants", status: 201 },
    handler: async (ctx, i) => {
      const tree = await myTree(ctx);
      const type = dataTypes.get(i.data_type);
      if (!type) throw new AppError("validation_error", `Loại dữ liệu "${i.data_type}" chưa có.`, { available: listGrantDataTypes().map((t) => t.key) });
      const badChannel = i.channels.filter((c) => !type.channels.includes(c));
      if (badChannel.length) throw new AppError("validation_error", "Kênh không dùng được với loại dữ liệu này.", { not_allowed: badChannel });
      let options: Record<string, unknown> | null = null;
      if (type.validateOptions) options = await type.validateOptions(ctx, tree, i.options);
      else if (i.options) throw new AppError("validation_error", "Loại dữ liệu này không có tuỳ chọn.", { reason: "grant_options" });
      const [g] = await ctx.db.select().from(users).where(eq(users.id, i.guest_user_id)).limit(1);
      if (!g || g.kind !== "person" || !g.roles.includes("guest")) throw new AppError("validation_error", "Người nhận phải là Guest.");
      if (g.status === "locked") throw new AppError("validation_error", "Guest này đã bị khoá.");
      if (i.scope_leader_id) {
        const m = await currentMembership(ctx.db, i.scope_leader_id);
        const [l] = await ctx.db.select().from(users).where(eq(users.id, i.scope_leader_id)).limit(1);
        if (!l?.roles.includes("leader") || m?.managerId !== tree) throw new AppError("validation_error", "Team phải là một Leader trong cây của bạn.");
      }
      if (i.expires_at && new Date(i.expires_at).getTime() <= Date.now()) throw new AppError("validation_error", "Ngày hết hạn phải ở tương lai.");
      const [row] = await ctx.db
        .insert(dataGrants)
        .values({
          guestUserId: i.guest_user_id,
          dataType: i.data_type,
          scopeManagerId: tree,
          scopeLeaderId: i.scope_leader_id ?? null,
          channels: i.channels,
          expiresAt: i.expires_at ? new Date(i.expires_at) : null,
          note: i.note ?? null,
          options,
          createdBy: actorRef(ctx.actor),
          updatedBy: actorRef(ctx.actor),
        })
        .returning();
      ctx.audit({ type: "data_grant", id: row!.id, details: { guest: i.guest_user_id, data_type: i.data_type, scope_leader_id: i.scope_leader_id ?? null, channels: i.channels, expires_at: i.expires_at ?? null, ...(options ? { table_id: options.table_id, columns: (options.columns as string[]).length } : {}) } });
      await ctx.emit("guest.grant.changed", { aggregateType: "data_grant", aggregateId: row!.id, payload: { grant_id: row!.id, guest_user_id: i.guest_user_id, scope_manager_id: tree, change: "created" } });
      return (await toOut(ctx.db, [row!]))[0]!;
    },
  }),

  defineCommand({
    name: "guest.grant.revoke",
    summary: "Manager thu hồi một quyền cấp dữ liệu.",
    permission: "guest:grant:manage",
    aiAllowed: true,
    emits: ["guest.grant.changed"],
    input: z.object({ id: z.uuid(), version: z.number().int().min(1) }),
    output: GrantOut,
    http: { method: "POST", path: "/guest/grants/:id/revoke" },
    handler: async (ctx, i) => {
      const tree = await myTree(ctx);
      const [g] = await ctx.db.select().from(dataGrants).where(and(eq(dataGrants.id, i.id), eq(dataGrants.scopeManagerId, tree))).limit(1);
      if (!g) throw new AppError("not_found", "Không tìm thấy quyền cấp này.");
      if (g.version !== i.version) throw new AppError("conflict", undefined, { current_version: g.version, sent_version: i.version });
      if (g.revokedAt) return (await toOut(ctx.db, [g]))[0]!;
      const [row] = await ctx.db
        .update(dataGrants)
        .set({ revokedAt: sql`now()`, revokedBy: ctx.actor.userId, version: sql`${dataGrants.version} + 1`, updatedAt: sql`now()`, updatedBy: ctx.actor.userId })
        .where(eq(dataGrants.id, g.id))
        .returning();
      ctx.audit({ type: "data_grant", id: g.id, details: { guest: g.guestUserId } });
      await ctx.emit("guest.grant.changed", { aggregateType: "data_grant", aggregateId: g.id, payload: { grant_id: g.id, guest_user_id: g.guestUserId, scope_manager_id: tree, change: "revoked" } });
      return (await toOut(ctx.db, [row!]))[0]!;
    },
  }),
];
