import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { api, ApiError } from "@/lib/api";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";

export const KIND_LABEL: Record<string, string> = {
  session: "Session", session_cs: "Session với CS", session_sale: "Session với Sale", test: "Test", mockup: "Mockup", review_1_1: "Review 1-1", on_job: "On-job", self_study: "Tự học", off: "Nghỉ", other: "Khác",
};
export const WEEKDAY_LABEL = ["", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];
export const GROUP_LABEL: Record<string, string> = { test: "Test", mockup: "Mockup", on_job: "On-job", qna: "Q&A", daily: "Báo cáo ngày", other: "Khác" };
export const CP_STATUS: Record<string, { label: string; cls: string }> = {
  not_yet: { label: "Chưa tới", cls: "bg-muted text-muted-foreground" },
  running: { label: "Đang chạy", cls: "bg-primary/10 text-primary" },
  passed: { label: "Đạt", cls: "bg-ok/15 text-ok" },
  passed_late: { label: "Đạt muộn", cls: "bg-ok/15 text-ok" },
  failed: { label: "Chưa đạt", cls: "bg-bad/10 text-bad" },
};
export const PLAN_STATUS: Record<string, string> = { draft: "Nháp", active: "Đang chạy", completed: "Hoàn thành", stopped: "Đã dừng" };

export interface Occ { id: string; on_date: string; due_at: string | null; done_at: string | null }
export interface Item {
  id?: string; name: string; description?: string | null; kind: string; weekday: number; repeat: string; until_week_no?: number | null; due_time?: string | null; remind_before_min?: number | null;
  form_id?: string | null; need_form?: boolean; share_table?: boolean; filler_column?: string | null; leader_columns?: string[] | null; link?: string | null;
  occurrences?: Occ[]; form_code?: string | null; form_name?: string | null; form_table_id?: string | null; form_datahub_id?: string | null;
}
export interface Week { week_no?: number; name: string; goal?: string | null; is_break: boolean; items: Item[] }
export interface Stage { id?: string; name: string; weeks: Week[] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Cond = Record<string, any> & { type: "metric" | "weighted" | "vs_items" | "manual" };
export interface Cp { id?: string; week_no?: number | null; name: string; is_final: boolean; group?: string | null; conditions: Cond[]; confirmed_at?: string | null }
export interface PlanFull {
  id: string; name: string; owner_id: string; status: string; staff_id: string | null; staff_name?: string | null; start_date: string | null; followers: string[]; is_template: boolean; final_result: string | null; final_note: string | null;
  stages: Stage[]; checkpoints: Cp[]; can_edit: boolean; version: number; stop_reason?: string | null; occurrences_total?: number; occurrences_done?: number; weeks?: number;
}
export interface CondResult { type: string; label: string; value: number | null; op: string; threshold: number | null; met: boolean; columns?: { field: string; avg: number | null; weight: number; floor: number | null; met: boolean }[]; note?: string }
export interface ProgressCp { id: string; week_no: number | null; name: string; is_final: boolean; group: string; status: string; conditions: CondResult[]; confirmed_at: string | null }
export interface Progress {
  plan_id: string; staff_id: string; status: string; start_date: string; current_week: number; total_weeks: number; checkpoints: ProgressCp[]; checkpoints_passed: number;
  items_by_kind: Record<string, { total: number; done: number; overdue: number }>; final: { result: string | null; note: string | null }; can_edit: boolean;
}

export const planKey = (id: string) => ["onb", "plan", id] as const;
export const progressKey = (id: string) => ["onb", "progress", id] as const;
export const usePlan = (id: string | undefined) => useQuery({ queryKey: planKey(id ?? ""), enabled: !!id, queryFn: () => api<PlanFull>("GET", `/onboarding/plans/${id}`) });
export const useProgress = (id: string | undefined, enabled = true) => useQuery({ queryKey: progressKey(id ?? ""), enabled: !!id && enabled, queryFn: () => api<Progress>("GET", `/onboarding/plans/${id}/progress`) });
export const usePlans = (scope: "mine" | "template" | "following" | "team") => useQuery({ queryKey: ["onb", "plans", scope], queryFn: () => api<PlanFull[]>("GET", `/onboarding/plans?scope=${scope}`) });

/** Today in Vietnam (YYYY-MM-DD): the dates of the plan are Vietnam dates. */
export const todayVn = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? "-" : String(Math.round(n * 100) / 100).replace(".", ","));
export const OPS: Record<string, string> = { gte: "≥", gt: ">", lte: "≤", lt: "<", eq: "=" };

/** Message of a field of the form that the server refused (zod issues carry a dotted path). */
export function issueAt(error: unknown, path: string): string | null {
  if (!(error instanceof ApiError)) return null;
  const issues = (error.details?.issues as { path: string; message: string }[] | undefined) ?? [];
  return issues.find((i) => i.path === path)?.message ?? null;
}

export function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", cls)}>{children}</span>;
}
export function CpChip({ status }: { status: string }) {
  const s = CP_STATUS[status] ?? CP_STATUS.not_yet!;
  return <Chip cls={s.cls}>{s.label}</Chip>;
}

