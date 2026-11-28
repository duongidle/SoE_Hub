import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { listDashboards, listSharedDashboards } from "@/lib/dashboard/api";
import { formatValue } from "@/lib/dashboard/format";
import { dhKeys, getDatahub, resolveTimeRange } from "@/lib/datahub/api";
import { CYCLE_MILESTONES, dealCycleKeys, getCycle, getForecast, type CycleMilestone, type DealHome } from "@/lib/datahub/deal-api";
import type { useSharedPeriodState } from "@/lib/datahub/deal-view";
import { rangeName } from "@/lib/datahub/time-ui";
import type { TimeRange } from "@soe/shared";
import { can, useMe } from "@/lib/session";
import { cn } from "@/lib/utils";
import { DashboardView } from "../datahub/dashboard/dashboard-view";

/** The name of the dashboard the system makes for every tree (`DEAL_DASHBOARD_NAME` on the server). */
const DEALS_DASHBOARD = "Deals";
const MILESTONE_KEY = "soe.deal.cycle-milestone";

function readMilestone(): CycleMilestone {
  try {
    const v = localStorage.getItem(MILESTONE_KEY);
    if (CYCLE_MILESTONES.some((m) => m.value === v)) return v as CycleMilestone;
  } catch { /* the choice just does not survive a reload */ }
  return "median";
}

/**
 * The dashboard of Quản lý Deal (module4 13): the default "Deals" dashboard of the tree, numbers of the person who reads it, in the shared period of the bar
 * above (module4 11a). The cohort milestone is each person's choice; the cut-off date and the forecast of the team are the server's numbers.
 */
export function DealDashboard({ home, period }: { home: DealHome; period: ReturnType<typeof useSharedPeriodState> }) {
  const me = useMe().data;
  const isManager = !!me?.user.roles.includes("manager");
  const datahubId = home.tables.find((t) => t.role_set === "deals")?.datahub_id ?? home.datahub_id;
  const idQ = useQuery({
    queryKey: ["deal-dashboard", datahubId, isManager],
    enabled: !!datahubId,
    queryFn: async () => {
      if (isManager) return (await listDashboards(datahubId!)).find((d) => d.name === DEALS_DASHBOARD)?.id ?? null;
      return (await listSharedDashboards()).find((d) => d.datahub_id === datahubId && d.name === DEALS_DASHBOARD)?.id ?? null;
    },
  });
  const dhQ = useQuery({ queryKey: dhKeys.datahub(datahubId ?? ""), enabled: !!datahubId && isManager, queryFn: () => getDatahub(datahubId!) });
  const all = period.value?.all === true;
  // "Toàn bộ thời gian": a range with no ends (the server reads it as no cut at all); the dates the forecast needs are the widest the server accepts.
  const range: TimeRange | undefined = all ? { kind: "between" } : period.value?.range;
  const info = useQuery({ queryKey: dhKeys.timeRange(range), enabled: !!range, queryFn: () => resolveTimeRange(range!), staleTime: 60_000 });

  const [milestone, setMilestone] = useState<CycleMilestone>(readMilestone);
  const [cut, setCut] = useState(false);
  const cycle = useQuery({ queryKey: dealCycleKeys.cycle(milestone), queryFn: () => getCycle(milestone), staleTime: 60_000 });
  const pick = (m: CycleMilestone) => {
    setMilestone(m);
    try { localStorage.setItem(MILESTONE_KEY, m); } catch { /* ignore */ }
  };

  if (idQ.isLoading || (isManager && dhQ.isLoading) || !info.data || !range) return <Skeleton className="h-64 w-full" aria-busy="true" aria-label="Đang tải dashboard" />;
  if (idQ.error) return <ErrorState error={idQ.error} onRetry={() => void idQ.refetch()} title="Không tải được dashboard Deals" />;
  if (!idQ.data) return <EmptyState title="Chưa có dashboard Deals" hint="Dashboard được dựng cùng bộ bảng mặc định của cây. Nhờ Manager kiểm tra bảng Deals ở trang Template." />;
  const label = CYCLE_MILESTONES.find((m) => m.value === milestone)?.label ?? milestone;
  const c = cycle.data;

  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="deal-dashboard">
      {can(me, "deal:forecast:read") && <ForecastPanel from={all ? "1900-01-01" : info.data.from} to={all ? "2200-12-31" : info.data.to} name={all ? "Toàn bộ thời gian" : rangeName(period.value!.range, info.data.fiscal_start_month)} />}
      <section aria-label="Mốc cohort chín" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-card px-4 py-3 text-sm shadow-card">
        <label className="flex items-center gap-2">
          <span className="font-medium">Mốc cohort chín</span>
          <Select aria-label="Mốc cohort chín" data-testid="cycle-milestone" className="!w-auto" value={milestone} onChange={(e) => pick(e.target.value as CycleMilestone)}>
            {CYCLE_MILESTONES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4" data-testid="cycle-cut" checked={cut} onChange={(e) => setCut(e.target.checked)} />
          Chỉ tính cohort đã chín
        </label>
        <p className="min-w-0 flex-1 basis-72 border-l border-border-soft pl-4 text-xs leading-relaxed text-muted-foreground max-sm:border-l-0 max-sm:pl-0" data-testid="cycle-note">
          {cycle.isLoading ? "Đang tính mốc…" : cycle.error || !c ? "Không tính được mốc cohort." : (
            <>
              Đang dùng mốc <b>{label}</b>: {c.days === 0 ? "không chờ" : `chờ ${c.days} ngày sau cuối tháng nhận`}
              {c.defaulted ? ` (mặc định, vì dưới 10 deal Won trong 12 tháng; hiện có ${c.won_count})` : ` (từ ${c.won_count} deal Won trong 12 tháng)`}
              {c.mature_month ? `. Cohort tới tháng ${c.mature_month} đã chín; các tháng sau là tạm tính.` : ". Chưa có cohort nào chín."}
            </>
          )}
        </p>
      </section>
      {/* The bento canvas of 12C: white cards on the soft dotted workspace, one frame for the whole dashboard. */}
      <div className="rounded-card border border-border-soft bg-workspace p-3 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px] sm:p-4" data-testid="deal-dashboard-canvas">
        <DashboardView
          key={idQ.data}
          dashboardId={idQ.data}
          mode={isManager ? "owner" : "viewer"}
          dh={isManager ? dhQ.data : undefined}
          period={{ range, from: info.data.from, to: info.data.to }}
          mature={c ? { through: c.mature_through, cut } : null}
        />
      </div>
    </div>
  );
}

