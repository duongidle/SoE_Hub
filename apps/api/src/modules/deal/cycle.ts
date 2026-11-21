import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, businessDate } from "@soe/shared";
import { defineQuery } from "../../core/registry";
import type { HandlerCtx } from "../../core/types";
import { dealFacts } from "./forecast";

/**
 * Deal cycle and the "mature" cut-off of the cohorts (design module4 10.2), one place that computes them (the dashboard and the AI read the answer).
 * Cycle of a deal = `Closing date` - `Start date` of a WON deal, by deal type, over the Won deals of the last 12 months. A cohort (month of `Start date`) is mature
 * once the cycle has passed since its last day. Fewer than 10 Won deals: the default of 90 days. Only durations leave this file: no deal, no amount, no person.
 */
export const CYCLE_MILESTONES = ["median", "mean", "p75", "p90", "none"] as const;
export type CycleMilestone = (typeof CYCLE_MILESTONES)[number];
export const CYCLE_DEFAULT_DAYS = 90;
export const CYCLE_MIN_WON = 10;
export const CYCLE_WINDOW_MONTHS = 12;

export interface CycleStats {
  n: number;
  median: number;
  mean: number;
  p75: number;
  p90: number;
}

const DAY = 86_400_000;
const dayNo = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
const dateOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** Percentile with linear interpolation between the closest ranks (the same as `percentile_cont`). `sorted` ascending, not empty. */
export function percentile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Median, mean, P75 and P90 of the cycles in days, rounded UP to whole days (a cohort is never called mature a day too early). `null` for no deal. */
export function cycleStats(days: number[]): CycleStats | null {
  if (days.length === 0) return null;
  const s = [...days].sort((a, b) => a - b);
  return { n: s.length, median: Math.ceil(percentile(s, 0.5)), mean: Math.ceil(s.reduce((a, b) => a + b, 0) / s.length), p75: Math.ceil(percentile(s, 0.75)), p90: Math.ceil(percentile(s, 0.9)) };
}

/** The days to wait for a milestone: `none` waits for nothing; fewer than `CYCLE_MIN_WON` Won deals falls back to the default (90 days), except for `none`. */
export function waitDays(milestone: CycleMilestone, stats: CycleStats | null): { days: number; defaulted: boolean } {
  if (milestone === "none") return { days: 0, defaulted: false };
  if (!stats || stats.n < CYCLE_MIN_WON) return { days: CYCLE_DEFAULT_DAYS, defaulted: true };
  return { days: stats[milestone], defaulted: false };
}

/**
 * The cut-off for `today` and `days` of waiting: `cutoff = today - days`; the last mature cohort is the last month that ENDS on or before it
 * (`mature_through` = its last day, `mature_month` = `YYYY-MM`, both `null` when no month is mature yet).
 */
export function matureCutoff(today: string, days: number): { cutoff: string; mature_through: string | null; mature_month: string | null } {
  const cutoff = dateOf(dayNo(today) - days);
  const y = Number(cutoff.slice(0, 4));
  const m = Number(cutoff.slice(5, 7)); // 1-12
  const lastDay = Number(dateOf(Date.UTC(y, m, 0) / DAY).slice(8, 10));
  const full = Number(cutoff.slice(8, 10)) === lastDay;
  const through = full ? dateOf(Date.UTC(y, m, 0) / DAY) : dateOf(Date.UTC(y, m - 1, 0) / DAY);
  return { cutoff, mature_through: through, mature_month: through.slice(0, 7) };
}

/** Whose tree the cycle comes from: the Manager's own, or the Manager of the member. Admin and Guest have no tree. */
async function treeManager(ctx: Pick<HandlerCtx, "access" | "db">): Promise<string> {
  const p = await ctx.access.requirePrincipal();
  if (p.roles.includes("manager")) return p.userId;
  const res = await ctx.db.execute(sql`SELECT manager_id FROM org_memberships WHERE user_id = ${p.userId}::uuid AND valid_to IS NULL`);
  const managerId = (res.rows[0] as { manager_id: string | null } | undefined)?.manager_id;
  if (!managerId) throw new AppError("forbidden", "Bạn chưa thuộc cây của Manager nào nên chưa có cycle deal.", { reason: "no_manager" });
  return managerId;
}

