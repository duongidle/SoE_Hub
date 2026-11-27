import { Link } from "@tanstack/react-router";
import { Check, Copy, Search } from "lucide-react";
import { useState } from "react";
import Image from "@tiptap/extension-image";
import Link2 from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/form";
import { notify } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/** One finding of the automatic check (design module8 3.4, 4.2). `path` points at the field (article) or the file (skill). */
export interface Issue {
  code: string;
  message: string;
  path: string;
  hint?: string;
}
export interface CheckResult {
  errors: Issue[];
  warnings: Issue[];
}

/** Errors and warnings of a rejected submit (`validation_error` details) as a CheckResult, or null for any other error. */
export function issuesOf(e: unknown): CheckResult | null {
  if (!(e instanceof ApiError) || e.code !== "validation_error") return null;
  const d = e.details as { errors?: Issue[]; warnings?: Issue[] } | undefined;
  return d?.errors ? { errors: d.errors, warnings: d.warnings ?? [] } : null;
}

/** Findings that belong to one field (or all of them when `path` is omitted), shown right under the field. */
export function IssueList({ check, path, all }: { check: CheckResult | null; path?: string; all?: boolean }) {
  if (!check) return null;
  const match = (i: Issue) => (all ? true : path !== undefined && (i.path === path || i.path.startsWith(`${path}#`) || i.path.startsWith(`${path}.`)));
  const errors = check.errors.filter(match);
  const warnings = check.warnings.filter(match);
  if (!errors.length && !warnings.length) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs" data-testid={`issues-${path ?? "all"}`}>
      {errors.map((i, n) => (
        <li key={`e${n}`} role="alert" className="rounded-md bg-bad/10 px-2 py-1 text-bad">
          <b>Lỗi{all && i.path ? ` (${i.path})` : ""}:</b> {i.message}{i.hint ? ` ${i.hint}` : ""}
        </li>
      ))}
      {warnings.map((i, n) => (
        <li key={`w${n}`} className="rounded-md bg-warn/20 px-2 py-1">
          <b>Cảnh báo{all && i.path ? ` (${i.path})` : ""}:</b> {i.message}{i.hint ? ` ${i.hint}` : ""}
        </li>
      ))}
    </ul>
  );
}

/** Findings that no field of the form shows (the path is not one of `fields`). */
export function otherIssues(check: CheckResult | null, fields: string[]): CheckResult | null {
  if (!check) return null;
  const known = (i: Issue) => fields.some((f) => i.path === f || i.path.startsWith(`${f}#`) || i.path.startsWith(`${f}.`));
  return { errors: check.errors.filter((i) => !known(i)), warnings: check.warnings.filter((i) => !known(i)) };
}

const STATE_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  draft: { label: "Nháp", tone: "muted" },
  pending: { label: "Chờ duyệt", tone: "warn" },
  returned: { label: "Bị trả lại", tone: "bad" },
  published: { label: "Đã xuất bản", tone: "ok" },
  archived: { label: "Đã lưu trữ", tone: "muted" },
  superseded: { label: "Đã thay thế", tone: "muted" },
};
export function StateBadge({ state }: { state: string }) {
  const s = STATE_LABEL[state] ?? { label: state, tone: "muted" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'" };
/** The server's search snippet is HTML-escaped with only `<b>` allowed: render it as text with bold parts, never as HTML. */
export function Snippet({ html }: { html: string }) {
  const parts = html.split(/(<b>|<\/b>)/);
  let bold = false;
  const out: React.ReactNode[] = [];
  parts.forEach((p, n) => {
    if (p === "<b>") bold = true;
    else if (p === "</b>") bold = false;
    else if (p) {
      const text = p.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
      out.push(bold ? <b key={n}>{text}</b> : <span key={n}>{text}</span>);
    }
  });
  return <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="snippet">{out}</p>;
}

export const EDITOR_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [2, 3] } }),
  Link2.configure({ openOnClick: false, autolink: true }),
  Image,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];

/** Tiptap document, read only. */
export function RichView({ doc }: { doc: JSONContent | null }) {
  const editor = useEditor({ extensions: EDITOR_EXTENSIONS, content: doc ?? "", editable: false, editorProps: { attributes: { class: "tiptap-doc" } } }, [doc]);
  return <EditorContent editor={editor} data-testid="rich-view" />;
}