const TYPE_DOTS = ["bg-primary", "bg-ok-dot", "bg-warn-dot", "bg-info-dot", "bg-ai-dot"];

/** Forecast of the whole tree (Manager) or of the team (Leader) for the period: `deal.forecast`, the server's two parts. */
function ForecastPanel({ from, to, name }: { from: string | null; to: string | null; name: string }) {
  const q = useQuery({ queryKey: dealCycleKeys.forecast(from ?? "", to ?? ""), enabled: !!from && !!to, queryFn: () => getForecast(from!, to!), staleTime: 30_000 });
  if (!from || !to) return null;
  const f = q.data;
  const money = (v: number) => formatValue(v, "money");
  return (
    <section aria-label="Forecast của team" className="rounded-card border border-border bg-card p-4 shadow-card" data-testid="forecast-panel">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="size-2 rounded-full bg-primary" />
          <h2 className="text-base font-semibold">Forecast của team trong kỳ</h2>
          <Badge tone="muted">{name}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">Cập nhật tự động từ bảng Deals và Đợt thanh toán</p>
      </div>
      {q.isLoading ? <Skeleton className="mt-3 h-20 w-full" /> : q.error || !f ? <p className="mt-2 text-sm text-bad">Không tải được forecast.</p> : (
        <>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-ok-border bg-ok-bg px-4 py-3">
              <dt className="flex items-center justify-between gap-2 text-sm text-muted-foreground">Đã ký, chờ tiền về <Badge tone="ok">Đã ký</Badge></dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-ok" data-testid="forecast-signed">{money(f.signed)}</dd>
            </div>
            <div className="rounded-xl border border-warn-border bg-warn-bg px-4 py-3">
              <dt className="flex items-center justify-between gap-2 text-sm text-muted-foreground">Chưa ký <Badge tone="warn">Pipeline</Badge></dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-warn" data-testid="forecast-unsigned">{money(f.unsigned)}</dd>
            </div>
            <div className="rounded-xl border border-info-border bg-info-bg px-4 py-3">
              <dt className="flex items-center justify-between gap-2 text-sm text-muted-foreground">Tổng <Badge tone="info">Tổng</Badge></dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-info" data-testid="forecast-total">{money(f.signed + f.unsigned)}</dd>
            </div>
          </dl>
          {f.by_type.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-xl border border-border-soft">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead><tr className="bg-muted text-left text-xs text-muted-foreground"><th scope="col" className="px-3 py-2 font-semibold">Loại deal</th><th scope="col" className="px-3 py-2 text-right font-semibold">Đã ký</th><th scope="col" className="px-3 py-2 text-right font-semibold">Chưa ký</th></tr></thead>
                <tbody>{f.by_type.map((t, i) => (
                  <tr key={t.type} className="border-t border-border-soft">
                    <th scope="row" className="px-3 py-2 text-left font-medium"><span aria-hidden className={cn("mr-2 inline-block size-2 rounded-full align-middle", TYPE_DOTS[i % TYPE_DOTS.length])} />{t.type}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{money(t.signed)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{money(t.unsigned)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
