import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, ChevronRight, Coffee, Flag, Play, CalendarCheck, MessagesSquare, NotebookPen, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/form";
import { Avatar } from "@/components/ui/person";
import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { CP_STATUS, CP_TONE, OPS, Pill, fmtDate, fmtNum, isPassed, buildWeeks, flatten, todayVn, useJustPassed, type FlatOcc, type PlanFull, type Progress, type ProgressCp, type WeekInfo } from "./common";
import { CpWeekCard, DayGroups, ProgressBar, condLabel } from "./parts";

const S_MIN = 60;
const PAD = 64;
const H = 300;
const FLAG_W = 116;

const smooth = (p: readonly (readonly [number, number])[]) =>
  p.map((q, i) => {
    if (!i) return `M${q[0]} ${q[1]}`;
    const a = p[i - 2] ?? p[i - 1]!, b = p[i - 1]!, c = q, d = p[i + 1] ?? q;
    return `C${b[0] + (c[0] - a[0]) / 6} ${b[1] + (c[1] - a[1]) / 6},${c[0] - (d[0] - b[0]) / 6} ${c[1] - (d[1] - b[1]) / 6},${c[0]} ${c[1]}`;
  }).join(" ");

const NODE: Record<string, string> = {
  done: "border-card bg-ok-dot text-white", late: "border-card bg-warn-dot text-white", doing: "border-card bg-primary text-white",
  future: "border-faint/60 bg-card text-muted-foreground", break: "border-dashed border-faint bg-muted text-muted-foreground",
};
const STATE_LABEL: Record<string, string> = { done: "đã xong", late: "trễ việc", doing: "đang ở", future: "chưa tới", break: "tuần nghỉ" };
const FLAG_TONE: Record<string, string> = {
  ok: "border-ok-border bg-ok-bg text-ok", info: "border-info-border bg-info-bg text-info", warn: "border-warn-border bg-warn-bg text-warn", bad: "border-bad-border bg-bad-bg text-bad", neutral: "border-border bg-card text-muted-foreground",
};

function FlagChip({ cp, x, y, onOpen }: { cp: ProgressCp; x: number; y: number; onOpen: () => void }) {
  const pop = useJustPassed(cp.status);
  return (
    <button type="button" onClick={onOpen} title={`${cp.name}: ${CP_STATUS[cp.status]?.label ?? ""}`} data-testid="onb-flag" data-status={cp.status}
      className={cn("absolute inline-flex min-h-6 items-start gap-1 rounded-2xl border px-2 py-[3px] text-left text-xs font-semibold leading-tight", FLAG_TONE[CP_TONE[cp.status] ?? "neutral"], pop && "onb-pop")}
      style={{ left: x - FLAG_W / 2, top: y, width: "auto", maxWidth: FLAG_W }}>
      <Flag size={12} aria-hidden className="mt-px shrink-0" /><span className="line-clamp-2 min-w-0 break-words">{cp.name}</span>
    </button>
  );
}

