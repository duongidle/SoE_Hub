// The filler: one renderer for the editor preview and (7B2) the public page and the internal fill page.
// It shows the form from a `soe-form/1` config and a map of answers (question id -> value). The server decides what is kept (design module7 2.4).
import { ArrowRight, Check, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { ACCENTS, type Block, type FormConfig, isEmptyAnswer, isSelect, QUESTION_KINDS, type Question, visibleIds } from "./model";

export interface RendererProps {
  config: FormConfig;
  answers: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Called on the last page's button. Without it the button is shown disabled (preview). */
  onSubmit?: () => void;
  submitting?: boolean;
  submitLabel?: string;
  /** Errors by question id (from the server), shown under the question. */
  errors?: Record<string, string>;
  /** Replaces the file box of an `attachment` question (7B2 uploads). */
  renderAttachment?: (q: Question, value: unknown, set: (v: unknown) => void) => React.ReactNode;
  /** Shown above the first page, under the title. */
  banner?: React.ReactNode;
  /** The form's name when the config has no title. */
  fallbackTitle?: string;
  /** "fill" is the real page (aside with the question map and the submit button, pinned to the bottom on a phone); "preview" is the editor's frame. */
  mode?: "fill" | "preview";
  /** Chip on the cover strip (fill): what kind of form this is. */
  chip?: string;
  /** Card under the description: who is filling. */
  filler?: React.ReactNode;
  /** "Đã lưu nháp lúc …" (fill). */
  draftNote?: string | null;
}

/** The accent color of a form (a fixed palette, design module7 2). */
export const accentOf = (config: FormConfig): string => ACCENTS[config.appearance?.accent ?? "blue"]?.hex ?? ACCENTS.blue!.hex;

/** Visible, non-hidden questions in order, and how many are answered: the number the top bar and the question map show. */
export function formProgress(config: FormConfig, answers: Record<string, unknown>): { done: number; total: number } {
  const visible = visibleIds(config, answers);
  const qs = questionsIn(config.blocks).filter((q) => !q.hidden && visible.has(q.id));
  return { done: qs.filter((q) => !isEmptyAnswer(answers[q.id])).length, total: qs.length };
}

/** Wide, tappable row of a choice (the whole row is the label). */
const ROW = "flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-border bg-card px-3.5 py-2.5 text-sm transition-colors hover:border-primary-border has-[:checked]:border-(--form-accent) has-[:checked]:bg-primary-soft";
const TICK = "size-5 shrink-0 accent-(--form-accent)";

/** `dd/mm/yyyy` <-> `YYYY-MM-DD` (the filler never uses the browser's date box, design module7 2.3). */
function DateText({ value, onChange, withTime, id }: { value: unknown; onChange: (v: string) => void; withTime: boolean; id: string }) {
  const [text, setText] = useState(() => {
    const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value) : null;
    return m ? `${m[3]}/${m[2]}/${m[1]}${withTime && m[4] ? ` ${m[4]}:${m[5]}` : ""}` : "";
  });
  const parse = (t: string): string => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}))?$/.exec(t.trim());
    if (!m) return "";
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "";
    const day = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!withTime) return day;
    // Vietnam time (UTC+7)
    const h = Number(m[4] ?? 0), mi = Number(m[5] ?? 0);
    return new Date(Date.UTC(y, mo - 1, d, h - 7, mi)).toISOString();
  };
  const bad = text.trim() !== "" && parse(text) === "";
  return (
    <>
      <Input id={id} inputMode="numeric" placeholder={withTime ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy"} value={text} aria-invalid={bad} onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }} />
      {bad && <span className="text-xs text-bad">Nhập theo dạng {withTime ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy"}.</span>}
    </>
  );
}

function QuestionInput({ q, value, set, renderAttachment }: { q: Question; value: unknown; set: (v: unknown) => void; renderAttachment?: RendererProps["renderAttachment"] }) {
  const id = `q-${q.id}`;
  const opts = q.options ?? [];
  switch (q.input) {
    case "long_text": return <Textarea id={id} rows={4} value={(value as string) ?? ""} placeholder={q.hint} onChange={(e) => set(e.target.value)} />;
    case "number": case "currency": case "percent":
      return <Input id={id} inputMode="decimal" value={value === undefined || value === null ? "" : String(value)} placeholder={q.hint} onChange={(e) => { const t = e.target.value.replace(",", "."); set(t === "" ? "" : Number.isFinite(Number(t)) ? Number(t) : t); }} />;
    case "date": return <DateText id={id} value={value} onChange={set} withTime={false} />;
    case "datetime": return <DateText id={id} value={value} onChange={set} withTime />;
    case "checkbox": return <input id={id} type="checkbox" className={cn(TICK, "self-start")} checked={value === true} onChange={(e) => set(e.target.checked)} />;
    case "rating": case "scale": {
      const min = q.input === "rating" ? 1 : (q.scale?.min ?? 1);
      const max = q.input === "rating" ? 5 : (q.scale?.max ?? 5);
      const items = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <div>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={q.label}>
            {items.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={value === n} data-testid={`${q.id}-${n}`} onClick={() => set(value === n ? "" : n)} className={cn("inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-sm sm:min-h-9 sm:min-w-9", (q.input === "rating" ? typeof value === "number" && n <= value : value === n) ? "border-(--form-accent) bg-(--form-accent) text-white" : "bg-card hover:bg-primary-soft")}>
                {q.input === "rating" ? <Star size={16} aria-label={`${n} sao`} /> : n}
              </button>
            ))}
          </div>
          {q.input === "scale" && (q.scale?.min_label || q.scale?.max_label) && <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{q.scale?.min_label}</span><span>{q.scale?.max_label}</span></div>}
        </div>
      );
    }
    case "single_select":
      return opts.length <= 6 ? (
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={q.label}>
          {opts.map((o) => (
            <label key={o.id ?? o.label} className={ROW}><input type="radio" className={TICK} name={id} checked={value === (o.id ?? o.label)} onChange={() => set(o.id ?? o.label)} /><span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span></label>
          ))}
        </div>
      ) : (
        <Select id={id} value={(value as string) ?? ""} onChange={(e) => set(e.target.value)}><option value="">Chọn…</option>{opts.map((o) => <option key={o.id ?? o.label} value={o.id ?? o.label}>{o.label}</option>)}</Select>
      );
    case "multi_select": {
      const cur = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-2">
          {opts.map((o) => (
            <label key={o.id ?? o.label} className={ROW}><input type="checkbox" className={TICK} checked={cur.includes(o.id ?? o.label)} onChange={(e) => set(e.target.checked ? [...cur, o.id ?? o.label] : cur.filter((x) => x !== (o.id ?? o.label)))} /><span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span></label>
          ))}
        </div>
      );
    }
    case "email": return <Input id={id} type="email" autoComplete="email" value={(value as string) ?? ""} placeholder={q.hint} onChange={(e) => set(e.target.value)} />;
    case "phone": return <Input id={id} type="tel" inputMode="tel" value={(value as string) ?? ""} placeholder={q.hint} onChange={(e) => set(e.target.value)} />;
    case "url": return <Input id={id} type="url" inputMode="url" value={(value as string) ?? ""} placeholder={q.hint ?? "https://"} onChange={(e) => set(e.target.value)} />;
    case "attachment": return renderAttachment ? <>{renderAttachment(q, value, set)}</> : <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">Ô tải file (hiện khi điền thật).</p>;
    case "user": case "relation": return <Input id={id} disabled placeholder={q.input === "user" ? "Chọn người trong hệ thống" : "Chọn dòng của bảng"} />;
    default: return <Input id={id} value={(value as string) ?? ""} placeholder={q.hint} maxLength={2000} onChange={(e) => set(e.target.value)} />;
  }
}

