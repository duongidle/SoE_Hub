import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Button, ErrorText, Field, Input, Modal, PageTitle, Select } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { listForms, type FormBrief } from "../form/model";
import { GROUP_LABEL, KIND_LABEL, WEEKDAY_LABEL, issueAt, planKey, usePlan, type Cond, type Cp, type Item, type PlanFull, type Stage } from "./common";

const REPEAT_LABEL: Record<string, string> = { once: "Một lần", daily_workdays: "Mỗi ngày làm việc (T2-T7)", weekly: "Mỗi tuần" };
const AGG_LABEL: Record<string, string> = { count: "Đếm dòng", sum: "Tổng", avg: "Trung bình", max: "Cao nhất", min: "Thấp nhất" };
const OP_LABEL: Record<string, string> = { gte: "≥", gt: ">", lte: "≤", lt: "<", eq: "=" };
const RANGE_LABEL: Record<string, string> = { week: "Tuần của checkpoint", plan: "Từ đầu lộ trình", since: "Từ một ngày" };
const COND_LABEL: Record<string, string> = { metric: "Chỉ số của một cột", weighted: "Phiếu chấm (trọng số)", vs_items: "So với số việc loại X", manual: "Leader xác nhận tay" };

const newItem = (): Item => ({ name: "", kind: "other", weekday: 1, repeat: "once", share_table: false });
const newCond = (type: Cond["type"]): Cond =>
  type === "manual" ? { type, label: "Leader xác nhận" }
  : type === "weighted" ? { type, form_id: null, range: "plan", columns: [{ field: "", weight: 1 }], threshold: 4, floor: 3, person_field: "Người được chấm" }
  : type === "vs_items" ? { type, form_id: null, range: "plan", item_kind: "on_job" }
  : { type, form_id: null, range: "week", agg: "count", op: "gte", threshold: 10 };

const num = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : Number(v));
function condOut(k: Cond): Record<string, unknown> {
  const o: Record<string, unknown> = { type: k.type };
  if (k.label) o.label = k.label;
  if (k.type === "manual") return o;
  o.form_id = k.form_id ?? null;
  if (k.person_field) o.person_field = k.person_field;
  o.range = k.range ?? "plan";
  if (k.range === "since" && k.since) o.since = k.since;
  if (k.filter) o.filter = k.filter;
  if (k.type === "metric") { o.agg = k.agg; if (k.field) o.field = k.field; o.op = k.op ?? "gte"; o.threshold = Number(k.threshold ?? 0); }
  if (k.type === "weighted") {
    o.columns = (k.columns as { field: string; weight: number; floor?: number | "" }[]).map((c) => ({ field: c.field, weight: Number(c.weight), ...(num(c.floor) !== undefined ? { floor: num(c.floor) } : {}) }));
    o.threshold = Number(k.threshold ?? 0);
    if (num(k.floor) !== undefined) o.floor = num(k.floor);
  }
  if (k.type === "vs_items") o.item_kind = k.item_kind;
  return o;
}
function itemOut(it: Item): Record<string, unknown> {
  const o: Record<string, unknown> = { name: it.name, kind: it.kind, weekday: it.weekday, repeat: it.repeat, form_id: it.form_id ?? null, share_table: !!it.share_table };
  if (it.id) o.id = it.id;
  if (it.description) o.description = it.description;
  if (it.repeat !== "once" && it.until_week_no) o.until_week_no = it.until_week_no;
  if (it.due_time) o.due_time = it.due_time.slice(0, 5);
  if (it.remind_before_min !== null && it.remind_before_min !== undefined) o.remind_before_min = it.remind_before_min;
  if (it.need_form && !it.form_id) o.need_form = true;
  if (it.filler_column) o.filler_column = it.filler_column;
  if (it.leader_columns?.length) o.leader_columns = it.leader_columns;
  if (it.link) o.link = it.link;
  return o;
}

