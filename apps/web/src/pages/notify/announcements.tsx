import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, ConfirmDialog, ErrorText, Field, Input, PageTitle, Tabs, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, apiList, fmtTime, qs } from "@/lib/api";
import { can, useMe } from "@/lib/session";

interface Member { id: string; full_name: string; email: string | null; roles: string[]; status: string }
interface Sent { id: string; title: string; body: string; important: boolean; recipient_count: number; read_count: number; recalled_at: string | null; created_at: string }
interface Received { id: string; title: string; body: string; important: boolean; sender: string; read: boolean; created_at: string }
const ids = (m: Member[], f: (m: Member) => boolean) => m.filter(f).map((x) => x.id);

function Compose({ onSent }: { onSent: () => void }) {
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
  const [search, setSearch] = useState("");
  const list = (members.data ?? []).filter((m) => m.status === "active" && !m.roles.includes("guest") && m.id !== me.user.id);
  const mgrs = ids(list, (m) => m.roles.includes("manager"));
  const leaders = ids(list, (m) => m.roles.includes("leader"));
  const toggle = (s: string[], set: (v: string[]) => void, id: string) => set(s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const name = (id: string) => list.find((m) => m.id === id)?.full_name ?? id;
  const send = useMutation({
    mutationFn: () => api("POST", "/announcements", { title, body, important, scope: { ...(all ? { all: true } : {}), ...(trees.length ? { trees } : {}), ...(teams.length ? { teams } : {}), ...(people.length ? { user_ids: people } : {}) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["announcements"] }); notify.ok("Đã gửi thông báo chung"); setTitle(""); setBody(""); setImportant(false); setAll(false); setTrees([]); setTeams([]); setPeople([]); onSent(); },
  });
  const noTarget = !all && !trees.length && !teams.length && !people.length;
  const shown = list.filter((m) => !search || `${m.full_name} ${m.email ?? ""}`.toLowerCase().includes(search.toLowerCase())).slice(0, 30);
  return (
    <Card>
      <CardHeader><CardTitle>Soạn thông báo</CardTitle></CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); if (title.trim() && !noTarget) send.mutate(); }}>
          <Field label="Tiêu đề" required><Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="ann-title" /></Field>
          <Field label="Nội dung"><Textarea rows={4} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} data-testid="ann-body" /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Quan trọng (ghim đầu hộp thông báo, hiện toast)</label>
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">Gửi tới</legend>
            {admin && <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Mọi người</label>}
            {mgrs.map((id) => <label key={id} className="flex items-center gap-2"><input type="checkbox" checked={trees.includes(id)} onChange={() => toggle(trees, setTrees, id)} data-testid={`ann-tree-${id}`} /> Cả cây của {name(id)}</label>)}
            {leaders.map((id) => <label key={id} className="flex items-center gap-2"><input type="checkbox" checked={teams.includes(id)} onChange={() => toggle(teams, setTeams, id)} data-testid={`ann-team-${id}`} /> Team của {name(id)}</label>)}
            <Input aria-label="Tìm người" placeholder="Tìm người lẻ theo tên hoặc email" value={search} onChange={(e) => setSearch(e.target.value)} className="mt-2" />
            {shown.map((m) => <label key={m.id} className="flex items-center gap-2"><input type="checkbox" checked={people.includes(m.id)} onChange={() => toggle(people, setPeople, m.id)} /> {m.full_name}{m.email ? ` (${m.email})` : ""}</label>)}
          </fieldset>
          <ErrorText error={send.error} />
          <div><Button type="submit" loading={send.isPending} disabled={!title.trim() || noTarget} data-testid="ann-send">Gửi</Button></div>
        </form>
      </CardContent>
    </Card>
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
      {open && <div className="mt-2 text-xs">{st.data ? (st.data.unread.length ? <>Chưa đọc: {st.data.unread.map((u) => u.name).join(", ")}</> : "Mọi người đã đọc.") : "Đang tải..."}</div>}
      {ask && <ConfirmDialog title="Thu hồi thông báo?" message="Thông báo biến mất khỏi hộp thông báo của mọi người nhận." confirmLabel="Thu hồi" busy={recall.isPending} onClose={() => setAsk(false)} onConfirm={() => recall.mutate()} />}
    </li>
  );
}

export function AnnouncementsPage() {
  const me = useMe().data;
  const canSend = can(me, "notification:announce");
  const [tab, setTab] = useState<"sent" | "received">(canSend ? "sent" : "received");
  const sent = useQuery({ queryKey: ["announcements", "sent"], enabled: canSend && tab === "sent", queryFn: () => api<Sent[]>("GET", "/announcements/sent") });
  const got = useQuery({ queryKey: ["announcements", "received"], enabled: tab === "received", queryFn: () => api<Received[]>("GET", "/announcements/received") });
  const [compose, setCompose] = useState(false);
  return (
    <div>
      <PageTitle actions={canSend ? <Button onClick={() => setCompose((v) => !v)} data-testid="ann-new">{compose ? "Đóng" : "Soạn mới"}</Button> : undefined}>Thông báo chung</PageTitle>
      {compose && canSend && <div className="mb-4"><Compose onSent={() => { setCompose(false); setTab("sent"); }} /></div>}
      <Tabs value={tab} onChange={setTab} items={[...(canSend ? [{ value: "sent" as const, label: "Đã gửi" }] : []), { value: "received" as const, label: "Đã nhận" }]} />
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
