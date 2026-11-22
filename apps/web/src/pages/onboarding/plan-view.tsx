import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, ErrorText, Field, Modal, Select, Tabs, Textarea, Input } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Chip, CpChip, KIND_LABEL, OPS, PLAN_STATUS, addDays, fmtDate, fmtNum, planKey, progressKey, todayVn, usePlan, useProgress, type CondResult, type Item, type Occ, type PlanFull, type Progress, type ProgressCp, type Week } from "./common";

interface FlatOcc { occ: Occ; item: Item; week: number }
const flatten = (plan: PlanFull): FlatOcc[] =>
  plan.stages.flatMap((s) => s.weeks.flatMap((w) => w.items.flatMap((it) => (it.occurrences ?? []).map((occ) => ({ occ, item: it, week: w.week_no ?? 0 })))));

export type WeekState = "done" | "doing" | "future" | "late" | "break";
const WEEK_STATE: Record<WeekState, { label: string; cls: string }> = {
  done: { label: "Xong", cls: "bg-ok/15 text-ok" }, doing: { label: "Đang làm", cls: "bg-primary/10 text-primary" }, future: { label: "Chưa tới", cls: "bg-muted text-muted-foreground" },
  late: { label: "Trễ", cls: "bg-bad/10 text-bad" }, break: { label: "Nghỉ", cls: "bg-muted text-muted-foreground" },
};
export function weekState(plan: PlanFull, w: Week, today: string): WeekState {
  if (w.is_break) return "break";
  if (!plan.start_date) return "future";
  const start = addDays(plan.start_date, ((w.week_no ?? 1) - 1) * 7);
  const end = addDays(start, 6);
  if (today < start) return "future";
  const occs = w.items.flatMap((i) => i.occurrences ?? []);
  const open = occs.filter((o) => !o.done_at);
  if (today > end) return open.length ? "late" : "done";
  return "doing";
}

function useRefresh(planId: string) {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: planKey(planId) }), qc.invalidateQueries({ queryKey: progressKey(planId) }), qc.invalidateQueries({ queryKey: ["onb"] })]);
}

function CondLine({ c }: { c: CondResult }) {
  if (c.type === "manual") return <li className="text-sm">{c.label}: {c.met ? "đã xác nhận" : "chờ Leader xác nhận"}</li>;
  return (
    <li className="text-sm [overflow-wrap:anywhere]">
      <span className={c.met ? "text-ok" : ""}>{c.label}: <b>{fmtNum(c.value)}</b> {c.type === "metric" || c.type === "weighted" || c.type === "vs_items" ? `${OPS[c.op] ?? "≥"} ${fmtNum(c.threshold)}` : ""}</span>
      {c.note && <span className="text-bad"> ({c.note})</span>}
      {c.columns && <ul className="ml-4 list-disc text-xs text-muted-foreground">{c.columns.map((k) => <li key={k.field}>{k.field}: {fmtNum(k.avg)}{k.floor !== null ? ` (sàn ${fmtNum(k.floor)})` : ""}</li>)}</ul>}
    </li>
  );
}

function CpCard({ cp, manual, canConfirm, onConfirm, busy }: { cp: ProgressCp; manual: boolean; canConfirm: boolean; onConfirm: () => void; busy: boolean }) {
  return (
    <li className="rounded-lg border border-border bg-card p-3" data-testid="onb-cp">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium [overflow-wrap:anywhere]">{cp.name}</span>
        <CpChip status={cp.status} />
        {cp.week_no && <span className="text-xs text-muted-foreground">Tuần {cp.week_no}</span>}
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {cp.conditions.length === 0 && <li className="text-sm text-muted-foreground">Chưa tới tuần này.</li>}
        {cp.conditions.map((c, i) => <CondLine key={i} c={c} />)}
      </ul>
      {manual && cp.confirmed_at && <p className="mt-1 text-sm text-ok">Leader đã xác nhận.</p>}
      {manual && canConfirm && (
        <Button className="mt-2" variant="secondary" loading={busy} onClick={onConfirm} data-testid="cp-confirm">{cp.confirmed_at ? "Bỏ xác nhận" : "Xác nhận"}</Button>
      )}
    </li>
  );
}

