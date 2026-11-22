import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@soe/shared";
import { reminders, type Db } from "@soe/db";
import { ownedBy, systemScope } from "../../auth/access";
import { defineCommand, defineQuery } from "../../core/registry";
import { NOTIFICATION_TYPES } from "./catalog";
import { notify, stableId } from "./notify";

/** Design module6 4: a person's own reminders. Times are stored in UTC and worked out in Vietnam time (UTC+7, no daylight saving). */
export const MAX_PENDING_REMINDERS = 200;
const VN_OFFSET_MS = 7 * 3600_000;
const DAY_MS = 86400_000;

export type Repeat = "none" | "daily" | "weekly" | "monthly";

export interface Recurrence {
  dueAt: Date;
  repeat: Repeat;
  /** ISO weekdays 1..7 (weekly). */
  weekdays: number[];
  /** Day of month asked for (monthly). */
  anchorDay: number;
  /** Last Vietnam date, `YYYY-MM-DD`. */
  untilDate: string | null;
}

interface Parts {
  y: number;
  m: number;
  d: number;
  min: number;
  dow: number;
}

/** The Vietnam calendar parts of an instant. `min` is minutes since midnight. */
function vn(date: Date): Parts {
  const t = new Date(date.getTime() + VN_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), min: t.getUTCHours() * 60 + t.getUTCMinutes(), dow: t.getUTCDay() === 0 ? 7 : t.getUTCDay() };
}

const atVn = (y: number, m: number, d: number, min: number): Date => new Date(Date.UTC(y, m - 1, d, 0, min) - VN_OFFSET_MS);
const daysIn = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const vnDateString = (date: Date): string => {
  const p = vn(date);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

/**
 * The first occurrence after `from` (usually now, never before the one that just fired), at the same Vietnam time of day as `r.dueAt`.
 * Monthly on the 31st falls on the last day of shorter months. Null when none is left (no repeat, or past the end date).
 */
export function nextOccurrence(r: Recurrence, from: Date): Date | null {
  if (r.repeat === "none") return null;
  const base = vn(r.dueAt);
  const start = new Date(Math.max(from.getTime(), r.dueAt.getTime()));
  const s = vn(start);
  let next: Date;
  if (r.repeat === "daily") {
    next = atVn(s.y, s.m, s.d, base.min);
    if (next <= start) next = new Date(next.getTime() + DAY_MS);
  } else if (r.repeat === "weekly") {
    const days = r.weekdays.length ? r.weekdays : [base.dow];
    next = atVn(s.y, s.m, s.d, base.min);
    if (next <= start) next = new Date(next.getTime() + DAY_MS);
    for (let k = 0; k < 8 && !days.includes(vn(next).dow); k++) next = new Date(next.getTime() + DAY_MS);
  } else {
    const at = (y: number, m: number) => atVn(y, m, Math.min(r.anchorDay, daysIn(y, m)), base.min);
    next = at(s.y, s.m);
    if (next <= start) next = s.m === 12 ? at(s.y + 1, 1) : at(s.y, s.m + 1);
  }
  return r.untilDate && vnDateString(next) > r.untilDate ? null : next;
}

/** `2026-11-23T14:00` (Vietnam time) or with a zone (`+07:00`, `Z`). */
export function parseDue(text: string): Date {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(text.trim());
  const d = new Date(hasZone ? text.trim() : `${text.trim()}+07:00`);
  if (Number.isNaN(d.getTime())) throw new AppError("validation_error", "Thời điểm nhắc không hợp lệ. Dùng dạng 2026-11-23T14:00 (giờ Việt Nam).", { reason: "reminder_bad_time" });
  return d;
}

/** Tomorrow 08:30 Vietnam time. */
export function tomorrow0830(now: Date): Date {
  const p = vn(now);
  return atVn(p.y, p.m, p.d + 1, 8 * 60 + 30);
}

const Id = z.uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD.");
const ObjectRef = z.object({ type: z.enum(["deal", "row"]), id: Id }).describe("Gắn với một deal hoặc một dòng datahub (id dòng).");

const ReminderOut = z.object({
  id: Id,
  content: z.string(),
  due_at: z.string(),
  repeat: z.enum(["none", "daily", "weekly", "monthly"]),
  weekdays: z.array(z.number().int()),
  until: z.string().nullable(),
  object: z.object({ type: z.string(), id: z.string() }).nullable(),
  status: z.enum(["pending", "fired", "done"]),
});

type ReminderRow = typeof reminders.$inferSelect;
const out = (r: ReminderRow): z.infer<typeof ReminderOut> => ({
  id: r.id,
  content: r.content,
  due_at: r.dueAt.toISOString(),
  repeat: r.repeat as Repeat,
  weekdays: r.weekdays,
  until: r.untilDate,
  object: r.objectType && r.objectId ? { type: r.objectType, id: r.objectId } : null,
  status: r.status as "pending" | "fired" | "done",
});

async function assertRoom(db: Db, userId: string): Promise<void> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(reminders).where(and(ownedBy(reminders.userId, userId), eq(reminders.status, "pending")));
  if ((r?.n ?? 0) >= MAX_PENDING_REMINDERS) throw new AppError("validation_error", `Đã có ${MAX_PENDING_REMINDERS} nhắc hẹn đang chờ. Xoá bớt rồi đặt tiếp.`, { reason: "reminder_limit", limit: MAX_PENDING_REMINDERS });
}

