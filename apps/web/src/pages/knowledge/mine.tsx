import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PenLine, Upload } from "lucide-react";
import { Button, ErrorText, PageTitle } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { api, fmtTime } from "@/lib/api";
import { ChipTabs, StateBadge } from "../library/common";
import { useState } from "react";

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
  const q = useQuery({ queryKey: [kind, "mine"], queryFn: () => api<MineItem[]>("GET", `${base}/mine?limit=100`) });
  const act = useMutation({
    mutationFn: (v: { id: string; op: "archive" | "restore" }) => api("POST", `/posts/${v.id}/${v.op}`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [kind] }),
  });
  const [tab, setTab] = useState("");
  const shownOf = (p: MineItem) => (p.state === "archived" ? "archived" : p.working?.status ?? p.state);
  const all = q.data ?? [];
  const items = tab ? all.filter((p) => shownOf(p) === tab) : all;
  const count = (s: string) => all.filter((p) => shownOf(p) === s).length;
  const newBtn = "inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover";
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-3">
      <PageTitle actions={isArticle ? <Link to="/knowledge/soan" className={newBtn}><PenLine size={14} aria-hidden />Viết bài</Link> : <Link to="/ai-hub/tai-len" className={newBtn}><Upload size={14} aria-hidden />Tải lên skill</Link>}>
        {isArticle ? "Bài của tôi" : "Skill của tôi"}
      </PageTitle>
      <ChipTabs label="Trạng thái" value={tab} onChange={setTab} items={[{ value: "", label: `Tất cả (${all.length})` }, ...(["draft", "pending", "returned", "published", "archived"] as const).filter((s) => count(s) > 0).map((s) => ({ value: s, label: `${STATE_NAME[s]} (${count(s)})` }))]} />
      <ErrorText error={q.error ?? act.error} />
      {q.data?.length === 0 && <EmptyState title={isArticle ? "Chưa có bài nào" : "Chưa có skill nào"} hint={isArticle ? "Viết bài đầu tiên: bài được kiểm tra tự động rồi gửi duyệt." : "Tải lên gói skill đầu tiên: gói được kiểm tra tự động rồi gửi duyệt."} />}
      <ul className="flex flex-col gap-2">
        {items.map((p) => {
          const shown = shownOf(p);
          return (
            <li key={p.id} data-testid="mine-item" className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-card p-4 text-sm shadow-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-medium [overflow-wrap:anywhere] ${isArticle ? "" : "font-mono"}`}>{p.title || "(chưa có tiêu đề)"}</span>
                  <StateBadge state={shown} />
                </div>
                <div className="text-xs text-muted-foreground">Cập nhật {fmtTime(p.updated_at)} · {p.view_count} lượt xem</div>
                {p.working?.status === "returned" && p.working.return_reason && <p className="mt-1 rounded-md border border-bad-border bg-bad-bg px-2 py-1 text-bad" data-testid="return-reason">Lý do trả lại: {p.working.return_reason}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                {p.has_live && <Link to={isArticle ? "/knowledge/$id" : "/ai-hub/$id"} params={{ id: p.id }} className="inline-flex min-h-9 items-center px-3 text-primary hover:underline">Xem</Link>}
                {p.state !== "archived" && p.working?.status !== "pending" && (isArticle ? <Link to="/knowledge/soan/$id" params={{ id: p.id }} className="inline-flex min-h-9 items-center px-3 text-primary hover:underline">Sửa</Link> : <Link to="/ai-hub/tai-len/$id" params={{ id: p.id }} className="inline-flex min-h-9 items-center px-3 text-primary hover:underline">Sửa</Link>)}
                {p.state === "archived" ? <Button variant="ghost" onClick={() => act.mutate({ id: p.id, op: "restore" })}>Khôi phục</Button> : <Button variant="ghost" onClick={() => act.mutate({ id: p.id, op: "archive" })}>Lưu trữ</Button>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
const STATE_NAME: Record<string, string> = { draft: "Nháp", pending: "Chờ duyệt", returned: "Bị trả lại", published: "Đã xuất bản", archived: "Đã lưu trữ" };
