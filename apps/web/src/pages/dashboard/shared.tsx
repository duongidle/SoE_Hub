import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageTitle } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { listSharedDashboards } from "@/lib/dashboard/api";
import { DashboardView } from "@/pages/datahub/dashboard/dashboard-view";

/** Dashboards other people shared with me, and (for a Guest) the ones opened to the data grants I hold. */
export function SharedDashboardsPage() {
  const q = useQuery({ queryKey: ["mt-shared-dashboards"], queryFn: listSharedDashboards });
  return (
    <>
      <PageTitle>Dashboard được chia sẻ</PageTitle>
      <p className="mb-4 text-sm text-muted-foreground">Số liệu trên các dashboard này được tính theo quyền của người chia sẻ. Bạn không cần quyền xem các bảng dữ liệu nguồn.</p>
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" aria-busy="true" aria-label="Đang tải danh sách" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được danh sách dashboard" />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState title="Chưa có dashboard nào được chia sẻ cho bạn" hint="Khi ai đó chia sẻ dashboard, nó sẽ hiện ở đây." />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="shared-dashboards">
          {q.data!.map((d) => (
            <li key={d.id}>
              <Link to="/dashboard/$dashboardId" params={{ dashboardId: d.id }} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted" data-testid="shared-dashboard">
                <LayoutDashboard size={20} aria-hidden className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium [overflow-wrap:anywhere]">{d.name}</span>
                  <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">Của {d.owner_name ?? "người khác"} · {d.datahub_name}</span>
                </span>
                {d.role === "guest" && <Badge>Được cấp cho Guest</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One shared dashboard, view only. */
export function SharedDashboardPage() {
  const { dashboardId } = useParams({ strict: false }) as { dashboardId: string };
  return (
    <>
      <Link to="/dashboard" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} aria-hidden /> Dashboard được chia sẻ</Link>
      <DashboardView key={dashboardId} dashboardId={dashboardId} mode="viewer" />
    </>
  );
}
