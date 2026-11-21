import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, type Actor } from "@soe/shared";
import { apiTokens, files, orgMemberships, users, writeAudit, type Executor } from "@soe/db";
import { ownedBy } from "../../auth/access";
import { revokeUserSessions, revokeUserTokens } from "../../auth/sessions";
import type { EventDef } from "../../core/events";
import { defineCommand, defineQuery } from "../../core/registry";
import { currentMembership } from "../org/view";
import { validatePlacement, writePlacement } from "../org/service";

/**
 * Data transfer framework (design module1 section 8). Each module that owns data registers a `transferHandler`
 * (preview + execute). Stage 1 has handlers for files and tokens; later modules add theirs (datahub, deals...).
 * The whole transfer runs in one transaction and every moved object gets its own audit row.
 */
export interface TransferItem {
  type: string;
  id: string;
  label: string;
  /** What happens to it: `move` (owner changes), `revoke`, `keep` (stays with the source, e.g. closed deals). */
  action: "move" | "revoke" | "keep";
}

export interface TransferOptions {
  /** Personal deal columns (Stage 4): move the values to the target, or keep them as an archive. */
  personal_columns: "move" | "keep";
}

export interface TransferHandler {
  key: string;
  label: string;
  preview(ex: Executor, fromUserId: string, toUserId: string): Promise<TransferItem[]>;
  /** Performs the transfer of the items shown in preview. Returns the items actually handled. */
  execute(ex: Executor, fromUserId: string, toUserId: string, opts: TransferOptions, actor: Actor): Promise<TransferItem[]>;
}

const handlers = new Map<string, TransferHandler>();

export function registerTransferHandler(h: TransferHandler): void {
  handlers.set(h.key, h);
}

export function unregisterTransferHandler(key: string): void {
  handlers.delete(key);
}

export function listTransferHandlers(): TransferHandler[] {
  return [...handlers.values()];
}

/** Files: the owner changes to the target (design module1 section 8). */
export const fileTransferHandler: TransferHandler = {
  key: "files",
  label: "File",
  async preview(ex, from) {
    const rows = await ex.select({ id: files.id, filename: files.filename }).from(files).where(and(ownedBy(files.ownerId, from), isNull(files.deletedAt)));
    return rows.map((r) => ({ type: "file", id: r.id, label: r.filename, action: "move" as const }));
  },
  async execute(ex, from, to) {
    const rows = await ex
      .update(files)
      .set({ ownerId: to, version: sql`${files.version} + 1`, updatedAt: sql`now()` })
      .where(and(ownedBy(files.ownerId, from), isNull(files.deletedAt)))
      .returning({ id: files.id, filename: files.filename });
    return rows.map((r) => ({ type: "file", id: r.id, label: r.filename, action: "move" as const }));
  },
};

/**
 * Tokens are credentials of a person, so they are never handed to someone else: the source's tokens are revoked
 * (the target creates their own). Also happens anyway when the source account is locked after the transfer.
 */
export const tokenTransferHandler: TransferHandler = {
  key: "tokens",
  label: "Token cá nhân",
  async preview(ex, from) {
    const rows = await ex.select({ id: apiTokens.id, name: apiTokens.name }).from(apiTokens).where(and(eq(apiTokens.userId, from), sql`${apiTokens.status} IN ('pending', 'active')`));
    return rows.map((r) => ({ type: "api_token", id: r.id, label: r.name, action: "revoke" as const }));
  },
  async execute(ex, from, _to, _opts, actor) {
    const items = await this.preview(ex, from, _to);
    await revokeUserTokens(ex, from, { by: actor.userId, reason: "Chuyển giao dữ liệu" });
    return items;
  },
};

registerTransferHandler(fileTransferHandler);
registerTransferHandler(tokenTransferHandler);

async function loadPair(ex: Executor, fromId: string, toId: string) {
  if (fromId === toId) throw new AppError("validation_error", "Tài khoản nguồn và đích phải khác nhau.");
  const [from] = await ex.select().from(users).where(and(eq(users.id, fromId), eq(users.kind, "person"))).limit(1);
  const [to] = await ex.select().from(users).where(and(eq(users.id, toId), eq(users.kind, "person"))).limit(1);
  if (!from) throw new AppError("not_found", "Không tìm thấy tài khoản nguồn.");
  if (!to) throw new AppError("not_found", "Không tìm thấy tài khoản đích.");
  if (to.status === "locked") throw new AppError("validation_error", "Tài khoản đích đang bị khoá.");
  if (to.roles.includes("guest")) throw new AppError("validation_error", "Không chuyển dữ liệu cho Guest.");
  return { from, to };
}

const ItemOut = z.object({ type: z.string(), id: z.string(), label: z.string(), action: z.enum(["move", "revoke", "keep"]) });
const GroupOut = z.object({ handler: z.string(), label: z.string(), items: z.array(ItemOut) });

export const transferEvents: EventDef[] = [
  {
    name: "data.transfer.completed",
    version: 1,
    description: "Admin đã chuyển giao dữ liệu từ một tài khoản sang tài khoản khác.",
    schema: z.object({ from_user_id: z.uuid(), to_user_id: z.uuid(), counts: z.record(z.string(), z.number().int()) }),
    audience: (p: { from_user_id: string; to_user_id: string }) => ({ users: [p.to_user_id], permission: "data:transfer" }),
  },
  {
    name: "org.tree.transferred",
    version: 1,
    description: "Admin đã chuyển cả một cây sang Manager khác.",
    schema: z.object({ from_manager_id: z.uuid(), to_manager_id: z.uuid(), moved: z.number().int() }),
    audience: (p: { from_manager_id: string; to_manager_id: string }) => ({ permission: "data:transfer", scope: { kind: "org", ownerIds: [p.to_manager_id] } }),
  },
];

