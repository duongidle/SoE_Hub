import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Select } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { listDashboards, listSharedDashboards } from "@/lib/dashboard/api";
import { formatValue } from "@/lib/dashboard/format";
import { dhKeys, getDatahub, resolveTimeRange } from "@/lib/datahub/api";
import { CYCLE_MILESTONES, dealCycleKeys, getCycle, getForecast, type CycleMilestone, type DealHome } from "@/lib/datahub/deal-api";
import type { useSharedPeriodState } from "@/lib/datahub/deal-view";
import { can, useMe } from "@/lib/session";
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
  const range = period.value?.range;
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
      {can(me, "deal:forecast:read") && <ForecastPanel from={info.data.from} to={info.data.to} />}
      <section aria-label="Mốc cohort chín" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
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
        <p className="min-w-0 text-xs text-muted-foreground" data-testid="cycle-note">
          {cycle.isLoading ? "Đang tính mốc…" : cycle.error || !c ? "Không tính được mốc cohort." : (
            <>
              Đang dùng mốc <b>{label}</b>: {c.days === 0 ? "không chờ" : `chờ ${c.days} ngày sau cuối tháng nhận`}
              {c.defaulted ? ` (mặc định, vì dưới 10 deal Won trong 12 tháng; hiện có ${c.won_count})` : ` (từ ${c.won_count} deal Won trong 12 tháng)`}
              {c.mature_month ? `. Cohort tới tháng ${c.mature_month} đã chín; các tháng sau là tạm tính.` : ". Chưa có cohort nào chín."}
            </>
          )}
        </p>
      </section>
      <DashboardView
        key={idQ.data}
        dashboardId={idQ.data}
        mode={isManager ? "owner" : "viewer"}
        dh={isManager ? dhQ.data : undefined}
        period={{ range, from: info.data.from, to: info.data.to }}
        mature={c ? { through: c.mature_through, cut } : null}
      />
    </div>
  );
}

/** Forecast of the whole tree (Manager) or of the team (Leader) for the period: `deal.forecast`, the server's two parts. */
function ForecastPanel({ from, to }: { from: string | null; to: string | null }) {
  const q = useQuery({ queryKey: dealCycleKeys.forecast(from ?? "", to ?? ""), enabled: !!from && !!to, queryFn: () => getForecast(from!, to!), staleTime: 30_000 });
  if (!from || !to) return null;
  const f = q.data;
  const money = (v: number) => formatValue(v, "money");
  return (
    <section aria-label="Forecast của team" className="rounded-md border border-border bg-card px-3 py-2" data-testid="forecast-panel">
      <h2 className="text-sm font-semibold">Forecast của team trong kỳ</h2>
      {q.isLoading ? <Skeleton className="mt-2 h-10 w-full" /> : q.error || !f ? <p className="mt-1 text-sm text-destructive">Không tải được forecast.</p> : (
        <>
          <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">Đã ký, chờ tiền về</dt><dd className="text-lg font-semibold tabular-nums" data-testid="forecast-signed">{money(f.signed)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Chưa ký</dt><dd className="text-lg font-semibold tabular-nums" data-testid="forecast-unsigned">{money(f.unsigned)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Tổng</dt><dd className="text-lg font-semibold tabular-nums" data-testid="forecast-total">{money(f.signed + f.unsigned)}</dd></div>
          </dl>
          {f.by_type.length > 0 && (
            <table className="mt-2 w-full border-collapse text-xs">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th scope="col" className="py-1 font-medium">Loại deal</th><th scope="col" className="py-1 text-right font-medium">Đã ký</th><th scope="col" className="py-1 text-right font-medium">Chưa ký</th></tr></thead>
              <tbody>{f.by_type.map((t) => <tr key={t.type} className="border-b border-border/60 last:border-0"><th scope="row" className="py-1 text-left font-normal">{t.type}</th><td className="py-1 text-right tabular-nums">{money(t.signed)}</td><td className="py-1 text-right tabular-nums">{money(t.unsigned)}</td></tr>)}</tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
