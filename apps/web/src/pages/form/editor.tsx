// The form editor (design module7 2, module12 2): three columns (outline, the form sheet, properties), four steps on the bar
// (Thiết kế, Thiết lập, Chia sẻ, Phản hồi), autosave, preview and publish. No drag and drop: the "+" between blocks inserts, the arrows of the chosen block move.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Check, CircleAlert, Eye, Loader2, MessageSquareText, Monitor, Plus, Smartphone, Settings2, Share2, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, PageTitle } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BLOCK_NAME } from "./kinds";
import { STATUS_LABEL, STATUS_TONE } from "./list";
import { type Block, cloneBlock, type FormConfig, type FormDetail, formKeys, flat, insertAt, insertBlock, isSelect, moveBlock, type PublishIssue, type Question, removeBlock, rid, WIDTHS, ACCENTS } from "./model";
import { PropsPanel } from "./props";
import { FormRenderer } from "./renderer";
import { ResponsesTab } from "./responses";
import { ShareTab, SettingsTab } from "./settings";
import { BlockCard, InsertBar, TypePicker } from "./sheet";

type Step = "design" | "settings" | "share" | "responses";
type Save = "idle" | "saving" | "saved" | "error";
const kids = (b: Block) => ((b as unknown as { blocks?: Block[] }).blocks ?? []);

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

export function FormEditorPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const detailQ = useQuery({ queryKey: formKeys.one(id), queryFn: () => api<FormDetail>("GET", `/forms/${id}`) });
  if (detailQ.error) return <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />;
  if (!detailQ.data) return <p className="text-muted-foreground">Đang tải…</p>;
  return <EditorInner key={id} id={id} d={detailQ.data} refetch={() => void detailQ.refetch()} />;
}

const STEPS: { value: Step; label: string; icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }> }[] = [
  { value: "design", label: "Thiết kế", icon: SquarePen },
  { value: "settings", label: "Thiết lập", icon: Settings2 },
  { value: "share", label: "Chia sẻ", icon: Share2 },
  { value: "responses", label: "Phản hồi", icon: MessageSquareText },
];