interface Ctx extends RendererProps {
  nums: Map<string, number>;
  active: string | null;
  setActive: (id: string) => void;
  groups: Map<string, number>;
  groupTotal: number;
}

const kindLabel = (input: string) => QUESTION_KINDS.find((k) => k.input === input)?.label ?? input;

function Render({ b, p, visible }: { b: Block; p: Ctx; visible: Set<string> }) {
  if (!visible.has(b.id)) return null;
  switch (b.type) {
    case "heading": return <h2 className="mt-2 px-1 text-lg font-semibold [overflow-wrap:anywhere]">{String(b.text ?? "")}</h2>;
    case "text": return <p className="whitespace-pre-line px-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{String(b.text ?? "")}</p>;
    case "image": return b.url ? <img src={String(b.url)} alt={String(b.alt ?? "")} className="max-h-72 w-full rounded-card object-contain" /> : null;
    case "divider": return <hr className="border-border" />;
    case "group": {
      const kids = (b.blocks as Block[]) ?? [];
      const n = questionsIn(kids).filter((q) => !q.hidden && visible.has(q.id)).length;
      const idx = p.groups.get(b.id);
      return (
        <section className="flex flex-col gap-4" data-group={b.id}>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-card border border-border bg-card/80 px-4 py-3">
            <div className="min-w-0">
              {idx !== undefined && <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--form-accent)" }}>Phần {idx} / {p.groupTotal}</div>}
              {b.title ? <h3 className="text-base font-semibold [overflow-wrap:anywhere]">{String(b.title)}</h3> : null}
            </div>
            <span className="text-xs text-muted-foreground">{n} câu</span>
          </div>
          {kids.map((c) => <Render key={c.id} b={c} p={p} visible={visible} />)}
        </section>
      );
    }
    case "question": {
      const q = b as Question;
      if (q.hidden) return null;
      const err = p.errors?.[q.id];
      return (
        <div
          className={cn("flex scroll-mb-28 scroll-mt-24 flex-col gap-2 rounded-card border bg-card p-4 shadow-card transition-colors sm:p-5", err ? "border-bad-border" : p.active === q.id ? "border-primary-border ring-2 ring-primary/10" : "border-border")}
          data-question={q.id}
          onFocusCapture={() => p.setActive(q.id)}
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-md bg-primary-soft px-2 py-0.5 font-semibold text-primary">Câu {p.nums.get(q.id)}</span>
            <span className="text-muted-foreground">{kindLabel(q.input)}</span>
            {q.required && <span className="ml-auto font-medium text-bad">Bắt buộc *</span>}
          </div>
          <label htmlFor={"q-" + q.id} className="text-base font-semibold [overflow-wrap:anywhere]">{q.label || "(chưa có nhãn)"}</label>
          {q.description && <span className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{q.description}</span>}
          <div className="mt-1 flex flex-col gap-2">
            <QuestionInput q={q} value={p.answers[q.id]} set={(v) => p.onChange({ ...p.answers, [q.id]: v })} renderAttachment={p.renderAttachment} />
          </div>
          {err && <span role="alert" className="text-sm text-bad">{err}</span>}
        </div>
      );
    }
    default: return null;
  }
}