function OccRow({ f, canTick, onTick, late }: { f: FlatOcc; canTick: boolean; onTick: (done: boolean) => void; late?: boolean }) {
  const { item, occ } = f;
  const done = !!occ.done_at;
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-card p-3" data-testid="onb-occ">
      <input type="checkbox" className="mt-1 size-5 shrink-0" checked={done} disabled={!canTick} aria-label={`Xong: ${item.name}`} onChange={(e) => onTick(e.target.checked)} data-testid="occ-tick" />
      <div className="min-w-0 flex-1">
        <div className={cn("font-medium [overflow-wrap:anywhere]", done && "text-muted-foreground line-through")}>{item.name}</div>
        <div className="text-xs text-muted-foreground">
          {[KIND_LABEL[item.kind] ?? item.kind, late ? `ngày ${fmtDate(occ.on_date)}` : null, item.due_time ? `hạn ${item.due_time}` : null, item.remind_before_min ? `nhắc trước ${item.remind_before_min} phút` : null].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {item.form_code && <a className="text-primary underline" href={`/f/${item.form_code}`} target="_blank" rel="noreferrer" data-testid="occ-form">{item.kind === "test" ? "Làm bài test" : "Mở form"}{item.form_name ? `: ${item.form_name}` : ""}</a>}
          {item.link && <a className="text-primary underline" href={item.link} target="_blank" rel="noreferrer">Mở link</a>}
        </div>
      </div>
    </li>
  );
}

function TodayTab({ plan, canTick, refresh }: { plan: PlanFull; canTick: boolean; refresh: () => Promise<unknown> }) {
  const today = todayVn();
  const all = flatten(plan);
  const now = all.filter((f) => f.occ.on_date === today);
  const late = all.filter((f) => f.occ.on_date < today && !f.occ.done_at);
  const tick = useMutation({ mutationFn: (v: { id: string; done: boolean }) => api("POST", `/onboarding/occurrences/${v.id}/tick`, { done: v.done }), onSuccess: refresh, onError: (e) => notify.error(e instanceof Error ? e.message : "Không lưu được.") });
  return (
    <div className="flex flex-col gap-5" data-testid="onb-today">
      <section>
        <h2 className="mb-2 text-base font-semibold">Hôm nay ({fmtDate(today)})</h2>
        {now.length === 0 ? <p className="text-sm text-muted-foreground">Hôm nay không có việc.</p> : <ul className="flex flex-col gap-2">{now.map((f) => <OccRow key={f.occ.id} f={f} canTick={canTick} onTick={(done) => tick.mutate({ id: f.occ.id, done })} />)}</ul>}
      </section>
      {late.length > 0 && (
        <section data-testid="onb-late">
          <h2 className="mb-2 text-base font-semibold text-bad">Việc trễ ({late.length})</h2>
          <ul className="flex flex-col gap-2">{late.map((f) => <OccRow key={f.occ.id} f={f} late canTick={canTick} onTick={(done) => tick.mutate({ id: f.occ.id, done })} />)}</ul>
        </section>
      )}
    </div>
  );
}