const statsOut = z.object({ median: z.number().int(), mean: z.number().int(), p75: z.number().int(), p90: z.number().int() });
const typeOut = z.object({ type: z.string(), won_count: z.number().int(), stats: statsOut.nullable(), days: z.number().int(), defaulted: z.boolean() });

export const cycleOperations = [
  defineQuery({
    name: "deal.cycle",
    summary: "Cycle deal (trung vị, trung bình, P75, P90) và ngày cắt cohort đã chín theo mốc.",
    description:
      "Cycle = `Closing date` - `Start date` của deal Won trong 12 tháng gần nhất của cây, theo loại deal (làm tròn lên ngày). Dưới 10 deal Won thì dùng 90 ngày (`defaulted`). " +
      "`milestone`: `median`, `mean`, `p75`, `p90` hoặc `none` (không chờ). `days` là số ngày chờ của mốc; `cutoff` = hôm nay - `days`; `mature_through` là ngày cuối của tháng cohort chín gần nhất " +
      "(cohort là tháng nhận deal), `mature_month` là tháng đó. Biểu đồ cohort đặt khoảng thời gian tới `mature_through` và tô nhạt các tháng sau. " +
      "Mọi thành viên của cây đọc được (chỉ có số ngày, không có deal hay tiền). Không đưa `deal_type` thì tính chung mọi loại.",
    permission: "deal:deal:read",
    aiAllowed: true,
    input: z.object({ milestone: z.enum(CYCLE_MILESTONES).default("median"), deal_type: z.string().max(100).optional() }),
    output: z.object({
      milestone: z.enum(CYCLE_MILESTONES),
      deal_type: z.string().nullable(),
      today: z.string(),
      won_count: z.number().int(),
      stats: statsOut.nullable(),
      days: z.number().int(),
      defaulted: z.boolean(),
      cutoff: z.string(),
      mature_through: z.string().nullable(),
      mature_month: z.string().nullable(),
      by_type: z.array(typeOut),
    }),
    http: { method: "GET", path: "/deal/cycle" },
    handler: async (ctx, i) => {
      const managerId = await treeManager(ctx);
      const today = businessDate(new Date());
      const from = dateOf(dayNo(today) - Math.round((CYCLE_WINDOW_MONTHS * 365) / 12));
      const won = (await dealFacts(ctx.db, managerId)).filter((d) => d.meaning === "won" && d.start && d.closing && d.closing >= from && d.closing <= today);
      const daysOf = (list: typeof won) => list.map((d) => Math.max(0, dayNo(d.closing!) - dayNo(d.start!)));
      const byType = new Map<string, typeof won>();
      for (const d of won) byType.set(d.type, [...(byType.get(d.type) ?? []), d]);
      const row = (type: string, list: typeof won) => {
        const stats = cycleStats(daysOf(list));
        return { type, won_count: list.length, stats: stats && { median: stats.median, mean: stats.mean, p75: stats.p75, p90: stats.p90 }, ...waitDays(i.milestone, stats) };
      };
      const scope = i.deal_type ? (byType.get(i.deal_type) ?? []) : won;
      const stats = cycleStats(daysOf(scope));
      const wait = waitDays(i.milestone, stats);
      return {
        milestone: i.milestone,
        deal_type: i.deal_type ?? null,
        today,
        won_count: scope.length,
        stats: stats && { median: stats.median, mean: stats.mean, p75: stats.p75, p90: stats.p90 },
        ...wait,
        ...matureCutoff(today, wait.days),
        by_type: [...byType].map(([t, l]) => row(t, l)).sort((a, b) => a.type.localeCompare(b.type)),
      };
    },
  }),
];
