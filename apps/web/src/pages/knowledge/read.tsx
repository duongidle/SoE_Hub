import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type { JSONContent } from "@tiptap/react";
import { useState } from "react";
import { Button, ConfirmDialog, ErrorText } from "@/components/ui/form";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, fmtTime } from "@/lib/api";
import { BackLink, CATEGORY_LABEL, headingsOf, RichView, StateBadge, TagChips, TYPE_LABEL } from "../library/common";
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
    <div>
      <BackLink to="/knowledge">Knowledge</BackLink>
      <article className="mt-2 grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]" data-testid="article-title">{c.title}</h1>
            {a.state !== "published" && <StateBadge state={a.state} />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {[a.author.name, a.published_at && `Xuất bản ${fmtTime(a.published_at)}`, a.updated_at && `Cập nhật ${fmtTime(a.updated_at)}`, `${a.view_count} lượt xem`, c.category && CATEGORY_LABEL[c.category], c.type && TYPE_LABEL[c.type]].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-3 text-base text-muted-foreground [overflow-wrap:anywhere]">{c.summary}</p>
          <TagChips tags={c.tags} />
          <div className="mt-4"><RichView doc={c.body} /></div>
          {a.attachments.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-1 text-base font-semibold">File đính kèm</h2>
              <ul className="text-sm">
                {a.attachments.map((f) => (
                  <li key={f.id}><button type="button" className="min-h-9 text-primary underline" onClick={() => void download(f.id)}>{f.filename}</button> <span className="text-muted-foreground">({Math.ceil(f.size_bytes / 1024)} KB)</span></li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {a.is_author && <Link to="/knowledge/soan/$id" params={{ id }} className="inline-flex min-h-9 items-center rounded-md border border-border px-3">Sửa</Link>}
            {a.can_review && <Button variant="secondary" onClick={() => setConfirm("unpublish")} data-testid="unpublish">Gỡ xuất bản</Button>}
            {(a.is_author || a.can_review) && <Button variant="secondary" onClick={() => setConfirm("archive")} data-testid="archive">Lưu trữ</Button>}
          </div>
          {heads.length > 0 && (
            <nav aria-label="Mục lục" data-testid="toc">
              <h2 className="mb-1 font-semibold">Mục lục</h2>
              <ul className="flex flex-col gap-1">{heads.map((h, n) => <li key={n} className={h.level === 3 ? "pl-3" : ""}><button type="button" className="min-h-8 text-left hover:underline" onClick={() => [...document.querySelectorAll("[data-testid=rich-view] h2, [data-testid=rich-view] h3")].find((e) => e.textContent === h.text)?.scrollIntoView({ behavior: "smooth" })}>{h.text}</button></li>)}</ul>
            </nav>
          )}
          {!!rel.data?.items.length && (
            <section data-testid="related">
              <h2 className="mb-1 font-semibold">Bài liên quan</h2>
              <ul className="flex flex-col gap-1">{rel.data.items.map((r) => <li key={r.id}><Link to="/knowledge/$id" params={{ id: r.id }} className="text-primary underline">{r.title}</Link></li>)}</ul>
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
