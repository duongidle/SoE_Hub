import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Button, Input, PageTitle, Select } from "@/components/ui/form";
import { PersonChip } from "@/components/ui/person";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, FilteredEmptyState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { disambiguate } from "@/lib/people";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import { ChipFilter, GROUP_LABEL, PLAN_STATUS, Pill, useOnbAccess, type Tone } from "./common";
import { ProgressBar } from "./parts";
import { PlanView } from "./plan-view";

interface Row {
  plan_id: string; plan_name: string; status: string; staff_id: string; staff_name: string; leader_id: string | null; leader_name: string | null; current_week: number; total_weeks: number;
  progress_pct: number; overdue: number; checkpoints_passed: number; checkpoints_total: number; groups: Record<string, { passed: number; total: number; state: string | null }>; final_result: string | null;
}
const GROUPS = ["test", "mockup", "on_job", "qna", "daily", "other"];
const GROUP_TONE: Record<string, Tone> = { passed: "ok", failed: "bad", running: "info", not_yet: "neutral" };
const COLS = "lg:grid-cols-[minmax(170px,1.1fr)_minmax(220px,2fr)_150px_100px_70px_90px]";
const FILTERS = { q: "", status: "active", team: "", plan: "", view: "all" };

function StatCard({ label, value, tone, testid }: { label: string; value: number; tone?: "bad"; testid: string }) {
  return (
    <div className="rounded-card border border-border bg-card px-4 py-3 shadow-card" data-testid={testid}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("num mt-1 text-2xl font-bold tracking-tight", tone === "bad" && value > 0 ? "text-bad" : "text-foreground")}>{value}</div>
    </div>
  );
}

/** The weeks of one plan as dots: past filled, the current week big with a ring, the coming ones hollow. */
function MiniRoad({ r }: { r: Row }) {
  const ended = r.status === "completed" || r.status === "stopped";
  return (
    <div className="flex flex-wrap items-center gap-1" role="img" aria-label={`Tuần ${r.current_week} trên ${r.total_weeks}`} data-testid="onb-miniroad">
      {Array.from({ length: r.total_weeks }, (_, i) => {
        const no = i + 1;
        const past = ended ? true : no < r.current_week;
        const cur = !ended && no === r.current_week;
        return <span key={no} aria-hidden className={cn("shrink-0 rounded-full", cur ? "size-3.5 bg-primary ring-2 ring-primary-border" : past ? cn("size-2.5", r.status === "stopped" ? "bg-faint" : "bg-ok-dot") : "size-2.5 border border-faint/60 bg-card")} />;
      })}
    </div>
  );
}

export function FollowPage() {
  return <OverviewBody />;
}

