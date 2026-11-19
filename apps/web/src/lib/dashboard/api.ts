import { api, apiList, qs } from "@/lib/api";
import type { ChartDataResult, ChartDef, ChartRecord, DashFilters, DashShare, DashboardBrief, DashboardFull, Layout, MetricJson, RowsResult, SavedMetric, SavedSource, SharedDashboard, ViewFilters } from "./types";

/** Calls of the dashboard API. Every number comes from `metrics.query`; nothing is computed here. */

export const dashKeys = {
  list: (datahubId: string) => ["mt-dashboards", datahubId] as const,
  one: (id: string) => ["mt-dashboard", id] as const,
  trash: (datahubId: string) => ["mt-dash-trash", datahubId] as const,
  metrics: (datahubId: string) => ["mt-metrics", datahubId] as const,
  sources: (datahubId: string) => ["mt-sources", datahubId] as const,
  /** Every chart query starts with this, so one `invalidateQueries` reloads all numbers. */
  query: ["mt-query"] as const,
};

export const listDashboards = async (datahubId: string) => (await apiList<DashboardBrief>(`/datahubs/${datahubId}/dashboards`)).data;
export const listDashboardTrash = async (datahubId: string) => (await apiList<DashboardBrief>(`/datahubs/${datahubId}/dashboards/trash`)).data;
export const getDashboard = (id: string) => api<DashboardFull>("GET", `/dashboards/${id}`);
export const createDashboard = (datahubId: string, name: string) => api<DashboardBrief>("POST", `/datahubs/${datahubId}/dashboards`, { name });
export const renameDashboard = (id: string, version: number, name: string) => api<DashboardBrief>("PATCH", `/dashboards/${id}`, { version, name });
export const reorderDashboards = async (datahubId: string, ids: string[]) => (await api<DashboardBrief[]>("PUT", `/datahubs/${datahubId}/dashboards/order`, { ids }));
export const duplicateDashboard = (id: string) => api<DashboardFull>("POST", `/dashboards/${id}/duplicate`, {});
export const deleteDashboard = (id: string) => api("DELETE", `/dashboards/${id}`);
export const restoreDashboard = (id: string, name?: string) => api<DashboardBrief>("POST", `/dashboards/${id}/restore`, name ? { name } : {});

export const createChart = (dashboardId: string, chart: ChartDef) => api<ChartRecord>("POST", `/dashboards/${dashboardId}/charts`, { chart });
export const updateChart = (chartId: string, version: number, chart: ChartDef) => api<ChartRecord>("PATCH", `/charts/${chartId}`, { version, chart });
export const deleteChart = (chartId: string) => api("DELETE", `/charts/${chartId}`);
export const saveLayout = (dashboardId: string, items: { chart_id: string; layout: Layout }[]) => api<{ saved: number }>("PUT", `/dashboards/${dashboardId}/layout`, { items });

export const listMetrics = async (datahubId: string) => (await apiList<SavedMetric>(`/datahubs/${datahubId}/metrics`)).data;
export const listSources = async (datahubId: string) => (await apiList<SavedSource>(`/datahubs/${datahubId}/metric-sources`)).data;
export const saveMetric = (datahubId: string, metric: MetricJson) => api<SavedMetric>("POST", `/datahubs/${datahubId}/metrics`, { metric });
export const saveSource = (datahubId: string, source: { name: string; table: string; joins?: unknown[] }) => api<SavedSource>("POST", `/datahubs/${datahubId}/metric-sources`, { source });

export const viewDashboard = (id: string) => api<DashboardFull>("GET", `/dashboards/${id}/view`);
export const listSharedDashboards = async () => (await apiList<SharedDashboard>("/dashboards/shared")).data;
export const updateDashboard = (id: string, version: number, patch: { name?: string; filters?: DashFilters | null; guest_visible?: boolean }) => api<DashboardBrief>("PATCH", `/dashboards/${id}`, { version, ...patch });
export const saveMyFilters = (id: string, filters: DashFilters) => api("PUT", `/dashboards/${id}/my-filters`, { filters });
export const resetMyFilters = (id: string) => api("DELETE", `/dashboards/${id}/my-filters`);
export const listDashShares = async (id: string) => (await apiList<DashShare>(`/dashboards/${id}/shares`)).data;
export const addDashShare = (id: string, granteeId: string) => api<DashShare>("PUT", `/dashboards/${id}/shares`, { grantee_id: granteeId });
export const removeDashShare = (id: string, shareId: string) => api("DELETE", `/dashboards/${id}/shares/${shareId}`);
export const exportDashboard = (id: string) => api<Record<string, unknown>>("GET", `/dashboards/${id}/export`);
export const importDashboard = (datahubId: string, dashboard: Record<string, unknown>, name?: string) => api<DashboardFull>("POST", `/datahubs/${datahubId}/dashboards/import`, { dashboard, ...(name ? { name } : {}) });

const json = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v));

/** Numbers of one chart: a saved chart by id (the server reads its stored JSON; numbers use the dashboard owner's rights), or a draft. */
export interface ChartRef {
  chartId?: string;
  /** Version of the saved chart: a new version means a new question. */
  version?: number;
  chart?: ChartDef;
  datahubId: string;
  filters?: ViewFilters;
}
const hasFilters = (f?: ViewFilters) => !!f && (!!f.range || !!f.conditions?.length || !!f.cross?.length);

export const runChartData = (r: ChartRef) =>
  api<ChartDataResult>("GET", `/chart-data${qs({ ...(r.chartId ? { chart_id: r.chartId } : { chart: json(r.chart), datahub_id: r.datahubId }), ...(hasFilters(r.filters) ? { filters: json(r.filters) } : {}) } as Record<string, string | undefined>)}`);

/** Options that change what the server computes (not how it is drawn): a new title or colour must not ask the server again. */
const DATA_OPTIONS = ["bins", "top_n", "max_slices", "totals", "sparkline", "total", "x_split", "y_split", "ignore_filters", "ignore_cross"] as const;
export const dataSignature = (c: ChartDef) => JSON.stringify({ t: c.type, s: c.series, o: Object.fromEntries(DATA_OPTIONS.filter((k) => c.options?.[k] !== undefined).map((k) => [k, c.options![k]])) });

/** Cache key: the definition of the numbers and the filters (every key starts with `mt-query`, so one invalidation reloads all numbers). */
export const chartKey = (r: ChartRef) => [...dashKeys.query, r.datahubId, r.chartId ?? "draft", r.chartId ? (r.version ?? 0) : r.chart ? dataSignature(r.chart) : "", hasFilters(r.filters) ? JSON.stringify(r.filters) : ""] as const;

const rowsParams = (chartId: string, series: number, group: (string | number | boolean | null)[], filters?: ViewFilters) => ({ chart_id: chartId, series, ...(group.length ? { group: JSON.stringify(group) } : {}), ...(hasFilters(filters) ? { filters: JSON.stringify(filters) } : {}) });
export const getChartRows = (chartId: string, series: number, group: (string | number | boolean | null)[], filters: ViewFilters | undefined, offset: number, limit = 50) =>
  api<RowsResult>("GET", `/chart-rows${qs({ ...rowsParams(chartId, series, group, filters), offset, limit })}`);
export const getChartCsv = (chartId: string, series: number, group: (string | number | boolean | null)[], filters?: ViewFilters) =>
  api<{ filename: string; csv: string; rows: number; total_visible: number; total_owner: number; truncated: boolean; note: string }>("GET", `/chart-csv${qs(rowsParams(chartId, series, group, filters))}`);
