import { registerOwnedTable } from "../../auth/query-guard";
import { metricOperations } from "./ops";

// Definitions of metrics belong to the datahub owner: every query on them carries the scope marker.
for (const t of ["mt_sources", "mt_metrics", "mt_dashboards", "mt_charts"]) registerOwnedTable(t);

export { metricOperations };
export { runMetric, runDefinition, validateDefinition, mergeSpec, diagnoseJoins, unmatchedRows, validateSpec } from "./engine";
export { resolveSource } from "./context";
