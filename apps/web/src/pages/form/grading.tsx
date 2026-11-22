// The grading screen and "my quiz results" (design module7 6.2, 6.4, 14).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ErrorText, Field, Input, PageTitle, Textarea } from "@/components/ui/form";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, fmtTime } from "@/lib/api";
import type { Rubric } from "./model";

interface Item { response_id: string; form_id: string; form_name: string; user_name: string | null; attempt: number; result: string | null; score: number; max: number; submitted_at: string }
interface GItem { question_id: string; label: string; input: string; manual: boolean; graded: boolean; max: number; points: number; answer: unknown; expected: unknown; correct: boolean | null; comment: string | null; criteria: Record<string, number> | null; rubric: Rubric[] | null }
interface Detail extends Item { items: GItem[]; comment: string | null; pending: boolean }
const show = (v: unknown): string => (v === undefined || v === null || v === "" ? "(trống)" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));
const param = (k: string) => new URLSearchParams(window.location.search).get(k);

function GradeForm({ detail, next, onDone }: { detail: Detail; next: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [pts, setPts] = useState<Record<string, string>>(() => Object.fromEntries(detail.items.filter((i) => i.manual).map((i) => [i.question_id, i.graded ? String(i.points) : ""])));
  const [crit, setCrit] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(detail.items.filter((i) => i.manual && i.rubric?.length).map((i) => [i.question_id, Object.fromEntries(Object.entries(i.criteria ?? {}).map(([k, v]) => [k, String(v)]))])));
  const [cm, setCm] = useState<Record<string, string>>(() => Object.fromEntries(detail.items.map((i) => [i.question_id, i.comment ?? ""])));
  const [total, setTotal] = useState(detail.comment ?? "");
  const submit = useMutation({
    mutationFn: () => {
      const items = detail.items.filter((i) => i.manual).flatMap((i): { question_id: string; points?: number; criteria?: Record<string, number>; comment?: string }[] => {
        const comment = cm[i.question_id] || undefined;
        if (i.rubric?.length) {
          const c = crit[i.question_id] ?? {};
          const filled = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]));
          return Object.keys(filled).length ? [{ question_id: i.question_id, criteria: filled, comment }] : [];
        }
        const p = pts[i.question_id];
        return p === "" || p === undefined ? [] : [{ question_id: i.question_id, points: Number(p), comment }];
      });
      return api("POST", `/grading/${detail.response_id}`, { items, comment: total || undefined });
    },
    onSuccess: () => { notify.ok("Đã lưu điểm"); void qc.invalidateQueries({ queryKey: ["grading"] }); onDone(); next(); },
  });
  return (
    <div className="flex flex-col gap-3" data-testid="grade-form" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") submit.mutate(); }}>
      <p className="text-sm text-muted-foreground">{detail.user_name ?? "Người làm bài"} · lần {detail.attempt} · {fmtTime(detail.submitted_at)} · hiện {detail.score}/{detail.max} {detail.result ? `· ${detail.result}` : ""}</p>
      {detail.items.map((i) => (
        <div key={i.question_id} className="flex flex-col gap-2 rounded-md border border-border bg-card p-3" data-testid="grade-item" data-question={i.question_id}>
          <p className="font-medium [overflow-wrap:anywhere]">{i.label || i.question_id} <span className="text-xs font-normal text-muted-foreground">(tối đa {i.max})</span></p>
          <p className="whitespace-pre-line text-sm [overflow-wrap:anywhere]" data-testid="grade-answer">{show(i.answer)}</p>
          {i.expected !== undefined && i.expected !== null && <p className="text-xs text-muted-foreground">Đáp án đúng: {show(i.expected)}</p>}
          {i.manual ? (
            i.rubric?.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {i.rubric.map((r) => <Field key={r.id} label={`${r.label || r.id} (${r.min}–${r.max}, trọng số ${r.weight}${r.floor !== undefined ? `, sàn ${r.floor}` : ""})`}><Input type="number" min={r.min} max={r.max} value={crit[i.question_id]?.[r.id] ?? ""} onChange={(e) => setCrit({ ...crit, [i.question_id]: { ...(crit[i.question_id] ?? {}), [r.id]: e.target.value } })} data-testid={`crit-${r.id}`} /></Field>)}
              </div>
            ) : (
              <Field label="Điểm"><Input type="number" min={0} max={i.max} step="any" value={pts[i.question_id] ?? ""} onChange={(e) => setPts({ ...pts, [i.question_id]: e.target.value })} data-testid="grade-points" /></Field>
            )
          ) : <p className="text-sm">Tự động chấm: {i.points}/{i.max} {i.correct === true ? "· đúng" : i.correct === false ? "· sai" : ""}</p>}
          {i.manual && <Field label="Nhận xét"><Textarea rows={2} value={cm[i.question_id] ?? ""} onChange={(e) => setCm({ ...cm, [i.question_id]: e.target.value })} /></Field>}
        </div>
      ))}
      <Field label="Nhận xét chung"><Textarea rows={2} value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
      <ErrorText error={submit.error} />
      <div className="flex flex-wrap items-center gap-2"><Button onClick={() => submit.mutate()} loading={submit.isPending} data-testid="grade-submit">Lưu và chấm bài kế</Button><span className="text-xs text-muted-foreground">Ctrl+Enter để lưu; Alt+mũi tên lên/xuống để chuyển bài.</span></div>
    </div>
  );
}

