import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, PageTitle, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, ApiError, fmtTime } from "@/lib/api";
import { can, useMe } from "@/lib/session";
import { CATEGORY_LABEL, GROUP_LABEL, RichView, TagChips, TYPE_LABEL, type Issue } from "../library/common";

interface QueueItem {
  post_id: string;
  kind: "article" | "skill";
  version: number;
  title: string;
  author: { name: string };
  submitted_at: string;
  is_revision: boolean;
  error_count: number;
  warning_count: number;
}
type Content = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Detail {
  post_id: string;
  kind: "article" | "skill";
  version: number;
  is_revision: boolean;
  author: { name: string };
  content: Content;
  errors: Issue[];
  warnings: (Issue & { similar?: { id: string; title: string }[] })[];
  live: { version: number; title: string; summary: string; content: Content } | null;
}
const KIND_LABEL = { article: "Bài Knowledge", skill: "Skill AI Hub" } as const;

/** What a post says, by kind: an article (title, summary, body) or a skill (name, description, SKILL.md, file list). */
function Body({ kind, c }: { kind: "article" | "skill"; c: Content }) {
  if (kind === "article") {
    return (
      <div>
        <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{c.title}</h3>
        <p className="text-xs text-muted-foreground">{[c.category && CATEGORY_LABEL[c.category], c.type && TYPE_LABEL[c.type], c.for_sale ? "Cho sale" : null].filter(Boolean).join(" · ")}</p>
        <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{c.summary}</p>
        <TagChips tags={c.tags ?? []} />
        <div className="mt-3"><RichView doc={c.body} /></div>
      </div>
    );
  }
  const files = (c.files ?? []) as { path: string; content: string; size: number }[];
  const md = files.find((f) => f.path === "SKILL.md");
  return (
    <div>
      <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{c.name}</h3>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{c.description}</p>
      <p className="text-xs text-muted-foreground">v{c.version}{c.group ? ` · ${GROUP_LABEL[c.group] ?? c.group}` : ""}{c.change_note ? ` · ${c.change_note}` : ""}</p>
      <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs [overflow-wrap:anywhere]">{md?.content ?? "(không có SKILL.md)"}</pre>
      <ul className="mt-2 text-xs">{files.map((f) => <li key={f.path}>{f.path} ({f.size} byte)</li>)}</ul>
    </div>
  );
}