/** The road: one node per week along a curve, phases as background bands, flags for checkpoints, "you are here" on the current week. */
function Road({ weeks, cps, curNo, who, self, onOpen }: { weeks: WeekInfo[]; cps: ProgressCp[]; curNo: number | null; who: string; self: boolean; onOpen: (no: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setCw(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = weeks.length;
  const W = Math.max(cw, PAD * 2 + (n - 1) * S_MIN, 240);
  const step = n > 1 ? (W - PAD * 2) / (n - 1) : 0;
  const pts = useMemo(() => weeks.map((_, i) => [n === 1 ? W / 2 : PAD + i * step, 130 + 34 * Math.sin(i * 0.62 + 0.4)] as const), [weeks, n, W, step]);
  const curIdx = weeks.findIndex((w) => w.no === curNo);
  useEffect(() => {
    const el = box.current;
    if (!el || cw === 0) return;
    const i = curIdx >= 0 ? curIdx : Math.max(0, weeks.map((w) => w.state).lastIndexOf("done"));
    if (pts[i]) el.scrollLeft = Math.max(0, pts[i]![0] - el.clientWidth / 2);
  }, [curIdx, cw, pts, weeks]);
  const reached = (() => { let last = -1; weeks.forEach((w, i) => { if (w.state !== "future") last = i; }); return last; })();
  const stages = [...new Set(weeks.map((w) => w.stage))];
  const stageName = (si: number) => weeks.find((w) => w.stage === si)?.w;
  // Flags: each checkpoint hangs under its week (the final one under the last week), in the first row where it does not touch the one before.
  const flagRows = (() => {
    const list = cps.map((c) => ({ c, idx: c.is_final ? n - 1 : weeks.findIndex((w) => w.no === c.week_no) })).filter((x) => x.idx >= 0).sort((a, b) => a.idx - b.idx);
    const rowEnd: number[] = [];
    return list.map(({ c, idx }) => {
      const left = pts[idx]![0] - FLAG_W / 2;
      let r = rowEnd.findIndex((e) => e + 6 <= left);
      if (r < 0) r = rowEnd.length;
      rowEnd[r] = left + FLAG_W;
      return { c, idx, row: r };
    });
  })();
  return (
    <div ref={box} className="overflow-x-auto pb-2 contain-scroll" data-testid="onb-road">
      <div className="relative" style={{ width: W, height: H }}>
        <svg width={W} height={H} className="absolute inset-0" aria-hidden>
          {stages.map((si, k) => {
            const idx = weeks.map((w, i) => (w.stage === si ? i : -1)).filter((i) => i >= 0);
            const xa = pts[idx[0]!]![0] - (n > 1 ? Math.min(26, step / 2) : 26), xb = pts[idx[idx.length - 1]!]![0] + (n > 1 ? Math.min(26, step / 2) : 26);
            return <rect key={si} x={xa} y={8} width={xb - xa} height={H - 16} rx={14} style={{ fill: k % 2 ? "var(--background)" : "var(--workspace)" }} />;
          })}
          {n > 1 && <path d={smooth(pts)} fill="none" strokeWidth={10} strokeLinecap="round" style={{ stroke: "var(--border)" }} />}
          {n > 1 && <path d={smooth(pts)} fill="none" strokeWidth={2} strokeDasharray="2 8" strokeLinecap="round" style={{ stroke: "var(--card)" }} />}
          {reached >= 1 && <path d={smooth(pts.slice(0, reached + 1))} fill="none" strokeWidth={10} strokeLinecap="round" style={{ stroke: "var(--primary)", opacity: 0.85 }} />}
        </svg>
        {stages.map((si) => {
          const idx = weeks.map((w, i) => (w.stage === si ? i : -1)).filter((i) => i >= 0);
          const xa = pts[idx[0]!]![0] - (n > 1 ? Math.min(26, step / 2) : 26);
          const xb = pts[idx[idx.length - 1]!]![0] + (n > 1 ? Math.min(26, step / 2) : 26);
          return <div key={si} className="absolute truncate text-xs font-semibold text-muted-foreground" style={{ left: xa + 12, top: 18, maxWidth: Math.max(40, xb - xa - 20) }} title={stageName(si) ? `Giai đoạn ${si + 1}` : undefined}>GIAI ĐOẠN {si + 1}</div>;
        })}
        {weeks.map((w, i) => {
          const [x, y] = pts[i]!;
          const cur = w.no === curNo;
          return (
            <div key={w.no}>
              <button type="button" onClick={() => onOpen(w.no)} data-testid="onb-week" data-state={w.state} aria-current={cur ? "step" : undefined}
                aria-label={`Tuần ${w.no}: ${w.w.name}, ${STATE_LABEL[w.state]}`}
                className={cn("absolute grid size-7 place-items-center rounded-full border-2 text-xs font-bold shadow-md motion-safe:transition-transform motion-safe:hover:scale-110", NODE[w.state])} style={{ left: x - 14, top: y - 14 }}>
                {cur && <span aria-hidden className="absolute -inset-[7px] rounded-full border-2 border-primary-border" />}
                {w.state === "done" ? <Check size={14} strokeWidth={3} aria-hidden /> : w.state === "late" ? <AlertTriangle size={13} strokeWidth={2.5} aria-hidden /> : w.state === "break" ? <Coffee size={13} aria-hidden /> : <span className="num">{w.no}</span>}
              </button>
              <div className="num absolute text-center text-xs text-muted-foreground" style={{ left: x - 16, width: 32, top: y + 18 }}>T{w.no}</div>
              {cur && (
                <div className="absolute" style={{ left: x - 62, top: y - 54 }}>
                  <div className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary-border bg-card py-1 pl-1 pr-2.5 text-xs font-semibold shadow-md">
                    <Avatar name={who} className="!size-5 !bg-primary !text-white" />{self ? "Bạn đang ở đây" : "Đang ở đây"}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {flagRows.map(({ c, idx, row }) => <FlagChip key={c.id} cp={c} x={pts[idx]![0]} y={pts[idx]![1] + 38 + row * 42} onOpen={() => onOpen(weeks[idx]!.no)} />)}
      </div>
    </div>
  );
}

function Legend() {
  const d = (cls: string) => <span aria-hidden className={cn("size-2.5 rounded-full", cls)} />;
  return (
    <div className="hidden flex-wrap items-center gap-3 text-xs text-muted-foreground sm:flex">
      <span className="flex items-center gap-1.5">{d("bg-ok-dot")}Đã qua</span>
      <span className="flex items-center gap-1.5">{d("bg-warn-dot")}Trễ</span>
      <span className="flex items-center gap-1.5">{d("bg-primary")}Đang ở</span>
      <span className="flex items-center gap-1.5">{d("border border-faint/60")}Chưa tới</span>
      <span className="flex items-center gap-1.5"><Flag size={12} aria-hidden />Checkpoint</span>
    </div>
  );
}

function WeekDrawer({ info, plan, cps, canTick, canBreak, breakBusy, onBreak, onTick, onClose }: { info: WeekInfo; plan: PlanFull; cps: ProgressCp[]; canTick: boolean; canBreak: boolean; breakBusy: boolean; onBreak: () => void; onTick: (id: string, done: boolean) => void; onClose: () => void }) {
  const occ: FlatOcc[] = flatten(plan).filter((f) => f.week === info.no);
  const wc = cps.filter((c) => c.week_no === info.no && !c.is_final);
  return (
    <Drawer open onClose={onClose} title={`Tuần ${info.no}: ${info.w.name}`} width="sm:w-[480px]">
      <div data-testid="onb-week-drawer" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Pill tone={info.state === "done" ? "ok" : info.state === "late" ? "bad" : info.state === "doing" ? "info" : "neutral"}>{cap(STATE_LABEL[info.state] ?? "")}</Pill>
          {info.start && info.end && <span className="num text-muted-foreground">{fmtDate(info.start)} – {fmtDate(info.end)}</span>}
          {info.total > 0 && <Pill tone="info" className="num">{info.done}/{info.total} việc</Pill>}
        </div>
        {info.w.goal && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">Mục tiêu: {info.w.goal}</p>}
        <section>
          <h3 className="mb-1 text-sm font-semibold">Việc trong tuần</h3>
          {occ.length > 0 ? <div className="-mx-5"><DayGroups list={occ} canTick={canTick} onTick={onTick} /></div>
            : info.w.items.length === 0 ? <p className="text-sm text-muted-foreground">Tuần này không có việc.</p>
            : <ul className="flex flex-col gap-1 text-sm">{info.w.items.map((it, i) => <li key={it.id ?? i} className="[overflow-wrap:anywhere]">{it.name}</li>)}</ul>}
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Checkpoint của tuần</h3>
          {wc.length === 0 ? <p className="text-sm text-muted-foreground">Tuần này không có checkpoint.</p> : <div className="flex flex-col gap-4">{wc.map((c) => <CpWeekCard key={c.id} cp={c} plan={plan} />)}</div>}
        </section>
        {canBreak && <Button variant="secondary" loading={breakBusy} onClick={onBreak} data-testid="week-break">{info.w.is_break ? "Bỏ tuần nghỉ" : "Đánh dấu tuần nghỉ"}</Button>}
      </div>
    </Drawer>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ICON = (kind: string, name: string) => (kind === "on_job" ? NotebookPen : /q&a|hỏi/i.test(name) ? MessagesSquare : /báo cáo/i.test(name) ? CalendarCheck : Table2);

export function JourneyTab({ plan, prog, manage, canTick, canBreak, breakBusy, onBreak, onTick, goToday, who }: {
  plan: PlanFull; prog: Progress | undefined; manage: boolean; canTick: boolean; canBreak: boolean; breakBusy: boolean; onBreak: (no: number, isBreak: boolean) => void; onTick: (id: string, done: boolean) => void; goToday: () => void; who: string;
}) {
  const today = todayVn();
  const weeks = useMemo(() => buildWeeks(plan, today), [plan, today]);
  const [open, setOpen] = useState<number | null>(null);
  const flat = useMemo(() => flatten(plan), [plan]);
  const cps: ProgressCp[] = prog?.checkpoints ?? plan.checkpoints.map((c) => ({ id: c.id ?? "", week_no: c.week_no ?? null, name: c.name, is_final: c.is_final, group: c.group ?? "", status: "not_yet", conditions: [], confirmed_at: c.confirmed_at ?? null }));
  const N = weeks.length;
  const started = !!plan.start_date && today >= plan.start_date;
  const curNo = plan.status === "active" ? (weeks.find((w) => w.state === "doing")?.no ?? null) : null;
  const focusNo = curNo ?? (started ? N : 1);
  const focus = weeks.find((w) => w.no === focusNo);
  const done = flat.filter((f) => f.occ.done_at).length;
  const pct = flat.length ? Math.round((done / flat.length) * 100) : 0;

  const pending = cps.filter((c) => !c.is_final && !isPassed(c.status)).sort((a, b) => (a.week_no ?? 99) - (b.week_no ?? 99));
  const next = pending.find((c) => (c.week_no ?? 0) >= (curNo ?? 0)) ?? pending[0] ?? cps.find((c) => c.is_final && !isPassed(c.status));
  const nextWeek = next ? (next.is_final ? N : (next.week_no ?? focusNo)) : focusNo;
  const nextWeekInfo = weeks.find((w) => w.no === nextWeek);
  const unmet = next ? next.conditions.filter((c) => !c.met) : [];
  const openOcc = flat.filter((f) => !f.occ.done_at && f.week === nextWeek);
  const missing = unmet.length || openOcc.length;
  const missingText = unmet.length
    ? unmet.map((c) => (c.type === "manual" ? "Leader xác nhận" : `${condLabel(c)} (${fmtNum(c.value)} ${OPS[c.op] ?? "≥"} ${fmtNum(c.threshold)})`)).join("; ")
    : openOcc.length ? `việc tuần ${nextWeek} chưa xong` : "";
  const actOcc = flat.filter((f) => !f.occ.done_at && f.item.form_code && (f.week === nextWeek || f.week === focusNo)).sort((a, b) => a.occ.on_date.localeCompare(b.occ.on_date))[0];

  const weekOcc = flat.filter((f) => f.week === focusNo);
  const focusCps = cps.filter((c) => c.week_no === focusNo && !c.is_final);
  const past = cps.filter((c) => c.status === "passed" || c.status === "passed_late" || c.status === "failed").sort((a, b) => (a.week_no ?? 99) - (b.week_no ?? 99));
  const tables = new Map<string, { name: string; dh: string; table: string; kind: string; itemName: string; done: number; total: number }>();
  for (const f of flat) {
    const it = f.item;
    if (!it.share_table || !it.form_table_id || !it.form_datahub_id) continue;
    const t = tables.get(it.form_table_id) ?? { name: it.form_name ?? "Bảng", dh: it.form_datahub_id, table: it.form_table_id, kind: it.kind, itemName: it.name, done: 0, total: 0 };
    t.total += 1; if (f.occ.done_at) t.done += 1;
    tables.set(it.form_table_id, t);
  }
  const openInfo = weeks.find((w) => w.no === open) ?? null;
  const phase = focus ? plan.stages[focus.stage]?.name : "";

  if (N === 0) return <p className="rounded-card border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="onb-journey">Lộ trình chưa có tuần nào.</p>;
  return (
    <div className="flex flex-col gap-4" data-testid="onb-journey">
      <section className="grid gap-4 rounded-card border border-border bg-card p-5 shadow-card lg:grid-cols-[1fr_1.3fr_auto] lg:items-center" data-testid="onb-hero">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-muted-foreground">{curNo ? "BẠN ĐANG Ở" : started ? "ĐÃ QUA TUẦN CUỐI" : "CHƯA BẮT ĐẦU"}</div>
          <div className="mt-0.5 flex items-baseline gap-1.5"><span className="num text-2xl font-semibold leading-none" data-testid="onb-hero-week">{curNo ? `Tuần ${curNo}` : started ? `Tuần ${N}` : "Sắp tới"}</span><span className="num text-base text-muted-foreground">/ {N}</span></div>
          <div className="mt-0.5 text-sm [overflow-wrap:anywhere]">{phase}{focus ? ` · ${focus.w.name}` : ""}</div>
          <ProgressBar className="mt-3 !h-[3px]" ratio={pct / 100} />
          <div className="num mt-1.5 text-xs text-muted-foreground" data-testid="onb-progress-summary">{pct}% việc đã xong ({done}/{flat.length}){plan.start_date ? ` · bắt đầu ${fmtDate(plan.start_date)}/${plan.start_date.slice(0, 4)}` : ""} · Checkpoint {prog?.checkpoints_passed ?? 0}/{cps.length}</div>
        </div>
        {next ? (
          <div className="flex min-w-0 items-start gap-3 rounded-lg bg-primary-soft p-4" data-testid="onb-next">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-white"><Flag size={20} /></span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-primary">MỐC TIẾP THEO{nextWeekInfo?.end ? ` · HẠN ${fmtDate(nextWeekInfo.end)}` : ""}</div>
              <div className="mt-0.5 text-base font-semibold [overflow-wrap:anywhere]">{next.name}</div>
              <div className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{missing > 0 ? <>Còn <b className="text-foreground">{missing} {unmet.length ? "điều kiện" : "việc"}</b>: {missingText}.</> : "Mọi điều kiện đã đủ, chờ hệ thống ghi nhận."}</div>
            </div>
          </div>
        ) : <div className="rounded-lg bg-ok-bg p-4 text-sm text-ok" data-testid="onb-next">Đã qua hết các mốc checkpoint.</div>}
        {!manage && (
          <div className="flex gap-2 lg:justify-end">
            {actOcc ? <a href={`/f/${actOcc.item.form_code}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary-hover sm:min-h-9" data-testid="onb-primary"><Play size={14} aria-hidden />{actOcc.item.kind === "test" ? "Làm bài test" : "Mở form"}</a>
              : <Button onClick={goToday} data-testid="onb-primary">Việc hôm nay</Button>}
          </div>
        )}
      </section>

      <section className="rounded-card border border-border bg-card p-5 shadow-card">
        <div className="mb-1 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Hành trình {N} tuần</h2><Legend /></div>
        <Road weeks={weeks} cps={cps} curNo={curNo} who={manage ? (plan.staff_name ?? "") || "Nhân sự" : who} self={!manage} onOpen={setOpen} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="rounded-card border border-border bg-card shadow-card" data-testid="onb-week-tasks">
          <div className="flex items-start justify-between gap-3 border-b border-border-soft px-5 pb-3 pt-4">
            <div className="min-w-0">
              <div className="num text-xs font-semibold text-primary">TUẦN {focusNo}{focus?.start && focus.end ? ` · ${fmtDate(focus.start)} – ${fmtDate(focus.end)}` : ""}</div>
              <h2 className="mt-0.5 text-base font-semibold [overflow-wrap:anywhere]">{focus?.w.name}</h2>
              {focus?.w.goal && <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">Mục tiêu: {focus.w.goal}</p>}
            </div>
            {weekOcc.length > 0 && <Pill tone="info" className="num">{weekOcc.filter((f) => f.occ.done_at).length}/{weekOcc.length} việc</Pill>}
          </div>
          {weekOcc.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">{focus?.w.is_break ? "Tuần nghỉ, không có việc." : "Tuần này chưa có việc nào."}</p> : <DayGroups list={weekOcc} canTick={canTick} onTick={onTick} />}
        </section>

        <div className="flex flex-col gap-4">
          <section className="rounded-card border border-border bg-card p-5 shadow-card">
            <h2 className="mb-3 text-base font-semibold">Checkpoint tuần {focusNo}</h2>
            {focusCps.length === 0 ? <p className="text-sm text-muted-foreground">Tuần này không có checkpoint.</p> : <div className="flex flex-col gap-4">{focusCps.map((c) => <CpWeekCard key={c.id} cp={c} plan={plan} />)}</div>}
          </section>
          <section className="rounded-card border border-border bg-card p-5 shadow-card" data-testid="onb-past">
            <h2 className="text-base font-semibold">Các mốc đã qua</h2>
            {past.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Chưa có mốc nào.</p> : (
              <ul className="mt-2 divide-y divide-border-soft text-sm">
                {past.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 py-2.5"><span className="min-w-0 [overflow-wrap:anywhere]">{c.week_no ? `T${c.week_no} · ` : ""}{c.name}</span><Pill tone={CP_TONE[c.status] ?? "neutral"}>{CP_STATUS[c.status]?.label}</Pill></li>)}
              </ul>
            )}
          </section>
          {tables.size > 0 && (
            <section className="rounded-card border border-border bg-card p-5 shadow-card" data-testid="onb-shortcuts">
              <h2 className="text-base font-semibold">Lối tắt</h2>
              <div className="mt-2 flex flex-col gap-1">
                {[...tables.values()].map((t) => {
                  const I = ICON(t.kind, t.itemName);
                  return (
                    <Link key={t.table} to="/datahub/$datahubId/$tableId" params={{ datahubId: t.dh, tableId: t.table }} className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-primary-soft">
                      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-soft text-primary"><I size={16} /></span>
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium [overflow-wrap:anywhere]">{t.name}</span><span className="num block text-xs text-muted-foreground">đã xong {t.done}/{t.total} việc</span></span>
                      <ChevronRight size={16} aria-hidden className="text-faint" />
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {openInfo && <WeekDrawer info={openInfo} plan={plan} cps={cps} canTick={canTick} canBreak={canBreak} breakBusy={breakBusy} onBreak={() => onBreak(openInfo.no, !openInfo.w.is_break)} onTick={onTick} onClose={() => setOpen(null)} />}
    </div>
  );
}