export function GradingPage() {
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const [cur, setCur] = useState<string | null>(param("response"));
  const list = useQuery({ queryKey: ["grading", status], queryFn: () => api<Item[]>("GET", `/grading?status=${status}`) });
  const items = list.data ?? [];
  const detail = useQuery({ queryKey: ["grading-detail", cur], queryFn: () => api<Detail>("GET", `/grading/${cur}`), enabled: !!cur });
  const idx = items.findIndex((i) => i.response_id === cur);
  const go = (d: number) => { const n = items[idx + d]; if (n) setCur(n.response_id); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); go(1); } else if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); go(-1); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  // After a save, go to the next waiting answer (the list is reloaded; the saved one is gone from it when it is no longer pending).
  const afterSave = () => { const n = items[idx + 1] ?? items[idx - 1] ?? null; setCur(n && n.response_id !== cur ? n.response_id : null); };
  return (
    <div>
      <PageTitle>Chấm bài</PageTitle>
      <div className="mb-3 flex gap-1" role="group" aria-label="Lọc">
        <Button variant={status === "pending" ? "primary" : "secondary"} onClick={() => setStatus("pending")} data-testid="grade-filter-pending">Chờ chấm</Button>
        <Button variant={status === "all" ? "primary" : "secondary"} onClick={() => setStatus("all")}>Tất cả</Button>
      </div>
      {list.error ? <ErrorState error={list.error} /> : (
        <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
          <ul className="flex flex-col gap-1" data-testid="grade-list">
            {items.length === 0 && <EmptyState title={status === "pending" ? "Không có bài chờ chấm" : "Chưa có bài"} />}
            {items.map((i) => (
              <li key={i.response_id}><button type="button" onClick={() => setCur(i.response_id)} data-testid="grade-row" className={`w-full rounded-md border p-2 text-left text-sm ${cur === i.response_id ? "border-primary bg-muted" : "border-border bg-card hover:bg-muted"}`}>
                <span className="block font-medium [overflow-wrap:anywhere]">{i.form_name}</span>
                <span className="block text-xs text-muted-foreground">{i.user_name ?? "—"} · lần {i.attempt}</span>
                <Badge>{i.result ?? "Chờ chấm"}</Badge>
              </button></li>
            ))}
          </ul>
          <div>
            {!cur ? <p className="text-sm text-muted-foreground">Chọn một bài ở danh sách.</p> : detail.error ? <ErrorState error={detail.error} /> : detail.data ? <GradeForm key={detail.data.response_id + detail.dataUpdatedAt} detail={detail.data} next={afterSave} onDone={() => void detail.refetch()} /> : <p className="text-muted-foreground">Đang tải…</p>}
          </div>
        </div>
      )}
    </div>
  );
}

interface Attempt { attempt: number; score: number; max: number; result: string | null; pending: boolean; submitted_at: string; comment?: string | null; items?: { question_id: string; points: number; max: number; comment: string | null }[] }
/** "My quiz results" of one form (`/form/bai-lam?code=`): what the form's setting lets the person see. */
export function MyQuizPage() {
  const code = param("code");
  const q = useQuery({ queryKey: ["quiz-mine", code], queryFn: () => api<{ attempts_used: number; max_attempts: number | null; attempts: Attempt[] }>("GET", `/fill/${code}/mine`), enabled: !!code });
  return (
    <div>
      <PageTitle>Bài làm của tôi</PageTitle>
      {!code ? <EmptyState title="Chưa chọn bài" hint="Mở từ thông báo hoặc từ link của bài kiểm tra." /> : q.error ? <ErrorState error={q.error} /> : !q.data ? <p className="text-muted-foreground">Đang tải…</p> : (
        <div className="flex flex-col gap-2" data-testid="my-quiz">
          <p className="text-sm">Đã làm {q.data.attempts_used}{q.data.max_attempts ? ` / ${q.data.max_attempts}` : ""} lần.</p>
          {q.data.attempts.length === 0 && <p className="text-sm text-muted-foreground">Người ra đề chưa cho xem điểm.</p>}
          {q.data.attempts.map((a) => (
            <div key={a.attempt} className="rounded-md border border-border bg-card p-3" data-testid="my-quiz-attempt">
              <p className="font-medium">Lần {a.attempt}: {a.score}/{a.max} <Badge>{a.result ?? "Chờ chấm"}</Badge></p>
              <p className="text-xs text-muted-foreground">{fmtTime(a.submitted_at)}</p>
              {a.comment && <p className="mt-1 text-sm">{a.comment}</p>}
              {a.items?.map((i) => <p key={i.question_id} className="text-sm">{i.question_id}: {i.points}/{i.max}{i.comment ? ` — ${i.comment}` : ""}</p>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
