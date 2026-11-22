import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, businessDate, FilterSchema, type Actor, type FilterNode } from "@soe/shared";
import { MetricDefSchema, type MetricDef } from "@soe/metrics";
import { newId, type Executor } from "@soe/db";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { runDefinition } from "../metrics/engine";
import { applyGrants, ownerOf } from "./grants";
import { FILLER_COLUMN_DEFAULT, Id, KINDS, addDays, dateOf, guardAi, loadPlan, requirePlan, rights, type PlanRow } from "./shared";

type Ctx = HandlerCtx<Actor>;
/** What the evaluation needs: a database handle and an actor (the form owner is substituted per form). Lets a job evaluate without a command context. */
export type Calc = Pick<HandlerCtx<Actor>, "db" | "actor">;
const GRANT_EVENTS = ["datahub.structure.changed", "datahub.share.changed"];
const AGGS = ["count", "sum", "avg", "max", "min"] as const;
const OPS = ["gte", "gt", "lte", "lt", "eq"] as const;
export const GROUPS = ["test", "mockup", "on_job", "qna", "daily", "other"] as const;
const RANGES = ["week", "plan", "since"] as const;

const Common = {
  form_id: Id.nullable().describe("Form của người tạo lộ trình; điều kiện đọc bảng của form này."),
  person_field: z.string().trim().min(1).max(200).optional().describe(`Cột Người dùng chọn ra nhân sự (mặc định "${FILLER_COLUMN_DEFAULT}"; phiếu chấm: "Người được chấm").`),
  range: z.enum(RANGES).default("plan").describe("`week` = dòng tạo trong tuần của checkpoint; `plan` = từ đầu lộ trình; `since` = từ mốc giờ `since`."),
  since: z.string().datetime({ offset: true }).optional(),
  filter: FilterSchema.optional().describe("Điều kiện thêm theo cú pháp lọc Datahub (ví dụ Tính vào trung bình = true)."),
  label: z.string().trim().max(200).optional(),
};
export const ConditionIn = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("metric"), ...Common, agg: z.enum(AGGS), field: z.string().trim().min(1).max(200).optional(), op: z.enum(OPS).default("gte"), threshold: z.number() }),
  z.strictObject({
    type: z.literal("weighted"), ...Common,
    columns: z.array(z.strictObject({ field: z.string().trim().min(1).max(200), weight: z.number().positive(), floor: z.number().optional() })).min(1).max(30),
    threshold: z.number().describe("Ngưỡng của trung bình trọng số."),
    floor: z.number().optional().describe("Ngưỡng sàn mặc định cho từng cột (cột có `floor` riêng thì dùng của nó)."),
  }),
  z.strictObject({ type: z.literal("vs_items"), ...Common, item_kind: z.enum(KINDS).describe("Số dòng của bảng phải >= số việc loại này đã qua ngày.") }),
  z.strictObject({ type: z.literal("manual"), label: z.string().trim().max(200).optional() }),
]);
export type Condition = z.infer<typeof ConditionIn>;
export const CheckpointIn = z.object({
  id: Id.optional(),
  week_no: z.number().int().min(1).max(200).nullable().optional().describe("Tuần của checkpoint; bỏ trống cho checkpoint cuối."),
  name: z.string().trim().min(1).max(300),
  is_final: z.boolean().default(false).describe('Thuộc nhóm "Đánh giá cuối".'),
  group: z.enum(GROUPS).optional().describe("Cột của trang Theo dõi: Test, Mockup, On-job, Q&A, Báo cáo ngày, Khác. Bỏ trống: Khác."),
  conditions: z.array(ConditionIn).min(1).max(20),
});
export type CheckpointInput = z.infer<typeof CheckpointIn>;

