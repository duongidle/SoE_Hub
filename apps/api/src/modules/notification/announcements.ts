import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, toActorRef } from "@soe/shared";
import { announcementRecipients, announcements, type Db } from "@soe/db";
import { registerOwnedTable } from "../../auth/query-guard";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { NOTIFICATION_TYPES } from "./catalog";
import { notify, stableId } from "./notify";

/**
 * General announcements (design module6 7 and 14): Admin, Manager or Leader write to people in their reach; the recipients are fixed when it is sent
 * (`announcement_recipients`), the notification goes through `notify.send` (type `announcement`, mandatory), a recall removes it from every inbox.
 * Only AI-forbidden commands: the sender presses send on the web.
 */
registerOwnedTable("announcements");
registerOwnedTable("announcement_recipients");

const Id = z.uuid();
export const MAX_TITLE = 120;
export const MAX_BODY = 5000;

const ScopeSchema = z.strictObject({
  all: z.boolean().optional().describe("Mọi người (chỉ Admin)."),
  trees: z.array(Id).max(50).optional().describe("Mã Manager của cây."),
  teams: z.array(Id).max(200).optional().describe("Mã Leader của team."),
  user_ids: z.array(Id).max(500).optional().describe("Người lẻ, phải nằm trong phạm vi của người gửi."),
});
type Scope = z.infer<typeof ScopeSchema>;

const forbidden = (what: string) => new AppError("forbidden", `Bạn không được gửi thông báo chung tới ${what}: nằm ngoài phạm vi của bạn.`, { reason: "out_of_scope" });

interface Reach {
  admin: boolean;
  tree: string | null;
  team: string | null;
}

async function reachOf(ctx: HandlerCtx): Promise<Reach> {
  const p = await ctx.access.requirePrincipal();
  const admin = p.roles.includes("admin");
  return { admin, tree: p.roles.includes("manager") && p.managerId === p.userId ? p.userId : null, team: p.roles.includes("leader") ? p.userId : null };
}

const ids = (arr: string[]) => `{${arr.join(",")}}`;

/** Checks the scope against what the sender may reach, and expands it into the people (active persons, not Guests, not the sender). */
async function expand(ctx: HandlerCtx, reach: Reach, s: Scope): Promise<string[]> {
  if (!reach.admin && !reach.tree && !reach.team) throw new AppError("forbidden", "Chỉ Admin, Manager và Leader gửi thông báo chung.");
  if (s.all && !reach.admin) throw forbidden("mọi người");
  for (const t of s.trees ?? []) if (!reach.admin && t !== reach.tree) throw forbidden("cây này");
  for (const l of s.teams ?? []) {
    if (reach.admin || l === reach.team) continue;
    const [m] = reach.tree ? (await ctx.db.execute(sql`SELECT 1 FROM org_memberships WHERE valid_to IS NULL AND user_id = ${l}::uuid AND manager_id = ${reach.tree}::uuid`)).rows : [];
    if (!m) throw forbidden("team này");
  }
  const people = new Set<string>();
  const add = (rows: unknown[]) => (rows as { id: string }[]).forEach((r) => people.add(r.id));
  const active = sql`u.kind = 'person' AND u.status = 'active' AND NOT ('guest' = ANY(u.roles))`; // Guests never get a general announcement
  if (s.all) add((await ctx.db.execute(sql`SELECT u.id FROM users u WHERE ${active}`)).rows);
  if (s.trees?.length) add((await ctx.db.execute(sql`SELECT u.id FROM users u JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL WHERE ${active} AND m.manager_id = ANY(${ids(s.trees)}::uuid[])`)).rows);
  if (s.teams?.length)
    add((await ctx.db.execute(sql`SELECT u.id FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL WHERE ${active} AND (u.id = ANY(${ids(s.teams)}::uuid[]) OR m.leader_id = ANY(${ids(s.teams)}::uuid[]))`)).rows);
  if (s.user_ids?.length) {
    const found = (await ctx.db.execute(sql`SELECT u.id, m.manager_id, m.leader_id FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL WHERE ${active} AND u.id = ANY(${ids(s.user_ids)}::uuid[])`)).rows as { id: string; manager_id: string | null; leader_id: string | null }[];
    for (const want of s.user_ids) {
      const f = found.find((x) => x.id === want);
      const inReach = !!f && (reach.admin || (!!reach.tree && f.manager_id === reach.tree) || (!!reach.team && (f.leader_id === reach.team || f.id === reach.team)));
      if (!inReach) throw forbidden("một người ngoài phạm vi của bạn");
      people.add(want);
    }
  }
  people.delete(ctx.actor.userId);
  return [...people];
}

