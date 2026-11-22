import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, type Actor } from "@soe/shared";
import { newId, type Executor } from "@soe/db";
import type { EventDef } from "../../core/events";
import { defineCommand, defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { CheckpointIn, checkpointOperations, copyCheckpoints, readCheckpoints, writeCheckpoints } from "./checkpoints";
import { applyGrants } from "./grants";
import { overviewOperations } from "./overview";
import {
  Id, StructureIn, guardAi, isMonday, loadPerson, loadPlan, planFrom, requirePlan, rights, syncOccurrences, treeOf, type ItemInput, type PlanRow, type Structure,
} from "./shared";

type Ctx = HandlerCtx<Actor>;
const GRANT_EVENTS = ["datahub.structure.changed", "datahub.share.changed"];
const C = { permission: "onboarding:path:create" as const, aiAllowed: true };
const R = { permission: "onboarding:path:read" as const, aiAllowed: true };

export const onboardingEvents: EventDef[] = [
  { name: "onboarding.plan.assigned", version: 1, description: "Một lộ trình được gắn cho nhân sự.", schema: z.object({ plan_id: z.uuid(), staff_id: z.uuid(), leader_id: z.uuid().nullable(), start_date: z.string() }), audience: (p: { staff_id: string; leader_id: string | null }) => ({ users: [p.staff_id, ...(p.leader_id ? [p.leader_id] : [])] }) },
  { name: "onboarding.item.due", version: 1, description: "Một việc của lộ trình tới hạn hoặc quá hạn (job nhắc của 9B phát).", schema: z.object({ plan_id: z.uuid(), occurrence_id: z.uuid(), item_id: z.uuid(), staff_id: z.uuid(), due_at: z.string(), overdue: z.boolean() }), audience: (p: { staff_id: string }) => ({ users: [p.staff_id] }) },
  { name: "onboarding.plan.ended", version: 1, description: "Một lộ trình kết thúc (dừng hoặc hoàn thành).", schema: z.object({ plan_id: z.uuid(), staff_id: z.uuid(), status: z.enum(["stopped", "completed"]) }), audience: (p: { staff_id: string }) => ({ users: [p.staff_id] }) },
  { name: "onboarding.item.ticked", version: 1, description: "Nhân sự tick xong một việc (đi tới thông báo gom theo ngày cho leader).", schema: z.object({ plan_id: z.uuid(), staff_id: z.uuid(), notify_id: z.uuid().nullable() }) },
  { name: "onboarding.checkpoint.passed", version: 1, description: "Một checkpoint chuyển sang Đạt (job quét phát; đi tới thông báo gom theo ngày cho leader).", schema: z.object({ plan_id: z.uuid(), staff_id: z.uuid(), notify_id: z.uuid().nullable(), checkpoint_id: z.uuid() }) },
];

const Out = z.record(z.string(), z.unknown());

/** Checks each attached form belongs to the owner of the plan, then writes the whole structure. Stages and weeks are rewritten; items keep their id (and so the ticks). */
async function writeStructure(ctx: Ctx, plan: PlanRow, s: Structure): Promise<void> {
  const weekNos = new Set<number>();
  let next = 1;
  const weeks: { stage: number; no: number; w: Structure["stages"][number]["weeks"][number] }[] = [];
  s.stages.forEach((st, si) => st.weeks.forEach((w) => {
    const no = w.week_no ?? next;
    if (weekNos.has(no)) throw new AppError("validation_error", `Tuần ${no} bị trùng.`, { reason: "week_duplicate", week_no: no });
    weekNos.add(no);
    next = no + 1;
    weeks.push({ stage: si, no, w });
  }));
  const maxWeek = Math.max(0, ...weekNos);
  const itemIds = new Set<string>();
  const formIds = new Set<string>();
  for (const { no, w } of weeks) {
    for (const it of w.items) {
      if (it.repeat !== "once" && it.until_week_no !== undefined && it.until_week_no < no) throw new AppError("validation_error", `Việc "${it.name}": tuần kết thúc nhỏ hơn tuần bắt đầu.`, { reason: "until_before_start" });
      if (it.until_week_no !== undefined && it.until_week_no > maxWeek) throw new AppError("validation_error", `Việc "${it.name}": tuần kết thúc ${it.until_week_no} không có trong lộ trình.`, { reason: "until_out_of_range" });
      if (it.id) itemIds.add(it.id);
      if (it.form_id) formIds.add(it.form_id);
    }
  }
  if (formIds.size) {
    const ok = await ctx.db.execute(sql`/*scope:system*/ SELECT id FROM forms WHERE id = ANY(${`{${[...formIds].join(",")}}`}::uuid[]) AND owner_id = ${plan.ownerId}::uuid AND deleted_at IS NULL`);
    if (ok.rows.length !== formIds.size) throw new AppError("validation_error", "Form gắn vào việc phải là form của người tạo lộ trình.", { reason: "form_not_owned" });
  }
  if (itemIds.size) {
    const have = await ctx.db.execute(sql`/*scope:system*/ SELECT id FROM onb_items WHERE plan_id = ${plan.id}::uuid AND id = ANY(${`{${[...itemIds].join(",")}}`}::uuid[])`);
    if (have.rows.length !== itemIds.size) throw new AppError("validation_error", "Có mã việc không thuộc lộ trình này.", { reason: "item_unknown" });
  }
  await ctx.db.execute(sql`/*scope:system*/ DELETE FROM onb_weeks WHERE plan_id = ${plan.id}::uuid`);
  await ctx.db.execute(sql`/*scope:system*/ DELETE FROM onb_stages WHERE plan_id = ${plan.id}::uuid`);
  const stageIds = s.stages.map(() => newId());
  for (const [i, st] of s.stages.entries()) await ctx.db.execute(sql`INSERT INTO onb_stages (id, plan_id, name, position) VALUES (${stageIds[i]!}::uuid, ${plan.id}::uuid, ${st.name}, ${i}::int)`);
  const keep: string[] = [];
  let pos = 0;
  for (const { stage, no, w } of weeks) {
    await ctx.db.execute(sql`INSERT INTO onb_weeks (id, plan_id, stage_id, week_no, name, goal, is_break) VALUES (${newId()}::uuid, ${plan.id}::uuid, ${stageIds[stage]!}::uuid, ${no}::int, ${w.name}, ${w.goal ?? null}, ${w.is_break ?? false})`);
    for (const it of w.items) {
      const id = it.id ?? newId();
      keep.push(id);
      await upsertItem(ctx.db, plan.id, id, no, pos++, it, !!it.id);
    }
  }
  await ctx.db.execute(sql`/*scope:system*/ DELETE FROM onb_items WHERE plan_id = ${plan.id}::uuid AND NOT (id = ANY(${`{${keep.join(",")}}`}::uuid[]))`);
}

async function upsertItem(db: Executor, planId: string, id: string, weekNo: number, position: number, it: ItemInput, exists: boolean): Promise<void> {
  const until = it.repeat === "once" ? null : (it.until_week_no ?? weekNo);
  const needForm = it.need_form ?? false;
  const v = { name: it.name, description: it.description ?? null, kind: it.kind, weekday: it.weekday, repeat: it.repeat, due: it.due_time ?? null, remind: it.remind_before_min ?? null, form: it.form_id ?? null, share: it.share_table ?? false, filler: it.filler_column ?? null, leader: `{${(it.leader_columns ?? []).map((c) => `"${c.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`, link: it.link ?? null };
  if (exists) {
    await db.execute(sql`/*scope:system*/ UPDATE onb_items SET week_no = ${weekNo}::int, position = ${position}::int, name = ${v.name}, description = ${v.description}, kind = ${v.kind}, weekday = ${v.weekday}::int, repeat = ${v.repeat}, until_week_no = ${until}::int, due_time = ${v.due},
      remind_before_min = ${v.remind}::int, form_id = ${v.form}::uuid, need_form = ${needForm}, share_table = ${v.share}, filler_column = ${v.filler}, leader_columns = ${v.leader}::text[], link = ${v.link} WHERE id = ${id}::uuid AND plan_id = ${planId}::uuid`);
  } else {
    await db.execute(sql`INSERT INTO onb_items (id, plan_id, week_no, position, name, description, kind, weekday, repeat, until_week_no, due_time, remind_before_min, form_id, need_form, share_table, filler_column, leader_columns, link)
      VALUES (${id}::uuid, ${planId}::uuid, ${weekNo}::int, ${position}::int, ${v.name}, ${v.description}, ${v.kind}, ${v.weekday}::int, ${v.repeat}, ${until}::int, ${v.due}, ${v.remind}::int, ${v.form}::uuid, ${needForm}, ${v.share}, ${v.filler}, ${v.leader}::text[], ${v.link})`);
  }
}

/** The structure of a plan as the `Structure` input shape (ids kept), used by `get`, clone and copy. */
async function readStructure(db: Executor, planId: string): Promise<{ stages: { id: string; name: string; weeks: { week_no: number; name: string; goal: string | null; is_break: boolean; items: Record<string, unknown>[] }[] }[]}> {
  const stages = (await db.execute(sql`/*scope:system*/ SELECT id, name FROM onb_stages WHERE plan_id = ${planId}::uuid ORDER BY position`)).rows as { id: string; name: string }[];
  const weeks = (await db.execute(sql`/*scope:system*/ SELECT stage_id, week_no, name, goal, is_break FROM onb_weeks WHERE plan_id = ${planId}::uuid ORDER BY week_no`)).rows as { stage_id: string | null; week_no: number; name: string; goal: string | null; is_break: boolean }[];
  const items = (await db.execute(sql`/*scope:system*/ SELECT * FROM onb_items WHERE plan_id = ${planId}::uuid ORDER BY week_no, position`)).rows as Record<string, unknown>[];
  const occ = (await db.execute(sql`/*scope:system*/ SELECT id, item_id, on_date, due_at, done_at FROM onb_occurrences WHERE plan_id = ${planId}::uuid ORDER BY on_date`)).rows as Record<string, unknown>[];
  const occBy = new Map<string, Record<string, unknown>[]>();
  for (const o of occ) {
    const l = occBy.get(o.item_id as string) ?? [];
    l.push({ id: o.id, on_date: o.on_date instanceof Date ? o.on_date.toISOString().slice(0, 10) : String(o.on_date).slice(0, 10), due_at: o.due_at ? new Date(o.due_at as string).toISOString() : null, done_at: o.done_at ? new Date(o.done_at as string).toISOString() : null });
    occBy.set(o.item_id as string, l);
  }
  const formIds = [...new Set(items.map((i) => i.form_id as string | null).filter((x): x is string => !!x))];
  const forms = new Map<string, { code: string; name: string; table_id: string | null; datahub_id: string | null }>();
  if (formIds.length) {
    for (const f of (await db.execute(sql`/*scope:system*/ SELECT f.id, f.code, f.name, f.table_id, t.datahub_id FROM forms f LEFT JOIN dh_tables t ON t.id = f.table_id WHERE f.id = ANY(${`{${formIds.join(",")}}`}::uuid[])`)).rows as { id: string; code: string; name: string; table_id: string | null; datahub_id: string | null }[]) forms.set(f.id, f);
  }
  const itemOut = (r: Record<string, unknown>) => ({
    form_code: forms.get(r.form_id as string)?.code ?? null, form_name: forms.get(r.form_id as string)?.name ?? null, form_table_id: forms.get(r.form_id as string)?.table_id ?? null, form_datahub_id: forms.get(r.form_id as string)?.datahub_id ?? null,
    id: r.id, name: r.name, description: r.description, kind: r.kind, weekday: r.weekday, repeat: r.repeat, until_week_no: r.until_week_no, due_time: r.due_time, remind_before_min: r.remind_before_min,
    form_id: r.form_id, need_form: r.need_form, share_table: r.share_table, filler_column: r.filler_column, leader_columns: r.leader_columns, link: r.link, occurrences: occBy.get(r.id as string) ?? [],
  });
  return {
    stages: stages.map((s) => ({ id: s.id, name: s.name, weeks: weeks.filter((w) => w.stage_id === s.id).map((w) => ({ week_no: w.week_no, name: w.name, goal: w.goal, is_break: w.is_break, items: items.filter((i) => i.week_no === w.week_no).map(itemOut) })) })),
  };
}

const planOut = (p: PlanRow, extra: Record<string, unknown> = {}) => ({ id: p.id, name: p.name, owner_id: p.ownerId, tree_id: p.treeId, is_template: p.isTemplate, staff_id: p.staffId, start_date: p.startDate, followers: p.followers, status: p.status, stop_reason: p.stopReason, ended_at: p.endedAt, source_plan_id: p.sourcePlanId, final_result: p.finalResult, final_note: p.finalNote, version: p.version, ...extra });

/** Structure input from a stored plan: `keepForms` false drops the form (the person has to choose their own), `keepIds` false makes every item new. */
async function structureFor(db: Executor, planId: string, opts: { forms: Map<string, string> | "keep" | "drop" }): Promise<Structure> {
  const st = await readStructure(db, planId);
  return {
    stages: st.stages.map((s) => ({
      name: s.name,
      weeks: s.weeks.map((w) => ({
        week_no: w.week_no, name: w.name, goal: w.goal ?? undefined, is_break: w.is_break,
        items: w.items.map((i) => {
          const fid = (i.form_id as string | null) ?? null;
          const mapped = opts.forms === "keep" ? fid : opts.forms === "drop" ? null : fid ? (opts.forms.get(fid) ?? null) : null;
          return {
            name: i.name as string, description: (i.description as string | null) ?? undefined, kind: i.kind as ItemInput["kind"], weekday: i.weekday as number, repeat: i.repeat as ItemInput["repeat"],
            until_week_no: (i.until_week_no as number | null) ?? undefined, due_time: (i.due_time as string | null) ?? undefined, remind_before_min: (i.remind_before_min as number | null) ?? undefined,
            form_id: mapped, need_form: !!fid && !mapped ? true : (i.need_form as boolean), share_table: i.share_table as boolean, filler_column: (i.filler_column as string | null) ?? undefined,
            leader_columns: (i.leader_columns as string[]) ?? [], link: (i.link as string | null) ?? undefined,
          } as ItemInput;
        }),
      })),
    })),
  };
}

async function insertPlan(ctx: Ctx, p: { name: string; isTemplate: boolean; sourcePlanId?: string | null; treeId?: string }): Promise<PlanRow> {
  const me = await loadPerson(ctx.db, ctx.actor.userId);
  const tree = p.treeId ?? (me ? treeOf(me) : null);
  if (!tree) throw new AppError("forbidden", "Bạn chưa thuộc cây tổ chức nào.", { reason: "no_tree" });
  const id = newId();
  await ctx.db.execute(sql`INSERT INTO onb_plans (id, created_by, updated_by, owner_id, tree_id, name, is_template, source_plan_id) VALUES (${id}::uuid, ${ctx.actor.userId}::uuid, ${ctx.actor.userId}::uuid, ${ctx.actor.userId}::uuid, ${tree}::uuid, ${p.name}, ${p.isTemplate}, ${p.sourcePlanId ?? null}::uuid)`);
  return loadPlan(ctx.db, id);
}
const touch = (ctx: Ctx, id: string) => ctx.db.execute(sql`/*scope:system*/ UPDATE onb_plans SET version = version + 1, updated_at = now(), updated_by = ${ctx.actor.userId}::uuid WHERE id = ${id}::uuid`);

export const onboardingOperations = [
  ...checkpointOperations,
  ...overviewOperations,
  defineCommand({
    name: "onboarding.plan.create",
    summary: "Tạo lộ trình từ đầu (nháp hoặc mẫu), có thể kèm luôn giai đoạn, tuần, việc.",
    description: "Cấu trúc: `stages[] → weeks[] → items[]`. Tuần tự đánh số 1, 2, 3... nếu không gửi `week_no`. Việc: loại, thứ, lặp (`once`, `daily_workdays`, `weekly`), giờ hạn, nhắc trước, form gắn kèm.",
    ...C,
    input: z.object({ name: z.string().trim().min(1).max(200), is_template: z.boolean().optional(), structure: StructureIn.optional(), checkpoints: z.array(CheckpointIn).max(200).optional() }),
    output: Out,
    http: { method: "POST", path: "/onboarding/plans", status: 201 },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const plan = await insertPlan(ctx, { name: i.name, isTemplate: i.is_template ?? false });
      if (i.structure) await writeStructure(ctx, plan, i.structure);
      if (i.checkpoints) await writeCheckpoints(ctx, plan, i.checkpoints);
      ctx.audit({ type: "onboarding_plan", id: plan.id, details: { name: plan.name } });
      return planOut(plan);
    },
  }),

  defineCommand({
    name: "onboarding.plan.save",
    summary: "Sửa lộ trình: tên, người theo dõi, và cả cấu trúc (gửi lại toàn bộ giai đoạn/tuần/việc; việc không còn trong danh sách bị xoá).",
    description: "Việc giữ `id` thì giữ trạng thái tick. Lộ trình đã gắn nhân sự: ngày thật tính lại, việc mới được cấp quyền form/bảng cho nhân sự. Leader trực tiếp của nhân sự và Manager sửa được.",
    ...C,
    emits: GRANT_EVENTS,
    input: z.object({ plan_id: Id, name: z.string().trim().min(1).max(200).optional(), followers: z.array(Id).max(20).optional(), structure: StructureIn.optional(), checkpoints: z.array(CheckpointIn).max(200).optional().describe("Gửi lại toàn bộ checkpoint (giữ `id` thì giữ xác nhận tay; không còn trong danh sách thì xoá).") }),
    output: Out,
    http: { method: "PUT", path: "/onboarding/plans/:plan_id" },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const plan = await requirePlan(ctx, i.plan_id, "edit");
      if (plan.status === "completed" || plan.status === "stopped") throw new AppError("conflict", "Lộ trình đã kết thúc, không sửa được.", { reason: "plan_ended" });
      if (i.name !== undefined || i.followers !== undefined) {
        await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_plans SET name = ${i.name ?? plan.name}, followers = ${`{${(i.followers ?? plan.followers).join(",")}}`}::uuid[] WHERE id = ${plan.id}::uuid`);
      }
      if (i.structure) {
        await writeStructure(ctx, plan, i.structure);
        if (plan.staffId) {
          await syncOccurrences(ctx.db, plan);
          if (plan.status === "active") await applyGrants(ctx, plan, plan.staffId, "up");
        }
      }
      if (i.checkpoints) await writeCheckpoints(ctx, plan, i.checkpoints);
      await touch(ctx, plan.id);
      ctx.audit({ type: "onboarding_plan", id: plan.id });
      return planOut(await loadPlan(ctx.db, plan.id));
    },
  }),

  defineQuery({
    name: "onboarding.plan.list",
    summary: "Danh sách lộ trình: của tôi (tôi tạo hoặc tôi là nhân sự), mẫu của cây, tôi theo dõi, hoặc của team (nhân sự dưới tôi).",
    ...R,
    input: z.object({ scope: z.enum(["mine", "template", "following", "team"]).default("mine") }),
    output: z.array(Out),
    http: { method: "GET", path: "/onboarding/plans" },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const me = await loadPerson(ctx.db, ctx.actor.userId);
      if (!me) return [];
      const a = ctx.actor.userId;
      const can = (await ctx.access.permissions()).has("onboarding:path:create");
      const where =
        i.scope === "mine" ? sql`(p.owner_id = ${a}::uuid OR p.staff_id = ${a}::uuid) AND NOT p.is_template`
        : i.scope === "template" ? (can ? sql`p.is_template AND p.tree_id = ${treeOf(me) ?? a}::uuid` : sql`false`)
        : i.scope === "following" ? sql`${a}::uuid = ANY(p.followers)`
        : sql`p.staff_id IS NOT NULL AND (s.leader_id = ${a}::uuid OR (${me.roles.includes("manager")} AND p.tree_id = ${a}::uuid))`;
      const res = await ctx.db.execute(sql`/*scope:system*/ SELECT p.*, u.full_name AS staff_name,
          (SELECT count(*) FROM onb_occurrences o WHERE o.plan_id = p.id)::int AS total, (SELECT count(*) FROM onb_occurrences o WHERE o.plan_id = p.id AND o.done_at IS NOT NULL)::int AS done,
          (SELECT count(*) FROM onb_weeks w WHERE w.plan_id = p.id)::int AS weeks
        FROM onb_plans p LEFT JOIN users u ON u.id = p.staff_id LEFT JOIN org_memberships s ON s.user_id = p.staff_id AND s.valid_to IS NULL
        WHERE ${where} ORDER BY p.updated_at DESC LIMIT 200`);
      return (res.rows as Record<string, unknown>[]).map((r) => planOut(planFrom(r), { staff_name: r.staff_name ?? null, weeks: r.weeks, occurrences_total: r.total, occurrences_done: r.done }));
    },
  }),

  defineQuery({
    name: "onboarding.plan.get",
    summary: "Một lộ trình: cấu trúc giai đoạn/tuần/việc, các lần xuất hiện của việc (ngày thật, đã tick chưa) và quyền của người xem.",
    ...R,
    input: z.object({ plan_id: Id }),
    output: Out,
    http: { method: "GET", path: "/onboarding/plans/:plan_id" },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const plan = await requirePlan(ctx, i.plan_id, "view");
      const r = await rights(ctx.db, plan, ctx.actor.userId);
      const st = await readStructure(ctx.db, plan.id);
      const [c] = (await ctx.db.execute(sql`/*scope:system*/ SELECT count(*)::int AS total, count(done_at)::int AS done FROM onb_occurrences WHERE plan_id = ${plan.id}::uuid`)).rows as { total: number; done: number }[];
      return planOut(plan, { stages: st.stages, checkpoints: await readCheckpoints(ctx.db, plan.id), can_edit: r.edit, occurrences_total: c?.total ?? 0, occurrences_done: c?.done ?? 0 });
    },
  }),

  defineCommand({
    name: "onboarding.plan.clone",
    summary: "Nhân bản lộ trình mình thấy về làm của mình (nháp). Lộ trình của mình: nhân bản luôn form của mình. Của người khác: chỉ cấu trúc, form bỏ gắn và đánh dấu \"cần chọn form\".",
    ...C,
    emits: ["datahub.structure.changed"],
    input: z.object({ plan_id: Id, name: z.string().trim().min(1).max(200).optional() }),
    output: Out,
    http: { method: "POST", path: "/onboarding/plans/:plan_id/clone", status: 201 },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const src = await requirePlan(ctx, i.plan_id, "view");
      const plan = await insertPlan(ctx, { name: i.name ?? `${src.name} (bản sao)`, isTemplate: src.isTemplate, sourcePlanId: src.id });
      let forms: Map<string, string> | "drop" = "drop";
      if (src.ownerId === ctx.actor.userId) {
        forms = new Map();
        const ids = (await ctx.db.execute(sql`/*scope:system*/ SELECT DISTINCT form_id FROM onb_items WHERE plan_id = ${src.id}::uuid AND form_id IS NOT NULL`)).rows as { form_id: string }[];
        for (const { form_id } of ids) {
          // A plan of mine keeps my forms: one form serves many plans, and the answers of everyone stay in one table (design module9 2).
          const live = await ctx.db.execute(sql`/*scope:system*/ SELECT 1 FROM forms WHERE id = ${form_id}::uuid AND owner_id = ${ctx.actor.userId}::uuid AND deleted_at IS NULL`);
          if (live.rows.length) forms.set(form_id, form_id);
        }
      }
      await writeStructure(ctx, plan, await structureFor(ctx.db, src.id, { forms }));
      await copyCheckpoints(ctx.db, src.id, plan.id, forms);
      ctx.audit({ type: "onboarding_plan", id: plan.id, details: { cloned_from: src.id } });
      return planOut(plan);
    },
  }),

  defineCommand({
    name: "onboarding.plan.assign",
    summary: "Gắn lộ trình cho một nhân sự: ngày bắt đầu (thứ Hai), người theo dõi. Tính ngày thật cho mọi việc, cấp quyền form và bảng. Lộ trình mẫu thì tạo bản gắn riêng.",
    description: "Mỗi người một lộ trình đang chạy. Chỉ Leader trực tiếp của nhân sự hoặc Manager của cây gắn được. Form gắn trong lộ trình: nhân sự vào danh sách người điền; form đánh dấu chia sẻ bảng: bảng chia sẻ quyền Sửa, khoá phân chia theo cột người điền, cột của leader nhân sự không sửa được.",
    ...C,
    emits: ["onboarding.plan.assigned", ...GRANT_EVENTS],
    input: z.object({ plan_id: Id, staff_id: Id, start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), followers: z.array(Id).max(20).optional() }),
    output: Out,
    http: { method: "POST", path: "/onboarding/plans/:plan_id/assign", status: 201 },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      let plan = await requirePlan(ctx, i.plan_id, "view");
      const me = (await loadPerson(ctx.db, ctx.actor.userId))!;
      const staff = await loadPerson(ctx.db, i.staff_id);
      if (!staff || staff.kind !== "person" || staff.status !== "active" || staff.roles.includes("guest") || staff.roles.includes("admin") || !treeOf(staff)) throw new AppError("validation_error", "Chỉ gắn cho nhân sự đang hoạt động trong cây (Manager, Leader hoặc User).", { reason: "staff_invalid" });
      const direct = staff.leaderId === me.id || (me.roles.includes("manager") && treeOf(staff) === me.id);
      if (!direct) throw new AppError("forbidden", "Chỉ Leader trực tiếp của nhân sự hoặc Manager của cây được gắn lộ trình.", { reason: "not_plan_editor" });
      if (treeOf(staff) !== plan.treeId) throw new AppError("forbidden", "Nhân sự không thuộc cây của lộ trình.", { reason: "other_tree" });
      if (plan.staffId) throw new AppError("conflict", "Lộ trình này đã gắn cho một nhân sự. Nhân bản để gắn cho người khác.", { reason: "plan_assigned" });
      if (!isMonday(i.start_date)) throw new AppError("validation_error", "Ngày bắt đầu phải là thứ Hai.", { reason: "start_not_monday" });
      const busy = await ctx.db.execute(sql`/*scope:system*/ SELECT id FROM onb_plans WHERE staff_id = ${staff.id}::uuid AND status = 'active'`);
      if (busy.rows.length) throw new AppError("conflict", "Nhân sự này đang có một lộ trình chạy. Dừng lộ trình đó trước.", { reason: "staff_has_active_plan", plan_id: (busy.rows[0] as { id: string }).id });
      if (plan.isTemplate) {
        const copy = await insertPlan(ctx, { name: plan.name, isTemplate: false, sourcePlanId: plan.id, treeId: plan.treeId });
        await writeStructure(ctx, copy, await structureFor(ctx.db, plan.id, { forms: "keep" }));
        await copyCheckpoints(ctx.db, plan.id, copy.id, "keep");
        plan = copy;
      }
      await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_plans SET staff_id = ${staff.id}::uuid, start_date = ${i.start_date}::date, status = 'active', followers = ${`{${(i.followers ?? plan.followers).join(",")}}`}::uuid[] WHERE id = ${plan.id}::uuid`);
      plan = await loadPlan(ctx.db, plan.id);
      await syncOccurrences(ctx.db, plan);
      await applyGrants(ctx, plan, staff.id, "up");
      await touch(ctx, plan.id);
      ctx.audit({ type: "onboarding_plan", id: plan.id, details: { staff_id: staff.id, start_date: i.start_date } });
      await ctx.emit("onboarding.plan.assigned", { aggregateType: "onboarding_plan", aggregateId: plan.id, payload: { plan_id: plan.id, staff_id: staff.id, leader_id: staff.leaderId, start_date: i.start_date } });
      return planOut(await loadPlan(ctx.db, plan.id));
    },
  }),

  defineCommand({
    name: "onboarding.plan.week_break",
    summary: "Đánh dấu hoặc bỏ \"tuần nghỉ\" trong lộ trình (kể cả đã gắn): thêm một tuần nghỉ vào vị trí `week_no`, mọi tuần từ đó trở đi dời xuống một tuần (việc, checkpoint, ngày thật); bỏ thì tuần nghỉ mất và các tuần sau dời lên.",
    ...C,
    emits: GRANT_EVENTS,
    input: z.object({ plan_id: Id, week_no: z.number().int().min(1).max(200), is_break: z.boolean().default(true), name: z.string().trim().min(1).max(300).optional() }),
    output: Out,
    http: { method: "POST", path: "/onboarding/plans/:plan_id/week-break" },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const plan = await requirePlan(ctx, i.plan_id, "edit");
      if (plan.status === "completed" || plan.status === "stopped") throw new AppError("conflict", "Lộ trình đã kết thúc, không sửa được.", { reason: "plan_ended" });
      const pid = plan.id;
      const dir = i.is_break ? 1 : -1;
      const wk = (await ctx.db.execute(sql`/*scope:system*/ SELECT stage_id, is_break FROM onb_weeks WHERE plan_id = ${pid}::uuid AND week_no = ${i.week_no}::int`)).rows[0] as { stage_id: string | null; is_break: boolean } | undefined;
      if (i.is_break) {
        const prev = (await ctx.db.execute(sql`/*scope:system*/ SELECT stage_id FROM onb_weeks WHERE plan_id = ${pid}::uuid AND week_no < ${i.week_no}::int ORDER BY week_no DESC LIMIT 1`)).rows[0] as { stage_id: string | null } | undefined;
        if (!wk && !prev) throw new AppError("validation_error", `Tuần ${i.week_no} không có trong lộ trình.`, { reason: "week_unknown" });
      } else {
        if (!wk?.is_break) throw new AppError("validation_error", `Tuần ${i.week_no} không phải tuần nghỉ.`, { reason: "not_break_week" });
        const busy = await ctx.db.execute(sql`/*scope:system*/ SELECT 1 FROM onb_items WHERE plan_id = ${pid}::uuid AND week_no = ${i.week_no}::int LIMIT 1`);
        if (busy.rows.length) throw new AppError("conflict", "Tuần nghỉ còn việc, chuyển hoặc xoá việc trước.", { reason: "break_week_has_items" });
      }
      const from = i.is_break ? i.week_no : i.week_no + 1;
      // Move from the far end so the unique (plan, week) never collides.
      const later = (await ctx.db.execute(sql`/*scope:system*/ SELECT week_no FROM onb_weeks WHERE plan_id = ${pid}::uuid AND week_no >= ${from}::int ORDER BY week_no ${i.is_break ? sql`DESC` : sql`ASC`}`)).rows as { week_no: number }[];
      if (!i.is_break) await ctx.db.execute(sql`/*scope:system*/ DELETE FROM onb_weeks WHERE plan_id = ${pid}::uuid AND week_no = ${i.week_no}::int`);
      for (const { week_no } of later) await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_weeks SET week_no = ${week_no + dir}::int WHERE plan_id = ${pid}::uuid AND week_no = ${week_no}::int`);
      await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_items SET week_no = week_no + ${dir}::int WHERE plan_id = ${pid}::uuid AND week_no >= ${from}::int`);
      await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_items SET until_week_no = until_week_no + ${dir}::int WHERE plan_id = ${pid}::uuid AND until_week_no >= ${from}::int`);
      await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_checkpoints SET week_no = week_no + ${dir}::int WHERE plan_id = ${pid}::uuid AND week_no >= ${from}::int`);
      if (!i.is_break) {
        await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_items SET until_week_no = GREATEST(until_week_no, week_no) WHERE plan_id = ${pid}::uuid AND until_week_no IS NOT NULL`);
      } else {
        const stage = wk?.stage_id ?? ((await ctx.db.execute(sql`/*scope:system*/ SELECT stage_id FROM onb_weeks WHERE plan_id = ${pid}::uuid AND week_no < ${i.week_no}::int ORDER BY week_no DESC LIMIT 1`)).rows[0] as { stage_id: string | null }).stage_id;
        await ctx.db.execute(sql`INSERT INTO onb_weeks (id, plan_id, stage_id, week_no, name, goal, is_break) VALUES (${newId()}::uuid, ${pid}::uuid, ${stage}::uuid, ${i.week_no}::int, ${i.name ?? "Tuần nghỉ"}, NULL, true)`);
      }
      if (plan.staffId) await syncOccurrences(ctx.db, plan);
      await touch(ctx, pid);
      ctx.audit({ type: "onboarding_plan", id: pid, details: { week_no: i.week_no, is_break: i.is_break } });
      return planOut(await loadPlan(ctx.db, pid));
    },
  }),

  defineCommand({
    name: "onboarding.plan.stop",
    summary: "Dừng lộ trình đang chạy, kèm lý do. Bảng chia sẻ cho nhân sự hạ về quyền Xem.",
    ...C,
    emits: ["onboarding.plan.ended", ...GRANT_EVENTS],
    input: z.object({ plan_id: Id, reason: z.string().trim().min(1).max(1000) }),
    output: Out,
    http: { method: "POST", path: "/onboarding/plans/:plan_id/stop" },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const plan = await requirePlan(ctx, i.plan_id, "edit");
      if (plan.status !== "active" || !plan.staffId) throw new AppError("conflict", "Chỉ dừng được lộ trình đang chạy.", { reason: "plan_not_active" });
      await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_plans SET status = 'stopped', stop_reason = ${i.reason}, ended_at = now() WHERE id = ${plan.id}::uuid`);
      await applyGrants(ctx, plan, plan.staffId, "down");
      await touch(ctx, plan.id);
      ctx.audit({ type: "onboarding_plan", id: plan.id, details: { reason: i.reason } });
      await ctx.emit("onboarding.plan.ended", { aggregateType: "onboarding_plan", aggregateId: plan.id, payload: { plan_id: plan.id, staff_id: plan.staffId, status: "stopped" } });
      return planOut(await loadPlan(ctx.db, plan.id));
    },
  }),

  defineCommand({
    name: "onboarding.plan.delete",
    summary: "Xoá lộ trình chưa chạy (nháp, mẫu) hoặc đã kết thúc.",
    ...C,
    input: z.object({ plan_id: Id }),
    output: z.object({ id: Id, deleted: z.literal(true) }),
    http: { method: "DELETE", path: "/onboarding/plans/:plan_id" },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const plan = await requirePlan(ctx, i.plan_id, "edit");
      if (plan.status === "active") throw new AppError("conflict", "Dừng lộ trình trước khi xoá.", { reason: "plan_active" });
      await ctx.db.execute(sql`/*scope:system*/ DELETE FROM onb_plans WHERE id = ${plan.id}::uuid`);
      ctx.audit({ type: "onboarding_plan", id: plan.id });
      return { id: plan.id, deleted: true as const };
    },
  }),

  defineCommand({
    name: "onboarding.item.tick",
    summary: "Nhân sự tick xong (hoặc bỏ tick) một việc của mình ở một ngày. AI không làm được.",
    permission: "onboarding:path:read",
    aiAllowed: false,
    emits: ["onboarding.item.ticked"],
    input: z.object({ occurrence_id: Id, done: z.boolean().default(true) }),
    output: Out,
    http: { method: "POST", path: "/onboarding/occurrences/:occurrence_id/tick" },
    handler: async (ctx, i) => {
      const r = await ctx.db.execute(sql`/*scope:system*/ SELECT o.id, o.plan_id, p.staff_id, p.status FROM onb_occurrences o JOIN onb_plans p ON p.id = o.plan_id WHERE o.id = ${i.occurrence_id}::uuid`);
      const o = r.rows[0] as { id: string; plan_id: string; staff_id: string | null; status: string } | undefined;
      if (!o || o.staff_id !== ctx.actor.userId) throw new AppError("not_found", "Không tìm thấy việc.");
      if (o.status !== "active") throw new AppError("conflict", "Lộ trình không còn chạy.", { reason: "plan_not_active" });
      await ctx.db.execute(sql`/*scope:system*/ UPDATE onb_occurrences SET done_at = ${i.done ? sql`now()` : sql`NULL`}, done_by = ${i.done ? ctx.actor.userId : null}::uuid WHERE id = ${o.id}::uuid`);
      ctx.audit({ type: "onboarding_plan", id: o.plan_id, details: { occurrence_id: o.id, done: i.done } });
      if (i.done) {
        const me = await loadPerson(ctx.db, ctx.actor.userId);
        await ctx.emit("onboarding.item.ticked", { aggregateType: "onboarding_plan", aggregateId: o.plan_id, payload: { plan_id: o.plan_id, staff_id: ctx.actor.userId, notify_id: me?.leaderId ?? me?.managerId ?? null } });
      }
      const [x] = (await ctx.db.execute(sql`/*scope:system*/ SELECT id, plan_id, item_id, on_date, due_at, done_at FROM onb_occurrences WHERE id = ${o.id}::uuid`)).rows as Record<string, unknown>[];
      return { ...x, on_date: x!.on_date instanceof Date ? (x!.on_date as Date).toISOString().slice(0, 10) : String(x!.on_date).slice(0, 10) };
    },
  }),
];

