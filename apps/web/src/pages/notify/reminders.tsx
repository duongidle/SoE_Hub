import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellPlus } from "lucide-react";
import { useState } from "react";
import { Button, ConfirmDialog, DateTimeInput, ErrorText, Field, Input, Modal, PageTitle, Select, Tabs } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, fmtTime, parseVnDateTime } from "@/lib/api";

export interface Reminder {
  id: string;
  content: string;
  due_at: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
  until: string | null;
  object: { type: "deal" | "row"; id: string } | null;
  status: "pending" | "fired" | "done";
}
const REPEAT_LABEL = { none: "Không lặp", daily: "Hằng ngày", weekly: "Hằng tuần", monthly: "Hằng tháng" } as const;

/** `dd/mm/yyyy hh:mm` (Vietnam time) to the `YYYY-MM-DDTHH:mm` the API takes. */
function toApiDue(text: string): string | null {
  const d = parseVnDateTime(text);
  if (!d) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/.exec(fmtTime(d.toISOString()));
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}` : null;
}

/** Quick form: what, when, repeat. With `object` the reminder is tied to a deal or a row. */
export function ReminderForm({ object, onDone }: { object?: Reminder["object"]; onDone: () => void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState("");
  const [when, setWhen] = useState("");
  const [repeat, setRepeat] = useState<Reminder["repeat"]>("none");
  const due = toApiDue(when);
  const m = useMutation({
    mutationFn: () => api("POST", "/reminders", { content, due_at: due, repeat, object: object ?? null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reminders"] });
      notify.ok("Đã đặt nhắc hẹn");
      setContent("");
      setWhen("");
      onDone();
    },
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (content.trim() && due) m.mutate(); }}>
      <Field label="Nội dung" required><Input value={content} maxLength={500} onChange={(e) => setContent(e.target.value)} placeholder="Gọi lại khách" /></Field>
      <Field label="Nhắc lúc" required hint="Giờ Việt Nam"><DateTimeInput value={when} onChange={setWhen} /></Field>
      <Field label="Lặp lại">
        <Select value={repeat} onChange={(e) => setRepeat(e.target.value as Reminder["repeat"])}>
          {Object.entries(REPEAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <ErrorText error={m.error} />
      <div><Button type="submit" loading={m.isPending} disabled={!content.trim() || !due}>Đặt nhắc</Button></div>
    </form>
  );
}

/** "Nhắc tôi" on a deal or a datahub row. */
export function RemindMeButton({ object }: { object: NonNullable<Reminder["object"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="remind-me"><BellPlus size={16} aria-hidden /> Nhắc tôi</Button>
      <Modal title="Nhắc tôi" open={open} onClose={() => setOpen(false)}>
        <ReminderForm object={object} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

/** The reminder list (upcoming / done). Used by the bell and by the page. */
export function RemindersPanel({ showNew = true }: { showNew?: boolean } = {}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"upcoming" | "done">("upcoming");
  const [creating, setCreating] = useState(false);
  const [del, setDel] = useState<Reminder | null>(null);
  const q = useQuery({ queryKey: ["reminders", tab], queryFn: () => api<Reminder[]>("GET", `/reminders?status=${tab}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["reminders"] });
  const act = useMutation({ mutationFn: (v: { id: string; op: "done" | "1h" | "tomorrow_0830" }) => (v.op === "done" ? api("POST", `/reminders/${v.id}/done`) : api("POST", `/reminders/${v.id}/snooze`, { until: v.op })), onSuccess: refresh });
  const rm = useMutation({ mutationFn: (id: string) => api("DELETE", `/reminders/${id}`), onSuccess: () => { setDel(null); refresh(); } });
  return (
    <div>
      {showNew && <div className="mb-3 flex justify-end"><Button onClick={() => setCreating(true)} data-testid="new-reminder"><BellPlus size={16} aria-hidden /> Nhắc mới</Button></div>}
      <Tabs value={tab} onChange={setTab} items={[{ value: "upcoming", label: "Sắp tới" }, { value: "done", label: "Đã xong" }]} />
      <ErrorText error={q.error ?? act.error ?? rm.error} />
      {q.data?.length === 0 && <EmptyState title={tab === "done" ? "Chưa có nhắc hẹn nào xong" : "Chưa có nhắc hẹn"} hint="Bấm Nhắc mới, hoặc Nhắc tôi ở chi tiết deal hay dòng." />}
      <ul className="flex flex-col gap-2">
        {q.data?.map((r) => (
          <li key={r.id} data-testid="reminder-item" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium [overflow-wrap:anywhere]">{r.content}</div>
              <div className="text-xs text-muted-foreground">
                {fmtTime(r.due_at)} · {REPEAT_LABEL[r.repeat]}{r.status === "fired" ? " · Đã nhắc" : ""}{r.object ? ` · gắn ${r.object.type === "deal" ? "deal" : "dòng"}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {r.status !== "done" && (
                <>
                  <Button variant="secondary" onClick={() => act.mutate({ id: r.id, op: "done" })}>Xong</Button>
                  <Button variant="ghost" onClick={() => act.mutate({ id: r.id, op: "1h" })}>Nhắc lại sau 1 giờ</Button>
                  <Button variant="ghost" onClick={() => act.mutate({ id: r.id, op: "tomorrow_0830" })}>Sáng mai 08:30</Button>
                </>
              )}
              <Button variant="ghost" onClick={() => setDel(r)}>Xoá</Button>
            </div>
          </li>
        ))}
      </ul>
      <Modal title="Nhắc mới" open={creating} onClose={() => setCreating(false)}><ReminderForm onDone={() => setCreating(false)} /></Modal>
      {del && <ConfirmDialog title="Xoá nhắc hẹn?" message={`"${del.content}"${del.repeat !== "none" ? " (cả chuỗi lặp)" : ""}`} confirmLabel="Xoá" busy={rm.isPending} onClose={() => setDel(null)} onConfirm={() => rm.mutate(del.id)} />}
    </div>
  );
}

export function RemindersPage() {
  return (
    <div>
      <PageTitle actions={<Link to="/thong-bao" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline">Thông báo</Link>}>Nhắc hẹn</PageTitle>
      <RemindersPanel />
    </div>
  );
}
