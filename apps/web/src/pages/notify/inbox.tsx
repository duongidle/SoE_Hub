import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, Pin, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorText, Modal, PageTitle, Select, Tabs } from "@/components/ui/form";
import { Popover } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { api, apiList, fmtTime, qs, type Page } from "@/lib/api";
import { can, type Me } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AnnouncementsPanel, ComposeForm, type AnnTab } from "./announcements";
import { ReminderForm, RemindersPanel } from "./reminders";

export interface NotificationRow {
  id: string;
  type: string;
  category: string;
  priority: string;
  title: string;
  body: string;
  link: string | null;
  data: { code?: string };
  read_at: string | null;
  created_at: string;
}

export const CATEGORY_LABEL: Record<string, string> = { account: "Tài khoản", datahub: "Datahub", ai: "Kết nối AI", deal: "Quản lý Deal", reminder: "Nhắc hẹn", digest: "Bản tin", announcement: "Thông báo chung", feedback: "Góp ý" };

const vnDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const isPinned = (n: NotificationRow) => n.type === "announcement" && n.priority === "important" && !n.read_at;

/** Pinned important announcements first, then today, then earlier. */
function groups(rows: NotificationRow[]): { label: string; rows: NotificationRow[] }[] {
  const today = vnDay(new Date().toISOString());
  const out = [
    { label: "Ghim", rows: rows.filter(isPinned) },
    { label: "Hôm nay", rows: rows.filter((n) => !isPinned(n) && vnDay(n.created_at) === today) },
    { label: "Trước đó", rows: rows.filter((n) => !isPinned(n) && vnDay(n.created_at) !== today) },
  ];
  return out.filter((g) => g.rows.length > 0);
}

function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api("POST", "/notifications/read", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["unread"] });
    },
  });
}

/** One notification: a button that opens its link and marks it read. The page the link opens shows "Không còn quyền xem" or "Đã bị xoá" by itself. */
function Item({ n, onOpened }: { n: NotificationRow; onOpened?: () => void }) {
  const nav = useNavigate();
  const mark = useMarkRead();
  const open = () => {
    if (!n.read_at) mark.mutate({ ids: [n.id] });
    onOpened?.();
    if (n.link) void nav({ href: n.link });
  };
  return (
    <button type="button" data-testid="notification-item" onClick={open} className={cn("flex w-full flex-col gap-0.5 rounded-md border border-border p-3 text-left text-[13px] hover:bg-muted", n.read_at ? "bg-card" : "bg-[#F5F6FF]")}>
      <span className="flex items-start justify-between gap-2">
        <span className={cn("flex items-start gap-2 [overflow-wrap:anywhere]", n.read_at ? "font-medium" : "font-medium text-foreground")}>
          {!n.read_at && <span aria-label="Chưa đọc" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
          <span>{isPinned(n) && <Pin size={12} aria-label="Ghim" className="mr-1 inline" />}
          {n.title}</span>
        </span>
        <span className="whitespace-nowrap text-xs text-muted-foreground" title={fmtTime(n.created_at)}>{relTime(n.created_at)}</span>
      </span>
      {n.body && <span className="text-muted-foreground [overflow-wrap:anywhere]">{n.body}</span>}
      {n.data?.code && <span className="font-mono text-lg tracking-widest">{n.data.code}</span>}
    </button>
  );
}

/** Thời gian ngắn: "5 phút trước", "2 giờ trước", "Hôm qua 08:00", "24/11 08:00" (giờ Việt Nam, không giây). */
export function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const hm = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  if (diff < 60_000) return "Vừa xong";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  const day = vnDay(iso);
  const today = vnDay(new Date().toISOString());
  if (day === today) return `${Math.floor(diff / 3_600_000)} giờ trước`;
  if (day === vnDay(new Date(Date.now() - 86_400_000).toISOString())) return `Hôm qua ${hm}`;
  const [, m, dd] = day.split("-");
  return `${dd}/${m} ${hm}`;
}

