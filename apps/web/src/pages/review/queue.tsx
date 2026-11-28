import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Button, ConfirmDialog, ErrorText, PageTitle, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, ApiError, fmtTime } from "@/lib/api";
import { can, useMe } from "@/lib/session";
import { CATEGORY_LABEL, ChipTabs, GROUP_LABEL, RichView, TagChips, TYPE_LABEL, type Issue } from "../library/common";

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
    <div className="rounded-card border border-border bg-card shadow-sm" data-testid="review-detail">
      <ErrorText error={q.error} />
      {d && (
        <>
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-t-card border-b border-border-soft bg-card/95 px-4 py-3 backdrop-blur">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge tone={d.kind === "article" ? "primary" : "ai"}>{KIND_LABEL[d.kind]}</Badge>
              <span>{d.author.name} · bản {d.version}</span>
              {d.is_revision && <Badge tone="info">Bản sửa của bài đã xuất bản</Badge>}
            </div>
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => setDlg("return")} data-testid="return">Trả lại</Button>
              <Button onClick={() => setDlg("approve")} data-testid="approve" disabled={d.errors.length > 0}>Duyệt</Button>
            </div>
          </div>
          <div className="p-4">
            {(d.errors.length > 0 || d.warnings.length > 0) ? (
              <section className="mb-4 flex flex-col gap-1.5 rounded-lg border border-warn-border bg-warn-bg p-3" data-testid="review-warnings" aria-label="Cảnh báo">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-warn"><TriangleAlert size={15} aria-hidden />Kiểm tra tự động: {d.errors.length} lỗi, {d.warnings.length} cảnh báo</h3>
                {d.errors.map((i, n) => <p key={`e${n}`} className="rounded-md bg-bad/10 px-2 py-1 text-xs text-bad"><b>Lỗi:</b> {i.message}{i.path ? ` (${i.path})` : ""}</p>)}
                {d.warnings.map((i, n) => (
                  <p key={`w${n}`} className="text-xs">
                    <b>{i.path ? `${i.path}: ` : ""}</b>{i.message} {i.hint}
                    {i.similar?.map((s) => <span key={s.id}> Giống: <b>{s.title}</b>.</span>)}
                  </p>
                ))}
              </section>
            ) : (
              <p className="mb-4 flex items-center gap-1.5 text-xs text-ok"><CircleCheck size={14} aria-hidden />Kiểm tra tự động không có cảnh báo.</p>
            )}
            <Body kind={d.kind} c={d.content} />
            {d.live && (
              <div className="mt-4">
                <Button variant="ghost" onClick={() => setShowLive((x) => !x)} data-testid="toggle-live">{showLive ? "Ẩn" : "Xem"} bản đang xuất bản (bản {d.live.version})</Button>
                {showLive && <div className="mt-2 rounded-md border border-border p-3" data-testid="live-version"><Body kind={d.kind} c={d.live.content} /></div>}
              </div>
            )}
            <ErrorText error={err} />
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

const wideQuery = "(min-width: 1024px)";
const useWide = () => useSyncExternalStore((cb) => { const m = window.matchMedia(wideQuery); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); }, () => window.matchMedia(wideQuery).matches, () => true);

export function ReviewQueuePage() {
  const me = useMe().data;
  const wide = useWide();
  const urlKind = new URLSearchParams(window.location.search).get("kind");
  const fixed = urlKind === "article" || urlKind === "skill" ? urlKind : "";
  const [kind, setKind] = useState(fixed);
  const [sel, setSel] = useState<{ id: string; version: number } | null>(null);
  const initial = new URLSearchParams(window.location.search).get("post");
  const q = useQuery({ queryKey: ["review", "queue", kind], queryFn: () => api<QueueItem[]>("GET", `/review/queue?limit=100${kind ? `&kind=${kind}` : ""}`) });
  const items = q.data ?? [];
  const current = sel ?? (initial ? items.find((i) => i.post_id === initial) ? { id: initial, version: items.find((i) => i.post_id === initial)!.version } : null : null);
  const kinds = [{ value: "", label: "Tất cả" }, ...(can(me, "knowledge:article:review") ? [{ value: "article", label: "Bài Knowledge" }] : []), ...(can(me, "aihub:skill:review") ? [{ value: "skill", label: "Skill AI Hub" }] : [])];
  const detail = current && <Review key={`${current.id}-${current.version}`} id={current.id} version={current.version} onDone={() => setSel(null)} />;
  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-3">
      <PageTitle>{fixed === "skill" ? "Duyệt skill" : fixed === "article" ? "Duyệt bài" : "Hàng chờ duyệt"}</PageTitle>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {!fixed && kinds.length > 2 ? <ChipTabs label="Loại" value={kind} onChange={(v) => { setKind(v); setSel(null); }} items={kinds} /> : <span />}
        {q.data && <span className="text-sm text-muted-foreground">{items.length} {fixed === "skill" ? "skill" : "bài"} chờ duyệt</span>}
      </div>
      <ErrorText error={q.error} />
      {q.data && items.length === 0 && <EmptyState title="Không có gì chờ duyệt" hint="Bài và skill tác giả gửi lên sẽ hiện ở đây." />}
      <div className="grid items-start gap-4 lg:grid-cols-[22rem_1fr]">
        <ul className="flex flex-col gap-1.5" data-testid="queue">
          {items.map((i) => (
            <li key={i.post_id}>
              <button type="button" onClick={() => setSel({ id: i.post_id, version: i.version })} className={`w-full rounded-xl border p-3 text-left text-sm transition-colors ${current?.id === i.post_id ? "border-primary-border bg-primary-soft" : "border-border bg-card hover:border-primary-border"}`} data-testid="queue-item">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={i.kind === "article" ? "primary" : "ai"}>{KIND_LABEL[i.kind]}</Badge>
                  {i.is_revision && <Badge tone="info">Bản sửa</Badge>}
                  {i.warning_count > 0 && <Badge tone="warn">{i.warning_count} cảnh báo</Badge>}
                </div>
                <div className={`mt-1.5 font-medium [overflow-wrap:anywhere] ${i.kind === "skill" ? "font-mono" : ""}`}>{i.title}</div>
                <div className="text-xs text-muted-foreground">{i.author.name} · {fmtTime(i.submitted_at)}</div>
              </button>
            </li>
          ))}
        </ul>
        {wide ? (detail ?? (items.length > 0 ? <p className="rounded-card border border-dashed border-border p-6 text-sm text-muted-foreground">Chọn một mục bên trái để xem nội dung, cảnh báo và quyết định.</p> : null)) : (
          <Drawer title="Duyệt bài" open={!!current} onClose={() => setSel(null)} wide width="sm:w-[640px]">{detail}</Drawer>
        )}
      </div>
    </div>
  );
}
