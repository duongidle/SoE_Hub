import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/react";
import { Eye } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PersonChip } from "@/components/ui/person";
import { Button, ConfirmDialog, ErrorText } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, fmtTime } from "@/lib/api";
import { CATEGORY_LABEL, headingsOf, RichView, StateBadge, TagChips, TYPE_LABEL } from "../library/common";
import type { ArticleCard } from "./home";

export interface ArticleDetail {
  id: string;
  state: string;
  author: { id: string; name: string };
  published_at: string | null;
  updated_at: string | null;
  view_count: number;
  content: { title: string; summary: string; body: JSONContent | null; category: string | null; type: string | null; tags: string[]; for_sale: boolean };
  is_author: boolean;
  can_review: boolean;
  working: { version: number; status: string } | null;
  attachments: { id: string; filename: string; size_bytes: number }[];
}

export function ArticlePage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const nav = useNavigate();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<"unpublish" | "archive" | null>(null);
  const q = useQuery({ queryKey: ["knowledge", "article", id], queryFn: () => api<ArticleDetail>("GET", `/knowledge/articles/${id}`) });
  const rel = useQuery({ queryKey: ["knowledge", "related", id], queryFn: () => api<{ items: ArticleCard[] }>("GET", `/knowledge/articles/${id}/related`) });
  const act = useMutation({
    mutationFn: (op: "unpublish" | "archive") => api("POST", `/posts/${id}/${op}`, {}),
    onSuccess: (_d, op) => {
      void qc.invalidateQueries({ queryKey: ["knowledge"] });
      notify.ok(op === "unpublish" ? "Đã gỡ xuất bản" : "Đã lưu trữ bài");
      void nav({ to: "/knowledge" });
    },
  });
  const download = async (fileId: string) => {
    const r = await api<{ url: string }>("GET", `/posts/${id}/files/${fileId}/download-url`);
    window.open(r.url, "_blank", "noopener");
  };
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data;
  if (!a) return <p className="text-sm text-muted-foreground">Đang tải...</p>;
  const c = a.content;
  const heads = headingsOf(c.body);
  return (
    <div className="mx-auto max-w-[1100px]">
      <article className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 rounded-card border border-border bg-card p-5 shadow-sm sm:p-8">
          <div className="mx-auto max-w-[72ch]">
            <div className="flex flex-wrap items-center gap-1.5">
              {c.category && <Badge tone="primary">{CATEGORY_LABEL[c.category] ?? c.category}</Badge>}
              {c.type && <Badge tone="info">{TYPE_LABEL[c.type] ?? c.type}</Badge>}
              {c.for_sale && <Badge tone="ai">Cho sale</Badge>}
              {a.state !== "published" && <StateBadge state={a.state} />}
            </div>
            <h1 className="mt-3 text-2xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-3xl" data-testid="article-title">{c.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-testid="article-meta">
              <PersonChip person={{ id: a.author.id, full_name: a.author.name }} />
              {a.published_at && <span>Xuất bản {fmtTime(a.published_at)}</span>}
              {a.updated_at && <span>Cập nhật {fmtTime(a.updated_at)}</span>}
              <span className="inline-flex items-center gap-1"><Eye size={14} aria-hidden />{a.view_count} lượt xem</span>
            </div>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{c.summary}</p>
            <div className="mt-3"><TagChips tags={c.tags} /></div>
            <div className="mt-5 border-t border-border-soft pt-5"><RichView doc={c.body} /></div>
            {a.attachments.length > 0 && (
              <section className="mt-6 border-t border-border-soft pt-4">
                <h2 className="mb-1 text-base font-semibold">File đính kèm</h2>
                <ul className="text-sm">
                  {a.attachments.map((f) => (
                    <li key={f.id}><button type="button" className="min-h-9 text-primary underline" onClick={() => void download(f.id)}>{f.filename}</button> <span className="text-muted-foreground">({Math.ceil(f.size_bytes / 1024)} KB)</span></li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
        <aside className="flex flex-col gap-4 text-sm lg:sticky lg:top-2">
          {(a.is_author || a.can_review) && (
            <div className="flex flex-wrap gap-2">
              {a.is_author && <Link to="/knowledge/soan/$id" params={{ id }} className="inline-flex min-h-9 items-center rounded-md border border-border bg-card px-3 font-medium hover:bg-primary-soft">Sửa</Link>}
              {a.can_review && <Button variant="secondary" onClick={() => setConfirm("unpublish")} data-testid="unpublish">Gỡ xuất bản</Button>}
              <Button variant="secondary" onClick={() => setConfirm("archive")} data-testid="archive">Lưu trữ</Button>
            </div>
          )}
          {heads.length >= 3 && (
            <nav aria-label="Mục lục" data-testid="toc" className="rounded-card border border-border bg-card p-4 shadow-sm">
              <h2 className="mb-1 font-semibold">Mục lục</h2>
              <ul className="flex flex-col gap-0.5">{heads.map((h, n) => <li key={n} className={h.level === 3 ? "pl-3" : ""}><button type="button" className="min-h-8 text-left text-muted-foreground hover:text-primary" onClick={() => [...document.querySelectorAll("[data-testid=rich-view] h2, [data-testid=rich-view] h3")].find((e) => e.textContent === h.text)?.scrollIntoView({ behavior: "smooth" })}>{h.text}</button></li>)}</ul>
            </nav>
          )}
          {!!rel.data?.items.length && (
            <section data-testid="related" className="rounded-card border border-border bg-card p-4 shadow-sm">
              <h2 className="mb-1 font-semibold">Bài liên quan</h2>
              <ul className="flex flex-col gap-1.5">{rel.data.items.map((r) => <li key={r.id}><Link to="/knowledge/$id" params={{ id: r.id }} className="[overflow-wrap:anywhere] text-primary hover:underline">{r.title}</Link></li>)}</ul>
            </section>
          )}
        </aside>
      </article>
      <ErrorText error={act.error} />
      {confirm && (
        <ConfirmDialog
          title={confirm === "unpublish" ? "Gỡ xuất bản bài này?" : "Lưu trữ bài này?"}
          message={confirm === "unpublish" ? "Bài về lại nháp của tác giả, người đọc không thấy nữa." : "Bài ẩn khỏi danh sách và tìm kiếm. Có thể khôi phục ở Bài của tôi."}
          confirmLabel={confirm === "unpublish" ? "Gỡ xuất bản" : "Lưu trữ"}
          busy={act.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => act.mutate(confirm)}
        />
      )}
    </div>
  );
}
