import { Link } from "@tanstack/react-router";
import Image from "@tiptap/extension-image";
import Link2 from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";

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
