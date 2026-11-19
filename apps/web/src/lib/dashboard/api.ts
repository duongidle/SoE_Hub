import { api, apiList, qs } from "@/lib/api";
import type { ChartDef, ChartRecord, DashboardBrief, DashboardFull, Layout, MetricJson, QueryResult, SavedMetric, SavedSource, SeriesDef } from "./types";

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

/** Parameters of `metrics.query` for one series of a chart. */
export function queryParams(s: SeriesDef, datahubId: string): Record<string, unknown> {
  return {
    ...(s.metric_id ? { metric_id: s.metric_id } : { metric: s.metric, datahub_id: datahubId }),
    time: s.time,
    group_by: s.group_by?.length ? s.group_by : undefined,
    filter: s.filter,
    order: s.order,
    limit: s.limit,
    compare: s.compare,
    cumulative: s.cumulative === undefined ? undefined : String(s.cumulative),
    target: s.target,
  };
}

export const runQuery = (s: SeriesDef, datahubId: string) => api<QueryResult>("GET", `/metric-query${qs(queryParams(s, datahubId) as Record<string, string | number | boolean | null | undefined | object>)}`);

/** Cache key: the definition of the numbers, not how they are drawn (a new title or colour must not ask the server again). */
export const queryKey = (s: SeriesDef, datahubId: string) => [...dashKeys.query, datahubId, JSON.stringify(queryParams(s, datahubId))] as const;