function JourneyTab({ plan, prog, manage, refresh }: { plan: PlanFull; prog: Progress | undefined; manage: boolean; refresh: () => Promise<unknown> }) {
  const today = todayVn();
  const [open, setOpen] = useState<number | null>(null);
  const brk = useMutation({ mutationFn: (v: { week_no: number; is_break: boolean }) => api("POST", `/onboarding/plans/${plan.id}/week-break`, v), onSuccess: refresh, onError: (e) => notify.error(e instanceof Error ? e.message : "Không lưu được.") });
  const cps = prog?.checkpoints ?? [];
  const canBreak = manage && plan.can_edit && plan.status === "active";
  return (
    <div className="flex flex-col gap-5" data-testid="onb-journey">
      {plan.stages.map((s, si) => (
        <section key={s.id ?? si}>
          <h2 className="mb-2 text-base font-semibold [overflow-wrap:anywhere]">{s.name}</h2>
          <ul className="flex flex-col gap-2">
            {s.weeks.map((w) => {
              const st = weekState(plan, w, today);
              const wc = cps.filter((c) => c.week_no === w.week_no && !c.is_final);
              const isOpen = open === w.week_no;
              return (
                <li key={w.week_no} className="rounded-lg border border-border bg-card" data-testid="onb-week" data-state={st}>
                  <button type="button" className="flex min-h-11 w-full flex-wrap items-center gap-2 p-3 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : (w.week_no ?? null))}>
                    <span className="font-medium [overflow-wrap:anywhere]">Tuần {w.week_no}: {w.name}</span>
                    <Chip cls={WEEK_STATE[st].cls}>{WEEK_STATE[st].label}</Chip>
                    {wc.length > 0 && <span className="text-xs text-muted-foreground">Checkpoint {wc.filter((c) => c.status === "passed" || c.status === "passed_late").length}/{wc.length}</span>}
                  </button>
                  {isOpen && (
                    <div className="border-t border-border p-3">
                      {w.goal && <p className="mb-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">Mục tiêu: {w.goal}</p>}
                      {w.items.length === 0 ? <p className="text-sm text-muted-foreground">Tuần này không có việc.</p> : (
                        <ul className="flex flex-col gap-1 text-sm">
                          {w.items.map((it, i) => {
                            const occ = it.occurrences ?? [];
                            const done = occ.filter((o) => o.done_at).length;
                            return <li key={it.id ?? i} className="[overflow-wrap:anywhere]">{it.name} <span className="text-xs text-muted-foreground">({KIND_LABEL[it.kind] ?? it.kind}{occ.length ? `, xong ${done}/${occ.length}` : ""})</span></li>;
                          })}
                        </ul>
                      )}
                      {wc.length > 0 && <ul className="mt-3 flex flex-col gap-2">{wc.map((c) => <li key={c.id} className="text-sm"><b>{c.name}</b> <CpChip status={c.status} /><ul>{c.conditions.map((k, i) => <CondLine key={i} c={k} />)}</ul></li>)}</ul>}
                      {canBreak && <Button className="mt-3" variant="secondary" loading={brk.isPending} onClick={() => brk.mutate({ week_no: w.week_no!, is_break: !w.is_break })} data-testid="week-break">{w.is_break ? "Bỏ tuần nghỉ" : "Đánh dấu tuần nghỉ"}</Button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MockupLinks({ plan }: { plan: PlanFull }) {
  const items = plan.stages.flatMap((s) => s.weeks.flatMap((w) => w.items.filter((i) => i.kind === "mockup" && i.form_code).map((i) => ({ w, i }))));
  if (items.length === 0 || !plan.staff_id) return null;
  const url = (it: Item) => `${window.location.origin}/f/${it.form_code}?nguoi_duoc_cham=${plan.staff_id}&buoi=${encodeURIComponent(it.name)}`;
  return (
    <section data-testid="onb-mockup-links">
      <h2 className="mb-2 text-base font-semibold">Link chấm mockup</h2>
      <ul className="flex flex-col gap-2">
        {items.map(({ w, i }) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Tuần {w.week_no}: {i.name}</span>
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(url(i)).then(() => notify.ok("Đã sao chép link chấm."), () => notify.error("Không sao chép được."))}>Sao chép link</Button>
            <a className="text-primary underline" href={url(i)} target="_blank" rel="noreferrer">Mở</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultsTab({ plan, prog, manage, refresh }: { plan: PlanFull; prog: Progress | undefined; manage: boolean; refresh: () => Promise<unknown> }) {
  const manualIds = new Set(plan.checkpoints.filter((c) => c.conditions.some((k) => k.type === "manual")).map((c) => c.id));
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useMutation({
    mutationFn: (v: { id: string; confirmed: boolean }) => api("POST", `/onboarding/checkpoints/${v.id}/confirm`, { confirmed: v.confirmed }),
    onSuccess: refresh, onSettled: () => setBusyId(null), onError: (e) => notify.error(e instanceof Error ? e.message : "Không lưu được."),
  });
  const all = plan.stages.flatMap((s) => s.weeks.flatMap((w) => w.items));
  const tables = new Map<string, { name: string; dh: string; table: string }>();
  for (const it of all) if (it.share_table && it.form_table_id && it.form_datahub_id) tables.set(it.form_table_id, { name: it.form_name ?? "Bảng", dh: it.form_datahub_id, table: it.form_table_id });
  const final = prog?.final ?? { result: plan.final_result, note: plan.final_note };
  const regular = (prog?.checkpoints ?? []).filter((c) => !c.is_final);
  const finals = (prog?.checkpoints ?? []).filter((c) => c.is_final);
  const render = (c: ProgressCp) => <CpCard key={c.id} cp={c} manual={manualIds.has(c.id)} canConfirm={manage && plan.can_edit && plan.status === "active"} busy={busyId === c.id && confirm.isPending} onConfirm={() => { setBusyId(c.id); confirm.mutate({ id: c.id, confirmed: !c.confirmed_at }); }} />;
  return (
    <div className="flex flex-col gap-5" data-testid="onb-results">
      <section>
        <h2 className="mb-2 text-base font-semibold">Checkpoint</h2>
        {regular.length === 0 ? <p className="text-sm text-muted-foreground">Lộ trình chưa có checkpoint.</p> : <ul className="flex flex-col gap-2">{regular.map(render)}</ul>}
      </section>
      <section data-testid="onb-final">
        <h2 className="mb-2 text-base font-semibold">Đánh giá cuối</h2>
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <p>{final.result === "passed" ? <Chip cls="bg-ok/15 text-ok">Đạt</Chip> : final.result === "failed" ? <Chip cls="bg-bad/10 text-bad">Không đạt</Chip> : <span className="text-muted-foreground">Chưa chốt.</span>}</p>
          {final.result && final.note && <p className="mt-1 [overflow-wrap:anywhere]">{final.note}</p>}
        </div>
        {finals.length > 0 && <ul className="mt-2 flex flex-col gap-2">{finals.map(render)}</ul>}
      </section>
      {tables.size > 0 && (
        <section data-testid="onb-tables">
          <h2 className="mb-2 text-base font-semibold">Bảng của tôi</h2>
          <ul className="flex flex-col gap-1 text-sm">{[...tables.values()].map((t) => <li key={t.table}><Link className="text-primary underline" to="/datahub/$datahubId/$tableId" params={{ datahubId: t.dh, tableId: t.table }}>{t.name}</Link></li>)}</ul>
        </section>
      )}
      {manage && <MockupLinks plan={plan} />}
    </div>
  );
}

function FinishDialog({ plan, onClose, refresh }: { plan: PlanFull; onClose: () => void; refresh: () => Promise<unknown> }) {
  const [result, setResult] = useState<"passed" | "failed">("passed");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({ mutationFn: () => api("POST", `/onboarding/plans/${plan.id}/finish`, { result, ...(note.trim() ? { note: note.trim() } : {}) }), onSuccess: async () => { await refresh(); notify.ok("Đã chốt đánh giá cuối."); onClose(); }, onError: (e) => setErr(e instanceof Error ? e.message : "Không lưu được.") });
  const [sure, setSure] = useState(false);
  return (
    <Modal title="Chốt đánh giá cuối" open onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Kết quả"><Select value={result} onChange={(e) => setResult(e.target.value as "passed" | "failed")} data-testid="finish-result"><option value="passed">Đạt</option><option value="failed">Không đạt</option></Select></Field>
        <Field label="Ghi chú" required={result === "failed"} error={err && result === "failed" && !note.trim() ? err : null}><Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} data-testid="finish-note" /></Field>
        {err && !(result === "failed" && !note.trim()) && <p className="text-sm text-bad" role="alert">{err}</p>}
        {sure && <p className="rounded-md bg-muted p-2 text-sm">Chốt rồi lộ trình chuyển Hoàn thành và không sửa được nữa. Chắc chắn?</p>}
        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          {!sure
            ? <Button onClick={() => { if (result === "failed" && !note.trim()) { setErr("Không đạt cần ghi chú lý do."); return; } setErr(null); setSure(true); }} data-testid="finish-next">Tiếp tục</Button>
            : <Button variant="danger" loading={m.isPending} onClick={() => m.mutate()} data-testid="finish-confirm">Chốt</Button>}
        </div>
      </div>
    </Modal>
  );
}

function StopDialog({ plan, onClose, refresh }: { plan: PlanFull; onClose: () => void; refresh: () => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const m = useMutation({ mutationFn: () => api("POST", `/onboarding/plans/${plan.id}/stop`, { reason: reason.trim() }), onSuccess: async () => { await refresh(); notify.ok("Đã dừng lộ trình."); onClose(); } });
  return (
    <Modal title="Dừng lộ trình" open onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Lý do dừng" required><Input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="stop-reason" /></Field>
        <ErrorText error={m.error} />
        <div className="flex justify-between gap-2"><Button variant="secondary" onClick={onClose}>Giữ lại</Button><Button variant="danger" disabled={!reason.trim()} loading={m.isPending} onClick={() => m.mutate()} data-testid="stop-confirm">Dừng</Button></div>
      </div>
    </Modal>
  );
}

/** One person's plan: Today, Journey, My results. `manage` adds what a Leader/Manager does on the same page. */
export function PlanView({ planId, manage = false }: { planId: string; manage?: boolean }) {
  const plan = usePlan(planId);
  const prog = useProgress(planId, plan.data?.status !== "draft" && !!plan.data?.staff_id);
  const refresh = useRefresh(planId);
  const [tab, setTab] = useState<"today" | "journey" | "results">("today");
  const [dlg, setDlg] = useState<"finish" | "stop" | null>(null);
  if (plan.isLoading) return <p className="text-sm text-muted-foreground">Đang tải...</p>;
  if (plan.error) return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  const p = plan.data;
  if (!p) return <EmptyState title="Không có lộ trình" />;
  const active = p.status === "active";
  return (
    <div data-testid="onb-plan-view">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{p.name}</h2>
        <Chip cls="bg-muted text-muted-foreground">{PLAN_STATUS[p.status] ?? p.status}</Chip>
        {p.start_date && <span className="text-xs text-muted-foreground">Bắt đầu {fmtDate(p.start_date)}/{p.start_date.slice(0, 4)}</span>}
        {prog.data && <span className="text-xs text-muted-foreground" data-testid="onb-progress-summary">Tuần {prog.data.current_week}/{prog.data.total_weeks} · Checkpoint {prog.data.checkpoints_passed}/{prog.data.checkpoints.length}</span>}
        {manage && p.can_edit && active && (
          <span className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => setDlg("stop")} data-testid="plan-stop">Dừng</Button>
            <Button onClick={() => setDlg("finish")} data-testid="plan-finish">Chốt đánh giá cuối</Button>
          </span>
        )}
      </div>
      {p.status === "stopped" && p.stop_reason && <p className="mb-3 text-sm text-muted-foreground">Lý do dừng: {p.stop_reason}</p>}
      <Tabs value={tab} onChange={setTab} items={[{ value: "today", label: "Hôm nay" }, { value: "journey", label: "Hành trình" }, { value: "results", label: manage ? "Kết quả" : "Kết quả của tôi" }]} />
      {prog.error && <ErrorText error={prog.error} />}
      {tab === "today" && <TodayTab plan={p} canTick={!manage && active} refresh={refresh} />}
      {tab === "journey" && <JourneyTab plan={p} prog={prog.data} manage={manage} refresh={refresh} />}
      {tab === "results" && <ResultsTab plan={p} prog={prog.data} manage={manage} refresh={refresh} />}
      {dlg === "finish" && <FinishDialog plan={p} onClose={() => setDlg(null)} refresh={refresh} />}
      {dlg === "stop" && <StopDialog plan={p} onClose={() => setDlg(null)} refresh={refresh} />}
    </div>
  );
}