const Q = (id: string, input: string, label: string, extra: Record<string, unknown> = {}) => ({ id, type: "question", input, label, ...extra });
/** First draft of a form made from the plan editor: right kind, the hidden "Người điền" (or the grading params). The Form editor finishes and publishes it. */
function seedConfig(kind: "form" | "quiz" | "grading", title: string) {
  const blocks = kind === "grading"
    ? [Q("duoc_cham", "user", "Người được chấm", { hidden: true, param: "nguoi_duoc_cham" }), Q("buoi", "text", "Buổi", { hidden: true, param: "buoi" }), Q("tc1", "scale", "Tiêu chí 1", { scale: { min: 1, max: 5 }, required: true }), Q("tinh", "checkbox", "Tính vào trung bình", { default: true })]
    : [Q("nguoi", "user", "Người điền", { hidden: true, fill_self: true }), ...(kind === "quiz" ? [] : [Q("noi_dung", "long_text", "Nội dung")])];
  return { schema: "soe-form/1", title, description: "", appearance: {}, blocks, ...(kind === "quiz" ? { quiz: { enabled: true, scale: "100", pass: { type: "points", value: 80 }, max_attempts: 2, show: "score" } } : {}) };
}

function NewFormDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (f: FormBrief) => void }) {
  const [kind, setKind] = useState<"form" | "quiz" | "grading">("form");
  const [name, setName] = useState("");
  const targets = useQuery({ queryKey: ["form-targets"], queryFn: () => api<{ datahub_id: string; datahub_name: string }[]>("GET", "/forms/target-tables") });
  const [dh, setDh] = useState("");
  const dhId = dh || targets.data?.[0]?.datahub_id || "";
  const m = useMutation({
    mutationFn: async () => {
      const f = await api<FormBrief>("POST", "/forms", { name: name.trim(), datahub_id: dhId });
      await api("PUT", `/forms/${f.id}/draft`, { config: seedConfig(kind, name.trim()) });
      return f;
    },
    onSuccess: (f) => { window.open(`/form/${f.id}`, "_blank", "noopener"); notify.ok("Đã tạo form. Soạn và xuất bản ở tab mới."); onCreated(f); },
  });
  return (
    <Modal title="Tạo form mới" open onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Loại form"><Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid="newform-kind"><option value="form">Form thường (Q&A, thu hoạch, báo cáo ngày)</option><option value="quiz">Bài kiểm tra</option><option value="grading">Phiếu chấm</option></Select></Field>
        <Field label="Tên form" required><Input value={name} onChange={(e) => setName(e.target.value)} data-testid="newform-name" /></Field>
        <Field label="Datahub chứa bảng"><Select value={dhId} onChange={(e) => setDh(e.target.value)}>{(targets.data ?? []).map((d) => <option key={d.datahub_id} value={d.datahub_id}>{d.datahub_name}</option>)}</Select></Field>
        <ErrorText error={m.error ?? targets.error} />
        <div className="flex justify-between gap-2"><Button variant="secondary" onClick={onClose}>Huỷ</Button><Button disabled={!name.trim() || !dhId} loading={m.isPending} onClick={() => m.mutate()} data-testid="newform-ok">Tạo và mở trình soạn</Button></div>
      </div>
    </Modal>
  );
}

function FormPick({ value, onChange, forms, reload, onNew, label }: { value: string | null | undefined; onChange: (v: string | null) => void; forms: FormBrief[]; reload: () => void; onNew: () => void; label?: string }) {
  return (
    <div className="flex flex-wrap items-end gap-1">
      <Field label={label ?? "Form gắn"}>
        <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} data-testid="form-pick">
          <option value="">Không gắn form</option>
          {forms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.status === "draft" ? " (chưa xuất bản)" : ""}</option>)}
        </Select>
      </Field>
      <Button variant="secondary" onClick={reload} aria-label="Làm mới danh sách form">Làm mới</Button>
      <Button variant="secondary" onClick={onNew} data-testid="form-new">Tạo form mới</Button>
    </div>
  );
}