export const transferOperations = [
  defineQuery({
    name: "data.transfer.preview",
    summary: "Admin xem trước danh sách dữ liệu sẽ chuyển từ tài khoản nguồn sang tài khoản đích.",
    permission: "data:transfer",
    aiAllowed: false,
    input: z.object({ from_user_id: z.uuid(), to_user_id: z.uuid() }),
    output: z.object({ groups: z.array(GroupOut), source_will_be_locked: z.literal(true) }),
    http: { method: "GET", path: "/admin/transfer/preview" },
    handler: async (ctx, i) => {
      await loadPair(ctx.db, i.from_user_id, i.to_user_id);
      const groups = [];
      for (const h of listTransferHandlers()) groups.push({ handler: h.key, label: h.label, items: await h.preview(ctx.db, i.from_user_id, i.to_user_id) });
      return { groups, source_will_be_locked: true as const };
    },
  }),

  defineCommand({
    name: "data.transfer.execute",
    summary: "Admin chuyển giao dữ liệu (một giao dịch), ghi nhật ký từng đối tượng, rồi khoá tài khoản nguồn.",
    permission: "data:transfer",
    aiAllowed: false,
    emits: ["data.transfer.completed"],
    input: z.object({
      from_user_id: z.uuid(),
      to_user_id: z.uuid(),
      personal_columns: z.enum(["move", "keep"]).default("keep"),
    }),
    output: z.object({ groups: z.array(GroupOut), source_locked: z.literal(true) }),
    http: { method: "POST", path: "/admin/transfer" },
    handler: async (ctx, i) => {
      const { from } = await loadPair(ctx.db, i.from_user_id, i.to_user_id);
      if (from.id === ctx.actor.userId) throw new AppError("validation_error", "Không chuyển giao dữ liệu của chính mình.");
      const groups = [];
      const counts: Record<string, number> = {};
      for (const h of listTransferHandlers()) {
        const items = await h.execute(ctx.db, i.from_user_id, i.to_user_id, { personal_columns: i.personal_columns }, ctx.actor);
        counts[h.key] = items.length;
        for (const it of items) {
          await writeAudit(ctx.db, {
            command: "data.transfer.item",
            result: "success",
            actor: ctx.actor,
            requestId: ctx.requestId,
            targetType: it.type,
            targetId: it.id,
            details: { from_user_id: i.from_user_id, to_user_id: i.to_user_id, action: it.action, label: it.label },
          });
        }
        groups.push({ handler: h.key, label: h.label, items });
      }
      await ctx.db.update(users).set({ status: "locked", version: sql`${users.version} + 1`, updatedAt: sql`now()`, updatedBy: ctx.actor.userId }).where(eq(users.id, from.id));
      await revokeUserSessions(ctx.db, from.id, { by: ctx.actor.userId, reason: "Chuyển giao dữ liệu" });
      ctx.audit({ type: "user", id: from.id, details: { to_user_id: i.to_user_id, counts, personal_columns: i.personal_columns } });
      await ctx.emit("data.transfer.completed", { aggregateType: "user", aggregateId: from.id, payload: { from_user_id: i.from_user_id, to_user_id: i.to_user_id, counts } });
      return { groups, source_locked: true as const };
    },
  }),

  defineCommand({
    name: "org.tree.transfer",
    summary: "Admin chuyển cả một cây (Leader, User, Guest trong cây) sang Manager khác. Lịch sử cây được giữ.",
    permission: "data:transfer",
    aiAllowed: false,
    emits: ["org.tree.transferred", "org.member.changed"],
    input: z.object({ manager_id: z.uuid(), to_manager_id: z.uuid() }),
    output: z.object({ moved: z.number().int() }),
    http: { method: "POST", path: "/admin/trees/:manager_id/transfer" },
    handler: async (ctx, i) => {
      if (i.manager_id === i.to_manager_id) throw new AppError("validation_error", "Hai Manager phải khác nhau.");
      const target = await currentMembership(ctx.db, i.to_manager_id);
      if (target?.managerId !== i.to_manager_id) throw new AppError("validation_error", "Manager đích không phải gốc của một cây.");
      const members = await ctx.db
        .select()
        .from(orgMemberships)
        .where(and(eq(orgMemberships.managerId, i.manager_id), ne(orgMemberships.userId, i.manager_id), isNull(orgMemberships.validTo)));
      // Leaders first, so their members can follow them into the new tree.
      const sorted = [...members].sort((a, b) => (a.leaderId === null ? 0 : 1) - (b.leaderId === null ? 0 : 1));
      let moved = 0;
      for (const m of sorted) {
        const [u] = await ctx.db.select().from(users).where(eq(users.id, m.userId)).limit(1);
        const placement = await validatePlacement(ctx.db, m.userId, (u?.roles ?? []) as never, { managerId: i.to_manager_id, leaderId: m.leaderId });
        if (await writePlacement(ctx.db, m.userId, placement, ctx.actor.userId)) {
          moved++;
          // Same event as a move by `org.member.update`: the columns that read by person (and the ones pushed down) follow the new tree.
          await ctx.emit("org.member.changed", { aggregateType: "user", aggregateId: m.userId, payload: { user_id: m.userId, change: "updated" } });
        }
      }
      ctx.audit({ type: "org_tree", id: i.manager_id, details: { to_manager_id: i.to_manager_id, moved } });
      await ctx.emit("org.tree.transferred", { aggregateType: "org_tree", aggregateId: i.manager_id, payload: { from_manager_id: i.manager_id, to_manager_id: i.to_manager_id, moved } });
      return { moved };
    },
  }),
];
