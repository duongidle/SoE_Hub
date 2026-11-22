import { sql } from "drizzle-orm";
import { z } from "zod";
import { businessDate } from "@soe/shared";
import { defineQuery } from "../../core/registry";
import { GROUPS, evaluatePlan, groupOf } from "./checkpoints";
import { Id, guardAi, loadPerson, planFrom } from "./shared";

type State = "passed" | "failed" | "running" | "not_yet";
/** Colour of a column of the follow-up table: all met = passed; one failed = failed; else running (some started) or not yet. */
const stateOf = (c: { passed: number; failed: number; running: number; total: number }): State | null =>
  c.total === 0 ? null : c.passed === c.total ? "passed" : c.failed > 0 ? "failed" : c.running > 0 || c.passed > 0 ? "running" : "not_yet";

/**
 * The follow-up page (design module9 7): one row per person on a plan. Manager: the whole tree; Leader: the team and the plans they follow.
 * Numbers come from `evaluatePlan`, the same function as `progress.get` (one place computes a checkpoint).
 */
export const overviewOperations = [
  defineQuery({
    name: "onboarding.overview",
    summary: "Trang Theo dõi onboarding: mỗi dòng một nhân sự (lộ trình, tuần hiện tại/tổng, tiến độ, checkpoint đạt/tổng, cột theo nhóm, việc trễ, kết quả cuối). Manager xem cả cây, Leader xem team và lộ trình đang theo dõi.",
    description: "Lọc theo team (`leader_id`), lộ trình gốc (`source_plan_id`: các lộ trình nhân bản/gắn từ nó), tên (`q`), trạng thái (mặc định `active`). `groups` có các nhóm `test, mockup, on_job, qna, daily, other`, mỗi nhóm `{passed, total, state}`; `state`: `passed`, `failed`, `running`, `not_yet` (màu của ô).",
    permission: "onboarding:path:read",
    aiAllowed: true,
    input: z.object({ leader_id: Id.optional(), source_plan_id: Id.optional(), q: z.string().trim().max(200).optional(), status: z.enum(["active", "completed", "stopped", "all"]).default("active") }),
    output: z.array(z.record(z.string(), z.unknown())),
    http: { method: "GET", path: "/onboarding/overview" },
    handler: async (ctx, i) => {
      await guardAi(ctx);
      const me = await loadPerson(ctx.db, ctx.actor.userId);
      if (!me) return [];
      const a = ctx.actor.userId;
      const plans = (await ctx.db.execute(sql`SELECT p.*, u.full_name AS staff_name, m.leader_id, l.full_name AS leader_name
        FROM onb_plans p JOIN users u ON u.id = p.staff_id LEFT JOIN org_memberships m ON m.user_id = p.staff_id AND m.valid_to IS NULL LEFT JOIN users l ON l.id = m.leader_id
        WHERE p.staff_id IS NOT NULL AND p.start_date IS NOT NULL AND (m.leader_id = ${a}::uuid OR (${me.roles.includes("manager")} AND p.tree_id = ${a}::uuid) OR ${a}::uuid = ANY(p.followers))
          ${i.status === "all" ? sql`` : sql`AND p.status = ${i.status}`} ${i.leader_id ? sql`AND m.leader_id = ${i.leader_id}::uuid` : sql``}
          ${i.source_plan_id ? sql`AND p.source_plan_id = ${i.source_plan_id}::uuid` : sql``} ${i.q ? sql`AND (p.name ILIKE ${`%${i.q}%`} OR u.full_name ILIKE ${`%${i.q}%`})` : sql``}
        ORDER BY u.full_name LIMIT 300`)).rows as Record<string, unknown>[];
      if (plans.length === 0) return [];
      const ids = `{${plans.map((p) => p.id as string).join(",")}}`;
      const occ = new Map(((await ctx.db.execute(sql`SELECT plan_id, count(*)::int AS total, count(done_at)::int AS done,
          count(*) FILTER (WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at < now())::int AS overdue FROM onb_occurrences WHERE plan_id = ANY(${ids}::uuid[]) GROUP BY plan_id`)).rows as { plan_id: string; total: number; done: number; overdue: number }[]).map((r) => [r.plan_id, r]));
      const weeks = new Map(((await ctx.db.execute(sql`SELECT plan_id, count(*)::int AS n FROM onb_weeks WHERE plan_id = ANY(${ids}::uuid[]) GROUP BY plan_id`)).rows as { plan_id: string; n: number }[]).map((r) => [r.plan_id, r.n]));
      const today = new Date(`${businessDate(new Date())}T00:00:00Z`).getTime();
      const out: Record<string, unknown>[] = [];
      const BATCH = 5;
      for (let s = 0; s < plans.length; s += BATCH) {
        out.push(...(await Promise.all(plans.slice(s, s + BATCH).map(async (r) => {
          const plan = planFrom(r);
          const cps = await evaluatePlan(ctx, plan);
          const groups: Record<string, { passed: number; failed: number; running: number; total: number }> = {};
          for (const g of GROUPS) groups[g] = { passed: 0, failed: 0, running: 0, total: 0 };
          for (const { cp, status } of cps) {
            const g = groups[groupOf(cp)]!;
            g.total++;
            if (status === "passed" || status === "passed_late") g.passed++;
            else if (status === "failed") g.failed++;
            else if (status === "running") g.running++;
          }
          const o = occ.get(plan.id);
          const total = weeks.get(plan.id) ?? 0;
          const week = Math.floor((today - new Date(`${plan.startDate}T00:00:00Z`).getTime()) / 604800000) + 1;
          return {
            plan_id: plan.id, plan_name: plan.name, source_plan_id: plan.sourcePlanId, status: plan.status, staff_id: plan.staffId, staff_name: r.staff_name, leader_id: r.leader_id ?? null, leader_name: r.leader_name ?? null,
            start_date: plan.startDate, current_week: Math.max(1, Math.min(week, total || week)), total_weeks: total,
            progress_pct: o && o.total > 0 ? Math.round((o.done / o.total) * 100) : 0, items_done: o?.done ?? 0, items_total: o?.total ?? 0, overdue: o?.overdue ?? 0,
            checkpoints_passed: cps.filter((c) => c.status === "passed" || c.status === "passed_late").length, checkpoints_total: cps.length,
            groups: Object.fromEntries(Object.entries(groups).filter(([, g]) => g.total > 0).map(([k, g]) => [k, { passed: g.passed, total: g.total, state: stateOf(g) }])),
            final_result: plan.finalResult,
          };
        }))));
      }
      return out;
    },
  }),
];
