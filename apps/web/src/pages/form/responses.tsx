// Tab Responses (design module7 7, 14): the count, the list, and the link to the table that holds the rows.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, ExternalLink, Search, Share2 } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, Input } from "@/components/ui/form";
import { ErrorState, FilteredEmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, apiList, fmtTime } from "@/lib/api";
import { getTable } from "@/lib/datahub/api";
import type { FormDetail } from "./model";

interface Resp { row_id: string; created_at: string; created_by: string | null; answers: Record<string, unknown>; quiz: { score: number; max: number; result: string | null; attempt: number } | null }
const show = (v: unknown): string => (v === undefined || v === null || v === "" ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

interface QSummary { question_id: string; label: string; input: string; answered: number; options?: { label: string; count: number; percent: number }[]; number?: { avg: number; min: number; max: number }; latest?: string[] }
interface Summary { total: number; today: number; last_at: string | null; questions: QSummary[]; quiz: { graded: number; pending: number; avg_score: number | null; max_score: number | null; pass_rate: number | null } | null }
const BAR = ["bg-primary", "bg-emerald-500", "bg-amber-500", "bg-sky-500", "bg-rose-500", "bg-violet-500"];
const fmtNum = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);

/** One question's summary, all numbers from `form.response.summary` (design module12 12H-9). */
function QuestionCard({ n, s, onAll }: { n: number; s: QSummary; onAll: () => void }) {
  return (
    <section className="rounded-card border border-border bg-card p-5" data-testid="question-summary">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-[13px] font-semibold">Câu {n}: {s.label}</h3>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{s.answered} trả lời</span>
      </div>
      {s.options && (s.options.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có lựa chọn nào được chọn.</p> : (
        <div className="flex flex-col gap-2.5">
          {s.options.map((o, i) => (
            <div key={o.label}>
              <div className="mb-1 flex justify-between gap-3 text-xs"><span className="min-w-0 truncate font-medium">{o.label}</span><span className="shrink-0 font-medium tabular-nums">{o.count} ({fmtNum(o.percent)}%)</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${BAR[i % BAR.length]}`} style={{ width: `${Math.min(100, o.percent)}%` }} /></div>
            </div>
          ))}
        </div>
      ))}
      {s.number && (
        <div className="grid grid-cols-3 gap-3 text-center">
          {([["Trung bình", s.number.avg], ["Nhỏ nhất", s.number.min], ["Lớn nhất", s.number.max]] as const).map(([l, v]) => <div key={l} className="rounded-xl bg-muted/50 p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-lg font-semibold tabular-nums">{fmtNum(v)}</div></div>)}
        </div>
      )}
      {s.latest && (s.latest.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có câu trả lời.</p> : (
        <>
          <ul className="flex flex-col gap-1.5">{s.latest.map((t, i) => <li key={i} className="rounded-lg bg-muted/50 px-3 py-2 text-xs">{t}</li>)}</ul>
          <button type="button" onClick={onAll} className="mt-2 text-xs font-medium text-primary hover:underline">Xem tất cả</button>
        </>
      ))}
    </section>
  );
}

const STATE_LABEL: Record<string, string> = { open: "Đang nhận", paused: "Tạm dừng", closed: "Đã đóng", draft: "Nháp", not_started: "Chưa tới giờ mở" };

const Stat = ({ label, children, testid }: { label: string; children: React.ReactNode; testid?: string }) => (
  <div className="rounded-card border border-border bg-card p-4" data-testid={testid}>
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <div className="mt-1 text-[22px] font-semibold leading-tight tabular-nums">{children}</div>
  </div>
);

/** `onShare` jumps to the Share step (the editor passes it); without it the empty state only offers to copy the link. */
export function ResponsesTab({ form, onShare }: { form: FormDetail; onShare?: () => void }) {
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["form-responses", form.id, search], queryFn: () => apiList<Resp>(`/forms/${form.id}/responses?limit=50${search ? `&search=${encodeURIComponent(search)}` : ""}`) });
  const table = useQuery({ queryKey: ["form-table", form.table_id], queryFn: () => getTable(form.table_id!), enabled: !!form.table_id });
  const qs = ((q.data as unknown as { questions?: { question_id: string; label: string }[] } | undefined)?.questions ?? []).slice(0, 6);
  const sum = useQuery({ queryKey: ["form-summary", form.id, form.response_count], queryFn: () => api<Summary>("GET", `/forms/${form.id}/responses/summary`), enabled: form.response_count > 0 });
  const listRef = useRef<HTMLElement>(null);
  const link = `${window.location.origin}/f/${form.code}`;
  const copy = () => { void navigator.clipboard?.writeText(link).then(() => notify.ok("Đã sao chép link")); };
  const tableTo = table.data ? { to: "/datahub/$datahubId/$tableId" as const, params: { datahubId: table.data.datahub_id, tableId: table.data.id } } : null;
  const none = form.response_count === 0;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Phản hồi biểu mẫu <span className="tabular-nums" data-testid="response-count"><span className="sr-only">Tổng </span>({form.response_count})<span className="sr-only"> phản hồi</span></span></h2>
          {tableTo && table.data && (
            <p className="text-xs text-muted-foreground">Dữ liệu đồng bộ về bảng <Link {...tableTo} className="font-medium text-primary hover:underline">{table.data.name}</Link> trong Datahub</p>
          )}
        </div>
        {tableTo && <Link {...tableTo} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-muted" data-testid="open-table"><ExternalLink size={14} aria-hidden />Mở bảng</Link>}
      </div>

      {none ? (
        <div className="rounded-card border border-dashed border-border bg-card px-4 py-12 text-center" data-testid="responses-empty">
          <div aria-hidden className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary"><Share2 size={26} /></div>
          <h3 className="text-base font-semibold">Chưa có phản hồi</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{form.published_version === 0 ? "Xuất bản form rồi gửi link cho người cần điền, phản hồi sẽ hiện ở đây." : "Gửi link cho người cần điền, phản hồi sẽ hiện ở đây ngay khi họ nộp."}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={copy} data-testid="empty-copy-link"><Copy size={14} aria-hidden /> Sao chép link form</Button>
            {onShare && <Button variant="secondary" onClick={onShare} data-testid="empty-share">Chia sẻ</Button>}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Tổng phản hồi" testid="stat-total">{sum.data?.total ?? form.response_count}{!!sum.data?.today && <span className="ml-2 text-xs font-medium text-ok" data-testid="stat-today">+{sum.data.today} hôm nay</span>}</Stat>
            {sum.data?.quiz ? (
              <>
                <Stat label="Điểm trung bình" testid="stat-avg">{sum.data.quiz.avg_score === null ? "—" : <>{fmtNum(sum.data.quiz.avg_score)}<span className="text-sm font-medium text-muted-foreground"> / {fmtNum(sum.data.quiz.max_score ?? 0)}</span></>}</Stat>
                <Stat label="Tỉ lệ đạt" testid="stat-pass">{sum.data.quiz.pass_rate === null ? "—" : <>{fmtNum(sum.data.quiz.pass_rate)}%</>}{sum.data.quiz.pending > 0 && <span className="ml-2 text-xs font-medium text-warn">{sum.data.quiz.pending} chờ chấm</span>}</Stat>
              </>
            ) : (
              <>
                <Stat label="Phản hồi gần nhất" testid="stat-last"><span className="text-base">{form.last_response_at ? fmtTime(form.last_response_at) : "—"}</span></Stat>
                <Stat label="Trạng thái form" testid="stat-state"><span className="text-base">{STATE_LABEL[form.state] ?? form.state}</span></Stat>
              </>
            )}
          </div>

          {sum.data?.questions.map((s, i) => <QuestionCard key={s.question_id} n={i + 1} s={s} onAll={() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />)}

          <section ref={listRef} className="rounded-card border border-border bg-card shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Danh sách phản hồi</h3>
              <div className="relative w-60 max-w-full">
                <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Tìm trong phản hồi" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm phản hồi" />
              </div>
            </div>
            {q.error ? <ErrorState error={q.error} /> : q.data?.data.length === 0 ? <FilteredEmptyState onClear={() => setSearch("")} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="response-table">
                  <thead className="bg-muted text-left text-xs font-medium text-muted-foreground"><tr><th className="p-2 pl-4">Lúc</th>{qs.map((x) => <th key={x.question_id} className="p-2">{x.label}</th>)}<th className="p-2">Kết quả</th></tr></thead>
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
