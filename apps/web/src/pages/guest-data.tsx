import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Table2 } from "lucide-react";
import { useMemo } from "react";
import { PageTitle } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { dhKeys, getTable } from "@/lib/datahub/api";
import type { TableDetail } from "@/lib/datahub/types";
import { layoutColumns, normalizeConfig, ROW_HEIGHTS, DEFAULT_ROW_HEIGHT } from "@/lib/datahub/view-config";
import { LoadedTable, GridSkeleton } from "@/pages/datahub/table-view";

interface MyGrant {
  id: string;
  data_type: string;
  scope_label: string;
  channels: string[];
  options: { table_id?: string; columns?: string[] } | null;
}

/** Tables a Guest was given through a data grant (`datahub_table`). */
export function GuestDataPage() {
  const q = useQuery({ queryKey: ["grants", "mine"], queryFn: () => api<MyGrant[]>("GET", "/guest/my-grants") });
  const tables = (q.data ?? []).filter((g) => g.data_type === "datahub_table" && g.channels.includes("web") && g.options?.table_id);
  return (
    <>
      <PageTitle>Dữ liệu được cấp</PageTitle>
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" aria-busy="true" aria-label="Đang tải danh sách" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không tải được danh sách" />
      ) : tables.length === 0 ? (
        <EmptyState title="Chưa có bảng nào được cấp cho bạn xem trên web" hint="Khi Manager cấp bảng, nó sẽ hiện ở đây." />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="guest-tables">
          {tables.map((g) => (
            <li key={g.id}>
              <Link to="/du-lieu-duoc-cap/$tableId" params={{ tableId: g.options!.table_id! }} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted" data-testid="guest-table">
                <Table2 size={20} aria-hidden className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Bảng dữ liệu</span>
                  <span className="block text-xs text-muted-foreground">{g.scope_label} · {g.options?.columns?.length ?? 0} cột</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One granted table: only the granted columns, no search box (the server refuses it for a Guest), nothing to edit. */
export function GuestTablePage() {
  const { tableId } = useParams({ strict: false }) as { tableId: string };
  const q = useQuery({ queryKey: dhKeys.table(tableId), queryFn: () => getTable(tableId) });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Link to="/du-lieu-duoc-cap" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} aria-hidden /> Dữ liệu được cấp</Link>
      {q.isLoading ? <GridSkeleton /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Không mở được bảng" /> : <GuestGrid table={q.data} />}
    </div>
  );
}

function GuestGrid({ table }: { table: TableDetail }) {
  const gridView = useMemo(() => {
    const config = normalizeConfig({}, table.columns);
    const layout = layoutColumns(config, table.columns);
    return {
      columns: layout.columns,
      frozen: layout.frozen,
      widths: layout.widths,
      rowHeight: ROW_HEIGHTS[DEFAULT_ROW_HEIGHT],
      tall: false,
      colors: [],
      onWidth: () => undefined,
      onMove: () => undefined,
      canEditColumns: false,
      canEditColumn: () => false,
      layerTag: () => null,
      inTemplate: () => false,
      onGroupState: () => undefined,
      initialGroups: { collapsed: false, toggled: [] },
      onHeaderAction: () => undefined,
    };
  }, [table.columns]);
  return (
    <>
      <h2 className="text-base font-semibold [overflow-wrap:anywhere]" data-testid="guest-table-name">{table.name}</h2>
      <LoadedTable key={table.columns.map((c) => c.key).join(",")} table={table} query={{}} gridView={gridView} searching={false} onClearFilters={() => undefined} />
    </>
  );
}
