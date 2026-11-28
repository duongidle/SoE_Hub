// Tab Responses (design module7 7, 14): the count, the list, and the link to the table that holds the rows.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, ExternalLink, Search, Share2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, Input } from "@/components/ui/form";
import { ErrorState, FilteredEmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { apiList, fmtTime } from "@/lib/api";
import { getTable } from "@/lib/datahub/api";
import type { FormDetail } from "./model";

interface Resp { row_id: string; created_at: string; created_by: string | null; answers: Record<string, unknown>; quiz: { score: number; max: number; result: string | null; attempt: number } | null }
const show = (v: unknown): string => (v === undefined || v === null || v === "" ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

const STATE_LABEL: Record<string, string> = { open: "Đang nhận", paused: "Tạm dừng", closed: "Đã đóng", draft: "Nháp", not_started: "Chưa tới giờ mở" };

const Stat = ({ label, children, testid }: { label: string; children: React.ReactNode; testid?: string }) => (
  <div className="rounded-card border border-border bg-card p-4" data-testid={testid}>
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <div className="mt-1 text-[22px] font-bold leading-tight tabular-nums">{children}</div>
  </div>
);

/** `onShare` jumps to the Share step (the editor passes it); without it the empty state only offers to copy the link. */
export function ResponsesTab({ form, onShare }: { form: FormDetail; onShare?: () => void }) {
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["form-responses", form.id, search], queryFn: () => apiList<Resp>(`/forms/${form.id}/responses?limit=50${search ? `&search=${encodeURIComponent(search)}` : ""}`) });
  const table = useQuery({ queryKey: ["form-table", form.table_id], queryFn: () => getTable(form.table_id!), enabled: !!form.table_id });
  const qs = ((q.data as unknown as { questions?: { question_id: string; label: string }[] } | undefined)?.questions ?? []).slice(0, 6);
  const link = `${window.location.origin}/f/${form.code}`;
  const copy = () => { void navigator.clipboard?.writeText(link).then(() => notify.ok("Đã sao chép link")); };
  const tableTo = table.data ? { to: "/datahub/$datahubId/$tableId" as const, params: { datahubId: table.data.datahub_id, tableId: table.data.id } } : null;
  const none = form.response_count === 0;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">Phản hồi biểu mẫu <span className="tabular-nums" data-testid="response-count"><span className="sr-only">Tổng </span>({form.response_count})<span className="sr-only"> phản hồi</span></span></h2>
          {tableTo && table.data && (
            <p className="text-xs text-muted-foreground">Dữ liệu đồng bộ về bảng <Link {...tableTo} className="font-semibold text-primary hover:underline">{table.data.name}</Link> trong Datahub</p>
          )}
        </div>
        {tableTo && <Link {...tableTo} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-muted" data-testid="open-table"><ExternalLink size={14} aria-hidden />Mở bảng</Link>}
      </div>

      {none ? (
        <div className="rounded-card border border-dashed border-border bg-card px-4 py-12 text-center" data-testid="responses-empty">
          <div aria-hidden className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary"><Share2 size={26} /></div>
          <h3 className="text-base font-bold">Chưa có phản hồi</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{form.published_version === 0 ? "Xuất bản form rồi gửi link cho người cần điền, phản hồi sẽ hiện ở đây." : "Gửi link cho người cần điền, phản hồi sẽ hiện ở đây ngay khi họ nộp."}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={copy} data-testid="empty-copy-link"><Copy size={14} aria-hidden /> Sao chép link form</Button>
            {onShare && <Button variant="secondary" onClick={onShare} data-testid="empty-share">Chia sẻ</Button>}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Tổng phản hồi" testid="stat-total">{form.response_count}</Stat>
            <Stat label="Phản hồi gần nhất" testid="stat-last"><span className="text-base">{form.last_response_at ? fmtTime(form.last_response_at) : "—"}</span></Stat>
            <Stat label="Trạng thái form" testid="stat-state"><span className="text-base">{STATE_LABEL[form.state] ?? form.state}</span></Stat>
          </div>

          <section className="rounded-card border border-border bg-card shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h3 className="text-sm font-bold">Danh sách phản hồi</h3>
              <div className="relative w-60 max-w-full">
                <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Tìm trong phản hồi" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm phản hồi" />
              </div>
            </div>
            {q.error ? <ErrorState error={q.error} /> : q.data?.data.length === 0 ? <FilteredEmptyState onClear={() => setSearch("")} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="response-table">
                  <thead className="bg-muted text-left text-xs font-semibold text-muted-foreground"><tr><th className="p-2 pl-4">Lúc</th>{qs.map((x) => <th key={x.question_id} className="p-2">{x.label}</th>)}<th className="p-2">Kết quả</th></tr></thead>
                  <tbody>{q.data?.data.map((r) => <tr key={r.row_id} className="border-t border-border"><td className="whitespace-nowrap p-2 pl-4">{fmtTime(r.created_at)}</td>{qs.map((x) => <td key={x.question_id} className="max-w-48 truncate p-2">{show(r.answers[x.question_id])}</td>)}<td className="p-2">{r.quiz ? <span className="inline-flex items-center gap-2"><span className="tabular-nums">{r.quiz.score}/{r.quiz.max}</span><Badge tone={r.quiz.result === null ? "warn" : /^không/i.test(r.quiz.result) ? "bad" : /^đạt$/i.test(r.quiz.result) ? "ok" : "muted"}>{r.quiz.result ?? "Chờ chấm"}</Badge></span> : ""}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
