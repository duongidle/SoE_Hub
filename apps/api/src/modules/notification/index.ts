import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, listParamsShape } from "@soe/shared";
import { listPage, notificationSettings, notifications, type Db, type FieldMap } from "@soe/db";
import { ownedBy, systemScope } from "../../auth/access";
import type { EventDef } from "../../core/events";
import type { Subscriber } from "../../core/outbox-dispatcher";
import { defineCommand, defineQuery } from "../../core/registry";
import type { ListOutput } from "../../core/types";
import { CODE_TTL_HOURS } from "../auth/codes";
import { NOTIFICATION_TYPES } from "./catalog";
import { defsForEvent, deliverEvent, notificationDefs } from "./notify";

import "./reminders";
import "./announcements";
export { NOTIFICATION_TYPES, notifyExpiringConnections, notifyJobEnd } from "./catalog";
export { notify, defineNotification, sendNotification, adminIds, stableId } from "./notify";
export { reminderOperations, runDueReminders } from "./reminders";
export { announcementOperations } from "./announcements";

/** Settings of a person; no row = defaults (nothing off, digest on). The morning digest (6A2) reads `morningDigest`. */
export async function readSettings(db: Db, userId: string): Promise<{ disabledTypes: string[]; morningDigest: boolean }> {
  const [r] = await db.select().from(notificationSettings).where(and(ownedBy(notificationSettings.userId, userId))).limit(1);
  return { disabledTypes: r?.disabledTypes ?? [], morningDigest: r?.morningDigest ?? true };
}

/** Days a read notification is kept, and an unread one (design module6 2.2; constants for now, Admin setting later). */
export const KEEP_READ_DAYS = 90;
export const KEEP_UNREAD_DAYS = 180;

/** Nightly: removes notifications past their keeping time. Returns how many. */
export async function purgeNotifications(db: Db): Promise<number> {
  const res = await db.delete(notifications).where(and(systemScope(), sql`((${notifications.readAt} IS NOT NULL AND ${notifications.readAt} < now() - make_interval(days => ${KEEP_READ_DAYS})) OR ${notifications.createdAt} < now() - make_interval(days => ${KEEP_UNREAD_DAYS}))`));
  return res.rowCount ?? 0;
}

const CODE_MASK = "••••••";

/**
 * Outbox subscriber: every type declared with `defineNotification` for the event creates its notifications through `notify.send`
 * (idempotent by a stable source id), which also queues the SSE signal that updates the recipient's bell.
 */
export function createNotificationSubscriber(secret: string): Subscriber {
  return {
    name: "notification.deliver",
    match: (event) => defsForEvent(event).length > 0,
    handle: (ev, db: Db) => deliverEvent(ev, { db, secret }),
  };
}

export const notificationEvents: EventDef[] = [
  {
    name: "notification.notification.created",
    version: 1,
    description: "Một thông báo mới cho một người (chuông cập nhật qua SSE).",
    schema: z.object({ notification_id: z.uuid(), user_id: z.uuid(), type: z.string(), priority: z.string().optional() }),
    audience: (p: { user_id: string }) => ({ users: [p.user_id] }),
  },
  // Events that only exist to be turned into notifications: no SSE signal (the notification itself raises the bell).
  {
    name: "auth.account.locked",
    version: 1,
    description: "Tài khoản bị khoá tạm vì nhập sai mật khẩu quá nhiều lần.",
    schema: z.object({ user_id: z.uuid(), minutes: z.number().int() }),
    audience: () => null,
  },
  {
    name: "deal.payment.confirmed",
    version: 1,
    description: "Tiền về được xác nhận cho đợt thanh toán của các deal. Mang sẵn danh sách người tham gia và tên deal, không mang số tiền.",
    schema: z.object({ table_id: z.uuid(), deals: z.array(z.object({ deal_id: z.uuid(), deal: z.string(), user_ids: z.array(z.uuid()), payments: z.number().int() })) }),
    audience: () => null,
  },
  {
    name: "metrics.dashboard.share.changed",
    version: 1,
    description: "Dashboard được chia sẻ cho một người.",
    schema: z.object({ dashboard_id: z.uuid(), name: z.string(), grantee_id: z.uuid() }),
    audience: () => null,
  },
];