/** Chip bật/tắt "Chỉ chưa đọc" kèm số chưa đọc. */
function UnreadChip({ on, count, onClick }: { on: boolean; count: number; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted")}>
      Chỉ chưa đọc
      {count > 0 && <span className={cn("rounded-full px-1.5 text-[11px] font-medium leading-4", on ? "bg-white/25" : "bg-primary/10 text-primary")}>{count > 99 ? "99+" : count}</span>}
    </button>
  );
}

function Groups({ rows, onOpened }: { rows: NotificationRow[]; onOpened?: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      {groups(rows).map((g) => (
        <section key={g.label} aria-label={g.label} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">{g.label}</h3>
          {g.rows.map((n) => <Item key={n.id} n={n} onOpened={onOpened} />)}
        </section>
      ))}
    </div>
  );
}

/** The bell: unread count (live through SSE), the last 20 notifications, and a toast for a new important one while the app is open. */
export function BellButton({ me }: { me: Me }) {
  const enabled = can(me, "notification:read");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"notif" | "reminder" | "announce">("notif");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [annTab, setAnnTab] = useState<AnnTab>("received");
  const [plus, setPlus] = useState(false);
  const [create, setCreate] = useState<"reminder" | "announce" | null>(null);
  const canRemind = can(me, "notification:manage");
  const canAnnounce = can(me, "notification:announce");
  const mark = useMarkRead();
  const count = useQuery({ queryKey: ["unread"], queryFn: () => api<{ unread: number }>("GET", "/notifications/unread-count"), enabled, retry: false });
  const list = useQuery({ queryKey: ["notifications", "bell"], queryFn: () => apiList<NotificationRow>(`/notifications${qs({ limit: 20 })}`), enabled, retry: false });
  const n = count.data?.unread ?? 0;

  // A new important notification pops a toast. The first load only records what is already there.
  const seen = useRef<Set<string> | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!list.data) return;
    const rows = list.data.data;
    if (seen.current === null) {
      seen.current = new Set(rows.map((r) => r.id));
      return;
    }
    for (const r of rows) {
      if (seen.current.has(r.id)) continue;
      seen.current.add(r.id);
      if (r.priority === "important" && !r.read_at) notify.ok(r.body ? `${r.title}: ${r.body}` : r.title, r.link ? { label: "Mở", onClick: () => void nav({ href: r.link! }) } : undefined);
    }
  }, [list.data, nav]);

  const rows = (list.data?.data ?? []).filter((r) => !unreadOnly || !r.read_at);
  const trigger = (
    <button type="button" aria-label={`Thông báo, ${n} chưa đọc`} className="relative inline-flex min-h-9 min-w-9 items-center justify-center rounded-md hover:bg-muted">
      <Bell size={18} />
      {n > 0 && (
        <span data-testid="bell-count" className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-bad px-1 text-center text-xs font-medium leading-4 text-white">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </button>
  );
  const tabs = [{ value: "notif" as const, label: "Thông báo" }, ...(canRemind ? [{ value: "reminder" as const, label: "Nhắc hẹn" }] : []), { value: "announce" as const, label: "Thông báo chung" }];
  const pick = (what: "reminder" | "announce") => {
    setPlus(false);
    setOpen(false);
    setCreate(what);
  };
  return (
    <>
      <Popover trigger={trigger} label="Thông báo" align="end" width="w-[28rem]" open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPlus(false); }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1"><Tabs value={tab} onChange={setTab} items={tabs} /></div>
          {(canRemind || canAnnounce) && (
            <div className="relative shrink-0">
              <Button variant="secondary" aria-label="Tạo mới" aria-expanded={plus} onClick={() => setPlus((v) => !v)} className="!px-2"><Plus size={18} aria-hidden /></Button>
              {plus && (
                <div role="menu" aria-label="Tạo mới" className="absolute right-0 top-full z-10 mt-1 flex w-52 flex-col rounded-lg border border-border bg-card p-1 shadow-md">
                  {canRemind && <button type="button" role="menuitem" onClick={() => pick("reminder")} className="rounded-md px-3 py-2 text-left text-sm hover:bg-primary-soft">Tạo nhắc hẹn</button>}
                  {canAnnounce && <button type="button" role="menuitem" onClick={() => pick("announce")} className="rounded-md px-3 py-2 text-left text-sm hover:bg-primary-soft">Tạo thông báo chung</button>}
                </div>
              )}
            </div>
          )}
        </div>
        {tab === "notif" && (
          <>
            <div className="mb-2 flex justify-end"><UnreadChip on={unreadOnly} count={n} onClick={() => setUnreadOnly((v) => !v)} /></div>
            {list.isLoading ? <p className="text-muted-foreground">Đang tải...</p> : rows.length === 0 ? <p className="py-4 text-center text-muted-foreground">Không có thông báo.</p> : <Groups rows={rows} onOpened={() => setOpen(false)} />}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
              <button type="button" disabled={n === 0 || mark.isPending} onClick={() => mark.mutate({ all: true })} className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">Đánh dấu tất cả đã đọc</button>
              <Link to="/thong-bao" onClick={() => setOpen(false)} className="text-sm text-primary hover:underline">Xem tất cả</Link>
            </div>
          </>
        )}
        {tab === "reminder" && canRemind && <RemindersPanel showNew={false} />}
        {tab === "announce" && <AnnouncementsPanel tab={annTab} onTab={setAnnTab} nested />}
      </Popover>
      <Modal title="Tạo nhắc hẹn" open={create === "reminder"} onClose={() => setCreate(null)}>
        <ReminderForm onDone={() => { setCreate(null); setTab("reminder"); setOpen(true); }} />
      </Modal>
      <Modal title="Tạo thông báo chung" open={create === "announce"} onClose={() => setCreate(null)}>
        <ComposeForm onSent={() => { setCreate(null); setAnnTab("sent"); setTab("announce"); setOpen(true); }} />
      </Modal>
    </>
  );
}