const SentOut = z.object({
  id: Id,
  title: z.string(),
  body: z.string(),
  important: z.boolean(),
  scope: z.record(z.string(), z.unknown()),
  recipient_count: z.number().int(),
  read_count: z.number().int(),
  recalled_at: z.string().nullable(),
  created_at: z.string(),
});

async function loadOwn(db: Db, ctx: HandlerCtx, id: string) {
  const [a] = (await db.execute(sql`SELECT id, sender_id, recalled_at FROM announcements WHERE /*scope:system*/ id = ${id}::uuid`)).rows as { id: string; sender_id: string; recalled_at: string | null }[];
  const reach = await reachOf(ctx);
  if (!a || (a.sender_id !== ctx.actor.userId && !reach.admin)) throw new AppError("not_found", "Không tìm thấy thông báo chung.");
  return a;
}

const readCounts = sql`(SELECT count(*)::int FROM announcement_recipients r WHERE /*scope:system*/ r.announcement_id = a.id AND NOT EXISTS (SELECT 1 FROM notifications n WHERE /*scope:system*/ n.type = 'announcement' AND n.object_id = a.id::text AND n.user_id = r.user_id AND n.read_at IS NULL))`;

export const announcementOperations = [
  defineCommand({
    name: "announcement.send",
    summary: "Gửi thông báo chung cho người trong phạm vi của bạn (Admin: mọi người hoặc cây/team bất kỳ; Manager: cây mình hoặc team trong cây; Leader: team mình; thêm người lẻ trong phạm vi).",
    description: "Người nhận chốt lúc gửi. `important` đẩy lên đầu hộp thông báo tới khi người nhận đọc. Qua AI bị cấm: gửi trên web.",
    permission: "notification:announce",
    aiAllowed: false,
    input: z.object({ title: z.string().trim().min(1).max(MAX_TITLE), body: z.string().max(MAX_BODY).default(""), important: z.boolean().default(false), scope: ScopeSchema }),
    output: z.object({ id: Id, recipient_count: z.number().int() }),
    http: { method: "POST", path: "/announcements" },
    handler: async (ctx, i) => {
      const reach = await reachOf(ctx);
      const people = await expand(ctx, reach, i.scope);
      if (people.length === 0) throw new AppError("validation_error", "Không có người nhận trong phạm vi đã chọn.", { reason: "no_recipients" });
      const [a] = await ctx.db.insert(announcements).values({ senderId: ctx.actor.userId, title: i.title, body: i.body, important: i.important, scope: i.scope, recipientCount: people.length }).returning({ id: announcements.id });
      await ctx.db.insert(announcementRecipients).values(people.map((userId) => ({ announcementId: a!.id, userId })));
      await notify.send(ctx.db, {
        type: NOTIFICATION_TYPES.announcement,
        recipients: people,
        actor: toActorRef(ctx.actor),
        object: { type: "announcement", id: a!.id },
        priority: i.important ? "important" : "normal",
        sourceEventId: stableId("announcement", a!.id),
        render: (_u, by) => ({ title: i.title, body: i.body, link: "/thong-bao-chung", data: { announcement_id: a!.id, sender: by } }),
      });
      return { id: a!.id, recipient_count: people.length };
    },
  }),

  defineCommand({
    name: "announcement.recall",
    summary: "Thu hồi thông báo chung: biến mất khỏi hộp thông báo của người nhận. Người gửi hoặc Admin.",
    permission: "notification:announce",
    aiAllowed: false,
    input: z.object({ id: Id }),
    output: z.object({ id: Id, removed: z.number().int() }),
    http: { method: "POST", path: "/announcements/:id/recall" },
    handler: async (ctx, i) => {
      const a = await loadOwn(ctx.db, ctx, i.id);
      if (a.recalled_at) return { id: i.id, removed: 0 };
      await ctx.db.execute(sql`UPDATE announcements SET recalled_at = now() WHERE /*scope:system*/ id = ${i.id}::uuid`);
      const res = await ctx.db.execute(sql`DELETE FROM notifications WHERE /*scope:system*/ type = 'announcement' AND object_id = ${i.id}`);
      return { id: i.id, removed: res.rowCount ?? 0 };
    },
  }),

  defineQuery({
    name: "announcement.list_sent",
    summary: "Thông báo chung mình đã gửi, mới nhất trước, kèm số người đã đọc.",
    permission: "notification:announce",
    aiAllowed: false,
    input: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
    output: z.array(SentOut),
    http: { method: "GET", path: "/announcements/sent" },
    handler: async (ctx, i) => {
      const rows = (await ctx.db.execute(sql`SELECT a.id, a.title, a.body, a.important, a.scope, a.recipient_count, a.recalled_at, a.created_at, ${readCounts} AS read_count
        FROM announcements a WHERE /*scope:system*/ a.sender_id = ${ctx.actor.userId}::uuid ORDER BY a.created_at DESC LIMIT ${i.limit}`)).rows as Record<string, unknown>[];
      return rows.map((r) => ({ id: r.id as string, title: r.title as string, body: r.body as string, important: !!r.important, scope: r.scope as Record<string, unknown>, recipient_count: r.recipient_count as number, read_count: r.read_count as number, recalled_at: r.recalled_at ? new Date(r.recalled_at as string).toISOString() : null, created_at: new Date(r.created_at as string).toISOString() }));
    },
  }),

  defineQuery({
    name: "announcement.list_received",
    summary: "Thông báo chung mình đã nhận (chưa bị thu hồi), mới nhất trước.",
    permission: "notification:read",
    aiAllowed: false,
    input: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
    output: z.array(z.object({ id: Id, title: z.string(), body: z.string(), important: z.boolean(), sender: z.string(), read: z.boolean(), created_at: z.string() })),
    http: { method: "GET", path: "/announcements/received" },
    handler: async (ctx, i) => {
      const rows = (await ctx.db.execute(sql`SELECT a.id, a.title, a.body, a.important, a.created_at, u.full_name AS sender,
          NOT EXISTS (SELECT 1 FROM notifications n WHERE /*scope:system*/ n.type = 'announcement' AND n.object_id = a.id::text AND n.user_id = r.user_id AND n.read_at IS NULL) AS read
        FROM announcement_recipients r JOIN announcements a ON a.id = r.announcement_id JOIN users u ON u.id = a.sender_id
        WHERE /*scope:system*/ r.user_id = ${ctx.actor.userId}::uuid AND a.recalled_at IS NULL ORDER BY a.created_at DESC LIMIT ${i.limit}`)).rows as Record<string, unknown>[];
      return rows.map((r) => ({ id: r.id as string, title: r.title as string, body: r.body as string, important: !!r.important, sender: (r.sender as string) ?? "", read: !!r.read, created_at: new Date(r.created_at as string).toISOString() }));
    },
  }),

  defineQuery({
    name: "announcement.read_status",
    summary: "Đã đọc x/y của một thông báo chung và danh sách người chưa đọc. Người gửi hoặc Admin.",
    permission: "notification:announce",
    aiAllowed: false,
    input: z.object({ id: Id }),
    output: z.object({ read: z.number().int(), total: z.number().int(), unread: z.array(z.object({ user_id: Id, name: z.string() })) }),
    http: { method: "GET", path: "/announcements/:id/read-status" },
    handler: async (ctx, i) => {
      await loadOwn(ctx.db, ctx, i.id);
      const rows = (await ctx.db.execute(sql`SELECT r.user_id, u.full_name AS name, EXISTS (SELECT 1 FROM notifications n WHERE /*scope:system*/ n.type = 'announcement' AND n.object_id = r.announcement_id::text AND n.user_id = r.user_id AND n.read_at IS NULL) AS unread
        FROM announcement_recipients r JOIN users u ON u.id = r.user_id WHERE /*scope:system*/ r.announcement_id = ${i.id}::uuid ORDER BY u.full_name`)).rows as { user_id: string; name: string; unread: boolean }[];
      const unread = rows.filter((r) => r.unread).map((r) => ({ user_id: r.user_id, name: r.name }));
      return { read: rows.length - unread.length, total: rows.length, unread };
    },
  }),
];