function Review({ id, version, onDone }: { id: string; version: number; onDone: () => void }) {
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<"approve" | "return" | null>(null);
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const q = useQuery({ queryKey: ["review", "detail", id, version], queryFn: () => api<Detail>("GET", `/review/posts/${id}?version=${version}`) });
  const decide = useMutation({
    mutationFn: (decision: "approve" | "return") => api("POST", `/review/posts/${id}/decide`, { decision, reason: decision === "return" ? reason.trim() : undefined, version }),
    onSuccess: (_r, d) => { setDlg(null); setReason(""); notify.ok(d === "approve" ? "Đã duyệt, bài được xuất bản" : "Đã trả lại tác giả"); void qc.invalidateQueries({ queryKey: ["review"] }); onDone(); },
    onError: () => setDlg(null),
  });
  const d = q.data;
  const err = decide.error instanceof ApiError && decide.error.details?.reason === "skill_name_taken"
    ? "Đã có skill xuất bản trùng tên. Hãy Trả lại để tác giả đổi tên, hoặc đánh dấu đây là phiên bản mới của skill đó."
    : decide.error;
  return (
    <div className="rounded-lg border border-border bg-card p-4" data-testid="review-detail">
      <ErrorText error={q.error} />
      {d && (
        <>
          <div className="mb-3 text-xs text-muted-foreground">{KIND_LABEL[d.kind]} · {d.author.name} · bản {d.version}{d.is_revision ? " (bản sửa của bài đã xuất bản)" : ""}</div>
          {(d.errors.length > 0 || d.warnings.length > 0) && (
            <section className="mb-4 flex flex-col gap-1" data-testid="review-warnings" aria-label="Cảnh báo">
              <h3 className="text-sm font-semibold">Cảnh báo của kiểm tra tự động ({d.warnings.length})</h3>
              {d.errors.map((i, n) => <p key={`e${n}`} className="rounded-md bg-bad/10 px-2 py-1 text-xs text-bad"><b>Lỗi:</b> {i.message}{i.path ? ` (${i.path})` : ""}</p>)}
              {d.warnings.map((i, n) => (
                <p key={`w${n}`} className="rounded-md bg-warn/20 px-2 py-1 text-xs">
                  <b>{i.path ? `${i.path}: ` : ""}</b>{i.message} {i.hint}
                  {i.similar?.map((s) => <span key={s.id}> Giống: <b>{s.title}</b>.</span>)}
                </p>
              ))}
            </section>
          )}
          <Body kind={d.kind} c={d.content} />
          {d.live && (
            <div className="mt-4">
              <Button variant="ghost" onClick={() => setShowLive((x) => !x)} data-testid="toggle-live">{showLive ? "Ẩn" : "Xem"} bản đang xuất bản (bản {d.live.version})</Button>
              {showLive && <div className="mt-2 rounded-md border border-border p-3" data-testid="live-version"><Body kind={d.kind} c={d.live.content} /></div>}
            </div>
          )}
          <ErrorText error={err} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setDlg("approve")} data-testid="approve" disabled={d.errors.length > 0}>Duyệt</Button>
            <Button variant="danger" onClick={() => setDlg("return")} data-testid="return">Trả lại</Button>
          </div>
        </>
      )}
      {dlg === "approve" && <ConfirmDialog title="Duyệt và xuất bản?" message="Bài được xuất bản ngay cho mọi người đọc được." confirmLabel="Duyệt" busy={decide.isPending} onClose={() => setDlg(null)} onConfirm={() => decide.mutate("approve")} />}
      {dlg === "return" && (
        <ConfirmDialog
          title="Trả lại tác giả?"
          message={
            <div className="flex flex-col gap-2">
              <Textarea rows={3} aria-label="Lý do trả lại" placeholder="Lý do (bắt buộc)" value={reason} onChange={(e) => { setReason(e.target.value); setReasonErr(false); }} data-testid="return-reason" />
              {reasonErr && <span role="alert" className="text-xs text-bad">Cần nhập lý do trả lại.</span>}
            </div>
          }
          confirmLabel="Trả lại"
          busy={decide.isPending}
          onClose={() => { setDlg(null); setReasonErr(false); }}
          onConfirm={() => (reason.trim() ? decide.mutate("return") : setReasonErr(true))}
        />
      )}
    </div>
  );
}

export function ReviewQueuePage() {
  const me = useMe().data;
  const [kind, setKind] = useState("");
  const [sel, setSel] = useState<{ id: string; version: number } | null>(null);
  const initial = new URLSearchParams(window.location.search).get("post");
  const q = useQuery({ queryKey: ["review", "queue", kind], queryFn: () => api<QueueItem[]>("GET", `/review/queue?limit=100${kind ? `&kind=${kind}` : ""}`) });
  const items = q.data ?? [];
  const current = sel ?? (initial ? items.find((i) => i.post_id === initial) ? { id: initial, version: items.find((i) => i.post_id === initial)!.version } : null : null);
  return (
    <div>
      <PageTitle>Hàng chờ duyệt</PageTitle>
      <div className="mb-3 max-w-xs">
        <Select aria-label="Loại" value={kind} onChange={(e) => { setKind(e.target.value); setSel(null); }}>
          <option value="">Mọi loại</option>
          {can(me, "knowledge:article:review") && <option value="article">Bài Knowledge</option>}
          {can(me, "aihub:skill:review") && <option value="skill">Skill AI Hub</option>}
        </Select>
      </div>
      <ErrorText error={q.error} />
      {q.data && items.length === 0 && <EmptyState title="Không có gì chờ duyệt" />}
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <ul className="flex flex-col gap-2" data-testid="queue">
          {items.map((i) => (
            <li key={i.post_id}>
              <button type="button" onClick={() => setSel({ id: i.post_id, version: i.version })} className={`w-full rounded-lg border p-3 text-left text-sm ${current?.id === i.post_id ? "border-primary bg-primary/5" : "border-border bg-card"}`} data-testid="queue-item">
                <div className="font-medium [overflow-wrap:anywhere]">{i.title}</div>
                <div className="text-xs text-muted-foreground">{KIND_LABEL[i.kind]} · {i.author.name} · {fmtTime(i.submitted_at)}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {i.is_revision && <Badge>Bản sửa</Badge>}
                  {i.warning_count > 0 && <Badge tone="warn">{i.warning_count} cảnh báo</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
        {current && <Review key={`${current.id}-${current.version}`} id={current.id} version={current.version} onDone={() => setSel(null)} />}
      </div>
    </div>
  );
}