/** Headings (level 2-3) of a Tiptap document, for the table of contents. */
export function headingsOf(doc: JSONContent | null): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "heading") out.push({ level: Number(n.attrs?.level ?? 2), text: (n.content ?? []).map((c) => c.text ?? "").join("") });
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out.filter((h) => h.text);
}

export const GROUP_LABEL: Record<string, string> = { sales: "Sales", data: "Data", docs: "Tài liệu", dev: "Lập trình", other: "Khác" };
export const CLIENT_LABEL: Record<string, string> = { claude_code: "Claude Code", claude_desktop: "Claude Desktop", claude_ai: "claude.ai", other: "Khác" };
export const CATEGORY_LABEL: Record<string, string> = { base_app: "Ứng dụng Base", business: "Nghiệp vụ" };
export const TYPE_LABEL: Record<string, string> = { guide: "Hướng dẫn", use_case: "Use case" };

export function TagChips({ tags }: { tags: string[] }) {
  if (!tags?.length) return null;
  return <span className="flex flex-wrap gap-1">{tags.map((t) => <Badge key={t}>{t}</Badge>)}</span>;
}

export const BackLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <Link to={to} className="inline-flex min-h-9 items-center text-sm text-primary underline">{children}</Link>
);

/** The white card that opens a library page: one search box, popular tags, then the tabs and filters passed as children. */
export function LibraryHead({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm">{children}</div>;
}

/** One search box: type and press Enter (or "Tìm"). The parent decides what "#tag" means. */
export function SearchBox({ value, onChange, onSubmit, placeholder, label, testid, goTestid }: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string; label: string; testid: string; goTestid?: string }) {
  return (
    <form role="search" className="flex h-11 items-center gap-2 rounded-xl border border-border bg-card pr-1.5 pl-3 focus-within:border-primary" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <Search size={18} aria-hidden className="shrink-0 text-muted-foreground" />
      <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
      <Button type="submit" variant="secondary" className="!min-h-8 shrink-0" data-testid={goTestid}>Tìm</Button>
    </form>
  );
}

/** "Thẻ phổ biến": a click filters by that tag, a second click clears it. */
export function TagStrip({ tags, active, onPick }: { tags: string[]; active: string; onPick: (t: string) => void }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="popular-tags">
      <span className="text-muted-foreground">Thẻ phổ biến:</span>
      {tags.map((t) => (
        <button key={t} type="button" aria-pressed={active === t} onClick={() => onPick(active === t ? "" : t)}
          className={cn("min-h-8 rounded-full border px-2.5 text-xs font-medium transition-colors", active === t ? "border-primary-border bg-primary-soft text-primary" : "border-border-soft bg-muted text-muted-foreground hover:text-foreground")}>#{t}</button>
      ))}
    </div>
  );
}

/** Category tabs: one tap, the active one is a soft indigo chip. Scrolls sideways on a phone. */
export function ChipTabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex max-w-full gap-1 overflow-x-auto">
      {items.map((i) => (
        <button key={i.value} type="button" role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)}
          className={cn("min-h-9 shrink-0 whitespace-nowrap rounded-[10px] px-3 text-sm transition-colors", value === i.value ? "bg-primary-soft font-semibold text-primary" : "text-muted-foreground hover:text-foreground")}>{i.label}</button>
      ))}
    </div>
  );
}

/** Copies a text; the label turns to "Đã chép" for a moment. `getText` may fetch it first. */
export function CopyButton({ getText, children, className, variant = "secondary", testid }: { getText: () => string | Promise<string>; children: React.ReactNode; className?: string; variant?: "primary" | "secondary" | "ghost"; testid?: string }) {
  const [done, setDone] = useState(false);
  const run = async () => {
    try {
      await navigator.clipboard.writeText(await getText());
      notify.ok("Đã sao chép lệnh");
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      notify.error("Không sao chép được, hãy chọn và chép tay");
    }
  };
  return (
    <Button type="button" variant={variant} className={className} onClick={() => void run()} data-testid={testid}>
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {done ? "Đã chép" : children}
    </Button>
  );
}

/** A frame that shows a few lines of text in the code font (the start of SKILL.md, a command). */
export function CodeFrame({ children, label, className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border-soft bg-muted px-3 py-2", className)}>
      {label && <div className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>}
      <div className="font-mono text-xs leading-relaxed text-foreground/80 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}