async function load(db: Db, userId: string, id: string): Promise<ReminderRow> {
  const [r] = await db.select().from(reminders).where(and(ownedBy(reminders.userId, userId), eq(reminders.id, id))).limit(1);
  if (!r) throw new AppError("not_found", "Không tìm thấy nhắc hẹn.");
  return r;
}

const Fields = {
  content: z.string().trim().min(1).max(500),
  due_at: z.string().describe("Thời điểm nhắc, giờ Việt Nam: 2026-11-23T14:00 (hoặc kèm múi giờ)."),
  repeat: z.enum(["none", "daily", "weekly", "monthly"]),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).describe("Hằng tuần: các thứ, 1 = thứ Hai … 7 = Chủ nhật. Bỏ trống = thứ của lần đầu."),
  until: ymd.nullable().describe("Ngày kết thúc lặp (giờ Việt Nam), bao gồm ngày đó."),
  object: ObjectRef.nullable(),
};

function checkSchedule(due: Date, until: string | null | undefined): void {
  if (due.getTime() <= Date.now()) throw new AppError("validation_error", "Thời điểm nhắc đã qua. Chọn một thời điểm sau bây giờ.", { reason: "reminder_in_past" });
  if (until && until < vnDateString(due)) throw new AppError("validation_error", "Ngày kết thúc phải từ ngày nhắc đầu tiên trở đi.", { reason: "reminder_until_before_start" });
}

