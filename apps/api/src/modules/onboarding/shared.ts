import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, type Actor } from "@soe/shared";
import { newId, type Executor } from "@soe/db";
import { isConnectionActor } from "../../core/ai-gate";
import type { HandlerCtx } from "../../core/types";

/** Kinds of an item (design module9 1). */
export const KINDS = ["session", "session_cs", "session_sale", "test", "mockup", "review_1_1", "on_job", "self_study", "off", "other"] as const;
export const REPEATS = ["once", "daily_workdays", "weekly"] as const;
export const FILLER_COLUMN_DEFAULT = "Người điền";
/** Working days of the plan calendar: Monday to Saturday (the sheet "Master plan" of the brief). */
export const WORKDAYS = [1, 2, 3, 4, 5, 6];

export const Id = z.uuid();
const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Giờ dạng HH:MM.");

export const ItemIn = z.object({
  id: Id.optional().describe("Mã việc đã có (giữ trạng thái tick). Bỏ trống = việc mới."),
  name: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional(),
  kind: z.enum(KINDS).default("other"),
  weekday: z.number().int().min(1).max(7).default(1).describe("Thứ trong tuần: 1 = thứ Hai ... 7 = Chủ nhật."),
  repeat: z.enum(REPEATS).default("once").describe("`daily_workdays` = mỗi ngày làm việc (thứ Hai-thứ Bảy), `weekly` = mỗi tuần vào `weekday`, trong khoảng tuần của việc tới `until_week_no`."),
  until_week_no: z.number().int().min(1).max(200).optional(),
  due_time: Hhmm.optional().describe("Giờ hạn trong ngày (giờ Việt Nam)."),
  remind_before_min: z.number().int().min(0).max(10080).optional().describe("Nhắc trước hạn bao nhiêu phút."),
  form_id: Id.nullable().optional().describe("Form của người tạo lộ trình gắn với việc."),
  need_form: z.boolean().optional().describe("Việc cần form nhưng chưa chọn (sau khi nhân bản lộ trình của người khác)."),
  share_table: z.boolean().optional().describe("Gắn cho nhân sự thì chia sẻ bảng của form (quyền Sửa, khoá phân chia theo cột người điền)."),
  filler_column: z.string().trim().min(1).max(200).optional().describe(`Tên cột Người dùng giữ người điền (mặc định "${FILLER_COLUMN_DEFAULT}").`),
  leader_columns: z.array(z.string().trim().min(1).max(200)).max(20).optional().describe("Cột chỉ leader sửa (nhận xét, đánh giá): nhân sự không sửa được."),
  link: z.string().trim().max(2000).optional(),
});
export type ItemInput = z.infer<typeof ItemIn>;
export const WeekIn = z.object({ week_no: z.number().int().min(1).max(200).optional(), name: z.string().trim().min(1).max(300), goal: z.string().max(2000).optional(), items: z.array(ItemIn).max(300).default([]) });
export const StageIn = z.object({ name: z.string().trim().min(1).max(300), weeks: z.array(WeekIn).max(100).default([]) });
export const StructureIn = z.object({ stages: z.array(StageIn).max(30) });
export type Structure = z.infer<typeof StructureIn>;

export interface Person {
  id: string;
  roles: string[];
  managerId: string | null;
  leaderId: string | null;
  kind: string;
  status: string;
  name: string;
}
export async function loadPerson(db: Executor, id: string): Promise<Person | null> {
  const r = await db.execute(sql`SELECT u.id, u.roles, u.kind, u.status, u.full_name, m.manager_id, m.leader_id FROM users u LEFT JOIN org_memberships m ON m.user_id = u.id AND m.valid_to IS NULL WHERE /*scope:system*/ u.id = ${id}::uuid`);
  const x = r.rows[0] as { id: string; roles: string[]; kind: string; status: string; full_name: string; manager_id: string | null; leader_id: string | null } | undefined;
  return x ? { id: x.id, roles: x.roles, managerId: x.manager_id, leaderId: x.leader_id, kind: x.kind, status: x.status, name: x.full_name } : null;
}
export const isManager = (p: Person) => p.roles.includes("manager");
/** The tree of a person is their Manager's id (a Manager is the root of their own tree). */
export const treeOf = (p: Person): string | null => (isManager(p) ? p.id : p.managerId);

export interface PlanRow {
  id: string;
  ownerId: string;
  treeId: string;
  name: string;
  isTemplate: boolean;
  staffId: string | null;
  startDate: string | null;
  followers: string[];
  status: "draft" | "active" | "completed" | "stopped";
  stopReason: string | null;
  endedAt: string | null;
  sourcePlanId: string | null;
  version: number;
}
const ds = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
export function planFrom(r: Record<string, unknown>): PlanRow {
  return {
    id: r.id as string, ownerId: r.owner_id as string, treeId: r.tree_id as string, name: r.name as string, isTemplate: !!r.is_template,
    staffId: (r.staff_id as string | null) ?? null, startDate: ds(r.start_date), followers: ((r.followers as string[] | null) ?? []), status: r.status as PlanRow["status"],
    stopReason: (r.stop_reason as string | null) ?? null, endedAt: r.ended_at ? new Date(r.ended_at as string).toISOString() : null, sourcePlanId: (r.source_plan_id as string | null) ?? null, version: r.version as number,
  };
}
export async function loadPlan(db: Executor, id: string): Promise<PlanRow> {
  const r = await db.execute(sql`SELECT * FROM onb_plans WHERE id = ${id}::uuid`);
  if (!r.rows[0]) throw new AppError("not_found", "Không tìm thấy lộ trình.");
  return planFrom(r.rows[0] as Record<string, unknown>);
}