export async function writeCheckpoints(ctx: Pick<Ctx, "db">, plan: PlanRow, list: CheckpointInput[]): Promise<void> {
  const weeks = new Set(((await ctx.db.execute(sql`/*scope:system*/ SELECT week_no FROM onb_weeks WHERE plan_id = ${plan.id}::uuid`)).rows as { week_no: number }[]).map((r) => r.week_no));
  const formIds = new Set<string>();
  for (const c of list) {
    if (c.week_no != null && !weeks.has(c.week_no)) throw new AppError("validation_error", `Checkpoint "${c.name}": tuần ${c.week_no} không có trong lộ trình.`, { reason: "checkpoint_week_unknown" });
    for (const k of c.conditions) {
      if (k.type !== "manual" && k.form_id) formIds.add(k.form_id);
      if (k.type !== "manual" && k.range === "week" && c.week_no == null) throw new AppError("validation_error", `Checkpoint "${c.name}": khoảng "tuần" cần chọn tuần cho checkpoint.`, { reason: "range_week_needs_week" });
      if (k.type !== "manual" && k.range === "since" && !k.since) throw new AppError("validation_error", `Checkpoint "${c.name}": khoảng "từ mốc giờ" cần điền since.`, { reason: "since_missing" });
      if (k.type === "metric" && k.agg !== "count" && !k.field) throw new AppError("validation_error", `Checkpoint "${c.name}": phép "${k.agg}" cần chỉ rõ cột.`, { reason: "field_missing" });
    }
  }
  if (formIds.size) {
    const ok = await ctx.db.execute(sql`/*scope:system*/ SELECT id FROM forms WHERE id = ANY(${`{${[...formIds].join(",")}}`}::uuid[]) AND owner_id = ${plan.ownerId}::uuid AND deleted_at IS NULL`);
    if (ok.rows.length !== formIds.size) throw new AppError("validation_error", "Form của điều kiện phải là form của người tạo lộ trình.", { reason: "form_not_owned" });
  }
  const ids = list.map((c) => c.id).filter((x): x is string => !!x);
  if (ids.length) {
    const have = await ctx.db.execute(sql`/*scope:system*/ SELECT id FROM onb_checkpoints WHERE plan_id = ${plan.id}::uuid AND id = ANY(${`{${ids.join(",")}}`}::uuid[])`);
    if (have.rows.length !== ids.length) throw new AppError("validation_error", "Có mã checkpoint không thuộc lộ trình này.", { reason: "checkpoint_unknown" });
  }
  const keep: string[] = [];
  for (const [i, c] of list.entries()) {
    const id = c.id ?? newId();
    keep.push(id);
    const cond = JSON.stringify(c.conditions);
    if (c.id) await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_checkpoints SET week_no = ${c.week_no ?? null}::int, position = ${i}::int, name = ${c.name}, is_final = ${c.is_final}, group_key = ${c.group ?? null}, conditions = ${cond}::jsonb WHERE id = ${id}::uuid`);
    else await ctx.db.execute(sql`INSERT INTO onb_checkpoints (id, plan_id, week_no, position, name, is_final, group_key, conditions) VALUES (${id}::uuid, ${plan.id}::uuid, ${c.week_no ?? null}::int, ${i}::int, ${c.name}, ${c.is_final}, ${c.group ?? null}, ${cond}::jsonb)`);
  }
  await ctx.db.execute(sql`/*scope:system*/ DELETE FROM onb_checkpoints WHERE plan_id = ${plan.id}::uuid AND NOT (id = ANY(${`{${keep.join(",")}}`}::uuid[]))`);
}

interface CpRow { id: string; weekNo: number | null; name: string; isFinal: boolean; group: string | null; conditions: Condition[]; confirmedAt: Date | null; confirmedBy: string | null; passedNotifiedAt: Date | null }
async function loadCheckpoints(db: Executor, planId: string): Promise<CpRow[]> {
  const rows = (await db.execute(sql`/*scope:system*/ SELECT * FROM onb_checkpoints WHERE plan_id = ${planId}::uuid ORDER BY position`)).rows as Record<string, unknown>[];
  return rows.map((r) => ({ id: r.id as string, weekNo: (r.week_no as number | null) ?? null, name: r.name as string, isFinal: !!r.is_final, group: (r.group_key as string | null) ?? null, conditions: r.conditions as Condition[], confirmedAt: r.confirmed_at ? new Date(r.confirmed_at as string) : null, confirmedBy: (r.confirmed_by as string | null) ?? null, passedNotifiedAt: r.passed_notified_at ? new Date(r.passed_notified_at as string) : null }));
}
/** Definitions (what the editor needs), with the confirmation of the manual ones. */
export async function readCheckpoints(db: Executor, planId: string) {
  return (await loadCheckpoints(db, planId)).map((c) => ({ id: c.id, week_no: c.weekNo, name: c.name, is_final: c.isFinal, group: c.group, conditions: c.conditions, confirmed_at: c.confirmedAt?.toISOString() ?? null }));
}
/** Copies the checkpoints of a plan to another (clone, assign of a template): new ids, no confirmation, forms mapped (a dropped form leaves `form_id` null: "choose your form"). */
export async function copyCheckpoints(db: Executor, fromId: string, toId: string, forms: Map<string, string> | "keep" | "drop"): Promise<void> {
  for (const c of await loadCheckpoints(db, fromId)) {
    const conds = c.conditions.map((k) => (k.type === "manual" ? k : { ...k, form_id: forms === "keep" ? k.form_id : forms === "drop" || !k.form_id ? null : (forms.get(k.form_id) ?? null) }));
    await db.execute(sql`/*scope:system*/ INSERT INTO onb_checkpoints (id, plan_id, week_no, position, name, is_final, group_key, conditions) SELECT ${newId()}::uuid, ${toId}::uuid, week_no, position, name, is_final, group_key, ${JSON.stringify(conds)}::jsonb FROM onb_checkpoints WHERE id = ${c.id}::uuid`);
  }
}

// -- evaluation -----------------------------------------------------------------------------------

export interface CondResult {
  type: Condition["type"];
  label: string;
  value: number | null;
  op: (typeof OPS)[number];
  threshold: number | null;
  met: boolean;
  /** `weighted`: each column with its average, weight, floor. */
  columns?: { field: string; avg: number | null; weight: number; floor: number | null; met: boolean }[];
  note?: string;
}
const cmp = (v: number | null, op: (typeof OPS)[number], t: number | null): boolean => v !== null && t !== null && (op === "gte" ? v >= t : op === "gt" ? v > t : op === "lte" ? v <= t : op === "lt" ? v < t : v === t);
const and = (nodes: (FilterNode | undefined)[]): FilterNode | undefined => {
  const n = nodes.filter((x): x is FilterNode => !!x);
  return n.length === 0 ? undefined : n.length === 1 ? n[0] : { and: n };
};
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999+07:00`);

interface Win { from: string; to: string; since?: string }
interface Env { ctx: Calc; plan: PlanRow; cp: CpRow; forms: Map<string, { ownerId: string; tableId: string | null }>; asOf: Date }

/** Days a condition reads: the week of the checkpoint, the whole plan, or since a moment; always cut at `asOf`. */
function windowOf(env: Env, k: { range: (typeof RANGES)[number]; since?: string | undefined }): Win {
  const today = businessDate(env.asOf);
  const start = env.plan.startDate!;
  let from = start;
  let to = today;
  if (k.range === "week" && env.cp.weekNo) {
    from = dateOf(start, env.cp.weekNo, 1);
    const end = addDays(from, 6);
    to = end < today ? end : today;
  } else if (k.range === "since" && k.since) from = businessDate(new Date(k.since));
  return { from, to, ...(k.range === "since" && k.since ? { since: k.since } : {}) };
}

async function agg(env: Env, k: Extract<Condition, { form_id: string | null }>, a: (typeof AGGS)[number], field: string | undefined): Promise<number | null> {
  const f = k.form_id ? env.forms.get(k.form_id) : undefined;
  if (!f?.tableId) throw new AppError("validation_error", "Điều kiện chưa chọn form (hoặc form không còn bảng).", { reason: "condition_form_missing" });
  const w = windowOf(env, k);
  const person: FilterNode = { field: k.person_field ?? FILLER_COLUMN_DEFAULT, op: "eq", value: env.plan.staffId! };
  const filter = and([person, k.filter, w.since ? { field: "_created_at", op: "gte", value: w.since } : undefined]);
  const def = MetricDefSchema.parse({ name: "onboarding", source: { table: f.tableId }, measure: { agg: a, ...(field ? { field } : {}) }, ...(filter ? { filter } : {}), ...(w.to < w.from ? {} : { time: { field: "_created_at", range: { kind: "between", from: w.from, to: w.to } } }) }) as MetricDef;
  if (w.to < w.from) return a === "count" ? 0 : null;
  const ans = await runDefinition({ db: env.ctx.db, actor: ownerOf(env.ctx, f.ownerId).actor }, def, {}, {});
  const v = ans.rows[0]?.value;
  if (v === null || v === undefined) return a === "count" || a === "sum" ? 0 : null;
  return Number(v);
}

async function evalCondition(env: Env, k: Condition): Promise<CondResult> {
  if (k.type === "manual") return { type: "manual", label: k.label ?? "Leader xác nhận", value: null, op: "eq", threshold: null, met: !!env.cp.confirmedAt && env.cp.confirmedAt <= env.asOf };
  try {
    if (k.type === "metric") {
      const v = await agg(env, k, k.agg, k.field);
      return { type: "metric", label: k.label ?? `${k.agg}${k.field ? ` ${k.field}` : ""}`, value: v, op: k.op, threshold: k.threshold, met: cmp(v, k.op, k.threshold) };
    }
    if (k.type === "weighted") {
      const cols: NonNullable<CondResult["columns"]> = [];
      for (const c of k.columns) {
        const avg = await agg(env, k, "avg", c.field);
        const floor = c.floor ?? k.floor ?? null;
        cols.push({ field: c.field, avg, weight: c.weight, floor, met: floor === null || (avg !== null && avg >= floor) });
      }
      const have = cols.filter((c) => c.avg !== null);
      const wsum = have.reduce((s, c) => s + c.weight, 0);
      const value = wsum > 0 ? have.reduce((s, c) => s + c.weight * (c.avg as number), 0) / wsum : null;
      return { type: "weighted", label: k.label ?? "Trung bình trọng số", value, op: "gte", threshold: k.threshold, met: cmp(value, "gte", k.threshold) && cols.every((c) => c.met), columns: cols };
    }
    const rowsN = (await agg(env, k, "count", undefined)) ?? 0;
    const w = windowOf(env, k);
    const [n] = (await env.ctx.db.execute(sql`/*scope:system*/ SELECT count(*)::int AS n FROM onb_occurrences o JOIN onb_items i ON i.id = o.item_id WHERE o.plan_id = ${env.plan.id}::uuid AND i.kind = ${k.item_kind} AND o.on_date >= ${w.from}::date AND o.on_date <= ${w.to}::date`)).rows as { n: number }[];
    return { type: "vs_items", label: k.label ?? `Số dòng so với số việc ${k.item_kind} đã qua`, value: rowsN, op: "gte", threshold: n?.n ?? 0, met: rowsN >= (n?.n ?? 0) };
  } catch (e) {
    if (e instanceof AppError) return { type: k.type, label: k.label ?? k.type, value: null, op: "gte", threshold: null, met: false, note: e.message };
    throw e;
  }
}

export type CpStatus = "not_yet" | "running" | "passed" | "failed" | "passed_late";
async function evalCheckpoint(ctx: Calc, plan: PlanRow, cp: CpRow, forms: Env["forms"], asOf: Date) {
  const env: Env = { ctx, plan, cp, forms, asOf };
  const results: CondResult[] = [];
  for (const k of cp.conditions) results.push(await evalCondition(env, k));
  return { results, met: results.every((r) => r.met) };
}

async function statusOf(ctx: Calc, plan: PlanRow, cp: CpRow, forms: Env["forms"]): Promise<{ status: CpStatus; results: CondResult[] }> {
  const now = new Date();
  if (cp.weekNo && !cp.isFinal) {
    const start = dateOf(plan.startDate!, cp.weekNo, 1);
    if (now < new Date(`${start}T00:00:00+07:00`)) return { status: "not_yet", results: [] };
    const end = endOfDay(addDays(start, 6));
    if (now > end) {
      const ontime = await evalCheckpoint(ctx, plan, cp, forms, end);
      if (ontime.met) return { status: "passed", results: ontime.results };
      const late = await evalCheckpoint(ctx, plan, cp, forms, now);
      return { status: late.met ? "passed_late" : "failed", results: late.results };
    }
  }
  const cur = await evalCheckpoint(ctx, plan, cp, forms, now);
  if (cur.met) return { status: "passed", results: cur.results };
  return { status: plan.status === "completed" || plan.status === "stopped" ? "failed" : "running", results: cur.results };
}

/** Every checkpoint of a plan with its status and condition values (computed now). One query per condition through the metric engine, as the owner of the form. */
export async function evaluatePlan(ctx: Calc, plan: PlanRow, only?: (c: CpRow) => boolean): Promise<{ cp: CpRow; status: CpStatus; results: CondResult[] }[]> {
  const cps = (await loadCheckpoints(ctx.db, plan.id)).filter((c) => !only || only(c));
  const formIds = [...new Set(cps.flatMap((c) => c.conditions.flatMap((k) => (k.type !== "manual" && k.form_id ? [k.form_id] : []))))];
  const forms: Env["forms"] = new Map();
  if (formIds.length) for (const r of (await ctx.db.execute(sql`/*scope:system*/ SELECT id, owner_id, table_id FROM forms WHERE id = ANY(${`{${formIds.join(",")}}`}::uuid[]) AND deleted_at IS NULL`)).rows as { id: string; owner_id: string; table_id: string | null }[]) forms.set(r.id, { ownerId: r.owner_id, tableId: r.table_id });
  const out = [];
  for (const c of cps) out.push({ cp: c, ...(await statusOf(ctx, plan, c, forms)) });
  return out;
}
/** Column of the follow-up page: the one set on the checkpoint, else "other". */
export const groupOf = (c: CpRow): (typeof GROUPS)[number] => ((GROUPS as readonly string[]).includes(c.group ?? "") ? (c.group as (typeof GROUPS)[number]) : "other");
export type { CpRow };

const Out = z.record(z.string(), z.unknown());
const C = { permission: "onboarding:path:create" as const };

export const checkpointOperations = [
  defineQuery({
    name: "onboarding.progress.get",
    summary: "Tiến độ một nhân sự: mọi checkpoint với giá trị thật so ngưỡng và trạng thái, việc theo loại, kết quả cuối.",
    description: "Checkpoint tính khi đọc bằng engine chỉ số (quyền chủ form). Trạng thái: `not_yet` (Chưa tới), `running` (Đang chạy), `passed` (Đạt), `failed` (Chưa đạt: hết tuần mà chưa đạt), `passed_late` (Đạt muộn). Nhân sự xem của mình; Leader, Manager, người theo dõi xem của người họ phụ trách.",
    permission: "onboarding:path:read",
    aiAllowed: true,
    input: z.object({ plan_id: Id }),
    output: Out,
    http: { method: "GET", path: "/onboarding/plans/:plan_id/progress" },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const plan = await requirePlan(ctx, i.plan_id, "view");
      if (!plan.staffId || !plan.startDate) throw new AppError("conflict", "Lộ trình chưa gắn cho nhân sự.", { reason: "plan_not_assigned" });
      const out = (await evaluatePlan(ctx, plan)).map(({ cp: c, status, results }) => ({ id: c.id, week_no: c.weekNo, name: c.name, is_final: c.isFinal, group: groupOf(c), status, conditions: results, confirmed_at: c.confirmedAt?.toISOString() ?? null }));
      const kinds = (await ctx.db.execute(sql`/*scope:system*/ SELECT i.kind, count(*)::int AS total, count(o.done_at)::int AS done,
          count(*) FILTER (WHERE o.done_at IS NULL AND o.due_at IS NOT NULL AND o.due_at < now())::int AS overdue
        FROM onb_occurrences o JOIN onb_items i ON i.id = o.item_id WHERE o.plan_id = ${plan.id}::uuid GROUP BY i.kind`)).rows as { kind: string; total: number; done: number; overdue: number }[];
      const [wk] = (await ctx.db.execute(sql`/*scope:system*/ SELECT count(*)::int AS total FROM onb_weeks WHERE plan_id = ${plan.id}::uuid`)).rows as { total: number }[];
      const todayWeek = Math.max(1, Math.floor((new Date(`${businessDate(new Date())}T00:00:00Z`).getTime() - new Date(`${plan.startDate}T00:00:00Z`).getTime()) / 604800000) + 1);
      const r = await rights(ctx.db, plan, ctx.actor.userId);
      return {
        plan_id: plan.id, staff_id: plan.staffId, status: plan.status, start_date: plan.startDate, current_week: Math.min(todayWeek, wk?.total ?? todayWeek), total_weeks: wk?.total ?? 0,
        checkpoints: out, checkpoints_passed: out.filter((c) => c.status === "passed" || c.status === "passed_late").length,
        items_by_kind: Object.fromEntries(kinds.map((k) => [k.kind, { total: k.total, done: k.done, overdue: k.overdue }])),
        final: { result: plan.finalResult, note: plan.finalNote }, can_edit: r.edit,
      };
    },
  }),

  defineCommand({
    name: "onboarding.checkpoint.confirm",
    summary: "Leader trực tiếp / Manager xác nhận tay (hoặc bỏ xác nhận) một checkpoint có điều kiện \"Leader xác nhận\". AI không làm được.",
    ...C,
    aiAllowed: false,
    input: z.object({ checkpoint_id: Id, confirmed: z.boolean().default(true) }),
    output: Out,
    http: { method: "POST", path: "/onboarding/checkpoints/:checkpoint_id/confirm" },
    handler: async (ctx, i) => {
      const r = (await ctx.db.execute(sql`/*scope:system*/ SELECT plan_id, conditions FROM onb_checkpoints WHERE id = ${i.checkpoint_id}::uuid`)).rows[0] as { plan_id: string; conditions: Condition[] } | undefined;
      if (!r) throw new AppError("not_found", "Không tìm thấy checkpoint.");
      const plan = await requirePlan(ctx, r.plan_id, "edit");
      if (plan.status !== "active") throw new AppError("conflict", "Lộ trình không còn chạy.", { reason: "plan_not_active" });
      if (!r.conditions.some((k) => k.type === "manual")) throw new AppError("validation_error", "Checkpoint này không có điều kiện xác nhận tay.", { reason: "not_manual" });
      await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_checkpoints SET confirmed_at = ${i.confirmed ? sql`now()` : sql`NULL`}, confirmed_by = ${i.confirmed ? ctx.actor.userId : null}::uuid WHERE id = ${i.checkpoint_id}::uuid`);
      ctx.audit({ type: "onboarding_plan", id: plan.id, details: { checkpoint_id: i.checkpoint_id, confirmed: i.confirmed } });
      return { checkpoint_id: i.checkpoint_id, confirmed: i.confirmed };
    },
  }),

  defineCommand({
    name: "onboarding.plan.finish",
    summary: "Leader trực tiếp / Manager chốt đánh giá cuối: Đạt hoặc Không đạt, kèm ghi chú. Lộ trình chuyển Hoàn thành, bảng chia sẻ hạ về quyền Xem. AI không làm được.",
    ...C,
    aiAllowed: false,
    emits: ["onboarding.plan.ended", ...GRANT_EVENTS],
    input: z.object({ plan_id: Id, result: z.enum(["passed", "failed"]), note: z.string().trim().max(5000).optional() }),
    output: Out,
    http: { method: "POST", path: "/onboarding/plans/:plan_id/finish" },
    handler: async (ctx, i) => {
      const plan = await requirePlan(ctx, i.plan_id, "edit");
      if (plan.status !== "active" || !plan.staffId) throw new AppError("conflict", "Chỉ chốt được lộ trình đang chạy.", { reason: "plan_not_active" });
      await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_plans SET status = 'completed', ended_at = now(), final_result = ${i.result}, final_note = ${i.note ?? null}, finished_by = ${ctx.actor.userId}::uuid WHERE id = ${plan.id}::uuid`);
      await applyGrants(ctx, plan, plan.staffId, "down");
      await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_plans SET version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE id = ${plan.id}::uuid`);
      ctx.audit({ type: "onboarding_plan", id: plan.id, details: { result: i.result } });
      await ctx.emit("onboarding.plan.ended", { aggregateType: "onboarding_plan", aggregateId: plan.id, payload: { plan_id: plan.id, staff_id: plan.staffId, status: "completed" } });
      const after = await loadPlan(ctx.db, plan.id);
      return { plan_id: after.id, status: after.status, final_result: after.finalResult, final_note: after.finalNote, ended_at: after.endedAt };
    },
  }),
];