function EditorInner({ id, d, refetch }: { id: string; d: FormDetail; refetch: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("design");
  const [view, setView] = useState<"edit" | "desktop" | "phone">("edit");
  const [cfg, setCfg] = useState<FormConfig>(d.draft);
  const [selected, setSelected] = useState<string | null>(null);
  const [save, setSave] = useState<Save>("idle");
  const [savedAt, setSavedAt] = useState("");
  const [side, setSide] = useState<"props" | "toc">("props");
  const stamp = () => setSavedAt(new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }));
  const [hasUnpub, setHasUnpub] = useState(d.has_unpublished);
  const [issues, setIssues] = useState<PublishIssue[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown>>({});
  const [discard, setDiscard] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<FormConfig | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const doSave = useCallback(async () => {
    const c = pending.current;
    if (!c) return;
    pending.current = null;
    setSave("saving");
    try {
      const r = await api<{ has_unpublished: boolean }>("PUT", `/forms/${id}/draft`, { config: c });
      setHasUnpub(r.has_unpublished);
      setSave(pending.current ? "saving" : "saved");
      stamp();
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
    stamp();
    void qc.invalidateQueries({ queryKey: ["form-table"] });
  }, [id, qc]);

  const publish = useMutation({
    mutationFn: async () => { await flush(); return api("POST", `/forms/${id}/publish`); },
    onSuccess: async () => { setIssues([]); notify.ok("Đã xuất bản"); await reload(); void qc.invalidateQueries({ queryKey: ["forms"] }); },
    onError: (e) => { setIssues(e instanceof ApiError ? ((e.details?.issues as PublishIssue[] | undefined) ?? []) : []); setStep("design"); },
  });
  const makeColumns = useMutation({ mutationFn: async () => { await flush(); return api("POST", `/forms/${id}/create-columns`, {}); }, onSuccess: async () => { setIssues([]); await reload(); notify.ok("Đã tạo cột"); } });
  const dropDraft = useMutation({ mutationFn: () => api("POST", `/forms/${id}/discard-draft`), onSuccess: async () => { setDiscard(false); setIssues([]); await reload(); } });

  const all = flat(cfg.blocks);
  const chosen = all.find((f) => f.block.id === selected)?.block ?? null;
  const numbers = new Map(all.filter((f) => f.block.type === "question").map((f, n) => [f.block.id, n + 1] as const));
  const issueIds = new Set(issues.map((i) => i.block_id).filter(Boolean));
  const unlinked = issues.filter((i) => i.code === "unlinked_question").length ? Number((/(\d+)/.exec(issues.find((i) => i.code === "unlinked_question")!.message) ?? [])[1] ?? 0) : 0;
  const jump = (blockId: string) => {
    setSelected(blockId);
    requestAnimationFrame(() => sheetRef.current?.querySelector(`[data-block="${blockId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  const addAt = (type: string, parentId: string | null, index: number) => {
    const b = newBlock(type);
    change(insertAt(cfg, b, parentId, index));
    jump(b.id);
  };
  const clone = (b: Block) => { const c = cloneBlock(b); change(insertBlock(cfg, c, b.id)); jump(c.id); };
  const published = d.published_version > 0;
  const accent = ACCENTS[cfg.appearance?.accent ?? "blue"]?.hex ?? ACCENTS.blue!.hex;

  /** A list of blocks with the "+" line before each one and after the last. */
  const list = (blocks: Block[], parentId: string | null): React.ReactNode => (
    <>
      {blocks.map((b, i) => (
        <div key={b.id} className="contents">
          <InsertBar inGroup={!!parentId} testid={`insert-${parentId ?? "root"}-${i}`} onPick={(t) => addAt(t, parentId, i)} />
          <BlockCard b={b} num={numbers.get(b.id) ?? null} selected={selected === b.id} issue={issueIds.has(b.id)} canUp={i > 0} canDown={i < blocks.length - 1}
            onSelect={() => { setSelected(b.id); setSide("props"); }} onMove={(dir) => change(moveBlock(cfg, b.id, dir))} onClone={() => clone(b)} onDelete={() => { change(removeBlock(cfg, b.id)); if (selected === b.id) setSelected(null); }}>
            {b.type === "group" && (
              <div className="mt-3 flex flex-col border-t border-dashed border-border pt-1">
                {list(kids(b), b.id)}
                {kids(b).length === 0 && <p className="pb-1 text-center text-xs text-muted-foreground">Nhóm trống. Bấm dấu + để thêm câu vào nhóm.</p>}
              </div>
            )}
          </BlockCard>
        </div>
      ))}
      <InsertBar inGroup={!!parentId} testid={`insert-${parentId ?? "root"}-${blocks.length}`} onPick={(t) => addAt(t, parentId, blocks.length)} />
    </>
  );

  const showUnpub = published && hasUnpub;
  const prevBtn = "inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-xs font-medium sm:min-h-7";
  const bar = (
    <div className="grid min-h-[46px] shrink-0 grid-cols-1 items-center gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-1.5 lg:grid-cols-[1fr_auto_1fr] lg:px-5" data-testid="publish-bar">
      <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5 tabular-nums" data-testid="save-status" aria-live="polite">
          {save === "saving" ? <><Loader2 size={14} className="shrink-0 animate-spin" aria-hidden /><span className="truncate">Đang lưu…</span></> : save === "error" ? <><CircleAlert size={14} className="shrink-0 text-bad" aria-hidden /><span className="truncate">Lỗi lưu, thử lại</span></> : <><Check size={14} className="shrink-0 text-ok" aria-hidden /><span className="truncate">Đã lưu nháp{savedAt && ` lúc ${savedAt}`}</span></>}
        </span>
        {showUnpub && <span className="shrink-0 font-medium text-warn" data-testid="unpublished-note">Có thay đổi chưa xuất bản</span>}
      </div>
      <div role="tablist" aria-label="Các bước" className="order-last flex w-full gap-0.5 overflow-x-auto rounded-[11px] border border-border bg-muted p-1 lg:order-none lg:w-auto lg:justify-self-center">
        {STEPS.map((s, n) => {
          const on = step === s.value;
          return (
            <button key={s.value} type="button" role="tab" aria-selected={on} onClick={() => { setStep(s.value); if (s.value === "design") setView("edit"); }} data-testid={`step-${s.value}`}
              className={cn("inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1 text-sm sm:min-h-7", on ? "bg-card font-semibold text-primary shadow-2xs" : "font-medium text-muted-foreground hover:text-foreground")}>
              <span className="hidden min-[1400px]:inline-flex"><s.icon size={14} aria-hidden /></span>{n + 1}. {s.label}{s.value === "responses" && <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-bold text-primary">{d.response_count}</span>}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-self-end">
        {showUnpub && <Button variant="ghost" onClick={() => setDiscard(true)} data-testid="discard-draft">Bỏ thay đổi</Button>}
        <div className="inline-flex items-center rounded-[9px] border border-border bg-card p-0.5" role="group" aria-label="Xem trước">
          <button type="button" className={cn(prevBtn, step === "design" && view === "desktop" ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-primary-soft hover:text-primary")} aria-pressed={step === "design" && view === "desktop"} title="Xem trước giao diện máy tính" onClick={() => { setStep("design"); setView(view === "desktop" ? "edit" : "desktop"); }} data-testid="preview-toggle"><Monitor size={14} aria-hidden />Xem trước</button>
          <button type="button" className={cn(prevBtn, "px-2", step === "design" && view === "phone" ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-primary-soft hover:text-primary")} aria-pressed={step === "design" && view === "phone"} aria-label="Xem trước trên điện thoại" title="Xem trước giao diện điện thoại" onClick={() => { setStep("design"); setView(view === "phone" ? "edit" : "phone"); }} data-testid="view-phone"><Smartphone size={14} aria-hidden /></button>
        </div>
        <Button onClick={() => publish.mutate()} loading={publish.isPending} disabled={published && !hasUnpub} data-testid="publish"><Check size={14} aria-hidden />Xuất bản</Button>
      </div>
    </div>
  );

  const toc = (
    <nav aria-label="Mục lục câu hỏi" data-testid="block-bar">
      {all.length === 0 && <p className="py-1 text-xs text-muted-foreground">Chưa có câu nào.</p>}
      <ol className="flex flex-col gap-0.5">
                {all.map((f) => {
                  const b = f.block;
                  const text = b.type === "question" ? (b as Question).label || "(chưa có nhãn)" : b.type === "group" ? String(b.title ?? BLOCK_NAME.group) : b.type === "heading" || b.type === "text" ? String(b.text ?? BLOCK_NAME[b.type]) : BLOCK_NAME[b.type] ?? b.type;
                  return (
                    <li key={b.id}>
                      <button type="button" onClick={() => jump(b.id)} aria-current={selected === b.id ? "true" : undefined} data-testid="toc-item" className={cn("flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm", f.parent ? "pl-6" : "pl-2", selected === b.id ? "bg-primary-soft font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground", b.type === "group" && "font-semibold")}>
                        <span className="min-w-0 flex-1 truncate">{b.type === "question" ? <span className="mr-1.5 text-xs font-semibold text-primary">{numbers.get(b.id)}.</span> : null}{text}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
    </nav>
  );
  const previewing = step === "design" && view !== "edit";
  const scroller = "min-h-0 lg:overflow-y-auto";

  return (
    <div className="-mx-4 -my-4 flex min-h-0 flex-col sm:-mx-6 lg:flex-1">
      <PageTitle actions={<Badge tone={STATUS_TONE[d.state]} data-testid="form-state">{STATUS_LABEL[d.state] ?? d.state}</Badge>}>{d.name}</PageTitle>
      {bar}
      {issues.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl bg-bad/10 p-3 text-sm lg:mx-5" role="alert" data-testid="publish-issues">
          <p className="font-medium text-bad">Chưa xuất bản được:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {issues.filter((i) => i.code !== "unlinked_question_item").map((i, n) => (
              <li key={n}>{i.block_id ? <button type="button" className="text-left underline" onClick={() => { setStep("design"); setView("edit"); jump(i.block_id!); }}>{i.message}</button> : i.message}</li>
            ))}
          </ul>
          {unlinked > 0 && <Button className="mt-2" onClick={() => makeColumns.mutate()} loading={makeColumns.isPending} data-testid="create-columns">Tạo cột mới cho {unlinked} câu</Button>}
        </div>
      )}
      <ErrorText error={makeColumns.error ?? dropDraft.error} />
      {step === "design" && (
        <div className="flex min-h-0 flex-col lg:flex-1 lg:flex-row">
          <section ref={sheetRef} className={cn(scroller, "min-w-0 flex-1 bg-workspace px-4 py-6 lg:px-8")} aria-label="Form" data-testid="canvas">
            {previewing ? (
              <div className="pb-8">
                <div className="mb-3 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft py-1 pl-3 pr-1.5 text-xs font-medium text-primary"><Eye size={13} aria-hidden />Đang xem trước bản nháp · không gửi được
                    <button type="button" onClick={() => setView("edit")} aria-label="Thoát xem trước" title="Thoát xem trước" data-testid="view-edit" className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full hover:bg-primary/10"><X size={12} aria-hidden /></button>
                  </span>
                </div>
                <div className={view === "phone" ? "mx-auto w-[375px] max-w-full" : ""} data-testid="preview-frame"><FormRenderer config={cfg} answers={preview} onChange={setPreview} fallbackTitle={d.name} /></div>
              </div>
            ) : (
              <div className={cn("mx-auto w-full pb-24", WIDTHS[cfg.appearance?.width ?? "medium"])}>
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                  <div className="h-1" style={{ background: `linear-gradient(90deg, ${accent}, #34d399)` }} aria-hidden />
                  <div className="border-b border-border-soft px-6 pb-4 pt-5">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      {d.table_name ? <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-primary" data-testid="source-chip">Datahub · {d.table_name}</span> : <span />}
                      <span className="text-xs text-muted-foreground">{numbers.size} câu hỏi · Tự động đồng bộ bảng</span>
                    </div>
                    <input value={cfg.title} placeholder="Tiêu đề form" aria-label="Tiêu đề form" onChange={(e) => change({ ...cfg, title: e.target.value })} data-testid="form-title" className="-ml-2 w-full rounded-[9px] border border-transparent bg-transparent px-2 py-1 text-2xl font-bold tracking-tight outline-none hover:border-border focus:border-primary" />
                    <textarea rows={2} value={cfg.description} placeholder="Thêm mô tả hướng dẫn điền biểu mẫu..." aria-label="Mô tả form" onChange={(e) => change({ ...cfg, description: e.target.value })} className="-ml-2 mt-1 w-full resize-none rounded-[9px] border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed text-muted-foreground outline-none hover:border-border focus:border-primary" />
                  </div>
                  <div className="flex flex-col p-4 sm:p-5">
                    {list(cfg.blocks, null)}
                    {cfg.blocks.length === 0 && <p className="mb-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Form chưa có câu hỏi. Bấm "Thêm câu hỏi" bên dưới.</p>}
                    <div className="px-2 pt-3">
                      <TypePicker onPick={(t) => addAt(t, null, cfg.blocks.length)} trigger={
                        <button type="button" className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary-border bg-primary-soft/40 py-3 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary-soft" data-testid="add-question"><Plus size={16} aria-hidden /> Thêm câu hỏi</button>
                      } />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
          {!previewing && (
            <aside className={cn(scroller, "w-full shrink-0 border-t border-border bg-card p-4 lg:w-[320px] lg:border-l lg:border-t-0")} aria-label="Thuộc tính" data-testid="props-panel">
              <div role="tablist" aria-label="Bảng bên phải" className="-mx-1 mb-4 flex gap-1 border-b border-border-soft">
                {([["props", "Thuộc tính"], ["toc", "Mục lục"]] as const).map(([v, l]) => (
                  <button key={v} type="button" role="tab" aria-selected={side === v} onClick={() => setSide(v)} data-testid={`side-${v}`} className={cn("-mb-px min-h-11 cursor-pointer border-b-2 px-3 text-xs sm:min-h-8", side === v ? "border-primary font-semibold text-primary" : "border-transparent font-medium text-muted-foreground hover:text-foreground")}>{l}</button>
                ))}
              </div>
              {side === "toc" ? toc : chosen ? <PropsPanel key={chosen.id} cfg={cfg} block={chosen} num={numbers.get(chosen.id) ?? null} change={change} formId={id} tableId={d.table_id} flush={flush} reload={reload} /> : (
                <p className="text-sm text-muted-foreground">Chọn một câu trên tờ form để sửa nhãn, mô tả, lựa chọn và công tắc của câu đó.</p>
              )}
            </aside>
          )}
        </div>
      )}
      {step !== "design" && (
        <div className="min-h-0 bg-workspace px-4 py-4 pb-6 sm:px-6 lg:flex-1 lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl">
            {step === "share" && <ShareTab form={d} reload={refetch} />}
            {step === "settings" && <SettingsTab form={d} cfg={cfg} change={change} reload={refetch} reloadDraft={reload} flush={flush} />}
            {step === "responses" && <ResponsesTab form={d} onShare={() => setStep("share")} />}
          </div>
        </div>
      )}
      {discard && <ConfirmDialog title="Bỏ thay đổi" message="Bản nháp quay về bản đang chạy. Thay đổi chưa xuất bản sẽ mất." confirmLabel="Bỏ thay đổi" busy={dropDraft.isPending} onConfirm={() => dropDraft.mutate()} onClose={() => setDiscard(false)} />}
    </div>
  );
}
