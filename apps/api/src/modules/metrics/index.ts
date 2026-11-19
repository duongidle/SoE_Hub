import { registerOwnedTable } from "../../auth/query-guard";
import { registerSettings } from "../system/settings-catalog";
import { dashboardOperations, MT_SETTINGS } from "./dashboard-ops";
import { metricOperations as baseOperations } from "./ops";

// Definitions of metrics belong to the datahub owner: every query on them carries the scope marker.
for (const t of ["mt_sources", "mt_metrics", "mt_dashboards", "mt_charts"]) registerOwnedTable(t);

registerSettings(MT_SETTINGS.maxDashboards, MT_SETTINGS.maxCharts);

export const metricOperations = [...baseOperations, ...dashboardOperations];
export { runMetric, runDefinition, validateDefinition, mergeSpec, diagnoseJoins, unmatchedRows, validateSpec } from "./engine";
export { resolveSource } from "./context";
export { metricsEvents, metricCacheSubscriber, METRIC_CACHE_CHANNEL } from "./invalidate";
export { invalidateMetricCache, metricCacheStats, resetMetricCache, metricLimits, runSql } from "./runner";