function CondEditor({ k, onChange, forms, reload, onNew, err }: { k: Cond; onChange: (k: Cond) => void; forms: FormBrief[]; reload: () => void; onNew: () => void; err: (suffix: string) => string | null }) {
  const set = (p: Record<string, unknown>) => onChange({ ...k, ...p } as Cond);
  if (k.type === "manual") return <Field label="Nội dung xác nhận"><Input value={k.label ?? ""} onChange={(e) => set({ label: e.target.value })} /></Field>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <FormPick value={k.form_id} onChange={(v) => set({ form_id: v })} forms={forms} reload={reload} onNew={onNew} label="Bảng của form" />
      <Field label="Cột chọn người" hint='Mặc định "Người điền"; phiếu chấm: "Người được chấm"'><Input value={k.person_field ?? ""} onChange={(e) => set({ person_field: e.target.value })} /></Field>
      <Field label="Khoảng thời gian"><Select value={k.range ?? "plan"} onChange={(e) => set({ range: e.target.value })}>{Object.entries(RANGE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      {k.range === "since" && <Field label="Từ ngày" error={err("since")}><Input type="date" value={(k.since ?? "").slice(0, 10)} onChange={(e) => set({ since: e.target.value ? `${e.target.value}T00:00:00+07:00` : undefined })} /></Field>}
      {k.type === "metric" && (
        <>
          <Field label="Phép tính"><Select value={k.agg} onChange={(e) => set({ agg: e.target.value })}>{Object.entries(AGG_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          {k.agg !== "count" && <Field label="Cột" error={err("field")}><Input value={k.field ?? ""} onChange={(e) => set({ field: e.target.value })} /></Field>}
          <Field label="So sánh"><Select value={k.op ?? "gte"} onChange={(e) => set({ op: e.target.value })}>{Object.entries(OP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Ngưỡng" error={err("threshold")}><Input type="number" value={k.threshold ?? ""} onChange={(e) => set({ threshold: e.target.value === "" ? "" : Number(e.target.value) })} data-testid="cond-threshold" /></Field>
        </>
      )}
      {k.type === "weighted" && (
        <div className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Ngưỡng trung bình trọng số" error={err("threshold")}><Input type="number" value={k.threshold ?? ""} onChange={(e) => set({ threshold: e.target.value === "" ? "" : Number(e.target.value) })} /></Field>
            <Field label="Ngưỡng sàn mặc định của từng cột"><Input type="number" value={k.floor ?? ""} onChange={(e) => set({ floor: e.target.value === "" ? "" : Number(e.target.value) })} /></Field>
          </div>
          <p className="mt-2 text-sm font-medium">Các cột chấm</p>
          <ul className="flex flex-col gap-2">
            {(k.columns as { field: string; weight: number; floor?: number | "" }[]).map((c, i) => {
              const upd = (p: Record<string, unknown>) => set({ columns: (k.columns as object[]).map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <li key={i} className="flex flex-wrap items-end gap-2">
                  <Field label="Cột" error={err(`columns.${i}.field`)}><Input value={c.field} onChange={(e) => upd({ field: e.target.value })} /></Field>
                  <Field label="Trọng số" error={err(`columns.${i}.weight`)}><Input type="number" className="w-24" value={c.weight} onChange={(e) => upd({ weight: e.target.value === "" ? "" : Number(e.target.value) })} /></Field>
                  <Field label="Sàn riêng"><Input type="number" className="w-24" value={c.floor ?? ""} onChange={(e) => upd({ floor: e.target.value === "" ? "" : Number(e.target.value) })} /></Field>
                  <Button variant="ghost" onClick={() => set({ columns: (k.columns as object[]).filter((_, j) => j !== i) })} aria-label="Xoá cột">Xoá</Button>
                </li>
              );
            })}
          </ul>
          <Button className="mt-2" variant="secondary" onClick={() => set({ columns: [...(k.columns as object[]), { field: "", weight: 1 }] })}>Thêm cột chấm</Button>
        </div>
      )}
      {k.type === "vs_items" && <Field label="Loại việc"><Select value={k.item_kind} onChange={(e) => set({ item_kind: e.target.value })}>{Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>}
    </div>
  );
}

export function PlanEditorPage() {
  const { planId } = useParams({ strict: false }) as { planId: string };
  const plan = usePlan(planId);
  if (plan.isLoading) return <p className="text-sm text-muted-foreground">Đang tải...</p>;
  if (plan.error) return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  if (!plan.data) return null;
  // A new version (after a save) remounts the editor with the saved plan.
  return <Editor key={plan.data.version} p={plan.data} />;
}

function Editor({ p }: { p: PlanFull }) {
  const planId = p.id;
  const qc = useQueryClient();
  const forms = useQuery({ queryKey: ["forms", false], queryFn: () => listForms(false) });
  const [name, setName] = useState(p.name);
  const [stages, setStages] = useState<Stage[]>(() => p.stages.map((s) => ({ ...s, weeks: s.weeks.map((w) => ({ ...w, items: w.items.map((i) => ({ ...i })) })) })));
  const [cps, setCps] = useState<Cp[]>(() => p.checkpoints.map((c) => ({ ...c, conditions: c.conditions.map((k) => ({ ...k })) })));
  const [newFor, setNewFor] = useState<((f: FormBrief) => void) | null>(null);

  const weeks = stages.flatMap((s, si) => s.weeks.map((w, wi) => ({ si, wi, w })));
  const weekNo = (si: number, wi: number) => weeks.findIndex((x) => x.si === si && x.wi === wi) + 1;
  const save = useMutation({
    mutationFn: () => {
      let no = 0;
      const structure = { stages: stages.map((s) => ({ name: s.name, weeks: s.weeks.map((w) => ({ week_no: ++no, name: w.name, ...(w.goal ? { goal: w.goal } : {}), is_break: w.is_break, items: w.items.map(itemOut) })) })) };
      const checkpoints = cps.map((c) => ({ ...(c.id ? { id: c.id } : {}), week_no: c.is_final ? null : (c.week_no ?? null), name: c.name, is_final: c.is_final, ...(c.group ? { group: c.group } : {}), conditions: c.conditions.map(condOut) }));
      return api("PUT", `/onboarding/plans/${planId}`, { name: name.trim(), structure, checkpoints });
    },
    onSuccess: async () => { notify.ok("Đã lưu lộ trình."); await qc.invalidateQueries({ queryKey: planKey(planId) }); await qc.invalidateQueries({ queryKey: ["onb"] }); },
  });
  const e = save.error;
  const reload = () => void forms.refetch();
  const formList = forms.data ?? [];

  const setStage = (si: number, f: (s: Stage) => Stage) => setStages((a) => a.map((s, i) => (i === si ? f(s) : s)));
  const setItem = (si: number, wi: number, ii: number, patch: Partial<Item>) => setStage(si, (s) => ({ ...s, weeks: s.weeks.map((w, j) => (j === wi ? { ...w, items: w.items.map((it, k) => (k === ii ? { ...it, ...patch } : it)) } : w)) }));
  const setCp = (ci: number, patch: Partial<Cp>) => setCps((a) => a.map((c, i) => (i === ci ? { ...c, ...patch } : c)));

  const ended = p.status === "completed" || p.status === "stopped";
  const readOnly = !p.can_edit || ended;
  return (
    <div data-testid="onb-editor">
      <PageTitle actions={<><Link to="/onboarding/lo-trinh" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline">Về danh sách</Link><Button loading={save.isPending} disabled={readOnly} onClick={() => save.mutate()} data-testid="plan-save">Lưu lộ trình</Button></>}>Sửa lộ trình</PageTitle>
      {readOnly && <p className="mb-3 rounded-md bg-muted p-3 text-sm">{ended ? "Lộ trình đã kết thúc, không sửa được." : "Chỉ Leader trực tiếp hoặc Manager sửa được lộ trình này."}</p>}
      <ErrorText error={e} />
      <fieldset disabled={readOnly} className="mt-3 flex flex-col gap-6">
        <Field label="Tên lộ trình" required error={issueAt(e, "name")}><Input value={name} onChange={(ev) => setName(ev.target.value)} data-testid="ed-name" /></Field>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Giai đoạn, tuần, công việc</h2>
          <div className="flex flex-col gap-4">
            {stages.map((s, si) => (
              <div key={si} className="rounded-xl border border-border p-3" data-testid="ed-stage">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={`Giai đoạn ${si + 1}`} required error={issueAt(e, `structure.stages.${si}.name`)}><Input value={s.name} onChange={(ev) => setStage(si, (x) => ({ ...x, name: ev.target.value }))} data-testid="ed-stage-name" /></Field>
                  <Button variant="ghost" onClick={() => setStages((a) => a.filter((_, i) => i !== si))}>Xoá giai đoạn</Button>
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  {s.weeks.map((w, wi) => (
                    <div key={wi} className="rounded-lg bg-muted/40 p-3" data-testid="ed-week">
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label={`Tuần ${weekNo(si, wi)}: tên`} required error={issueAt(e, `structure.stages.${si}.weeks.${wi}.name`)}><Input value={w.name} onChange={(ev) => setStage(si, (x) => ({ ...x, weeks: x.weeks.map((y, j) => (j === wi ? { ...y, name: ev.target.value } : y)) }))} data-testid="ed-week-name" /></Field>
                        <Field label="Mục tiêu"><Input value={w.goal ?? ""} onChange={(ev) => setStage(si, (x) => ({ ...x, weeks: x.weeks.map((y, j) => (j === wi ? { ...y, goal: ev.target.value } : y)) }))} /></Field>
                        <label className="flex min-h-9 items-center gap-1 text-sm"><input type="checkbox" checked={w.is_break} onChange={(ev) => setStage(si, (x) => ({ ...x, weeks: x.weeks.map((y, j) => (j === wi ? { ...y, is_break: ev.target.checked } : y)) }))} />Tuần nghỉ</label>
                        <Button variant="ghost" onClick={() => setStage(si, (x) => ({ ...x, weeks: x.weeks.filter((_, j) => j !== wi) }))}>Xoá tuần</Button>
                      </div>
                      <ul className="mt-2 flex flex-col gap-2">
                        {w.items.map((it, ii) => {
                          const base = `structure.stages.${si}.weeks.${wi}.items.${ii}`;
                          const up = (patch: Partial<Item>) => setItem(si, wi, ii, patch);
                          return (
                            <li key={ii} className="rounded-lg border border-border bg-card p-3" data-testid="ed-item">
                              <div className="grid gap-2 sm:grid-cols-3">
                                <Field label="Tên công việc" required error={issueAt(e, `${base}.name`)}><Input value={it.name} onChange={(ev) => up({ name: ev.target.value })} data-testid="ed-item-name" /></Field>
                                <Field label="Loại"><Select value={it.kind} onChange={(ev) => up({ kind: ev.target.value })}>{Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                                <Field label="Lặp"><Select value={it.repeat} onChange={(ev) => up({ repeat: ev.target.value })}>{Object.entries(REPEAT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                                {it.repeat !== "daily_workdays" && <Field label="Thứ"><Select value={it.weekday} onChange={(ev) => up({ weekday: Number(ev.target.value) })}>{WEEKDAY_LABEL.slice(1).map((l, i) => <option key={l} value={i + 1}>{l}</option>)}</Select></Field>}
                                {it.repeat !== "once" && <Field label="Lặp tới tuần" error={issueAt(e, `${base}.until_week_no`)}><Input type="number" min={1} value={it.until_week_no ?? ""} onChange={(ev) => up({ until_week_no: ev.target.value === "" ? null : Number(ev.target.value) })} /></Field>}
                                <Field label="Hạn trong ngày" error={issueAt(e, `${base}.due_time`)}><Input type="time" value={(it.due_time ?? "").slice(0, 5)} onChange={(ev) => up({ due_time: ev.target.value || null })} /></Field>
                                <Field label="Nhắc trước (phút)" error={issueAt(e, `${base}.remind_before_min`)}><Input type="number" min={0} value={it.remind_before_min ?? ""} onChange={(ev) => up({ remind_before_min: ev.target.value === "" ? null : Number(ev.target.value) })} /></Field>
                                <Field label="Link" error={issueAt(e, `${base}.link`)}><Input value={it.link ?? ""} onChange={(ev) => up({ link: ev.target.value })} /></Field>
                              </div>
                              <div className="mt-2 flex flex-wrap items-end gap-3">
                                <FormPick value={it.form_id} onChange={(v) => up({ form_id: v, need_form: false })} forms={formList} reload={reload} onNew={() => setNewFor(() => (f: FormBrief) => up({ form_id: f.id, need_form: false }))} />
                                {it.need_form && !it.form_id && <span className="text-sm text-warn" data-testid="need-form">Chọn hoặc tạo form của bạn.</span>}
                                {it.form_id && <label className="flex min-h-9 items-center gap-1 text-sm"><input type="checkbox" checked={!!it.share_table} onChange={(ev) => up({ share_table: ev.target.checked })} />Chia sẻ bảng cho nhân sự</label>}
                                <Button variant="ghost" onClick={() => setStage(si, (x) => ({ ...x, weeks: x.weeks.map((y, j) => (j === wi ? { ...y, items: y.items.filter((_, k) => k !== ii) } : y)) }))}>Xoá việc</Button>
                              </div>
                              {issueAt(e, `${base}.form_id`) && <p role="alert" className="text-xs text-bad">{issueAt(e, `${base}.form_id`)}</p>}
                            </li>
                          );
                        })}
                      </ul>
                      <Button className="mt-2" variant="secondary" onClick={() => setStage(si, (x) => ({ ...x, weeks: x.weeks.map((y, j) => (j === wi ? { ...y, items: [...y.items, newItem()] } : y)) }))} data-testid="ed-add-item">Thêm công việc</Button>
                    </div>
                  ))}
                  <div><Button variant="secondary" onClick={() => setStage(si, (x) => ({ ...x, weeks: [...x.weeks, { name: `Tuần ${weeks.length + 1}`, is_break: false, items: [] }] }))} data-testid="ed-add-week">Thêm tuần</Button></div>
                </div>
              </div>
            ))}
            <div><Button variant="secondary" onClick={() => setStages((a) => [...a, { name: `Giai đoạn ${a.length + 1}`, weeks: [] }])} data-testid="ed-add-stage">Thêm giai đoạn</Button></div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">Checkpoint</h2>
          <div className="flex flex-col gap-3">
            {cps.map((c, ci) => (
              <div key={ci} className="rounded-xl border border-border p-3" data-testid="ed-cp">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label="Tên checkpoint" required error={issueAt(e, `checkpoints.${ci}.name`)}><Input value={c.name} onChange={(ev) => setCp(ci, { name: ev.target.value })} data-testid="ed-cp-name" /></Field>
                  <Field label="Thuộc" error={issueAt(e, `checkpoints.${ci}.week_no`)}>
                    <Select value={c.is_final ? "final" : String(c.week_no ?? "")} onChange={(ev) => (ev.target.value === "final" ? setCp(ci, { is_final: true, week_no: null }) : setCp(ci, { is_final: false, week_no: ev.target.value ? Number(ev.target.value) : null }))}>
                      <option value="">Chọn tuần</option>
                      {weeks.map((x, i) => <option key={i} value={i + 1}>Tuần {i + 1}: {x.w.name}</option>)}
                      <option value="final">Đánh giá cuối</option>
                    </Select>
                  </Field>
                  <Field label="Nhóm (cột ở trang Theo dõi)"><Select value={c.group ?? ""} onChange={(ev) => setCp(ci, { group: ev.target.value || null })}><option value="">Khác</option>{Object.entries(GROUP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                </div>
                <p className="mt-3 text-sm font-medium">Điều kiện (đạt khi mọi điều kiện đạt)</p>
                <ul className="mt-1 flex flex-col gap-3">
                  {c.conditions.map((k, ki) => (
                    <li key={ki} className="rounded-lg bg-muted/40 p-3" data-testid="ed-cond">
                      <div className="mb-2 flex flex-wrap items-end gap-2">
                        <Field label="Dạng"><Select value={k.type} onChange={(ev) => setCp(ci, { conditions: c.conditions.map((x, j) => (j === ki ? newCond(ev.target.value as Cond["type"]) : x)) })} data-testid="cond-type">{Object.entries(COND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
                        <Button variant="ghost" onClick={() => setCp(ci, { conditions: c.conditions.filter((_, j) => j !== ki) })}>Xoá điều kiện</Button>
                      </div>
                      <CondEditor k={k} forms={formList} reload={reload} onNew={() => setNewFor(() => (f: FormBrief) => setCp(ci, { conditions: c.conditions.map((x, j) => (j === ki ? { ...x, form_id: f.id } : x)) }))} onChange={(nk) => setCp(ci, { conditions: c.conditions.map((x, j) => (j === ki ? nk : x)) })} err={(suffix) => issueAt(e, `checkpoints.${ci}.conditions.${ki}.${suffix}`)} />
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setCp(ci, { conditions: [...c.conditions, newCond("metric")] })}>Thêm điều kiện</Button>
                  <Button variant="ghost" onClick={() => setCps((a) => a.filter((_, i) => i !== ci))}>Xoá checkpoint</Button>
                </div>
                {issueAt(e, `checkpoints.${ci}.conditions`) && <p role="alert" className="text-xs text-bad">{issueAt(e, `checkpoints.${ci}.conditions`)}</p>}
              </div>
            ))}
            <div><Button variant="secondary" onClick={() => setCps((a) => [...a, { name: "", week_no: null, is_final: false, conditions: [newCond("metric")] }])} data-testid="ed-add-cp">Thêm checkpoint</Button></div>
          </div>
        </section>
      </fieldset>
      {newFor && <NewFormDialog onClose={() => setNewFor(null)} onCreated={(f) => { reload(); newFor(f); setNewFor(null); }} />}
    </div>
  );
}
