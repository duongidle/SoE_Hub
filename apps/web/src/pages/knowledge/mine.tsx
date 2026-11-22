import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, ErrorText, PageTitle } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, fmtTime } from "@/lib/api";
import { BackLink, StateBadge } from "../library/common";

export interface MineItem {
  id: string;
  state: string;
  title: string;
  summary: string;
  has_live: boolean;
  working: { version: number; status: string; return_reason: string | null; warning_count: number } | null;
  view_count: number;
  updated_at: string;
}

/** "Bài của tôi" / "Skill của tôi": `kind` picks the commands and the links. */
export function MineList({ kind }: { kind: "article" | "skill" }) {
  const qc = useQueryClient();
  const isArticle = kind === "article";
  const base = isArticle ? "/knowledge" : "/aihub";
  const q = useQuery({ queryKey: [kind, "mine"], queryFn: () => api<{ items: MineItem[] }>("GET", `${base}/mine?limit=100`) });
  const act = useMutation({
    mutationFn: (v: { id: string; op: "archive" | "restore" }) => api("POST", `/posts/${v.id}/${v.op}`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [kind] }),
  });
  return (
    <div>
      <BackLink to={isArticle ? "/knowledge" : "/ai-hub"}>{isArticle ? "Knowledge" : "AI Hub"}</BackLink>
      <PageTitle actions={isArticle ? <Link to="/knowledge/soan" className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Viết bài</Link> : <Link to="/ai-hub/tai-len" className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Tải lên skill</Link>}>
        {isArticle ? "Bài của tôi" : "Skill của tôi"}
      </PageTitle>
      <ErrorText error={q.error ?? act.error} />
      {q.data?.items.length === 0 && <EmptyState title={isArticle ? "Chưa có bài nào" : "Chưa có skill nào"} />}
      <ul className="flex flex-col gap-2">
        {q.data?.items.map((p) => {
          const shown = p.state === "archived" ? "archived" : p.working?.status ?? p.state;
          return (
            <li key={p.id} data-testid="mine-item" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium [overflow-wrap:anywhere]">{p.title || "(chưa có tiêu đề)"}</span>
                  <StateBadge state={shown} />
                </div>
                <div className="text-xs text-muted-foreground">Cập nhật {fmtTime(p.updated_at)} · {p.view_count} lượt xem</div>
                {p.working?.status === "returned" && p.working.return_reason && <p className="mt-1 rounded-md bg-bad/10 px-2 py-1 text-bad" data-testid="return-reason">Lý do trả lại: {p.working.return_reason}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                {p.has_live && <Link to={isArticle ? "/knowledge/$id" : "/ai-hub/$id"} params={{ id: p.id }} className="inline-flex min-h-9 items-center px-3 text-primary underline">Xem</Link>}
                {p.state !== "archived" && p.working?.status !== "pending" && (isArticle ? <Link to="/knowledge/soan/$id" params={{ id: p.id }} className="inline-flex min-h-9 items-center px-3 text-primary underline">Sửa</Link> : <Link to="/ai-hub/tai-len/$id" params={{ id: p.id }} className="inline-flex min-h-9 items-center px-3 text-primary underline">Sửa</Link>)}
                {p.state === "archived" ? <Button variant="ghost" onClick={() => act.mutate({ id: p.id, op: "restore" })}>Khôi phục</Button> : <Button variant="ghost" onClick={() => act.mutate({ id: p.id, op: "archive" })}>Lưu trữ</Button>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