/** Overview of the people being onboarded (for Leader, Manager, followers): numbers, then one row per person. */
export function OverviewBody() {
  const [f, setF] = useUrlState(FILTERS);
  const nav = useNavigate();
  const a = useOnbAccess();
  const res = useQuery({ queryKey: ["onb", "overview", "all", f.q], queryFn: () => api<Row[]>("GET", `/onboarding/overview?status=all${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}`) });
  const everyone = res.data ?? [];
  const active = everyone.filter((r) => r.status === "active");
  const all = f.status === "all" ? everyone : everyone.filter((r) => r.status === f.status);
  const leaders = [...new Map(all.filter((r) => r.leader_id).map((r) => [r.leader_id!, r.leader_name ?? ""])).entries()];
  const plans = [...new Set(all.map((r) => r.plan_name))];
  const staffNames = disambiguate(all.map((r) => ({ id: r.staff_id, full_name: r.staff_name })));
  const rows = all.filter((r) => (!f.team || r.leader_id === f.team) && (!f.plan || r.plan_name === f.plan) && (f.view !== "following" || a.followingIds.has(r.plan_id)) && (f.view !== "late" || r.overdue > 0));
  const lateCount = rows.filter((r) => r.overdue > 0).length;
  const filtered = !!(f.q || f.team || f.plan || f.status !== "active" || f.view !== "all");
  const open = (r: Row) => void nav({ to: "/onboarding/nhan-su/$planId", params: { planId: r.plan_id } });
  return (
    <div>
      <PageTitle actions={a.manage ? <Button variant="secondary" onClick={() => void nav({ to: "/onboarding/lo-trinh" })} data-testid="onb-open-plans">Lộ trình & mẫu</Button> : undefined}>Tổng quan</PageTitle>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="onb-stats">
        <StatCard label="Đang onboard" value={active.length} testid="onb-stat-active" />
        <StatCard label="Có việc trễ" value={active.filter((r) => r.overdue > 0).length} tone="bad" testid="onb-stat-late" />
        <StatCard label="Sắp xong trong 2 tuần" value={active.filter((r) => r.total_weeks - r.current_week <= 2).length} testid="onb-stat-soon" />
        {a.ownPlan && (
          <Link to="/onboarding" className="flex flex-col justify-center rounded-card border border-primary-border bg-primary-soft/40 px-4 py-3 shadow-card hover:bg-primary-soft" data-testid="onb-own-card">
            <span className="text-xs font-medium text-muted-foreground">Lộ trình của tôi</span>
            <span className="mt-1 text-sm font-semibold text-primary">Mở hành trình</span>
          </Link>
        )}
      </div>
      <div className="mb-3"><ChipFilter label="Lọc danh sách" value={f.view} onChange={(v) => setF({ view: v })} items={[{ value: "all", label: "Tất cả" }, ...(a.followingIds.size > 0 ? [{ value: "following", label: "Tôi theo dõi" }] : []), { value: "late", label: "Trễ" }]} /></div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input className="min-w-40 flex-1 sm:max-w-xs" aria-label="Tìm" placeholder="Tìm tên hoặc lộ trình" value={f.q} onChange={(e) => setF({ q: e.target.value })} data-testid="onb-q" />
        <div className="min-w-0 basis-[calc(50%-4px)] sm:basis-44"><Select aria-label="Team" value={f.team} onChange={(e) => setF({ team: e.target.value })}><option value="">Mọi team</option>{leaders.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select></div>
        <div className="min-w-0 basis-[calc(50%-4px)] sm:basis-44"><Select aria-label="Lộ trình" value={f.plan} onChange={(e) => setF({ plan: e.target.value })}><option value="">Mọi lộ trình</option>{plans.map((n) => <option key={n} value={n}>{n}</option>)}</Select></div>
        <div className="min-w-0 basis-[calc(50%-4px)] sm:basis-40"><Select aria-label="Trạng thái" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="active">Đang chạy</option><option value="completed">Hoàn thành</option><option value="stopped">Đã dừng</option><option value="all">Tất cả</option></Select></div>
        {rows.length > 0 && <span className="num ml-auto text-sm text-muted-foreground" data-testid="onb-follow-count">{rows.length} người{lateCount > 0 ? ` · ${lateCount} có việc trễ` : ""}</span>}
      </div>
      {res.error ? <ErrorState error={res.error} onRetry={() => void res.refetch()} />
        : res.isLoading ? <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><p className="sr-only">Đang tải...</p></div>
        : rows.length === 0 ? (filtered ? <FilteredEmptyState onClear={() => setF({ q: "", team: "", plan: "", status: "active" })} /> : <EmptyState title="Chưa có nhân sự nào đang onboard" hint="Gắn một lộ trình cho nhân sự ở Lộ trình & mẫu." action={a.manage ? <Link to="/onboarding/lo-trinh" className="text-sm font-medium text-primary">Mở Lộ trình & mẫu</Link> : undefined} />)
        : (
          <>
          {/* Column titles (wide screens; narrow ones label each number inside the card). Same grid and the card's border + padding, so they line up. */}
          <div aria-hidden data-testid="onb-follow-head" className={cn("mb-1 hidden gap-x-4 px-[17px] text-xs font-medium text-muted-foreground lg:grid", COLS)}>
            <span>Nhân sự · lộ trình</span><span>Tiến độ theo tuần</span><span>Việc đã xong</span><span>Checkpoint</span><span>Việc trễ</span><span>Kết quả</span>
          </div>
          <ul className="flex flex-col gap-2" data-testid="onb-follow-list">
            {rows.map((r) => {
              const groups = GROUPS.filter((g) => r.groups[g]);
              return (
                <li key={r.plan_id} role="button" className="cursor-pointer rounded-card border border-border bg-card p-4 shadow-card transition-colors hover:border-primary-border hover:bg-primary-soft/30 focus-visible:outline-2 focus-visible:outline-primary" data-testid="onb-row" tabIndex={0} onClick={() => open(r)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) open(r); }}>
                  <div className={cn("grid items-center gap-x-4 gap-y-3", COLS)}>
                    <div className="min-w-0">
                      <span className="inline-flex max-w-full items-center gap-1 font-medium" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <PersonChip person={{ id: r.staff_id, full_name: r.staff_name }} label={staffNames.get(r.staff_id)} />
                        <Link to="/onboarding/nhan-su/$planId" params={{ planId: r.plan_id }} className="text-xs text-primary underline" aria-label={`Mở lộ trình của ${r.staff_name}`}>Mở</Link>
                      </span>
                      <div className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{r.plan_name}{r.status !== "active" && ` (${PLAN_STATUS[r.status]})`}</div>
                    </div>
                    <div className="min-w-0"><MiniRoad r={r} /><div className="num mt-1 text-xs text-muted-foreground">Tuần {r.current_week}/{r.total_weeks}</div></div>
                    <div><div className="num mb-1 text-sm font-semibold" data-testid="onb-row-progress">{r.progress_pct}%</div><ProgressBar ratio={r.progress_pct / 100} tone={r.overdue > 0 ? "warn" : "primary"} className="!h-1.5" /></div>
                    <div className="num text-sm"><span className="text-xs text-muted-foreground lg:hidden">Checkpoint </span>{r.checkpoints_passed}/{r.checkpoints_total}</div>
                    <div className={cn("num text-sm", r.overdue > 0 ? "font-semibold text-bad" : "text-muted-foreground")}><span className="text-xs font-normal text-muted-foreground lg:hidden">Trễ </span>{r.overdue}</div>
                    <div>{r.final_result === "passed" ? <Pill tone="ok">Đạt</Pill> : r.final_result === "failed" ? <Pill tone="bad">Không đạt</Pill> : <span className="text-xs text-muted-foreground">Chưa chốt</span>}</div>
                  </div>
                  {groups.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border-soft pt-3">
                      {groups.map((g) => { const c = r.groups[g]!; return <Pill key={g} tone={GROUP_TONE[c.state ?? "not_yet"] ?? "neutral"} className="num font-medium">{GROUP_LABEL[g]} {c.passed}/{c.total}</Pill>; })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </>
        )}
    </div>
  );
}

/** The page of one person for a Leader or Manager: the same as the person sees, plus confirm, week break, stop and the final result. */
export function StaffPage() {
  const { planId } = useParams({ strict: false }) as { planId: string };
  return (
    <div>
      <PageTitle actions={<Link to="/onboarding/theo-doi" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline">Về Tổng quan</Link>}>Nhân sự onboarding</PageTitle>
      <PlanView planId={planId} manage />
    </div>
  );
}
