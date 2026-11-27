import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Button, ErrorText, Field, Input, Modal, Select, Textarea } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useUrlState } from "@/lib/use-url-state";
import { useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CP_TONE, Chip, OPS, PLAN_STATUS, Pill, Segmented, flatten, fmtDate, fmtNum, isPassed, planKey, progressKey, todayVn, usePlan, useProgress, useJustPassed, type CondResult, type Item, type PlanFull, type Progress, type ProgressCp } from "./common";
import { JourneyTab } from "./journey";
import { ProgressBar, TaskRow, condLabel, cpLinks } from "./parts";

function useRefresh(planId: string) {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: planKey(planId) }), qc.invalidateQueries({ queryKey: progressKey(planId) }), qc.invalidateQueries({ queryKey: ["onb"] })]);
}

function CondLine({ c }: { c: CondResult }) {
  if (c.type === "manual") return <li className="text-sm">{c.label}: {c.met ? "đã xác nhận" : "chờ Leader xác nhận"}</li>;
  const bar = c.threshold !== null && c.threshold > 0 && c.value !== null && (c.op === "gte" || c.op === "gt");
  return (
    <li className="text-sm [overflow-wrap:anywhere]">
      <span className={c.met ? "text-ok" : ""}>{condLabel(c)}: <b>{fmtNum(c.value)}</b> {c.type === "metric" || c.type === "weighted" || c.type === "vs_items" ? `${OPS[c.op] ?? "≥"} ${fmtNum(c.threshold)}` : ""}</span>
      {c.note && <span className="text-bad"> ({c.note})</span>}
      {bar && <ProgressBar className="mt-1 !h-1.5" ratio={c.value! / c.threshold!} tone={c.met ? "ok" : "primary"} />}
      {c.columns && <ul className="ml-4 mt-1 list-disc text-xs text-muted-foreground">{c.columns.map((k) => <li key={k.field}>{k.field}: {fmtNum(k.avg)}{k.floor !== null ? ` (sàn ${fmtNum(k.floor)})` : ""}</li>)}</ul>}
    </li>
  );
}

