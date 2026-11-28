import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PeopleField } from "@/components/ui/people-field";
import { PersonChip } from "@/components/ui/person";
import { Button, ConfirmDialog, ErrorText, Field, Input, PageTitle, Tabs, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, apiList, fmtTime, qs } from "@/lib/api";
import { disambiguate } from "@/lib/people";
import { can, useMe } from "@/lib/session";

interface Member { id: string; full_name: string; email: string | null; roles: string[]; status: string }
interface Sent { id: string; title: string; body: string; important: boolean; recipient_count: number; read_count: number; recalled_at: string | null; created_at: string }
interface Received { id: string; title: string; body: string; important: boolean; sender: string; read: boolean; created_at: string }
const ids = (m: Member[], f: (m: Member) => boolean) => m.filter(f).map((x) => x.id);

export function ComposeForm({ onSent }: { onSent: () => void }) {
  const me = useMe().data!;
  const qc = useQueryClient();
  const admin = me.user.roles.includes("admin");
  const members = useQuery({ queryKey: ["org", "announce-members"], queryFn: async () => (await apiList<Member>(`/org/members${qs({ limit: 200 })}`)).data });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [all, setAll] = useState(false);
  const [trees, setTrees] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const active = (members.data ?? []).filter((m) => m.status === "active" && !m.roles.includes("guest"));
  // Your own tree or team is a target too (you are not a recipient yourself).
  const mgrs = ids(active, (m) => m.roles.includes("manager"));
  const leaders = ids(active, (m) => m.roles.includes("leader"));
  const toggle = (s: string[], set: (v: string[]) => void, id: string) => set(s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const shownNames = disambiguate(active);
  const name = (id: string) => shownNames.get(id) ?? id;
  const send = useMutation({
    mutationFn: () => api("POST", "/announcements", { title, body, important, scope: { ...(all ? { all: true } : {}), ...(trees.length ? { trees } : {}), ...(teams.length ? { teams } : {}), ...(people.length ? { user_ids: people } : {}) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["announcements"] }); notify.ok("Đã gửi thông báo chung"); setTitle(""); setBody(""); setImportant(false); setAll(false); setTrees([]); setTeams([]); setPeople([]); onSent(); },
  });
  const noTarget = !all && !trees.length && !teams.length && !people.length;
  return (
    <form className="flex flex-col gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); if (title.trim() && !noTarget) send.mutate(); }}>
          <Field label="Tiêu đề" required><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="ann-title" /></Field>
          <Field label="Nội dung"><Textarea rows={4} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} data-testid="ann-body" /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Quan trọng (ghim đầu hộp thông báo, hiện toast)</label>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">Gửi tới</legend>
            {admin && <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Mọi người</label>}
            {mgrs.map((id) => <label key={id} className="flex items-center gap-2"><input type="checkbox" checked={trees.includes(id)} onChange={() => toggle(trees, setTrees, id)} data-testid={`ann-tree-${id}`} /> Cả cây của {name(id)}</label>)}
            {leaders.map((id) => <label key={id} className="flex items-center gap-2"><input type="checkbox" checked={teams.includes(id)} onChange={() => toggle(teams, setTeams, id)} data-testid={`ann-team-${id}`} /> Team của {name(id)}</label>)}
            <div className="mt-2"><PeopleField label="Người lẻ" value={people} onChange={setPeople} excludeIds={[me.user.id]} testid="ann-people" /></div>
          </fieldset>
          <ErrorText error={send.error} />
          <div><Button type="submit" loading={send.isPending} disabled={!title.trim() || noTarget} data-testid="ann-send">Gửi</Button></div>
    </form>
  );
}

