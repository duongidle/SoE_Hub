import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button, ErrorText, Input, PageTitle, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { can, useMe } from "@/lib/session";
import { CATEGORY_LABEL, Snippet, TagChips, TYPE_LABEL } from "../library/common";

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
interface Search {
  q: string;
  category: string;
  type: string;
  tag: string;
  sort: string;
}
const qs = (s: Search, limit: number) => {
  const p = new URLSearchParams({ limit: String(limit), sort: s.sort });
  if (s.q) p.set("q", s.q);
  if (s.category) p.set("category", s.category);
  if (s.type) p.set("type", s.type);
  if (s.tag) p.set("tag", s.tag);
  return p.toString();
};

export function ArticleItem({ a }: { a: ArticleCard }) {
  return (
    <li className="rounded-lg border border-border bg-card p-3" data-testid="article-card">
      <Link to="/knowledge/$id" params={{ id: a.id }} className="font-medium text-primary underline [overflow-wrap:anywhere]">{a.title}</Link>
      <div className="text-xs text-muted-foreground">
        {[a.category && CATEGORY_LABEL[a.category], a.type && TYPE_LABEL[a.type], a.author.name, `${a.view_count} lượt xem`].filter(Boolean).join(" · ")}
      </div>
      {a.snippet ? <Snippet html={a.snippet} /> : <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{a.summary}</p>}
      <TagChips tags={a.tags} />
    </li>
  );
}

function Section({ title, s, testid }: { title: string; s: Search; testid: string }) {
  const q = useQuery({ queryKey: ["knowledge", "list", title, s], queryFn: () => api<{ items: ArticleCard[] }>("GET", `/knowledge/search?${qs(s, 6)}`) });
  return (
    <section data-testid={testid}>
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <ErrorText error={q.error} />
      {q.data?.items.length === 0 && <p className="text-sm text-muted-foreground">Chưa có bài nào.</p>}
      <ul className="flex flex-col gap-2">{q.data?.items.map((a) => <ArticleItem key={a.id} a={a} />)}</ul>
    </section>
  );
}

export function KnowledgeHomePage() {
  const me = useMe().data;
  const [text, setText] = useState("");
  const [s, setS] = useState<Search>({ q: "", category: "", type: "", tag: "", sort: "relevance" });
  const filtering = !!(s.q || s.category || s.type || s.tag);
  const res = useQuery({ queryKey: ["knowledge", "search", s], enabled: filtering, queryFn: () => api<{ items: ArticleCard[] }>("GET", `/knowledge/search?${qs(s, 30)}`) });
  const set = (p: Partial<Search>) => setS((x) => ({ ...x, ...p }));
  return (
    <div>
      <PageTitle
        actions={
          can(me, "knowledge:article:post") && (
            <>
              <Link to="/knowledge/cua-toi" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline">Bài của tôi</Link>
              <Link to="/knowledge/soan" className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" data-testid="new-article">Viết bài</Link>
            </>
          )
        }
      >
        Knowledge
      </PageTitle>
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim(), sort: text.trim() ? "relevance" : s.sort }); }}>
        <Input className="min-w-48 flex-1" aria-label="Tìm bài" placeholder="Tìm bài (gõ không dấu cũng được)" value={text} onChange={(e) => setText(e.target.value)} data-testid="kn-search" />
        <Select aria-label="Danh mục" value={s.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">Mọi danh mục</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Loại bài" value={s.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="">Mọi loại</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input className="w-32" aria-label="Thẻ" placeholder="Thẻ" value={s.tag} onChange={(e) => set({ tag: e.target.value.trim().toLowerCase() })} />
        <Select aria-label="Sắp xếp" value={s.sort} onChange={(e) => set({ sort: e.target.value })}>
          <option value="relevance">Độ khớp</option>
          <option value="newest">Mới nhất</option>
          <option value="views">Xem nhiều</option>
        </Select>
        <Button type="submit" data-testid="kn-search-go">Tìm</Button>
      </form>
      {filtering ? (
        <>
          <ErrorText error={res.error} />
          {res.data?.items.length === 0 && <EmptyState title="Không có bài nào khớp" hint="Thử bỏ bớt bộ lọc hoặc đổi từ khoá." />}
          <ul className="flex flex-col gap-2" data-testid="kn-results">{res.data?.items.map((a) => <ArticleItem key={a.id} a={a} />)}</ul>
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Bài mới" s={{ ...s, sort: "newest" }} testid="kn-new" />
          <Section title="Xem nhiều" s={{ ...s, sort: "views" }} testid="kn-top" />
        </div>
      )}
    </div>
  );
}