export type Tone = "ok" | "info" | "warn" | "bad" | "ai" | "neutral";
const TONE: Record<Tone, string> = {
  ok: "border-ok-border bg-ok-bg text-ok", info: "border-info-border bg-info-bg text-info", warn: "border-warn-border bg-warn-bg text-warn", bad: "border-bad-border bg-bad-bg text-bad",
  ai: "border-ai-border bg-ai-bg text-ai", neutral: "border-border bg-muted text-muted-foreground",
};
/** Small coloured label: colour by meaning (green done, blue running, amber waiting, red late, purple special). */
export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-semibold", TONE[tone], className)}>{children}</span>;
}
export const CP_TONE: Record<string, Tone> = { not_yet: "neutral", running: "info", passed: "ok", passed_late: "warn", failed: "bad" };
export const KIND_TONE: Record<string, Tone> = { on_job: "ok", self_study: "neutral", session: "info", session_cs: "info", session_sale: "info", review_1_1: "ai", test: "warn", mockup: "ai", off: "neutral", other: "neutral" };
export const isPassed = (s: string) => s === "passed" || s === "passed_late";

/** Segmented control (role tab, so a screen reader and a test read it as tabs). */
export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md bg-muted p-[3px]">
      {items.map((i) => (
        <button key={i.value} type="button" role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)}
          className={cn("min-h-10 whitespace-nowrap rounded-[8px] px-3.5 text-sm font-medium transition-colors sm:min-h-8", value === i.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** True for a moment after a checkpoint turns to passed (a small reaction; the global reduced-motion rule shortens it). */
export function useJustPassed(status: string): boolean {
  const prev = useRef(status);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (!isPassed(was) && isPassed(status)) {
      setOn(true);
      const t = setTimeout(() => setOn(false), 900);
      return () => clearTimeout(t);
    }
  }, [status]);
  return on;
}

export interface FlatOcc { occ: Occ; item: Item; week: number }
export const flatten = (plan: PlanFull): FlatOcc[] =>
  plan.stages.flatMap((s) => s.weeks.flatMap((w, wi) => w.items.flatMap((it) => (it.occurrences ?? []).map((occ) => ({ occ, item: it, week: w.week_no ?? wi + 1 })))));

export type WeekState = "done" | "doing" | "future" | "late" | "break";
export interface WeekInfo { no: number; w: Week; stage: number; state: WeekState; start: string | null; end: string | null; done: number; total: number }
/** Every week of the plan in order, with its dates and state. Week numbers are the order in the plan (the server numbers them the same way). */
export function buildWeeks(plan: PlanFull, today: string): WeekInfo[] {
  let no = 0;
  return plan.stages.flatMap((s, si) => s.weeks.map((w) => {
    no += 1;
    const start = plan.start_date ? addDays(plan.start_date, (no - 1) * 7) : null;
    const end = start ? addDays(start, 6) : null;
    const occs = w.items.flatMap((i) => i.occurrences ?? []);
    let state: WeekState;
    if (w.is_break) state = "break";
    else if (!start || !end || today < start) state = "future";
    else if (today > end) state = occs.some((o) => !o.done_at) ? "late" : "done";
    else state = "doing";
    return { no, w, stage: si, state, start, end, done: occs.filter((o) => o.done_at).length, total: occs.length };
  }));
}
export const dayOf = (d: string) => { const x = new Date(`${d}T00:00:00Z`).getUTCDay(); return x === 0 ? 7 : x; };
export const dayLabel = (d: string) => `${WEEKDAY_LABEL[dayOf(d)]} ${fmtDate(d)}`;

/** Page-level menu of Onboarding: only drawn when there is more than one place to go. */
export function OnbNav({ active }: { active: "me" | "follow" | "plans" }) {
  const me = useMe().data;
  const manage = can(me, "onboarding:path:create");
  const mine = usePlans("mine");
  const following = usePlans("following");
  const hasOwn = (mine.data ?? []).some((p) => p.staff_id === me?.user.id);
  const link = (to: string, label: string, on: boolean, testid: string) => (
    <Link key={to} to={to} data-testid={testid} aria-current={on ? "page" : undefined} className={cn("inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-3 text-sm", on ? "bg-primary-soft font-semibold text-primary" : "text-muted-foreground hover:bg-primary-soft hover:text-foreground")}>{label}</Link>
  );
  const links = [
    (hasOwn || !manage) && link("/onboarding", "Của tôi", active === "me", "onb-nav-me"),
    (manage || (following.data ?? []).length > 0) && link("/onboarding/theo-doi", "Theo dõi", active === "follow", "onb-nav-follow"),
    manage && link("/onboarding/lo-trinh", "Lộ trình", active === "plans", "onb-nav-plans"),
  ].filter(Boolean);
  if (links.length < 2) return null;
  return <nav aria-label="Onboarding" className="mb-4 flex gap-1 overflow-x-auto" data-testid="onb-nav">{links}</nav>;
}
