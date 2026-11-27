import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Eye, PenLine } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ErrorText, PageTitle, Select } from "@/components/ui/form";
import { PersonChip } from "@/components/ui/person";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { can, useMe } from "@/lib/session";
import { useUrlState } from "@/lib/use-url-state";
import { CATEGORY_LABEL, ChipTabs, LibraryHead, SearchBox, Snippet, TagStrip, TYPE_LABEL } from "../library/common";

export interface ArticleCard {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  category: string | null;
  type: string | null;
  for_sale: boolean;
  author: { id: string; name: string };
  published_at: string | null;
  view_count: number;
  snippet?: string;
}
const DEFAULTS = { q: "", category: "", type: "", tag: "", sort: "relevance" };
type Search = typeof DEFAULTS;
/** Without a search text "độ khớp" means nothing: the list is the newest first. */
const qs = (s: Search, limit: number) => {
  const p = new URLSearchParams({ limit: String(limit), sort: s.q ? s.sort : s.sort === "relevance" ? "newest" : s.sort });
  if (s.q) p.set("q", s.q);
  if (s.category) p.set("category", s.category);
  if (s.type) p.set("type", s.type);
  if (s.tag) p.set("tag", s.tag);
  return p.toString();
};
export const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

export function ArticleItem({ a }: { a: ArticleCard }) {
  return (
    <li className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 shadow-sm" data-testid="article-card">
      <div className="flex flex-wrap items-center gap-1.5">
        {a.category && <Badge tone="primary">{CATEGORY_LABEL[a.category] ?? a.category}</Badge>}
        {a.type && <Badge tone="info">{TYPE_LABEL[a.type] ?? a.type}</Badge>}
        {a.for_sale && <Badge tone="ai">Cho sale</Badge>}
      </div>
      <Link to="/knowledge/$id" params={{ id: a.id }} className="text-base leading-snug font-semibold text-foreground [overflow-wrap:anywhere] hover:text-primary">{a.title}</Link>
      {a.snippet ? <Snippet html={a.snippet} /> : <p className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{a.summary}</p>}
      {a.tags.length > 0 && <div className="flex flex-wrap gap-1">{a.tags.slice(0, 4).map((t) => <Badge key={t}>#{t}</Badge>)}</div>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border-soft pt-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1"><PersonChip person={{ id: a.author.id, full_name: a.author.name }} />{a.published_at && <span>· {shortDate(a.published_at)}</span>}</span>
        <span className="flex items-center gap-1"><Eye size={14} aria-hidden />{a.view_count}</span>
      </div>
    </li>
  );
}

/** "Xem nhiều": the most viewed articles, a numbered list in the right column. */
function TopViewed() {
  const q = useQuery({ queryKey: ["knowledge", "top"], queryFn: () => api<ArticleCard[]>("GET", "/knowledge/search?limit=5&sort=views") });
  if (!q.data?.length) return null;
  return (
    <section className="rounded-card border border-border bg-card p-4 shadow-sm" data-testid="kn-top" aria-label="Xem nhiều">
      <h2 className="mb-2 text-sm font-semibold">Xem nhiều</h2>
      <ol className="flex flex-col gap-3">
        {q.data.map((a, n) => (
          <li key={a.id} className="flex gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{n + 1}</span>
            <div className="min-w-0">
              <Link to="/knowledge/$id" params={{ id: a.id }} className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere] hover:text-primary">{a.title}</Link>
              <div className="text-xs text-muted-foreground">{a.view_count} lượt xem · {a.author.name}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function KnowledgeHomePage() {
  const me = useMe().data;
  const [s, set] = useUrlState(DEFAULTS);
  const [text, setText] = useState(s.tag ? `#${s.tag}` : s.q);
  const res = useQuery({ queryKey: ["knowledge", "search", s], queryFn: () => api<ArticleCard[]>("GET", `/knowledge/search?${qs(s, 30)}`) });
  const tags = useQuery({ queryKey: ["knowledge", "tags", "popular"], queryFn: () => api<{ items: { tag: string; count: number }[] }>("GET", "/knowledge/tags?limit=8") });
  const submit = () => {
    const t = text.trim();
    if (t.startsWith("#")) set({ q: "", tag: t.slice(1).trim().toLowerCase() });
    else set({ q: t, tag: "", sort: t ? "relevance" : s.sort });
  };
  const pickTag = (t: string) => { setText(t ? `#${t}` : ""); set({ tag: t, q: "" }); };
  const total = res.data?.length;
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
      <PageTitle
        actions={
          can(me, "knowledge:article:post") && (
            <>
              <Link to="/knowledge/cua-toi" className="inline-flex min-h-9 items-center px-3 text-sm font-medium text-primary hover:underline">Bài của tôi</Link>
              <Link to="/knowledge/soan" className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover" data-testid="new-article"><PenLine size={14} aria-hidden />Viết bài</Link>
            </>
          )
        }
      >
        Knowledge
      </PageTitle>
      <LibraryHead>
        <SearchBox value={text} onChange={setText} onSubmit={submit} label="Tìm bài" placeholder="Tìm tiêu đề, nội dung (không dấu cũng được) hoặc gõ #thẻ" testid="kn-search" goTestid="kn-search-go" />
        <TagStrip tags={(tags.data?.items ?? []).map((t) => t.tag)} active={s.tag} onPick={pickTag} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-3">
          <ChipTabs label="Danh mục" value={s.category} onChange={(v) => set({ category: v })} items={[{ value: "", label: "Tất cả" }, ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))]} />
          <div className="flex flex-wrap gap-2">
            <Select className="sm:w-56" aria-label="Loại bài" value={s.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">Loại: tất cả</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select className="sm:w-56" aria-label="Sắp xếp" value={s.sort} onChange={(e) => set({ sort: e.target.value })}>
              <option value="relevance">Sắp xếp: độ khớp / mới nhất</option>
              <option value="newest">Mới nhất</option>
              <option value="views">Xem nhiều</option>
            </Select>
          </div>
        </div>
      </LibraryHead>
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          <ErrorText error={res.error} />
          {total === 0 && <EmptyState title="Không có bài nào khớp" hint="Thử bỏ bớt bộ lọc hoặc đổi từ khoá." />}
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="kn-results">{res.data?.map((a) => <ArticleItem key={a.id} a={a} />)}</ul>
        </div>
        <TopViewed />
      </div>
    </div>
  );
}
