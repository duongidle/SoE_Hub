import { Check, ArrowUpRight, Flag } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CP_STATUS, CP_TONE, KIND_LABEL, KIND_TONE, OPS, Pill, dayLabel, fmtDate, fmtNum, todayVn, useJustPassed, type CondResult, type FlatOcc, type PlanFull, type ProgressCp } from "./common";

export function ProgressBar({ ratio, tone = "primary", className }: { ratio: number; tone?: "primary" | "ok" | "warn"; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className={cn("h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500", tone === "ok" ? "bg-ok-dot" : tone === "warn" ? "bg-warn-dot" : "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One task of one day: tick, kind, name, deadline, and the link to the form or test to do. */
export function TaskRow({ f, canTick, onTick, showDate }: { f: FlatOcc; canTick: boolean; onTick: (done: boolean) => void; showDate?: boolean }) {
  const { item, occ } = f;
  const done = !!occ.done_at;
  const [pop, setPop] = useState(false);
  const late = !done && occ.on_date < todayVn();
  const formLabel = item.kind === "test" ? "Làm bài test" : "Mở form";
  return (
    <li className="flex min-h-9 items-center gap-3 py-1.5" data-testid="onb-occ">
      <span className="relative inline-flex size-5 shrink-0">
        <input type="checkbox" className="peer absolute -inset-2.5 size-10 cursor-pointer opacity-0 disabled:cursor-default" checked={done} disabled={!canTick} aria-label={`Xong: ${item.name}`}
          onChange={(e) => { setPop(e.target.checked); onTick(e.target.checked); }} data-testid="occ-tick" />
        <span aria-hidden onAnimationEnd={() => setPop(false)} className={cn("pointer-events-none grid size-5 place-items-center rounded-md border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40", done ? "border-ok-dot bg-ok-dot text-white" : "border-faint/60 bg-card", pop && "onb-pop")}>
          {done && <Check size={13} strokeWidth={3} />}
        </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-2">
          <Pill tone={KIND_TONE[item.kind] ?? "neutral"} className="h-5 shrink-0 text-[11px]">{KIND_LABEL[item.kind] ?? item.kind}</Pill>
          <span className={cn("min-w-0 text-sm [overflow-wrap:anywhere]", done && "text-muted-foreground line-through")}>{item.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {(showDate || late) && <span className={cn("num", late && "font-medium text-bad")}>{late ? "Trễ · " : ""}{fmtDate(occ.on_date)}</span>}
          {item.due_time && <span className="num">hạn {item.due_time.slice(0, 5)}</span>}
          {item.form_code && <a className={cn("inline-flex min-h-6 items-center gap-0.5 text-sm font-medium", done ? "text-muted-foreground" : "text-primary")} href={`/f/${item.form_code}`} target="_blank" rel="noreferrer" data-testid="occ-form">{formLabel}{item.form_name ? `: ${item.form_name}` : ""}<ArrowUpRight size={13} aria-hidden /></a>}
          {item.link && <a className="inline-flex items-center gap-0.5 text-sm font-medium text-primary" href={item.link} target="_blank" rel="noreferrer">Mở link<ArrowUpRight size={13} aria-hidden /></a>}
        </div>
      </div>
    </li>
  );
}

/** Occurrences grouped by day (Thứ Hai 01/12), earliest first, deadline order inside a day. `limit` shows that many tasks first, then "Xem thêm". */
export function DayGroups({ list, canTick, onTick, limit }: { list: FlatOcc[]; canTick: boolean; onTick: (id: string, done: boolean) => void; limit?: number }) {
  const [all, setAll] = useState(false);
  const days = [...new Set(list.map((f) => f.occ.on_date))].sort();
  const cap = !limit || all ? Infinity : limit;
  const sorted = days.map((d) => ({ d, rows: list.filter((f) => f.occ.on_date === d).sort((a, b) => (a.item.due_time ?? "99").localeCompare(b.item.due_time ?? "99")) }));
  const shown = sorted.map((g, i) => ({ ...g, rows: g.rows.slice(0, Math.max(0, cap - sorted.slice(0, i).reduce((n, x) => n + x.rows.length, 0))) })).filter((g) => g.rows.length > 0);
  const hidden = list.length - shown.reduce((n, g) => n + g.rows.length, 0);
  return (
    <div className="flex flex-col divide-y divide-border-soft">
      {shown.map(({ d, rows }) => (
        <div key={d} className="px-4 py-2" data-testid="onb-day">
          <div className={cn("mb-0.5 text-[11px] font-medium", d === todayVn() ? "text-primary" : "text-muted-foreground")}>{dayLabel(d).toUpperCase()}{d === todayVn() ? " · HÔM NAY" : ""}</div>
          <ul>{rows.map((f) => <TaskRow key={f.occ.id} f={f} canTick={canTick} onTick={(done) => onTick(f.occ.id, done)} />)}</ul>
        </div>
      ))}
      {hidden > 0 && <button type="button" onClick={() => setAll(true)} className="px-4 py-2.5 text-left text-xs font-medium text-primary hover:bg-primary-soft" data-testid="onb-more">Xem thêm {hidden} việc</button>}
    </div>
  );
}

const AGG_LABEL: Record<string, string> = { count: "Số bản ghi đã nộp", sum: "Tổng", avg: "Trung bình", max: "Cao nhất", min: "Thấp nhất" };
/** The server names a condition without a label by its calculation ("count"): say it in words. */
export const condLabel = (c: CondResult) => AGG_LABEL[c.label] ?? c.label;
const ratioOf = (c: CondResult) => (c.threshold && c.threshold > 0 && c.value !== null && (c.op === "gte" || c.op === "gt") ? c.value / c.threshold : c.met ? 1 : 0);
const hasBar = (c: CondResult) => c.type !== "manual" && c.threshold !== null && (c.op === "gte" || c.op === "gt");

/** A condition of a checkpoint: what is asked, the value now against the threshold, and a bar. */
export function CondBar({ c }: { c: CondResult }) {
  if (c.type === "manual") return <div className="flex items-center justify-between gap-2 text-sm"><span>{c.label}</span><Pill tone={c.met ? "ok" : "neutral"}>{c.met ? "Đã xác nhận" : "Chờ Leader"}</Pill></div>;
  const r = ratioOf(c);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 [overflow-wrap:anywhere]">{condLabel(c)}</span>
        <span className="num shrink-0 font-semibold">{fmtNum(c.value)} <span className="font-normal text-muted-foreground">{OPS[c.op] ?? "≥"} {fmtNum(c.threshold)}</span></span>
      </div>
      {hasBar(c) && <ProgressBar className="mt-1.5" ratio={r} tone={c.met ? "ok" : r >= 0.7 ? "warn" : "primary"} />}
      {c.note && <div className="mt-1 text-xs text-bad">{c.note}</div>}
    </div>
  );
}

/** Links to the form or test a checkpoint is counted from (the item of the plan that uses the same form). Grading forms are the Leader's, so they are left out. */
export function cpLinks(plan: PlanFull, cpId: string): { code: string; label: string; name: string }[] {
  const pc = plan.checkpoints.find((c) => c.id === cpId);
  if (!pc) return [];
  const items = plan.stages.flatMap((s) => s.weeks.flatMap((w) => w.items)).filter((i) => i.form_id && i.form_code);
  const out = new Map<string, { code: string; label: string; name: string }>();
  for (const k of pc.conditions) {
    if (k.type === "manual" || k.type === "weighted" || !k.form_id) continue;
    const it = items.find((i) => i.form_id === k.form_id);
    if (it?.form_code) out.set(it.form_code, { code: it.form_code, label: it.kind === "test" ? "Làm bài test" : "Mở form", name: it.form_name ?? it.name });
  }
  return [...out.values()];
}

/** A checkpoint of a week in the side column: name, status, every condition against its threshold, and the links to do it. */
export function CpWeekCard({ cp, plan, flash }: { cp: ProgressCp; plan: PlanFull; flash?: boolean }) {
  const pop = useJustPassed(cp.status);
  const links = cpLinks(plan, cp.id);
  return (
    <div className={cn("rounded-md", (pop || flash) && "onb-pop")} data-testid="onb-cp-week">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Flag size={14} aria-hidden className="text-muted-foreground" />
        <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{cp.name}</span>
        <Pill tone={CP_TONE[cp.status] ?? "neutral"}>{(CP_STATUS[cp.status] ?? CP_STATUS.not_yet!).label}</Pill>
      </div>
      <div className="flex flex-col gap-3">
        {cp.conditions.length === 0 && <p className="text-xs text-muted-foreground">Chưa tới tuần này, giá trị hiện khi tuần bắt đầu.</p>}
        {cp.conditions.map((c, i) => <CondBar key={i} c={c} />)}
      </div>
      {links.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {links.map((l) => <a key={l.code} href={`/f/${l.code}`} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-0.5 text-sm font-medium text-primary" data-testid="cp-link">{l.label}: {l.name}<ArrowUpRight size={13} aria-hidden /></a>)}
        </div>
      )}
    </div>
  );
}