export const reminderOperations = [
  defineCommand({
    name: "reminder.create",
    summary: "Đặt nhắc hẹn cho mình (nhắc lúc nào, lặp lại không, gắn deal hoặc dòng).",
    permission: "notification:manage",
    aiAllowed: true,
    audit: "none",
    input: z.object({ content: Fields.content, due_at: Fields.due_at, repeat: Fields.repeat.default("none"), weekdays: Fields.weekdays.optional(), until: Fields.until.optional(), object: Fields.object.optional() }),
    output: ReminderOut,
    http: { method: "POST", path: "/reminders" },
    handler: async (ctx, i) => {
      const due = parseDue(i.due_at);
      checkSchedule(due, i.until);
      await assertRoom(ctx.db, ctx.actor.userId);
      const weekdays = i.repeat === "weekly" ? [...new Set(i.weekdays?.length ? i.weekdays : [vn(due).dow])].sort() : [];
      const [row] = await ctx.db
        .insert(reminders)
        .values({ userId: ctx.actor.userId, content: i.content, dueAt: due, repeat: i.repeat, weekdays, anchorDay: vn(due).d, untilDate: i.repeat === "none" ? null : (i.until ?? null), objectType: i.object?.type ?? null, objectId: i.object?.id ?? null })
        .returning();
      return out(row!);
    },
  }),

  defineCommand({
    name: "reminder.update",
    summary: "Sửa nhắc hẹn của mình. Đổi thời điểm thì nhắc chờ lại từ đầu.",
    permission: "notification:manage",
    aiAllowed: true,
    audit: "none",
    input: z.object({ id: Id, content: Fields.content.optional(), due_at: Fields.due_at.optional(), repeat: Fields.repeat.optional(), weekdays: Fields.weekdays.optional(), until: Fields.until.optional(), object: Fields.object.optional() }),
    output: ReminderOut,
    http: { method: "PATCH", path: "/reminders/:id" },
    handler: async (ctx, i) => {
      const cur = await load(ctx.db, ctx.actor.userId, i.id);
      if (cur.status === "done") throw new AppError("conflict", "Nhắc hẹn đã xong, không sửa được.", { reason: "reminder_done" });
      const due = i.due_at ? parseDue(i.due_at) : cur.dueAt;
      const repeat = i.repeat ?? (cur.repeat as Repeat);
      const until = i.until === undefined ? cur.untilDate : i.until;
      if (i.due_at) checkSchedule(due, until);
      else if (until && until < vnDateString(due)) throw new AppError("validation_error", "Ngày kết thúc phải từ ngày nhắc đầu tiên trở đi.", { reason: "reminder_until_before_start" });
      if (cur.status !== "pending" && i.due_at) await assertRoom(ctx.db, ctx.actor.userId);
      const weekdays = repeat === "weekly" ? [...new Set(i.weekdays?.length ? i.weekdays : cur.weekdays.length ? cur.weekdays : [vn(due).dow])].sort() : [];
      const object = i.object === undefined ? undefined : i.object;
      const [row] = await ctx.db
        .update(reminders)
        .set({
          content: i.content ?? cur.content,
          dueAt: due,
          repeat,
          weekdays,
          anchorDay: i.due_at ? vn(due).d : cur.anchorDay,
          untilDate: repeat === "none" ? null : until,
          ...(object === undefined ? {} : { objectType: object?.type ?? null, objectId: object?.id ?? null }),
          status: i.due_at ? "pending" : cur.status,
          updatedAt: sql`now()`,
        })
        .where(and(ownedBy(reminders.userId, ctx.actor.userId), eq(reminders.id, i.id)))
        .returning();
      return out(row!);
    },
  }),

  defineCommand({
    name: "reminder.delete",
    summary: "Xoá nhắc hẹn của mình (cả chuỗi lặp).",
    permission: "notification:manage",
    aiAllowed: true,
    audit: "none",
    input: z.object({ id: Id }),
    output: z.object({ id: Id, deleted: z.literal(true) }),
    http: { method: "DELETE", path: "/reminders/:id" },
    handler: async (ctx, i) => {
      await load(ctx.db, ctx.actor.userId, i.id);
      await ctx.db.delete(reminders).where(and(ownedBy(reminders.userId, ctx.actor.userId), eq(reminders.id, i.id)));
      return { id: i.id, deleted: true as const };
    },
  }),

  defineQuery({
    name: "reminder.list",
    summary: "Nhắc hẹn của mình: sắp tới (kể cả đã nhắc, chưa bấm Xong) hoặc đã xong.",
    permission: "notification:manage",
    aiAllowed: true,
    input: z.object({ status: z.enum(["upcoming", "done"]).default("upcoming") }),
    output: z.array(ReminderOut),
    http: { method: "GET", path: "/reminders" },
    handler: async (ctx, i) => {
      const rows = await ctx.db
        .select()
        .from(reminders)
        .where(and(ownedBy(reminders.userId, ctx.actor.userId), i.status === "done" ? eq(reminders.status, "done") : sql`${reminders.status} <> 'done'`))
        .orderBy(i.status === "done" ? desc(reminders.updatedAt) : asc(reminders.dueAt))
        .limit(MAX_PENDING_REMINDERS);
      return rows.map(out);
    },
  }),

  defineCommand({
    name: "reminder.done",
    summary: "Bấm Xong cho một nhắc hẹn đã nhắc. Nhắc lặp vẫn chạy tiếp; muốn dừng hẳn thì xoá.",
    permission: "notification:manage",
    aiAllowed: true,
    audit: "none",
    input: z.object({ id: Id }),
    output: ReminderOut,
    http: { method: "POST", path: "/reminders/:id/done" },
    handler: async (ctx, i) => {
      const cur = await load(ctx.db, ctx.actor.userId, i.id);
      if (cur.repeat !== "none" && cur.status === "pending") return out(cur);
      const [row] = await ctx.db.update(reminders).set({ status: "done", updatedAt: sql`now()` }).where(and(ownedBy(reminders.userId, ctx.actor.userId), eq(reminders.id, i.id))).returning();
      return out(row!);
    },
  }),

  defineCommand({
    name: "reminder.snooze",
    summary: "Nhắc lại sau 1 giờ (`1h`) hoặc sáng mai 08:30 (`tomorrow_0830`). Nhắc lặp thì tạo một nhắc một lần, chuỗi lặp giữ nguyên.",
    permission: "notification:manage",
    aiAllowed: true,
    audit: "none",
    input: z.object({ id: Id, until: z.enum(["1h", "tomorrow_0830"]) }),
    output: ReminderOut,
    http: { method: "POST", path: "/reminders/:id/snooze" },
    handler: async (ctx, i) => {
      const cur = await load(ctx.db, ctx.actor.userId, i.id);
      const now = new Date();
      const due = i.until === "1h" ? new Date(now.getTime() + 3600_000) : tomorrow0830(now);
      if (cur.status !== "pending") await assertRoom(ctx.db, ctx.actor.userId);
      if (cur.repeat !== "none") {
        await assertRoom(ctx.db, ctx.actor.userId);
        const [clone] = await ctx.db.insert(reminders).values({ userId: cur.userId, content: cur.content, dueAt: due, objectType: cur.objectType, objectId: cur.objectId, anchorDay: vn(due).d }).returning();
        return out(clone!);
      }
      const [row] = await ctx.db.update(reminders).set({ dueAt: due, status: "pending", updatedAt: sql`now()` }).where(and(ownedBy(reminders.userId, ctx.actor.userId), eq(reminders.id, i.id))).returning();
      return out(row!);
    },
  }),
];

