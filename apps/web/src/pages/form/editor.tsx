// The form editor (design module7 2): block bar, form canvas with drag and drop, property panel, autosave, publish.
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, Input, PageTitle, Tabs, Textarea } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { STATUS_LABEL } from "./list";
import { type Block, type FormConfig, type FormDetail, formKeys, flat, insertBlock, isSelect, kindLabel, moveBlock, dropBlock, type PublishIssue, type Question, QUESTION_KINDS, removeBlock, rid } from "./model";
import { PropsPanel } from "./props";
import { FormRenderer } from "./renderer";
import { QuizTab, SettingsTab, ShareTab } from "./settings";
import { ResponsesTab } from "./responses";

type Tab = "edit" | "share" | "settings" | "quiz" | "responses";
type Save = "idle" | "saving" | "saved" | "error";

const PLAIN: { type: Block["type"]; label: string }[] = [
  { type: "heading", label: "Tiêu đề" },
  { type: "text", label: "Đoạn chữ" },
  { type: "image", label: "Ảnh" },
  { type: "divider", label: "Đường kẻ" },
  { type: "page_break", label: "Ngắt trang" },
  { type: "group", label: "Nhóm câu" },
];
const BLOCK_NAME: Record<string, string> = { heading: "Tiêu đề", text: "Đoạn chữ", image: "Ảnh", divider: "Đường kẻ", page_break: "Ngắt trang", group: "Nhóm câu" };

function newBlock(type: string): Block {
  if (type.startsWith("q:")) return newQuestion(type.slice(2));
  if (type === "group") return { id: rid("g"), type: "group", title: "Nhóm câu", blocks: [] } as unknown as Block;
  if (type === "heading" || type === "text") return { id: rid(), type, text: type === "heading" ? "Tiêu đề mới" : "Đoạn chữ" } as Block;
  return { id: rid(), type } as Block;
}
function newQuestion(type: string): Block {
  const q: Question = { id: rid("q"), type: "question", input: type, label: "" };
  if (isSelect(type)) q.options = [{ id: rid("o_"), label: "Lựa chọn 1" }, { id: rid("o_"), label: "Lựa chọn 2" }];
  if (type === "scale") q.scale = { min: 1, max: 5, min_label: "Rất kém", max_label: "Rất tốt" };
  return q;
}

function SortableBlock({ b, depth, selected, onSelect, onMove, onDelete, issue, children, count }: { b: Block; depth: number; selected: boolean; onSelect: () => void; onMove: (d: -1 | 1) => void; onDelete: () => void; issue: boolean; children?: React.ReactNode; count: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: b.id });
  const q = b as Question;
  const title = b.type === "question" ? q.label || "(chưa có nhãn)" : b.type === "group" ? String(b.title ?? "") : String(b.text ?? BLOCK_NAME[b.type]);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }} data-block={b.id} data-testid="canvas-block" className={`rounded-md border bg-card ${selected ? "border-primary ring-2 ring-primary/30" : issue ? "border-bad" : "border-border"} ${depth ? "ml-4" : ""}`}>
      <div className="flex items-center gap-1 p-2">
        <button type="button" className="inline-flex min-h-9 min-w-9 cursor-grab touch-none items-center justify-center rounded hover:bg-muted" aria-label="Kéo để đổi thứ tự" data-testid={`drag-${b.id}`} {...attributes} {...listeners}><GripVertical size={16} aria-hidden /></button>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect} data-testid="block-select">
          <span className="block text-xs text-muted-foreground">{b.type === "question" ? kindLabel(q.input) : BLOCK_NAME[b.type]}{b.type === "question" && q.required ? " · bắt buộc" : ""}{b.type === "question" && !q.column_id ? " · chưa nối cột" : ""}</span>
          <span className="block truncate text-sm font-medium" data-testid="block-title">{title}</span>
        </button>
        <Button variant="ghost" aria-label="Lên" onClick={() => onMove(-1)} data-testid="block-up"><ArrowUp size={14} aria-hidden /></Button>
        <Button variant="ghost" aria-label="Xuống" onClick={() => onMove(1)} data-testid="block-down"><ArrowDown size={14} aria-hidden /></Button>
        <Button variant="ghost" aria-label="Xoá khối" onClick={onDelete} data-testid="block-delete"><Trash2 size={14} aria-hidden /></Button>
      </div>
      {b.type === "group" && <div className="flex flex-col gap-2 border-t border-dashed border-border p-2">{children}{count === 0 && <p className="text-xs text-muted-foreground">Kéo câu hỏi vào nhóm này.</p>}</div>}
    </div>
  );
}

export function FormEditorPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const detailQ = useQuery({ queryKey: formKeys.one(id), queryFn: () => api<FormDetail>("GET", `/forms/${id}`) });
  if (detailQ.error) return <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />;
  if (!detailQ.data) return <p className="text-muted-foreground">Đang tải…</p>;
  return <EditorInner key={id} id={id} d={detailQ.data} refetch={() => void detailQ.refetch()} />;
}

