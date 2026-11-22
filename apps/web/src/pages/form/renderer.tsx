// The filler: one renderer for the editor preview and (7B2) the public page and the internal fill page.
// It shows the form from a `soe-form/1` config and a map of answers (question id -> value). The server decides what is kept (design module7 2.4).
import { Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { ACCENTS, type Block, type FormConfig, isEmptyAnswer, isSelect, type Question, visibleIds, WIDTHS } from "./model";

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
}

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
    case "checkbox": return <input id={id} type="checkbox" className="size-5 self-start" checked={value === true} onChange={(e) => set(e.target.checked)} />;
    case "rating": case "scale": {
      const min = q.input === "rating" ? 1 : (q.scale?.min ?? 1);
      const max = q.input === "rating" ? 5 : (q.scale?.max ?? 5);
      const items = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <div>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={q.label}>
            {items.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={value === n} data-testid={`${q.id}-${n}`} onClick={() => set(value === n ? "" : n)} className={cn("inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-sm sm:min-h-9 sm:min-w-9", (q.input === "rating" ? typeof value === "number" && n <= value : value === n) ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
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
        <div className="flex flex-col gap-1" role="radiogroup" aria-label={q.label}>
          {opts.map((o) => (
            <label key={o.id ?? o.label} className="flex min-h-9 items-center gap-2 text-sm"><input type="radio" name={id} checked={value === o.label} onChange={() => set(o.label)} />{o.label}</label>
          ))}
        </div>
      ) : (
        <Select id={id} value={(value as string) ?? ""} onChange={(e) => set(e.target.value)}><option value="">Chọn…</option>{opts.map((o) => <option key={o.id ?? o.label} value={o.label}>{o.label}</option>)}</Select>
      );
    case "multi_select": {
      const cur = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-1">
          {opts.map((o) => (
            <label key={o.id ?? o.label} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={cur.includes(o.label)} onChange={(e) => set(e.target.checked ? [...cur, o.label] : cur.filter((x) => x !== o.label))} />{o.label}</label>
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

function Render({ b, p, visible }: { b: Block; p: RendererProps; visible: Set<string> }) {
  if (!visible.has(b.id)) return null;
  switch (b.type) {
    case "heading": return <h2 className="mt-2 text-lg font-semibold [overflow-wrap:anywhere]">{String(b.text ?? "")}</h2>;
    case "text": return <p className="whitespace-pre-line text-sm text-muted-foreground [overflow-wrap:anywhere]">{String(b.text ?? "")}</p>;
    case "image": return b.url ? <img src={String(b.url)} alt={String(b.alt ?? "")} className="max-h-72 w-full rounded-md object-contain" /> : null;
    case "divider": return <hr className="border-border" />;
    case "group": return <div className="flex flex-col gap-4 rounded-md border border-border p-3" data-group={b.id}>{b.title ? <h3 className="font-medium">{String(b.title)}</h3> : null}{((b.blocks as Block[]) ?? []).map((c) => <Render key={c.id} b={c} p={p} visible={visible} />)}</div>;
    case "question": {
      const q = b as Question;
      if (q.hidden) return null;
      const err = p.errors?.[q.id];
      return (
        <div className="flex flex-col gap-1" data-question={q.id}>
          <label htmlFor={`q-${q.id}`} className="text-sm font-medium [overflow-wrap:anywhere]">{q.label || "(chưa có nhãn)"}{q.required && <span className="text-bad" aria-hidden> *</span>}</label>
          {q.description && <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{q.description}</span>}
          <QuestionInput q={q} value={p.answers[q.id]} set={(v) => p.onChange({ ...p.answers, [q.id]: v })} renderAttachment={p.renderAttachment} />
          {err && <span role="alert" className="text-xs text-bad">{err}</span>}
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

export function FormRenderer(p: RendererProps) {
  const { config } = p;
  const visible = useMemo(() => visibleIds(config, p.answers), [config, p.answers]);
  const pages = useMemo(() => pagesOf(config.blocks), [config.blocks]);
  const [page, setPage] = useState(0);
  const [pageErr, setPageErr] = useState<Record<string, string>>({});
  const cur = Math.min(page, pages.length - 1);
  const last = cur === pages.length - 1;
  const ap = config.appearance ?? {};
  const accent = ACCENTS[ap.accent ?? "blue"]?.hex ?? ACCENTS.blue!.hex;
  const missing = (list: Block[]) => {
    const e: Record<string, string> = {};
    for (const q of questionsIn(list)) if (q.required && !q.hidden && visible.has(q.id) && isEmptyAnswer(p.answers[q.id]) && q.input !== "checkbox") e[q.id] = "Câu này bắt buộc.";
    return e;
  };
  const next = () => {
    const e = missing(pages[cur]!);
    setPageErr(e);
    if (Object.keys(e).length === 0) setPage(cur + 1);
  };
  const submit = () => {
    const e = missing(config.blocks);
    setPageErr(e);
    if (Object.keys(e).length === 0) p.onSubmit?.();
    else {
      // jump to the first page that holds a missing answer
      const idx = pages.findIndex((pg) => Object.keys(missing(pg)).length > 0);
      if (idx >= 0) setPage(idx);
    }
  };
  const errors = { ...pageErr, ...(p.errors ?? {}) };
  return (
    <div className={cn("mx-auto w-full overflow-hidden rounded-lg border border-border bg-card", WIDTHS[ap.width ?? "medium"])} style={{ ["--form-accent" as string]: accent }} data-testid="form-renderer">
      {ap.cover && <img src={ap.cover} alt="" className="h-32 w-full object-cover" />}
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          {ap.logo && <img src={ap.logo} alt="" className="size-12 rounded object-contain" />}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold [overflow-wrap:anywhere]" style={{ color: accent }}>{config.title || p.fallbackTitle || "Form chưa có tiêu đề"}</h1>
            {config.description && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground [overflow-wrap:anywhere]">{config.description}</p>}
          </div>
        </div>
        {p.banner}
        {pages.length > 1 && (
          <div aria-label={`Trang ${cur + 1} trên ${pages.length}`} data-testid="form-progress">
            <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full" style={{ width: `${((cur + 1) / pages.length) * 100}%`, background: accent }} /></div>
            <p className="mt-1 text-xs text-muted-foreground">Trang {cur + 1} / {pages.length}</p>
          </div>
        )}
        <div className="flex flex-col gap-4">{pages[cur]!.map((b) => <Render key={b.id} b={b} p={{ ...p, errors }} visible={visible} />)}</div>
        <div className="flex flex-wrap justify-between gap-2">
          {cur > 0 ? <Button variant="secondary" onClick={() => setPage(cur - 1)} data-testid="form-back">Quay lại</Button> : <span />}
          {last ? <Button onClick={submit} loading={p.submitting} disabled={!p.onSubmit} style={{ background: accent }} data-testid="form-submit">{p.submitLabel ?? "Gửi"}</Button> : <Button onClick={next} style={{ background: accent }} data-testid="form-next">Tiếp</Button>}
        </div>
      </div>
    </div>
  );
}
export { isSelect };
