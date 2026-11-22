// The right-hand panel of the editor: properties of the chosen block (design module7 2.1, 2.3, 2.3a, 2.4, 6).
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button, ConfirmDialog, ErrorText, Field, Input, Select, Textarea } from "@/components/ui/form";
import { notify } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { getTable } from "@/lib/datahub/api";
import { type Block, type Cond, flat, isNumeric, isSelect, kindLabel, opsFor, patchBlock, type Question, type FormConfig, type Rubric, rid } from "./model";

type Patch = (patch: Record<string, unknown>) => void;
const Check = ({ checked, onChange, children, testid }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testid?: string }) => (
  <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />{children}</label>
);

/** Condition rows on earlier questions, "all" or "any" (design module7 2.4). */
function CondEditor({ value, onChange, before }: { value?: Cond; onChange: (v: Cond | undefined) => void; before: Question[] }) {
  const mode: "and" | "or" = value && "or" in value ? "or" : "and";
  const rows: Cond[] = !value ? [] : "and" in value ? value.and : "or" in value ? value.or : [value];
  const emit = (list: Cond[], m = mode) => onChange(list.length === 0 ? undefined : list.length === 1 ? list[0] : ({ [m]: list } as Cond));
  const edit = (i: number, c: Cond) => emit(rows.map((r, j) => (j === i ? c : r)));
  if (before.length === 0) return <p className="text-xs text-muted-foreground">Chưa có câu hỏi đứng trước để đặt điều kiện.</p>;
  return (
    <div className="flex flex-col gap-2" data-testid="cond-editor">
      {rows.map((r, i) => {
        const c = r as { field: string; op: string; value?: unknown };
        const src = before.find((b) => b.id === c.field) ?? before[0]!;
        const ops = opsFor(src.input);
        const op = ops.find((o) => o.op === c.op) ?? ops[0]!;
        return (
          <div key={i} className="flex flex-wrap items-center gap-1 rounded-md border border-border p-2">
            <Select aria-label="Câu hỏi" className="min-w-0 flex-1" value={src.id} onChange={(e) => { const s = before.find((b) => b.id === e.target.value)!; edit(i, { field: s.id, op: opsFor(s.input)[0]!.op, value: undefined }); }}>{before.map((b) => <option key={b.id} value={b.id}>{b.label || b.id}</option>)}</Select>
            <Select aria-label="Phép so sánh" value={op.op} onChange={(e) => edit(i, { field: src.id, op: e.target.value, value: c.value })}>{ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</Select>
            {!op.noValue && (isSelect(src.input) ? (
              <Select aria-label="Giá trị" value={String(c.value ?? "")} onChange={(e) => edit(i, { field: src.id, op: op.op, value: e.target.value })}><option value="">Chọn…</option>{(src.options ?? []).map((o) => <option key={o.id ?? o.label} value={o.id ?? o.label}>{o.label}</option>)}</Select>
            ) : src.input === "checkbox" ? (
              <Select aria-label="Giá trị" value={String(c.value ?? "true")} onChange={(e) => edit(i, { field: src.id, op: op.op, value: e.target.value === "true" })}><option value="true">Có</option><option value="false">Không</option></Select>
            ) : (
              <Input aria-label="Giá trị" value={String(c.value ?? "")} onChange={(e) => edit(i, { field: src.id, op: op.op, value: isNumeric(src.input) && e.target.value !== "" && Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : e.target.value })} />
            ))}
            <Button variant="ghost" aria-label="Bỏ điều kiện" onClick={() => emit(rows.filter((_, j) => j !== i))}><X size={14} aria-hidden /></Button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => emit([...rows, { field: before[0]!.id, op: opsFor(before[0]!.input)[0]!.op, value: undefined }])} data-testid="cond-add"><Plus size={14} aria-hidden /> Thêm điều kiện</Button>
        {rows.length > 1 && <Select aria-label="Kiểu kết hợp" className="w-auto" value={mode} onChange={(e) => emit(rows, e.target.value as "and" | "or")}><option value="and">Thoả tất cả</option><option value="or">Thoả một trong</option></Select>}
      </div>
    </div>
  );
}

/** "Nối cột": choose an unlinked column of the right type, or make a new one named after the question (design module7 2.3a). */
function LinkSection({ formId, tableId, q, flush, reload }: { formId: string; tableId: string | null; q: Question; flush: () => Promise<void>; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [ask, setAsk] = useState<{ body: { column_id?: string; create?: boolean; name?: string }; message: string } | null>(null);
  const table = useQuery({ queryKey: ["form-table", tableId], queryFn: () => getTable(tableId!), enabled: !!tableId });
  const linked = table.data?.columns.find((c) => c.key === q.column_id);
  const opts = useQuery({ queryKey: ["form-link-options", formId, q.id, q.column_id, open], queryFn: async () => { await flush(); return api<{ column_id: string; name: string; type: string; required: boolean }[]>("GET", `/forms/${formId}/questions/${q.id}/link-options`); }, enabled: open });
  const link = useMutation({
    mutationFn: async (body: { column_id?: string; create?: boolean; name?: string; add_options?: boolean }) => {
      await flush();
      return api("POST", `/forms/${formId}/questions/${q.id}/link`, body);
    },
    onSuccess: async () => { setOpen(false); setAsk(null); await reload(); notify.ok("Đã nối cột"); },
    onError: (e, body) => { if (e instanceof ApiError && e.details?.reason === "option_missing") setAsk({ body, message: e.message }); },
  });
  if (!tableId) return <p className="text-xs text-muted-foreground">Form này chưa có bảng đích.</p>;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2" data-testid="link-section">
      <p className="text-sm font-medium">Nối cột</p>
      <p className="text-sm" data-testid="link-status">{q.column_id ? (linked ? <>Đã nối với cột <b>{linked.name}</b></> : <span className="text-bad">Cột đã bị xoá hoặc không còn trong bảng</span>) : <span className="text-warn">Chưa nối cột</span>}</p>
      {!open ? <Button variant="secondary" onClick={() => { setOpen(true); setName(q.label); }} data-testid="link-open">{q.column_id ? "Đổi cột" : "Nối cột"}</Button> : (
        <div className="flex flex-col gap-2">
          <Field label="Chọn cột chưa nối">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} data-testid="link-pick"><option value="">—</option>{(opts.data ?? []).map((c) => <option key={c.column_id} value={c.column_id}>{c.name}{c.required ? " (bắt buộc)" : ""}</option>)}</Select>
          </Field>
          <Button variant="secondary" disabled={!pick} loading={link.isPending} onClick={() => link.mutate({ column_id: pick })} data-testid="link-existing">Nối với cột này</Button>
          <Field label="Hoặc tạo cột mới" hint="Tên lấy theo câu hỏi, sửa được."><Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} data-testid="link-new-name" /></Field>
          <Button loading={link.isPending} onClick={() => link.mutate({ create: true, name: name.trim() || undefined })} data-testid="link-create">Tạo cột mới</Button>
          {!ask && <ErrorText error={link.error ?? opts.error} />}
        </div>
      )}
      {ask && <ConfirmDialog title="Thêm lựa chọn vào cột" message={ask.message} confirmLabel="Thêm và nối" busy={link.isPending} onConfirm={() => link.mutate({ ...ask.body, add_options: true })} onClose={() => setAsk(null)} />}
    </div>
  );
}

function Rubrics({ value, onChange }: { value: Rubric[]; onChange: (v: Rubric[]) => void }) {
  const set = (i: number, p: Partial<Rubric>) => onChange(value.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const n = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <div className="flex flex-col gap-2" data-testid="rubric-editor">
      <p className="text-sm font-medium">Phiếu chấm tiêu chí</p>
      {value.map((r, i) => (
        <div key={r.id} className="grid grid-cols-2 gap-1 rounded-md border border-border p-2">
          <Input className="col-span-2" aria-label="Tiêu chí" placeholder="Tên tiêu chí" value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
          <Field label="Thang từ"><Input type="number" value={r.min} onChange={(e) => set(i, { min: n(e.target.value) })} /></Field>
          <Field label="đến"><Input type="number" value={r.max} onChange={(e) => set(i, { max: n(e.target.value) })} /></Field>
          <Field label="Trọng số"><Input type="number" value={r.weight} onChange={(e) => set(i, { weight: n(e.target.value) })} /></Field>
          <Field label="Điểm sàn"><Input type="number" value={r.floor ?? ""} onChange={(e) => set(i, { floor: e.target.value === "" ? undefined : n(e.target.value) })} /></Field>
          <Button variant="ghost" className="col-span-2" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={14} aria-hidden /> Bỏ tiêu chí</Button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...value, { id: rid("c"), label: "", min: 1, max: 5, weight: 1 }])} data-testid="rubric-add"><Plus size={14} aria-hidden /> Thêm tiêu chí</Button>
    </div>
  );
}

/** The right answer and the points of a question (design module7 6.1, 6.2). */
function QuizSection({ q, set }: { q: Question; set: Patch }) {
  const manual = q.input === "long_text" || q.input === "attachment";
  const opts = q.options ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-2" data-testid="quiz-section">
      <p className="text-sm font-medium">Bài kiểm tra</p>
      <Field label="Điểm của câu"><Input type="number" min={0} value={q.points ?? ""} onChange={(e) => set({ points: e.target.value === "" ? undefined : Number(e.target.value) })} data-testid="q-points" /></Field>
      {manual ? <p className="text-xs text-muted-foreground">Câu này chấm tay. Thêm phiếu tiêu chí nếu muốn chấm theo tiêu chí.</p> : q.input === "single_select" ? (
        <Field label="Đáp án đúng"><Select value={String(q.answer ?? "")} onChange={(e) => set({ answer: e.target.value || undefined })} data-testid="q-answer"><option value="">—</option>{opts.map((o) => <option key={o.id ?? o.label} value={o.id ?? o.label}>{o.label}</option>)}</Select></Field>
      ) : q.input === "multi_select" ? (
        <div>
          <p className="text-sm">Đáp án đúng</p>
          {opts.map((o) => { const cur = Array.isArray(q.answer) ? (q.answer as string[]) : []; return <Check key={o.id ?? o.label} checked={cur.includes(o.id ?? o.label)} onChange={(v) => set({ answer: v ? [...cur, o.id ?? o.label] : cur.filter((x) => x !== (o.id ?? o.label)) })}>{o.label}</Check>; })}
          <Check checked={!!q.partial} onChange={(v) => set({ partial: v })}>Chấm từng phần</Check>
        </div>
      ) : q.input === "checkbox" ? (
        <Field label="Đáp án đúng"><Select value={String(q.answer ?? "")} onChange={(e) => set({ answer: e.target.value === "" ? undefined : e.target.value === "true" })}><option value="">—</option><option value="true">Có</option><option value="false">Không</option></Select></Field>
      ) : isNumeric(q.input) ? (
        <Field label="Đáp án đúng (số)"><Input type="number" value={typeof q.answer === "number" ? q.answer : ""} onChange={(e) => set({ answer: e.target.value === "" ? undefined : Number(e.target.value) })} data-testid="q-answer" /></Field>
      ) : (
        <Field label="Đáp án đúng" hint="Mỗi dòng một đáp án chấp nhận."><Textarea rows={2} value={Array.isArray(q.answer) ? (q.answer as string[]).join("\n") : ""} onChange={(e) => set({ answer: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} data-testid="q-answer" /></Field>
      )}
      {(manual || q.rubric?.length) && <Rubrics value={q.rubric ?? []} onChange={(v) => set({ rubric: v })} />}
      {!manual && !q.rubric?.length && q.input !== "single_select" && <Button variant="ghost" onClick={() => set({ rubric: [{ id: rid("c"), label: "", min: 1, max: 5, weight: 1 }] })}>Chấm tay bằng phiếu tiêu chí</Button>}
    </div>
  );
}

export function PropsPanel({ cfg, block, change, formId, tableId, flush, reload }: { cfg: FormConfig; block: Block; change: (c: FormConfig) => void; formId: string; tableId: string | null; flush: () => Promise<void>; reload: () => Promise<void> }) {
  const set: Patch = (p) => change(patchBlock(cfg, block.id, p));
  const all = flat(cfg.blocks);
  const pos = all.findIndex((f) => f.block.id === block.id);
  const before = all.slice(0, pos).map((f) => f.block).filter((b): b is Question => b.type === "question");
  const after = all.slice(pos + 1).map((f) => f.block).filter((b) => b.type === "question" || b.type === "group");
  if (block.type === "divider" || block.type === "page_break") return <p className="text-sm text-muted-foreground">{block.type === "divider" ? "Đường kẻ" : "Ngắt trang: từ đây là trang kế tiếp."}</p>;
  if (block.type === "heading" || block.type === "text") return <Field label={block.type === "heading" ? "Tiêu đề" : "Đoạn chữ"}><Textarea rows={block.type === "heading" ? 2 : 5} value={String(block.text ?? "")} onChange={(e) => set({ text: e.target.value })} data-testid="block-text" /></Field>;
  if (block.type === "image") return <div className="flex flex-col gap-2"><Field label="Địa chỉ ảnh (URL)"><Input value={String(block.url ?? "")} onChange={(e) => set({ url: e.target.value })} /></Field><Field label="Mô tả ảnh"><Input value={String(block.alt ?? "")} onChange={(e) => set({ alt: e.target.value })} /></Field></div>;
  if (block.type === "group") {
    return <div className="flex flex-col gap-3"><Field label="Tên nhóm"><Input value={String(block.title ?? "")} onChange={(e) => set({ title: e.target.value })} /></Field><div><p className="mb-1 text-sm font-medium">Nhóm hiện khi</p><CondEditor value={block.show_if as Cond | undefined} onChange={(v) => set({ show_if: v })} before={before} /></div></div>;
  }
  const q = block as Question;
  const opts = q.options ?? [];
  const setOpts = (list: { id?: string; label: string }[]) => set({ options: list });
  return (
    <div className="flex flex-col gap-3" data-testid="props-question">
      <p className="text-xs text-muted-foreground">Kiểu: {kindLabel(q.input)}</p>
      <Field label="Nhãn câu hỏi"><Input value={q.label} maxLength={500} onChange={(e) => set({ label: e.target.value })} data-testid="q-label" /></Field>
      <Field label="Mô tả"><Input value={q.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} /></Field>
      <Field label="Gợi ý trong ô"><Input value={q.hint ?? ""} onChange={(e) => set({ hint: e.target.value || undefined })} /></Field>
      <Check checked={!!q.required} onChange={(v) => set({ required: v })} testid="q-required">Bắt buộc</Check>
      <Check checked={!!q.hidden} onChange={(v) => set({ hidden: v })}>Trường ẩn (giá trị lấy từ link)</Check>
      <Field label="Mã tham số" hint="Dùng trong link điền sẵn, ví dụ ?cong_ty=..."><Input value={q.param ?? ""} maxLength={40} onChange={(e) => set({ param: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") || undefined })} /></Field>
      {!isSelect(q.input) && q.input !== "attachment" && q.input !== "user" && q.input !== "relation" && <Field label="Giá trị mặc định"><Input value={q.default === undefined ? "" : String(q.default)} onChange={(e) => set({ default: e.target.value === "" ? undefined : e.target.value })} /></Field>}
      {q.input === "scale" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Thấp nhất"><Input type="number" value={q.scale?.min ?? 1} onChange={(e) => set({ scale: { ...(q.scale ?? { min: 1, max: 5 }), min: Number(e.target.value) } })} /></Field>
          <Field label="Cao nhất"><Input type="number" value={q.scale?.max ?? 5} onChange={(e) => set({ scale: { ...(q.scale ?? { min: 1, max: 5 }), max: Number(e.target.value) } })} /></Field>
          <Field label="Nhãn đầu thấp"><Input value={q.scale?.min_label ?? ""} onChange={(e) => set({ scale: { ...(q.scale ?? { min: 1, max: 5 }), min_label: e.target.value } })} /></Field>
          <Field label="Nhãn đầu cao"><Input value={q.scale?.max_label ?? ""} onChange={(e) => set({ scale: { ...(q.scale ?? { min: 1, max: 5 }), max_label: e.target.value } })} /></Field>
        </div>
      )}
      {isSelect(q.input) && (
        <div className="flex flex-col gap-2" data-testid="options-editor">
          <p className="text-sm font-medium">Lựa chọn</p>
          {opts.map((o, i) => (
            <div key={o.id ?? i} className="flex flex-col gap-1 rounded-md border border-border p-2">
              <div className="flex gap-1">
                <Input aria-label={`Lựa chọn ${i + 1}`} value={o.label} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Button variant="ghost" aria-label="Bỏ lựa chọn" onClick={() => setOpts(opts.filter((_, j) => j !== i))}><X size={14} aria-hidden /></Button>
              </div>
              {o.id && after.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Khi chọn thì hiện… ({q.reveal?.[o.id]?.length ?? 0})</summary>
                  {after.map((b) => { const cur = q.reveal?.[o.id!] ?? []; const lab = b.type === "group" ? `Nhóm: ${b.title ?? b.id}` : (b as Question).label || b.id; return <Check key={b.id} checked={cur.includes(b.id)} onChange={(v) => { const next = { ...(q.reveal ?? {}), [o.id!]: v ? [...cur, b.id] : cur.filter((x) => x !== b.id) }; if (next[o.id!]!.length === 0) delete next[o.id!]; set({ reveal: Object.keys(next).length ? next : undefined }); }}>{lab}</Check>; })}
                </details>
              )}
            </div>
          ))}
          <Button variant="secondary" onClick={() => setOpts([...opts, { id: rid("o_"), label: `Lựa chọn ${opts.length + 1}` }])}><Plus size={14} aria-hidden /> Thêm lựa chọn</Button>
        </div>
      )}
      <div><p className="mb-1 text-sm font-medium">Câu hiện khi</p><CondEditor value={q.show_if} onChange={(v) => set({ show_if: v })} before={before} /></div>
      <LinkSection formId={formId} tableId={tableId} q={q} flush={flush} reload={reload} />
      {cfg.quiz?.enabled && <QuizSection q={q} set={set} />}
    </div>
  );
}