function SentItem({ a }: { a: Sent }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const st = useQuery({ queryKey: ["announcements", "status", a.id], enabled: open, queryFn: () => api<{ read: number; total: number; unread: { user_id: string; name: string }[] }>("GET", `/announcements/${a.id}/read-status`) });
  const recall = useMutation({ mutationFn: () => api("POST", `/announcements/${a.id}/recall`), onSuccess: () => { setAsk(false); void qc.invalidateQueries({ queryKey: ["announcements"] }); notify.ok("Đã thu hồi"); } });
  return (
    <li data-testid="ann-sent" className="rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><div className="font-medium [overflow-wrap:anywhere]">{a.title}{a.important ? " (quan trọng)" : ""}</div><div className="text-xs text-muted-foreground">{fmtTime(a.created_at)}{a.recalled_at ? " · Đã thu hồi" : ""}</div></div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={() => setOpen((v) => !v)}>Đã đọc {a.read_count}/{a.recipient_count}</Button>
          {!a.recalled_at && <Button variant="ghost" onClick={() => setAsk(true)}>Thu hồi</Button>}
        </div>
      </div>
      {a.body && <p className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">{a.body}</p>}
      {open && <div className="mt-2 text-xs">{st.data ? (st.data.unread.length ? <><span className="inline-flex flex-wrap items-center gap-1">Chưa đọc: {st.data.unread.map((u) => <PersonChip key={u.user_id} person={{ id: u.user_id, full_name: u.name }} />)}</span></> : "Mọi người đã đọc.") : "Đang tải..."}</div>}
      {ask && <ConfirmDialog title="Thu hồi thông báo?" message="Thông báo biến mất khỏi hộp thông báo của mọi người nhận." confirmLabel="Thu hồi" busy={recall.isPending} onClose={() => setAsk(false)} onConfirm={() => recall.mutate()} />}
    </li>
  );
}

export type AnnTab = "sent" | "received";

/** The two lists: what reached me, and (for who may announce) what I sent. Used by the bell and by the page. */
export function AnnouncementsPanel({ tab, onTab, nested = false }: { tab: AnnTab; onTab: (t: AnnTab) => void; nested?: boolean }) {
  const canSend = can(useMe().data, "notification:announce");
  const sent = useQuery({ queryKey: ["announcements", "sent"], enabled: canSend && tab === "sent", queryFn: () => api<Sent[]>("GET", "/announcements/sent") });
  const got = useQuery({ queryKey: ["announcements", "received"], enabled: tab === "received", queryFn: () => api<Received[]>("GET", "/announcements/received") });
  return (
    <div>
      {canSend && (nested ? (
        <div className="mb-3 flex gap-1.5" role="group" aria-label="Thông báo chung">
          {([["received", "Đã nhận"], ["sent", "Đã gửi"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={tab === v} onClick={() => onTab(v)} className={cn("inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-medium", tab === v ? "border-primary-border bg-primary-soft text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{l}</button>)}
        </div>
      ) : <Tabs value={tab} onChange={onTab} items={[{ value: "received" as const, label: "Đã nhận" }, { value: "sent" as const, label: "Đã gửi" }]} />)}
      <ErrorText error={sent.error ?? got.error} />
      {tab === "sent" ? (
        <>{sent.data?.length === 0 && <EmptyState title="Chưa gửi thông báo chung nào" />}<ul className="flex flex-col gap-2">{sent.data?.map((a) => <SentItem key={a.id} a={a} />)}</ul></>
      ) : (
        <>{got.data?.length === 0 && <EmptyState title="Chưa nhận thông báo chung nào" />}
          <ul className="flex flex-col gap-2">{got.data?.map((a) => (
            <li key={a.id} data-testid="ann-received" className="rounded-lg border border-border bg-card p-3 text-sm">
              <div className="font-medium [overflow-wrap:anywhere]">{a.title}{a.important ? " (quan trọng)" : ""}</div>
              <div className="text-xs text-muted-foreground">{a.sender} · {fmtTime(a.created_at)}</div>
              {a.body && <p className="mt-1 [overflow-wrap:anywhere]">{a.body}</p>}
            </li>
          ))}</ul></>
      )}
    </div>
  );
}

export function AnnouncementsPage() {
  const canSend = can(useMe().data, "notification:announce");
  const [tab, setTab] = useState<AnnTab>(canSend ? "sent" : "received");
  const [compose, setCompose] = useState(false);
  return (
    <div>
      <PageTitle actions={canSend ? <Button onClick={() => setCompose((v) => !v)} data-testid="ann-new">{compose ? "Đóng" : "Soạn mới"}</Button> : undefined}>Thông báo chung</PageTitle>
      {compose && canSend && (
        <Card className="mb-4">
          <CardHeader><CardTitle>Soạn thông báo</CardTitle></CardHeader>
          <CardContent><ComposeForm onSent={() => { setCompose(false); setTab("sent"); }} /></CardContent>
        </Card>
      )}
      <AnnouncementsPanel tab={tab} onTab={setTab} />
    </div>
  );
}
