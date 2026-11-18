import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { BUSINESS_TIMEZONE, listParamsShape } from "@soe/shared";
import { enqueueOutbox, listPage, notifications, type Db, type FieldMap, type OutboxRow } from "@soe/db";
import { ownedBy, systemScope } from "../../auth/access";
import { decrypt } from "../../auth/crypto";
import type { EventDef } from "../../core/events";
import type { Subscriber } from "../../core/outbox-dispatcher";
import { defineCommand, defineQuery } from "../../core/registry";
import type { ListOutput } from "../../core/types";
import { CODE_TTL_HOURS } from "../auth/codes";

/** Notification types created in Stage 1. Module 6 adds more. */
export const NOTIFICATION_TYPES = { authCode: "auth.code", datahubReconcile: "datahub.reconcile" } as const;

const CODE_MASK = "••••••";

export interface NewNotification {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Builds notifications from an outbox event. Registered per event name; Module 6 adds its own. */
export type Notifier = (ev: OutboxRow, deps: { secret: string }) => NewNotification[] | Promise<NewNotification[]>;

function vnTime(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: BUSINESS_TIMEZONE, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

const codeRequested: Notifier = (ev, { secret }) => {
  const p = ev.payload as { purpose: string; email: string; full_name: string; requested_at: string; expires_at: string; recipient_ids: string[]; code_enc: string; code_id: string };
  const code = decrypt(secret, p.code_enc);
  const what = p.purpose === "activate" ? "kích hoạt tài khoản" : "đặt lại mật khẩu";
  return p.recipient_ids.map((userId) => ({
    userId,
    type: NOTIFICATION_TYPES.authCode,
    title: p.purpose === "activate" ? "Yêu cầu kích hoạt tài khoản" : "Yêu cầu đặt lại mật khẩu",
    body: `${p.full_name} (${p.email}) yêu cầu ${what} lúc ${vnTime(p.requested_at)}. Mã: ${code}. Mã hết hạn sau ${CODE_TTL_HOURS} giờ. Chỉ đưa mã khi chắc chắn đúng người.`,
    data: { code, email: p.email, purpose: p.purpose, code_id: p.code_id, expires_at: p.expires_at },
  }));
};

/** Nightly reconciliation found stored values that a full recomputation does not give (design module2 section 6.7). Column names only, never values. */
const reconcileMismatch: Notifier = (ev) => {
  const p = ev.payload as { cells: number; columns: { table_id: string; column_key: string; column_name: string; cells: number }[]; recipient_ids: string[] };
  const list = p.columns.slice(0, 10).map((c) => `"${c.column_name}" (${c.cells} ô)`).join(", ");
  const more = p.columns.length > 10 ? ` và ${p.columns.length - 10} cột khác` : "";
  return p.recipient_ids.map((userId) => ({
    userId,
    type: NOTIFICATION_TYPES.datahubReconcile,
    title: "Đối soát Datahub phát hiện ô tính sai",
    body: `${p.cells} ô công thức khác kết quả tính lại cả cột, ở ${p.columns.length} cột: ${list}${more}. Giá trị đã được sửa lại cho đúng. Cần tìm nguyên nhân gốc.`,
    data: { cells: p.cells, columns: p.columns },
  }));
};

export const notifiers: Record<string, Notifier> = { "auth.code.requested": codeRequested, "datahub.reconcile.mismatch": reconcileMismatch };

/**
 * Outbox subscriber: creates one notification per recipient (idempotent by `source_event_id`), then queues a
 * `notification.notification.created` event so the recipient's bell updates over SSE.
 */
export function createNotificationSubscriber(secret: string): Subscriber {
  return {
    name: "notification.deliver",
    match: (event) => event in notifiers,
    async handle(ev, db: Db) {
      const items = await notifiers[ev.event]!(ev, { secret });
      await db.transaction(async (tx) => {
        for (const n of items) {
          const [row] = await tx
            .insert(notifications)
            .values({ userId: n.userId, type: n.type, title: n.title, body: n.body, data: n.data ?? {}, sourceEventId: ev.id })
            .onConflictDoNothing()
            .returning({ id: notifications.id });
          if (!row) continue;
          await enqueueOutbox(tx, {
            event: "notification.notification.created",
            aggregateType: "notification",
            aggregateId: row.id,
            payload: { notification_id: row.id, user_id: n.userId, type: n.type },
          });
        }
      });
    },
  };
}

export const notificationEvents: EventDef[] = [
  {
    name: "notification.notification.created",
    version: 1,
    description: "Một thông báo mới cho một người (chuông cập nhật qua SSE).",
    schema: z.object({ notification_id: z.uuid(), user_id: z.uuid(), type: z.string() }),
    audience: (p: { user_id: string }) => ({ users: [p.user_id] }),
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
    input: z.object({ ...listParamsShape, unread_only: z.enum(["true", "false"]).default("false").transform((v) => v === "true") }),
    output: z.record(z.string(), z.unknown()),
    http: { method: "GET", path: "/notifications" },
    handler: async (ctx, i): Promise<ListOutput> => {
      const page = await listPage(ctx.db, {
        from: sql`notifications`,
        fields,
        baseWhere: i.unread_only ? sql`${ownedBy(sql`user_id`, ctx.actor.userId)} AND read_at IS NULL` : ownedBy(sql`user_id`, ctx.actor.userId),
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
];