/** A code is visible for 6 hours only (design module1 section 9). Masked on read; the job below removes it for good. */
function maskExpired(row: { type: string; created_at: unknown; body: string; data: unknown }) {
  if (row.type !== NOTIFICATION_TYPES.authCode) return row;
  const created = new Date(row.created_at as string).getTime();
  if (Date.now() - created < CODE_TTL_HOURS * 3600_000) return row;
  const data = { ...((row.data as Record<string, unknown>) ?? {}) };
  const code = data.code as string | undefined;
  delete data.code;
  return { ...row, body: code ? row.body.split(code).join(CODE_MASK) : row.body, data: { ...data, code_hidden: true } };
}

/** Removes codes older than 6 hours from notifications. Run hourly by the worker. */
export async function scrubExpiredCodes(db: Db): Promise<number> {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(systemScope(), eq(notifications.type, NOTIFICATION_TYPES.authCode), isNull(notifications.scrubbedAt), sql`${notifications.createdAt} < now() - make_interval(hours => ${CODE_TTL_HOURS})`))
    .limit(5000);
  for (const r of rows) {
    const m = maskExpired({ type: r.type, created_at: r.createdAt.toISOString(), body: r.body, data: r.data });
    await db.update(notifications).set({ body: m.body, data: m.data as Record<string, unknown>, scrubbedAt: sql`now()` }).where(and(systemScope(), eq(notifications.id, r.id)));
  }
  return rows.length;
}

const fields: FieldMap = {
  id: { type: "uuid", expr: sql`id` },
  type: { type: "text", expr: sql`type` },
  category: { type: "text", expr: sql`category` },
  priority: { type: "text", expr: sql`priority` },
  link: { type: "text", expr: sql`link`, sortable: false },
  object_type: { type: "text", expr: sql`object_type`, sortable: false },
  object_id: { type: "text", expr: sql`object_id`, sortable: false },
  via: { type: "text", expr: sql`via`, sortable: false },
  title: { type: "text", expr: sql`title` },
  body: { type: "text", expr: sql`body`, sortable: false },
  data: { type: "text", expr: sql`data`, sortable: false },
  read_at: { type: "datetime", expr: sql`read_at` },
  created_at: { type: "datetime", expr: sql`created_at` },
};

