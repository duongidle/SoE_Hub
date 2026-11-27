// The form sheet of the editor (design module12 2, module7 2): each block drawn as the person filling will see it (not filled in),
// the "+" insert bar between blocks and the type picker it opens. No drag and drop: order changes with the arrows of the chosen block.
import { ArrowDown, ArrowUp, Copy, Paperclip, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BLOCK_NAME, DOT_CLS, metaOf, PICKER_GROUPS, TONE_CLS } from "./kinds";
import { type Block, kindLabel, type Question } from "./model";

const FAKE = "rounded-lg border border-border bg-card px-3 py-2 text-sm text-faint";
const TILE_CLS = "inline-flex size-8 shrink-0 items-center justify-center rounded-lg";

/** A control of a question, drawn but not usable. */
function FakeInput({ q }: { q: Question }) {
  const opts = q.options ?? [];
  switch (q.input) {
    case "long_text": return <div className={cn(FAKE, "h-20")}>{q.hint || "Nhập câu trả lời"}</div>;
    case "single_select": case "multi_select":
      return (
        <div className="flex flex-col gap-2">
          {opts.map((o, i) => <div key={o.id ?? i} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-sm"><span aria-hidden className={cn("size-4 shrink-0 border border-border", q.input === "single_select" ? "rounded-full" : "rounded")} />{o.label || <span className="text-faint">(lựa chọn trống)</span>}</div>)}
        </div>
      );
    case "checkbox": return <div className="flex items-center gap-2.5 text-sm"><span aria-hidden className="size-4 rounded border border-border" />{q.hint || "Đồng ý"}</div>;
    case "rating": return <div className="flex gap-1 text-faint" aria-hidden>{[1, 2, 3, 4, 5].map((n) => <Star key={n} size={22} />)}</div>;
    case "scale": {
      const min = q.scale?.min ?? 1, max = q.scale?.max ?? 5;
      const steps = Array.from({ length: Math.max(0, Math.min(11, max - min + 1)) }, (_, i) => min + i);
      return (
        <div>
          <div className="flex flex-wrap gap-2" aria-hidden>{steps.map((n) => <span key={n} className="inline-flex size-9 items-center justify-center rounded-full border border-border text-sm text-muted-foreground">{n}</span>)}</div>
          {(q.scale?.min_label || q.scale?.max_label) && <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{q.scale?.min_label}</span><span>{q.scale?.max_label}</span></div>}
        </div>
      );
    }
    case "attachment": return <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-faint"><Paperclip size={16} aria-hidden /> Chọn tệp để đính kèm</div>;
    case "date": return <div className={FAKE}>dd/mm/yyyy</div>;
    case "datetime": return <div className={FAKE}>dd/mm/yyyy hh:mm</div>;
    case "user": return <div className={FAKE}>Chọn người</div>;
    case "relation": return <div className={FAKE}>Chọn dòng liên kết</div>;
    default: return <div className={FAKE}>{q.hint || "Nhập câu trả lời"}</div>;
  }
}

/** What one block looks like on the sheet. The title text sits alone in `block-title` (the label, no star). */
function Face({ b, num }: { b: Block; num: number | null }) {
  if (b.type === "question") {
    const q = b as Question;
    const meta = metaOf("question", q.input);
    const Icon = meta.icon;
    return (
      <div className={cn("flex flex-col gap-2", q.hidden && "opacity-60")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className={cn(TILE_CLS, "size-6 rounded-md", TONE_CLS[meta.tone])}><Icon size={14} aria-hidden /></span>
          <span className="font-semibold text-primary">Câu {num}</span>
          <span>{kindLabel(q.input)}</span>
          {q.hidden && <span className="rounded-full bg-muted px-2 py-0.5">Trường ẩn</span>}
          {!q.column_id && <span className="rounded-full bg-warn-bg px-2 py-0.5 text-warn">Chưa nối cột</span>}
        </div>
        <p className="text-base font-medium [overflow-wrap:anywhere]"><span data-testid="block-title" className={q.label ? undefined : "text-faint"}>{q.label || "(chưa có nhãn)"}</span>{q.required && <span className="ml-1 text-bad" aria-label="bắt buộc">*</span>}</p>
        {q.description && <p className="-mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{q.description}</p>}
        <FakeInput q={q} />
      </div>
    );
  }
  if (b.type === "heading") return <p className="text-xl font-semibold [overflow-wrap:anywhere]" data-testid="block-title">{String(b.text ?? "") || BLOCK_NAME.heading}</p>;
  if (b.type === "text") return <p className="whitespace-pre-line text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="block-title">{String(b.text ?? "") || BLOCK_NAME.text}</p>;
  if (b.type === "image") return b.url ? <img src={String(b.url)} alt={String(b.alt ?? "")} className="max-h-60 rounded-lg object-contain" /> : <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-faint" data-testid="block-title">Ảnh (chưa có địa chỉ)</div>;
  if (b.type === "divider") return <div className="py-2"><hr className="border-border" /><span className="sr-only" data-testid="block-title">Đường kẻ</span></div>;
  if (b.type === "page_break") return <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 border-t border-dashed border-border" /><span data-testid="block-title">Ngắt trang</span><span className="h-px flex-1 border-t border-dashed border-border" /></div>;
  return <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-sm font-medium text-primary"><span aria-hidden className="size-2 rounded-full bg-primary" /><span data-testid="block-title">{String(b.title ?? "") || BLOCK_NAME.group}</span></span>;
}

const ICON_BTN = "inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-primary-soft hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:size-11";

/** One block on the sheet. The chosen one shows its tools (move, copy, delete). A group holds its children below its own title. */
export function BlockCard({ b, num, selected, issue, nested, canUp, canDown, onSelect, onMove, onClone, onDelete, children }: {
  b: Block; num: number | null; selected: boolean; issue: boolean; nested: boolean; canUp: boolean; canDown: boolean;
  onSelect: () => void; onMove: (d: -1 | 1) => void; onClone: () => void; onDelete: () => void; children?: React.ReactNode;
}) {
  return (
    <div data-block={b.id} data-testid="canvas-block" className={cn("relative rounded-xl border bg-card p-4 transition-shadow sm:p-5", selected ? "border-primary shadow-md ring-2 ring-primary/20" : issue ? "border-bad" : "border-border hover:border-primary-border", nested && "bg-workspace")}>
      {selected && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-sm" role="toolbar" aria-label="Thao tác với khối đang chọn">
          <button type="button" className={ICON_BTN} aria-label="Nhân bản" onClick={onClone} data-testid="block-clone"><Copy size={14} aria-hidden /></button>
          <button type="button" className={ICON_BTN} aria-label="Lên" disabled={!canUp} onClick={() => onMove(-1)} data-testid="block-up"><ArrowUp size={14} aria-hidden /></button>
          <button type="button" className={ICON_BTN} aria-label="Xuống" disabled={!canDown} onClick={() => onMove(1)} data-testid="block-down"><ArrowDown size={14} aria-hidden /></button>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
          <button type="button" className={cn(ICON_BTN, "hover:!bg-bad-bg hover:!text-bad")} aria-label="Xoá khối" onClick={onDelete} data-testid="block-delete"><Trash2 size={14} aria-hidden /></button>
        </div>
      )}
      <button type="button" className="block w-full cursor-pointer text-left" onClick={onSelect} data-testid="block-select" aria-pressed={selected}><Face b={b} num={num} /></button>
      {children}
    </div>
  );
}

/** Three columns of groups (Văn bản + Ngày, Số + Lựa chọn, Dữ liệu + Bố cục), one low row per type: about 380px high, so it fits a 800px screen without scrolling. */
const PICKER_COLUMNS = [["Văn bản", "Ngày"], ["Số", "Lựa chọn"], ["Dữ liệu", "Bố cục"]];
/** The type picker: groups by color, an icon per type. `inGroup` hides the blocks that cannot live inside a group. */
export function TypePicker({ trigger, onPick, inGroup }: { trigger: React.ReactNode; onPick: (type: string) => void; inGroup?: boolean }) {
  const [open, setOpen] = useState(false);
  const pick = (t: string) => { setOpen(false); onPick(t); };
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} label="Chọn loại câu hỏi" width="w-[min(38rem,calc(100vw-1rem))]" className="p-3">
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3" data-testid="type-picker">
        {PICKER_COLUMNS.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-2.5">
            {col.map((title) => {
              const g = PICKER_GROUPS.find((x) => x.title === title)!;
              const items = g.items.filter((i) => !(inGroup && (i === "block:group" || i === "block:page_break")));
              if (items.length === 0) return null;
              return (
                <section key={g.title} aria-label={g.title}>
                  <h3 className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span aria-hidden className={cn("size-2 rounded-full", DOT_CLS[g.tone])} />{g.title}</h3>
                  <div className="flex flex-col">
                    {items.map((i) => {
                      const block = i.startsWith("block:");
                      const key = block ? i.slice(6) : i;
                      const meta = metaOf(block ? key : "question", block ? undefined : key);
                      const Icon = meta.icon;
                      return (
                        <button key={i} type="button" onClick={() => pick(block ? key : "q:" + key)} data-testid={block ? "add-block-" + key : "add-" + key} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-0.5 text-left text-sm hover:bg-primary-soft sm:min-h-8">
                          <span className={cn(TILE_CLS, "size-6", TONE_CLS[meta.tone])}><Icon size={15} aria-hidden /></span>
                          <span className="min-w-0 truncate">{block ? BLOCK_NAME[key] : kindLabel(key)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ))}
      </div>
    </Popover>
  );
}

/** The line between two blocks. The "+" shows when the mouse is over it, always on touch screens, and as soon as the keyboard reaches it. */
export function InsertBar({ onPick, inGroup, testid }: { onPick: (type: string) => void; inGroup?: boolean; testid: string }) {
  return (
    <div className="group/ins relative flex h-6 items-center justify-center [@media(hover:none)]:h-9">
      <span aria-hidden className="absolute inset-x-6 top-1/2 h-px bg-primary-border opacity-0 transition-opacity group-hover/ins:opacity-100 group-focus-within/ins:opacity-100 [@media(hover:none)]:opacity-100" />
      <TypePicker inGroup={inGroup} onPick={onPick} trigger={
        <button type="button" aria-label="Chèn câu hỏi vào đây" data-testid={testid} className="relative z-10 inline-flex size-6 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-sm transition-opacity hover:bg-primary-hover focus-visible:opacity-100 group-hover/ins:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:size-8 [@media(hover:none)]:opacity-100">
          <Plus size={14} aria-hidden />
        </button>
      } />
    </div>
  );
}