/** Who may edit (design module9 8): the Manager of the tree, the direct Leader of the person on the plan, the owner of a plan nobody is on yet. */
export async function rights(db: Executor, plan: PlanRow, actorId: string): Promise<{ edit: boolean; view: boolean }> {
  const me = await loadPerson(db, actorId);
  if (!me) return { edit: false, view: false };
  const staff = plan.staffId ? await loadPerson(db, plan.staffId) : null;
  const edit = (isManager(me) && plan.treeId === me.id) || (!!staff && staff.leaderId === me.id) || (!plan.staffId && plan.ownerId === me.id);
  const view = edit || plan.ownerId === me.id || plan.followers.includes(me.id) || plan.staffId === me.id || (plan.isTemplate && treeOf(me) === plan.treeId);
  return { edit, view };
}
export async function requirePlan(ctx: HandlerCtx<Actor>, id: string, need: "view" | "edit"): Promise<PlanRow> {
  const plan = await loadPlan(ctx.db, id);
  const r = await rights(ctx.db, plan, ctx.actor.userId);
  if (!r.view) throw new AppError("not_found", "Không tìm thấy lộ trình.");
  if (need === "edit" && !r.edit) throw new AppError("forbidden", "Chỉ Leader trực tiếp của nhân sự hoặc Manager của cây được sửa lộ trình này.", { reason: "not_plan_editor" });
  return plan;
}

/** A person who is only being onboarded may not use Onboarding through an AI connection (design module9 10). */
export async function guardAi(ctx: HandlerCtx<Actor>): Promise<void> {
  if (isConnectionActor(ctx.actor) && !(await ctx.access.permissions()).has("onboarding:path:create")) {
    throw new AppError("forbidden", "Nhân sự đang onboard không dùng AI với Onboarding.", { reason: "onboarding_ai_staff" });
  }
}

// -- dates ----------------------------------------------------------------------------------------

export const isMonday = (d: string): boolean => new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** Real date of "week N, weekday X" for a plan starting on the Monday `start`. */
export const dateOf = (start: string, weekNo: number, weekday: number): string => addDays(start, (weekNo - 1) * 7 + (weekday - 1));
/** Deadline in Vietnam time (UTC+7). */
export const dueAt = (date: string, time: string | null): Date | null => (time ? new Date(`${date}T${time}:00+07:00`) : null);

export interface ItemRow {
  id: string;
  weekNo: number;
  weekday: number;
  repeat: (typeof REPEATS)[number];
  untilWeekNo: number | null;
  dueTime: string | null;
}
/** Every dated occurrence of an item: once; every working day of the weeks; or every week on one weekday. */
export function expand(start: string, it: ItemRow): { date: string; due: Date | null }[] {
  const out: { date: string; due: Date | null }[] = [];
  const last = it.repeat === "once" ? it.weekNo : Math.max(it.untilWeekNo ?? it.weekNo, it.weekNo);
  for (let w = it.weekNo; w <= last; w++) {
    const days = it.repeat === "daily_workdays" ? WORKDAYS : [it.weekday];
    for (const wd of days) {
      const date = dateOf(start, w, wd);
      out.push({ date, due: dueAt(date, it.dueTime) });
    }
  }
  return out;
}

/** Brings the occurrences of a plan in line with its items (assign, structure change): new ones are added, moved ones are dropped unless done, done ones are kept. */
export async function syncOccurrences(db: Executor, plan: PlanRow): Promise<void> {
  if (!plan.staffId || !plan.startDate) return;
  const items = ((await db.execute(sql`SELECT id, week_no, weekday, repeat, until_week_no, due_time FROM onb_items WHERE plan_id = ${plan.id}::uuid`)).rows as Record<string, unknown>[]).map((r) => ({ id: r.id as string, weekNo: r.week_no as number, weekday: r.weekday as number, repeat: r.repeat as ItemRow["repeat"], untilWeekNo: (r.until_week_no as number | null) ?? null, dueTime: (r.due_time as string | null) ?? null }));
  const want = new Map<string, { item: string; date: string; due: Date | null }>();
  for (const it of items) for (const o of expand(plan.startDate, it)) want.set(`${it.id}|${o.date}`, { item: it.id, date: o.date, due: o.due });
  const have = (await db.execute(sql`SELECT id, item_id, on_date, done_at FROM onb_occurrences WHERE plan_id = ${plan.id}::uuid`)).rows as { id: string; item_id: string; on_date: unknown; done_at: unknown }[];
  const seen = new Set<string>();
  for (const h of have) {
    const key = `${h.item_id}|${ds(h.on_date)}`;
    const w = want.get(key);
    if (w) {
      seen.add(key);
      await db.execute(sql`UPDATE onb_occurrences SET due_at = ${w.due ? w.due.toISOString() : null}::timestamptz WHERE id = ${h.id}::uuid`);
    } else if (!h.done_at) await db.execute(sql`DELETE FROM onb_occurrences WHERE id = ${h.id}::uuid`);
  }
  for (const [key, w] of want) {
    if (seen.has(key)) continue;
    await db.execute(sql`INSERT INTO onb_occurrences (id, plan_id, item_id, on_date, due_at) VALUES (${newId()}::uuid, ${plan.id}::uuid, ${w.item}::uuid, ${w.date}::date, ${w.due ? w.due.toISOString() : null}::timestamptz) ON CONFLICT (item_id, on_date) DO NOTHING`);
  }
}