export const notificationOperations = [
  defineQuery({
    name: "notification.list",
    summary: "Thông báo của mình, mới nhất trước.",
    permission: "notification:read",
    aiAllowed: true,
    list: true,
    input: z.object({ ...listParamsShape, unread_only: z.enum(["true", "false"]).default("false").transform((v) => v === "true"), category: z.string().max(40).optional() }),
    output: z.record(z.string(), z.unknown()),
    http: { method: "GET", path: "/notifications" },
    handler: async (ctx, i): Promise<ListOutput> => {
      const page = await listPage(ctx.db, {
        from: sql`notifications`,
        fields,
        baseWhere: sql`${ownedBy(sql`user_id`, ctx.actor.userId)}${i.unread_only ? sql` AND read_at IS NULL` : sql``}${i.category ? sql` AND category = ${i.category}` : sql``}`,
        filter: i.filter,
        sort: i.sort,
        defaultSort: [{ field: "created_at", dir: "desc" }],
        select: i.fields,
        limit: i.limit,
        cursor: i.cursor,
        includeTotal: i.include_total,
      });
      return { ...page, items: page.items.map((r) => maskExpired(r as never)) };
    },
  }),

  defineQuery({
    name: "notification.unread_count",
    summary: "Số thông báo chưa đọc (cho chuông).",
    permission: "notification:read",
    aiAllowed: true,
    input: z.object({}),
    output: z.object({ unread: z.number().int() }),
    http: { method: "GET", path: "/notifications/unread-count" },
    handler: async (ctx) => {
      const [r] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(ownedBy(notifications.userId, ctx.actor.userId), isNull(notifications.readAt)));
      return { unread: r?.n ?? 0 };
    },
  }),

  defineCommand({
    name: "notification.mark_read",
    summary: "Đánh dấu đã đọc: một số thông báo (`ids`) hoặc tất cả (`all: true`).",
    permission: "notification:read",
    aiAllowed: true,
    audit: "none",
    input: z.object({ ids: z.array(z.uuid()).max(500).optional(), all: z.boolean().optional() }),
    output: z.object({ marked: z.number().int() }),
    http: { method: "POST", path: "/notifications/read" },
    handler: async (ctx, i) => {
      if (!i.all && (!i.ids || i.ids.length === 0)) return { marked: 0 };
      const res = await ctx.db
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(and(ownedBy(notifications.userId, ctx.actor.userId), isNull(notifications.readAt), i.all ? undefined : inArray(notifications.id, i.ids!)));
      return { marked: res.rowCount ?? 0 };
    },
  }),

  defineQuery({
    name: "notification.settings.get",
    summary: "Cài đặt thông báo của mình: loại nào đang tắt và bản tin buổi sáng.",
    permission: "notification:manage",
    aiAllowed: true,
    input: z.object({}),
    output: z.object({
      morning_digest: z.boolean(),
      types: z.array(z.object({ type: z.string(), category: z.string(), mandatory: z.boolean(), enabled: z.boolean() })),
    }),
    http: { method: "GET", path: "/notifications/settings" },
    handler: async (ctx) => {
      const s = await readSettings(ctx.db, ctx.actor.userId);
      const off = new Set(s.disabledTypes);
      return { morning_digest: s.morningDigest, types: notificationDefs().filter((d) => d.on).map((d) => ({ type: d.type, category: d.category, mandatory: !!d.mandatory, enabled: !!d.mandatory || !off.has(d.type) })) };
    },
  }),

  defineCommand({
    name: "notification.settings.set",
    summary: "Tắt hoặc bật loại thông báo (trừ loại bắt buộc) và bản tin buổi sáng.",
    permission: "notification:manage",
    aiAllowed: true,
    audit: "none",
    input: z.object({ disabled_types: z.array(z.string().max(80)).max(100).optional().describe("Danh sách đầy đủ các loại tắt."), morning_digest: z.boolean().optional() }),
    output: z.object({ morning_digest: z.boolean(), disabled_types: z.array(z.string()) }),
    http: { method: "PUT", path: "/notifications/settings" },
    handler: async (ctx, i) => {
      const known = new Map(notificationDefs().map((d) => [d.type, d]));
      for (const t of i.disabled_types ?? []) {
        const d = known.get(t);
        if (!d || !d.on) throw new AppError("validation_error", `Không có loại thông báo "${t}".`, { reason: "unknown_type", type: t });
        if (d.mandatory) throw new AppError("validation_error", `Loại "${t}" là bắt buộc, không tắt được.`, { reason: "mandatory_type", type: t });
      }
      const cur = await readSettings(ctx.db, ctx.actor.userId);
      const disabled = i.disabled_types ? [...new Set(i.disabled_types)] : cur.disabledTypes;
      const digest = i.morning_digest ?? cur.morningDigest;
      await ctx.db
        .insert(notificationSettings)
        .values({ userId: ctx.actor.userId, disabledTypes: disabled, morningDigest: digest })
        .onConflictDoUpdate({ target: notificationSettings.userId, set: { disabledTypes: disabled, morningDigest: digest, updatedAt: sql`now()` } });
      return { morning_digest: digest, disabled_types: disabled };
    },
  }),
];