function CpCard({ cp, plan, manual, canConfirm, onConfirm, busy }: { cp: ProgressCp; plan: PlanFull; manual: boolean; canConfirm: boolean; onConfirm: () => void; busy: boolean }) {
  const pop = useJustPassed(cp.status);
  const links = cpLinks(plan, cp.id);
  return (
    <li className={cn("rounded-card border border-border bg-card p-4 shadow-card", pop && "onb-pop")} data-testid="onb-cp">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium [overflow-wrap:anywhere]">{cp.name}</span>
        <Pill tone={CP_TONE[cp.status] ?? "neutral"}>{cp.status === "passed" ? "Đạt" : cp.status === "passed_late" ? "Đạt muộn" : cp.status === "failed" ? "Chưa đạt" : cp.status === "running" ? "Đang chạy" : "Chưa tới"}</Pill>
        {cp.week_no && <span className="text-xs text-muted-foreground">Tuần {cp.week_no}</span>}
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {cp.conditions.length === 0 && <li className="text-sm text-muted-foreground">Chưa tới tuần này.</li>}
        {cp.conditions.map((c, i) => <CondLine key={i} c={c} />)}
      </ul>
      {manual && cp.confirmed_at && <p className="mt-1 text-sm text-ok">Leader đã xác nhận.</p>}
      {links.length > 0 && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{links.map((l) => <a key={l.code} href={`/f/${l.code}`} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center text-[13px] font-medium text-primary">{l.label}: {l.name}</a>)}</div>}
      {manual && canConfirm && (
        <Button className="mt-2" variant="secondary" loading={busy} onClick={onConfirm} data-testid="cp-confirm">{cp.confirmed_at ? "Bỏ xác nhận" : "Xác nhận"}</Button>
      )}
    </li>
  );
}

function TodayTab({ plan, canTick, onTick, goJourney }: { plan: PlanFull; canTick: boolean; onTick: (id: string, done: boolean) => void; goJourney: () => void }) {
  const today = todayVn();
  const all = flatten(plan);
  const now = all.filter((f) => f.occ.on_date === today).sort((a, b) => (a.item.due_time ?? "99").localeCompare(b.item.due_time ?? "99"));
  const late = all.filter((f) => f.occ.on_date < today && !f.occ.done_at).sort((a, b) => a.occ.on_date.localeCompare(b.occ.on_date));
  const doneNow = now.filter((f) => f.occ.done_at).length;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]" data-testid="onb-today">
      <section className="rounded-card border border-border bg-card shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-3.5">
          <h2 className="text-base font-semibold">Hôm nay ({fmtDate(today)})</h2>
          {now.length > 0 && <Pill tone={doneNow === now.length ? "ok" : "info"} className="num">{doneNow}/{now.length} xong</Pill>}
        </div>
        {now.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-5 py-6 text-sm text-muted-foreground"><p>Hôm nay không có việc.</p><button type="button" className="font-medium text-primary" onClick={goJourney}>Xem hành trình để biết việc tuần này</button></div>
        ) : <ul className="divide-y divide-border-soft px-5">{now.map((f) => <TaskRow key={f.occ.id} f={f} canTick={canTick} onTick={(done) => onTick(f.occ.id, done)} />)}</ul>}
      </section>
      <section className={cn("rounded-card border bg-card shadow-card", late.length ? "border-bad-border" : "border-border")} data-testid={late.length ? "onb-late" : undefined}>
        <div className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-3.5">
          <h2 className={cn("text-base font-semibold", late.length > 0 && "text-bad")}>Việc trễ ({late.length})</h2>
        </div>
        {late.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">Không có việc trễ.</p> : <ul className="divide-y divide-border-soft px-5">{late.map((f) => <TaskRow key={f.occ.id} f={f} showDate canTick={canTick} onTick={(done) => onTick(f.occ.id, done)} />)}</ul>}
      </section>
    </div>
  );
}

function MockupLinks({ plan }: { plan: PlanFull }) {
  const items = plan.stages.flatMap((s) => s.weeks.flatMap((w, wi) => w.items.filter((i) => i.kind === "mockup" && i.form_code).map((i) => ({ w, i, no: w.week_no ?? wi + 1 }))));
  if (items.length === 0 || !plan.staff_id) return null;
  const url = (it: Item) => `${window.location.origin}/f/${it.form_code}?nguoi_duoc_cham=${plan.staff_id}&buoi=${encodeURIComponent(it.name)}`;
  return (
    <section data-testid="onb-mockup-links">
      <h2 className="mb-2 text-base font-semibold">Link chấm mockup</h2>
      <ul className="flex flex-col gap-2">
        {items.map(({ i, no }) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-card p-3 text-sm shadow-card">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">Tuần {no}: {i.name}</span>
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
  const passedN = (prog?.checkpoints ?? []).filter((c) => isPassed(c.status)).length;
  const kinds = Object.values(prog?.items_by_kind ?? {});
  const total = kinds.reduce((a, k) => a + k.total, 0), done = kinds.reduce((a, k) => a + k.done, 0), overdue = kinds.reduce((a, k) => a + k.overdue, 0);
  const render = (c: ProgressCp) => <CpCard key={c.id} cp={c} plan={plan} manual={manualIds.has(c.id)} canConfirm={manage && plan.can_edit && plan.status === "active"} busy={busyId === c.id && confirm.isPending} onConfirm={() => { setBusyId(c.id); confirm.mutate({ id: c.id, confirmed: !c.confirmed_at }); }} />;
  const stat = (label: string, value: string, tone?: string) => <div className="rounded-lg bg-muted/60 px-4 py-3"><div className="text-xs text-muted-foreground">{label}</div><div className={cn("num mt-0.5 text-xl font-semibold", tone)}>{value}</div></div>;
  return (
    <div className="flex flex-col gap-5" data-testid="onb-results">
      <section className="grid grid-cols-3 gap-3">
        {stat("Checkpoint đạt", `${passedN}/${prog?.checkpoints.length ?? 0}`)}
        {stat("Việc đã xong", `${done}/${total}`)}
        {stat("Việc trễ", String(overdue), overdue > 0 ? "text-bad" : undefined)}
      </section>
      <section>
        <h2 className="mb-2 text-base font-semibold">Checkpoint</h2>
        {regular.length === 0 ? <p className="text-sm text-muted-foreground">Lộ trình chưa có checkpoint.</p> : <ul className="grid gap-3 lg:grid-cols-2">{regular.map(render)}</ul>}
      </section>
      <section data-testid="onb-final">
        <h2 className="mb-2 text-base font-semibold">Đánh giá cuối</h2>
        <div className="rounded-card border border-border bg-card p-4 text-sm shadow-card">
          <p>{final.result === "passed" ? <Pill tone="ok" className="h-7 text-sm">Đạt</Pill> : final.result === "failed" ? <Pill tone="bad" className="h-7 text-sm">Không đạt</Pill> : <span className="text-muted-foreground">Chưa chốt. Leader chốt sau khi qua các mốc.</span>}</p>
          {final.result && final.note && <p className="mt-2 [overflow-wrap:anywhere]">{final.note}</p>}
        </div>
        {finals.length > 0 && <ul className="mt-3 grid gap-3 lg:grid-cols-2">{finals.map(render)}</ul>}
      </section>
      {tables.size > 0 && (
        <section data-testid="onb-tables">
          <h2 className="mb-2 text-base font-semibold">{manage ? "Bảng của nhân sự" : "Bảng của tôi"}</h2>
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



const VIEWS = { muc: "journey" };

/** One person's plan: Journey, Today, My results (a segmented control kept in the URL). `manage` adds what a Leader/Manager does on the same page. */
export function PlanView({ planId, manage = false }: { planId: string; manage?: boolean }) {
  const me = useMe().data;
  const plan = usePlan(planId);
  const prog = useProgress(planId, plan.data?.status !== "draft" && !!plan.data?.staff_id);
  const refresh = useRefresh(planId);
  const [{ muc }, setUrl] = useUrlState(VIEWS);
  const tab = (["journey", "today", "results"].includes(muc) ? muc : "journey") as "journey" | "today" | "results";
  const [dlg, setDlg] = useState<"finish" | "stop" | null>(null);
  const tick = useMutation({ mutationFn: (v: { id: string; done: boolean }) => api("POST", `/onboarding/occurrences/${v.id}/tick`, { done: v.done }), onSuccess: refresh, onError: (e) => notify.error(e instanceof Error ? e.message : "Không lưu được.") });
  const brk = useMutation({ mutationFn: (v: { week_no: number; is_break: boolean }) => api("POST", `/onboarding/plans/${planId}/week-break`, v), onSuccess: refresh, onError: (e) => notify.error(e instanceof Error ? e.message : "Không lưu được.") });
  if (plan.isLoading) return <div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-9 w-72" /><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /><p className="sr-only">Đang tải...</p></div>;
  if (plan.error) return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  const p = plan.data;
  if (!p) return <EmptyState title="Không có lộ trình" />;
  const active = p.status === "active";
  const canTick = !manage && active;
  const onTick = (id: string, done: boolean) => tick.mutate({ id, done });
  return (
    <div data-testid="onb-plan-view" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{p.name}</h2>
        <Chip cls="bg-muted text-muted-foreground">{PLAN_STATUS[p.status] ?? p.status}</Chip>
        {p.start_date && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays size={13} aria-hidden />Bắt đầu {fmtDate(p.start_date)}/{p.start_date.slice(0, 4)}</span>}
        {manage && p.can_edit && active && (
          <span className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => setDlg("stop")} data-testid="plan-stop">Dừng</Button>
            <Button onClick={() => setDlg("finish")} data-testid="plan-finish">Chốt đánh giá cuối</Button>
          </span>
        )}
      </div>
      {p.status === "stopped" && p.stop_reason && <p className="text-sm text-muted-foreground">Lý do dừng: {p.stop_reason}</p>}
      <div><Segmented label="Mục của lộ trình" value={tab} onChange={(v) => setUrl({ muc: v })} items={[{ value: "journey", label: "Hành trình" }, { value: "today", label: "Hôm nay" }, { value: "results", label: manage ? "Kết quả" : "Kết quả của tôi" }]} /></div>
      {prog.error && <ErrorText error={prog.error} />}
      {tab === "journey" && <JourneyTab plan={p} prog={prog.data} manage={manage} canTick={canTick} canBreak={manage && p.can_edit && active} breakBusy={brk.isPending} onBreak={(no, isBreak) => brk.mutate({ week_no: no, is_break: isBreak })} onTick={onTick} goToday={() => setUrl({ muc: "today" })} who={me?.user.full_name ?? ""} />}
      {tab === "today" && <TodayTab plan={p} canTick={canTick} onTick={onTick} goJourney={() => setUrl({ muc: "journey" })} />}
      {tab === "results" && <ResultsTab plan={p} prog={prog.data} manage={manage} refresh={refresh} />}
      {dlg === "finish" && <FinishDialog plan={p} onClose={() => setDlg(null)} refresh={refresh} />}
      {dlg === "stop" && <StopDialog plan={p} onClose={() => setDlg(null)} refresh={refresh} />}
    </div>
  );
}