/** The full list: filter by group, unread only, keyset paging. */
export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState("");
  const mark = useMarkRead();
  const unread = useQuery({ queryKey: ["unread"], queryFn: () => api<{ unread: number }>("GET", "/notifications/unread-count"), retry: false });
  const q = useInfiniteQuery({
    queryKey: ["notifications", "page", unreadOnly, category],
    initialPageParam: "" as string,
    queryFn: ({ pageParam }): Promise<Page<NotificationRow>> => apiList<NotificationRow>(`/notifications${qs({ limit: 30, unread_only: unreadOnly, category, cursor: pageParam })}`),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <div>
      <PageTitle
        actions={
          <>
            <Link to="/nhac-hen" className="inline-flex min-h-9 items-center rounded-md px-3 text-sm text-primary underline">Nhắc hẹn</Link>
            <Link to="/tai-khoan/thong-bao" className="inline-flex min-h-9 items-center rounded-md px-3 text-sm text-primary underline">Cài đặt</Link>
            <button type="button" onClick={() => mark.mutate({ all: true })} className="text-xs font-medium text-muted-foreground hover:text-foreground">Đánh dấu tất cả đã đọc</button>
          </>
        }
      >
        Thông báo
      </PageTitle>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select aria-label="Nhóm" className="!w-48" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Mọi nhóm</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <UnreadChip on={unreadOnly} count={unread.data?.unread ?? 0} onClick={() => setUnreadOnly((v) => !v)} />
        {unreadOnly && <button type="button" onClick={() => setUnreadOnly(false)} className="text-sm text-primary hover:underline">Xem tất cả</button>}
      </div>
      <ErrorText error={q.error ?? mark.error} />
      {rows.length === 0 && !q.isLoading ? <EmptyState title="Không có thông báo" /> : <Groups rows={rows} />}
      {q.hasNextPage && <div className="mt-3 text-center"><Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Tải thêm</Button></div>}
    </div>
  );
}