/** Link for the object a reminder is about: the route checks the permission when the person opens it. */
async function linkOf(db: Db, r: ReminderRow): Promise<string | null> {
  if (!r.objectType || !r.objectId) return null;
  const [row] = (await db.execute(sql`SELECT r.table_id, t.datahub_id, d.system_key FROM dh_rows r JOIN dh_tables t ON t.id = r.table_id JOIN dh_datahubs d ON d.id = t.datahub_id WHERE /*scope:system*/ r.id = ${r.objectId}::uuid`)).rows as { table_id: string; datahub_id: string; system_key: string | null }[];
  if (!row) return null;
  return row.system_key === "deal" || r.objectType === "deal" ? `/quan-ly-deal/${row.table_id}` : `/datahub/${row.datahub_id}/${row.table_id}`;
}

/**
 * Worker job, every minute: sends the reminders that are due, then moves each to its next time (or ends it). The notification is idempotent
 * (stable id of reminder + time), and the move only applies if the reminder still has the time that was sent, so two runs never double-send
 * or skip an occurrence.
 */
export async function runDueReminders(db: Db, now: Date = new Date()): Promise<number> {
  const due = await db.select().from(reminders).where(and(systemScope(), eq(reminders.status, "pending"), sql`${reminders.dueAt} <= ${now.toISOString()}::timestamptz`)).orderBy(asc(reminders.dueAt)).limit(500);
  let sent = 0;
  for (const r of due) {
    const link = await linkOf(db, r);
    sent += await notify.send(db, {
      type: NOTIFICATION_TYPES.reminderDue,
      recipients: [r.userId],
      priority: "important",
      object: r.objectType && r.objectId ? { type: r.objectType, id: r.objectId } : { type: "reminder", id: r.id },
      sourceEventId: stableId("reminder", r.id, r.dueAt.toISOString()),
      render: () => ({ title: "Nhắc hẹn", body: r.content, link: link ?? "/nhac-hen", data: { reminder_id: r.id } }),
    });
    const next = nextOccurrence({ dueAt: r.dueAt, repeat: r.repeat as Repeat, weekdays: r.weekdays, anchorDay: r.anchorDay, untilDate: r.untilDate }, now);
    const patch = next ? { dueAt: next, lastFiredAt: r.dueAt, updatedAt: sql`now()` } : { status: r.repeat === "none" ? "fired" : "done", lastFiredAt: r.dueAt, updatedAt: sql`now()` };
    await db.update(reminders).set(patch).where(and(systemScope(), eq(reminders.id, r.id), eq(reminders.status, "pending"), eq(reminders.dueAt, r.dueAt)));
  }
  return sent;
}