function EditorInner({ id, d, refetch }: { id: string; d: FormDetail; refetch: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("edit");
  const [view, setView] = useState<"edit" | "desktop" | "phone">("edit");
  const [cfg, setCfg] = useState<FormConfig>(d.draft);
  const [selected, setSelected] = useState<string | null>(null);
  const [save, setSave] = useState<Save>("idle");
  const [hasUnpub, setHasUnpub] = useState(d.has_unpublished);
  const [issues, setIssues] = useState<PublishIssue[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown>>({});
  const [discard, setDiscard] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<FormConfig | null>(null);

  const doSave = useCallback(async () => {
    const c = pending.current;
    if (!c) return;
    pending.current = null;
    setSave("saving");
    try {
      const r = await api<{ has_unpublished: boolean }>("PUT", `/forms/${id}/draft`, { config: c });
      setHasUnpub(r.has_unpublished);
      setSave(pending.current ? "saving" : "saved");
    } catch { setSave("error"); }
  }, [id]);
  const flush = useCallback(async () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } await doSave(); }, [doSave]);
  const change = useCallback((c: FormConfig) => {
    setCfg(c);
    pending.current = c;
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void doSave(); }, 600);
  }, [doSave]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); void doSave(); }, [doSave]);
  /** Take the draft the server holds (after a command that changed it: link, create columns, JSON). */
  const reload = useCallback(async () => {
    pending.current = null;
    const fresh = await qc.fetchQuery({ queryKey: formKeys.one(id), queryFn: () => api<FormDetail>("GET", `/forms/${id}`), staleTime: 0 });
    setCfg(fresh.draft);
    setHasUnpub(fresh.has_unpublished);
    setSave("saved");
    void qc.invalidateQueries({ queryKey: ["form-table"] });
  }, [id, qc]);

  const publish = useMutation({
    mutationFn: async () => { await flush(); return api("POST", `/forms/${id}/publish`); },
    onSuccess: async () => { setIssues([]); notify.ok("Đã xuất bản"); await reload(); void qc.invalidateQueries({ queryKey: ["forms"] }); },
    onError: (e) => setIssues(e instanceof ApiError ? ((e.details?.issues as PublishIssue[] | undefined) ?? []) : []),
  });
  const makeColumns = useMutation({ mutationFn: async () => { await flush(); return api("POST", `/forms/${id}/create-columns`, {}); }, onSuccess: async () => { setIssues([]); await reload(); notify.ok("Đã tạo cột"); } });
  const dropDraft = useMutation({ mutationFn: () => api("POST", `/forms/${id}/discard-draft`), onSuccess: async () => { setDiscard(false); setIssues([]); await reload(); } });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const all = flat(cfg.blocks);
  const chosen = all.find((f) => f.block.id === selected)?.block ?? null;
  const issueIds = new Set(issues.map((i) => i.block_id).filter(Boolean));
  const unlinked = issues.filter((i) => i.code === "unlinked_question").length ? Number((/(\d+)/.exec(issues.find((i) => i.code === "unlinked_question")!.message) ?? [])[1] ?? 0) : 0;
  const onDragEnd = (e: DragEndEvent) => { if (e.over && e.active.id !== e.over.id) change({ ...cfg, blocks: dropBlock(cfg, String(e.active.id), String(e.over.id)).blocks }); };
  const add = (type: string) => {
    const b = newBlock(type);
    let next: FormConfig;
    if (chosen?.type === "group" && b.type !== "group") next = { ...cfg, blocks: cfg.blocks.map((x) => (x.id === chosen.id ? ({ ...x, blocks: [...((x as unknown as { blocks: Block[] }).blocks ?? []), b] } as Block) : x)) };
    else next = insertBlock(cfg, b, selected);
    change(next);
    setSelected(b.id);
  };
  const render = (list: Block[], depth = 0): React.ReactNode => list.map((b) => (
    <SortableBlock key={b.id} b={b} depth={depth} selected={selected === b.id} issue={issueIds.has(b.id)} onSelect={() => setSelected(b.id)} onMove={(dir) => change(moveBlock(cfg, b.id, dir))} onDelete={() => { change(removeBlock(cfg, b.id)); if (selected === b.id) setSelected(null); }} count={b.type === "group" ? ((b as unknown as { blocks: Block[] }).blocks ?? []).length : 0}>
      {b.type === "group" ? render((b as unknown as { blocks: Block[] }).blocks ?? [], 1) : null}
    </SortableBlock>
  ));
  const published = d.published_version > 0;
  const banner = (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2" data-testid="publish-bar">
      <Badge>{STATUS_LABEL[d.state] ?? d.state}</Badge>
      <span className="text-sm text-muted-foreground" data-testid="save-status" aria-live="polite">{save === "saving" ? "Đang lưu…" : save === "error" ? "Lưu nháp lỗi" : save === "saved" ? "Đã lưu nháp" : ""}</span>
      <span className="flex-1" />
      {published && hasUnpub && <span className="text-sm font-medium" data-testid="unpublished-note">Có thay đổi chưa xuất bản</span>}
      {published && hasUnpub && <Button variant="secondary" onClick={() => setDiscard(true)} data-testid="discard-draft">Bỏ thay đổi</Button>}
      <Button onClick={() => publish.mutate()} loading={publish.isPending} disabled={published && !hasUnpub} data-testid="publish">Xuất bản</Button>
    </div>
  );

  return (
    <div>
      <PageTitle>{d.name}</PageTitle>
      {banner}
      {issues.length > 0 && (
        <div className="mb-3 rounded-md bg-bad/10 p-3 text-sm" role="alert" data-testid="publish-issues">
          <p className="font-medium text-bad">Chưa xuất bản được:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {issues.filter((i) => i.code !== "unlinked_question_item").map((i, n) => (
              <li key={n}>{i.block_id ? <button type="button" className="text-left underline" onClick={() => { setTab("edit"); setView("edit"); setSelected(i.block_id!); document.querySelector(`[data-block="${i.block_id}"]`)?.scrollIntoView({ block: "center" }); }}>{i.message}</button> : i.message}</li>
            ))}
          </ul>
          {unlinked > 0 && <Button className="mt-2" onClick={() => makeColumns.mutate()} loading={makeColumns.isPending} data-testid="create-columns">Tạo cột mới cho {unlinked} câu</Button>}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} items={[{ value: "edit", label: "Soạn" }, { value: "share", label: "Chia sẻ" }, { value: "settings", label: "Thiết lập" }, { value: "quiz", label: "Bài kiểm tra" }, { value: "responses", label: `Phản hồi (${d.response_count})` }]} />
      <ErrorText error={makeColumns.error ?? dropDraft.error} />
      {tab === "edit" && (
        <>
          <div className="mb-3 flex gap-1" role="group" aria-label="Chế độ xem">
            {([["edit", "Soạn"], ["desktop", "Xem trước máy tính"], ["phone", "Xem trước điện thoại"]] as const).map(([v, l]) => <Button key={v} variant={view === v ? "primary" : "secondary"} onClick={() => setView(v)} data-testid={`view-${v}`}>{l}</Button>)}
          </div>
          {view !== "edit" ? (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Xem trước bản nháp (không gửi được).</p>
              <div className={view === "phone" ? "mx-auto w-[375px] max-w-full" : ""} data-testid="preview-frame"><FormRenderer config={cfg} answers={preview} onChange={setPreview} fallbackTitle={d.name} /></div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_320px]">
              <aside className="flex flex-col gap-1" aria-label="Thêm khối" data-testid="block-bar">
                <p className="text-xs font-medium text-muted-foreground">Câu hỏi</p>
                {QUESTION_KINDS.map((k) => <Button key={k.input} variant="secondary" className="justify-start" onClick={() => add(`q:${k.input}`)} data-testid={`add-${k.input}`}><Plus size={14} aria-hidden /> {k.label}</Button>)}
                <p className="mt-2 text-xs font-medium text-muted-foreground">Khối khác</p>
                {PLAIN.map((k) => <Button key={k.type} variant="secondary" className="justify-start" onClick={() => add(k.type)} data-testid={`add-block-${k.type}`}><Plus size={14} aria-hidden /> {k.label}</Button>)}
              </aside>
              <section className="flex min-w-0 flex-col gap-2" aria-label="Form" data-testid="canvas">
                <Input value={cfg.title} placeholder="Tiêu đề form" aria-label="Tiêu đề form" onChange={(e) => change({ ...cfg, title: e.target.value })} data-testid="form-title" />
                <Textarea rows={2} value={cfg.description} placeholder="Mô tả" aria-label="Mô tả form" onChange={(e) => change({ ...cfg, description: e.target.value })} />
                {cfg.blocks.length === 0 && <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Bấm một khối ở bên trái để thêm vào form.</p>}
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={all.map((f) => f.block.id)} strategy={verticalListSortingStrategy}>{render(cfg.blocks)}</SortableContext>
                </DndContext>
              </section>
              <aside className="rounded-md border border-border bg-card p-3" aria-label="Thuộc tính" data-testid="props-panel">
                {chosen ? <PropsPanel key={chosen.id} cfg={cfg} block={chosen} change={change} formId={id} tableId={d.table_id} flush={flush} reload={reload} /> : <p className="text-sm text-muted-foreground">Chọn một khối để sửa thuộc tính.</p>}
              </aside>
            </div>
          )}
        </>
      )}
      {tab === "share" && <ShareTab form={d} reload={refetch} />}
      {tab === "settings" && <SettingsTab form={d} cfg={cfg} change={change} reload={refetch} reloadDraft={reload} flush={flush} />}
      {tab === "quiz" && <QuizTab form={d} cfg={cfg} change={change} reload={refetch} />}
      {tab === "responses" && <ResponsesTab form={d} />}
      {discard && <ConfirmDialog title="Bỏ thay đổi" message="Bản nháp quay về bản đang chạy. Thay đổi chưa xuất bản sẽ mất." confirmLabel="Bỏ thay đổi" busy={dropDraft.isPending} onConfirm={() => dropDraft.mutate()} onClose={() => setDiscard(false)} />}
    </div>
  );
}
