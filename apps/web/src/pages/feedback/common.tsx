import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { Button, ConfirmDialog, ErrorText, Select, Textarea } from "@/components/ui/form";
import { PersonChip } from "@/components/ui/person";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, fmtTime } from "@/lib/api";
import { storageAddress } from "@/lib/datahub/api";
import { roleLabels } from "@/lib/people";
import { cn } from "@/lib/utils";

export const FEEDBACK_BODY_MAX = 5000;
export const FEEDBACK_MAX_FILES = 3;
export const FEEDBACK_FILE_MAX_BYTES = 5 * 1024 * 1024;

export type FeedbackKind = "bug" | "suggestion" | "feature";
export type FeedbackStatus = "new" | "viewing" | "planned" | "done" | "wont_do";

export const KIND_LABEL: Record<FeedbackKind, string> = { bug: "Báo lỗi", suggestion: "Góp ý", feature: "Yêu cầu tính năng" };
export const KIND_TONE: Record<FeedbackKind, "bad" | "primary" | "ai"> = { bug: "bad", suggestion: "primary", feature: "ai" };
export const STATUS_LABEL: Record<FeedbackStatus, string> = { new: "Mới", viewing: "Đang xem", planned: "Đã lên kế hoạch", done: "Đã xong", wont_do: "Không làm" };
export const STATUS_TONE: Record<FeedbackStatus, "info" | "warn" | "ai" | "ok" | "muted"> = { new: "info", viewing: "warn", planned: "ai", done: "ok", wont_do: "muted" };

export interface FeedbackSummary {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  excerpt: string;
  author_id: string;
  author_name: string;
  file_count: number;
  message_count: number;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface FeedbackDetail extends FeedbackSummary {
  body: string;
  context: { url?: string; user_agent?: string; viewport?: string } | null;
  files: { id: string; filename: string; content_type: string; size_bytes: number }[];
  author: { id: string; full_name: string; email: string | null; roles: string[] };
  messages: { id: string; author_id: string; author_name: string; from_author: boolean; body: string; created_at: string }[];
  can_manage: boolean;
  can_withdraw: boolean;
}

export const KindBadge = ({ kind }: { kind: FeedbackKind }) => <Badge tone={KIND_TONE[kind]} className="whitespace-nowrap text-[11px]">{KIND_LABEL[kind]}</Badge>;
export const StatusBadge = ({ status }: { status: FeedbackStatus }) => <Badge tone={STATUS_TONE[status]} className="whitespace-nowrap text-[11px]">{STATUS_LABEL[status]}</Badge>;

/** One row of a feedback list (both lists share it): kind, excerpt, status and date. */
export function FeedbackRow({ row, onOpen, showAuthor }: { row: FeedbackSummary; onOpen: () => void; showAuthor?: boolean }) {
  return (
    <li>
      <button type="button" data-testid="feedback-row" onClick={onOpen} className="flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-primary-soft/50">
        <span className="flex flex-wrap items-center gap-2">
          <KindBadge kind={row.kind} />
          <StatusBadge status={row.status} />
          {showAuthor && <span className="text-xs font-medium text-muted-foreground">{row.author_name}</span>}
          <span className="ml-auto text-xs text-muted-foreground">{fmtTime(row.created_at)}</span>
        </span>
        <span className="line-clamp-2 text-[13px] [overflow-wrap:anywhere]">{row.excerpt}</span>
        {(row.file_count > 0 || row.message_count > 0) && (
          <span className="text-xs text-muted-foreground">
            {row.file_count > 0 && `${row.file_count} ảnh`}
            {row.file_count > 0 && row.message_count > 0 && " · "}
            {row.message_count > 0 && `${row.message_count} tin nhắn`}
          </span>
        )}
      </button>
    </li>
  );
}

/** A picture of a feedback. The address is signed and short-lived, so it is asked for when the drawer opens. */
function FeedbackImage({ feedbackId, file }: { feedbackId: string; file: FeedbackDetail["files"][number] }) {
  const q = useQuery({ queryKey: ["feedback", "file", feedbackId, file.id], queryFn: () => api<{ url: string }>("GET", `/feedback/${feedbackId}/files/${file.id}/download-url`), staleTime: 4 * 60_000 });
  if (q.error) return <span className="grid size-24 place-items-center rounded-[12px] border border-border bg-muted p-2 text-center text-[11px] text-muted-foreground">Không mở được ảnh</span>;
  if (!q.data) return <Skeleton className="size-24 rounded-[12px]" />;
  const src = storageAddress(q.data.url);
  return (
    <a href={src} target="_blank" rel="noreferrer" aria-label={`Mở ảnh ${file.filename}`} className="block size-24 overflow-hidden rounded-[12px] border border-border bg-muted">
      <img src={src} alt={file.filename} data-testid="feedback-image" className="size-full object-cover" />
    </a>
  );
}

const Block = ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) => (
  <section className={cn("flex flex-col gap-2", className)}>
    <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
    {children}
  </section>
);

/**
 * The detail of one feedback in a drawer (design module11 3): the text, pictures, the thread and a box to write back. `manage` is the
 * handler's view (status select, the automatic info, the sender's card); the sender's view can take the feedback back while it is "Mới".
 */
