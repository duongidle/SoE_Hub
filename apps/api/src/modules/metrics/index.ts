import { registerOwnedTable } from "../../auth/query-guard";
import { registerSettings } from "../system/settings-catalog";
import { registerGrantDataType } from "../guest";
import { chartOperations } from "./chart-ops";
import { GUEST_DATA_TYPE } from "./dashboard-access";
import { dashboardOperations, MT_SETTINGS } from "./dashboard-ops";
import { metricOperations as baseOperations } from "./ops";

// Definitions of metrics belong to the datahub owner: every query on them carries the scope marker.
for (const t of ["mt_sources", "mt_metrics", "mt_dashboards", "mt_charts", "mt_dashboard_shares", "mt_dashboard_prefs"]) registerOwnedTable(t);

// A Manager can grant a Guest "dashboards" (design module1 section 5.2); the owner then opens each dashboard to Guests with `guest_visible`.
registerGrantDataType({ key: GUEST_DATA_TYPE, label: "Dashboard", channels: ["web"] });

registerSettings(MT_SETTINGS.maxDashboards, MT_SETTINGS.maxCharts);

export const metricOperations = [...baseOperations, ...dashboardOperations, ...chartOperations];
export { runMetric, runDefinition, validateDefinition, mergeSpec, diagnoseJoins, unmatchedRows, validateSpec } from "./engine";
export { resolveSource } from "./context";
export { metricsEvents, metricCacheSubscriber, METRIC_CACHE_CHANNEL } from "./invalidate";
export { invalidateMetricCache, metricCacheStats, resetMetricCache, metricLimits, runSql } from "./runner";
