import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, BellPlus, BookOpen, Database, FileText, LayoutDashboard, Plus, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, Modal } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { recentLink, useRecent, type RecentItem, type RecentType } from "@/lib/home";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { addDays, todayVn, usePlan, usePlans, useProgress } from "./onboarding/common";
import { ReminderForm, type Reminder } from "./notify/reminders";

const TZ = "Asia/Ho_Chi_Minh";
const vnDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const vnTime = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** "15:30" today, "Ngày mai 09:00", else "27/11 09:00" (Vietnam time). */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = vnDate(d);
  const today = vnDate(now);
  if (day === today) return vnTime(d);
  if (day === addDays(today, 1)) return `Ngày mai ${vnTime(d)}`;
  return `${dm(day)} ${vnTime(d)}`;
}

/** "vừa xong", "5 phút trước", "2 giờ trước", "Hôm qua", else "27/11". */
export function agoLabel(iso: string, now = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < 60_000) return "vừa xong";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  const day = vnDate(new Date(iso));
  const today = vnDate(now);
  if (day === today) return `${Math.floor(diff / 3_600_000)} giờ trước`;
  if (day === addDays(today, -1)) return "Hôm qua";
  return dm(day);
}

function Side({ title, action, children, testid }: { title: string; action?: React.ReactNode; children: React.ReactNode; testid: string }) {
  return (
    <section className="rounded-card border border-border bg-card p-4 shadow-card" data-testid={testid}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const linkCls = "inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline";

/** Only for a person whose onboarding plan is running (the plan of someone else is not shown here). */
export function OnboardingSide() {
  const me = useMe().data;
  const allowed = can(me, "onboarding:path:read");
  const plans = usePlans("mine");
  const mine = (plans.data ?? []).find((p) => p.staff_id === me?.user.id && p.status === "active");
  const plan = usePlan(mine?.id);
  const progress = useProgress(mine?.id);
  if (!allowed || !mine) return null;
  const today = todayVn();
  const todo = (plan.data?.stages ?? []).flatMap((s) => s.weeks).flatMap((w) => w.items).flatMap((i) => i.occurrences ?? []).filter((o) => o.on_date === today && !o.done_at).length;
  const next = progress.data?.checkpoints.find((c) => c.status === "running" || c.status === "not_yet");
  const done = mine.occurrences_done ?? 0;
  const total = mine.occurrences_total ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Side title="Onboarding của tôi" testid="home-onboarding" action={progress.data && <Badge tone="info" className="tabular-nums">Tuần {progress.data.current_week}/{progress.data.total_weeks}</Badge>}>
      <div className="h-[3px] overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Tiến độ lộ trình" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-[linear-gradient(90deg,var(--primary),var(--ok))]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-3 text-[13.5px]">
        {plan.data ? (todo > 0 ? <>Hôm nay còn <b>{todo} việc</b></> : "Hôm nay không còn việc nào") : "Đang tải việc hôm nay..."}
        {next && <> · mốc <b>{next.name}</b>{next.week_no ? ` (tuần ${next.week_no})` : ""}</>}
      </p>
      <Link to="/onboarding" className={cn(linkCls, "mt-2")} data-testid="home-onboarding-open">
        Mở hành trình <ArrowRight size={13} aria-hidden />
      </Link>
    </Side>
  );
}

const TYPE_ICON: Record<RecentType, LucideIcon> = { datahub: Database, form: FileText, dashboard: LayoutDashboard, article: BookOpen };
const TYPE_LABEL: Record<RecentType, string> = { datahub: "Datahub", form: "Dynamic Form", dashboard: "Dashboard", article: "Knowledge" };
const TYPE_TONE: Record<RecentType, string> = { datahub: "bg-info-bg text-info", form: "bg-ai-bg text-ai", dashboard: "bg-primary-soft text-primary", article: "bg-ok-bg text-ok" };

function RecentRow({ e }: { e: RecentItem }) {
  const Icon = TYPE_ICON[e.type];
  const link = recentLink(e);
  return (
    <li>
      <Link to={link.to as never} params={link.params as never} className="-mx-2 flex items-center gap-3 rounded-control px-2 py-2 hover:bg-muted" data-testid="recent-item">
        <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-control", TYPE_TONE[e.type])}>
          <Icon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{e.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{TYPE_LABEL[e.type]} · {agoLabel(e.at)}</span>
        </span>
      </Link>
    </li>
  );
}

export function RecentSide() {
  const q = useRecent();
  const me = useMe().data;
  const items = (q.data ?? []).slice(0, 6);
  return (
    <Side title="Mở gần đây" testid="home-recent">
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.error ? (
        <p className="text-sm text-bad">Không tải được danh sách. <button type="button" className="underline" onClick={() => void q.refetch()}>Thử lại</button></p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p className="text-muted-foreground">Chưa có gì. Datahub, form, dashboard và bài Knowledge bạn mở sẽ hiện ở đây.</p>
          {can(me, "datahub:datahub:use") ? (
            <Link to="/datahub" className={linkCls}>Mở Datahub <ArrowRight size={13} aria-hidden /></Link>
          ) : can(me, "knowledge:article:read") ? (
            <Link to="/knowledge" className={linkCls}>Mở Knowledge <ArrowRight size={13} aria-hidden /></Link>
          ) : null}
        </div>
      ) : (
        <ul className="-mb-1" aria-label="Mở gần đây">{items.map((e) => <RecentRow key={`${e.type}:${e.id}`} e={e} />)}</ul>
      )}
    </Side>
  );
}

export function RemindersSide() {
  const me = useMe().data;
  const [creating, setCreating] = useState(false);
  const allowed = can(me, "notification:manage");
  const q = useQuery({ queryKey: ["reminders", "upcoming"], queryFn: () => api<Reminder[]>("GET", "/reminders?status=upcoming"), enabled: allowed });
  if (!allowed) return null;
  const now = new Date();
  const items = (q.data ?? []).slice(0, 4);
  return (
    <Side
      title="Nhắc hẹn sắp tới"
      testid="home-reminders"
      action={<button type="button" onClick={() => setCreating(true)} className={linkCls} data-testid="home-new-reminder"><Plus size={13} aria-hidden /> Tạo</button>}
    >
      {q.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : q.error ? (
        <p className="text-sm text-bad">Không tải được nhắc hẹn.</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p className="text-muted-foreground">Chưa có nhắc hẹn nào sắp tới.</p>
          <Button variant="secondary" onClick={() => setCreating(true)}><BellPlus size={16} aria-hidden /> Tạo nhắc hẹn</Button>
        </div>
      ) : (
        <ul className="space-y-2.5 text-[13.5px]">
          {items.map((r) => (
            <li key={r.id} className="flex gap-3" data-testid="home-reminder">
              <Badge tone={vnDate(new Date(r.due_at)) === vnDate(now) ? "warn" : "info"} className="h-[22px] shrink-0 whitespace-nowrap tabular-nums">{whenLabel(r.due_at, now)}</Badge>
              <span className="pt-0.5 [overflow-wrap:anywhere]">{r.content}</span>
            </li>
          ))}
        </ul>
      )}
      <Modal title="Nhắc mới" open={creating} onClose={() => setCreating(false)}>
        <ReminderForm onDone={() => setCreating(false)} />
      </Modal>
    </Side>
  );
}

interface Received {
  id: string;
  title: string;
  body: string;
  important: boolean;
  sender: string;
  read: boolean;
  created_at: string;
}

export function AnnouncementSide() {
  const me = useMe().data;
  const allowed = can(me, "notification:manage");
  const q = useQuery({ queryKey: ["announcements", "received"], queryFn: () => api<Received[]>("GET", "/announcements/received"), enabled: allowed });
  if (!allowed) return null;
  const latest = [...(q.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return (
    <Side title="Thông báo chung" testid="home-announcement" action={<Link to="/thong-bao-chung" className={linkCls}>Xem tất cả</Link>}>
      {q.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : q.error ? (
        <p className="text-sm text-bad">Không tải được thông báo chung.</p>
      ) : !latest ? (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p className="text-muted-foreground">Chưa có thông báo chung nào.</p>
          <Link to="/thong-bao" className={linkCls}>Mở hộp thông báo <ArrowRight size={13} aria-hidden /></Link>
        </div>
      ) : (
        <div className="text-[13.5px]">
          <b>{latest.title}</b> {latest.important && <Badge tone="warn">Quan trọng</Badge>}
          <span className="text-muted-foreground"> · {latest.sender} · {dm(vnDate(new Date(latest.created_at)))}</span>
          {latest.body && <p className="mt-1 line-clamp-2 text-muted-foreground">{latest.body}</p>}
        </div>
      )}
    </Side>
  );
}