export function FeedbackDrawer({ id, onClose, manage }: { id: string; onClose: () => void; manage?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["feedback", "detail", id], queryFn: () => api<FeedbackDetail>("GET", `/feedback/${id}`), retry: false });
  const d = q.data;
  const [text, setText] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["feedback"] });
  };
  const send = useMutation({
    mutationFn: () => api("POST", `/feedback/${id}/messages`, { body: text.trim() }),
    onSuccess: () => {
      setText("");
      refresh();
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api("PUT", `/feedback/${id}/status`, { status, version: d!.version }),
    onSuccess: () => {
      notify.ok("Đã đổi trạng thái");
      refresh();
    },
    onError: () => refresh(),
  });
  const withdraw = useMutation({
    mutationFn: () => api("DELETE", `/feedback/${id}?version=${d!.version}`),
    onSuccess: () => {
      notify.ok("Đã rút lại góp ý");
      setConfirmWithdraw(false);
      refresh();
      onClose();
    },
    onError: () => {
      setConfirmWithdraw(false);
      refresh();
    },
  });
  return (
    <Drawer
      title="Chi tiết góp ý"
      titleNode={d ? <><KindBadge kind={d.kind} /><StatusBadge status={d.status} /></> : undefined}
      open
      onClose={onClose}
      footer={<div className="flex justify-between gap-2"><span>{d?.can_withdraw && <Button variant="secondary" onClick={() => setConfirmWithdraw(true)} className="!text-bad">Rút lại</Button>}</span><Button variant="secondary" onClick={onClose}>Đóng</Button></div>}
    >
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không mở được góp ý này" />}
      {d && (
        <div className="flex flex-col gap-4" data-testid="feedback-detail">
          <p className="text-xs text-muted-foreground">{manage ? `${d.author_name} gửi lúc ${fmtTime(d.created_at)}` : `Gửi lúc ${fmtTime(d.created_at)}`}</p>
          <div className="rounded-[12px] bg-muted/60 p-3 text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid="feedback-body">{d.body}</div>
          {d.files.length > 0 && (
            <Block title={`Ảnh (${d.files.length})`}>
              <div className="flex flex-wrap gap-2">{d.files.map((f) => <FeedbackImage key={f.id} feedbackId={d.id} file={f} />)}</div>
            </Block>
          )}
          {manage && d.can_manage && (
            <>
              <Block title="Trạng thái">
                <Select aria-label="Trạng thái" value={d.status} onChange={(e) => setStatus.mutate(e.target.value)} disabled={setStatus.isPending}>
                  {(Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Select>
                <ErrorText error={setStatus.error} />
              </Block>
              <Block title="Người gửi">
                <div className="flex flex-col gap-1 rounded-[12px] border border-border-soft p-3 text-xs text-muted-foreground">
                  <PersonChip person={{ id: d.author.id, full_name: d.author.full_name, email: d.author.email, roles: d.author.roles }} />
                  {d.author.email && <span className="[overflow-wrap:anywhere]">{d.author.email}</span>}
                  {d.author.roles.length > 0 && <span>{roleLabels(d.author.roles)}</span>}
                </div>
              </Block>
              <Block title="Thông tin tự ghi">
                <dl className="flex flex-col gap-1 rounded-[12px] border border-border-soft p-3 text-xs text-muted-foreground" data-testid="feedback-context">
                  <div><dt className="inline font-semibold text-foreground">Trang: </dt><dd className="inline [overflow-wrap:anywhere]">{d.context?.url || "—"}</dd></div>
                  <div><dt className="inline font-semibold text-foreground">Cỡ màn hình: </dt><dd className="inline">{d.context?.viewport || "—"}</dd></div>
                  <div><dt className="inline font-semibold text-foreground">Trình duyệt: </dt><dd className="inline [overflow-wrap:anywhere]">{d.context?.user_agent || "—"}</dd></div>
                </dl>
              </Block>
            </>
          )}
          <Block title={`Trao đổi (${d.messages.length})`}>
            {d.messages.length === 0 && <p className="text-xs text-muted-foreground">Chưa có tin nhắn.</p>}
            <ul className="flex flex-col gap-2" aria-label="Tin nhắn">
              {d.messages.map((m) => (
                <li key={m.id} data-testid="feedback-message" className={cn("flex flex-col gap-0.5 rounded-[12px] px-3 py-2 text-[13px]", m.from_author ? "bg-muted/60" : "bg-primary-soft")}>
                  <span className="text-[11px] text-muted-foreground">{m.author_name}{m.from_author ? " (người gửi)" : ""} · {fmtTime(m.created_at)}</span>
                  <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</span>
                </li>
              ))}
            </ul>
            <Textarea aria-label="Nội dung tin nhắn" rows={3} maxLength={FEEDBACK_BODY_MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder={manage ? "Trả lời người gửi" : "Nhắn lại cho người xử lý"} />
            <ErrorText error={send.error} />
            <div><Button loading={send.isPending} disabled={!text.trim()} onClick={() => send.mutate()}>{manage ? "Gửi trả lời" : "Gửi tin nhắn"}</Button></div>
          </Block>
        </div>
      )}
      {confirmWithdraw && <ConfirmDialog title="Rút lại góp ý?" message="Góp ý sẽ bị xoá khỏi danh sách của bạn và của người xử lý." confirmLabel="Rút lại" busy={withdraw.isPending} onConfirm={() => withdraw.mutate()} onClose={() => setConfirmWithdraw(false)} />}
      {withdraw.error && <ErrorText error={withdraw.error} />}
    </Drawer>
  );
}
