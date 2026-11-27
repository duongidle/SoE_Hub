// The form editor (design module7 2, module12 2): three columns (outline, the form sheet, properties), four steps on the bar
// (Thiết kế, Thiết lập, Chia sẻ, Phản hồi), autosave, preview and publish. No drag and drop: the "+" between blocks inserts, the arrows of the chosen block move.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Check, CircleAlert, Eye, Loader2, MessageSquareText, Plus, Settings2, Share2, SquarePen, Table2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, PageTitle } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { getTable } from "@/lib/datahub/api";
import { cn } from "@/lib/utils";
import { BLOCK_NAME, metaOf, TONE_CLS } from "./kinds";
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
    onError: (e) => { setIssues(e instanceof ApiError ? ((e.details?.issues as PublishIssue[] | undefined) ?? []) : []); setStep("design"); },
  });
  const makeColumns = useMutation({ mutationFn: async () => { await flush(); return api("POST", `/forms/${id}/create-columns`, {}); }, onSuccess: async () => { setIssues([]); await reload(); notify.ok("Đã tạo cột"); } });
  const dropDraft = useMutation({ mutationFn: () => api("POST", `/forms/${id}/discard-draft`), onSuccess: async () => { setDiscard(false); setIssues([]); await reload(); } });
  const table = useQuery({ queryKey: ["form-table", d.table_id], queryFn: () => getTable(d.table_id!), enabled: !!d.table_id });

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
          <BlockCard b={b} num={numbers.get(b.id) ?? null} selected={selected === b.id} issue={issueIds.has(b.id)} nested={!!parentId} canUp={i > 0} canDown={i < blocks.length - 1}
            onSelect={() => setSelected(b.id)} onMove={(dir) => change(moveBlock(cfg, b.id, dir))} onClone={() => clone(b)} onDelete={() => { change(removeBlock(cfg, b.id)); if (selected === b.id) setSelected(null); }}>
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

  const bar = (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2" data-testid="publish-bar">
      <div className="flex min-w-0 items-center gap-2">
        <Badge tone={STATUS_TONE[d.state]}>{STATUS_LABEL[d.state] ?? d.state}</Badge>
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground" data-testid="save-status" aria-live="polite">
          {save === "saving" ? <><Loader2 size={14} className="animate-spin" aria-hidden />Đang lưu…</> : save === "error" ? <><CircleAlert size={14} className="text-bad" aria-hidden />Lưu nháp lỗi</> : save === "saved" ? <><Check size={14} className="text-ok" aria-hidden />Đã lưu nháp</> : ""}
        </span>
      </div>
      <div role="tablist" aria-label="Các bước" className="order-last flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 lg:order-none lg:mx-auto lg:w-auto">
        {STEPS.map((s) => {
          const on = step === s.value;
          return (
            <button key={s.value} type="button" role="tab" aria-selected={on} onClick={() => setStep(s.value)} data-testid={`step-${s.value}`}
              className={cn("inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm sm:min-h-8", on ? "bg-card font-semibold text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <s.icon size={15} aria-hidden />{s.label}{s.value === "responses" && <span className="rounded-full bg-primary-soft px-1.5 text-xs text-primary">{d.response_count}</span>}
            </button>
          );
        })}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {published && hasUnpub && <span className="text-sm font-medium text-warn" data-testid="unpublished-note">Có thay đổi chưa xuất bản</span>}
        {published && hasUnpub && <Button variant="ghost" onClick={() => setDiscard(true)} data-testid="discard-draft">Bỏ thay đổi</Button>}
        {table.data && (
          <Link to="/datahub/$datahubId/$tableId" params={{ datahubId: table.data.datahub_id, tableId: table.data.id }} aria-label="Mở bảng phản hồi" data-testid="open-table-bar" className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:border-primary-border hover:bg-primary-soft sm:min-h-9">
            <Table2 size={15} aria-hidden /><span className="hidden min-[1400px]:inline">Mở bảng phản hồi</span>
          </Link>
        )}
        <Button variant="secondary" aria-pressed={step === "design" && view !== "edit"} onClick={() => { setStep("design"); setView(view === "edit" ? "desktop" : "edit"); }} data-testid="preview-toggle"><Eye size={15} aria-hidden /> Xem trước</Button>
        <Button onClick={() => publish.mutate()} loading={publish.isPending} disabled={published && !hasUnpub} data-testid="publish">Xuất bản</Button>
      </div>
    </div>
  );

  const previewing = step === "design" && view !== "edit";
  const segBtn = (on: boolean) => cn("inline-flex min-h-11 cursor-pointer items-center rounded-md px-3 text-sm sm:min-h-7", on ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground");
  const scroller = "min-h-0 lg:overflow-y-auto";

  return (
    <div className="flex min-h-0 flex-col lg:flex-1">
      <PageTitle>{d.name}</PageTitle>
      {bar}
      {issues.length > 0 && (
        <div className="mb-3 rounded-xl bg-bad/10 p-3 text-sm" role="alert" data-testid="publish-issues">
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
        <div className="flex min-h-0 flex-col gap-4 lg:flex-1 lg:flex-row">
          {!previewing && (
            <nav aria-label="Mục lục câu hỏi" className={cn(scroller, "hidden w-56 shrink-0 rounded-xl border border-border bg-card p-2 lg:block")} data-testid="block-bar">
              <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mục lục</p>
              {all.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Chưa có câu nào.</p>}
              <ol className="flex flex-col gap-0.5">
                {all.map((f) => {
                  const b = f.block;
                  const meta = metaOf(b.type, (b as Question).input);
                  const text = b.type === "question" ? (b as Question).label || "(chưa có nhãn)" : b.type === "group" ? String(b.title ?? BLOCK_NAME.group) : b.type === "heading" || b.type === "text" ? String(b.text ?? BLOCK_NAME[b.type]) : BLOCK_NAME[b.type] ?? b.type;
                  return (
                    <li key={b.id}>
                      <button type="button" onClick={() => jump(b.id)} aria-current={selected === b.id ? "true" : undefined} data-testid="toc-item" className={cn("flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm", f.parent ? "pl-6" : "pl-2", selected === b.id ? "bg-primary-soft font-medium text-primary" : "hover:bg-muted")}>
                        <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md", TONE_CLS[meta.tone])}><meta.icon size={13} aria-hidden /></span>
                        <span className="min-w-0 flex-1 truncate">{b.type === "question" ? <span className="mr-1 text-xs text-muted-foreground">{numbers.get(b.id)}.</span> : null}{text}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}
          <section ref={sheetRef} className={cn(scroller, "min-w-0 flex-1")} aria-label="Form" data-testid="canvas">
            <div className="mx-auto mb-3 flex w-fit gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Chế độ xem">
              {([["edit", "Soạn"], ["desktop", "Máy tính"], ["phone", "Điện thoại"]] as const).map(([v, l]) => <button key={v} type="button" className={segBtn(view === v)} aria-pressed={view === v} onClick={() => setView(v)} data-testid={`view-${v}`}>{l}</button>)}
            </div>
            {previewing ? (
              <div className="pb-8">
                <p className="mb-2 text-center text-xs text-muted-foreground">Xem trước bản nháp (không gửi được).</p>
                <div className={view === "phone" ? "mx-auto w-[375px] max-w-full" : ""} data-testid="preview-frame"><FormRenderer config={cfg} answers={preview} onChange={setPreview} fallbackTitle={d.name} /></div>
              </div>
            ) : (
              <div className={cn("mx-auto w-full pb-24", WIDTHS[cfg.appearance?.width ?? "medium"])}>
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <div className="h-2" style={{ background: accent }} aria-hidden />
                  <div className="flex flex-col gap-2 p-5 sm:p-6">
                    <input value={cfg.title} placeholder="Tiêu đề form" aria-label="Tiêu đề form" onChange={(e) => change({ ...cfg, title: e.target.value })} data-testid="form-title" className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-2xl font-semibold tracking-tight outline-none hover:border-border-soft focus:border-primary" />
                    <textarea rows={2} value={cfg.description} placeholder="Mô tả" aria-label="Mô tả form" onChange={(e) => change({ ...cfg, description: e.target.value })} className="w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-1 text-sm text-muted-foreground outline-none hover:border-border-soft focus:border-primary" />
                  </div>
                </div>
                <div className="mt-2 flex flex-col">
                  {list(cfg.blocks, null)}
                </div>
                {cfg.blocks.length === 0 && <p className="mb-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Form chưa có câu hỏi. Bấm "Thêm câu hỏi" bên dưới.</p>}
                <TypePicker onPick={(t) => addAt(t, null, cfg.blocks.length)} trigger={
                  <Button variant="secondary" className="mt-2 w-full border-dashed py-3 text-primary" data-testid="add-question"><Plus size={16} aria-hidden /> Thêm câu hỏi</Button>
                } />
              </div>
            )}
          </section>
          {!previewing && (
            <aside className={cn(scroller, "w-full shrink-0 rounded-xl border border-border bg-card p-4 lg:w-80")} aria-label="Thuộc tính" data-testid="props-panel">
              {chosen ? <PropsPanel key={chosen.id} cfg={cfg} block={chosen} num={numbers.get(chosen.id) ?? null} change={change} formId={id} tableId={d.table_id} flush={flush} reload={reload} /> : <p className="text-sm text-muted-foreground">Chọn một câu trên tờ form để sửa thuộc tính.</p>}
            </aside>
          )}
        </div>
      )}
      {step !== "design" && (
        <div className="min-h-0 pb-6 lg:flex-1 lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl">
            {step === "share" && <ShareTab form={d} reload={refetch} />}
            {step === "settings" && <SettingsTab form={d} cfg={cfg} change={change} reload={refetch} reloadDraft={reload} flush={flush} />}
            {step === "responses" && <ResponsesTab form={d} />}
          </div>
        </div>
      )}
      {discard && <ConfirmDialog title="Bỏ thay đổi" message="Bản nháp quay về bản đang chạy. Thay đổi chưa xuất bản sẽ mất." confirmLabel="Bỏ thay đổi" busy={dropDraft.isPending} onConfirm={() => dropDraft.mutate()} onClose={() => setDiscard(false)} />}
    </div>
  );
}