/** Top-level blocks cut into pages at each page break. */
function pagesOf(blocks: Block[]): Block[][] {
  const pages: Block[][] = [[]];
  for (const b of blocks) {
    if (b.type === "page_break") pages.push([]);
    else pages[pages.length - 1]!.push(b);
  }
  return pages;
}
const questionsIn = (list: Block[]): Question[] => list.flatMap((b) => (b.type === "question" ? [b as Question] : b.type === "group" ? questionsIn((b.blocks as Block[]) ?? []) : []));

/** Container widths of the real page (the main column plus the aside); the editor preview keeps the narrow frame. */
const FILL_WIDTHS = { narrow: "lg:max-w-3xl", medium: "lg:max-w-4xl", wide: "lg:max-w-6xl" } as const;
const PREVIEW_WIDTHS = { narrow: "max-w-md", medium: "max-w-2xl", wide: "max-w-4xl" } as const;

export function FormRenderer(p: RendererProps) {
  const { config } = p;
  const fill = p.mode === "fill";
  const visible = useMemo(() => visibleIds(config, p.answers), [config, p.answers]);
  const pages = useMemo(() => pagesOf(config.blocks), [config.blocks]);
  const [page, setPage] = useState(0);
  const [pageErr, setPageErr] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [jump, setJump] = useState<{ id: string } | null>(null);
  const handled = useRef<object | null>(null);
  const cur = Math.min(page, pages.length - 1);
  const last = cur === pages.length - 1;
  const ap = config.appearance ?? {};
  const accent = accentOf(config);
  const qs = useMemo(() => questionsIn(config.blocks).filter((q) => !q.hidden && visible.has(q.id)), [config.blocks, visible]);
  const nums = useMemo(() => new Map(qs.map((q, i) => [q.id, i + 1] as const)), [qs]);
  const groupIds = useMemo(() => config.blocks.filter((b) => b.type === "group"), [config.blocks]);
  const groups = useMemo(() => new Map(groupIds.map((g, i) => [g.id, i + 1] as const)), [groupIds]);
  const active = activeId ?? qs[0]?.id ?? null;
  const done = qs.filter((q) => !isEmptyAnswer(p.answers[q.id])).length;
  const pageOf = (id: string) => pages.findIndex((pg) => questionsIn(pg).some((q) => q.id === id));

  // A tap on the question map (or a missing answer) shows the page of that question, scrolls to it and puts the cursor in it.
  useEffect(() => {
    if (!jump || handled.current === jump) return;
    const el = document.querySelector<HTMLElement>('[data-question="' + CSS.escape(jump.id) + '"]');
    if (!el) return;
    handled.current = jump;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
    el.querySelector<HTMLElement>("input,textarea,select,button[role=radio]")?.focus({ preventScroll: true });
  }, [jump, cur]);
  const jumpTo = (id: string) => setJump({ id });
  const goTo = (id: string) => {
    const pg = pageOf(id);
    if (pg >= 0) setPage(pg);
    jumpTo(id);
  };

  const missing = (list: Block[]) => {
    const e: Record<string, string> = {};
    for (const q of questionsIn(list)) if (q.required && !q.hidden && visible.has(q.id) && isEmptyAnswer(p.answers[q.id]) && q.input !== "checkbox") e[q.id] = "Câu này bắt buộc.";
    return e;
  };
  const next = () => {
    const e = missing(pages[cur]!);
    setPageErr(e);
    if (Object.keys(e).length === 0) setPage(cur + 1);
    else jumpTo(Object.keys(e)[0]!);
  };
  const submit = () => {
    const e = missing(config.blocks);
    setPageErr(e);
    if (Object.keys(e).length === 0) p.onSubmit?.();
    else {
      // jump to the first page that holds a missing answer
      const idx = pages.findIndex((pg) => Object.keys(missing(pg)).length > 0);
      if (idx >= 0) setPage(idx);
      const first = Object.keys(missing(pages[idx >= 0 ? idx : 0]!))[0];
      if (first) jumpTo(first);
    }
  };
  const errors = { ...pageErr, ...(p.errors ?? {}) };
  const ctx: Ctx = { ...p, errors, nums, active, setActive: setActiveId, groups, groupTotal: groupIds.length };

  const actions = (
    <div className="flex gap-2">
      {cur > 0 && <Button variant="secondary" onClick={() => setPage(cur - 1)} data-testid="form-back">Quay lại</Button>}
      {last ? (
        <Button className="flex-1" onClick={submit} loading={p.submitting} disabled={!p.onSubmit} style={{ background: accent }} data-testid="form-submit">{p.submitLabel ?? "Gửi"}{fill && <ArrowRight size={16} aria-hidden />}</Button>
      ) : (
        <Button className="flex-1" onClick={next} style={{ background: accent }} data-testid="form-next">Tiếp<ArrowRight size={16} aria-hidden /></Button>
      )}
    </div>
  );

  const hero = (
    <div className="overflow-hidden rounded-card border border-border bg-card shadow-card">
      <div className="relative">
        {ap.cover ? <img src={ap.cover} alt="" className="h-32 w-full object-cover" /> : <div className="h-[72px]" style={{ background: "linear-gradient(120deg, " + accent + ", color-mix(in srgb, " + accent + " 55%, #ffffff))" }} aria-hidden />}
        {p.chip && <span className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/25 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/40">{p.chip}</span>}
      </div>
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          {ap.logo && <img src={ap.logo} alt="" className="size-12 rounded object-contain" />}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]" style={{ color: accent }}>{config.title || p.fallbackTitle || "Form chưa có tiêu đề"}</h1>
            {config.description && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground [overflow-wrap:anywhere]">{config.description}</p>}
          </div>
        </div>
        {p.filler}
        {p.banner}
      </div>
    </div>
  );

  const body = (
    <div className="flex min-w-0 flex-col gap-4">
      {hero}
      {pages.length > 1 && (
        <div aria-label={"Trang " + (cur + 1) + " trên " + pages.length} data-testid="form-progress" className="px-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-border-soft"><div className="h-full rounded-full" style={{ width: ((cur + 1) / pages.length) * 100 + "%", background: accent }} /></div>
          <p className="mt-1 text-xs text-muted-foreground">Trang {cur + 1} / {pages.length}</p>
        </div>
      )}
      <div className="flex flex-col gap-4">{pages[cur]!.map((b) => <Render key={b.id} b={b} p={ctx} visible={visible} />)}</div>
      {!fill && <div className="flex justify-end">{actions}</div>}
    </div>
  );

  if (!fill) {
    return (
      <div className={cn("mx-auto w-full", PREVIEW_WIDTHS[ap.width ?? "medium"])} style={{ ["--form-accent" as string]: accent }} data-testid="form-renderer">{body}</div>
    );
  }
  return (
    <div className={cn("mx-auto grid w-full items-start gap-4 pb-28 lg:grid-cols-[minmax(0,1fr)_240px] lg:pb-0", FILL_WIDTHS[ap.width ?? "medium"])} style={{ ["--form-accent" as string]: accent }} data-testid="form-renderer">
      {body}
      <aside className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/90 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-20 lg:rounded-card lg:border lg:bg-card lg:p-4 lg:shadow-card lg:backdrop-blur-none" data-testid="form-aside">
        <div className="mb-3 hidden flex-col gap-3 lg:flex">
          {p.draftNote && <p className="flex items-center gap-1.5 rounded-control border border-ok-border bg-ok-bg px-2.5 py-1.5 text-xs text-ok" data-testid="draft-note"><Check size={14} aria-hidden />{p.draftNote}</p>}
          <div className="flex items-baseline justify-between"><h2 className="text-sm font-semibold">Bản đồ câu hỏi</h2><span className="text-xs font-semibold text-primary tabular-nums">{done}/{qs.length}</span></div>
          <div className="grid grid-cols-4 gap-1.5" data-testid="question-map">
            {qs.map((q) => {
              const answered = !isEmptyAnswer(p.answers[q.id]);
              return (
                <button key={q.id} type="button" onClick={() => goTo(q.id)} aria-label={"Tới câu " + nums.get(q.id) + (answered ? " (đã làm)" : "")} aria-current={active === q.id ? "true" : undefined} className={cn("h-9 rounded-md border text-sm font-medium tabular-nums transition-colors", active === q.id ? "border-2 border-(--form-accent) bg-card text-foreground" : answered ? "border-transparent bg-(--form-accent) text-white" : "border-border bg-muted text-muted-foreground hover:border-primary-border")}>{nums.get(q.id)}</button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-(--form-accent)" />Đã làm</span>
            <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full border-2 border-(--form-accent)" />Đang xem</span>
            <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full border border-border bg-muted" />Trống</span>
          </div>
        </div>
        {actions}
      </aside>
    </div>
  );
}
export { isSelect };
